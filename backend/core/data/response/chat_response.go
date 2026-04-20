package response

type ChatResponse struct {
	Message   string      `json:"message"`
	AgentList []AgentList `json:"agent_list,omitempty"`
}

type AgentList struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	Description string `json:"description"`
}
