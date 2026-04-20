package adapter

import (
	"capstone-prog/config"
	"capstone-prog/core/data/request"
	"capstone-prog/core/helper"
	"capstone-prog/core/model"
	core "capstone-prog/core/service"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type BuilderHandler struct {
	builderService core.BuilderService
	lineService    core.LineService
	teamService    core.TeamService
}

func NewBuilderHandler(service core.BuilderService, lineService core.LineService, teamService core.TeamService) *BuilderHandler {
	return &BuilderHandler{
		builderService: service,
		lineService:    lineService,
		teamService:    teamService,
	}
}

func (h *BuilderHandler) CreateSession(c *gin.Context) {
	context := c.Request.Context()
	var req request.CreateSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	title := req.Title
	if title == "" {
		title = "New Chat Session"
	}

	userID := c.MustGet("user_id").(uuid.UUID)
	session := &model.ChatSession{
		ID:     uuid.New(),
		Title:  title,
		UserID: userID,
	}

	sessionID, err := h.builderService.CreateSession(context, session)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"session_id": sessionID,
		"title":      title,
	})
}

func (h *BuilderHandler) Chat(c *gin.Context) {
	context := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)

	var req request.ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	sessionID, err := helper.ToUUID(req.SessionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session ID"})
		return
	}

	chatMessage := &model.ChatMessage{
		ID:        uuid.New(),
		SessionID: sessionID,
		Role:      "user",
		Content:   req.Message,
	}

	// Set SSE headers before writing any body.
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no") // disable nginx proxy buffering
	c.Writer.WriteHeader(http.StatusOK)

	writeEvent := func(payload any) {
		data, _ := json.Marshal(payload)
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		c.Writer.Flush()
	}

	streamErr := h.builderService.StreamChat(context, chatMessage, "", "", userID, func(event *core.StreamEvent) {
		switch event.Type {
		case "chunk":
			writeEvent(map[string]string{"chunk": event.Chunk})
		case "plan_created":
			writeEvent(map[string]any{
				"type":         "plan_created",
				"plan_created": event.PlanCreated,
			})
		case "session_renamed":
			writeEvent(map[string]any{
				"type":  "session_renamed",
				"title": event.SessionTitle,
			})
		case "error":
			writeEvent(map[string]string{"error": event.Error})
		}
	})

	if streamErr != nil {
		if errors.Is(streamErr, core.ErrNotFound) || errors.Is(streamErr, core.ErrForbidden) {
			writeEvent(map[string]string{"error": "session not found"})
		} else {
			writeEvent(map[string]string{"error": streamErr.Error()})
		}
	}

	writeEvent(map[string]bool{"done": true})
}

