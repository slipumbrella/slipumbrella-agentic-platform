package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"capstone-prog/core/model"
	core "capstone-prog/core/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeExecutionWSService struct {
	core.BuilderService
	streamChatFn func(context.Context, *model.ChatMessage, string, string, uuid.UUID, func(*core.StreamEvent)) error
	stopRunFn    func(context.Context, string, string, uuid.UUID) (*core.StopRunResult, error)
}

func (f *fakeExecutionWSService) StreamChat(ctx context.Context, chatMessage *model.ChatMessage, targetAgentID string, presentationMode string, userID uuid.UUID, onEvent func(*core.StreamEvent)) error {
	return f.streamChatFn(ctx, chatMessage, targetAgentID, presentationMode, userID, onEvent)
}

func (f *fakeExecutionWSService) StopRun(ctx context.Context, executionSessionID string, runID string, userID uuid.UUID) (*core.StopRunResult, error) {
	return f.stopRunFn(ctx, executionSessionID, runID, userID)
}

func TestWSExecutionHandler_StopUsesSameWebSocketTransport(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userID := uuid.New()
	sessionID := uuid.New().String()
	runID := "run-789"

	stopCalled := make(chan struct{}, 1)
	releaseStream := make(chan struct{})
	const allowedOrigin = "http://example.com"
	svc := &fakeExecutionWSService{
		streamChatFn: func(_ context.Context, chatMessage *model.ChatMessage, _ string, _ string, actualUserID uuid.UUID, onEvent func(*core.StreamEvent)) error {
			assert.Equal(t, sessionID, chatMessage.SessionID.String())
			assert.Equal(t, userID, actualUserID)
			onEvent(&core.StreamEvent{
				Type:  "workflow_started",
				RunID: runID,
				Workflow: &core.WorkflowTraceEventData{
					ExecutionSessionID: sessionID,
					RunID:              runID,
					Orchestration:      "sequential",
					Status:             "running",
					Summary:            "started",
				},
			})
			<-releaseStream
			onEvent(&core.StreamEvent{
				Type:  "workflow_stopped",
				RunID: runID,
				Workflow: &core.WorkflowTraceEventData{
					ExecutionSessionID: sessionID,
					RunID:              runID,
					Orchestration:      "sequential",
					Status:             "stopped",
					Summary:            "stopped",
					StoppedAt:          "2026-04-06T10:00:00Z",
				},
			})
			return nil
		},
		stopRunFn: func(_ context.Context, executionSessionID string, actualRunID string, actualUserID uuid.UUID) (*core.StopRunResult, error) {
			assert.Equal(t, sessionID, executionSessionID)
			assert.Equal(t, runID, actualRunID)
			assert.Equal(t, userID, actualUserID)
			stopCalled <- struct{}{}
			return &core.StopRunResult{
				ExecutionSessionID: executionSessionID,
				RunID:              actualRunID,
				Status:             "accepted",
				Message:            "Stop requested.",
			}, nil
		},
	}

	handler := NewWSExecutionHandler(svc, []string{allowedOrigin})
	router := gin.New()
	router.GET("/ws/execution", func(c *gin.Context) {
		c.Set("user_id", userID)
		handler.HandleExecutionWS(c)
	})

	server := httptest.NewServer(router)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/execution"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": []string{allowedOrigin}})
	require.NoError(t, err)
	defer conn.Close()

	require.NoError(t, conn.WriteJSON(WSMessage{Type: "chat", SessionID: sessionID, Message: "hello"}))

	var started WSEvent
	require.NoError(t, conn.ReadJSON(&started))
	assert.Equal(t, "workflow_started", started.Type)
	assert.Equal(t, runID, started.RunID)

	require.NoError(t, conn.WriteJSON(WSMessage{Type: "stop", ExecutionSessionID: sessionID, RunID: runID}))

	select {
	case <-stopCalled:
	case <-time.After(2 * time.Second):
		t.Fatal("expected stop request to be handled while chat stream was active")
	}

	var stopResult WSEvent
	require.NoError(t, conn.ReadJSON(&stopResult))
	assert.Equal(t, "stop_result", stopResult.Type)
	assert.Equal(t, runID, stopResult.RunID)
	require.NotNil(t, stopResult.StopResult)
	assert.Equal(t, "accepted", stopResult.StopResult.Status)

	close(releaseStream)

	var stopped WSEvent
	require.NoError(t, conn.ReadJSON(&stopped))
	assert.Equal(t, "workflow_stopped", stopped.Type)
	assert.Equal(t, runID, stopped.RunID)

	var done WSEvent
	require.NoError(t, conn.ReadJSON(&done))
	assert.Equal(t, "done", done.Type)
}

