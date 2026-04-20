package service

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"capstone-prog/proto"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc/metadata"
	"gorm.io/gorm"
)

const r2CacheTTL = time.Hour

// Helper function to get minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

type EvaluationService interface {
	TriggerEvaluation(ctx context.Context, referenceID, userID uuid.UUID) (*model.Evaluation, error)
	GetEvaluation(ctx context.Context, referenceID, userID uuid.UUID) (*model.Evaluation, error)
	GetEvaluationByID(ctx context.Context, id, userID uuid.UUID) (*model.Evaluation, error)
	HasEmbeddings(ctx context.Context, referenceID, userID uuid.UUID) (bool, error)
}

type evaluationServiceImpl struct {
	evaluationRepo repository.EvaluationRepository
	embeddingRepo  repository.EmbeddingRepository
	r2Service      R2Service
	redisRepo      repository.RedisRepository
	agentClient    proto.CoreAgentClient
	sessionRepo    repository.AgentSessionRepository
	teamRepo       repository.TeamRepository
	chatRepo       repository.ChatRepository
	triggerLocks   sync.Map
}

func appendUniqueUUID(ids []uuid.UUID, seen map[uuid.UUID]struct{}, id uuid.UUID) []uuid.UUID {
	if _, ok := seen[id]; ok {
		return ids
	}
	seen[id] = struct{}{}
	return append(ids, id)
}

func (s *evaluationServiceImpl) relatedReferenceIDs(ctx context.Context, referenceID, userID uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{}, 3)
	ids := make([]uuid.UUID, 0, 3)
	ids = appendUniqueUUID(ids, seen, referenceID)

	// team -> related planning/execution sessions
	team, teamErr := s.teamRepo.GetTeam(ctx, referenceID, userID)
	if teamErr == nil && team != nil {
		for _, sess := range team.Sessions {
			if execID, parseErr := uuid.Parse(sess.SessionID); parseErr == nil {
				ids = appendUniqueUUID(ids, seen, execID)
			}
			if sess.PlanningSessionID != nil {
				if planningID, parseErr := uuid.Parse(*sess.PlanningSessionID); parseErr == nil {
					ids = appendUniqueUUID(ids, seen, planningID)
				}
			}
		}
	}
	if teamErr != nil && teamErr != gorm.ErrRecordNotFound {
		slog.Warn("failed to resolve team while collecting related references", "reference_id", referenceID, "user_id", userID, "error", teamErr)
	}

	// execution -> planning
	sess, sessErr := s.sessionRepo.GetSession(ctx, referenceID.String(), userID)
	if sessErr == nil && sess != nil && sess.PlanningSessionID != nil {
		if planningID, parseErr := uuid.Parse(*sess.PlanningSessionID); parseErr == nil {
			ids = appendUniqueUUID(ids, seen, planningID)
		}
	}
	if sessErr != nil && sessErr != gorm.ErrRecordNotFound {
		slog.Warn("failed to resolve session while collecting related references", "reference_id", referenceID, "user_id", userID, "error", sessErr)
	}

	// planning -> latest execution
	latestExec, latestExecErr := s.sessionRepo.GetLatestByPlanningSessionID(ctx, referenceID.String(), userID)
	if latestExecErr == nil && latestExec != nil {
		if execID, parseErr := uuid.Parse(latestExec.SessionID); parseErr == nil {
			ids = appendUniqueUUID(ids, seen, execID)
		}
	}
	if latestExecErr != nil && latestExecErr != gorm.ErrRecordNotFound {
		slog.Warn("failed to resolve latest execution while collecting related references", "reference_id", referenceID, "user_id", userID, "error", latestExecErr)
	}

	return ids
}

func evaluationLockKey(referenceID, userID uuid.UUID) string {
	return referenceID.String() + ":" + userID.String()
}

func (s *evaluationServiceImpl) getTriggerLock(referenceID, userID uuid.UUID) *sync.Mutex {
	key := evaluationLockKey(referenceID, userID)
	if lock, ok := s.triggerLocks.Load(key); ok {
		return lock.(*sync.Mutex)
	}
	newLock := &sync.Mutex{}
	actual, _ := s.triggerLocks.LoadOrStore(key, newLock)
	return actual.(*sync.Mutex)
}

