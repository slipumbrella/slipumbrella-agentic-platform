package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"sync"

	"capstone-prog/core/helper"
	"capstone-prog/core/model"
	core "capstone-prog/core/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// WSExecutionHandler handles WebSocket connections for the execution chat flow.
type WSExecutionHandler struct {
	builderService core.BuilderService
	upgrader       websocket.Upgrader
}

func NewWSExecutionHandler(service core.BuilderService, allowedOrigins []string) *WSExecutionHandler {
	return &WSExecutionHandler{
		builderService: service,
		upgrader:       newWebSocketUpgrader(allowedOrigins),
	}
}

func (h *WSExecutionHandler) HandleExecutionWS(c *gin.Context) {
	userID, ok := authenticatedUserID(c)
	if !ok {
		return
	}

	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("Execution WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()

	var writeMu sync.Mutex
	writeJSON := func(v any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(v)
	}

	var streamMu sync.Mutex
	streamActive := false
	beginStream := func() bool {
		streamMu.Lock()
		defer streamMu.Unlock()
		if streamActive {
			return false
		}
		streamActive = true
		return true
	}
	setStreamActive := func(active bool) {
		streamMu.Lock()
		defer streamMu.Unlock()
		streamActive = active
	}

	var streamWG sync.WaitGroup
	defer streamWG.Wait()

	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("Execution WebSocket read error: %v", err)
			}
			cancel()
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			_ = writeJSON(WSEvent{Type: "error", Error: "Invalid message format"})
			continue
		}

		switch msg.Type {
		case "ping":
			if err := writeJSON(WSEvent{Type: "pong"}); err != nil {
				log.Printf("Execution WebSocket write error: %v", err)
				return
			}
		case "chat":
			if !beginStream() {
				if err := writeJSON(WSEvent{Type: "error", Error: "An execution run is already active on this socket"}); err != nil {
					log.Printf("Execution WebSocket write error: %v", err)
					return
				}
				continue
			}

			streamWG.Add(1)
			go func(chatMsg WSMessage) {
				defer streamWG.Done()
				defer setStreamActive(false)
				h.handleExecutionChat(ctx, writeJSON, chatMsg, userID)
			}(msg)
		case "stop":
			h.handleExecutionStop(ctx, writeJSON, msg, userID)
		default:
			if err := writeJSON(WSEvent{Type: "error", Error: "Unknown message type"}); err != nil {
				log.Printf("Execution WebSocket write error: %v", err)
				return
			}
		}
	}
}

