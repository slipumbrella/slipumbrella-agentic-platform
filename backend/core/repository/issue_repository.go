package repository

import (
	"capstone-prog/core/model"
	"context"

	"github.com/google/uuid"
)

type IssueRepository interface {
	Create(ctx context.Context, issue *model.Issue) error
	FindAllWithUser(ctx context.Context) ([]model.Issue, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status string) error
}
