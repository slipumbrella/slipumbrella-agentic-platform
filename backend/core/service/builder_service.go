package service

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"capstone-prog/proto"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var ErrForbidden = errors.New("forbidden")
var ErrNotFound = errors.New("not found")

// StreamEvent represents a typed event from the gRPC chat stream.
type StreamEvent struct {
	Type               string // "chunk", "builder_think", "plan_created", "session_renamed", "workflow_*", "error"
	RunID              string
	Chunk              string           // text chunk (when Type == "chunk" or "builder_think")
	AgentID            string           // agent that produced the chunk (when Type == "chunk" or "builder_think")
	PlanCreated        *PlanCreatedData // structured plan data (when Type == "plan_created")
	Workflow           *WorkflowTraceEventData
	SessionTitle       string                  // renamed title (when Type == "session_renamed")
	Error              string                  // error message (when Type == "error")
	PresentationPrompt *PresentationPromptData // NEW: leader choice prompt for workflow presentation
}

// PresentationPromptData carries the leader's choice prompt for workflow presentation.
type PresentationPromptData struct {
	PromptID        string
	Question        string
	OriginalMessage string
}

// PlanCreatedData holds structured plan information from a plan_created event.
type PlanCreatedData struct {
	PlanID        string
	Orchestration string
	Agents        []AgentInfoData
}

// AgentInfoData describes one agent within a plan.
type AgentInfoData struct {
	ID       string
	Role     string
	Goal     string
	Tools    []string
	Model    string
	Order    int
	IsLeader bool
}

// ThinkingItem represents one content item from an agent's full conversation chain.
type ThinkingItem struct {
	Role        string `json:"role"`
	ContentType string `json:"content_type"`
	Text        string `json:"text,omitempty"`
	ToolName    string `json:"tool_name,omitempty"`
	Arguments   string `json:"arguments,omitempty"`
}

// WorkflowTraceEventData is the stable sideband payload forwarded over WebSocket.
type WorkflowTraceEventData struct {
	TraceID            string              `json:"trace_id"`
	ExecutionSessionID string              `json:"execution_session_id"`
	RunID              string              `json:"run_id,omitempty"`
	Orchestration      string              `json:"orchestration"`
	Status             string              `json:"status"`
	Summary            string              `json:"summary"`
	AgentID            string              `json:"agent_id,omitempty"`
	AgentRole          string              `json:"agent_role,omitempty"`
	IsLeader           bool                `json:"is_leader,omitempty"`
	Order              int                 `json:"order,omitempty"`
	Preview            string              `json:"preview,omitempty"`
	Response           string              `json:"response,omitempty"`
	Error              string              `json:"error,omitempty"`
	StartedAt          string              `json:"started_at,omitempty"`
	CompletedAt        string              `json:"completed_at,omitempty"`
	StoppedAt          string              `json:"stopped_at,omitempty"`
	Thinking           []ThinkingItem      `json:"thinking,omitempty"`
	Nodes              []WorkflowTraceNode `json:"nodes,omitempty"`
}

func workflowTraceNodesFromProto(nodes []*proto.WorkflowTraceNode) []WorkflowTraceNode {
	if len(nodes) == 0 {
		return nil
	}

	result := make([]WorkflowTraceNode, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}

		thinking := make([]ThinkingItem, 0, len(node.GetThinking()))
		for _, item := range node.GetThinking() {
			thinking = append(thinking, ThinkingItem{
				Role:        item.GetRole(),
				ContentType: item.GetContentType(),
				Text:        item.GetText(),
				ToolName:    item.GetToolName(),
				Arguments:   item.GetArguments(),
			})
		}

		result = append(result, WorkflowTraceNode{
			AgentID:     node.GetAgentId(),
			AgentRole:   node.GetAgentRole(),
			IsLeader:    node.GetIsLeader(),
			Order:       int(node.GetOrder()),
			Status:      node.GetStatus(),
			Preview:     node.GetPreview(),
			Response:    node.GetResponse(),
			Error:       node.GetError(),
			StartedAt:   node.GetStartedAt(),
			CompletedAt: node.GetCompletedAt(),
			Thinking:    thinking,
		})
	}

	return result
}

type StopRunResult struct {
	ExecutionSessionID string `json:"execution_session_id"`
	RunID              string `json:"run_id"`
	Status             string `json:"status"`
	Message            string `json:"message,omitempty"`
}

// WorkflowTraceSummary is the stable DTO for listing stored workflow traces.
type WorkflowTraceSummary struct {
	TraceID            string `json:"trace_id"`
	ExecutionSessionID string `json:"execution_session_id"`
	Orchestration      string `json:"orchestration"`
	Status             string `json:"status"`
	Summary            string `json:"summary"`
	StartedAt          string `json:"started_at,omitempty"`
	CompletedAt        string `json:"completed_at,omitempty"`
	UpdatedAt          string `json:"updated_at"`
}

// WorkflowTraceNode is the stable DTO for a persisted workflow node.
type WorkflowTraceNode struct {
	AgentID     string         `json:"agent_id,omitempty"`
	AgentRole   string         `json:"agent_role,omitempty"`
	IsLeader    bool           `json:"is_leader,omitempty"`
	Order       int            `json:"order,omitempty"`
	Status      string         `json:"status,omitempty"`
	Preview     string         `json:"preview,omitempty"`
	Response    string         `json:"response,omitempty"`
	Error       string         `json:"error,omitempty"`
	StartedAt   string         `json:"started_at,omitempty"`
	CompletedAt string         `json:"completed_at,omitempty"`
	Thinking    []ThinkingItem `json:"thinking,omitempty"`
}

