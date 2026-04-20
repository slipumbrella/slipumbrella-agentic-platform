package repository

import (
	"capstone-prog/core/model"
	"context"
)

type TokenDailyStat struct {
	Date             string  `json:"date"`
	InputTokens      int64   `json:"input_tokens"`
	OutputTokens     int64   `json:"output_tokens"`
	EstimatedCostUSD float64 `json:"estimated_cost_usd"`
}

type TokenUsageRepository interface {
	Create(ctx context.Context, usage *model.TokenUsage) error
	GetDailyStats(ctx context.Context, days int, userID string) ([]TokenDailyStat, error)
	CountActiveAgents(ctx context.Context, userID string) (int64, error)
}
