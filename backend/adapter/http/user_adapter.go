package adapter

import (
	"capstone-prog/core/data/request"
	"capstone-prog/core/service"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type UserHandler struct {
	userService *service.UserService
	authService *service.AuthService
}

func NewUserHandler(userService *service.UserService, authService *service.AuthService) *UserHandler {
	return &UserHandler{
		userService: userService,
		authService: authService,
	}
}

func (h *UserHandler) GetAllUsers(c *gin.Context) {
	users, err := h.userService.GetAllUsers(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch users"})
		return
	}
	c.JSON(http.StatusOK, users)
}

func (h *UserHandler) CreateUser(c *gin.Context) {
	var req request.CreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		slog.Warn("CreateUser: invalid request body", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Use AuthService.Signup logic but with provided Role
	user, err := h.authService.Signup(c.Request.Context(), req.Username, req.Email, req.Password, req.Role, req.MustResetPassword)
	if err != nil {
		switch err.Error() {
		case "username already exists", "email already exists":
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		case "password must contain at least one uppercase letter, one lowercase letter, and one digit":
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		default:
			slog.Error("CreateUser: signup failed", "error", err, "ip", c.ClientIP())
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		}
		return
	}

	c.JSON(http.StatusCreated, user)
}

func (h *UserHandler) ChangePassword(c *gin.Context) {
	var req request.ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		slog.Warn("ChangePassword: invalid request body", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	if err := h.userService.ChangePassword(c.Request.Context(), userID.(uuid.UUID), req.OldPassword, req.NewPassword); err != nil {
		slog.Warn("ChangePassword: failed", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusBadRequest, gin.H{"error": "Password change failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Password updated successfully"})
}

func (h *UserHandler) DeleteUser(c *gin.Context) {
	idParam := c.Param("id")
	userID, err := uuid.Parse(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	if err := h.userService.DeleteUser(c.Request.Context(), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete user"})
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *UserHandler) ForcePasswordReset(c *gin.Context) {
	idParam := c.Param("id")
	userID, err := uuid.Parse(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	if err := h.userService.ForcePasswordReset(c.Request.Context(), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to force password reset"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User will be forced to reset password on next login"})
}