func TestWSExecutionHandler_DuplicateStopForwardsServiceResult(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userID := uuid.New()
	sessionID := uuid.New().String()
	runID := "run-789"

	releaseStream := make(chan struct{})
	const allowedOrigin = "http://example.com"
	svc := &fakeExecutionWSService{
		streamChatFn: func(_ context.Context, _ *model.ChatMessage, _ string, _ string, _ uuid.UUID, onEvent func(*core.StreamEvent)) error {
			onEvent(&core.StreamEvent{
				Type:  "workflow_started",
				RunID: runID,
				Workflow: &core.WorkflowTraceEventData{
					ExecutionSessionID: sessionID,
					RunID:              runID,
					Orchestration:      "sequential",
					Status:             "running",
					Summary:            "started",
				},
			})
			<-releaseStream
			return nil
		},
		stopRunFn: func(_ context.Context, executionSessionID string, actualRunID string, actualUserID uuid.UUID) (*core.StopRunResult, error) {
			assert.Equal(t, sessionID, executionSessionID)
			assert.Equal(t, runID, actualRunID)
			assert.Equal(t, userID, actualUserID)
			return &core.StopRunResult{
				ExecutionSessionID: executionSessionID,
				RunID:              actualRunID,
				Status:             "accepted",
				Message:            "Stop already requested.",
			}, nil
		},
	}

	handler := NewWSExecutionHandler(svc, []string{allowedOrigin})
	router := gin.New()
	router.GET("/ws/execution", func(c *gin.Context) {
		c.Set("user_id", userID)
		handler.HandleExecutionWS(c)
	})

	server := httptest.NewServer(router)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/execution"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": []string{allowedOrigin}})
	require.NoError(t, err)
	defer conn.Close()

	require.NoError(t, conn.WriteJSON(WSMessage{Type: "chat", SessionID: sessionID, Message: "hello"}))

	var started WSEvent
	require.NoError(t, conn.ReadJSON(&started))
	assert.Equal(t, "workflow_started", started.Type)

	require.NoError(t, conn.WriteJSON(WSMessage{Type: "stop", ExecutionSessionID: sessionID, RunID: runID}))
	var firstStop WSEvent
	require.NoError(t, conn.ReadJSON(&firstStop))
	assert.Equal(t, "stop_result", firstStop.Type)
	assert.Equal(t, "accepted", firstStop.StopResult.Status)

	require.NoError(t, conn.WriteJSON(WSMessage{Type: "stop", ExecutionSessionID: sessionID, RunID: runID}))
	var secondStop WSEvent
	require.NoError(t, conn.ReadJSON(&secondStop))
	assert.Equal(t, "stop_result", secondStop.Type)
	assert.Equal(t, "accepted", secondStop.StopResult.Status)
	assert.Equal(t, "Stop already requested.", secondStop.StopResult.Message)

	close(releaseStream)
	var done WSEvent
	require.NoError(t, conn.ReadJSON(&done))
	assert.Equal(t, "done", done.Type)
}

func TestWSExecutionHandler_StopRetryAfterFailureForwardsAgain(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userID := uuid.New()
	sessionID := uuid.New().String()
	runID := "run-789"

	stopCalls := 0
	releaseStream := make(chan struct{})
	const allowedOrigin = "http://example.com"
	svc := &fakeExecutionWSService{
		streamChatFn: func(_ context.Context, _ *model.ChatMessage, _ string, _ string, _ uuid.UUID, onEvent func(*core.StreamEvent)) error {
			onEvent(&core.StreamEvent{
				Type:  "workflow_started",
				RunID: runID,
				Workflow: &core.WorkflowTraceEventData{
					ExecutionSessionID: sessionID,
					RunID:              runID,
					Orchestration:      "sequential",
					Status:             "running",
					Summary:            "started",
				},
			})
			<-releaseStream
			return nil
		},
		stopRunFn: func(_ context.Context, executionSessionID string, actualRunID string, actualUserID uuid.UUID) (*core.StopRunResult, error) {
			stopCalls++
			assert.Equal(t, sessionID, executionSessionID)
			assert.Equal(t, runID, actualRunID)
			assert.Equal(t, userID, actualUserID)
			if stopCalls == 1 {
				return nil, errors.New("temporary failure")
			}
			return &core.StopRunResult{
				ExecutionSessionID: executionSessionID,
				RunID:              actualRunID,
				Status:             "accepted",
				Message:            "Stop requested.",
			}, nil
		},
	}

	handler := NewWSExecutionHandler(svc, []string{allowedOrigin})
	router := gin.New()
	router.GET("/ws/execution", func(c *gin.Context) {
		c.Set("user_id", userID)
		handler.HandleExecutionWS(c)
	})

	server := httptest.NewServer(router)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/execution"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": []string{allowedOrigin}})
	require.NoError(t, err)
	defer conn.Close()

	require.NoError(t, conn.WriteJSON(WSMessage{Type: "chat", SessionID: sessionID, Message: "hello"}))

	var started WSEvent
	require.NoError(t, conn.ReadJSON(&started))
	assert.Equal(t, "workflow_started", started.Type)

	require.NoError(t, conn.WriteJSON(WSMessage{Type: "stop", ExecutionSessionID: sessionID, RunID: runID}))
	var firstResponse WSEvent
	require.NoError(t, conn.ReadJSON(&firstResponse))
	assert.Equal(t, "error", firstResponse.Type)

	require.NoError(t, conn.WriteJSON(WSMessage{Type: "stop", ExecutionSessionID: sessionID, RunID: runID}))
	var secondResponse WSEvent
	require.NoError(t, conn.ReadJSON(&secondResponse))
	assert.Equal(t, "stop_result", secondResponse.Type)
	assert.Equal(t, "accepted", secondResponse.StopResult.Status)
	assert.Equal(t, 2, stopCalls)

	close(releaseStream)
	var done WSEvent
	require.NoError(t, conn.ReadJSON(&done))
	assert.Equal(t, "done", done.Type)
}