// WorkflowTraceDetail is the stable DTO for reopening a stored workflow trace.
type WorkflowTraceDetail struct {
	WorkflowTraceSummary
	Nodes []WorkflowTraceNode `json:"nodes"`
}

// PlannedSessionView is a response DTO for planning chat sessions belonging to a user.
type PlannedSessionView struct {
	SessionID string `json:"session_id"`
	Title     string `json:"title"`
	CreatedAt string `json:"created_at"`
}

// ExecutionSessionView is a response DTO that enriches AgentSession with a title
// derived from the planning ChatSession.
type ExecutionSessionView struct {
	SessionID         string       `json:"session_id"`
	Title             string       `json:"title"`
	Type              string       `json:"type"`
	PlanningSessionID *string      `json:"planning_session_id,omitempty"`
	TeamID            *uuid.UUID   `json:"team_id,omitempty"`
	CreatedAt         string       `json:"created_at"`
	Plans             []model.Plan `json:"plans,omitempty"`
}

type ModelAssignmentsState struct {
	Baseline    map[string]string `json:"baseline"`
	Overrides   map[string]string `json:"overrides"`
	Final       map[string]string `json:"final"`
	Confirmed   bool              `json:"confirmed"`
	ReviewedAt  *string           `json:"reviewed_at,omitempty"`
	ConfirmedAt *string           `json:"confirmed_at,omitempty"`
}

type BuilderService interface {
	StreamChat(ctx context.Context, chatMessage *model.ChatMessage, targetAgentID string, presentationMode string, userID uuid.UUID, onEvent func(*StreamEvent)) error
	CreateSession(ctx context.Context, session *model.ChatSession) (string, error)
	ExecutePlan(ctx context.Context, planningSessionID string, teamID string, lineToken string, userID uuid.UUID) (string, error)
	GetSessionPlan(ctx context.Context, sessionID string) (*model.Plan, error)
	GetPlanningSessionPlan(ctx context.Context, sessionID string, userID uuid.UUID) (*model.Plan, error)
	ListExecutionSessions(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error)
	ListExecutionSessionViews(ctx context.Context, userID uuid.UUID) ([]ExecutionSessionView, error)
	ListPlanningSessions(ctx context.Context, userID uuid.UUID) ([]PlannedSessionView, error)
	GetMessages(ctx context.Context, sessionID string, userID uuid.UUID) ([]model.ChatMessage, error)
	ListWorkflowTraces(ctx context.Context, sessionID string, userID uuid.UUID) ([]WorkflowTraceSummary, error)
	GetWorkflowTrace(ctx context.Context, traceID string, userID uuid.UUID) (*WorkflowTraceDetail, error)
	GetArtifacts(ctx context.Context, teamID string) ([]model.Artifact, error)
	GetArtifactByID(ctx context.Context, id string, userID uuid.UUID) (*model.Artifact, error)
	ValidateExecSessionOwner(ctx context.Context, sessionID string, userID uuid.UUID) error
	SendMessage(ctx context.Context, sessionID string, message string, userID uuid.UUID) (string, error)
	StopRun(ctx context.Context, executionSessionID string, runID string, userID uuid.UUID) (*StopRunResult, error)
	ValidateSessionOwner(ctx context.Context, sessionID string, userID uuid.UUID) error
	GetLatestSessionByPlanningID(ctx context.Context, planningSessionID string, userID uuid.UUID) (*ExecutionSessionView, error)
	GetModelAssignments(ctx context.Context, sessionID string, userID uuid.UUID) (*ModelAssignmentsState, error)
	SaveModelAssignmentsDraft(ctx context.Context, sessionID string, userID uuid.UUID, state ModelAssignmentsState) error
	ConfirmModelAssignments(ctx context.Context, sessionID string, userID uuid.UUID) error
}

type builderServiceImpl struct {
	chatRepo         repository.ChatRepository
	agentSessionRepo repository.AgentSessionRepository
	teamRepo         repository.TeamRepository
	snapshotRepo     repository.SessionSnapshotRepository
	artifactRepo     repository.ArtifactRepository
	coreAgentGrpc    proto.CoreAgentClient
	tokenUsageRepo   repository.TokenUsageRepository
	executionRunMu   sync.Mutex
	executionRuns    map[string]executionRunState
}

type executionRunState struct {
	RunID         string
	StopRequested bool
}

func NewBuilderService(
	chatRepo repository.ChatRepository,
	agentSessionRepo repository.AgentSessionRepository,
	teamRepo repository.TeamRepository,
	snapshotRepo repository.SessionSnapshotRepository,
	artifactRepo repository.ArtifactRepository,
	coreAgentGrpc proto.CoreAgentClient,
	tokenUsageRepo repository.TokenUsageRepository,
) BuilderService {
	return &builderServiceImpl{
		chatRepo:         chatRepo,
		agentSessionRepo: agentSessionRepo,
		teamRepo:         teamRepo,
		snapshotRepo:     snapshotRepo,
		artifactRepo:     artifactRepo,
		coreAgentGrpc:    coreAgentGrpc,
		tokenUsageRepo:   tokenUsageRepo,
		executionRuns:    map[string]executionRunState{},
	}
}

