package request

type CreateSessionRequest struct {
	Title string `json:"title"`
}

type ChatRequest struct {
	SessionID        string `json:"session_id" binding:"required"`
	Message          string `json:"message" binding:"required"`
	PresentationMode string `json:"presentation_mode,omitempty"`
}

type ExecutePlanRequest struct {
	SessionID string `json:"session_id" binding:"required"`
	TeamID    string `json:"team_id"`
}

type SaveModelAssignmentsRequest struct {
	Baseline  map[string]string `json:"baseline" binding:"required"`
	Overrides map[string]string `json:"overrides"`
}
