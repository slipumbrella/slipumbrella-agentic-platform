package response

import (
	"capstone-prog/core/model"

	"github.com/google/uuid"
)

type OpenRouterModelRecord struct {
	UUID          uuid.UUID `json:"uuid"`
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Tags          []string  `json:"tags"`
	SelectionHint string    `json:"selection_hint"`
	AdvancedInfo  string    `json:"advanced_info"`
	Description   string    `json:"description"`
	ContextLength int       `json:"context_length"`
	InputPrice    float64   `json:"input_price"`
	OutputPrice   float64   `json:"output_price"`
	IsReasoning   bool      `json:"is_reasoning"`
	IsActive      bool      `json:"is_active"`
	Icon          string    `json:"icon"`
}

type GetOpenRouterModelResponse struct {
	Model OpenRouterModelRecord `json:"model"`
}

type ListOpenRouterModelsResponse struct {
	Models []OpenRouterModelRecord `json:"models"`
}

func NewOpenRouterModelRecord(item *model.OpenRouterModel) OpenRouterModelRecord {
	if item == nil {
		return OpenRouterModelRecord{}
	}

	return OpenRouterModelRecord{
		UUID:          item.UUID,
		ID:            item.ID,
		Name:          item.Name,
		Tags:          append([]string(nil), []string(item.Tags)...),
		SelectionHint: item.SelectionHint,
		AdvancedInfo:  item.AdvancedInfo,
		Description:   item.Description,
		ContextLength: item.ContextLength,
		InputPrice:    item.InputPrice,
		OutputPrice:   item.OutputPrice,
		IsReasoning:   item.IsReasoning,
		IsActive:      item.IsActive,
		Icon:          item.Icon,
	}
}

func NewGetOpenRouterModelResponse(item *model.OpenRouterModel) GetOpenRouterModelResponse {
	return GetOpenRouterModelResponse{Model: NewOpenRouterModelRecord(item)}
}

func NewListOpenRouterModelsResponse(items []*model.OpenRouterModel) ListOpenRouterModelsResponse {
	models := make([]OpenRouterModelRecord, 0, len(items))
	for _, item := range items {
		models = append(models, NewOpenRouterModelRecord(item))
	}
	return ListOpenRouterModelsResponse{Models: models}
}
