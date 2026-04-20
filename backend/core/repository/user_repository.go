package repository

import (
	"capstone-prog/core/model"
	"context"

	"github.com/google/uuid"
)

type UserRepository interface {
	Create(ctx context.Context, user *model.User) error
	FindByEmail(ctx context.Context, email string) (*model.User, error)
	FindByUsername(ctx context.Context, username string) (*model.User, error)
	FindByID(ctx context.Context, id uuid.UUID) (*model.User, error)
	FindAll(ctx context.Context) ([]*model.User, error)

	Update(ctx context.Context, user *model.User) error
	Delete(ctx context.Context, id uuid.UUID) error
	UpdateMustResetPassword(ctx context.Context, id uuid.UUID, mustReset bool) error
}
