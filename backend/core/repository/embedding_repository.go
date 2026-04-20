package repository

import (
	"capstone-prog/core/model"
	"context"

	"github.com/google/uuid"
	"github.com/pgvector/pgvector-go"
)

type EmbeddingRepository interface {
	Create(ctx context.Context, embedding *model.Embedding) error
	CreateBatch(ctx context.Context, embeddings []*model.Embedding) error
	FindByAttachmentID(ctx context.Context, attachmentID uuid.UUID) (*model.Embedding, error)
	FindByFileKey(ctx context.Context, fileKey string) (*model.Embedding, error)
	FindByReferenceIDAndUserID(ctx context.Context, referenceID, userID uuid.UUID) ([]*model.Embedding, error)
	Delete(ctx context.Context, id uuid.UUID) error
	DeleteByAttachmentID(ctx context.Context, attachmentID uuid.UUID) error
	Upsert(ctx context.Context, embedding *model.Embedding) error
	// SearchByVector returns the topK embeddings closest to queryVector for the given referenceID.
	SearchByVector(ctx context.Context, referenceID uuid.UUID, queryVector pgvector.Vector, topK int) ([]*model.Embedding, error)
}