func (s *builderServiceImpl) rememberExecutionRun(executionSessionID string, runID string) {
	if strings.TrimSpace(executionSessionID) == "" || strings.TrimSpace(runID) == "" {
		return
	}
	s.executionRunMu.Lock()
	defer s.executionRunMu.Unlock()
	s.executionRuns[executionSessionID] = executionRunState{RunID: runID}
}

func (s *builderServiceImpl) clearExecutionRun(executionSessionID string, runID string) {
	if strings.TrimSpace(executionSessionID) == "" || strings.TrimSpace(runID) == "" {
		return
	}
	s.executionRunMu.Lock()
	defer s.executionRunMu.Unlock()
	current, ok := s.executionRuns[executionSessionID]
	if ok && current.RunID == runID {
		delete(s.executionRuns, executionSessionID)
	}
}

func (s *builderServiceImpl) markExecutionRunStopping(executionSessionID string, runID string) (bool, bool) {
	if strings.TrimSpace(executionSessionID) == "" || strings.TrimSpace(runID) == "" {
		return false, false
	}
	s.executionRunMu.Lock()
	defer s.executionRunMu.Unlock()
	current, ok := s.executionRuns[executionSessionID]
	if !ok || current.RunID != runID {
		return false, false
	}
	if current.StopRequested {
		return true, true
	}
	current.StopRequested = true
	s.executionRuns[executionSessionID] = current
	return false, true
}

func (s *builderServiceImpl) clearExecutionRunStopRequest(executionSessionID string, runID string) {
	if strings.TrimSpace(executionSessionID) == "" || strings.TrimSpace(runID) == "" {
		return
	}
	s.executionRunMu.Lock()
	defer s.executionRunMu.Unlock()
	current, ok := s.executionRuns[executionSessionID]
	if ok && current.RunID == runID {
		current.StopRequested = false
		s.executionRuns[executionSessionID] = current
	}
}

func (s *builderServiceImpl) CreateSession(ctx context.Context, session *model.ChatSession) (string, error) {
	return s.chatRepo.CreateSession(ctx, session)
}

