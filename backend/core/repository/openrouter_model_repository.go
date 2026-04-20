package repository

import (
	"capstone-prog/core/model"
	"context"

	"github.com/google/uuid"
)

type OpenRouterModelRepository interface {
	ListAll(ctx context.Context) ([]*model.OpenRouterModel, error)
	ListActive(ctx context.Context) ([]*model.OpenRouterModel, error)
	GetByUUID(ctx context.Context, modelUUID uuid.UUID) (*model.OpenRouterModel, error)
	Create(ctx context.Context, item *model.OpenRouterModel) error
	Update(ctx context.Context, modelUUID uuid.UUID, item *model.OpenRouterModel) error
	Delete(ctx context.Context, modelUUID uuid.UUID) error
}
