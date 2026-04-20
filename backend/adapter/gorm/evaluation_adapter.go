package gorm

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type EvaluationRepository struct {
	db *gorm.DB
}

func NewEvaluationRepository(db *gorm.DB) repository.EvaluationRepository {
	return &EvaluationRepository{db: db}
}

func (r *EvaluationRepository) Create(ctx context.Context, evaluation *model.Evaluation) error {
	return r.db.WithContext(ctx).Create(evaluation).Error
}

func (r *EvaluationRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.Evaluation, error) {
	var eval model.Evaluation
	err := r.db.WithContext(ctx).First(&eval, id).Error
	return &eval, err
}

func (r *EvaluationRepository) FindByReferenceIDAndUserID(ctx context.Context, referenceID, userID uuid.UUID) (*model.Evaluation, error) {
	var eval model.Evaluation
	err := r.db.WithContext(ctx).
		Where("reference_id = ? AND user_id = ?", referenceID, userID).
		Order("created_at DESC").
		First(&eval).Error
	return &eval, err
}

func (r *EvaluationRepository) UpdateStatus(ctx context.Context, id uuid.UUID, status string, score float64, metrics []byte, errorMsg string, testCasesCount int) error {
	updateData := map[string]interface{}{
		"status":           status,
		"overall_score":    score,
		"error_message":    errorMsg,
		"test_cases_count": testCasesCount,
	}
	
	// Only update metrics if provided and non-empty
	if metrics != nil && len(metrics) > 0 {
		// Validate that metrics is valid JSON before storing
		var testJSON interface{}
		if err := json.Unmarshal(metrics, &testJSON); err != nil {
			slog.Error("Invalid metrics JSON", "error", err, "metrics", string(metrics))
			return fmt.Errorf("invalid metrics JSON: %w", err)
		}
		updateData["metrics"] = metrics
		slog.Info("Updating evaluation with metrics", "id", id, "metrics_len", len(metrics))
	} else {
		slog.Info("UpdateStatus called with empty metrics", "id", id, "status", status)
	}
	
	return r.db.WithContext(ctx).Model(&model.Evaluation{}).
		Where("id = ?", id).
		Updates(updateData).Error
}
