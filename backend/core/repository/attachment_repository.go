package repository

import (
	"capstone-prog/core/model"
	"context"

	"github.com/google/uuid"
)

type AttachmentRepository interface {
	Create(ctx context.Context, attachment *model.Attachment) error
	FindByID(ctx context.Context, id uuid.UUID) (*model.Attachment, error)
	FindByFileKey(ctx context.Context, fileKey string) (*model.Attachment, error)
	FindByReferenceID(ctx context.Context, referenceID uuid.UUID) ([]*model.Attachment, error)
	MarkEmbedded(ctx context.Context, id uuid.UUID) error
	UpdateEmbeddingStatus(ctx context.Context, id uuid.UUID, status string) error
	Delete(ctx context.Context, id uuid.UUID) error
	DeleteBatch(ctx context.Context, ids []uuid.UUID) error
}