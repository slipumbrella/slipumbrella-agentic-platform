package service

import (
	"capstone-prog/config"
	"capstone-prog/core/data/request"
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

var ErrOpenRouterModelIDRequired = errors.New("model id is required")
var ErrOpenRouterModelNameRequired = errors.New("model name is required")
var ErrOpenRouterModelUUIDRequired = errors.New("model uuid is required")
var ErrOpenRouterModelTagsRequired = errors.New("model tags are required")
var ErrOpenRouterModelTagsBlank = errors.New("model tags must not contain blank values")

type OpenRouterModelService interface {
	List(ctx context.Context) ([]*model.OpenRouterModel, error)
	ListActive(ctx context.Context) ([]*model.OpenRouterModel, error)
	Get(ctx context.Context, modelUUID string) (*model.OpenRouterModel, error)
	Create(ctx context.Context, req request.UpsertOpenRouterModelRequest, iconBytes []byte) (*model.OpenRouterModel, error)
	Update(ctx context.Context, modelUUID string, req request.UpsertOpenRouterModelRequest, iconBytes []byte) (*model.OpenRouterModel, error)
	Delete(ctx context.Context, modelUUID string) error
}

type openRouterModelService struct {
	repo      repository.OpenRouterModelRepository
	r2Service R2Service
	cfg       *config.Config
}

func NewOpenRouterModelService(repo repository.OpenRouterModelRepository, r2Service R2Service, cfg *config.Config) OpenRouterModelService {
	return &openRouterModelService{
		repo:      repo,
		r2Service: r2Service,
		cfg:       cfg,
	}
}

func (s *openRouterModelService) List(ctx context.Context) ([]*model.OpenRouterModel, error) {
	return s.repo.ListAll(ctx)
}

func (s *openRouterModelService) ListActive(ctx context.Context) ([]*model.OpenRouterModel, error) {
	return s.repo.ListActive(ctx)
}

func (s *openRouterModelService) Get(ctx context.Context, modelUUID string) (*model.OpenRouterModel, error) {
	parsedUUID, err := parseOpenRouterModelUUID(modelUUID)
	if err != nil {
		return nil, err
	}
	return s.repo.GetByUUID(ctx, parsedUUID)
}

func (s *openRouterModelService) Create(ctx context.Context, req request.UpsertOpenRouterModelRequest, iconBytes []byte) (*model.OpenRouterModel, error) {
	item, err := normalizeOpenRouterModelRequest(req)
	if err != nil {
		return nil, err
	}

	if len(iconBytes) > 0 {
		iconURL, err := s.uploadIcon(ctx, iconBytes)
		if err != nil {
			return nil, err
		}
		item.Icon = iconURL
	}

	if err := s.repo.Create(ctx, item); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *openRouterModelService) Update(ctx context.Context, modelUUID string, req request.UpsertOpenRouterModelRequest, iconBytes []byte) (*model.OpenRouterModel, error) {
	parsedUUID, err := parseOpenRouterModelUUID(modelUUID)
	if err != nil {
		return nil, err
	}

	item, err := normalizeOpenRouterModelRequest(req)
	if err != nil {
		return nil, err
	}

	if len(iconBytes) > 0 {
		iconURL, err := s.uploadIcon(ctx, iconBytes)
		if err != nil {
			return nil, err
		}
		item.Icon = iconURL
	} else if item.Icon == "" {
		// If no new icon file OR manual URL, preserve the existing one
		existing, err := s.repo.GetByUUID(ctx, parsedUUID)
		if err == nil && existing != nil {
			item.Icon = existing.Icon
		}
	}

	if err := s.repo.Update(ctx, parsedUUID, item); err != nil {
		return nil, err
	}
	item.UUID = parsedUUID
	return item, nil
}

func (s *openRouterModelService) uploadIcon(ctx context.Context, iconBytes []byte) (string, error) {
	hash := sha256.Sum256(iconBytes)
	hashStr := hex.EncodeToString(hash[:])
	key := "provider_icons/" + hashStr + ".png"

	if err := s.r2Service.UploadBytes(ctx, key, iconBytes, "image/png"); err != nil {
		return "", err
	}

	return s.cfg.R2_PUBLIC_URL + "/" + key, nil
}

func (s *openRouterModelService) Delete(ctx context.Context, modelUUID string) error {
	parsedUUID, err := parseOpenRouterModelUUID(modelUUID)
	if err != nil {
		return err
	}
	return s.repo.Delete(ctx, parsedUUID)
}

func normalizeOpenRouterModelRequest(req request.UpsertOpenRouterModelRequest) (*model.OpenRouterModel, error) {
	id := strings.TrimSpace(req.ID)
	name := strings.TrimSpace(req.Name)
	if id == "" {
		return nil, ErrOpenRouterModelIDRequired
	}
	if name == "" {
		return nil, ErrOpenRouterModelNameRequired
	}
	tags, err := normalizeOpenRouterModelTags(req.Tags)
	if err != nil {
		return nil, err
	}

	return &model.OpenRouterModel{
		ID:            id,
		Name:          name,
		Tags:          datatypes.NewJSONSlice(tags),
		SelectionHint: strings.TrimSpace(req.SelectionHint),
		AdvancedInfo:  strings.TrimSpace(req.AdvancedInfo),
		Description:   strings.TrimSpace(req.Description),
		ContextLength: req.ContextLength,
		InputPrice:    req.InputPrice,
		OutputPrice:   req.OutputPrice,
		IsReasoning:   req.IsReasoning,
		IsActive:      req.IsActive,
		Icon:          strings.TrimSpace(req.Icon),
	}, nil
}

func normalizeOpenRouterModelTags(rawTags []string) ([]string, error) {
	if len(rawTags) == 0 {
		return nil, ErrOpenRouterModelTagsRequired
	}

	tags := make([]string, 0, len(rawTags))
	for _, rawTag := range rawTags {
		tag := strings.TrimSpace(rawTag)
		if tag == "" {
			return nil, ErrOpenRouterModelTagsBlank
		}
		tags = append(tags, tag)
	}

	return tags, nil
}

func parseOpenRouterModelUUID(raw string) (uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return uuid.Nil, ErrOpenRouterModelUUIDRequired
	}

	parsedUUID, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, ErrOpenRouterModelUUIDRequired
	}

	return parsedUUID, nil
}
