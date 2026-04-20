package repository

import (
	"capstone-prog/core/model"
	"context"

	"github.com/google/uuid"
)

type AgentSessionRepository interface {
	ListExecutionSessions(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error)
	ListUnassignedSessions(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error)
	GetLatestPlan(ctx context.Context, sessionID string) (*model.Plan, error)
	GetSession(ctx context.Context, sessionID string, userID uuid.UUID) (*model.AgentSession, error)
	GetLatestByPlanningSessionID(ctx context.Context, planningSessionID string, userID uuid.UUID) (*model.AgentSession, error)
	PatchMetadata(ctx context.Context, sessionID string, patch map[string]any) error
	SetSessionUserID(ctx context.Context, sessionID string, userID uuid.UUID) error
}
