package adapter

import (
	"capstone-prog/core/helper"
	"capstone-prog/core/service"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func AuthMiddleware(authService *service.AuthService, jwtSecret, jwtIssuer, jwtAudience string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. --- Verify Token ---
		// Read from HttpOnly cookie first, fall back to Authorization header
		var tokenString string
		if cookie, err := c.Cookie("token"); err == nil && cookie != "" {
			tokenString = cookie
		} else {
			authHeader := c.GetHeader("Authorization")
			tokenString = strings.TrimPrefix(authHeader, "Bearer ")
			if tokenString == authHeader {
				tokenString = ""
			}
		}
		if tokenString == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

		token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
			// SECURITY: Validate signing algorithm to prevent "alg:none" attack
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return []byte(jwtSecret), nil
		},
			jwt.WithIssuer(jwtIssuer),
			jwt.WithAudience(jwtAudience),
			jwt.WithExpirationRequired(),
		)

		// SECURITY: Properly handle parse errors
		if err != nil {
			slog.Warn("JWT parse error", "error", err, "ip", c.ClientIP())
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid Token"})
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok || !token.Valid {
			slog.Warn("Invalid JWT claims", "ip", c.ClientIP())
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid Token"})
			return
		}

		// Parse UserID from claims
		userIDStr, _ := claims["sub"].(string)
		userID, err := helper.ToUUID(userIDStr)
		if err != nil {
			slog.Warn("Invalid user ID in token", "user_id", userIDStr, "ip", c.ClientIP())
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid User ID in token"})
			return
		}

		// SECURITY: Check token blacklist (logout-invalidated tokens)
		jti, _ := claims["jti"].(string)
		if authService.IsTokenBlacklisted(c.Request.Context(), jti) {
			slog.Warn("Blacklisted token used", "jti", jti, "ip", c.ClientIP())
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Token has been revoked"})
			return
		}

		// SECURITY: Verify user still exists in database (handles deleted users with valid JWTs)
		// Also verify user status is active
		isActive, err := authService.IsUserActive(c.Request.Context(), userID)
		if err != nil || !isActive {
			slog.Warn("Token references non-existent or inactive user", "user_id", userID, "ip", c.ClientIP())
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "User account is not active"})
			return
		}

		c.Set("user_id", userID)

		c.Next()
	}
}

func AdminOnly(authService *service.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("user_id")
		if !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

		isAdmin, err := authService.IsAdmin(c.Request.Context(), userID.(uuid.UUID)) // assuming helper/uuid
		if err != nil || !isAdmin {
			slog.Warn("Non-admin access attempt", "user_id", userID, "ip", c.ClientIP())
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Admin Access Required"})
			return
		}

		c.Next()
	}
}
