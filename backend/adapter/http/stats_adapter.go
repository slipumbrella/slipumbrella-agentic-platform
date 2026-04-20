package adapter

import (
	"capstone-prog/core/repository"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type StatsHandler struct {
	tokenUsageRepo repository.TokenUsageRepository
}

func NewStatsHandler(repo repository.TokenUsageRepository) *StatsHandler {
	return &StatsHandler{tokenUsageRepo: repo}
}

func (h *StatsHandler) GetTokenUsage(c *gin.Context) {
	daysStr := c.DefaultQuery("days", "7")
	days, err := strconv.Atoi(daysStr)
	if err != nil || days <= 0 {
		days = 7
	}

	userID := c.MustGet("user_id").(uuid.UUID)

	stats, err := h.tokenUsageRepo.GetDailyStats(c.Request.Context(), days, userID.String())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch token usage"})
		return
	}

	activeAgents, err := h.tokenUsageRepo.CountActiveAgents(c.Request.Context(), userID.String())
	if err != nil {
		activeAgents = 0
	}

	c.JSON(http.StatusOK, gin.H{"data": stats, "active_agents": activeAgents})
}
