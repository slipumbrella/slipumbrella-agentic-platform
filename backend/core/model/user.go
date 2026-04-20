package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type User struct {
	ID uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`

	Username string `gorm:"unique;not null;type:varchar(255)" json:"username"`
	Email    string `gorm:"unique;not null;type:varchar(255)" json:"email"`
	Password string `gorm:"not null;type:varchar(255)" json:"-"`
	Role     string `gorm:"type:varchar(50);default:'user';not null" json:"role"`

	MustResetPassword bool `gorm:"default:false" json:"must_reset_password"`

	Settings  datatypes.JSON `gorm:"type:jsonb;default:'{}'::jsonb" json:"settings"`
	IsActive  bool           `gorm:"default:true;not null" json:"is_active"`
	LastLogin *time.Time      `json:"last_login"` // Added last login tracking
	CreatedAt time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time      `gorm:"autoUpdateTime" json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at"`
}
