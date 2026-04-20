package config

import (
	"capstone-prog/core/model"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func openOpenRouterBootstrapTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := os.Getenv("OPENROUTER_MODEL_TEST_DSN")
	if dsn == "" {
		t.Skip("OPENROUTER_MODEL_TEST_DSN is not set")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error)
	require.NoError(t, db.Exec(`DROP TABLE IF EXISTS openrouter_models`).Error)

	t.Cleanup(func() {
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, db.Exec(`DROP TABLE IF EXISTS openrouter_models`).Error)
		require.NoError(t, sqlDB.Close())
	})

	return db
}

func TestBootstrapOpenRouterModelsMigratesLegacySchemaAndSeeds(t *testing.T) {
	db := openOpenRouterBootstrapTestDB(t)

	require.NoError(t, db.Exec(`
		CREATE TABLE openrouter_models (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			tag TEXT,
			is_active BOOLEAN NOT NULL DEFAULT TRUE
		)
	`).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO openrouter_models (id, name, tag, is_active)
		VALUES ('legacy/model', 'Legacy Model', ' Preview ', TRUE)
	`).Error)
	require.NoError(t, db.AutoMigrate(&model.OpenRouterModel{}))
	require.NoError(t, bootstrapOpenRouterModels(db))

	var legacy model.OpenRouterModel
	require.NoError(t, db.Where("id = ?", "legacy/model").First(&legacy).Error)
	require.NotEqual(t, uuid.Nil, legacy.UUID)
	require.Equal(t, []string{"Preview"}, []string(legacy.Tags))

	var pkCount int64
	require.NoError(t, db.Raw(`
		SELECT COUNT(*)
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
		WHERE t.relname = 'openrouter_models'
		  AND c.contype = 'p'
		  AND a.attname = 'uuid'
	`).Scan(&pkCount).Error)
	require.EqualValues(t, 1, pkCount)

	err := db.Create(&model.OpenRouterModel{
		ID:            "legacy/model",
		Name:          "Duplicate Legacy Model",
		Tags:          []string{"Deep"},
		ContextLength: 8192,
	}).Error
	require.Error(t, err)

	var seeded model.OpenRouterModel
	require.NoError(t, db.Where("id = ?", "stepfun/step-3.5-flash:free").First(&seeded).Error)
	require.Equal(t, []string{"Steady"}, []string(seeded.Tags))
	require.True(t, seeded.IsActive)
}
