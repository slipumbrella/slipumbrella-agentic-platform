package service

import (
	"testing"

	"capstone-prog/core/data/request"

	"github.com/stretchr/testify/require"
)

func TestNormalizeOpenRouterModelRequestRejectsBlankTagEntry(t *testing.T) {
	_, err := normalizeOpenRouterModelRequest(request.UpsertOpenRouterModelRequest{
		ID:   "openai/gpt-4.1-mini",
		Name: "GPT-4.1 Mini",
		Tags: []string{"Steady", "   "},
	})

	require.ErrorIs(t, err, ErrOpenRouterModelTagsBlank)
}

func TestNormalizeOpenRouterModelRequestTrimsTags(t *testing.T) {
	item, err := normalizeOpenRouterModelRequest(request.UpsertOpenRouterModelRequest{
		ID:   "  openai/gpt-4.1-mini ",
		Name: " GPT-4.1 Mini ",
		Tags: []string{"  Steady  ", " Preview "},
	})

	require.NoError(t, err)
	require.Equal(t, []string{"Steady", "Preview"}, []string(item.Tags))
}