// StreamChat saves the user message, calls the gRPC Chat stream, dispatches typed
// StreamEvents for each payload variant, and saves the full assembled reply to DB when done.
func (s *builderServiceImpl) StreamChat(ctx context.Context, chatMessage *model.ChatMessage, targetAgentID string, presentationMode string, userID uuid.UUID, onEvent func(*StreamEvent)) error {
	// Validate that the planning session belongs to the requesting user.
	// uuid.Nil is used by internal/system callers (e.g. WS, LINE webhook) that bypass ownership checks.
	if userID != uuid.Nil {
		ownerID, err := s.chatRepo.GetSessionOwner(ctx, chatMessage.SessionID)
		if err != nil {
			return ErrNotFound
		}
		if ownerID != userID {
			return ErrForbidden
		}
	}

	if err := s.chatRepo.AppendMessage(ctx, chatMessage); err != nil {
		return err
	}

	stream, err := s.coreAgentGrpc.Chat(ctx, &proto.ChatRequest{
		SessionId:        chatMessage.SessionID.String(),
		TargetAgentId:    targetAgentID,
		Message:          chatMessage.Content,
		PresentationMode: presentationMode,
	})
	if err != nil {
		return fmt.Errorf("gRPC Chat stream: %w", err)
	}

	var replyBuilder strings.Builder
	var thinkBuilder strings.Builder
	for {
		resp, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("gRPC Chat stream recv: %w", err)
		}

		runID := resp.GetRunId()
		executionSessionID := chatMessage.SessionID.String()

		switch p := resp.GetPayload().(type) {
		case *proto.ChatResponse_Reply:
			s.rememberExecutionRun(executionSessionID, runID)
			chunk := p.Reply
			if chunk != "" {
				if resp.GetAgentId() == "BuilderAgent" {
					thinkBuilder.WriteString(chunk)
					onEvent(&StreamEvent{Type: "builder_think", RunID: runID, Chunk: chunk, AgentID: resp.GetAgentId()})
				} else {
					replyBuilder.WriteString(chunk)
					onEvent(&StreamEvent{Type: "chunk", RunID: runID, Chunk: chunk, AgentID: resp.GetAgentId()})
				}
			}
		case *proto.ChatResponse_PlanCreated:
			s.rememberExecutionRun(executionSessionID, runID)
			plan := p.PlanCreated
			agents := make([]AgentInfoData, 0, len(plan.GetAgents()))
			for _, a := range plan.GetAgents() {
				agents = append(agents, AgentInfoData{
					ID:       a.GetId(),
					Role:     a.GetRole(),
					Goal:     a.GetGoal(),
					Tools:    a.GetTools(),
					Model:    a.GetModel(),
					Order:    int(a.GetOrder()),
					IsLeader: a.GetIsLeader(),
				})
			}
			onEvent(&StreamEvent{
				Type:  "plan_created",
				RunID: runID,
				PlanCreated: &PlanCreatedData{
					PlanID:        plan.GetPlanId(),
					Orchestration: plan.GetOrchestration(),
					Agents:        agents,
				},
			})
		case *proto.ChatResponse_SessionRenamed:
			s.rememberExecutionRun(executionSessionID, runID)
			sr := p.SessionRenamed
			if sr != nil && sr.GetTitle() != "" {
				onEvent(&StreamEvent{
					Type:         "session_renamed",
					RunID:        runID,
					SessionTitle: sr.GetTitle(),
				})
			}
		case *proto.ChatResponse_WorkflowStarted:
			data := p.WorkflowStarted
			executionSessionID = firstNonEmpty(data.GetExecutionSessionId(), executionSessionID)
			s.rememberExecutionRun(executionSessionID, runID)
			onEvent(&StreamEvent{
				Type:    "workflow_started",
				RunID:   runID,
				AgentID: resp.GetAgentId(),
				Workflow: &WorkflowTraceEventData{
					TraceID:            data.GetTraceId(),
					ExecutionSessionID: data.GetExecutionSessionId(),
					RunID:              runID,
					Orchestration:      data.GetOrchestration(),
					Status:             data.GetStatus(),
					Summary:            data.GetSummary(),
				},
			})
		case *proto.ChatResponse_WorkflowNodeUpdated:
			data := p.WorkflowNodeUpdated
			executionSessionID = firstNonEmpty(data.GetExecutionSessionId(), executionSessionID)
			s.rememberExecutionRun(executionSessionID, runID)
			thinking := make([]ThinkingItem, 0, len(data.GetThinking()))
			for _, t := range data.GetThinking() {
				thinking = append(thinking, ThinkingItem{
					Role:        t.GetRole(),
					ContentType: t.GetContentType(),
					Text:        t.GetText(),
					ToolName:    t.GetToolName(),
					Arguments:   t.GetArguments(),
				})
			}
			onEvent(&StreamEvent{
				Type:    "workflow_node_updated",
				RunID:   runID,
				AgentID: resp.GetAgentId(),
				Workflow: &WorkflowTraceEventData{
					TraceID:            data.GetTraceId(),
					ExecutionSessionID: data.GetExecutionSessionId(),
					RunID:              runID,
					Orchestration:      data.GetOrchestration(),
					Status:             data.GetStatus(),
					Summary:            data.GetSummary(),
					AgentID:            data.GetAgentId(),
					AgentRole:          data.GetAgentRole(),
					IsLeader:           data.GetIsLeader(),
					Order:              int(data.GetOrder()),
					Preview:            data.GetPreview(),
					Response:           data.GetResponse(),
					Error:              data.GetError(),
					StartedAt:          data.GetStartedAt(),
					CompletedAt:        data.GetCompletedAt(),
					Thinking:           thinking,
				},
			})
		case *proto.ChatResponse_WorkflowCompleted:
			data := p.WorkflowCompleted
			executionSessionID = firstNonEmpty(data.GetExecutionSessionId(), executionSessionID)
			onEvent(&StreamEvent{
				Type:    "workflow_completed",
				RunID:   runID,
				AgentID: resp.GetAgentId(),
				Workflow: &WorkflowTraceEventData{
					TraceID:            data.GetTraceId(),
					ExecutionSessionID: data.GetExecutionSessionId(),
					RunID:              runID,
					Orchestration:      data.GetOrchestration(),
					Status:             data.GetStatus(),
					Summary:            data.GetSummary(),
					CompletedAt:        data.GetCompletedAt(),
					Nodes:              workflowTraceNodesFromProto(data.GetNodes()),
				},
			})
			s.clearExecutionRun(executionSessionID, runID)
		case *proto.ChatResponse_WorkflowFailed:
			data := p.WorkflowFailed
			executionSessionID = firstNonEmpty(data.GetExecutionSessionId(), executionSessionID)
			onEvent(&StreamEvent{
				Type:    "workflow_failed",
				RunID:   runID,
				AgentID: resp.GetAgentId(),
				Workflow: &WorkflowTraceEventData{
					TraceID:            data.GetTraceId(),
					ExecutionSessionID: data.GetExecutionSessionId(),
					RunID:              runID,
					Orchestration:      data.GetOrchestration(),
					Status:             data.GetStatus(),
					Summary:            data.GetSummary(),
					Error:              data.GetError(),
					CompletedAt:        data.GetCompletedAt(),
					Nodes:              workflowTraceNodesFromProto(data.GetNodes()),
				},
			})
			s.clearExecutionRun(executionSessionID, runID)
		case *proto.ChatResponse_WorkflowStopped:
			data := p.WorkflowStopped
			executionSessionID = firstNonEmpty(data.GetExecutionSessionId(), executionSessionID)
			eventRunID := firstNonEmpty(data.GetRunId(), runID)
			onEvent(&StreamEvent{
				Type:    "workflow_stopped",
				RunID:   eventRunID,
				AgentID: resp.GetAgentId(),
				Workflow: &WorkflowTraceEventData{
					TraceID:            data.GetTraceId(),
					ExecutionSessionID: data.GetExecutionSessionId(),
					RunID:              eventRunID,
					Orchestration:      data.GetOrchestration(),
					Status:             data.GetStatus(),
					Summary:            data.GetSummary(),
					StoppedAt:          data.GetStoppedAt(),
					Nodes:              workflowTraceNodesFromProto(data.GetNodes()),
				},
			})
			s.clearExecutionRun(executionSessionID, eventRunID)
		case *proto.ChatResponse_WorkflowPresentationPrompt:
			s.rememberExecutionRun(executionSessionID, runID)
			pp := p.WorkflowPresentationPrompt
			if pp != nil {
				onEvent(&StreamEvent{
					Type:  "workflow_presentation_prompt",
					RunID: runID,
					PresentationPrompt: &PresentationPromptData{
						PromptID:        pp.GetPromptId(),
						Question:        pp.GetQuestion(),
						OriginalMessage: pp.GetOriginalMessage(),
					},
				})
			}
		case *proto.ChatResponse_Error:
			s.rememberExecutionRun(executionSessionID, runID)
			onEvent(&StreamEvent{Type: "error", RunID: runID, Error: p.Error})
		case *proto.ChatResponse_TokenUsage:
			s.rememberExecutionRun(executionSessionID, runID)
			tu := p.TokenUsage
			if tu != nil && s.tokenUsageRepo != nil {
				if err := s.tokenUsageRepo.Create(ctx, &model.TokenUsage{
					SessionID:    resp.GetSessionId(),
					AgentID:      tu.GetAgentId(),
					ModelID:      tu.GetModelId(),
					InputTokens:  int(tu.GetInputTokens()),
					OutputTokens: int(tu.GetOutputTokens()),
				}); err != nil {
					slog.Error("failed to persist token usage", "session_id", resp.GetSessionId(), "agent_id", tu.GetAgentId(), "model_id", tu.GetModelId(), "err", err)
				}
			}
			// Token usage is internal only — not forwarded to the client
		default:
			s.rememberExecutionRun(executionSessionID, runID)
			// Fallback for backward compatibility — treat as plain chunk
			chunk := resp.GetReply()
			if chunk != "" {
				if resp.GetAgentId() == "BuilderAgent" {
					thinkBuilder.WriteString(chunk)
					onEvent(&StreamEvent{Type: "builder_think", RunID: runID, Chunk: chunk, AgentID: resp.GetAgentId()})
				} else {
					replyBuilder.WriteString(chunk)
					onEvent(&StreamEvent{Type: "chunk", RunID: runID, Chunk: chunk, AgentID: resp.GetAgentId()})
				}
			}
			slog.Debug("Unknown gRPC payload type", "session_id", resp.GetSessionId())
		}
	}

	reply := replyBuilder.String()
	thinkContent := thinkBuilder.String()
	if strings.TrimSpace(reply) == "" && strings.TrimSpace(thinkContent) == "" {
		return nil
	}

	// Build Meta JSON — include think_content if the builder agent produced any
	metaJSON := []byte("{}")
	if thinkContent != "" {
		encoded, err := json.Marshal(map[string]string{"think_content": thinkContent})
		if err == nil {
			metaJSON = encoded
		}
	}

	response := &model.ChatMessage{
		ID:        uuid.New(),
		SessionID: chatMessage.SessionID,
		Role:      "assistant",
		Content:   reply,
		Meta:      metaJSON,
	}
	return s.chatRepo.AppendMessage(ctx, response)

}

