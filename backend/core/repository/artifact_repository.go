package repository

import (
	"capstone-prog/core/model"
	"context"

	"github.com/google/uuid"
)

type ArtifactRepository interface {
	GetByTeam(ctx context.Context, teamID uuid.UUID) ([]model.Artifact, error)
	GetByID(ctx context.Context, id uuid.UUID) (*model.Artifact, error)
}
