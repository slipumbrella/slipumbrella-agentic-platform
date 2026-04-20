package service

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"
	"errors"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type UserService struct {
	userRepo repository.UserRepository
}

func NewUserService(userRepo repository.UserRepository) *UserService {
	return &UserService{
		userRepo: userRepo,
	}
}

func (s *UserService) GetAllUsers(ctx context.Context) ([]*model.User, error) {
	return s.userRepo.FindAll(ctx)
}

func (s *UserService) ChangePassword(ctx context.Context, userID uuid.UUID, oldPassword, newPassword string) error {
	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		return err
	}

	// Verify old password only if NOT a forced reset
	if !user.MustResetPassword {
		if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(oldPassword)); err != nil {
			return errors.New("invalid old password")
		}
	}

	if err := validatePasswordStrength(newPassword); err != nil {
		return err
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	user.Password = string(hashed)
	user.MustResetPassword = false // Clear the flag

	return s.userRepo.Update(ctx, user)
}

func (s *UserService) DeleteUser(ctx context.Context, userID uuid.UUID) error {
	return s.userRepo.Delete(ctx, userID)
}

func (s *UserService) ForcePasswordReset(ctx context.Context, userID uuid.UUID) error {
	return s.userRepo.UpdateMustResetPassword(ctx, userID, true)
}
