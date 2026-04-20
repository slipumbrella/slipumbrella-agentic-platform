package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Issue struct {
	ID uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`

	UserID uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	User   User      `gorm:"foreignKey:UserID;references:ID" json:"user,omitempty"`

	Type        string `gorm:"type:varchar(20);not null" json:"type"` // bug, feature, general
	Subject     string `gorm:"type:varchar(255);not null" json:"subject"`
	Description string `gorm:"type:text;not null" json:"description"`
	Status      string `gorm:"type:varchar(20);default:'active';not null;index" json:"status"` // active, resolved

	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
