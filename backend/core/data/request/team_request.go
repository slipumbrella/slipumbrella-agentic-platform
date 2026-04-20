package request

type CreateTeamRequest struct {
	Name        string  `json:"name" binding:"required"`
	Description *string `json:"description,omitempty"`
}

type UpdateTeamRequest struct {
	Name        string  `json:"name" binding:"required"`
	Description *string `json:"description,omitempty"`
}

type AssignSessionRequest struct {
	SessionID string `json:"session_id" binding:"required"`
}
