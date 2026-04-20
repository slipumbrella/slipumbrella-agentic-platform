package gorm

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"

	"github.com/google/uuid"
	pgvector "github.com/pgvector/pgvector-go"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type EmbeddingRepository struct {
	db *gorm.DB
}

func NewEmbeddingRepository(db *gorm.DB) repository.EmbeddingRepository {
	return &EmbeddingRepository{db: db}
}

func (r *EmbeddingRepository) Create(ctx context.Context, embedding *model.Embedding) error {
	return r.db.WithContext(ctx).Create(embedding).Error
}

func (r *EmbeddingRepository) CreateBatch(ctx context.Context, embeddings []*model.Embedding) error {
	if len(embeddings) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Create(embeddings).Error
}

func (r *EmbeddingRepository) FindByAttachmentID(ctx context.Context, attachmentID uuid.UUID) (*model.Embedding, error) {
	var embedding model.Embedding
	err := r.db.WithContext(ctx).Where("attachment_id = ?", attachmentID).First(&embedding).Error
	return &embedding, err
}

func (r *EmbeddingRepository) FindByFileKey(ctx context.Context, fileKey string) (*model.Embedding, error) {
	var embedding model.Embedding
	err := r.db.WithContext(ctx).Where("file_key = ?", fileKey).First(&embedding).Error
	return &embedding, err
}

func (r *EmbeddingRepository) FindByReferenceIDAndUserID(ctx context.Context, referenceID, userID uuid.UUID) ([]*model.Embedding, error) {
	var embeddings []*model.Embedding
	err := r.db.WithContext(ctx).
		Where("reference_id = ? AND user_id = ?", referenceID, userID).
		Find(&embeddings).Error
	return embeddings, err
}

func (r *EmbeddingRepository) Delete(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Delete(&model.Embedding{ID: id}).Error
}

func (r *EmbeddingRepository) DeleteByAttachmentID(ctx context.Context, attachmentID uuid.UUID) error {
	return r.db.WithContext(ctx).Where("attachment_id = ?", attachmentID).Delete(&model.Embedding{}).Error
}

func (r *EmbeddingRepository) Upsert(ctx context.Context, embedding *model.Embedding) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "attachment_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"content", "vector", "token_count", "model"}),
	}).Create(embedding).Error
}

func (r *EmbeddingRepository) SearchByVector(ctx context.Context, referenceID uuid.UUID, queryVector pgvector.Vector, topK int) ([]*model.Embedding, error) {
	var embeddings []*model.Embedding
	err := r.db.WithContext(ctx).Raw(
		`SELECT id, attachment_id, reference_id, user_id, file_key, content, token_count, model, created_at
		 FROM embeddings WHERE reference_id = ? ORDER BY vector <-> ? LIMIT ?`,
		referenceID, queryVector, topK,
	).Scan(&embeddings).Error
	return embeddings, err
}
