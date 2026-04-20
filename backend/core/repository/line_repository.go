package repository

import (
	"capstone-prog/core/model"
	"context"

	"github.com/google/uuid"
)

type LineRepository interface {
	SaveConfig(ctx context.Context, teamID uuid.UUID, accessToken, channelSecret string) error
	GetConfig(ctx context.Context, teamID uuid.UUID) (*model.Team, error)
	DeleteConfig(ctx context.Context, teamID uuid.UUID) error
	SaveMessage(ctx context.Context, msg *model.LineMessage) error
	ListMessages(ctx context.Context, teamID uuid.UUID, limit int) ([]*model.LineMessage, error)
}