func NewEvaluationService(
	evaluationRepo repository.EvaluationRepository,
	embeddingRepo repository.EmbeddingRepository,
	r2Service R2Service,
	redisRepo repository.RedisRepository,
	agentClient proto.CoreAgentClient,
	sessionRepo repository.AgentSessionRepository,
	teamRepo repository.TeamRepository,
	chatRepo repository.ChatRepository,
) EvaluationService {
	return &evaluationServiceImpl{
		evaluationRepo: evaluationRepo,
		embeddingRepo:  embeddingRepo,
		r2Service:      r2Service,
		redisRepo:      redisRepo,
		agentClient:    agentClient,
		sessionRepo:    sessionRepo,
		teamRepo:       teamRepo,
		chatRepo:       chatRepo,
	}
}

func (s *evaluationServiceImpl) TriggerEvaluation(ctx context.Context, referenceID, userID uuid.UUID) (*model.Evaluation, error) {
	requestID := RequestIDFromContext(ctx)

	lock := s.getTriggerLock(referenceID, userID)
	lock.Lock()
	defer lock.Unlock()

	latestEval, latestEvalErr := s.evaluationRepo.FindByReferenceIDAndUserID(ctx, referenceID, userID)
	if latestEvalErr == nil && latestEval != nil {
		status := strings.ToLower(latestEval.Status)
		if status == "pending" || status == "running" {
			slog.Info(
				"Reusing in-flight evaluation",
				"request_id", requestID,
				"evaluation_id", latestEval.ID,
				"reference_id", referenceID,
				"status", status,
			)
			return latestEval, nil
		}
	}

	// 1. Resolve source for embeddings from related references (current/planning/execution)
	var (
		embeddings      []*model.Embedding
		embeddingSource *uuid.UUID
		err             error
	)
	for _, candidateRef := range s.relatedReferenceIDs(ctx, referenceID, userID) {
		embeddings, err = s.embeddingRepo.FindByReferenceIDAndUserID(ctx, candidateRef, userID)
		if err != nil {
			return nil, fmt.Errorf("find embeddings for %s: %w", candidateRef, err)
		}
		if len(embeddings) > 0 {
			candidate := candidateRef
			embeddingSource = &candidate
			break
		}
	}

	if len(embeddings) == 0 {
		return nil, fmt.Errorf("no embedded documents found for reference or its parent: %s", referenceID)
	}
	if embeddingSource != nil && *embeddingSource != referenceID {
		slog.Info(
			"Using related reference embeddings for evaluation",
			"request_id", requestID,
			"evaluation_reference_id", referenceID,
			"embedding_source_reference_id", *embeddingSource,
		)
	}

	// 3. Create evaluation record with "pending" status under the target referenceID
	eval := &model.Evaluation{
		ID:          uuid.New(),
		ReferenceID: referenceID,
		UserID:      userID,
		Status:      "pending",
	}
	if err := s.evaluationRepo.Create(ctx, eval); err != nil {
		return nil, fmt.Errorf("create evaluation: %w", err)
	}

	// 4. Gather document contents — Redis cache-aside, fallback to R2
	var documents []*proto.DocumentContent
	for _, emb := range embeddings {
		cacheKey := "r2:content:" + emb.FileKey

		var content []byte
		cached, err := s.redisRepo.Get(ctx, cacheKey)
		if err != nil {
			slog.Warn("Redis get failed, falling back to R2", "file_key", emb.FileKey, "error", err)
		}

		if len(cached) > 0 {
			content = cached
			slog.Debug("R2 content served from cache", "file_key", emb.FileKey)
		} else {
			content, err = s.r2Service.Download(ctx, emb.FileKey)
			if err != nil {
				slog.Warn("Failed to download for evaluation", "file_key", emb.FileKey, "error", err)
				continue
			}
			if len(content) == 0 {
				continue
			}
			if setErr := s.redisRepo.Set(ctx, cacheKey, content, r2CacheTTL); setErr != nil {
				slog.Warn("Failed to cache R2 content", "file_key", emb.FileKey, "error", setErr)
			}
		}

		documents = append(documents, &proto.DocumentContent{
			FileKey:  emb.FileKey,
			Content:  string(content),
			FileName: emb.FileKey,
		})
	}

	if len(documents) == 0 {
		_ = s.evaluationRepo.UpdateStatus(ctx, eval.ID, "failed", 0, nil, "Could not download any documents", 0)
		eval.Status = "failed"
		eval.ErrorMessage = "Could not download any documents"
		return eval, nil
	}

	// 5. Sample documents if too many (avoid gRPC ResourceExhausted 4MB limit)
	// For 300+ documents, sending full content exceeds limits.
	// Sampling 5 random documents provides enough context for a quality score.
	const maxEvalDocs = 5
	if len(documents) > maxEvalDocs {
		slog.Info("Sampling documents for evaluation to avoid gRPC size limits", "total", len(documents), "sample", maxEvalDocs)

		// 1. Group by file to avoid sending 5 chunks of the same file
		uniqueFilesMap := make(map[string]*proto.DocumentContent)
		for _, doc := range documents {
			if _, ok := uniqueFilesMap[doc.FileName]; !ok {
				uniqueFilesMap[doc.FileName] = doc
			}
		}

		// 2. Convert to list and shuffle
		allDocs := make([]*proto.DocumentContent, 0, len(uniqueFilesMap))
		for _, v := range uniqueFilesMap {
			allDocs = append(allDocs, v)
		}

		r := rand.New(rand.NewSource(time.Now().UnixNano()))
		r.Shuffle(len(allDocs), func(i, j int) {
			allDocs[i], allDocs[j] = allDocs[j], allDocs[i]
		})

		// 3. Pick top 5
		if len(allDocs) > maxEvalDocs {
			documents = allDocs[:maxEvalDocs]
		} else {
			documents = allDocs
		}
	}

	// 6. Fire gRPC call in background goroutine
	evalID := eval.ID
	go func() {
		bgCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		bgCtx = ContextWithRequestID(bgCtx, requestID)

		_ = s.evaluationRepo.UpdateStatus(bgCtx, evalID, "running", 0, nil, "", 0)

		slog.Info(
			"Starting RAG evaluation",
			"request_id", requestID,
			"evaluation_id", evalID,
			"reference_id", referenceID,
			"documents", len(documents),
		)

		// Fetch session name from chat_sessions or teams
		sessionName := "Project Context"
		chatSess, err := s.chatRepo.GetSession(bgCtx, referenceID.String())
		if err == nil && chatSess != nil && chatSess.UserID == userID {
			sessionName = chatSess.Title
		} else {
			// Fallback to Team lookup if not a chat session
			team, tErr := s.teamRepo.GetTeam(bgCtx, referenceID, userID)
			if tErr == nil && team != nil {
				sessionName = team.Name
			}
		}

		req := &proto.EvaluateRAGRequest{
			ReferenceId:        referenceID.String(),
			UserId:             userID.String(),
			Documents:          documents,
			SessionName:        sessionName,
			SessionDescription: "",
			AgentRoles:         []string{},
		}

		grpcCtx := bgCtx
		if requestID != "" {
			grpcCtx = metadata.NewOutgoingContext(
				bgCtx,
				metadata.Pairs(
					"x-request-id", requestID,
					"x-evaluation-id", evalID.String(),
					"x-reference-id", referenceID.String(),
				),
			)
		}

		slog.Info("Sending EvaluateRAG request",
			"request_id", requestID,
			"evaluation_id", evalID,
			"reference_id", req.ReferenceId,
			"session_name", req.SessionName,
			"docs_count", len(req.Documents))

		resp, err := s.agentClient.EvaluateRAG(grpcCtx, req)

		if err != nil {
			slog.Error("EvaluateRAG gRPC failed", "request_id", requestID, "evaluation_id", evalID, "error", err)
			_ = s.evaluationRepo.UpdateStatus(bgCtx, evalID, "failed", 0, nil, err.Error(), 0)
			return
		}

		if resp.Status == "failed" {
			slog.Warn("EvaluateRAG returned failed", "request_id", requestID, "evaluation_id", evalID, "error", resp.ErrorMessage)
			_ = s.evaluationRepo.UpdateStatus(bgCtx, evalID, "failed", 0, nil, resp.ErrorMessage, 0)
			return
		}

		// Log gRPC response details before marshaling
		slog.Info("gRPC EvaluateRAG response received",
			"request_id", requestID,
			"evaluation_id", evalID,
			"status", resp.Status,
			"overall_score", resp.OverallScore,
			"metrics_count", len(resp.Metrics),
			"test_cases", resp.TestCasesCount)

		if len(resp.Metrics) == 0 {
			slog.Error("gRPC returned empty metrics array", "request_id", requestID, "evaluation_id", evalID)
			_ = s.evaluationRepo.UpdateStatus(bgCtx, evalID, "failed", 0, nil, "Empty metrics from evaluation engine", 0)
			return
		}

		// Marshal metrics to JSON for JSONB storage
		metricsJSON, marshalErr := json.Marshal(resp.Metrics)
		if marshalErr != nil {
			slog.Error("Failed to marshal metrics", "request_id", requestID, "evaluation_id", evalID, "error", marshalErr)
			_ = s.evaluationRepo.UpdateStatus(bgCtx, evalID, "failed", 0, nil, marshalErr.Error(), 0)
			return
		}

		// Log metrics details for debugging
		metricsStr := string(metricsJSON)
		slog.Info("Marshaling metrics",
			"request_id", requestID,
			"evaluation_id", evalID,
			"metrics_count", len(resp.Metrics),
			"first_metric_name", resp.Metrics[0].MetricName,
			"first_metric_score", resp.Metrics[0].Score,
			"first_metric_passed", resp.Metrics[0].Passed,
			"metrics_json", metricsStr[:min(200, len(metricsStr))]) // Log first 200 chars

		slog.Info("Calling UpdateStatus", "request_id", requestID, "evaluation_id", evalID, "metricsJSON_len", len(metricsJSON))
		updateErr := s.evaluationRepo.UpdateStatus(bgCtx, evalID, "completed", resp.OverallScore, metricsJSON, "", int(resp.TestCasesCount))
		if updateErr != nil {
			slog.Error("Failed to update evaluation status", "request_id", requestID, "evaluation_id", evalID, "error", updateErr)
		} else {
			slog.Info("UpdateStatus succeeded", "request_id", requestID, "evaluation_id", evalID)
		}
		slog.Info("RAG evaluation completed and stored",
			"request_id", requestID,
			"evaluation_id", evalID,
			"score", resp.OverallScore,
			"metrics_count", len(resp.Metrics),
			"test_cases", resp.TestCasesCount)
	}()

	return eval, nil
}

