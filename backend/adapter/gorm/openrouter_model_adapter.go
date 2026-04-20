package gorm

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type OpenRouterModelAdapter struct {
	db *gorm.DB
}

func NewOpenRouterModelRepository(db *gorm.DB) repository.OpenRouterModelRepository {
	return &OpenRouterModelAdapter{db: db}
}

func (r *OpenRouterModelAdapter) ListAll(ctx context.Context) ([]*model.OpenRouterModel, error) {
	var items []*model.OpenRouterModel
	err := r.db.WithContext(ctx).Order("name ASC").Find(&items).Error
	return items, err
}

func (r *OpenRouterModelAdapter) ListActive(ctx context.Context) ([]*model.OpenRouterModel, error) {
	var items []*model.OpenRouterModel
	err := r.db.WithContext(ctx).Where("is_active = ?", true).Order("name ASC").Find(&items).Error
	return items, err
}

func (r *OpenRouterModelAdapter) GetByUUID(ctx context.Context, modelUUID uuid.UUID) (*model.OpenRouterModel, error) {
	var item model.OpenRouterModel
	err := r.db.WithContext(ctx).Where("uuid = ?", modelUUID).First(&item).Error
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *OpenRouterModelAdapter) Create(ctx context.Context, item *model.OpenRouterModel) error {
	if item.UUID == uuid.Nil {
		item.UUID = uuid.New()
	}
	return r.db.WithContext(ctx).Model(&model.OpenRouterModel{}).Create(map[string]any{
		"uuid":           item.UUID,
		"id":             item.ID,
		"name":           item.Name,
		"tags":           item.Tags,
		"selection_hint": item.SelectionHint,
		"advanced_info":  item.AdvancedInfo,
		"description":    item.Description,
		"context_length": item.ContextLength,
		"input_price":    item.InputPrice,
		"output_price":   item.OutputPrice,
		"is_reasoning":   item.IsReasoning,
		"is_active":      item.IsActive,
		"icon":           item.Icon,
	}).Error
}

func (r *OpenRouterModelAdapter) Update(ctx context.Context, modelUUID uuid.UUID, item *model.OpenRouterModel) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.OpenRouterModel{}).
			Where("uuid = ?", modelUUID).
			Updates(map[string]any{
				"id":             item.ID,
				"name":           item.Name,
				"tags":           item.Tags,
				"selection_hint": item.SelectionHint,
				"advanced_info":  item.AdvancedInfo,
				"description":    item.Description,
				"context_length": item.ContextLength,
				"input_price":    item.InputPrice,
				"output_price":   item.OutputPrice,
				"is_reasoning":   item.IsReasoning,
				"is_active":      item.IsActive,
				"icon":           item.Icon,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

func (r *OpenRouterModelAdapter) Delete(ctx context.Context, modelUUID uuid.UUID) error {
	result := r.db.WithContext(ctx).Delete(&model.OpenRouterModel{}, "uuid = ?", modelUUID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
