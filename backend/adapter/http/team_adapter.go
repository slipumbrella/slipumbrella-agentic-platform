package adapter

import (
	"capstone-prog/core/data/request"
	"capstone-prog/core/model"
	core "capstone-prog/core/service"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type TeamHandler struct {
	teamService core.TeamService
}

func NewTeamHandler(service core.TeamService) *TeamHandler {
	return &TeamHandler{teamService: service}
}

func (h *TeamHandler) CreateTeam(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)

	var req request.CreateTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	team := &model.Team{
		ID:          uuid.New(),
		UserID:      userID,
		Name:        req.Name,
		Description: req.Description,
	}

	if err := h.teamService.CreateTeam(ctx, team); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create team"})
		return
	}

	c.JSON(http.StatusCreated, team)
}

func (h *TeamHandler) ListTeams(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)

	teams, err := h.teamService.ListTeams(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list teams"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"teams": teams})
}

func (h *TeamHandler) GetTeam(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team ID"})
		return
	}

	team, err := h.teamService.GetTeam(ctx, id, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	c.JSON(http.StatusOK, team)
}

func (h *TeamHandler) UpdateTeam(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team ID"})
		return
	}

	// Verify ownership before updating.
	if _, err := h.teamService.GetTeam(ctx, id, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	var req request.UpdateTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	team := &model.Team{
		ID:          id,
		Name:        req.Name,
		Description: req.Description,
	}

	if err := h.teamService.UpdateTeam(ctx, team); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update team"})
		return
	}

	c.JSON(http.StatusOK, team)
}

func (h *TeamHandler) DeleteTeam(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("user_id").(uuid.UUID)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team ID"})
		return
	}

	// Verify ownership before deleting.
	if _, err := h.teamService.GetTeam(ctx, id, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}

	if err := h.teamService.DeleteTeam(ctx, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete team"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Team deleted"})
}

func (h *TeamHandler) AssignSession(c *gin.Context) {
	ctx := c.Request.Context()
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userID := userIDVal.(uuid.UUID)
	teamID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team ID"})
		return
	}

	var req request.AssignSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if err := h.teamService.AssignSessionToTeam(ctx, teamID, req.SessionID, userID); err != nil {
		if errors.Is(err, core.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		} else if errors.Is(err, core.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to assign session"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Session assigned to team"})
}

func (h *TeamHandler) UnassignSession(c *gin.Context) {
	ctx := c.Request.Context()
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userID := userIDVal.(uuid.UUID)
	sessionID := c.Param("session_id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session_id required"})
		return
	}

	if err := h.teamService.UnassignSession(ctx, sessionID, userID); err != nil {
		if errors.Is(err, core.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
			return
		} else if errors.Is(err, core.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unassign session"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Session unassigned"})
}
