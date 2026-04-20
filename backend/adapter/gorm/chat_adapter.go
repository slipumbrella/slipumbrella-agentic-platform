package gorm

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ChatRepository struct {
	db *gorm.DB
}

func NewChatRepository(db *gorm.DB) repository.ChatRepository {
	return &ChatRepository{db: db}
}

func (r *ChatRepository) CreateSession(ctx context.Context, session *model.ChatSession) (string, error) {
	if err := r.db.WithContext(ctx).Create(&session).Error; err != nil {
		return "", err
	}

	return session.ID.String(), nil
}

func (r *ChatRepository) GetSession(ctx context.Context, sessionID string) (*model.ChatSession, error) {
	sessionUUID, err := uuid.Parse(sessionID)
	if err != nil {
		return nil, err
	}
	var session model.ChatSession
	if err := r.db.WithContext(ctx).Where("id = ?", sessionUUID).First(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *ChatRepository) AppendMessage(ctx context.Context, chatMessage *model.ChatMessage) error {
	return r.db.WithContext(ctx).Create(&chatMessage).Error
}

func (r *ChatRepository) GetMessages(ctx context.Context, sessionID string) ([]model.ChatMessage, error) {
	sessionUUID, err := uuid.Parse(sessionID)
	if err != nil {
		return nil, err
	}

	var messages []model.ChatMessage
	err = r.db.WithContext(ctx).Where("session_id = ?", sessionUUID).
		Order("created_at ASC").
		Find(&messages).Error

	if err != nil {
		return nil, err
	}

	return messages, nil
}

func (r *ChatRepository) ListSessions(ctx context.Context, userID uuid.UUID) ([]*model.ChatSession, error) {
	var sessions []*model.ChatSession
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND type = 'planning'", userID).
		Order("created_at DESC").
		Limit(50).
		Find(&sessions).Error
	return sessions, err
}

func (r *ChatRepository) GetSessionOwner(ctx context.Context, sessionID uuid.UUID) (uuid.UUID, error) {
	var session model.ChatSession
	err := r.db.WithContext(ctx).
		Select("id", "user_id").
		First(&session, "id = ?", sessionID).Error
	if err != nil {
		return uuid.Nil, err // gorm.ErrRecordNotFound propagated when row is missing
	}
	return session.UserID, nil
}
