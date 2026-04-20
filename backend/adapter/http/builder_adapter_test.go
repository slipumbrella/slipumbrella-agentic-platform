package adapter_test

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	httpAdapter "capstone-prog/adapter/http"
	"capstone-prog/core/model"
	"capstone-prog/core/service"

	"net/http"
	"net/http/httptest"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
)

type fakeBuilderModelAssignmentsService struct {
	service.BuilderService
	getPlanningPlanFn func(ctx context.Context, sessionID string, userID uuid.UUID) (*model.Plan, error)
	getFn            func(ctx context.Context, sessionID string, userID uuid.UUID) (*service.ModelAssignmentsState, error)
	saveFn           func(ctx context.Context, sessionID string, userID uuid.UUID, state service.ModelAssignmentsState) error
	confirmFn        func(ctx context.Context, sessionID string, userID uuid.UUID) error
}

func (f *fakeBuilderModelAssignmentsService) GetPlanningSessionPlan(ctx context.Context, sessionID string, userID uuid.UUID) (*model.Plan, error) {
	if f.getPlanningPlanFn == nil {
		return nil, nil
	}
	return f.getPlanningPlanFn(ctx, sessionID, userID)
}

func (f *fakeBuilderModelAssignmentsService) GetModelAssignments(ctx context.Context, sessionID string, userID uuid.UUID) (*service.ModelAssignmentsState, error) {
	return f.getFn(ctx, sessionID, userID)
}

func (f *fakeBuilderModelAssignmentsService) SaveModelAssignmentsDraft(ctx context.Context, sessionID string, userID uuid.UUID, state service.ModelAssignmentsState) error {
	return f.saveFn(ctx, sessionID, userID, state)
}

func (f *fakeBuilderModelAssignmentsService) ConfirmModelAssignments(ctx context.Context, sessionID string, userID uuid.UUID) error {
	return f.confirmFn(ctx, sessionID, userID)
}

func TestBuilderHandler_GetModelAssignmentsReturnsCurrentState(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userID := uuid.New()

	svc := &fakeBuilderModelAssignmentsService{
		getFn: func(_ context.Context, sessionID string, actualUserID uuid.UUID) (*service.ModelAssignmentsState, error) {
			assert.Equal(t, "planning-session-id", sessionID)
			assert.Equal(t, userID, actualUserID)
			return &service.ModelAssignmentsState{
				Baseline: map[string]string{"Planner": "openai/gpt-4.1-mini"},
				Overrides: map[string]string{"Planner": "anthropic/claude-3.7-sonnet"},
				Final: map[string]string{"Planner": "anthropic/claude-3.7-sonnet"},
				Confirmed: false,
			}, nil
		},
	}

	handler := httpAdapter.NewBuilderHandler(svc, nil, nil)
	router := gin.New()
	router.GET("/builder/sessions/:id/model-assignments", func(c *gin.Context) {
		c.Set("user_id", userID)
	}, handler.GetModelAssignments)

	req := httptest.NewRequest(http.MethodGet, "/builder/sessions/planning-session-id/model-assignments", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"baseline"`)
	require.Contains(t, rec.Body.String(), `"anthropic/claude-3.7-sonnet"`)
}

func TestBuilderHandler_GetPlanningSessionPlanReturnsAgents(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userID := uuid.New()

	svc := &fakeBuilderModelAssignmentsService{
		getPlanningPlanFn: func(_ context.Context, sessionID string, actualUserID uuid.UUID) (*model.Plan, error) {
			assert.Equal(t, "planning-session-id", sessionID)
			assert.Equal(t, userID, actualUserID)
			return &model.Plan{
				Orchestration: "sequential",
				Agents: []model.AgentDef{
					{
						ID:         "researcher",
						Role:       "Researcher",
						Goal:       "Finds and verifies the most useful information.",
						Tools:      datatypes.JSON(`["search"]`),
						Context:    datatypes.JSON(`{}`),
						Model:      "anthropic/claude-sonnet-4",
						OrderIndex: 1,
						IsLeader:   true,
					},
				},
			}, nil
		},
	}

	handler := httpAdapter.NewBuilderHandler(svc, nil, nil)
	router := gin.New()
	router.GET("/builder/planning-sessions/:id/plan", func(c *gin.Context) {
		c.Set("user_id", userID)
	}, handler.GetPlanningSessionPlan)

	req := httptest.NewRequest(http.MethodGet, "/builder/planning-sessions/planning-session-id/plan", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"orchestration":"sequential"`)
	require.Contains(t, rec.Body.String(), `"role":"Researcher"`)
}

func TestBuilderHandler_SaveModelAssignmentsPersistsDraft(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userID := uuid.New()

	svc := &fakeBuilderModelAssignmentsService{
		saveFn: func(_ context.Context, sessionID string, actualUserID uuid.UUID, state service.ModelAssignmentsState) error {
			assert.Equal(t, "planning-session-id", sessionID)
			assert.Equal(t, userID, actualUserID)
			assert.Equal(t, map[string]string{"Planner": "openai/gpt-4.1-mini"}, state.Baseline)
			assert.Equal(t, map[string]string{"Planner": "anthropic/claude-3.7-sonnet"}, state.Overrides)
			return nil
		},
		getFn: func(_ context.Context, _ string, _ uuid.UUID) (*service.ModelAssignmentsState, error) {
			return &service.ModelAssignmentsState{
				Baseline: map[string]string{"Planner": "openai/gpt-4.1-mini"},
				Overrides: map[string]string{"Planner": "anthropic/claude-3.7-sonnet"},
				Final: map[string]string{"Planner": "anthropic/claude-3.7-sonnet"},
			}, nil
		},
	}

	handler := httpAdapter.NewBuilderHandler(svc, nil, nil)
	router := gin.New()
	router.PUT("/builder/sessions/:id/model-assignments", func(c *gin.Context) {
		c.Set("user_id", userID)
	}, handler.SaveModelAssignments)

	body, err := json.Marshal(map[string]any{
		"baseline": map[string]string{"Planner": "openai/gpt-4.1-mini"},
		"overrides": map[string]string{"Planner": "anthropic/claude-3.7-sonnet"},
	})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPut, "/builder/sessions/planning-session-id/model-assignments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"final"`)
}

func TestBuilderHandler_ConfirmModelAssignmentsMarksReviewComplete(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userID := uuid.New()

	svc := &fakeBuilderModelAssignmentsService{
		confirmFn: func(_ context.Context, sessionID string, actualUserID uuid.UUID) error {
			assert.Equal(t, "planning-session-id", sessionID)
			assert.Equal(t, userID, actualUserID)
			return nil
		},
		getFn: func(_ context.Context, _ string, _ uuid.UUID) (*service.ModelAssignmentsState, error) {
			now := "2026-03-31T10:00:00Z"
			return &service.ModelAssignmentsState{
				Baseline:    map[string]string{"Planner": "openai/gpt-4.1-mini"},
				Overrides:   map[string]string{"Planner": "anthropic/claude-3.7-sonnet"},
				Final:       map[string]string{"Planner": "anthropic/claude-3.7-sonnet"},
				Confirmed:   true,
				ConfirmedAt: &now,
			}, nil
		},
	}

	handler := httpAdapter.NewBuilderHandler(svc, nil, nil)
	router := gin.New()
	router.POST("/builder/sessions/:id/model-assignments/confirm", func(c *gin.Context) {
		c.Set("user_id", userID)
	}, handler.ConfirmModelAssignments)

	req := httptest.NewRequest(http.MethodPost, "/builder/sessions/planning-session-id/model-assignments/confirm", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"confirmed":true`)
}
