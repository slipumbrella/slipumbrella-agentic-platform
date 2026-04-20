package router

import (
	bucketAdapter "capstone-prog/adapter/bucket"
	gormAdapter "capstone-prog/adapter/gorm"
	httpAdapter "capstone-prog/adapter/http"
	openrouterAdapter "capstone-prog/adapter/openrouter"
	redisAdapter "capstone-prog/adapter/redis"
	typhoonAdapter "capstone-prog/adapter/typhoon"
	"capstone-prog/config"
	core "capstone-prog/core/service"
	"capstone-prog/proto"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"google.golang.org/grpc"
	"gorm.io/gorm"
)

func SetupRouter(cfg *config.Config, db *gorm.DB, conn *grpc.ClientConn) *gin.Engine {

	// Repositories
	chatRepo := gormAdapter.NewChatRepository(db)
	userRepo := gormAdapter.NewUserRepository(db)
	attachmentRepo := gormAdapter.NewAttachmentRepository(db)
	r2Repo := bucketAdapter.NewR2Repository(cfg)
	r2Service := core.NewR2Service(r2Repo)

	publicR2Repo := bucketAdapter.NewR2RepositoryWithBucket(cfg, cfg.R2_PUBLIC_BUCKET)
	publicR2Service := core.NewR2Service(publicR2Repo)

	// gRPC client
	coreAgentGrpc := proto.NewCoreAgentClient(conn)

	// Redis Repository (shared: rate limiting, R2 content cache, token blacklist, login lockout)
	redisRepo := redisAdapter.NewRedisRepository(cfg)

	// Agent session repository
	agentSessionRepo := gormAdapter.NewAgentSessionRepository(db)
	snapshotRepo := gormAdapter.NewSessionSnapshotRepository(db)

	// Team feature
	teamRepo := gormAdapter.NewTeamRepository(db)
	teamService := core.NewTeamService(teamRepo, agentSessionRepo)

	// Evaluation feature
	embeddingRepo := gormAdapter.NewEmbeddingRepository(db)
	evaluationRepo := gormAdapter.NewEvaluationRepository(db)
	evaluationService := core.NewEvaluationService(evaluationRepo, embeddingRepo, r2Service, redisRepo, coreAgentGrpc, agentSessionRepo, teamRepo, chatRepo)

	// Embedding feature (must be created after evaluationService for async triggering)
	openRouterAPI := openrouterAdapter.NewOpenRouterAdapter(cfg.OpenRouterAPIKey)
	embeddingService := core.NewEmbeddingService(embeddingRepo, attachmentRepo, openRouterAPI, r2Service, evaluationService)

	// Token usage repository
	tokenUsageRepo := gormAdapter.NewTokenUsageRepository(db)

	// Artifact repository
	artifactRepo := gormAdapter.NewArtifactRepository(db)

	// Issue feature
	issueRepo := gormAdapter.NewIssueAdapter(db)
	issueService := core.NewIssueService(issueRepo)
	openRouterModelRepo := gormAdapter.NewOpenRouterModelRepository(db)
	openRouterModelService := core.NewOpenRouterModelService(openRouterModelRepo, publicR2Service, cfg)

	lineRepo := gormAdapter.NewLineRepository(db)
	lineService := core.NewLineService(lineRepo)

	// Services
	builderService := core.NewBuilderService(chatRepo, agentSessionRepo, teamRepo, snapshotRepo, artifactRepo, coreAgentGrpc, tokenUsageRepo)
	authService := core.NewAuthService(userRepo, redisRepo, cfg.JWTSecret, cfg.JWTIssuer, cfg.JWTAudience)
	userService := core.NewUserService(userRepo)
	lineHandler := httpAdapter.NewLineHandler(lineService, teamService, builderService)

	// typhoon OCR adapter
	tOCR := typhoonAdapter.NewTyphoonAdapter(cfg.TyphoonAPIKey)

	uploadService := core.NewUploadService(attachmentRepo, embeddingRepo, evaluationService, tOCR, r2Service, cfg.R2_BUCKET, chatRepo, teamRepo, agentSessionRepo)

	// Handlers
	builderHandler := httpAdapter.NewBuilderHandler(builderService, lineService, teamService)
	allowedWSOrigins := parseAllowedOrigins(cfg.FrontendURL)
	wsBuilderHandler := httpAdapter.NewWSBuilderHandler(builderService, allowedWSOrigins)
	wsExecutionHandler := httpAdapter.NewWSExecutionHandler(builderService, allowedWSOrigins)
	authHandler := httpAdapter.NewAuthHandler(authService, cfg.CookieSecure, cfg.CookieDomain)
	userHandler := httpAdapter.NewUserHandler(userService, authService)
	uploadHandler := httpAdapter.NewUploadAdapter(uploadService)
	embeddingHandler := httpAdapter.NewEmbeddingHandler(embeddingService)
	evaluationHandler := httpAdapter.NewEvaluationHandler(evaluationService)
	sessionHandler := httpAdapter.NewSessionHandler(builderService)
	teamHandler := httpAdapter.NewTeamHandler(teamService)
	statsHandler := httpAdapter.NewStatsHandler(tokenUsageRepo)
	issueHandler := httpAdapter.NewIssueHandler(issueService)
	openRouterModelHandler := httpAdapter.NewOpenRouterModelHandler(openRouterModelService)

	r := gin.Default()
	if err := r.SetTrustedProxies(nil); err != nil {
		panic(err)
	}

	r.Use(cors.New(cors.Config{
		AllowOrigins:     parseAllowedOrigins(cfg.FrontendURL),
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "ngrok-skip-browser-warning", "Authorization", "X-Request-ID", "Access-Control-Allow-Origin", "Upgrade", "Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Extensions", "Connection"},
		AllowCredentials: true,
		ExposeHeaders:    []string{"content-disposition", "X-Request-ID"},
	}))

	r.Use(hstsMiddleware())
	r.Use(gin.Recovery())

	authMiddleware := httpAdapter.AuthMiddleware(authService, cfg.JWTSecret, cfg.JWTIssuer, cfg.JWTAudience)
	adminMiddleware := httpAdapter.AdminOnly(authService)

	// Rate limiters (Redis-backed via Repository)
	authRateLimiter := httpAdapter.DefaultAuthRateLimiter(redisRepo) // 5 req/min
	apiRateLimiter := httpAdapter.DefaultAPIRateLimiter(redisRepo)   // 120 req/min

	api := r.Group("/api")
	registerRoutes(api, builderHandler, wsBuilderHandler, wsExecutionHandler, authHandler, userHandler, uploadHandler, embeddingHandler, evaluationHandler, sessionHandler, teamHandler, lineHandler, statsHandler, issueHandler, openRouterModelHandler, authMiddleware, adminMiddleware, authRateLimiter, apiRateLimiter)

	// Setup your routes here
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status": "ok",
		})
	})

	return r
}

