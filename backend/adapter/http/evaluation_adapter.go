package adapter

import (
	"capstone-prog/core/data/request"
	"capstone-prog/core/data/response"
	"capstone-prog/core/model"
	"capstone-prog/core/service"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Helper function to get minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// SSE event types for evaluation streaming
type EvaluationSSEEvent struct {
	Type string      `json:"type"` // "status_update" | "completed" | "failed" | "error"
	Data interface{} `json:"data"`
	Time string      `json:"time"`
}

type EvaluationStatusData struct {
	ID             uuid.UUID `json:"id"`
	ReferenceID    uuid.UUID `json:"reference_id"`
	Status         string    `json:"status"`
	OverallScore   float64   `json:"overall_score"`
	ErrorMessage   string    `json:"error_message,omitempty"`
	TestCasesCount int       `json:"test_cases_count"`
	UpdatedAt      string    `json:"updated_at"`
}

type EvaluationHandler struct {
	evaluationService service.EvaluationService
}

func requestIDFromContext(c *gin.Context) string {
	requestID := strings.TrimSpace(c.Query("request_id"))
	if requestID == "" {
		requestID = strings.TrimSpace(c.GetHeader("X-Request-ID"))
	}
	if requestID == "" {
		requestID = uuid.NewString()
	}
	return requestID
}

func NewEvaluationHandler(evaluationService service.EvaluationService) *EvaluationHandler {
	return &EvaluationHandler{evaluationService: evaluationService}
}

func (h *EvaluationHandler) TriggerEvaluation(c *gin.Context) {
	requestID := requestIDFromContext(c)
	c.Header("X-Request-ID", requestID)
	ctx := service.ContextWithRequestID(c.Request.Context(), requestID)

	var req request.CreateEvaluationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	referenceID, err := uuid.Parse(req.ReferenceID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	eval, err := h.evaluationService.TriggerEvaluation(ctx, referenceID, userID.(uuid.UUID))
	if err != nil || eval == nil {
		if err != nil {
			slog.Error("TriggerEvaluation failed", "request_id", requestID, "reference_id", referenceID, "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		} else {
			slog.Error("TriggerEvaluation returned nil evaluation", "request_id", requestID, "reference_id", referenceID)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to trigger evaluation"})
		}
		return
	}

	c.JSON(http.StatusAccepted, response.EvaluationResponse{
		ID:           eval.ID,
		ReferenceID:  eval.ReferenceID,
		OverallScore: eval.OverallScore,
		Status:       eval.Status,
		CreatedAt:    eval.CreatedAt.Format("2006-01-02T15:04:05Z"),
	})
}

func (h *EvaluationHandler) GetEvaluation(c *gin.Context) {
	requestID := requestIDFromContext(c)
	c.Header("X-Request-ID", requestID)
	ctx := service.ContextWithRequestID(c.Request.Context(), requestID)

	referenceID := c.Query("reference_id")
	if referenceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reference_id query param required"})
		return
	}

	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	refUUID, err := uuid.Parse(referenceID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	eval, err := h.evaluationService.GetEvaluation(ctx, refUUID, userID.(uuid.UUID))
	if err != nil || eval == nil {
		hasEmbeddings, hasEmbeddingsErr := h.evaluationService.HasEmbeddings(ctx, refUUID, userID.(uuid.UUID))
		if hasEmbeddingsErr != nil {
			slog.Error("Failed to check embeddings while loading evaluation", "request_id", requestID, "reference_id", refUUID, "error", hasEmbeddingsErr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check embeddings"})
			return
		}

		if !hasEmbeddings {
			c.JSON(http.StatusNotFound, gin.H{"error": "no evaluation found"})
			return
		}

		slog.Info("No evaluation found but embeddings exist; triggering evaluation", "request_id", requestID, "reference_id", refUUID)
		triggeredEval, triggerErr := h.evaluationService.TriggerEvaluation(ctx, refUUID, userID.(uuid.UUID))
		if triggerErr != nil || triggeredEval == nil {
			slog.Error("Failed to auto-trigger evaluation on GET", "request_id", requestID, "reference_id", refUUID, "error", triggerErr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to trigger evaluation"})
			return
		}

		eval = triggeredEval
	}

	// Parse metrics from JSONB
	var metrics []response.MetricResult
	if len(eval.Metrics) > 0 {
		slog.Info("Retrieved evaluation with metrics",
			"evaluation_id", eval.ID,
			"metrics_size", len(eval.Metrics),
			"raw_metrics_preview", string(eval.Metrics)[:min(200, len(eval.Metrics))])

		if err := json.Unmarshal(eval.Metrics, &metrics); err != nil {
			// If Metrics is just a default empty object "{}", we can silence the error
			// as it's common during pending/running status.
			if string(eval.Metrics) != "{}" {
				slog.Error("Failed to unmarshal metrics", "error", err, "raw_metrics", string(eval.Metrics))
			}
			metrics = []response.MetricResult{}
		} else if len(metrics) > 0 {
			slog.Info("Metrics unmarshaled successfully",
				"count", len(metrics),
				"first_metric", metrics[0].MetricName,
				"first_score", metrics[0].Score,
				"first_passed", metrics[0].Passed)
		}
	} else {
		slog.Info("Evaluation has no metrics", "evaluation_id", eval.ID, "status", eval.Status)
	}

	c.JSON(http.StatusOK, response.EvaluationResponse{
		ID:             eval.ID,
		ReferenceID:    eval.ReferenceID,
		OverallScore:   eval.OverallScore,
		Metrics:        metrics,
		Status:         eval.Status,
		ErrorMessage:   eval.ErrorMessage,
		TestCasesCount: eval.TestCasesCount,
		CreatedAt:      eval.CreatedAt.Format("2006-01-02T15:04:05Z"),
	})
}

// StreamEvaluation handles SSE connections for real-time evaluation updates
func (h *EvaluationHandler) StreamEvaluation(c *gin.Context) {
	requestID := requestIDFromContext(c)
	c.Header("X-Request-ID", requestID)
	ctx := service.ContextWithRequestID(c.Request.Context(), requestID)

	// Get reference_id from path parameter
	referenceIDStr := c.Param("id")
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	referenceID, err := uuid.Parse(referenceIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	// Check if embeddings exist first - if not, return immediately with clear error
	hasEmbeddings, err := h.evaluationService.HasEmbeddings(ctx, referenceID, userID.(uuid.UUID))
	if err != nil {
		slog.Error("Failed to check embeddings", "request_id", requestID, "reference_id", referenceID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check embeddings"})
		return
	}
	if !hasEmbeddings {
		slog.Info("No embeddings found for evaluation stream", "request_id", requestID, "reference_id", referenceID)
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "no embeddings found",
			"reason":  "embeddings_required",
			"message": "Please embed documents before running evaluation",
		})
		return
	}

	// Get the latest evaluation for this reference — retry for up to 5 seconds to handle race condition
	var eval *model.Evaluation
	for i := 0; i < 10; i++ {
		eval, err = h.evaluationService.GetEvaluation(ctx, referenceID, userID.(uuid.UUID))
		if err == nil && eval != nil {
			break
		}
		// Check if embeddings still exist before retrying
		if i > 0 {
			hasEmbeddings, _ = h.evaluationService.HasEmbeddings(ctx, referenceID, userID.(uuid.UUID))
			if !hasEmbeddings {
				slog.Info("Embeddings removed during evaluation wait", "request_id", requestID, "reference_id", referenceID)
				c.JSON(http.StatusNotFound, gin.H{"error": "embeddings no longer available"})
				return
			}
		}
		slog.Info("Evaluation not found, retrying...", "request_id", requestID, "reference_id", referenceID, "retry", i+1)
		time.Sleep(500 * time.Millisecond)
	}

	if err != nil || eval == nil {
		// Embeddings exist but no evaluation record yet.
		// Recover by triggering evaluation from this stream endpoint so the UI does not dead-end.
		slog.Warn("No evaluation found despite embeddings existing; triggering evaluation", "request_id", requestID, "reference_id", referenceID)

		triggeredEval, triggerErr := h.evaluationService.TriggerEvaluation(ctx, referenceID, userID.(uuid.UUID))
		if triggerErr != nil || triggeredEval == nil {
			slog.Error("Failed to trigger evaluation from stream endpoint", "request_id", requestID, "reference_id", referenceID, "error", triggerErr)
			c.JSON(http.StatusNotFound, gin.H{
				"error":   "no evaluation found",
				"reason":  "evaluation_not_triggered",
				"message": "Embeddings exist but evaluation could not be started automatically.",
			})
			return
		}

		eval = triggeredEval
		slog.Info("Evaluation triggered from stream endpoint", "request_id", requestID, "reference_id", referenceID, "evaluation_id", eval.ID)
	}

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no") // Disable nginx buffering

	// Send initial connection event
	h.sendSSEEvent(c, "connected", EvaluationStatusData{
		ID:             eval.ID,
		ReferenceID:    eval.ReferenceID,
		Status:         eval.Status,
		OverallScore:   eval.OverallScore,
		ErrorMessage:   eval.ErrorMessage,
		TestCasesCount: eval.TestCasesCount,
		UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
	})

	if eval.Status == "pending" || eval.Status == "running" {
		h.sendSSEEvent(c, "evaluation_started", EvaluationStatusData{
			ID:             eval.ID,
			ReferenceID:    eval.ReferenceID,
			Status:         eval.Status,
			OverallScore:   eval.OverallScore,
			ErrorMessage:   eval.ErrorMessage,
			TestCasesCount: eval.TestCasesCount,
			UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
		})
	}

	// If already completed/failed, send final event and close
	if eval.Status == "completed" || eval.Status == "failed" {
		eventType := "completed"
		if eval.Status == "failed" {
			eventType = "failed"
		}
		h.sendSSEEvent(c, eventType, EvaluationStatusData{
			ID:             eval.ID,
			ReferenceID:    eval.ReferenceID,
			Status:         eval.Status,
			OverallScore:   eval.OverallScore,
			ErrorMessage:   eval.ErrorMessage,
			TestCasesCount: eval.TestCasesCount,
			UpdatedAt:      eval.UpdatedAt.UTC().Format(time.RFC3339),
		})
		return
	}

	// Poll for status changes and stream updates
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.Request.Context().Done():
			slog.Info("SSE client disconnected", "request_id", requestID, "reference_id", referenceID)
			return
		case <-ticker.C:
			currentEval, err := h.evaluationService.GetEvaluation(ctx, referenceID, userID.(uuid.UUID))
			if err != nil || currentEval == nil {
				h.sendSSEEvent(c, "error", gin.H{"message": "failed to fetch evaluation status"})
				return
			}

			// Send status update
			h.sendSSEEvent(c, "status_update", EvaluationStatusData{
				ID:             currentEval.ID,
				ReferenceID:    currentEval.ReferenceID,
				Status:         currentEval.Status,
				OverallScore:   currentEval.OverallScore,
				ErrorMessage:   currentEval.ErrorMessage,
				TestCasesCount: currentEval.TestCasesCount,
				UpdatedAt:      currentEval.UpdatedAt.UTC().Format(time.RFC3339),
			})

			// If evaluation is complete or failed, send final event and close
			if currentEval.Status == "completed" {
				h.sendSSEEvent(c, "completed", EvaluationStatusData{
					ID:             currentEval.ID,
					ReferenceID:    currentEval.ReferenceID,
					Status:         currentEval.Status,
					OverallScore:   currentEval.OverallScore,
					ErrorMessage:   currentEval.ErrorMessage,
					TestCasesCount: currentEval.TestCasesCount,
					UpdatedAt:      currentEval.UpdatedAt.UTC().Format(time.RFC3339),
				})
				return
			} else if currentEval.Status == "failed" {
				h.sendSSEEvent(c, "failed", EvaluationStatusData{
					ID:             currentEval.ID,
					ReferenceID:    currentEval.ReferenceID,
					Status:         currentEval.Status,
					OverallScore:   currentEval.OverallScore,
					ErrorMessage:   currentEval.ErrorMessage,
					TestCasesCount: currentEval.TestCasesCount,
					UpdatedAt:      currentEval.UpdatedAt.UTC().Format(time.RFC3339),
				})
				return
			}
		}
	}
}

// sendSSEEvent writes an SSE event to the response
func (h *EvaluationHandler) sendSSEEvent(c *gin.Context, eventType string, data interface{}) {
	event := EvaluationSSEEvent{
		Type: eventType,
		Data: data,
		Time: time.Now().UTC().Format(time.RFC3339),
	}

	jsonData, err := json.Marshal(event)
	if err != nil {
		slog.Error("Failed to marshal SSE event", "error", err)
		return
	}

	// SSE format: data: {json}\n\n
	_, err = fmt.Fprintf(c.Writer, "data: %s\n\n", jsonData)
	if err != nil {
		slog.Error("Failed to write SSE event", "error", err)
		return
	}
	c.Writer.Flush()
}

// parseEvaluationID extracts and validates the evaluation ID from the URL path
func parseEvaluationID(c *gin.Context) (uuid.UUID, bool) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid evaluation id"})
		return uuid.Nil, false
	}
	return id, true
}
