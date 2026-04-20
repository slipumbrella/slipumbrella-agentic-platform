package redis

import (
	"capstone-prog/config"
	"capstone-prog/core/repository"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/go-redis/redis_rate/v10"
	goredis "github.com/redis/go-redis/v9"
)

type redisRepository struct {
	client  *goredis.Client
	limiter *redis_rate.Limiter
}

func NewRedisRepository(cfg *config.Config) repository.RedisRepository {
	client := goredis.NewClient(&goredis.Options{
		Addr:     fmt.Sprintf("%s:%s", cfg.RedisHost, cfg.RedisPort),
		Password: cfg.RedisPassword,
		DB:       0, // use default DB
	})

	return &redisRepository{
		client:  client,
		limiter: redis_rate.NewLimiter(client),
	}
}

func (r *redisRepository) Allow(ctx context.Context, key string, limit int, period time.Duration, burst int) (bool, time.Duration, error) {
	res, err := r.limiter.Allow(ctx, key, redis_rate.Limit{
		Rate:   limit,
		Period: period,
		Burst:  burst,
	})

	if err != nil {
		return false, 0, err
	}

	return res.Allowed == 1, res.RetryAfter, nil
}

func (r *redisRepository) Get(ctx context.Context, key string) ([]byte, error) {
	val, err := r.client.Get(ctx, key).Bytes()
	if errors.Is(err, goredis.Nil) {
		return nil, nil // cache miss — not an error
	}
	return val, err
}

func (r *redisRepository) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return r.client.Set(ctx, key, value, ttl).Err()
}
