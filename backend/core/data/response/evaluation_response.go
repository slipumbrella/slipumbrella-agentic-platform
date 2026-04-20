package response

import "github.com/google/uuid"

type MetricResult struct {
	MetricName string  `json:"metric_name"`
	Score      float64 `json:"score"`
	Passed     bool    `json:"passed"`
	Reason     string  `json:"reason"`
}

type EvaluationResponse struct {
	ID             uuid.UUID      `json:"id"`
	ReferenceID    uuid.UUID      `json:"reference_id"`
	OverallScore   float64        `json:"overall_score"`
	Metrics        []MetricResult `json:"metrics"`
	Status         string         `json:"status"`
	ErrorMessage   string         `json:"error_message,omitempty"`
	TestCasesCount int            `json:"test_cases_count"`
	CreatedAt      string         `json:"created_at"`
}
