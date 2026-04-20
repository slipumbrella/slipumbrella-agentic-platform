package adapter

import (
	"capstone-prog/core/model"
	core "capstone-prog/core/service"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type LineHandler struct {
	lineService core.LineService
	teamService core.TeamService
	builderSvc  core.BuilderService
}

func NewLineHandler(service core.LineService, teamService core.TeamService, builderSvc core.BuilderService) *LineHandler {
	return &LineHandler{lineService: service, teamService: teamService, builderSvc: builderSvc}
}

func (h *LineHandler) SaveConfig(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)

	teamUUID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team ID"})
		return
	}

	if _, err := h.teamService.GetTeam(ctx, teamUUID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	var body struct {
		AccessToken   string `json:"access_token"`
		ChannelSecret string `json:"channel_secret"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if body.AccessToken == "" || body.ChannelSecret == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "access_token and channel_secret are required"})
		return
	}

	if err := h.lineService.SaveConfig(ctx, teamUUID, body.AccessToken, body.ChannelSecret); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save LINE config"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "LINE config saved"})
}

func (h *LineHandler) GetConfig(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)

	teamUUID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team ID"})
		return
	}

	if _, err := h.teamService.GetTeam(ctx, teamUUID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	config, err := h.lineService.GetConfig(ctx, teamUUID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get LINE config"})
		return
	}

	c.JSON(http.StatusOK, config)
}

func (h *LineHandler) DeleteConfig(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)

	teamUUID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team ID"})
		return
	}

	if _, err := h.teamService.GetTeam(ctx, teamUUID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	if err := h.lineService.DeleteConfig(ctx, teamUUID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete LINE config"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "LINE config deleted"})
}

func (h *LineHandler) ListMessages(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)

	teamUUID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team ID"})
		return
	}

	if _, err := h.teamService.GetTeam(ctx, teamUUID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	limit := 20
	if limitStr := c.Query("limit"); limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid limit parameter"})
			return
		}
		if parsed > 100 {
			parsed = 100
		}
		limit = parsed
	}

	messages, err := h.lineService.ListMessages(ctx, teamUUID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list messages"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"messages": messages})
}

func (h *LineHandler) Webhook(c *gin.Context) {
	ctx := c.Request.Context()

	teamIDStr := c.Query("team_id")
	if teamIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "team_id query param is required"})
		return
	}
	teamUUID, err := uuid.Parse(teamIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team_id"})
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read request body"})
		return
	}

	team, err := h.lineService.GetRawConfig(ctx, teamUUID)
	if err != nil || team.LineChannelSecret == nil || *team.LineChannelSecret == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "LINE channel secret not configured"})
		return
	}

	signature := c.GetHeader("X-Line-Signature")
	if !h.lineService.ValidateWebhookSignature(body, signature, *team.LineChannelSecret) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook signature"})
		return
	}

	var payload struct {
		Events []map[string]any `json:"events"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	if err := h.lineService.HandleWebhookEvents(ctx, teamUUID, payload.Events); err != nil {
		slog.Error("Failed to handle LINE webhook events", "error", err, "team_id", teamUUID)
	}

	teamObj, teamErr := h.teamService.GetTeam(ctx, teamUUID, uuid.Nil)
	if teamErr != nil {
		slog.Error("Webhook: failed to get team", "team_id", teamUUID, "error", teamErr)
	} else if len(teamObj.Sessions) == 0 {
		slog.Warn("Webhook: team has no sessions", "team_id", teamUUID)
	} else {
		var activeSessionID string
		var maxTime time.Time
		for _, s := range teamObj.Sessions {
			if activeSessionID == "" || s.CreatedAt.After(maxTime) {
				maxTime = s.CreatedAt
				activeSessionID = s.SessionID
			}
		}

		slog.Info("Webhook: identified active session", "team_id", teamUUID, "session_id", activeSessionID)

		if activeSessionID != "" {
			// Find the LINE-capable agent from the session's plan by checking for
			// send_line_message in its tools list. This is more robust than matching
			// by role name, which users can freely rename.
			var targetAgentID string
			for _, s := range teamObj.Sessions {
				if s.SessionID == activeSessionID {
					var latestPlan *model.Plan
					for i := range s.Plans {
						if latestPlan == nil || s.Plans[i].CreatedAt.After(latestPlan.CreatedAt) {
							latestPlan = &s.Plans[i]
						}
					}
					if latestPlan != nil {
						// Collect all agents carrying send_line_message.
						// Ideally one; if multiple exist (plan saved before factory
						// exclusivity enforcement), prefer role=="LineAgent".
						var lineAgents []model.AgentDef
						for _, a := range latestPlan.Agents {
							var tools []string
							if err := json.Unmarshal(a.Tools, &tools); err == nil {
								if slices.Contains(tools, "send_line_message") {
									lineAgents = append(lineAgents, a)
								}
							}
						}
						switch len(lineAgents) {
						case 0:
							slog.Warn("Webhook: no LINE-capable agent in plan", "plan_id", latestPlan.ID)
						case 1:
							targetAgentID = lineAgents[0].ID
						default:
							slog.Warn("Webhook: multiple LINE-capable agents - picking preferred",
								"count", len(lineAgents), "plan_id", latestPlan.ID)
							targetAgentID = lineAgents[0].ID
							for _, a := range lineAgents {
								if a.Role == "LineAgent" {
									targetAgentID = a.ID
									break
								}
							}
						}
					}
					break
				}
			}

			slog.Info("Webhook: routing to agent", "session_id", activeSessionID, "target_agent_id", targetAgentID)

			for _, event := range payload.Events {
				if event["type"] == "message" {
					if msg, ok := event["message"].(map[string]any); ok && msg["type"] == "text" {
						text := msg["text"].(string)
						source, _ := event["source"].(map[string]any)
						userID := ""
						if source != nil {
							userID, _ = source["userId"].(string)
						}

						go func(msgText string, msgUserID string, sessID string, targetID string) {
							chatMsg := &model.ChatMessage{
								ID:        uuid.New(),
								SessionID: uuid.MustParse(sessID),
								Role:      "user",
								Content:   fmt.Sprintf("[LINE Message from %s]\n%s\n\nProcess this message and reply to the user. You MUST use the read_line_messages tool to read the message and send_line_message tool with recipient_id '%s' to send your reply.", msgUserID, msgText, msgUserID),
							}
							injectErr := h.builderSvc.StreamChat(context.Background(), chatMsg, targetID, "", uuid.Nil, func(e *core.StreamEvent) {})
							if injectErr != nil {
								slog.Error("Webhook: failed to inject message into stream", "session_id", sessID, "error", injectErr)
							} else {
								slog.Info("Webhook: message injected successfully", "session_id", sessID)
							}
						}(text, userID, activeSessionID, targetAgentID)
					}
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
