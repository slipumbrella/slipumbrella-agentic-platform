package request

type CreateEvaluationRequest struct {
	ReferenceID string `json:"reference_id" binding:"required,uuid"`
}
