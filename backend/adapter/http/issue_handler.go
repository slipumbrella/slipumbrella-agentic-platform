package adapter

import (
	"capstone-prog/core/data/request"
	"capstone-prog/core/service"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type IssueHandler struct {
	service *service.IssueService
}

func NewIssueHandler(service *service.IssueService) *IssueHandler {
	return &IssueHandler{service: service}
}

func (h *IssueHandler) CreateIssue(c *gin.Context) {
	var req request.CreateIssueRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	issue, err := h.service.CreateIssue(c.Request.Context(), userID.(uuid.UUID), req.Type, req.Subject, req.Description)
	if err != nil {
		slog.Error("CreateIssue: failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit issue"})
		return
	}

	c.JSON(http.StatusCreated, issue)
}

func (h *IssueHandler) GetAllIssues(c *gin.Context) {
	issues, err := h.service.GetAllIssues(c.Request.Context())
	if err != nil {
		slog.Error("GetAllIssues: failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch issues"})
		return
	}
	c.JSON(http.StatusOK, issues)
}

func (h *IssueHandler) UpdateIssueStatus(c *gin.Context) {
	idParam := c.Param("id")
	issueID, err := uuid.Parse(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid issue ID"})
		return
	}

	var req request.UpdateIssueStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if err := h.service.UpdateIssueStatus(c.Request.Context(), issueID, req.Status); err != nil {
		slog.Error("UpdateIssueStatus: failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Status updated successfully"})
}
