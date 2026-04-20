package adapter

import core "capstone-prog/core/service"

// WSMessage is the inbound message from WebSocket clients.
type WSMessage struct {
	Type               string `json:"type"` // "chat", "stop", or "ping"
	SessionID          string `json:"session_id,omitempty"`
	ExecutionSessionID string `json:"execution_session_id,omitempty"`
	RunID              string `json:"run_id,omitempty"`
	Message            string `json:"message,omitempty"`
	TargetAgentID      string `json:"target_agent_id,omitempty"`
	PresentationMode   string `json:"presentation_mode,omitempty"` // NEW
}

// WSEvent is the outbound event sent to WebSocket clients.
type WSEvent struct {
	Type               string                    `json:"type"` // "chunk", "builder_think", "plan_created", "session_renamed", "workflow_*", "stop_result", "done", "error", "pong"
	RunID              string                    `json:"run_id,omitempty"`
	Chunk              string                    `json:"chunk,omitempty"`
	AgentID            string                    `json:"agent_id,omitempty"`
	PlanCreated        *WSPlanEvent              `json:"plan_created,omitempty"`
	Data               *WSWorkflowTraceEventData `json:"data,omitempty"`
	StopResult         *WSStopResultData         `json:"stop_result,omitempty"`
	Title              string                    `json:"title,omitempty"`
	Error              string                    `json:"error,omitempty"`
	PresentationPrompt *WSPresentationPromptData `json:"presentation_prompt,omitempty"` // NEW
}

// WSStopResultData is the payload for a stop_result event.
type WSStopResultData struct {
	ExecutionSessionID string `json:"execution_session_id"`
	RunID              string `json:"run_id"`
	Status             string `json:"status"`
	Message            string `json:"message,omitempty"`
}

// WSPresentationPromptData is the payload for a workflow_presentation_prompt event.
type WSPresentationPromptData struct {
	PromptID        string `json:"prompt_id"`
	Question        string `json:"question"`
	OriginalMessage string `json:"original_message"`
}

// WSPlanEvent carries structured plan data.
type WSPlanEvent struct {
	PlanID        string        `json:"plan_id"`
	Orchestration string        `json:"orchestration"`
	Agents        []WSAgentInfo `json:"agents"`
}

// WSAgentInfo describes one agent in a plan.
type WSAgentInfo struct {
	ID       string   `json:"id"`
	Role     string   `json:"role"`
	Goal     string   `json:"goal"`
	Tools    []string `json:"tools"`
	Model    string   `json:"model,omitempty"`
	Order    int      `json:"order,omitempty"`
	IsLeader bool     `json:"is_leader,omitempty"`
}

// WSWorkflowTraceEventData is the stable payload for workflow sideband events.
type WSWorkflowTraceEventData struct {
	TraceID            string                   `json:"trace_id"`
	ExecutionSessionID string                   `json:"execution_session_id"`
	RunID              string                   `json:"run_id,omitempty"`
	Orchestration      string                   `json:"orchestration"`
	Status             string                   `json:"status"`
	Summary            string                   `json:"summary"`
	AgentID            string                   `json:"agent_id,omitempty"`
	AgentRole          string                   `json:"agent_role,omitempty"`
	IsLeader           bool                     `json:"is_leader,omitempty"`
	Order              int                      `json:"order,omitempty"`
	Preview            string                   `json:"preview,omitempty"`
	Response           string                   `json:"response,omitempty"`
	Error              string                   `json:"error,omitempty"`
	StartedAt          string                   `json:"started_at,omitempty"`
	CompletedAt        string                   `json:"completed_at,omitempty"`
	StoppedAt          string                   `json:"stopped_at,omitempty"`
	Thinking           []core.ThinkingItem      `json:"thinking,omitempty"`
	Nodes              []core.WorkflowTraceNode `json:"nodes,omitempty"`
}
