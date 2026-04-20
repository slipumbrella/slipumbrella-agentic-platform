package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

// ChatSessionType is a PostgreSQL enum discriminating planning vs execution shadow sessions.
type ChatSessionType string

const (
	ChatSessionTypePlanning  ChatSessionType = "planning"
	ChatSessionTypeExecution ChatSessionType = "execution"
)

// One chat session = many messages
type ChatSession struct {
	ID        uuid.UUID       `json:"id" gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	Title     string          `json:"title" gorm:"type:text"`                            // optional session title
	Type      ChatSessionType `json:"type"  gorm:"type:chat_session_type;not null;default:'planning'"` // "planning" | "execution"
	UserID    uuid.UUID       `json:"user_id" gorm:"type:uuid;not null;index"`
	Meta      datatypes.JSON  `json:"meta" gorm:"type:jsonb;default:'{}'::jsonb"` // arbitrary metadata
	CreatedAt time.Time       `json:"created_at" gorm:"autoCreateTime"`

	Messages []ChatMessage `json:"messages" gorm:"foreignKey:SessionID;constraint:OnDelete:CASCADE"`
}

// Individual messages in a session
type ChatMessage struct {
	ID        uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	SessionID uuid.UUID      `json:"session_id" gorm:"type:uuid;not null;index"`
	Role      string         `json:"role" gorm:"type:text;not null"` // 'user','assistant','tool','system'
	Content   string         `json:"content" gorm:"type:text;not null"`
	Tokens    *int           `json:"tokens" gorm:"type:int"`
	Meta      datatypes.JSON `json:"meta" gorm:"type:jsonb;default:'{}'::jsonb"` // attachments, tool-call ids, etc.
	CreatedAt time.Time      `json:"created_at" gorm:"autoCreateTime"`
}
