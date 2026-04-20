package gorm

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type TeamRepository struct {
	db *gorm.DB
}

func NewTeamRepository(db *gorm.DB) repository.TeamRepository {
	return &TeamRepository{db: db}
}

func (r *TeamRepository) CreateTeam(ctx context.Context, team *model.Team) error {
	return r.db.WithContext(ctx).Create(team).Error
}

func (r *TeamRepository) ListTeams(ctx context.Context, userID uuid.UUID) ([]*model.Team, error) {
	var teams []*model.Team
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Preload("Sessions", "planning_session_id IS NOT NULL", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at DESC")
		}).
		Preload("Sessions.Plans", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at DESC")
		}).
		Preload("Sessions.Plans.Agents").
		Order("created_at DESC").
		Find(&teams).Error
	return teams, err
}

func (r *TeamRepository) GetTeam(ctx context.Context, id, userID uuid.UUID) (*model.Team, error) {
	var team model.Team
	query := r.db.WithContext(ctx).
		Preload("Sessions", "planning_session_id IS NOT NULL", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at DESC")
		}).
		Preload("Sessions.Plans", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at DESC")
		}).
		Preload("Sessions.Plans.Agents")
	if userID != uuid.Nil {
		query = query.Where("id = ? AND user_id = ?", id, userID)
	} else {
		query = query.Where("id = ?", id)
	}
	err := query.First(&team).Error
	if err != nil {
		return nil, err
	}
	return &team, nil
}

func (r *TeamRepository) UpdateTeam(ctx context.Context, team *model.Team) error {
	return r.db.WithContext(ctx).Model(team).Updates(map[string]any{
		"name":        team.Name,
		"description": team.Description,
	}).Error
}

func (r *TeamRepository) DeleteTeam(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// First, remove team-related keys from sessions.metadata for all sessions assigned to this team.
		if err := tx.Exec(
			"UPDATE sessions SET metadata = metadata - 'team_id' - 'line_channel_access_token' WHERE team_id = ?",
			id,
		).Error; err != nil {
			return err
		}

		// Unassign all sessions from this team (SET NULL, not cascade delete)
		if err := tx.Model(&model.AgentSession{}).
			Where("team_id = ?", id).
			Update("team_id", nil).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&model.Team{}).Error
	})
}

func (r *TeamRepository) AssignSessionToTeam(ctx context.Context, teamID uuid.UUID, sessionID string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := tx.NowFunc()
		if err := tx.Model(&model.SessionTeamAssignment{}).
			Where("session_id = ? AND revoked_at IS NULL", sessionID).
			Update("revoked_at", now).Error; err != nil {
			return err
		}

		assignment := &model.SessionTeamAssignment{
			SessionID:  sessionID,
			TeamID:     teamID,
			AssignedAt: now,
		}
		if err := tx.Create(assignment).Error; err != nil {
			return err
		}

		// Update the FK column.
		result := tx.Model(&model.AgentSession{}).
			Where("session_id = ?", sessionID).
			Update("team_id", teamID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("session not found or already assigned")
		}

		// Merge team_id and LINE token into sessions.metadata so Python tools can read them.
		var team model.Team
		if err := tx.Select("id, line_channel_access_token").
			Where("id = ?", teamID).First(&team).Error; err != nil {
			return err
		}
		patch := map[string]any{"team_id": teamID.String()}
		if team.LineChannelAccessToken != nil {
			patch["line_channel_access_token"] = *team.LineChannelAccessToken
		}
		b, _ := json.Marshal(patch)
		return tx.Exec(
			"UPDATE sessions SET metadata = metadata || ?::jsonb WHERE session_id = ?",
			string(b), sessionID,
		).Error
	})
}

func (r *TeamRepository) UnassignSession(ctx context.Context, sessionID string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := tx.NowFunc()
		if err := tx.Model(&model.SessionTeamAssignment{}).
			Where("session_id = ? AND revoked_at IS NULL", sessionID).
			Update("revoked_at", now).Error; err != nil {
			return err
		}

		if err := tx.Model(&model.AgentSession{}).
			Where("session_id = ?", sessionID).
			Update("team_id", nil).Error; err != nil {
			return err
		}
		// Remove team-related keys from sessions.metadata.
		return tx.Exec(
			"UPDATE sessions SET metadata = metadata - 'team_id' - 'line_channel_access_token' WHERE session_id = ?",
			sessionID,
		).Error
	})
}
