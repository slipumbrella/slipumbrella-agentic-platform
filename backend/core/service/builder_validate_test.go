package service

import (
	"context"
	"errors"
	"testing"

	"capstone-prog/core/model"

	"github.com/google/uuid"
)

// --- minimal ChatRepository mock (only GetSession is exercised) ---

type mockChatRepoValidate struct {
	getSessionFn func(ctx context.Context, sessionID string) (*model.ChatSession, error)
}

func (m *mockChatRepoValidate) CreateSession(_ context.Context, _ *model.ChatSession) (string, error) {
	return "", nil
}
func (m *mockChatRepoValidate) GetSession(ctx context.Context, sessionID string) (*model.ChatSession, error) {
	if m.getSessionFn != nil {
		return m.getSessionFn(ctx, sessionID)
	}
	return nil, errors.New("not found")
}
func (m *mockChatRepoValidate) AppendMessage(_ context.Context, _ *model.ChatMessage) error { return nil }
func (m *mockChatRepoValidate) GetMessages(_ context.Context, _ string) ([]model.ChatMessage, error) {
	return nil, nil
}
func (m *mockChatRepoValidate) ListSessions(_ context.Context, _ uuid.UUID) ([]*model.ChatSession, error) {
	return nil, nil
}
func (m *mockChatRepoValidate) GetSessionOwner(_ context.Context, _ uuid.UUID) (uuid.UUID, error) {
	return uuid.Nil, nil
}

// --- minimal AgentSessionRepository mock (only ListExecutionSessions is exercised) ---

type mockAgentSessionRepoValidate struct {
	listExecFn func(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error)
}

func (m *mockAgentSessionRepoValidate) ListExecutionSessions(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error) {
	if m.listExecFn != nil {
		return m.listExecFn(ctx, userID)
	}
	return nil, nil
}
func (m *mockAgentSessionRepoValidate) ListUnassignedSessions(_ context.Context, _ uuid.UUID) ([]*model.AgentSession, error) {
	return nil, nil
}
func (m *mockAgentSessionRepoValidate) GetLatestPlan(_ context.Context, _ string) (*model.Plan, error) {
	return nil, nil
}
func (m *mockAgentSessionRepoValidate) GetSession(_ context.Context, _ string, _ uuid.UUID) (*model.AgentSession, error) {
	return nil, nil
}
func (m *mockAgentSessionRepoValidate) GetLatestByPlanningSessionID(_ context.Context, _ string, _ uuid.UUID) (*model.AgentSession, error) {
	return nil, nil
}
func (m *mockAgentSessionRepoValidate) PatchMetadata(_ context.Context, _ string, _ map[string]any) error {
	return nil
}
func (m *mockAgentSessionRepoValidate) SetSessionUserID(_ context.Context, _ string, _ uuid.UUID) error {
	return nil
}

// helper: build a minimal builderServiceImpl with only the two repos wired
func newValidateSvc(chatRepo *mockChatRepoValidate, agentRepo *mockAgentSessionRepoValidate) *builderServiceImpl {
	return &builderServiceImpl{
		chatRepo:         chatRepo,
		agentSessionRepo: agentRepo,
	}
}

// --- tests ---

func TestValidateSessionOwner_ExecSessionFound(t *testing.T) {
	userID := uuid.New()
	execID := uuid.New().String()

	svc := newValidateSvc(
		&mockChatRepoValidate{},
		&mockAgentSessionRepoValidate{
			listExecFn: func(_ context.Context, _ uuid.UUID) ([]*model.AgentSession, error) {
				return []*model.AgentSession{{SessionID: execID}}, nil
			},
		},
	)

	if err := svc.ValidateSessionOwner(context.Background(), execID, userID); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestValidateSessionOwner_PlanningSessionFound(t *testing.T) {
	userID := uuid.New()
	planID := uuid.New().String()

	svc := newValidateSvc(
		&mockChatRepoValidate{
			getSessionFn: func(_ context.Context, _ string) (*model.ChatSession, error) {
				return &model.ChatSession{UserID: userID}, nil
			},
		},
		&mockAgentSessionRepoValidate{
			// exec lookup returns nothing → triggers planning fallback
			listExecFn: func(_ context.Context, _ uuid.UUID) ([]*model.AgentSession, error) {
				return nil, nil
			},
		},
	)

	if err := svc.ValidateSessionOwner(context.Background(), planID, userID); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestValidateSessionOwner_NotFound(t *testing.T) {
	userID := uuid.New()
	otherUser := uuid.New()

	svc := newValidateSvc(
		&mockChatRepoValidate{
			getSessionFn: func(_ context.Context, _ string) (*model.ChatSession, error) {
				// session exists but belongs to a different user
				return &model.ChatSession{UserID: otherUser}, nil
			},
		},
		&mockAgentSessionRepoValidate{
			listExecFn: func(_ context.Context, _ uuid.UUID) ([]*model.AgentSession, error) {
				return nil, nil
			},
		},
	)

	err := svc.ValidateSessionOwner(context.Background(), uuid.New().String(), userID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestValidateSessionOwner_InfraErrorPropagated(t *testing.T) {
	infra := errors.New("db timeout")
	userID := uuid.New()

	svc := newValidateSvc(
		&mockChatRepoValidate{},
		&mockAgentSessionRepoValidate{
			listExecFn: func(_ context.Context, _ uuid.UUID) ([]*model.AgentSession, error) {
				return nil, infra
			},
		},
	)

	err := svc.ValidateSessionOwner(context.Background(), uuid.New().String(), userID)
	if !errors.Is(err, infra) {
		t.Fatalf("expected infra error propagated, got %v", err)
	}
}
