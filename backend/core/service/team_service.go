package service

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"

	"github.com/google/uuid"
)

type TeamService interface {
	CreateTeam(ctx context.Context, team *model.Team) error
	ListTeams(ctx context.Context, userID uuid.UUID) ([]*model.Team, error)
	GetTeam(ctx context.Context, id, userID uuid.UUID) (*model.Team, error)
	UpdateTeam(ctx context.Context, team *model.Team) error
	DeleteTeam(ctx context.Context, id uuid.UUID) error
	AssignSessionToTeam(ctx context.Context, teamID uuid.UUID, sessionID string, userID uuid.UUID) error
	UnassignSession(ctx context.Context, sessionID string, userID uuid.UUID) error
}

type teamServiceImpl struct {
	teamRepo    repository.TeamRepository
	sessionRepo repository.AgentSessionRepository
}

func NewTeamService(teamRepo repository.TeamRepository, sessionRepo repository.AgentSessionRepository) TeamService {
	return &teamServiceImpl{teamRepo: teamRepo, sessionRepo: sessionRepo}
}

func (s *teamServiceImpl) CreateTeam(ctx context.Context, team *model.Team) error {
	return s.teamRepo.CreateTeam(ctx, team)
}

func (s *teamServiceImpl) ListTeams(ctx context.Context, userID uuid.UUID) ([]*model.Team, error) {
	return s.teamRepo.ListTeams(ctx, userID)
}

func (s *teamServiceImpl) GetTeam(ctx context.Context, id, userID uuid.UUID) (*model.Team, error) {
	return s.teamRepo.GetTeam(ctx, id, userID)
}

func (s *teamServiceImpl) UpdateTeam(ctx context.Context, team *model.Team) error {
	return s.teamRepo.UpdateTeam(ctx, team)
}

func (s *teamServiceImpl) DeleteTeam(ctx context.Context, id uuid.UUID) error {
	return s.teamRepo.DeleteTeam(ctx, id)
}

func (s *teamServiceImpl) AssignSessionToTeam(ctx context.Context, teamID uuid.UUID, sessionID string, userID uuid.UUID) error {
	team, err := s.teamRepo.GetTeam(ctx, teamID, userID)
	if err != nil || team == nil {
		return ErrNotFound
	}

	session, err := s.sessionRepo.GetSession(ctx, sessionID, userID)
	if err != nil || session == nil {
		return ErrNotFound
	}

	if err := s.teamRepo.AssignSessionToTeam(ctx, teamID, sessionID); err != nil {
		return ErrNotFound
	}
	return nil
}

func (s *teamServiceImpl) UnassignSession(ctx context.Context, sessionID string, userID uuid.UUID) error {
	session, err := s.sessionRepo.GetSession(ctx, sessionID, userID)
	if err != nil || session == nil || session.TeamID == nil || session.Team == nil {
		return ErrNotFound
	}
	if session.Team.UserID != userID {
		return ErrForbidden
	}

	if err := s.teamRepo.UnassignSession(ctx, sessionID); err != nil {
		return ErrNotFound
	}
	return nil
}
