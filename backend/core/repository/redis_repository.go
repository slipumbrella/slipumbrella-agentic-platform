package repository

import (
	"context"
	"time"
)

type RedisRepository interface {
	// Allow checks if a request is allowed under the given rate limit settings
	// Returns: allowed (bool), retryAfter (time.Duration), error
	Allow(ctx context.Context, key string, limit int, period time.Duration, burst int) (bool, time.Duration, error)

	// Get retrieves a raw byte value. Returns (nil, nil) on cache miss.
	Get(ctx context.Context, key string) ([]byte, error)

	// Set stores a raw byte value with the given TTL.
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
}
