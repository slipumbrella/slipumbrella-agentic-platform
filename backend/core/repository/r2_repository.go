package repository

import (
	"context"
	"io"

	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type R2Repository interface {
	// Define methods for interacting with R2 storage here
	Get(ctx context.Context, key string) (*s3.HeadObjectOutput, error)
	Upload(ctx context.Context, key string, body io.Reader, contentType string) error
	Delete(ctx context.Context, key string) error
	List(ctx context.Context, prefix string, max int32) ([]string, error)
	Download(ctx context.Context, key string) ([]byte, error)
	UploadBytes(ctx context.Context, key string, data []byte, contentType string) error
	UploadString(ctx context.Context, key, content, contentType string) error
}
