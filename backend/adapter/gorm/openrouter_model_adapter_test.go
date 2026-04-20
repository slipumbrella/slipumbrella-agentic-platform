package gorm_test

import (
	"context"
	"os"
	"testing"

	gormAdapter "capstone-prog/adapter/gorm"
	"capstone-prog/core/model"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func openOpenRouterModelTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := os.Getenv("OPENROUTER_MODEL_TEST_DSN")
	if dsn == "" {
		t.Skip("OPENROUTER_MODEL_TEST_DSN is not set")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	require.NoError(t, err)

	sqlDB, err := db.DB()
	require.NoError(t, err)

	require.NoError(t, db.Exec("DROP TABLE IF EXISTS openrouter_models").Error)
	require.NoError(t, db.AutoMigrate(&model.OpenRouterModel{}))

	t.Cleanup(func() {
		require.NoError(t, db.Exec("DROP TABLE IF EXISTS openrouter_models").Error)
		require.NoError(t, sqlDB.Close())
	})

	return db
}

func TestOpenRouterModelAdapter_CRUD(t *testing.T) {
	db := openOpenRouterModelTestDB(t)

	repo := gormAdapter.NewOpenRouterModelRepository(db)
	ctx := context.Background()

	activeItem := &model.OpenRouterModel{
		UUID:          uuid.New(),
		ID:            "openai/gpt-4.1-mini",
		Name:          "GPT-4.1 Mini",
		Tags:          []string{"Steady", "Preview"},
		SelectionHint: "Balanced default for most teams.",
		AdvancedInfo:  "Price: Mid. Reasoning: Good general reasoning. Context: Handles long instructions.",
		Description:   "Balanced model",
		ContextLength: 128000,
		InputPrice:    0.4,
		OutputPrice:   1.6,
		IsReasoning:   false,
		IsActive:      true,
	}
	inactiveItem := &model.OpenRouterModel{
		UUID:        uuid.New(),
		ID:          "openai/o4-mini",
		Name:        "o4 Mini",
		Tags:        []string{"Swift"},
		Description: "Inactive model",
		IsActive:    false,
	}

	require.NoError(t, repo.Create(ctx, activeItem))
	require.NoError(t, repo.Create(ctx, inactiveItem))

	items, err := repo.ListAll(ctx)
	require.NoError(t, err)
	require.Len(t, items, 2)

	activeItems, err := repo.ListActive(ctx)
	require.NoError(t, err)
	require.Len(t, activeItems, 1)
	require.Equal(t, activeItem.ID, activeItems[0].ID)
	require.Equal(t, []string(activeItem.Tags), []string(activeItems[0].Tags))
	require.Equal(t, activeItem.SelectionHint, activeItems[0].SelectionHint)
	require.Equal(t, activeItem.AdvancedInfo, activeItems[0].AdvancedInfo)

	found, err := repo.GetByUUID(ctx, activeItem.UUID)
	require.NoError(t, err)
	require.NotNil(t, found)
	require.Equal(t, "GPT-4.1 Mini", found.Name)
	require.Equal(t, []string{"Steady", "Preview"}, []string(found.Tags))
	require.Equal(t, "Balanced default for most teams.", found.SelectionHint)

	activeItem.ID = "openai/gpt-4.1"
	activeItem.Name = "GPT-4.1"
	activeItem.Tags = []string{"Deep"}
	require.NoError(t, repo.Update(ctx, activeItem.UUID, activeItem))

	updated, err := repo.GetByUUID(ctx, activeItem.UUID)
	require.NoError(t, err)
	require.NotNil(t, updated)
	require.Equal(t, "GPT-4.1", updated.Name)
	require.Equal(t, []string{"Deep"}, []string(updated.Tags))

	_, err = repo.GetByUUID(ctx, uuid.New())
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)

	require.NoError(t, repo.Delete(ctx, activeItem.UUID))

	items, err = repo.ListAll(ctx)
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, inactiveItem.ID, items[0].ID)
}
