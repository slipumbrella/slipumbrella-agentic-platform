package gorm

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type UserRepository struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) repository.UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) Create(ctx context.Context, user *model.User) error {
	user.IsActive = true
	return r.db.WithContext(ctx).Create(user).Error
}

func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).Where("email = ?", email).First(&user).Error
	return &user, err
}

func (r *UserRepository) FindByUsername(ctx context.Context, username string) (*model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).Where("username = ?", username).First(&user).Error
	return &user, err
}

func (r *UserRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).First(&user, id).Error
	return &user, err
}

func (r *UserRepository) FindAll(ctx context.Context) ([]*model.User, error) {
	var users []*model.User
	// GORM automatically adds `deleted_at IS NULL` for models with DeletedAt
	err := r.db.WithContext(ctx).Find(&users).Error
	return users, err
}

func (r *UserRepository) Update(ctx context.Context, user *model.User) error {
	return r.db.WithContext(ctx).Save(user).Error
}

func (r *UserRepository) Delete(ctx context.Context, id uuid.UUID) error {
	// Hard delete or Soft delete?
	// User said "prevent fetching deleted user" and "add deleted_at".
	// Usually this implies Soft Delete.
	// GORM Delete with struct/id matching triggers soft delete if model has DeletedAt.
	return r.db.WithContext(ctx).Delete(&model.User{}, id).Error
}

func (r *UserRepository) UpdateMustResetPassword(ctx context.Context, id uuid.UUID, mustReset bool) error {
	return r.db.WithContext(ctx).Model(&model.User{}).Where("id = ?", id).Update("must_reset_password", mustReset).Error
}
