package bucket

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"

	projectConfig "capstone-prog/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type R2Repository struct {
	S3Client *s3.Client
	Bucket   string
}

// LoadAWSConfig builds an AWS config using values from the project configuration + env vars.
// We accept the project config so that values already loaded from .env can be reused.
func LoadAWSConfig(cfg *projectConfig.Config) aws.Config {
	confg, err := config.LoadDefaultConfig(
		context.TODO(),
		config.WithRegion(cfg.AWS_REGION),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AWS_ACCESS_KEY_ID, cfg.AWS_SECRET_ACCESS_KEY, "")),
	)
	if err != nil {
		log.Fatalf("failed to load AWS config: %v", err)
	}
	return confg
}

func NewR2Repository(cfg *projectConfig.Config) *R2Repository {
	return NewR2RepositoryWithBucket(cfg, cfg.R2_BUCKET)
}

func NewR2RepositoryWithBucket(cfg *projectConfig.Config, bucketName string) *R2Repository {
	confg := LoadAWSConfig(cfg)

	s3Client := s3.NewFromConfig(confg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.R2_ENDPOINT)
		o.UsePathStyle = true // important for R2
	})

	return &R2Repository{
		S3Client: s3Client,
		Bucket:   bucketName,
	}
}

// Get: return object metadata (HEAD)
func (r *R2Repository) Get(ctx context.Context, key string) (*s3.HeadObjectOutput, error) {
	out, err := r.S3Client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(r.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("head object %s/%s: %w", r.Bucket, key, err)
	}
	return out, nil
}

// Upload: stream upload; set contentType if provided
func (r *R2Repository) Upload(ctx context.Context, key string, body io.Reader, contentType string) error {
	input := &s3.PutObjectInput{
		Bucket: aws.String(r.Bucket),
		Key:    aws.String(key),
		Body:   body,
		ACL:    types.ObjectCannedACLPrivate, // R2 default; adjust if needed
	}
	if contentType != "" {
		input.ContentType = aws.String(contentType)
	}
	_, err := r.S3Client.PutObject(ctx, input)
	if err != nil {
		return fmt.Errorf("put object %s/%s: %w", r.Bucket, key, err)
	}
	return nil
}

// Delete: remove one object
func (r *R2Repository) Delete(ctx context.Context, key string) error {
	_, err := r.S3Client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(r.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("delete object %s/%s: %w", r.Bucket, key, err)
	}
	return nil
}

// List: list keys under prefix (first `max` keys)
func (r *R2Repository) List(ctx context.Context, prefix string, max int32) ([]string, error) {
	out, err := r.S3Client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket:  aws.String(r.Bucket),
		Prefix:  aws.String(prefix),
		MaxKeys: aws.Int32(max),
	})
	if err != nil {
		return nil, fmt.Errorf("list objects %s/%s: %w", r.Bucket, prefix, err)
	}
	if out == nil {
		return nil, errors.New("nil ListObjectsV2 response")
	}
	keys := make([]string, 0, len(out.Contents))
	for _, obj := range out.Contents {
		if obj.Key != nil {
			keys = append(keys, *obj.Key)
		}
	}
	return keys, nil
}

// Download: read the whole object into memory
func (r *R2Repository) Download(ctx context.Context, key string) ([]byte, error) {
	out, err := r.S3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("get object %s/%s: %w", r.Bucket, key, err)
	}
	defer out.Body.Close()

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, out.Body); err != nil {
		return nil, fmt.Errorf("read body %s/%s: %w", r.Bucket, key, err)
	}
	return buf.Bytes(), nil
}

// UploadBytes: upload object from memory
func (r *R2Repository) UploadBytes(ctx context.Context, key string, data []byte, contentType string) error {
	body := bytes.NewReader(data)
	input := &s3.PutObjectInput{
		Bucket:        aws.String(r.Bucket),
		Key:           aws.String(key),
		Body:          body,
		ContentLength: aws.Int64(int64(len(data))),
		ACL:           types.ObjectCannedACLPrivate,
	}
	if contentType != "" {
		input.ContentType = aws.String(contentType)
	}
	if _, err := r.S3Client.PutObject(ctx, input); err != nil {
		return fmt.Errorf("put object (bytes) %s/%s: %w", r.Bucket, key, err)
	}
	return nil
}

// UploadString: helper for small text payloads
func (r *R2Repository) UploadString(ctx context.Context, key, content, contentType string) error {
	return r.UploadBytes(ctx, key, []byte(content), contentType)
}
