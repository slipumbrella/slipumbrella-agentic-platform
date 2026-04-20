package gorm

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type LineAdapter struct{ db *gorm.DB }

func NewLineRepository(db *gorm.DB) repository.LineRepository { return &LineAdapter{db: db} }

func (r *LineAdapter) SaveConfig(ctx context.Context, teamID uuid.UUID, accessToken, channelSecret string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.Team{}).Where("id = ?", teamID).
			Updates(map[string]any{"line_channel_access_token": accessToken, "line_channel_secret": channelSecret}).Error; err != nil {
			return err
		}
		// Propagate token to sessions.metadata for all sessions assigned to this team.
		patch := map[string]any{"line_channel_access_token": accessToken}
		b, _ := json.Marshal(patch)
		return tx.Exec(
			"UPDATE sessions SET metadata = metadata || ?::jsonb WHERE team_id = ?",
			string(b), teamID,
		).Error
	})
}

func (r *LineAdapter) GetConfig(ctx context.Context, teamID uuid.UUID) (*model.Team, error) {
	var team model.Team
	err := r.db.WithContext(ctx).Select("id", "line_channel_access_token", "line_channel_secret").
		Where("id = ?", teamID).First(&team).Error
	return &team, err
}

func (r *LineAdapter) DeleteConfig(ctx context.Context, teamID uuid.UUID) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.Team{}).Where("id = ?", teamID).
			Updates(map[string]any{"line_channel_access_token": nil, "line_channel_secret": nil}).Error; err != nil {
			return err
		}
		// Remove token from sessions.metadata for all sessions assigned to this team.
		return tx.Exec(
			"UPDATE sessions SET metadata = metadata - 'line_channel_access_token' WHERE team_id = ?",
			teamID,
		).Error
	})
}

func (r *LineAdapter) SaveMessage(ctx context.Context, msg *model.LineMessage) error {
	return r.db.WithContext(ctx).Create(msg).Error
}

func (r *LineAdapter) ListMessages(ctx context.Context, teamID uuid.UUID, limit int) ([]*model.LineMessage, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	var msgs []*model.LineMessage
	err := r.db.WithContext(ctx).Where("team_id = ?", teamID).Order("received_at DESC").Limit(limit).Find(&msgs).Error
	return msgs, err
}
