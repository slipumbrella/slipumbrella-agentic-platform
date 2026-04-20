package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"capstone-prog/core/model"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
)

type fakeBuilderChatRepository struct {
	session *model.ChatSession
}

func (f *fakeBuilderChatRepository) CreateSession(ctx context.Context, session *model.ChatSession) (string, error) {
	panic("unexpected call")
}

func (f *fakeBuilderChatRepository) GetSession(ctx context.Context, sessionID string) (*model.ChatSession, error) {
	return f.session, nil
}

func (f *fakeBuilderChatRepository) AppendMessage(ctx context.Context, chatMessage *model.ChatMessage) error {
	panic("unexpected call")
}

func (f *fakeBuilderChatRepository) GetMessages(ctx context.Context, sessionID string) ([]model.ChatMessage, error) {
	panic("unexpected call")
}

func (f *fakeBuilderChatRepository) ListSessions(ctx context.Context, userID uuid.UUID) ([]*model.ChatSession, error) {
	panic("unexpected call")
}

func (f *fakeBuilderChatRepository) GetSessionOwner(ctx context.Context, sessionID uuid.UUID) (uuid.UUID, error) {
	panic("unexpected call")
}

type fakeBuilderAgentSessionRepository struct {
	latestPlan *model.Plan
	session    *model.AgentSession
	lastPatch  map[string]any
}

func (f *fakeBuilderAgentSessionRepository) ListExecutionSessions(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error) {
	panic("unexpected call")
}

func (f *fakeBuilderAgentSessionRepository) ListUnassignedSessions(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error) {
	panic("unexpected call")
}

func (f *fakeBuilderAgentSessionRepository) GetLatestPlan(ctx context.Context, sessionID string) (*model.Plan, error) {
	return f.latestPlan, nil
}

func (f *fakeBuilderAgentSessionRepository) GetSession(ctx context.Context, sessionID string, userID uuid.UUID) (*model.AgentSession, error) {
	return f.session, nil
}

func (f *fakeBuilderAgentSessionRepository) GetLatestByPlanningSessionID(ctx context.Context, planningSessionID string, userID uuid.UUID) (*model.AgentSession, error) {
	panic("unexpected call")
}

func (f *fakeBuilderAgentSessionRepository) PatchMetadata(ctx context.Context, sessionID string, patch map[string]any) error {
	f.lastPatch = patch
	return nil
}

func (f *fakeBuilderAgentSessionRepository) SetSessionUserID(ctx context.Context, sessionID string, userID uuid.UUID) error {
	panic("unexpected call")
}

func TestBuilderService_GetModelAssignmentsMergesPlanBaselineAndDraftOverrides(t *testing.T) {
	userID := uuid.New()
	reviewedAt := "2026-03-31T09:30:00Z"

	sessionMetadata := map[string]any{
		"model_assignment_draft": map[string]any{
			"baseline": map[string]any{
				"Planner": "openai/gpt-4.1-mini",
			},
			"overrides": map[string]any{
				"Planner": "anthropic/claude-3.7-sonnet",
			},
			"confirmed":    true,
			"reviewed_at":  reviewedAt,
			"confirmed_at": reviewedAt,
		},
	}
	sessionMetadataJSON, err := json.Marshal(sessionMetadata)
	require.NoError(t, err)

	chatRepo := &fakeBuilderChatRepository{
		session: &model.ChatSession{
			ID:     uuid.New(),
			UserID: userID,
		},
	}
	agentRepo := &fakeBuilderAgentSessionRepository{
		latestPlan: &model.Plan{
			Agents: []model.AgentDef{
				{ID: "Planner", Model: "openai/gpt-4.1-mini"},
				{ID: "Researcher", Model: "openai/gpt-4.1-mini"},
			},
		},
		session: &model.AgentSession{
			SessionID: "planning-session-id",
			Type:      "planning",
			Metadata:  datatypes.JSON(sessionMetadataJSON),
			UserID:    &userID,
		},
	}

	svc := NewBuilderService(chatRepo, agentRepo, nil, nil, nil, nil, nil)

	assignments, err := svc.GetModelAssignments(context.Background(), "planning-session-id", userID)

	require.NoError(t, err)
	require.Equal(t, map[string]string{
		"Planner":    "openai/gpt-4.1-mini",
		"Researcher": "openai/gpt-4.1-mini",
	}, assignments.Baseline)
	require.Equal(t, map[string]string{
		"Planner": "anthropic/claude-3.7-sonnet",
	}, assignments.Overrides)
	require.Equal(t, map[string]string{
		"Planner":    "anthropic/claude-3.7-sonnet",
		"Researcher": "openai/gpt-4.1-mini",
	}, assignments.Final)
	assert.True(t, assignments.Confirmed)
	require.NotNil(t, assignments.ReviewedAt)
	assert.Equal(t, reviewedAt, *assignments.ReviewedAt)
}

func TestBuilderService_SaveModelAssignmentsDraftPatchesMetadata(t *testing.T) {
	userID := uuid.New()
	chatRepo := &fakeBuilderChatRepository{
		session: &model.ChatSession{
			ID:     uuid.New(),
			UserID: userID,
		},
	}
	agentRepo := &fakeBuilderAgentSessionRepository{}

	svc := NewBuilderService(chatRepo, agentRepo, nil, nil, nil, nil, nil)

	err := svc.SaveModelAssignmentsDraft(context.Background(), "planning-session-id", userID, ModelAssignmentsState{
		Baseline: map[string]string{
			"Planner": "openai/gpt-4.1-mini",
		},
		Overrides: map[string]string{
			"Planner": "anthropic/claude-3.7-sonnet",
		},
	})

	require.NoError(t, err)
	require.NotNil(t, agentRepo.lastPatch)

	rawDraft, ok := agentRepo.lastPatch["model_assignment_draft"]
	require.True(t, ok)

	draft, ok := rawDraft.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, false, draft["confirmed"])
	assert.Equal(t, map[string]string{"Planner": "openai/gpt-4.1-mini"}, draft["baseline"])
	assert.Equal(t, map[string]string{"Planner": "anthropic/claude-3.7-sonnet"}, draft["overrides"])
}

func TestBuilderService_ConfirmModelAssignmentsMarksDraftConfirmed(t *testing.T) {
	userID := uuid.New()
	chatRepo := &fakeBuilderChatRepository{
		session: &model.ChatSession{
			ID:     uuid.New(),
			UserID: userID,
		},
	}
	agentRepo := &fakeBuilderAgentSessionRepository{
		session: &model.AgentSession{
			SessionID: "planning-session-id",
			Type:      "planning",
		},
	}

	svc := NewBuilderService(chatRepo, agentRepo, nil, nil, nil, nil, nil)

	err := svc.ConfirmModelAssignments(context.Background(), "planning-session-id", userID)

	require.NoError(t, err)
	rawDraft, ok := agentRepo.lastPatch["model_assignment_draft"]
	require.True(t, ok)

	draft, ok := rawDraft.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, true, draft["confirmed"])
	require.NotNil(t, draft["confirmed_at"])

	confirmedAt, ok := draft["confirmed_at"].(string)
	require.True(t, ok)
	_, parseErr := time.Parse(time.RFC3339, confirmedAt)
	require.NoError(t, parseErr)
}
