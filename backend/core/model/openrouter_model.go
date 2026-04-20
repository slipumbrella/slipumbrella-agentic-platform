package model

import (
	"github.com/google/uuid"
	"gorm.io/datatypes"
)

// OpenRouterModel represents a curated LLM model available for agent assignment.
type OpenRouterModel struct {
	UUID          uuid.UUID                   `json:"uuid"           gorm:"column:uuid;type:uuid;primaryKey;default:uuid_generate_v4()"`
	ID            string                      `json:"id"             gorm:"type:text;not null;uniqueIndex:openrouter_models_id_key"`
	Name          string                      `json:"name"           gorm:"type:text;not null"`
	Tags          datatypes.JSONSlice[string] `json:"tags"           gorm:"not null;default:'[]'"`
	SelectionHint string                      `json:"selection_hint" gorm:"type:text;not null;default:''"`
	AdvancedInfo  string                      `json:"advanced_info"  gorm:"type:text;not null;default:''"`
	Description   string                      `json:"description"    gorm:"type:text;not null;default:''"`
	ContextLength int                         `json:"context_length" gorm:"not null;default:8192"`
	InputPrice    float64                     `json:"input_price"    gorm:"type:numeric(12,8);not null;default:0"`
	OutputPrice   float64                     `json:"output_price"   gorm:"type:numeric(12,8);not null;default:0"`
	IsReasoning   bool                        `json:"is_reasoning"   gorm:"not null;default:false"`
	IsActive      bool                        `json:"is_active"      gorm:"not null;default:true"`
	Icon          string                      `json:"icon"           gorm:"type:text;default:''"`
}

func (OpenRouterModel) TableName() string { return "openrouter_models" }
