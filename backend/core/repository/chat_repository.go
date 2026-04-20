package repository

import (
	"capstone-prog/core/model"
	"context"

	"github.com/google/uuid"
)

type ChatRepository interface {
	CreateSession(ctx context.Context, session *model.ChatSession) (string, error)
	GetSession(ctx context.Context, sessionID string) (*model.ChatSession, error)
	AppendMessage(ctx context.Context, chatMessage *model.ChatMessage) error
	GetMessages(ctx context.Context, sessionID string) ([]model.ChatMessage, error)
	ListSessions(ctx context.Context, userID uuid.UUID) ([]*model.ChatSession, error)
	GetSessionOwner(ctx context.Context, sessionID uuid.UUID) (uuid.UUID, error)
}
