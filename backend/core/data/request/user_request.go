package request

type GetUserRequest struct {
	UserID string `json:"user_id" binding:"required,uuid"`
}

type CreateUserRequest struct {
	Username          string `json:"username" binding:"required,min=3"`
	Email             string `json:"email" binding:"required,email"`
	Password          string `json:"password" binding:"required,min=8"`
	Role              string `json:"role" binding:"required"`
	MustResetPassword bool   `json:"must_reset_password"`
}

type UpdateUserRequest struct {
	Username string `json:"username" binding:"omitempty,min=3"`
	Email    string `json:"email" binding:"omitempty,email"`
}

type DeleteUserRequest struct {
	UserID string `json:"user_id" binding:"required,uuid"`
}

type ChangePasswordRequest struct {
	OldPassword string `json:"old_password"` // Optional, enforced by service depending on context
	NewPassword string `json:"new_password" binding:"required,min=8"`
}
