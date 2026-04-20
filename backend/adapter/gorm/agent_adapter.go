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

func preloadOrderedPlans(tx *gorm.DB) *gorm.DB {
	return tx.Order("created_at DESC")
}

func preloadOrderedAgents(tx *gorm.DB) *gorm.DB {
	return tx.Order("order_index ASC, id ASC")
}

type AgentSessionRepository struct {
	db *gorm.DB
}

func NewAgentSessionRepository(db *gorm.DB) repository.AgentSessionRepository {
	return &AgentSessionRepository{db: db}
}

// ListExecutionSessions returns execution sessions owned by the given user.
// It joins with chat_sessions to enforce ownership via the planning_session_id FK.
func (r *AgentSessionRepository) ListExecutionSessions(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error) {
	var sessions []*model.AgentSession
	err := r.db.WithContext(ctx).
		Joins("JOIN chat_sessions ON chat_sessions.id::text = sessions.planning_session_id").
		Where("sessions.planning_session_id IS NOT NULL AND chat_sessions.user_id = ?", userID).
		Preload("Plans", preloadOrderedPlans).
		Preload("Plans.Agents", preloadOrderedAgents).
		Preload("Team").
		Order("sessions.created_at DESC").
		Find(&sessions).Error
	return sessions, err
}

// ListUnassignedSessions returns execution sessions that are not assigned to any team, owned by the given user.
func (r *AgentSessionRepository) ListUnassignedSessions(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error) {
	var sessions []*model.AgentSession
	err := r.db.WithContext(ctx).
		Where("planning_session_id IS NOT NULL AND team_id IS NULL AND user_id = ?", userID).
		Preload("Plans.Agents").
		Order("created_at DESC").
		Find(&sessions).Error
	return sessions, err
}

// SetSessionUserID stamps the user_id column on a session created by the Python agent service.
func (r *AgentSessionRepository) SetSessionUserID(ctx context.Context, sessionID string, userID uuid.UUID) error {
	return r.db.WithContext(ctx).
		Model(&model.AgentSession{}).
		Where("session_id = ?", sessionID).
		Update("user_id", userID).Error
}

// GetLatestPlan returns the most-recent plan (including agents and orchestration) of the given session.
func (r *AgentSessionRepository) GetLatestPlan(ctx context.Context, sessionID string) (*model.Plan, error) {
	var plan model.Plan
	err := r.db.WithContext(ctx).
		Where("session_id = ?", sessionID).
		Order("id DESC").
		Preload("Agents", preloadOrderedAgents).
		First(&plan).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &plan, nil
}

func (r *AgentSessionRepository) PatchMetadata(ctx context.Context, sessionID string, patch map[string]any) error {
	if len(patch) == 0 {
		return nil
	}
	b, _ := json.Marshal(patch)

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Update the JSONB metadata column
		if err := tx.Exec(
			"UPDATE sessions SET metadata = metadata || ?::jsonb WHERE session_id = ?",
			string(b), sessionID,
		).Error; err != nil {
			return err
		}

		// Also update the indexed team_id column if present in the patch
		if tidVal, ok := patch["team_id"]; ok {
			tidStr, _ := tidVal.(string)
			if tidStr != "" {
				if err := tx.Model(&model.AgentSession{}).
					Where("session_id = ?", sessionID).
					Update("team_id", tidStr).Error; err != nil {
					return err
				}
			}
		}

		return nil
	})
}

// GetSession returns a session by ID and user ID, preloading Team.
func (r *AgentSessionRepository) GetSession(ctx context.Context, sessionID string, userID uuid.UUID) (*model.AgentSession, error) {
	var session model.AgentSession
	err := r.db.WithContext(ctx).
		Joins("LEFT JOIN chat_sessions owning_chat ON owning_chat.id::text = sessions.session_id").
		Where("sessions.session_id = ? AND (sessions.user_id = ? OR owning_chat.user_id = ?)", sessionID, userID, userID).
		Preload("Team").
		First(&session).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &session, nil
}

// GetLatestByPlanningSessionID returns the most recent execution session for a
// given planning session ID, enforcing user ownership via the chat_sessions join.
func (r *AgentSessionRepository) GetLatestByPlanningSessionID(ctx context.Context, planningSessionID string, userID uuid.UUID) (*model.AgentSession, error) {
	var session model.AgentSession
	err := r.db.WithContext(ctx).
		Joins("LEFT JOIN chat_sessions owning_chat ON owning_chat.id::text = sessions.planning_session_id").
		Where(
			"sessions.planning_session_id = ? AND (sessions.user_id = ? OR owning_chat.user_id = ?)",
			planningSessionID,
			userID,
			userID,
		).
		Order("sessions.created_at DESC").
		Preload("Plans", preloadOrderedPlans).
		Preload("Plans.Agents", preloadOrderedAgents).
		First(&session).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &session, nil
}
