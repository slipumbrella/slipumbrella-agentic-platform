package main

import (
	gorm_adapter "capstone-prog/adapter/gorm"
	"capstone-prog/config"
	"capstone-prog/core/service"
	"capstone-prog/router"
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func main() {
	cfg := config.LoadConfig()
	db := config.ConnectDatabase(cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// init gprc client
	creds := insecure.NewCredentials()

	grpcConn, err := grpc.NewClient(cfg.GRPCHost+":"+cfg.GRPCPort, grpc.WithTransportCredentials(creds))
	if err != nil {
		slog.Error("Failed to connect to gRPC server", "error", err)
	}
	defer grpcConn.Close()

	services := router.SetupRouter(cfg, db, grpcConn)

	// Admin User Setup
	userRepo := gorm_adapter.NewUserRepository(db)
	// NOTE: redisRepo not needed here — authService in main is only used for admin bootstrap.
	authService := service.NewAuthService(userRepo, nil, cfg.JWTSecret, cfg.JWTIssuer, cfg.JWTAudience)

	ctxBg := context.Background()
	adminEmail := "admin@admin.com"
	adminUser, err := userRepo.FindByEmail(ctxBg, adminEmail)
	if err != nil {
		// Use ADMIN_INITIAL_PASSWORD env var if provided; otherwise generate a random one.
		adminPwd := cfg.AdminInitialPassword
		if adminPwd == "" {
			// Prepend "P1-" to satisfy password strength rules (uppercase + digit + lowercase from UUID).
			adminPwd = "P1-" + uuid.New().String()
		}
		slog.Info("Creating Admin User...")
		_, err := authService.Signup(ctxBg, "admin", adminEmail, adminPwd, "admin", true)
		if err != nil {
			slog.Error("Failed to create admin user", "error", err)
		} else {
			slog.Info("Admin user created — password reset required on first login", "email", adminEmail)
			if cfg.AdminInitialPassword == "" {
				slog.Warn("No ADMIN_INITIAL_PASSWORD set; a random password was generated — set it manually via /users/:id/reset", "email", adminEmail)
			}
		}
	} else {
		// Ensure Admin Role
		if adminUser.Role != "admin" {
			slog.Info("Updating existing Admin User role...")
			adminUser.Role = "admin"
			if err := userRepo.Update(ctxBg, adminUser); err != nil {
				slog.Error("Failed to update admin role", "error", err)
			} else {
				slog.Info("Admin role updated successfully")
			}
		}
	}

	server := &http.Server{
		Addr:           ":" + cfg.ServerPort,
		Handler:        services,
		ReadTimeout:    15 * time.Second,
		WriteTimeout:   1 * time.Minute,
		IdleTimeout:    1 * time.Minute,
		MaxHeaderBytes: 1 << 20,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt)
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("Failed to start server", "error", err)
			panic(err)
		}
	}()

	slog.Info("Starting server", "port", cfg.ServerPort)

	<-quit
	slog.Info("Shutting down server...")

	if err := server.Shutdown(ctx); err != nil {
		slog.Error("forced shutdown", "error", err)
	}

	slog.Info("Server exited gracefully")
}
