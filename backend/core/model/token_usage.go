package model

import "time"

// TokenUsage records LLM token consumption per agent call.
type TokenUsage struct {
	ID           uint      `json:"id"            gorm:"primaryKey;autoIncrement"`
	SessionID    string    `json:"session_id"    gorm:"type:text;not null;index"`
	AgentID      string    `json:"agent_id"      gorm:"type:text;not null"`
	AgentRole    string    `json:"agent_role"    gorm:"type:text;not null;default:''"`
	ModelID      string    `json:"model_id"      gorm:"type:text;not null;default:''"`
	InputTokens  int       `json:"input_tokens"  gorm:"not null;default:0"`
	OutputTokens int       `json:"output_tokens" gorm:"not null;default:0"`
	RecordedAt   time.Time `json:"recorded_at"   gorm:"not null;autoCreateTime"`
}

func (TokenUsage) TableName() string { return "token_usage" }
