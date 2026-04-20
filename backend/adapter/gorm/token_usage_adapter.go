package gorm

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"

	"gorm.io/gorm"
)

type GormTokenUsageRepository struct {
	db *gorm.DB
}

func NewTokenUsageRepository(db *gorm.DB) repository.TokenUsageRepository {
	return &GormTokenUsageRepository{db: db}
}

func (r *GormTokenUsageRepository) Create(ctx context.Context, usage *model.TokenUsage) error {
	return r.db.WithContext(ctx).Create(usage).Error
}

func (r *GormTokenUsageRepository) GetDailyStats(ctx context.Context, days int, userID string) ([]repository.TokenDailyStat, error) {
	if days <= 0 {
		days = 7
	}
	if days > 90 {
		days = 90
	}

	sql := `
		SELECT
			DATE(t.recorded_at) AS date,
			SUM(t.input_tokens)  AS input_tokens,
			SUM(t.output_tokens) AS output_tokens,
			SUM(
				t.input_tokens  / 1000000.0 * COALESCE(m.input_price, 0) +
				t.output_tokens / 1000000.0 * COALESCE(m.output_price, 0)
			) AS estimated_cost_usd
		FROM token_usage t
		LEFT JOIN openrouter_models m ON m.id = t.model_id
		LEFT JOIN sessions s ON s.session_id = t.session_id
		LEFT JOIN chat_sessions cs
			ON cs.id::text = COALESCE(s.planning_session_id, t.session_id)
		WHERE t.recorded_at >= NOW() - ($1 * INTERVAL '1 day')
		  AND cs.user_id = $2::uuid
		GROUP BY DATE(t.recorded_at)
		ORDER BY date ASC
	`

	var stats []repository.TokenDailyStat
	err := r.db.WithContext(ctx).Raw(sql, days, userID).Scan(&stats).Error
	return stats, err
}

func (r *GormTokenUsageRepository) CountActiveAgents(ctx context.Context, userID string) (int64, error) {
	sql := `
		SELECT COUNT(a.id)
		FROM sessions s
		JOIN chat_sessions cs ON cs.id::text = s.planning_session_id
		JOIN plans p ON p.session_id = s.session_id
		JOIN agents a ON a.plan_id = p.id
		WHERE s.type = 'execution'
		  AND s.planning_session_id IS NOT NULL
		  AND cs.user_id = $1::uuid
	`
	var count int64
	err := r.db.WithContext(ctx).Raw(sql, userID).Scan(&count).Error
	return count, err
}
