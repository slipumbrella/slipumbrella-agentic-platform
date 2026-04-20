package adapter

import (
	"capstone-prog/core/repository"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// UserRateLimiter manages per-user rate limits using Redis repository
type UserRateLimiter struct {
	repo   repository.RedisRepository
	rate   int
	burst  int
	period time.Duration
}

// NewUserRateLimiter creates a rate limiter backed by the repository
// rate: requests per period
// burst: max burst size
// period: duration for the rate
func NewUserRateLimiter(repo repository.RedisRepository, rate int, burst int, period time.Duration) *UserRateLimiter {
	return &UserRateLimiter{
		repo:   repo,
		rate:   rate,
		burst:  burst,
		period: period,
	}
}

// Allow checks if a request from user/IP should be allowed
func (ul *UserRateLimiter) Allow(ctx context.Context, key string) (bool, time.Duration, error) {
	return ul.repo.Allow(ctx, key, ul.rate, ul.period, ul.burst)
}

// UserRateLimitMiddleware creates a Gin middleware for per-user rate limiting
// Uses user_id from context (set by AuthMiddleware) or falls back to ClientIP
func UserRateLimitMiddleware(limiter *UserRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		var key string

		// Try to get user ID from context (set by AuthMiddleware)
		if userID, exists := c.Get("user_id"); exists {
			if uid, ok := userID.(uuid.UUID); ok {
				key = "user:" + uid.String()
			}
		}

		// Fallback to IP for unauthenticated requests
		if key == "" {
			key = "ip:" + c.ClientIP()
		}

		allowed, retryAfter, err := limiter.Allow(c.Request.Context(), key)
		if err != nil {
			// In case of Redis error, we should probably allow the request but log the error
			// or fail open depending on policy. Fail open is safer for availability.
			slog.Error("Rate limiter error", "error", err)
			c.Next()
			return
		}

		if !allowed {
			c.Header("Retry-After", fmt.Sprintf("%.0f", retryAfter.Seconds()))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":       "Too many requests. Please slow down.",
				"retry_after": retryAfter.Seconds(),
			})
			return
		}

		c.Next()
	}
}

// DefaultAuthRateLimiter returns a rate limiter for auth endpoints
// 5 requests per minute
func DefaultAuthRateLimiter(repo repository.RedisRepository) *UserRateLimiter {
	return NewUserRateLimiter(repo, 5, 5, time.Minute)
}

// DefaultAPIRateLimiter returns a rate limiter for general API endpoints
// 120 requests per minute
func DefaultAPIRateLimiter(repo repository.RedisRepository) *UserRateLimiter {
	return NewUserRateLimiter(repo, 120, 120, time.Minute)
}