func hstsMiddleware() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		ctx.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
		ctx.Next()
	}
}

func parseAllowedOrigins(raw string) []string {
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		origin := strings.TrimSpace(part)
		if origin == "" {
			continue
		}
		if _, ok := seen[origin]; ok {
			continue
		}
		seen[origin] = struct{}{}
		origins = append(origins, origin)
	}
	return origins
}

func registerRoutes(api *gin.RouterGroup, builderHandler *httpAdapter.BuilderHandler, wsBuilderHandler *httpAdapter.WSBuilderHandler, wsExecutionHandler *httpAdapter.WSExecutionHandler, authHandler *httpAdapter.AuthHandler, userHandler *httpAdapter.UserHandler, uploadHandler *httpAdapter.UploadAdapter, embeddingHandler *httpAdapter.EmbeddingHandler, evaluationHandler *httpAdapter.EvaluationHandler, sessionHandler *httpAdapter.SessionHandler, teamHandler *httpAdapter.TeamHandler, lineHandler *httpAdapter.LineHandler, statsHandler *httpAdapter.StatsHandler, issueHandler *httpAdapter.IssueHandler, openRouterModelHandler *httpAdapter.OpenRouterModelHandler, authMiddleware gin.HandlerFunc, adminMiddleware gin.HandlerFunc, authRateLimiter *httpAdapter.UserRateLimiter, apiRateLimiter *httpAdapter.UserRateLimiter) {
	// Apply API rate limiting to all routes
	api.Use(httpAdapter.UserRateLimitMiddleware(apiRateLimiter))

	BuilderRouter(api, builderHandler, wsBuilderHandler, wsExecutionHandler, authMiddleware)
	AuthRouter(api, authHandler, authMiddleware, authRateLimiter) // Pass auth rate limiter
	UploadRouter(api, uploadHandler, authMiddleware)
	EmbeddingRouter(api, embeddingHandler, authMiddleware)
	EvaluationRouter(api, evaluationHandler, authMiddleware)
	SessionRouter(api, sessionHandler, authMiddleware)
	TeamRouter(api, teamHandler, lineHandler, authMiddleware)
	StatsRouter(api, statsHandler, authMiddleware)
	IssueRouter(api, issueHandler, authMiddleware, adminMiddleware)

	api.POST("/webhooks/line", lineHandler.Webhook)

	// Admin Routes
	userGroup := api.Group("/users")
	userGroup.Use(authMiddleware)

	// ChangePassword (doesn't require admin)
	userGroup.POST("/change-password", userHandler.ChangePassword)

	// Admin Routes
	userGroup.Use(adminMiddleware)
	userGroup.GET("", userHandler.GetAllUsers)
	userGroup.POST("", userHandler.CreateUser)
	userGroup.DELETE("/:id", userHandler.DeleteUser)
	userGroup.POST("/:id/reset", userHandler.ForcePasswordReset)

	openRouterModelGroup := api.Group("/openrouter-models")
	openRouterModelGroup.Use(authMiddleware)
	openRouterModelGroup.Use(adminMiddleware)
	OpenRouterModelRouter(openRouterModelGroup, openRouterModelHandler)

	builderModelGroup := api.Group("/builder-models")
	builderModelGroup.Use(authMiddleware)
	builderModelGroup.GET("", openRouterModelHandler.ListActive)
}