func (s *builderServiceImpl) ExecutePlan(ctx context.Context, planningSessionID string, teamID string, lineToken string, userID uuid.UUID) (string, error) {
	resp, err := s.coreAgentGrpc.ExecutePlan(ctx, &proto.ExecutePlanRequest{
		SessionId: planningSessionID,
	})
	if err != nil {
		return "", fmt.Errorf("ExecutePlan gRPC: %w", err)
	}

	execSessionID := resp.GetSessionId()

	// Create a ChatSession row for the execution session so that
	// chat_messages written by the execution WS handler have a valid FK target.
	execUUID, err := uuid.Parse(execSessionID)
	if err != nil {
		return "", fmt.Errorf("invalid exec session UUID: %w", err)
	}
	// Inherit the owner from the planning session so user_id (NOT NULL) is set.
	var ownerID uuid.UUID
	if planSess, pErr := s.chatRepo.GetSession(ctx, planningSessionID); pErr == nil {
		ownerID = planSess.UserID
	}
	chatSession := &model.ChatSession{
		ID:     execUUID,
		Title:  "Execution: " + planningSessionID[:8],
		Type:   model.ChatSessionTypeExecution,
		UserID: ownerID,
	}
	if _, err := s.chatRepo.CreateSession(ctx, chatSession); err != nil {
		// Log but don't fail — the execution session is already created on the Python side.
		fmt.Printf("warning: failed to create chat session for execution %s: %v\n", execSessionID, err)
	}

	if teamID != "" {
		patch := map[string]any{"team_id": teamID}
		if lineToken != "" {
			patch["line_channel_access_token"] = lineToken
		}
		if err := s.agentSessionRepo.PatchMetadata(ctx, execSessionID, patch); err != nil {
			fmt.Printf("warning: failed to patch metadata for session %s: %v\n", execSessionID, err)
		}
	}

	// Stamp user ownership on the execution session created by the Python agent.
	if err := s.agentSessionRepo.SetSessionUserID(ctx, execSessionID, userID); err != nil {
		slog.Warn("failed to stamp user_id on execution session", "session_id", execSessionID, "err", err)
		// Non-fatal: log and continue.
	}

	return execSessionID, nil
}

func (s *builderServiceImpl) GetSessionPlan(ctx context.Context, sessionID string) (*model.Plan, error) {
	return s.agentSessionRepo.GetLatestPlan(ctx, sessionID)
}

func (s *builderServiceImpl) GetPlanningSessionPlan(ctx context.Context, sessionID string, userID uuid.UUID) (*model.Plan, error) {
	if err := s.authorizePlanningSessionAccess(ctx, sessionID, userID); err != nil {
		return nil, err
	}
	return s.agentSessionRepo.GetLatestPlan(ctx, sessionID)
}

func (s *builderServiceImpl) ListExecutionSessions(ctx context.Context, userID uuid.UUID) ([]*model.AgentSession, error) {
	return s.agentSessionRepo.ListExecutionSessions(ctx, userID)
}

