package response

import (
	"capstone-prog/core/model"
	"testing"

	"github.com/google/uuid"
)

func TestNewOpenRouterModelRecordCopiesModelFields(t *testing.T) {
	item := &model.OpenRouterModel{
		UUID:          uuid.New(),
		ID:            "openai/gpt-4.1-mini",
		Name:          "GPT-4.1 Mini",
		Tags:          []string{"Steady", "Preview"},
		SelectionHint: "Balanced default.",
		AdvancedInfo:  "Price: Mid. Reasoning: Good. Context: Long.",
		Description:   "Balanced model",
		ContextLength: 128000,
		InputPrice:    0.4,
		OutputPrice:   1.6,
		IsReasoning:   false,
		IsActive:      true,
	}

	record := NewOpenRouterModelRecord(item)
	if len(record.Tags) != 2 || record.Tags[0] != "Steady" {
		t.Fatalf("expected copied tags, got %#v", record.Tags)
	}
	record.Tags[0] = "Changed"

	if record.UUID != item.UUID {
		t.Fatalf("expected UUID %v, got %v", item.UUID, record.UUID)
	}
	if item.Tags[0] != "Steady" {
		t.Fatalf("expected source tags to remain unchanged, got %#v", item.Tags)
	}
}