func TestWSExecutionHandler_StopRetryAfterRejectedResponseForwardsAgain(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userID := uuid.New()
	sessionID := uuid.New().String()
	runID := "run-789"

	stopCalls := 0
	releaseStream := make(chan struct{})
	const allowedOrigin = "http://example.com"
	svc := &fakeExecutionWSService{
		streamChatFn: func(_ context.Context, _ *model.ChatMessage, _ string, _ string, _ uuid.UUID, onEvent func(*core.StreamEvent)) error {
			onEvent(&core.StreamEvent{
				Type:  "workflow_started",
				RunID: runID,
				Workflow: &core.WorkflowTraceEventData{
					ExecutionSessionID: sessionID,
					RunID:              runID,
					Orchestration:      "sequential",
					Status:             "running",
					Summary:            "started",
				},
			})
			<-releaseStream
			return nil
		},
		stopRunFn: func(_ context.Context, executionSessionID string, actualRunID string, actualUserID uuid.UUID) (*core.StopRunResult, error) {
			stopCalls++
			assert.Equal(t, sessionID, executionSessionID)
			assert.Equal(t, runID, actualRunID)
			assert.Equal(t, userID, actualUserID)
			if stopCalls == 1 {
				return &core.StopRunResult{
					ExecutionSessionID: executionSessionID,
					RunID:              actualRunID,
					Status:             "not_found",
					Message:            "The targeted run is no longer active.",
				}, nil
			}
			return &core.StopRunResult{
				ExecutionSessionID: executionSessionID,
				RunID:              actualRunID,
				Status:             "accepted",
				Message:            "Stop requested.",
			}, nil
		},
	}

	handler := NewWSExecutionHandler(svc, []string{allowedOrigin})
	router := gin.New()
	router.GET("/ws/execution", func(c *gin.Context) {
		c.Set("user_id", userID)
		handler.HandleExecutionWS(c)
	})

	server := httptest.NewServer(router)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/execution"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": []string{allowedOrigin}})
	require.NoError(t, err)
	defer conn.Close()

	require.NoError(t, conn.WriteJSON(WSMessage{Type: "chat", SessionID: sessionID, Message: "hello"}))

	var started WSEvent
	require.NoError(t, conn.ReadJSON(&started))
	assert.Equal(t, "workflow_started", started.Type)

	require.NoError(t, conn.WriteJSON(WSMessage{Type: "stop", ExecutionSessionID: sessionID, RunID: runID}))
	var firstResponse WSEvent
	require.NoError(t, conn.ReadJSON(&firstResponse))
	assert.Equal(t, "stop_result", firstResponse.Type)
	assert.Equal(t, "not_found", firstResponse.StopResult.Status)

	require.NoError(t, conn.WriteJSON(WSMessage{Type: "stop", ExecutionSessionID: sessionID, RunID: runID}))
	var secondResponse WSEvent
	require.NoError(t, conn.ReadJSON(&secondResponse))
	assert.Equal(t, "stop_result", secondResponse.Type)
	assert.Equal(t, "accepted", secondResponse.StopResult.Status)
	assert.Equal(t, 2, stopCalls)

	close(releaseStream)
	var done WSEvent
	require.NoError(t, conn.ReadJSON(&done))
	assert.Equal(t, "done", done.Type)
}

func TestWSExecutionHandler_StopValidatesPayload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userID := uuid.New()
	called := false
	const allowedOrigin = "http://example.com"
	svc := &fakeExecutionWSService{
		stopRunFn: func(context.Context, string, string, uuid.UUID) (*core.StopRunResult, error) {
			called = true
			return nil, nil
		},
	}

	handler := NewWSExecutionHandler(svc, []string{allowedOrigin})
	router := gin.New()
	router.GET("/ws/execution", func(c *gin.Context) {
		c.Set("user_id", userID)
		handler.HandleExecutionWS(c)
	})

	server := httptest.NewServer(router)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/execution"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": []string{allowedOrigin}})
	require.NoError(t, err)
	defer conn.Close()

	require.NoError(t, conn.WriteJSON(WSMessage{Type: "stop", ExecutionSessionID: uuid.New().String()}))

	_, payload, err := conn.ReadMessage()
	require.NoError(t, err)

	var event WSEvent
	require.NoError(t, json.Unmarshal(payload, &event))
	assert.Equal(t, "error", event.Type)
	assert.Equal(t, "run_id is required", event.Error)
	assert.False(t, called)
}
