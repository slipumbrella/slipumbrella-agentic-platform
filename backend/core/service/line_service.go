package service

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type LineConfig struct {
	Configured    bool   `json:"configured"`
	TokenPreview  string `json:"token_preview,omitempty"`
	SecretPreview string `json:"secret_preview,omitempty"`
}

type LineService interface {
	SaveConfig(ctx context.Context, teamID uuid.UUID, accessToken, channelSecret string) error
	GetConfig(ctx context.Context, teamID uuid.UUID) (*LineConfig, error)
	GetToken(ctx context.Context, teamID uuid.UUID) (string, error)
	GetRawConfig(ctx context.Context, teamID uuid.UUID) (*model.Team, error)
	DeleteConfig(ctx context.Context, teamID uuid.UUID) error
	ValidateWebhookSignature(body []byte, signature string, channelSecret string) bool
	HandleWebhookEvents(ctx context.Context, teamID uuid.UUID, events []map[string]any) error
	ListMessages(ctx context.Context, teamID uuid.UUID, limit int) ([]*model.LineMessage, error)
}

type lineServiceImpl struct{ lineRepo repository.LineRepository }

func NewLineService(lineRepo repository.LineRepository) LineService {
	return &lineServiceImpl{lineRepo: lineRepo}
}

func (s *lineServiceImpl) SaveConfig(ctx context.Context, teamID uuid.UUID, accessToken, channelSecret string) error {
	return s.lineRepo.SaveConfig(ctx, teamID, accessToken, channelSecret)
}

func (s *lineServiceImpl) GetConfig(ctx context.Context, teamID uuid.UUID) (*LineConfig, error) {
	team, err := s.lineRepo.GetConfig(ctx, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &LineConfig{Configured: false}, nil
		}
		return nil, err
	}
	if team.LineChannelAccessToken == nil || *team.LineChannelAccessToken == "" {
		return &LineConfig{Configured: false}, nil
	}
	return &LineConfig{
		Configured:    true,
		TokenPreview:  maskSecret(*team.LineChannelAccessToken),
		SecretPreview: maskSecret(*team.LineChannelSecret),
	}, nil
}

func (s *lineServiceImpl) GetToken(ctx context.Context, teamID uuid.UUID) (string, error) {
	team, err := s.lineRepo.GetConfig(ctx, teamID)
	if err != nil || team.LineChannelAccessToken == nil {
		return "", nil
	}
	return *team.LineChannelAccessToken, nil
}

func (s *lineServiceImpl) GetRawConfig(ctx context.Context, teamID uuid.UUID) (*model.Team, error) {
	return s.lineRepo.GetConfig(ctx, teamID)
}

func (s *lineServiceImpl) DeleteConfig(ctx context.Context, teamID uuid.UUID) error {
	return s.lineRepo.DeleteConfig(ctx, teamID)
}

func (s *lineServiceImpl) ValidateWebhookSignature(body []byte, signature string, channelSecret string) bool {
	mac := hmac.New(sha256.New, []byte(channelSecret))
	mac.Write(body)
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

func (s *lineServiceImpl) HandleWebhookEvents(ctx context.Context, teamID uuid.UUID, events []map[string]any) error {
	for _, event := range events {
		if event["type"] != "message" {
			continue
		}
		msg := extractLineMessage(teamID, event)
		if msg == nil {
			continue
		}
		if err := s.lineRepo.SaveMessage(ctx, msg); err != nil {
			return err
		}
	}
	return nil
}

func (s *lineServiceImpl) ListMessages(ctx context.Context, teamID uuid.UUID, limit int) ([]*model.LineMessage, error) {
	return s.lineRepo.ListMessages(ctx, teamID, limit)
}

func maskSecret(s string) string {
	if len(s) <= 4 {
		return "***"
	}
	return "***..." + s[len(s)-4:]
}

func extractLineMessage(teamID uuid.UUID, event map[string]any) *model.LineMessage {
	source, _ := event["source"].(map[string]any)
	msgObj, _ := event["message"].(map[string]any)
	if source == nil || msgObj == nil {
		return nil
	}
	lineUserID, _ := source["userId"].(string)
	msgType, _ := msgObj["type"].(string)
	text, _ := msgObj["text"].(string)
	replyToken, _ := event["replyToken"].(string)
	raw, _ := json.Marshal(event)
	return &model.LineMessage{
		ID: uuid.New(), TeamID: teamID, LineUserID: lineUserID,
		MessageType: msgType, Content: text, ReplyToken: replyToken,
		RawEvent: raw, ReceivedAt: time.Now(),
	}
}
