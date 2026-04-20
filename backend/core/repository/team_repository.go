package repository

import (
	"capstone-prog/core/model"
	"context"

	"github.com/google/uuid"
)

type TeamRepository interface {
	CreateTeam(ctx context.Context, team *model.Team) error
	ListTeams(ctx context.Context, userID uuid.UUID) ([]*model.Team, error)
	GetTeam(ctx context.Context, id, userID uuid.UUID) (*model.Team, error)
	UpdateTeam(ctx context.Context, team *model.Team) error
	DeleteTeam(ctx context.Context, id uuid.UUID) error
	AssignSessionToTeam(ctx context.Context, teamID uuid.UUID, sessionID string) error
	UnassignSession(ctx context.Context, sessionID string) error
}
