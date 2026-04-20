package service

import (
	"context"
	"errors"
	"testing"

	"capstone-prog/core/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type mockArtifactRepo struct {
	getByTeamFn func(ctx context.Context, teamID uuid.UUID) ([]model.Artifact, error)
	getByIDFn   func(ctx context.Context, id uuid.UUID) (*model.Artifact, error)
}

type mockArtifactTeamRepo struct {
	getTeamFn func(ctx context.Context, id, userID uuid.UUID) (*model.Team, error)
}

func (m *mockArtifactRepo) GetByTeam(ctx context.Context, teamID uuid.UUID) ([]model.Artifact, error) {
	if m.getByTeamFn != nil {
		return m.getByTeamFn(ctx, teamID)
	}
	return nil, nil
}

func (m *mockArtifactRepo) GetByID(ctx context.Context, id uuid.UUID) (*model.Artifact, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return nil, nil
}

func (m *mockArtifactTeamRepo) CreateTeam(context.Context, *model.Team) error { return nil }
func (m *mockArtifactTeamRepo) ListTeams(context.Context, uuid.UUID) ([]*model.Team, error) {
	return nil, nil
}
func (m *mockArtifactTeamRepo) GetTeam(ctx context.Context, id, userID uuid.UUID) (*model.Team, error) {
	if m.getTeamFn != nil {
		return m.getTeamFn(ctx, id, userID)
	}
	return &model.Team{ID: id, UserID: userID}, nil
}
func (m *mockArtifactTeamRepo) UpdateTeam(context.Context, *model.Team) error { return nil }
func (m *mockArtifactTeamRepo) DeleteTeam(context.Context, uuid.UUID) error   { return nil }
func (m *mockArtifactTeamRepo) AssignSessionToTeam(context.Context, uuid.UUID, string) error {
	return nil
}
func (m *mockArtifactTeamRepo) UnassignSession(context.Context, string) error { return nil }

func TestGetArtifactByID_ReturnsArtifact(t *testing.T) {
	artifactID := uuid.New()
	expected := &model.Artifact{
		ID:       artifactID,
		TeamID:   uuid.New(),
		Title:    "Test Report",
		FileType: "local_doc",
		Content:  "# Hello",
	}

	svc := &builderServiceImpl{
		teamRepo: &mockArtifactTeamRepo{},
		artifactRepo: &mockArtifactRepo{
			getByIDFn: func(_ context.Context, id uuid.UUID) (*model.Artifact, error) {
				if id == artifactID {
					return expected, nil
				}
				return nil, nil
			},
		},
	}

	got, err := svc.GetArtifactByID(context.Background(), artifactID.String(), uuid.New())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.ID != artifactID {
		t.Errorf("got ID %v, want %v", got.ID, artifactID)
	}
}

func TestGetArtifactByID_InvalidUUID(t *testing.T) {
	svc := &builderServiceImpl{artifactRepo: &mockArtifactRepo{}}

	_, err := svc.GetArtifactByID(context.Background(), "not-a-uuid", uuid.New())
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestGetArtifactByID_NotFound(t *testing.T) {
	svc := &builderServiceImpl{
		teamRepo: &mockArtifactTeamRepo{},
		artifactRepo: &mockArtifactRepo{
			getByIDFn: func(_ context.Context, _ uuid.UUID) (*model.Artifact, error) {
				return nil, nil
			},
		},
	}

	_, err := svc.GetArtifactByID(context.Background(), uuid.New().String(), uuid.New())
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestGetArtifactByID_RepoError(t *testing.T) {
	repoErr := errors.New("db unavailable")
	svc := &builderServiceImpl{
		teamRepo: &mockArtifactTeamRepo{},
		artifactRepo: &mockArtifactRepo{
			getByIDFn: func(_ context.Context, _ uuid.UUID) (*model.Artifact, error) {
				return nil, repoErr
			},
		},
	}

	_, err := svc.GetArtifactByID(context.Background(), uuid.New().String(), uuid.New())
	if !errors.Is(err, repoErr) {
		t.Errorf("expected raw repo error, got %v", err)
	}
}

func TestGetArtifactByID_ForbiddenWhenUserDoesNotOwnArtifactTeam(t *testing.T) {
	artifactID := uuid.New()
	teamID := uuid.New()
	svc := &builderServiceImpl{
		teamRepo: &mockArtifactTeamRepo{
			getTeamFn: func(_ context.Context, _ uuid.UUID, _ uuid.UUID) (*model.Team, error) {
				return nil, gorm.ErrRecordNotFound
			},
		},
		artifactRepo: &mockArtifactRepo{
			getByIDFn: func(_ context.Context, _ uuid.UUID) (*model.Artifact, error) {
				return &model.Artifact{ID: artifactID, TeamID: teamID}, nil
			},
		},
	}

	_, err := svc.GetArtifactByID(context.Background(), artifactID.String(), uuid.New())
	if !errors.Is(err, ErrForbidden) {
		t.Errorf("expected ErrForbidden, got %v", err)
	}
}
