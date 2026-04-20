package service

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"

	"github.com/google/uuid"
)

type IssueService struct {
	repo repository.IssueRepository
}

func NewIssueService(repo repository.IssueRepository) *IssueService {
	return &IssueService{repo: repo}
}

func (s *IssueService) CreateIssue(ctx context.Context, userID uuid.UUID, issueType, subject, description string) (*model.Issue, error) {
	issue := &model.Issue{
		UserID:      userID,
		Type:        issueType,
		Subject:     subject,
		Description: description,
		Status:      "active",
	}
	if err := s.repo.Create(ctx, issue); err != nil {
		return nil, err
	}
	return issue, nil
}

func (s *IssueService) GetAllIssues(ctx context.Context) ([]model.Issue, error) {
	return s.repo.FindAllWithUser(ctx)
}

func (s *IssueService) UpdateIssueStatus(ctx context.Context, id uuid.UUID, status string) error {
	return s.repo.UpdateStatus(ctx, id, status)
}
