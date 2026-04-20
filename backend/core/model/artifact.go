package model

import (
	"time"

	"github.com/google/uuid"
)

// Artifact records a file created by an agent for a team (Google Workspace or local).
type Artifact struct {
	ID                      uuid.UUID `json:"id" gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	TeamID                  uuid.UUID `json:"team_id" gorm:"type:uuid;not null;index"`
	FileID                  string    `json:"file_id" gorm:"type:text;not null"`
	FileType                string    `json:"file_type" gorm:"type:text;not null"` // gdoc | gsheet | gslide | local_doc
	Title                   string    `json:"title" gorm:"type:text;not null"`
	URL                     string    `json:"url" gorm:"type:text;not null"`
	Content                 string    `json:"content" gorm:"type:text"` // For storing local artifact text
	SourceSessionID         *string   `json:"source_session_id,omitempty" gorm:"type:text;index"`
	SourcePlanningSessionID *string   `json:"source_planning_session_id,omitempty" gorm:"type:text;index"`
	ResolutionSource        *string   `json:"resolution_source,omitempty" gorm:"type:text"`
	CreatedByAgentID        *string   `json:"created_by_agent_id,omitempty" gorm:"type:text"`
	CreatedByAgentRole      *string   `json:"created_by_agent_role,omitempty" gorm:"type:text"`
	CreatedByToolName       *string   `json:"created_by_tool_name,omitempty" gorm:"type:text"`
	CreatedAt               time.Time `json:"created_at" gorm:"autoCreateTime"`
}