func (s *builderServiceImpl) ListExecutionSessionViews(ctx context.Context, userID uuid.UUID) ([]ExecutionSessionView, error) {
	sessions, err := s.agentSessionRepo.ListExecutionSessions(ctx, userID)
	if err != nil {
		return nil, err
	}

	views := make([]ExecutionSessionView, 0, len(sessions))
	for _, sess := range sessions {
		title := "Session " + sess.SessionID[:8]
		// Look up the planning chat session to get a human-readable title.
		if sess.PlanningSessionID != nil {
			chatSess, err := s.chatRepo.GetSession(ctx, *sess.PlanningSessionID)
			if err == nil && chatSess.Title != "" {
				title = chatSess.Title
			}
		}
		views = append(views, ExecutionSessionView{
			SessionID:         sess.SessionID,
			Title:             title,
			Type:              sess.Type,
			PlanningSessionID: sess.PlanningSessionID,
			TeamID:            sess.TeamID,
			CreatedAt:         sess.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			Plans:             sess.Plans,
		})
	}
	return views, nil
}

func (s *builderServiceImpl) GetLatestSessionByPlanningID(ctx context.Context, planningSessionID string, userID uuid.UUID) (*ExecutionSessionView, error) {
	sess, err := s.agentSessionRepo.GetLatestByPlanningSessionID(ctx, planningSessionID, userID)
	if err != nil {
		return nil, err
	}
	if sess == nil {
		return nil, ErrNotFound
	}

	title := "Session " + sess.SessionID[:8]
	if sess.PlanningSessionID != nil {
		if chatSess, cErr := s.chatRepo.GetSession(ctx, *sess.PlanningSessionID); cErr == nil && chatSess.Title != "" {
			title = chatSess.Title
		}
	}

	view := &ExecutionSessionView{
		SessionID:         sess.SessionID,
		Title:             title,
		Type:              sess.Type,
		PlanningSessionID: sess.PlanningSessionID,
		TeamID:            sess.TeamID,
		CreatedAt:         sess.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		Plans:             sess.Plans,
	}
	return view, nil
}

func (s *builderServiceImpl) GetModelAssignments(ctx context.Context, sessionID string, userID uuid.UUID) (*ModelAssignmentsState, error) {
	if err := s.authorizePlanningSessionAccess(ctx, sessionID, userID); err != nil {
		return nil, err
	}

	plan, err := s.agentSessionRepo.GetLatestPlan(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	baseline := baselineAssignmentsFromPlan(plan)
	session, err := s.agentSessionRepo.GetSession(ctx, sessionID, userID)
	if err != nil {
		return nil, err
	}

	draft := readModelAssignmentDraft(session)

	state := &ModelAssignmentsState{
		Baseline:    baseline,
		Overrides:   draft.Overrides,
		Confirmed:   draft.Confirmed,
		ReviewedAt:  draft.ReviewedAt,
		ConfirmedAt: draft.ConfirmedAt,
	}
	state.Final = mergeAssignmentMaps(state.Baseline, state.Overrides)

	return state, nil
}

func (s *builderServiceImpl) SaveModelAssignmentsDraft(ctx context.Context, sessionID string, userID uuid.UUID, state ModelAssignmentsState) error {
	if err := s.authorizePlanningSessionAccess(ctx, sessionID, userID); err != nil {
		return err
	}

	patch := map[string]any{
		"model_assignment_draft": map[string]any{
			"baseline":    cloneAssignmentMap(state.Baseline),
			"overrides":   cloneAssignmentMap(state.Overrides),
			"confirmed":   false,
			"reviewed_at": nil,
		},
	}

	return s.agentSessionRepo.PatchMetadata(ctx, sessionID, patch)
}

func (s *builderServiceImpl) ConfirmModelAssignments(ctx context.Context, sessionID string, userID uuid.UUID) error {
	if err := s.authorizePlanningSessionAccess(ctx, sessionID, userID); err != nil {
		return err
	}

	session, err := s.agentSessionRepo.GetSession(ctx, sessionID, userID)
	if err != nil {
		return err
	}

	draft := readModelAssignmentDraft(session)
	confirmedAt := time.Now().UTC().Format(time.RFC3339)

	patch := map[string]any{
		"model_assignment_draft": map[string]any{
			"baseline":     cloneAssignmentMap(draft.Baseline),
			"overrides":    cloneAssignmentMap(draft.Overrides),
			"confirmed":    true,
			"reviewed_at":  draft.ReviewedAt,
			"confirmed_at": confirmedAt,
		},
	}

	return s.agentSessionRepo.PatchMetadata(ctx, sessionID, patch)
}

func (s *builderServiceImpl) ListPlanningSessions(ctx context.Context, userID uuid.UUID) ([]PlannedSessionView, error) {
	sessions, err := s.chatRepo.ListSessions(ctx, userID)
	if err != nil {
		return nil, err
	}
	views := make([]PlannedSessionView, 0, len(sessions))
	for _, sess := range sessions {
		views = append(views, PlannedSessionView{
			SessionID: sess.ID.String(),
			Title:     sess.Title,
			CreatedAt: sess.CreatedAt.Format(time.RFC3339),
		})
	}
	return views, nil
}

func (s *builderServiceImpl) GetMessages(ctx context.Context, sessionID string, userID uuid.UUID) ([]model.ChatMessage, error) {
	if err := s.authorizeSessionAccess(ctx, sessionID, userID); err != nil {
		return nil, err
	}
	return s.chatRepo.GetMessages(ctx, sessionID)
}

func (s *builderServiceImpl) ListWorkflowTraces(ctx context.Context, sessionID string, userID uuid.UUID) ([]WorkflowTraceSummary, error) {
	if err := s.authorizeSessionAccess(ctx, sessionID, userID); err != nil {
		return nil, err
	}

	snapshots, err := s.snapshotRepo.ListWorkflowTraces(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	traces := make([]WorkflowTraceSummary, 0, len(snapshots))
	for _, snapshot := range snapshots {
		trace, decodeErr := decodeWorkflowTraceSnapshot(snapshot)
		if decodeErr != nil {
			return nil, decodeErr
		}
		traces = append(traces, trace.WorkflowTraceSummary)
	}

	return traces, nil
}

func (s *builderServiceImpl) GetWorkflowTrace(ctx context.Context, traceID string, userID uuid.UUID) (*WorkflowTraceDetail, error) {
	snapshot, err := s.snapshotRepo.GetWorkflowTrace(ctx, traceID)
	if err != nil {
		return nil, err
	}
	if snapshot == nil {
		return nil, ErrNotFound
	}

	if err := s.authorizeSessionAccess(ctx, snapshot.SessionID, userID); err != nil {
		return nil, err
	}

	return decodeWorkflowTraceSnapshot(*snapshot)
}

func (s *builderServiceImpl) authorizeSessionAccess(ctx context.Context, sessionID string, userID uuid.UUID) error {
	sessionUUID, err := uuid.Parse(sessionID)
	if err != nil {
		return ErrNotFound
	}
	ownerID, err := s.chatRepo.GetSessionOwner(ctx, sessionUUID)
	if err != nil {
		// gorm.ErrRecordNotFound means the session does not exist → 404
		// Any other DB error is also treated as not found for safety
		return ErrNotFound
	}
	// ownerID == uuid.Nil means exec session was created without a real owner
	if ownerID == uuid.Nil || ownerID != userID {
		return ErrForbidden
	}
	return nil
}

func (s *builderServiceImpl) authorizePlanningSessionAccess(ctx context.Context, sessionID string, userID uuid.UUID) error {
	session, err := s.chatRepo.GetSession(ctx, sessionID)
	if err != nil || session == nil {
		return ErrNotFound
	}
	if session.UserID != userID {
		return ErrForbidden
	}
	return nil
}

func (s *builderServiceImpl) GetArtifacts(ctx context.Context, teamID string) ([]model.Artifact, error) {
	teamUUID, err := uuid.Parse(teamID)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.artifactRepo.GetByTeam(ctx, teamUUID)
}

func (s *builderServiceImpl) GetArtifactByID(ctx context.Context, id string, userID uuid.UUID) (*model.Artifact, error) {
	artifactUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, ErrNotFound
	}
	artifact, err := s.artifactRepo.GetByID(ctx, artifactUUID)
	if err != nil {
		return nil, err
	}
	if artifact == nil {
		return nil, ErrNotFound
	}
	if _, err := s.teamRepo.GetTeam(ctx, artifact.TeamID, userID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrForbidden
		}
		return nil, err
	}
	return artifact, nil
}

