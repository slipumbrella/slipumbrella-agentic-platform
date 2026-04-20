package service

import (
	"context"
	"io"
	"testing"

	"capstone-prog/core/model"
	"capstone-prog/proto"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

type stopChatRepo struct {
	ownerID       uuid.UUID
	appendCount   int
	appendMessage []*model.ChatMessage
}

func (f *stopChatRepo) CreateSession(context.Context, *model.ChatSession) (string, error) {
	panic("unexpected call")
}

func (f *stopChatRepo) GetSession(context.Context, string) (*model.ChatSession, error) {
	panic("unexpected call")
}

func (f *stopChatRepo) AppendMessage(_ context.Context, chatMessage *model.ChatMessage) error {
	f.appendCount++
	f.appendMessage = append(f.appendMessage, chatMessage)
	return nil
}

func (f *stopChatRepo) GetMessages(context.Context, string) ([]model.ChatMessage, error) {
	panic("unexpected call")
}

func (f *stopChatRepo) ListSessions(context.Context, uuid.UUID) ([]*model.ChatSession, error) {
	panic("unexpected call")
}

func (f *stopChatRepo) GetSessionOwner(context.Context, uuid.UUID) (uuid.UUID, error) {
	return f.ownerID, nil
}

type stopAgentSessionRepo struct {
	listExecutionSessionsFn func(context.Context, uuid.UUID) ([]*model.AgentSession, error)
}

func (f *stopAgentSessionRepo) ListExecutionSessions(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error) {
	return f.listExecutionSessionsFn(ctx, userID)
}

func (f *stopAgentSessionRepo) ListUnassignedSessions(context.Context, uuid.UUID) ([]*model.AgentSession, error) {
	panic("unexpected call")
}

func (f *stopAgentSessionRepo) GetLatestPlan(context.Context, string) (*model.Plan, error) {
	panic("unexpected call")
}

func (f *stopAgentSessionRepo) GetSession(context.Context, string, uuid.UUID) (*model.AgentSession, error) {
	panic("unexpected call")
}

func (f *stopAgentSessionRepo) GetLatestByPlanningSessionID(context.Context, string, uuid.UUID) (*model.AgentSession, error) {
	panic("unexpected call")
}

func (f *stopAgentSessionRepo) PatchMetadata(context.Context, string, map[string]any) error {
	panic("unexpected call")
}

func (f *stopAgentSessionRepo) SetSessionUserID(context.Context, string, uuid.UUID) error {
	panic("unexpected call")
}

type fakeCoreAgentClient struct {
	chatFn    func(context.Context, *proto.ChatRequest, ...grpc.CallOption) (grpc.ServerStreamingClient[proto.ChatResponse], error)
	stopRunFn func(context.Context, *proto.StopRunRequest, ...grpc.CallOption) (*proto.StopRunResponse, error)
}

func (f *fakeCoreAgentClient) Chat(ctx context.Context, in *proto.ChatRequest, opts ...grpc.CallOption) (grpc.ServerStreamingClient[proto.ChatResponse], error) {
	return f.chatFn(ctx, in, opts...)
}

func (f *fakeCoreAgentClient) GetAgentList(context.Context, *proto.ChatRequest, ...grpc.CallOption) (grpc.ServerStreamingClient[proto.AgentListResponse], error) {
	panic("unexpected call")
}

func (f *fakeCoreAgentClient) ExecutePlan(context.Context, *proto.ExecutePlanRequest, ...grpc.CallOption) (*proto.ExecutePlanResponse, error) {
	panic("unexpected call")
}

func (f *fakeCoreAgentClient) StopRun(ctx context.Context, in *proto.StopRunRequest, opts ...grpc.CallOption) (*proto.StopRunResponse, error) {
	return f.stopRunFn(ctx, in, opts...)
}

func (f *fakeCoreAgentClient) EvaluateRAG(context.Context, *proto.EvaluateRAGRequest, ...grpc.CallOption) (*proto.EvaluateRAGResponse, error) {
	panic("unexpected call")
}

type fakeChatStream struct {
	ctx       context.Context
	responses []*proto.ChatResponse
	index     int
}

func (f *fakeChatStream) Header() (metadata.MD, error) { return metadata.MD{}, nil }
func (f *fakeChatStream) Trailer() metadata.MD         { return metadata.MD{} }
func (f *fakeChatStream) CloseSend() error             { return nil }
func (f *fakeChatStream) Context() context.Context {
	if f.ctx != nil {
		return f.ctx
	}
	return context.Background()
}
func (f *fakeChatStream) SendMsg(any) error { return nil }
func (f *fakeChatStream) RecvMsg(any) error { return nil }

func (f *fakeChatStream) Recv() (*proto.ChatResponse, error) {
	if f.index >= len(f.responses) {
		return nil, io.EOF
	}
	resp := f.responses[f.index]
	f.index++
	return resp, nil
}

func TestBuilderService_StopRunForwardsExecutionSessionAndRunID(t *testing.T) {
	userID := uuid.New()
	executionSessionID := uuid.New().String()
	runID := "run-123"

	var gotRequest *proto.StopRunRequest
	grpcClient := &fakeCoreAgentClient{
		stopRunFn: func(_ context.Context, in *proto.StopRunRequest, _ ...grpc.CallOption) (*proto.StopRunResponse, error) {
			gotRequest = in
			return &proto.StopRunResponse{
				ExecutionSessionId: executionSessionID,
				RunId:              runID,
				Status:             "accepted",
				Message:            "Stop requested.",
			}, nil
		},
	}
	agentRepo := &stopAgentSessionRepo{
		listExecutionSessionsFn: func(context.Context, uuid.UUID) ([]*model.AgentSession, error) {
			return []*model.AgentSession{{SessionID: executionSessionID}}, nil
		},
	}

	svc := NewBuilderService(nil, agentRepo, nil, nil, nil, grpcClient, nil).(*builderServiceImpl)
	svc.rememberExecutionRun(executionSessionID, runID)

	result, err := svc.StopRun(context.Background(), executionSessionID, runID, userID)
	require.NoError(t, err)
	require.NotNil(t, gotRequest)
	assert.Equal(t, executionSessionID, gotRequest.GetExecutionSessionId())
	assert.Equal(t, runID, gotRequest.GetRunId())
	assert.Equal(t, "accepted", result.Status)
	assert.Equal(t, "Stop requested.", result.Message)
}

func TestBuilderService_StopRunReturnsAcceptedForDuplicateStopRequest(t *testing.T) {
	userID := uuid.New()
	executionSessionID := uuid.New().String()
	runID := "run-123"
	stopCalls := 0
	grpcClient := &fakeCoreAgentClient{
		stopRunFn: func(_ context.Context, in *proto.StopRunRequest, _ ...grpc.CallOption) (*proto.StopRunResponse, error) {
			stopCalls++
			return &proto.StopRunResponse{
				ExecutionSessionId: in.GetExecutionSessionId(),
				RunId:              in.GetRunId(),
				Status:             "accepted",
				Message:            "Stop requested.",
			}, nil
		},
	}
	agentRepo := &stopAgentSessionRepo{listExecutionSessionsFn: func(context.Context, uuid.UUID) ([]*model.AgentSession, error) {
		return []*model.AgentSession{{SessionID: executionSessionID}}, nil
	}}

	svc := NewBuilderService(nil, agentRepo, nil, nil, nil, grpcClient, nil).(*builderServiceImpl)
	svc.rememberExecutionRun(executionSessionID, runID)

	first, err := svc.StopRun(context.Background(), executionSessionID, runID, userID)
	require.NoError(t, err)
	second, err := svc.StopRun(context.Background(), executionSessionID, runID, userID)
	require.NoError(t, err)
	assert.Equal(t, "accepted", first.Status)
	assert.Equal(t, "accepted", second.Status)
	assert.Equal(t, "Stop already requested.", second.Message)
	assert.Equal(t, 1, stopCalls)
}

func TestBuilderService_StopRunReturnsNotFoundForStaleRun(t *testing.T) {
	userID := uuid.New()
	executionSessionID := uuid.New().String()
	grpcClient := &fakeCoreAgentClient{}
	agentRepo := &stopAgentSessionRepo{listExecutionSessionsFn: func(context.Context, uuid.UUID) ([]*model.AgentSession, error) {
		return []*model.AgentSession{{SessionID: executionSessionID}}, nil
	}}

	svc := NewBuilderService(nil, agentRepo, nil, nil, nil, grpcClient, nil).(*builderServiceImpl)
	svc.rememberExecutionRun(executionSessionID, "run-active")

	result, err := svc.StopRun(context.Background(), executionSessionID, "run-stale", userID)
	require.NoError(t, err)
	assert.Equal(t, "not_found", result.Status)
}

func TestBuilderService_StreamChatPreservesRunIDAndWorkflowStoppedEvent(t *testing.T) {
	userID := uuid.New()
	sessionID := uuid.New()
	runID := "run-456"
	chatRepo := &stopChatRepo{ownerID: userID}
	grpcClient := &fakeCoreAgentClient{
		chatFn: func(context.Context, *proto.ChatRequest, ...grpc.CallOption) (grpc.ServerStreamingClient[proto.ChatResponse], error) {
			return &fakeChatStream{responses: []*proto.ChatResponse{
				{
					SessionId: sessionID.String(),
					AgentId:   "CoreAgent",
					RunId:     runID,
					Payload: &proto.ChatResponse_WorkflowStarted{WorkflowStarted: &proto.WorkflowStartedEvent{
						TraceId:            "trace-1",
						ExecutionSessionId: sessionID.String(),
						Orchestration:      "sequential",
						Status:             "running",
						Summary:            "Run started",
					}},
				},
				{
					SessionId: sessionID.String(),
					AgentId:   "CoreAgent",
					RunId:     runID,
					Payload: &proto.ChatResponse_WorkflowStopped{WorkflowStopped: &proto.WorkflowStoppedEvent{
						TraceId:            "trace-1",
						ExecutionSessionId: sessionID.String(),
						Orchestration:      "sequential",
						Status:             "stopped",
						Summary:            "Workflow stopped.",
						StoppedAt:          "2026-04-06T10:00:00Z",
						RunId:              runID,
					}},
				},
			}}, nil
		},
	}

	svc := NewBuilderService(chatRepo, nil, nil, nil, nil, grpcClient, nil)
	chatMessage := &model.ChatMessage{
		ID:        uuid.New(),
		SessionID: sessionID,
		Role:      "user",
		Content:   "stop this run",
	}

	var events []*StreamEvent
	err := svc.StreamChat(context.Background(), chatMessage, "", "", userID, func(event *StreamEvent) {
		events = append(events, event)
	})

	require.NoError(t, err)
	require.Len(t, events, 2)
	assert.Equal(t, "workflow_started", events[0].Type)
	assert.Equal(t, runID, events[0].RunID)
	assert.Equal(t, runID, events[0].Workflow.RunID)
	assert.Equal(t, "workflow_stopped", events[1].Type)
	assert.Equal(t, runID, events[1].RunID)
	assert.Equal(t, runID, events[1].Workflow.RunID)
	assert.Equal(t, "2026-04-06T10:00:00Z", events[1].Workflow.StoppedAt)
	assert.Equal(t, 1, chatRepo.appendCount)
}
