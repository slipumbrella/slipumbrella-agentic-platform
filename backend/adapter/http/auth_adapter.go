package adapter

import (
	"capstone-prog/core/data/request"
	"capstone-prog/core/data/response"
	"capstone-prog/core/service"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AuthHandler struct {
	authService  *service.AuthService
	cookieSecure bool
	cookieDomain string
}

func NewAuthHandler(authService *service.AuthService, cookieSecure bool, cookieDomain string) *AuthHandler {
	return &AuthHandler{
		authService:  authService,
		cookieSecure: cookieSecure,
		cookieDomain: cookieDomain,
	}
}

// setAuthCookies sets the HttpOnly token cookie and the non-HttpOnly session_exists sentinel cookie.
func (h *AuthHandler) setAuthCookies(c *gin.Context, token string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "token",
		Value:    token,
		MaxAge:   3600 * 8,
		Path:     "/",
		Domain:   h.cookieDomain,
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteStrictMode,
	})
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "session_exists",
		Value:    "1",
		MaxAge:   3600 * 8,
		Path:     "/",
		Domain:   h.cookieDomain,
		HttpOnly: false,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteStrictMode,
	})
}

// Signup handles user registration
func (h *AuthHandler) Signup(c *gin.Context) {
	var req request.SignupRequest
	// 1. Validate the JSON input
	if err := c.ShouldBindJSON(&req); err != nil {
		slog.Warn("Signup: invalid request body", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// 2. Call the service to create User
	// Note: We pass the context to handle timeouts or cancellations
	user, err := h.authService.Signup(c.Request.Context(), req.Username, req.Email, req.Password, "user", false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Signup failed: this email may already be registered"})
		return
	}

	// 3. Return success message
	c.JSON(http.StatusCreated, gin.H{
		"user_id": user.ID,
	})
}

// Login handles authentication and sets the JWT in HttpOnly cookies.
func (h *AuthHandler) Login(c *gin.Context) {
	var req request.LoginRequest
	// 1. Validate the JSON input
	if err := c.ShouldBindJSON(&req); err != nil {
		slog.Warn("Login: invalid request body", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// 2. Call the service to verify credentials and generate token
	token, user, err := h.authService.Login(c.Request.Context(), req.Email, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	// 3. Set HttpOnly cookie so token is inaccessible to JS
	h.setAuthCookies(c, token)

	// 4. Return user info without exposing the token in the JSON body.
	var deletedAt *string
	if user.DeletedAt.Valid {
		t := user.DeletedAt.Time.Format(time.RFC3339)
		deletedAt = &t
	}

	var lastLogin *string
	if user.LastLogin != nil {
		t := user.LastLogin.Format(time.RFC3339)
		lastLogin = &t
	}

	c.JSON(http.StatusOK, response.LoginResponse{
		UserID:            user.ID,
		Username:          user.Username,
		Role:              user.Role,
		MustResetPassword: user.MustResetPassword,
		IsActive:          user.IsActive,
		LastLogin:         lastLogin,
		DeletedAt:         deletedAt,
	})
}

func (h *AuthHandler) RefreshToken(c *gin.Context) {
	// 1. Try to get token from Cookie
	tokenString, err := c.Cookie("token")
	if err != nil || tokenString == "" {
		// Fallback to Header
		tokenString = c.GetHeader("Authorization")
		if len(tokenString) > 7 && tokenString[:7] == "Bearer " {
			tokenString = tokenString[7:]
		}
	}

	if tokenString == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No token found"})
		return
	}

	// 2. Call service to refresh
	newToken, err := h.authService.RefreshToken(c.Request.Context(), tokenString)
	if err != nil {
		slog.Warn("RefreshToken: failed", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired session"})
		return
	}

	// 3. Set HttpOnly cookie with refreshed token
	h.setAuthCookies(c, newToken)

	// 4. Keep the refreshed token in HttpOnly cookies only.
	c.Status(http.StatusNoContent)
}

func (h *AuthHandler) Logout(c *gin.Context) {
	// Blacklist the current token so it cannot be reused via Authorization header after logout.
	if tokenString, err := c.Cookie("token"); err == nil && tokenString != "" {
		_ = h.authService.BlacklistToken(c.Request.Context(), tokenString)
	}
	http.SetCookie(c.Writer, &http.Cookie{Name: "token", Value: "", MaxAge: -1, Path: "/", Domain: h.cookieDomain, HttpOnly: true, Secure: h.cookieSecure, SameSite: http.SameSiteStrictMode})
	http.SetCookie(c.Writer, &http.Cookie{Name: "session_exists", Value: "", MaxAge: -1, Path: "/", Domain: h.cookieDomain, Secure: h.cookieSecure, SameSite: http.SameSiteStrictMode})
	c.JSON(http.StatusOK, gin.H{"message": "Logged out"})
}

func (h *AuthHandler) Me(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	user, err := h.authService.GetProfile(c.Request.Context(), userID.(uuid.UUID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	var deletedAt *string
	if user.DeletedAt.Valid {
		t := user.DeletedAt.Time.Format(time.RFC3339)
		deletedAt = &t
	}

	var lastLogin *string
	if user.LastLogin != nil {
		t := user.LastLogin.Format(time.RFC3339)
		lastLogin = &t
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":             user.ID,
		"username":            user.Username,
		"email":               user.Email,
		"role":                user.Role,
		"must_reset_password": user.MustResetPassword,
		"is_active":           user.IsActive,
		"last_login":          lastLogin,
		"deleted_at":          deletedAt,
	})
}
