package repository

import (
	"capstone-prog/core/model"
	"context"

	"github.com/google/uuid"
)

type EvaluationRepository interface {
	Create(ctx context.Context, evaluation *model.Evaluation) error
	FindByID(ctx context.Context, id uuid.UUID) (*model.Evaluation, error)
	FindByReferenceIDAndUserID(ctx context.Context, referenceID, userID uuid.UUID) (*model.Evaluation, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status string, score float64, metrics []byte, errorMsg string, testCasesCount int) error
}
