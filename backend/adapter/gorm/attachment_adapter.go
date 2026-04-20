package gorm

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type AttachmentRepository struct {
	db *gorm.DB
}

func NewAttachmentRepository(db *gorm.DB) repository.AttachmentRepository {
	return &AttachmentRepository{db: db}
}

func (r *AttachmentRepository) Create(ctx context.Context, attachment *model.Attachment) error {
	return r.db.WithContext(ctx).Create(attachment).Error
}

func (r *AttachmentRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.Attachment, error) {
	var attachment model.Attachment
	err := r.db.WithContext(ctx).First(&attachment, id).Error
	return &attachment, err
}

func (r *AttachmentRepository) FindByFileKey(ctx context.Context, fileKey string) (*model.Attachment, error) {
	var attachment model.Attachment
	err := r.db.WithContext(ctx).Where("file_key = ?", fileKey).First(&attachment).Error
	return &attachment, err
}

func (r *AttachmentRepository) FindByReferenceID(ctx context.Context, referenceID uuid.UUID) ([]*model.Attachment, error) {
	var attachments []*model.Attachment
	err := r.db.WithContext(ctx).Where("reference_id = ?", referenceID).Find(&attachments).Error
	return attachments, err
}

func (r *AttachmentRepository) MarkEmbedded(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Model(&model.Attachment{}).Where("id = ?", id).Update("is_embedded", true).Error
}

func (r *AttachmentRepository) UpdateEmbeddingStatus(ctx context.Context, id uuid.UUID, status string) error {
	return r.db.WithContext(ctx).Model(&model.Attachment{}).Where("id = ?", id).Update("embedding_status", status).Error
}

func (r *AttachmentRepository) Delete(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Delete(&model.Attachment{ID: id}).Error
}

func (r *AttachmentRepository) DeleteBatch(ctx context.Context, ids []uuid.UUID) error {
	return r.db.WithContext(ctx).Delete(&model.Attachment{}, ids).Error
}
