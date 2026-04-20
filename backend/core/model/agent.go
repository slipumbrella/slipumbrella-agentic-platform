package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

// Team groups one or more execution sessions under a user-defined name.
type Team struct {
	ID                     uuid.UUID `json:"id" gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	UserID                 uuid.UUID `json:"user_id" gorm:"type:uuid;not null;index"`
	Name                   string    `json:"name" gorm:"type:text;not null"`
	Description            *string   `json:"description,omitempty" gorm:"type:text"`
	LineChannelAccessToken *string   `json:"-" gorm:"type:text"`
	LineChannelSecret      *string   `json:"-" gorm:"type:text"`
	CreatedAt              time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt              time.Time `json:"updated_at" gorm:"autoUpdateTime"`

	Sessions []AgentSession `json:"sessions,omitempty" gorm:"foreignKey:TeamID;constraint:OnDelete:SET NULL"`
}

func (Team) TableName() string { return "teams" }

// AgentSession maps to the "sessions" table.
type AgentSession struct {
	SessionID         string         `json:"session_id" gorm:"type:text;primaryKey"`
	Type              string         `json:"type" gorm:"type:text;not null;default:'planning'"`
	Metadata          datatypes.JSON `json:"metadata" gorm:"type:jsonb;not null;default:'{}'::jsonb"`
	PlanningSessionID *string        `json:"planning_session_id,omitempty" gorm:"type:text;index"`
	TeamID            *uuid.UUID     `json:"team_id,omitempty" gorm:"type:uuid;index"`
	UserID            *uuid.UUID     `json:"user_id,omitempty" gorm:"type:uuid;index"`
	CreatedAt         time.Time      `json:"created_at" gorm:"autoCreateTime"`

	Plans []Plan `json:"plans,omitempty" gorm:"foreignKey:SessionID;constraint:OnDelete:CASCADE"`
	Team  *Team  `json:"team,omitempty" gorm:"foreignKey:TeamID"`
}

func (AgentSession) TableName() string { return "sessions" }

type SessionTeamAssignment struct {
	ID         uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	SessionID  string     `json:"session_id" gorm:"type:text;not null;index:idx_session_team_assignments_session_assigned,priority:1"`
	TeamID     uuid.UUID  `json:"team_id" gorm:"type:uuid;not null;index:idx_session_team_assignments_team_assigned,priority:1"`
	AssignedAt time.Time  `json:"assigned_at" gorm:"not null;index:idx_session_team_assignments_session_assigned,priority:2;index:idx_session_team_assignments_team_assigned,priority:2"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty" gorm:"index"`
}

func (SessionTeamAssignment) TableName() string { return "session_team_assignments" }

// Plan maps to the "plans" table.
type Plan struct {
	ID            uint           `json:"id" gorm:"primaryKey;autoIncrement"`
	SessionID     string         `json:"session_id" gorm:"type:text;not null;index"`
	Orchestration string         `json:"orchestration" gorm:"type:text;not null"`
	Inputs        datatypes.JSON `json:"inputs" gorm:"type:jsonb;not null;default:'{}'::jsonb"`
	CreatedAt     time.Time      `json:"created_at" gorm:"autoCreateTime"`

	Agents []AgentDef `json:"agents,omitempty" gorm:"foreignKey:PlanID;constraint:OnDelete:CASCADE"`
}

func (Plan) TableName() string { return "plans" }

// AgentDef maps to the "agents" table.
// Uses a composite primary key (ID, PlanID) because the SQL schema has no single-column PK.
type AgentDef struct {
	ID         string         `json:"id" gorm:"type:text;primaryKey"`
	PlanID     uint           `json:"plan_id" gorm:"primaryKey;not null;index"`
	Role       string         `json:"role" gorm:"type:text;not null"`
	Goal       string         `json:"goal" gorm:"type:text;not null"`
	Tools      datatypes.JSON `json:"tools" gorm:"type:jsonb;not null;default:'[]'::jsonb"`
	Context    datatypes.JSON `json:"context" gorm:"type:jsonb;not null;default:'{}'::jsonb"`
	Model      string         `json:"model" gorm:"type:text;not null;default:''"`
	OrderIndex int            `json:"order" gorm:"column:order_index;not null;default:0"`
	IsLeader   bool           `json:"is_leader" gorm:"column:is_leader;not null;default:false"`
}

func (AgentDef) TableName() string { return "agents" }

// SessionSnapshot stores compacted workflow state (checkpoints and history) for the Python agent service.
type SessionSnapshot struct {
	ID           uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	SessionID    string         `json:"session_id" gorm:"type:text;not null;index"`
	SnapshotType string         `json:"snapshot_type" gorm:"type:text;not null"` // 'checkpoint' or 'history'
	Data         datatypes.JSON `json:"data" gorm:"type:jsonb;not null;default:'{}' ::jsonb"`
	CreatedAt    time.Time      `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt    time.Time      `json:"updated_at" gorm:"autoUpdateTime"`
}

func (SessionSnapshot) TableName() string { return "session_snapshots" }

// LineMessage stores incoming LINE webhook message events for a team.
type LineMessage struct {
	ID          uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	TeamID      uuid.UUID      `json:"team_id" gorm:"type:uuid;not null;index:idx_line_msg_team_received,priority:1"`
	LineUserID  string         `json:"line_user_id" gorm:"type:text;not null"`
	DisplayName string         `json:"display_name" gorm:"type:text;not null;default:''"`
	MessageType string         `json:"message_type" gorm:"type:text;not null;default:'text'"`
	Content     string         `json:"content" gorm:"type:text;not null;default:''"`
	ReplyToken  string         `json:"reply_token" gorm:"type:varchar(50);not null;default:''"`
	RawEvent    datatypes.JSON `json:"raw_event" gorm:"type:jsonb;not null;default:'{}'::jsonb"`
	ReceivedAt  time.Time      `json:"received_at" gorm:"index:idx_line_msg_team_received,priority:2;not null"`

	Team Team `json:"-" gorm:"foreignKey:TeamID;constraint:OnDelete:CASCADE"`
}

func (LineMessage) TableName() string { return "line_messages" }
