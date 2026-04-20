package service

import (
	"context"

	"capstone-prog/core/repository"
	"io"

	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type R2Service interface {
	Get(ctx context.Context, key string) (*s3.HeadObjectOutput, error)
	Upload(ctx context.Context, key string, body io.Reader, contentType string) error
	UploadBytes(ctx context.Context, key string, data []byte, contentType string) error
	UploadString(ctx context.Context, key, content, contentType string) error
	Download(ctx context.Context, key string) ([]byte, error)
	Delete(ctx context.Context, key string) error
	List(ctx context.Context, prefix string, max int32) ([]string, error)
}

type r2ServiceImpl struct {
	r2Repo repository.R2Repository
}

// NewR2Service constructs a new R2Service.
func NewR2Service(r2Repo repository.R2Repository) R2Service {
	return &r2ServiceImpl{r2Repo: r2Repo}
}

func (s *r2ServiceImpl) Get(ctx context.Context, key string) (*s3.HeadObjectOutput, error) {
	return s.r2Repo.Get(ctx, key)
}

func (s *r2ServiceImpl) Upload(ctx context.Context, key string, body io.Reader, contentType string) error {
	return s.r2Repo.Upload(ctx, key, body, contentType)
}

func (s *r2ServiceImpl) UploadBytes(ctx context.Context, key string, data []byte, contentType string) error {
	return s.r2Repo.UploadBytes(ctx, key, data, contentType)
}

func (s *r2ServiceImpl) UploadString(ctx context.Context, key, content, contentType string) error {
	return s.r2Repo.UploadString(ctx, key, content, contentType)
}

func (s *r2ServiceImpl) Download(ctx context.Context, key string) ([]byte, error) {
	return s.r2Repo.Download(ctx, key)
}

func (s *r2ServiceImpl) Delete(ctx context.Context, key string) error {
	return s.r2Repo.Delete(ctx, key)
}

func (s *r2ServiceImpl) List(ctx context.Context, prefix string, max int32) ([]string, error) {
	return s.r2Repo.List(ctx, prefix, max)
}