func decodeWorkflowTraceSnapshot(snapshot model.SessionSnapshot) (*WorkflowTraceDetail, error) {
	trace := &WorkflowTraceDetail{}
	if len(snapshot.Data) > 0 {
		if err := json.Unmarshal(snapshot.Data, trace); err != nil {
			return nil, fmt.Errorf("decode workflow trace snapshot %s: %w", snapshot.ID, err)
		}
	}

	trace.TraceID = firstNonEmpty(trace.TraceID, extractTraceIDFromSnapshotType(snapshot.SnapshotType), snapshot.ID.String())
	trace.ExecutionSessionID = firstNonEmpty(trace.ExecutionSessionID, snapshot.SessionID)
	trace.UpdatedAt = snapshot.UpdatedAt.UTC().Format(time.RFC3339)
	if trace.StartedAt == "" {
		trace.StartedAt = snapshot.CreatedAt.UTC().Format(time.RFC3339)
	}
	if trace.Nodes == nil {
		trace.Nodes = []WorkflowTraceNode{}
	}

	sort.SliceStable(trace.Nodes, func(i, j int) bool {
		if trace.Nodes[i].IsLeader != trace.Nodes[j].IsLeader {
			return trace.Nodes[i].IsLeader
		}

		if trace.Nodes[i].Order == trace.Nodes[j].Order {
			if trace.Nodes[i].StartedAt == trace.Nodes[j].StartedAt {
				return trace.Nodes[i].AgentRole < trace.Nodes[j].AgentRole
			}
			return trace.Nodes[i].StartedAt < trace.Nodes[j].StartedAt
		}
		return trace.Nodes[i].Order < trace.Nodes[j].Order
	})

	return trace, nil
}

func extractTraceIDFromSnapshotType(snapshotType string) string {
	const prefix = "workflow_trace:"
	if strings.HasPrefix(snapshotType, prefix) {
		return strings.TrimPrefix(snapshotType, prefix)
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func (s *builderServiceImpl) ValidateExecSessionOwner(ctx context.Context, sessionID string, userID uuid.UUID) error {
	sessions, err := s.agentSessionRepo.ListExecutionSessions(ctx, userID)
	if err != nil {
		return err
	}
	for _, sess := range sessions {
		if sess.SessionID == sessionID {
			return nil
		}
	}
	return ErrNotFound
}

func (s *builderServiceImpl) SendMessage(ctx context.Context, sessionID string, message string, userID uuid.UUID) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	if err := s.ValidateExecSessionOwner(ctx, sessionID, userID); err != nil {
		return "", err
	}

	stream, err := s.coreAgentGrpc.Chat(ctx, &proto.ChatRequest{
		SessionId: sessionID,
		Message:   message,
	})
	if err != nil {
		return "", fmt.Errorf("gRPC Chat: %w", err)
	}

	var sb strings.Builder
	for {
		resp, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", fmt.Errorf("stream recv: %w", err)
		}
		if reply := resp.GetReply(); reply != "" {
			sb.WriteString(reply)
		}
	}

	return sb.String(), nil
}

