package adapter

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"capstone-prog/core/helper"
	"capstone-prog/core/model"
	core "capstone-prog/core/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// WSBuilderHandler handles WebSocket connections for the builder chat flow.
type WSBuilderHandler struct {
	builderService core.BuilderService
	upgrader       websocket.Upgrader
}

func NewWSBuilderHandler(service core.BuilderService, allowedOrigins []string) *WSBuilderHandler {
	return &WSBuilderHandler{
		builderService: service,
		upgrader:       newWebSocketUpgrader(allowedOrigins),
	}
}

func (h *WSBuilderHandler) HandleBuilderWS(c *gin.Context) {
	userID, ok := authenticatedUserID(c)
	if !ok {
		return
	}

	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	var writeMu sync.Mutex
	writeJSON := func(v any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(v)
	}

	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			writeJSON(WSEvent{Type: "error", Error: "Invalid message format"}) //nolint:errcheck
			continue
		}

		switch msg.Type {
		case "ping":
			writeJSON(WSEvent{Type: "pong"}) //nolint:errcheck
		case "chat":
			h.handleChat(c.Request.Context(), writeJSON, msg, userID)
		default:
			writeJSON(WSEvent{Type: "error", Error: "Unknown message type"}) //nolint:errcheck
		}
	}
}

func (h *WSBuilderHandler) handleChat(ctx context.Context, writeJSON func(any) error, msg WSMessage, userID uuid.UUID) {
	sessionID, err := helper.ToUUID(msg.SessionID)
	if err != nil {
		writeJSON(WSEvent{Type: "error", Error: "Invalid session ID"}) //nolint:errcheck
		return
	}

	chatMessage := &model.ChatMessage{
		ID:        uuid.New(),
		SessionID: sessionID,
		Role:      "user",
		Content:   msg.Message,
	}

	streamErr := h.builderService.StreamChat(ctx, chatMessage, "", "", userID, func(event *core.StreamEvent) {
		switch event.Type {
		case "chunk":
			writeJSON(WSEvent{Type: "chunk", Chunk: event.Chunk, AgentID: event.AgentID}) //nolint:errcheck
		case "builder_think":
			writeJSON(WSEvent{Type: "builder_think", Chunk: event.Chunk, AgentID: event.AgentID}) //nolint:errcheck
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
				writeJSON(WSEvent{ //nolint:errcheck
					Type: "plan_created",
					PlanCreated: &WSPlanEvent{
						PlanID:        event.PlanCreated.PlanID,
						Orchestration: event.PlanCreated.Orchestration,
						Agents:        agents,
					},
				})
			}
		case "session_renamed":
			writeJSON(WSEvent{ //nolint:errcheck
				Type:  "session_renamed",
				Title: event.SessionTitle,
			})
		case "error":
			writeJSON(WSEvent{Type: "error", Error: event.Error}) //nolint:errcheck
		}
	})

	if streamErr != nil {
		writeJSON(WSEvent{Type: "error", Error: streamErr.Error()}) //nolint:errcheck
	}
	writeJSON(WSEvent{Type: "done"}) //nolint:errcheck
}

func authenticatedUserID(c *gin.Context) (uuid.UUID, bool) {
	value, exists := c.Get("user_id")
	if !exists {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return uuid.Nil, false
	}

	userID, ok := value.(uuid.UUID)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return uuid.Nil, false
	}

	return userID, true
}

func newWebSocketUpgrader(allowedOrigins []string) websocket.Upgrader {
	return websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return isAllowedWebSocketOrigin(r, allowedOrigins)
		},
	}
}

func isAllowedWebSocketOrigin(r *http.Request, allowedOrigins []string) bool {
	origin := normalizeOrigin(r.Header.Get("Origin"))
	if origin == "" {
		return false
	}

	for _, allowedOrigin := range allowedOrigins {
		if origin == normalizeOrigin(allowedOrigin) {
			return true
		}
	}

	return false
}

func normalizeOrigin(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return trimmed
	}

	return parsed.Scheme + "://" + parsed.Host
}
