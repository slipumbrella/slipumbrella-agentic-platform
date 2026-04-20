package request

type CreateIssueRequest struct {
	Type        string `json:"type" binding:"required"`
	Subject     string `json:"subject" binding:"required"`
	Description string `json:"description" binding:"required"`
}

type UpdateIssueStatusRequest struct {
	Status string `json:"status" binding:"required"`
}
