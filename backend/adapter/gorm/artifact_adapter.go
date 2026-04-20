package gorm

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ArtifactRepository struct {
	db *gorm.DB
}

func NewArtifactRepository(db *gorm.DB) repository.ArtifactRepository {
	return &ArtifactRepository{db: db}
}

func (r *ArtifactRepository) GetByTeam(ctx context.Context, teamID uuid.UUID) ([]model.Artifact, error) {
	var artifacts []model.Artifact
	err := r.db.WithContext(ctx).
		Where("team_id = ?", teamID).
		Order("created_at ASC").
		Find(&artifacts).Error
	return artifacts, err
}

func (r *ArtifactRepository) GetByID(ctx context.Context, id uuid.UUID) (*model.Artifact, error) {
	var artifact model.Artifact
	err := r.db.WithContext(ctx).First(&artifact, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &artifact, nil
}
