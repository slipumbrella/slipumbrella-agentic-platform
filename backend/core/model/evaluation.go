package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

type Evaluation struct {
	ID             uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	ReferenceID    uuid.UUID      `json:"reference_id" gorm:"type:uuid;not null;index"`
	UserID         uuid.UUID      `json:"user_id" gorm:"type:uuid;not null;index"`
	OverallScore   float64        `json:"overall_score" gorm:"type:float;default:0"`
	Metrics        datatypes.JSON `json:"metrics" gorm:"type:jsonb;default:'[]'::jsonb"`
	Status         string         `json:"status" gorm:"type:text;not null;default:'pending'"`
	ErrorMessage   string         `json:"error_message" gorm:"type:text"`
	TestCasesCount int            `json:"test_cases_count" gorm:"type:int;default:0"`
	CreatedAt      time.Time      `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt      time.Time      `json:"updated_at" gorm:"autoUpdateTime"`
}
