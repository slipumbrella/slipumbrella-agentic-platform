package gorm

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type IssueAdapter struct {
	db *gorm.DB
}

func NewIssueAdapter(db *gorm.DB) repository.IssueRepository {
	return &IssueAdapter{db: db}
}

func (r *IssueAdapter) Create(ctx context.Context, issue *model.Issue) error {
	if issue.ID == uuid.Nil {
		issue.ID = uuid.New()
	}
	return r.db.WithContext(ctx).Create(issue).Error
}

func (r *IssueAdapter) FindAllWithUser(ctx context.Context) ([]model.Issue, error) {
	var issues []model.Issue
	err := r.db.WithContext(ctx).
		Preload("User").
		Order("created_at desc").
		Find(&issues).Error
	return issues, err
}

func (r *IssueAdapter) UpdateStatus(ctx context.Context, id uuid.UUID, status string) error {
	return r.db.WithContext(ctx).
		Model(&model.Issue{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{"status": status}).Error
}
