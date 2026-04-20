package service

import (
	"context"
	"fmt"
	"testing"

	"capstone-prog/core/model"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

type mockTeamServiceTeamRepo struct {
	getTeamFn  func(ctx context.Context, id, userID uuid.UUID) (*model.Team, error)
	assignFn   func(ctx context.Context, teamID uuid.UUID, sessionID string) error
	unassignFn func(ctx context.Context, sessionID string) error
}

func (m *mockTeamServiceTeamRepo) CreateTeam(ctx context.Context, team *model.Team) error { return nil }
func (m *mockTeamServiceTeamRepo) ListTeams(ctx context.Context, userID uuid.UUID) ([]*model.Team, error) {
	return nil, nil
}
func (m *mockTeamServiceTeamRepo) GetTeam(ctx context.Context, id, userID uuid.UUID) (*model.Team, error) {
	if m.getTeamFn != nil {
		return m.getTeamFn(ctx, id, userID)
	}
	return nil, fmt.Errorf("not found")
}
func (m *mockTeamServiceTeamRepo) UpdateTeam(ctx context.Context, team *model.Team) error { return nil }
func (m *mockTeamServiceTeamRepo) DeleteTeam(ctx context.Context, id uuid.UUID) error     { return nil }
func (m *mockTeamServiceTeamRepo) AssignSessionToTeam(ctx context.Context, teamID uuid.UUID, sessionID string) error {
	if m.assignFn != nil {
		return m.assignFn(ctx, teamID, sessionID)
	}
	return nil
}
func (m *mockTeamServiceTeamRepo) UnassignSession(ctx context.Context, sessionID string) error {
	if m.unassignFn != nil {
		return m.unassignFn(ctx, sessionID)
	}
	return nil
}

type mockTeamServiceSessionRepo struct {
	getSessionFn func(ctx context.Context, sessionID string, userID uuid.UUID) (*model.AgentSession, error)
}

func (m *mockTeamServiceSessionRepo) ListExecutionSessions(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error) {
	return nil, nil
}

func (m *mockTeamServiceSessionRepo) ListUnassignedSessions(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error) {
	return nil, nil
}

func (m *mockTeamServiceSessionRepo) GetLatestPlan(ctx context.Context, sessionID string) (*model.Plan, error) {
	return nil, nil
}

func (m *mockTeamServiceSessionRepo) GetSession(ctx context.Context, sessionID string, userID uuid.UUID) (*model.AgentSession, error) {
	if m.getSessionFn != nil {
		return m.getSessionFn(ctx, sessionID, userID)
	}
	return nil, fmt.Errorf("not found")
}

func (m *mockTeamServiceSessionRepo) GetLatestByPlanningSessionID(ctx context.Context, planningSessionID string, userID uuid.UUID) (*model.AgentSession, error) {
	return nil, nil
}

func (m *mockTeamServiceSessionRepo) PatchMetadata(ctx context.Context, sessionID string, patch map[string]any) error {
	return nil
}

func (m *mockTeamServiceSessionRepo) SetSessionUserID(ctx context.Context, sessionID string, userID uuid.UUID) error {
	return nil
}

func TestTeamService_AssignSessionToTeam_AllowsOwnedTeamAndSession(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	teamID := uuid.New()
	sessionID := uuid.NewString()

	teamRepo := &mockTeamServiceTeamRepo{
		getTeamFn: func(context.Context, uuid.UUID, uuid.UUID) (*model.Team, error) {
			return &model.Team{ID: teamID, UserID: userID}, nil
		},
		assignFn: func(_ context.Context, gotTeamID uuid.UUID, gotSessionID string) error {
			require.Equal(t, teamID, gotTeamID)
			require.Equal(t, sessionID, gotSessionID)
			return nil
		},
	}
	sessionRepo := &mockTeamServiceSessionRepo{
		getSessionFn: func(context.Context, string, uuid.UUID) (*model.AgentSession, error) {
			return &model.AgentSession{SessionID: sessionID, UserID: &userID}, nil
		},
	}

	svc := NewTeamService(teamRepo, sessionRepo)

	require.NoError(t, svc.AssignSessionToTeam(ctx, teamID, sessionID, userID))
}

func TestTeamService_AssignSessionToTeam_DeniesForeignTeam(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	teamID := uuid.New()
	sessionID := uuid.NewString()

	teamRepo := &mockTeamServiceTeamRepo{
		getTeamFn: func(context.Context, uuid.UUID, uuid.UUID) (*model.Team, error) {
			return nil, fmt.Errorf("not found")
		},
		assignFn: func(context.Context, uuid.UUID, string) error {
			t.Fatal("assign should not be called")
			return nil
		},
	}
	sessionRepo := &mockTeamServiceSessionRepo{
		getSessionFn: func(context.Context, string, uuid.UUID) (*model.AgentSession, error) {
			return &model.AgentSession{SessionID: sessionID, UserID: &userID}, nil
		},
	}

	svc := NewTeamService(teamRepo, sessionRepo)

	require.ErrorIs(t, svc.AssignSessionToTeam(ctx, teamID, sessionID, userID), ErrNotFound)
}

func TestTeamService_UnassignSession_AllowsOwnedTeamAndSession(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	teamID := uuid.New()
	sessionID := uuid.NewString()

	teamRepo := &mockTeamServiceTeamRepo{
		unassignFn: func(_ context.Context, gotSessionID string) error {
			require.Equal(t, sessionID, gotSessionID)
			return nil
		},
	}
	sessionRepo := &mockTeamServiceSessionRepo{
		getSessionFn: func(context.Context, string, uuid.UUID) (*model.AgentSession, error) {
			return &model.AgentSession{
				SessionID: sessionID,
				UserID:    &userID,
				TeamID:    &teamID,
				Team:      &model.Team{ID: teamID, UserID: userID},
			}, nil
		},
	}

	svc := NewTeamService(teamRepo, sessionRepo)

	require.NoError(t, svc.UnassignSession(ctx, sessionID, userID))
}

func TestTeamService_UnassignSession_DeniesForeignTeam(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	otherUserID := uuid.New()
	teamID := uuid.New()
	sessionID := uuid.NewString()

	teamRepo := &mockTeamServiceTeamRepo{
		unassignFn: func(context.Context, string) error {
			t.Fatal("unassign should not be called")
			return nil
		},
	}
	sessionRepo := &mockTeamServiceSessionRepo{
		getSessionFn: func(context.Context, string, uuid.UUID) (*model.AgentSession, error) {
			return &model.AgentSession{
				SessionID: sessionID,
				UserID:    &userID,
				TeamID:    &teamID,
				Team:      &model.Team{ID: teamID, UserID: otherUserID},
			}, nil
		},
	}

	svc := NewTeamService(teamRepo, sessionRepo)

	require.ErrorIs(t, svc.UnassignSession(ctx, sessionID, userID), ErrForbidden)
}
