package response

import "github.com/google/uuid"

type LoginResponse struct {
	UserID            uuid.UUID `json:"user_id"`
	Username          string    `json:"username"`
	Role              string    `json:"role"`
	MustResetPassword bool      `json:"must_reset_password"`
	IsActive          bool      `json:"is_active"`
	LastLogin         *string   `json:"last_login,omitempty"`
	DeletedAt         *string   `json:"deleted_at,omitempty"` // Pointer to allow null
}
