package adapter

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"capstone-prog/core/service"
)

// SessionHandler exposes deployed agent sessions via REST.
type SessionHandler struct {
	builderService service.BuilderService
}

func NewSessionHandler(builderService service.BuilderService) *SessionHandler {
	return &SessionHandler{builderService: builderService}
}

type sendMessageRequest struct {
	Message string `json:"message" binding:"required"`
}

type sendMessageResponse struct {
	Response  string `json:"response"`
	SessionID string `json:"session_id"`
}

// SendMessage forwards a message to the execution session's leader agent
// and waits for the complete response (blocking, up to 5 min).
//
// POST /api/sessions/:session_id/chat
// Auth: Bearer JWT (user_id injected by authMiddleware)
func (h *SessionHandler) SendMessage(c *gin.Context) {
	userID := c.MustGet("user_id").(uuid.UUID)
	sessionID := c.Param("session_id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session_id is required"})
		return
	}

	var req sendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	response, err := h.builderService.SendMessage(c.Request.Context(), sessionID, req.Message, userID)
	if err != nil {
		if errors.Is(err, service.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, service.ErrForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, sendMessageResponse{
		Response:  response,
		SessionID: sessionID,
	})
}