// ExecutePlan triggers the Python agent service to execute the plan for the
// given planning session and returns the new execution session ID.
func (h *BuilderHandler) ExecutePlan(c *gin.Context) {
	ctx := c.Request.Context()
	var req request.ExecutePlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	userID := c.MustGet("user_id").(uuid.UUID)

	var lineToken string
	if req.TeamID != "" {
		if teamUUID, err := uuid.Parse(req.TeamID); err == nil {
			lineToken, _ = h.lineService.GetToken(ctx, teamUUID)
		}
	}

	execSessionID, err := h.builderService.ExecutePlan(ctx, req.SessionID, req.TeamID, lineToken, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to execute plan"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"exec_session_id": execSessionID})
}

func (h *BuilderHandler) GetModelAssignments(c *gin.Context) {
	ctx := c.Request.Context()
	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session id required"})
		return
	}
	userID := c.MustGet("user_id").(uuid.UUID)

	state, err := h.builderService.GetModelAssignments(ctx, sessionID, userID)
	if err != nil {
		if errors.Is(err, core.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
			return
		}
		if errors.Is(err, core.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get model assignments"})
		return
	}

	c.JSON(http.StatusOK, state)
}

func (h *BuilderHandler) GetPlanningSessionPlan(c *gin.Context) {
	ctx := c.Request.Context()
	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session id required"})
		return
	}
	userID := c.MustGet("user_id").(uuid.UUID)

	plan, err := h.builderService.GetPlanningSessionPlan(ctx, sessionID, userID)
	if err != nil {
		if errors.Is(err, core.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
			return
		}
		if errors.Is(err, core.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get planning session plan"})
		return
	}

	if plan == nil {
		c.JSON(http.StatusOK, gin.H{"agents": []any{}, "orchestration": ""})
		return
	}

	type agentItem struct {
		ID       string          `json:"id"`
		Role     string          `json:"role"`
		Goal     string          `json:"goal"`
		Tools    json.RawMessage `json:"tools"`
		Context  json.RawMessage `json:"context"`
		Model    string          `json:"model,omitempty"`
		Order    int             `json:"order"`
		IsLeader bool            `json:"is_leader"`
	}
	items := make([]agentItem, 0, len(plan.Agents))
	for _, a := range plan.Agents {
		items = append(items, agentItem{
			ID:       a.ID,
			Role:     a.Role,
			Goal:     a.Goal,
			Tools:    json.RawMessage(a.Tools),
			Context:  json.RawMessage(a.Context),
			Model:    a.Model,
			Order:    a.OrderIndex,
			IsLeader: a.IsLeader,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"agents":        items,
		"orchestration": plan.Orchestration,
	})
}

func (h *BuilderHandler) SaveModelAssignments(c *gin.Context) {
	ctx := c.Request.Context()
	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session id required"})
		return
	}
	userID := c.MustGet("user_id").(uuid.UUID)

	var req request.SaveModelAssignmentsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if err := h.builderService.SaveModelAssignmentsDraft(ctx, sessionID, userID, core.ModelAssignmentsState{
		Baseline:  req.Baseline,
		Overrides: req.Overrides,
	}); err != nil {
		if errors.Is(err, core.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
			return
		}
		if errors.Is(err, core.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save model assignments"})
		return
	}

	state, err := h.builderService.GetModelAssignments(ctx, sessionID, userID)
	if err != nil {
		if errors.Is(err, core.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
			return
		}
		if errors.Is(err, core.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get model assignments"})
		return
	}

	c.JSON(http.StatusOK, state)
}

func (h *BuilderHandler) ConfirmModelAssignments(c *gin.Context) {
	ctx := c.Request.Context()
	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session id required"})
		return
	}
	userID := c.MustGet("user_id").(uuid.UUID)

	if err := h.builderService.ConfirmModelAssignments(ctx, sessionID, userID); err != nil {
		if errors.Is(err, core.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
			return
		}
		if errors.Is(err, core.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to confirm model assignments"})
		return
	}

	state, err := h.builderService.GetModelAssignments(ctx, sessionID, userID)
	if err != nil {
		if errors.Is(err, core.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
			return
		}
		if errors.Is(err, core.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get model assignments"})
		return
	}

	c.JSON(http.StatusOK, state)
}

// GetAgents returns the agents for a given execution or planning session ID.
func (h *BuilderHandler) GetAgents(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)

	sessionID := c.Query("session_id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session_id query param required"})
		return
	}

	// Validate that the execution session belongs to the requesting user.
	if err := h.builderService.ValidateSessionOwner(ctx, sessionID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}

	plan, err := h.builderService.GetSessionPlan(ctx, sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch plan"})
		return
	}

	if plan == nil {
		// session_id may be a planning session ID — resolve agents via the latest execution session.
		latestExec, err2 := h.builderService.GetLatestSessionByPlanningID(ctx, sessionID, userID)
		if err2 != nil && !errors.Is(err2, core.ErrNotFound) {
			log.Printf("GetAgents: GetLatestSessionByPlanningID error for session %s: %v", sessionID, err2)
		} else if latestExec != nil {
			plan, err = h.builderService.GetSessionPlan(ctx, latestExec.SessionID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch plan"})
				return
			}
		}
	}

	if plan == nil {
		c.JSON(http.StatusOK, gin.H{"agents": []any{}, "orchestration": ""})
		return
	}

	type agentItem struct {
		ID       string          `json:"id"`
		Role     string          `json:"role"`
		Goal     string          `json:"goal"`
		Tools    json.RawMessage `json:"tools"`
		Context  json.RawMessage `json:"context"`
		Model    string          `json:"model,omitempty"`
		Order    int             `json:"order"`
		IsLeader bool            `json:"is_leader"`
	}
	items := make([]agentItem, 0, len(plan.Agents))
	for _, a := range plan.Agents {
		items = append(items, agentItem{
			ID:       a.ID,
			Role:     a.Role,
			Goal:     a.Goal,
			Tools:    json.RawMessage(a.Tools),
			Context:  json.RawMessage(a.Context),
			Model:    a.Model,
			Order:    a.OrderIndex,
			IsLeader: a.IsLeader,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"agents":          items,
		"orchestration":   plan.Orchestration,
		"google_sa_email": config.Cfg.GoogleSAClientEmail,
	})
}

// ListSessions returns execution sessions owned by the authenticated user.
// When planning_session_id query param is present, returns only the latest
// execution session for that planning session (same response shape: {sessions: [...]}).
func (h *BuilderHandler) ListSessions(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)

	if planningSessionID := c.Query("planning_session_id"); planningSessionID != "" {
		view, err := h.builderService.GetLatestSessionByPlanningID(ctx, planningSessionID, userID)
		if err != nil {
			if errors.Is(err, core.ErrNotFound) {
				c.JSON(http.StatusOK, gin.H{"sessions": []any{}})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get session"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"sessions": []any{view}})
		return
	}

	sessions, err := h.builderService.ListExecutionSessionViews(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list sessions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"sessions": sessions})
}

// GetArtifacts returns the artifacts for a given team.
func (h *BuilderHandler) GetArtifacts(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)

	teamID := c.Param("id")
	if teamID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "team id required"})
		return
	}

	teamUUID, err := uuid.Parse(teamID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team ID"})
		return
	}

	// Verify team ownership before returning artifacts.
	if _, err := h.teamService.GetTeam(ctx, teamUUID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	artifacts, err := h.builderService.GetArtifacts(ctx, teamID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get artifacts"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"artifacts": artifacts})
}

// GetMessages returns the chat messages for a given session.
func (h *BuilderHandler) GetMessages(c *gin.Context) {
	ctx := c.Request.Context()
	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session id required"})
		return
	}
	userID := c.MustGet("user_id").(uuid.UUID)

	messages, err := h.builderService.GetMessages(ctx, sessionID, userID)
	if err != nil {
		if errors.Is(err, core.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
			return
		}
		if errors.Is(err, core.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get messages"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"messages": messages})
}

// ListWorkflowTraces returns persisted workflow trace summaries for an execution session.
func (h *BuilderHandler) ListWorkflowTraces(c *gin.Context) {
	ctx := c.Request.Context()
	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session id required"})
		return
	}
	userID := c.MustGet("user_id").(uuid.UUID)

	traces, err := h.builderService.ListWorkflowTraces(ctx, sessionID, userID)
	if err != nil {
		if errors.Is(err, core.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
			return
		}
		if errors.Is(err, core.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get workflow traces"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"traces": traces})
}

// GetWorkflowTrace returns one persisted workflow trace by trace ID.
func (h *BuilderHandler) GetWorkflowTrace(c *gin.Context) {
	ctx := c.Request.Context()
	traceID := c.Param("id")
	if traceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trace id required"})
		return
	}
	userID := c.MustGet("user_id").(uuid.UUID)

	trace, err := h.builderService.GetWorkflowTrace(ctx, traceID, userID)
	if err != nil {
		if errors.Is(err, core.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Workflow trace not found"})
			return
		}
		if errors.Is(err, core.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get workflow trace"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"trace": trace})
}

// ListPlanningSessions returns planning (chat) sessions belonging to the authenticated user.
func (h *BuilderHandler) ListPlanningSessions(c *gin.Context) {
	userID := c.MustGet("user_id").(uuid.UUID)
	sessions, err := h.builderService.ListPlanningSessions(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list sessions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"sessions": sessions})
}

// GetConfig returns public system config (e.g. Google service account).
func (h *BuilderHandler) GetConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"google_sa_email": config.Cfg.GoogleSAClientEmail,
	})
}

// sanitizeFilename replaces any character that is not alphanumeric, hyphen, or
// underscore with a hyphen, producing a safe filename component.
func sanitizeFilename(name string) string {
	return strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, name)
}

// DownloadArtifact streams a local_doc artifact's content as a .md file download.
func (h *BuilderHandler) DownloadArtifact(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)

	id := c.Param("id")
	artifact, err := h.builderService.GetArtifactByID(ctx, id, userID)
	if err != nil {
		if errors.Is(err, core.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Artifact not found"})
		} else if errors.Is(err, core.ErrForbidden) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Artifact not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get artifact"})
		}
		return
	}

	if artifact.FileType != "local_doc" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only local_doc artifacts can be downloaded"})
		return
	}

	filename := sanitizeFilename(artifact.Title)
	if filename == "" {
		filename = "artifact"
	}
	filename += ".md"
	c.Header("Content-Type", "text/markdown; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.String(http.StatusOK, "%s", artifact.Content)
}