func (h *WSExecutionHandler) handleExecutionChat(
	ctx context.Context,
	writeJSON func(any) error,
	msg WSMessage,
	userID uuid.UUID,
) {
	sessionID, err := helper.ToUUID(msg.SessionID)
	if err != nil {
		_ = writeJSON(WSEvent{Type: "error", Error: "Invalid session ID"})
		return
	}

	chatMessage := &model.ChatMessage{
		ID:        uuid.New(),
		SessionID: sessionID,
		Role:      "user",
		Content:   msg.Message,
	}

	streamErr := h.builderService.StreamChat(ctx, chatMessage, msg.TargetAgentID, msg.PresentationMode, userID, func(event *core.StreamEvent) {
		switch event.Type {
		case "chunk":
			_ = writeJSON(WSEvent{Type: "chunk", RunID: event.RunID, Chunk: event.Chunk, AgentID: event.AgentID})
		case "builder_think":
			_ = writeJSON(WSEvent{Type: "builder_think", RunID: event.RunID, Chunk: event.Chunk, AgentID: event.AgentID})
		case "plan_created":
			if event.PlanCreated != nil {
				agents := make([]WSAgentInfo, 0, len(event.PlanCreated.Agents))
				for _, a := range event.PlanCreated.Agents {
					agents = append(agents, WSAgentInfo{
						ID:       a.ID,
						Role:     a.Role,
						Goal:     a.Goal,
						Tools:    a.Tools,
						Model:    a.Model,
						Order:    a.Order,
						IsLeader: a.IsLeader,
					})
				}
				_ = writeJSON(WSEvent{
					Type:  "plan_created",
					RunID: event.RunID,
					PlanCreated: &WSPlanEvent{
						PlanID:        event.PlanCreated.PlanID,
						Orchestration: event.PlanCreated.Orchestration,
						Agents:        agents,
					},
				})
			}
		case "workflow_started", "workflow_node_updated", "workflow_completed", "workflow_failed", "workflow_stopped":
			if event.Workflow != nil {
				thinking := make([]core.ThinkingItem, 0, len(event.Workflow.Thinking))
				for _, t := range event.Workflow.Thinking {
					thinking = append(thinking, core.ThinkingItem{
						Role:        t.Role,
						ContentType: t.ContentType,
						Text:        t.Text,
						ToolName:    t.ToolName,
						Arguments:   t.Arguments,
					})
				}
				writeJSON(WSEvent{ //nolint:errcheck
					Type:    event.Type,
					RunID:   event.RunID,
					AgentID: event.AgentID,
					Data: &WSWorkflowTraceEventData{
						TraceID:            event.Workflow.TraceID,
						ExecutionSessionID: event.Workflow.ExecutionSessionID,
						RunID:              event.Workflow.RunID,
						Orchestration:      event.Workflow.Orchestration,
						Status:             event.Workflow.Status,
						Summary:            event.Workflow.Summary,
						AgentID:            event.Workflow.AgentID,
						AgentRole:          event.Workflow.AgentRole,
						IsLeader:           event.Workflow.IsLeader,
						Order:              event.Workflow.Order,
						Preview:            event.Workflow.Preview,
						Response:           event.Workflow.Response,
						Error:              event.Workflow.Error,
						StartedAt:          event.Workflow.StartedAt,
						CompletedAt:        event.Workflow.CompletedAt,
						StoppedAt:          event.Workflow.StoppedAt,
						Thinking:           thinking,
						Nodes:              event.Workflow.Nodes,
					},
				})
			}
		case "workflow_presentation_prompt":
			if event.PresentationPrompt != nil {
				_ = writeJSON(WSEvent{
					Type:  "workflow_presentation_prompt",
					RunID: event.RunID,
					PresentationPrompt: &WSPresentationPromptData{
						PromptID:        event.PresentationPrompt.PromptID,
						Question:        event.PresentationPrompt.Question,
						OriginalMessage: event.PresentationPrompt.OriginalMessage,
					},
				})
			}
		case "error":
			_ = writeJSON(WSEvent{Type: "error", RunID: event.RunID, Error: event.Error})
		}
	})

	if streamErr != nil {
		_ = writeJSON(WSEvent{Type: "error", Error: streamErr.Error()})
	}
	_ = writeJSON(WSEvent{Type: "done"})
}

func (h *WSExecutionHandler) handleExecutionStop(
	ctx context.Context,
	writeJSON func(any) error,
	msg WSMessage,
	userID uuid.UUID,
) {
	executionSessionID := strings.TrimSpace(msg.ExecutionSessionID)
	runID := strings.TrimSpace(msg.RunID)

	if executionSessionID == "" {
		_ = writeJSON(WSEvent{Type: "error", Error: "execution_session_id is required"})
		return
	}
	if _, err := helper.ToUUID(executionSessionID); err != nil {
		_ = writeJSON(WSEvent{Type: "error", Error: "Invalid execution session ID"})
		return
	}
	if runID == "" {
		_ = writeJSON(WSEvent{Type: "error", Error: "run_id is required"})
		return
	}

	result, err := h.builderService.StopRun(ctx, executionSessionID, runID, userID)
	if err != nil {
		switch {
		case errors.Is(err, core.ErrForbidden), errors.Is(err, core.ErrNotFound):
			_ = writeJSON(WSEvent{Type: "error", RunID: runID, Error: "Execution session not found"})
		default:
			_ = writeJSON(WSEvent{Type: "error", RunID: runID, Error: err.Error()})
		}
		return
	}

	_ = writeJSON(WSEvent{
		Type:  "stop_result",
		RunID: result.RunID,
		StopResult: &WSStopResultData{
			ExecutionSessionID: result.ExecutionSessionID,
			RunID:              result.RunID,
			Status:             result.Status,
			Message:            result.Message,
		},
	})
}