func (s *evaluationServiceImpl) GetEvaluation(ctx context.Context, referenceID, userID uuid.UUID) (*model.Evaluation, error) {
	var newest *model.Evaluation
	for _, candidateRef := range s.relatedReferenceIDs(ctx, referenceID, userID) {
		eval, err := s.evaluationRepo.FindByReferenceIDAndUserID(ctx, candidateRef, userID)
		if err != nil || eval == nil {
			continue
		}
		if newest == nil || eval.CreatedAt.After(newest.CreatedAt) {
			newest = eval
		}
	}
	if newest != nil {
		return newest, nil
	}

	return nil, gorm.ErrRecordNotFound
}

func (s *evaluationServiceImpl) GetEvaluationByID(ctx context.Context, id, userID uuid.UUID) (*model.Evaluation, error) {
	eval, err := s.evaluationRepo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	// Verify ownership
	if eval.UserID != userID {
		return nil, fmt.Errorf("evaluation not found")
	}
	return eval, nil
}

func (s *evaluationServiceImpl) HasEmbeddings(ctx context.Context, referenceID, userID uuid.UUID) (bool, error) {
	for _, candidateRef := range s.relatedReferenceIDs(ctx, referenceID, userID) {
		embeddings, err := s.embeddingRepo.FindByReferenceIDAndUserID(ctx, candidateRef, userID)
		if err != nil {
			return false, err
		}
		if len(embeddings) > 0 {
			return true, nil
		}
	}

	return false, nil
}