func (s *builderServiceImpl) StopRun(ctx context.Context, executionSessionID string, runID string, userID uuid.UUID) (*StopRunResult, error) {
	executionSessionID = strings.TrimSpace(executionSessionID)
	runID = strings.TrimSpace(runID)
	if executionSessionID == "" || runID == "" {
		return nil, fmt.Errorf("execution_session_id and run_id are required")
	}

	if err := s.ValidateExecSessionOwner(ctx, executionSessionID, userID); err != nil {
		return nil, err
	}

	alreadyRequested, ok := s.markExecutionRunStopping(executionSessionID, runID)
	if !ok {
		return &StopRunResult{
			ExecutionSessionID: executionSessionID,
			RunID:              runID,
			Status:             "not_found",
			Message:            "The targeted run is no longer active.",
		}, nil
	}
	if alreadyRequested {
		return &StopRunResult{
			ExecutionSessionID: executionSessionID,
			RunID:              runID,
			Status:             "accepted",
			Message:            "Stop already requested.",
		}, nil
	}

	resp, err := s.coreAgentGrpc.StopRun(ctx, &proto.StopRunRequest{
		ExecutionSessionId: executionSessionID,
		RunId:              runID,
	})
	if err != nil {
		s.clearExecutionRunStopRequest(executionSessionID, runID)
		return nil, fmt.Errorf("StopRun gRPC: %w", err)
	}
	if !strings.EqualFold(resp.GetStatus(), "accepted") {
		s.clearExecutionRunStopRequest(executionSessionID, runID)
	}

	return &StopRunResult{
		ExecutionSessionID: resp.GetExecutionSessionId(),
		RunID:              resp.GetRunId(),
		Status:             resp.GetStatus(),
		Message:            resp.GetMessage(),
	}, nil
}

func baselineAssignmentsFromPlan(plan *model.Plan) map[string]string {
	assignments := map[string]string{}
	if plan == nil {
		return assignments
	}
	for _, agent := range plan.Agents {
		assignments[agent.ID] = agent.Model
	}
	return assignments
}

func cloneAssignmentMap(src map[string]string) map[string]string {
	if len(src) == 0 {
		return map[string]string{}
	}
	dst := make(map[string]string, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func mergeAssignmentMaps(baseline map[string]string, overrides map[string]string) map[string]string {
	merged := cloneAssignmentMap(baseline)
	for key, value := range overrides {
		merged[key] = value
	}
	return merged
}

func readModelAssignmentDraft(session *model.AgentSession) ModelAssignmentsState {
	state := ModelAssignmentsState{
		Baseline:  map[string]string{},
		Overrides: map[string]string{},
	}
	if session == nil || len(session.Metadata) == 0 {
		return state
	}

	var metadata map[string]any
	if err := json.Unmarshal(session.Metadata, &metadata); err != nil {
		return state
	}

	rawDraft, ok := metadata["model_assignment_draft"]
	if !ok {
		return state
	}

	draft, ok := rawDraft.(map[string]any)
	if !ok {
		return state
	}

	state.Baseline = assignmentMapFromAny(draft["baseline"])
	state.Overrides = assignmentMapFromAny(draft["overrides"])
	state.Confirmed = boolFromAny(draft["confirmed"])
	state.ReviewedAt = stringPointerFromAny(draft["reviewed_at"])
	state.ConfirmedAt = stringPointerFromAny(draft["confirmed_at"])
	return state
}

func assignmentMapFromAny(value any) map[string]string {
	assignments := map[string]string{}
	raw, ok := value.(map[string]any)
	if ok {
		for key, item := range raw {
			strValue, ok := item.(string)
			if ok {
				assignments[key] = strValue
			}
		}
		return assignments
	}

	typed, ok := value.(map[string]string)
	if ok {
		return cloneAssignmentMap(typed)
	}

	return assignments
}

func stringPointerFromAny(value any) *string {
	str, ok := value.(string)
	if !ok || strings.TrimSpace(str) == "" {
		return nil
	}
	return &str
}

func boolFromAny(value any) bool {
	flag, ok := value.(bool)
	return ok && flag
}

// ValidateSessionOwner accepts both execution session IDs and planning session IDs.
// Checks execution sessions first; falls back to chat_sessions (planning sessions).
// Propagates real infrastructure errors rather than masking them as ErrNotFound.
func (s *builderServiceImpl) ValidateSessionOwner(ctx context.Context, sessionID string, userID uuid.UUID) error {
	if err := s.ValidateExecSessionOwner(ctx, sessionID, userID); !errors.Is(err, ErrNotFound) {
		return err // nil = found in exec sessions; any other non-ErrNotFound = real infra error
	}
	sess, err := s.chatRepo.GetSession(ctx, sessionID)
	if err != nil {
		return ErrNotFound
	}
	if sess.UserID != userID {
		return ErrNotFound
	}
	return nil
}
