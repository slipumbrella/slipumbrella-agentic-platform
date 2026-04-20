package config

import (
	"capstone-prog/core/model"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type DBConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	Name     string
}

type PoolSetting struct {
	MaxOpenConns           int
	MaxIdleConns           int
	ConnMaxIdleTimeMinutes int
	ConnMaxLifetimeMinutes int
}

var defaultPoolSettings = map[string]PoolSetting{
	"dev": {
		MaxOpenConns:           10,
		MaxIdleConns:           5,
		ConnMaxIdleTimeMinutes: 15,
		ConnMaxLifetimeMinutes: 30,
	},
}

func ConnectDatabase(cfg *Config) *gorm.DB {
	port, _ := strconv.Atoi(cfg.DBPort)
	db := connectDatabase(DBConfig{
		Host:     cfg.DBHost,
		Port:     port,
		User:     cfg.DBUser,
		Password: cfg.DBPassword,
		Name:     cfg.DBName,
	})

	configureConnectionPool(db, "dev")
	startConnectionLogger(db)

	if err := migrateEnums(db); err != nil {
		panic(err)
	}

	// Ensure the vector extension is installed before migrating
	if err := db.Exec("CREATE EXTENSION IF NOT EXISTS vector").Error; err != nil {
		slog.Error("Failed to create vector extension", "error", err)
		panic(err)
	}

	if err := autoMigrateModels(db); err != nil {
		panic(err)
	}

	return db
}

func connectDatabase(cfg DBConfig) *gorm.DB {
	var db *gorm.DB
	var err error

	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=disable TimeZone=Asia/Bangkok",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.Name,
	)
	db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})

	if err != nil {
		panic(err)
	}

	slog.Info("Successfully connected to the database")
	return db
}

func configureConnectionPool(db *gorm.DB, env string) {
	sqlDB, err := db.DB()
	if err != nil {
		panic("failed to get sql.DB from GORM")
	}
	setting := defaultPoolSettings[env]

	sqlDB.SetMaxOpenConns(setting.MaxOpenConns)
	sqlDB.SetMaxIdleConns(setting.MaxIdleConns)
	sqlDB.SetConnMaxIdleTime(time.Duration(setting.ConnMaxIdleTimeMinutes) * time.Minute)
	sqlDB.SetConnMaxLifetime(time.Duration(setting.ConnMaxLifetimeMinutes) * time.Minute)
}

func startConnectionLogger(db *gorm.DB) {
	sqlDB, err := db.DB()
	if err != nil {
		return
	}
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		for range ticker.C {
			stats := sqlDB.Stats()
			slog.Info("Database connection stats",
				slog.Int("open", stats.OpenConnections),
				slog.Int("in_use", stats.InUse),
				slog.Int("idle", stats.Idle),
				slog.Int("wait_count", int(stats.WaitCount)),
				slog.Int("max_open", stats.MaxOpenConnections),
			)
		}
	}()
}

// enumStatements lists PostgreSQL enum type definitions (without "CREATE TYPE").
// migrateEnums wraps each in an idempotent DO block — safe to run on every startup.
var enumStatements = []string{
	"chat_session_type AS ENUM ('planning', 'execution')",
}

func migrateEnums(db *gorm.DB) error {
	for _, stmt := range enumStatements {
		sql := fmt.Sprintf(
			`DO $$ BEGIN CREATE TYPE %s; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
			stmt,
		)
		if err := db.Exec(sql).Error; err != nil {
			return fmt.Errorf("enum migration failed for %q: %w", stmt, err)
		}
	}
	return nil
}

func autoMigrateModels(db *gorm.DB) error {
	if err := db.Exec("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"").Error; err != nil {
		return fmt.Errorf("failed to create uuid-ossp extension: %w", err)
	}
	if err := db.Exec("CREATE EXTENSION IF NOT EXISTS vector").Error; err != nil {
		return fmt.Errorf("failed to create vector extension (is pgvector installed?): %w", err)
	}
	// Drop the old single-column unique index; replaced by composite (attachment_id, chunk_index)
	if err := db.Exec("DROP INDEX IF EXISTS uni_embeddings_attachment_id").Error; err != nil {
		return fmt.Errorf("drop old embedding unique index: %w", err)
	}
	if err := db.AutoMigrate(
		&model.ChatSession{},
		&model.ChatMessage{},
		&model.User{},
		&model.Attachment{},
		&model.Evaluation{},
		&model.Team{},
		&model.AgentSession{},
		&model.SessionTeamAssignment{},
		&model.Plan{},
		&model.AgentDef{},
		&model.Embedding{},
		&model.SessionSnapshot{},
		&model.OpenRouterModel{},
		&model.TokenUsage{},
		&model.Artifact{},
		&model.LineMessage{},
		&model.Issue{},
	); err != nil {
		return err
	}
	// Backfill chunk_index = 0 for existing rows (table now guaranteed to exist).
	if err := db.Exec("UPDATE embeddings SET chunk_index = 0 WHERE chunk_index IS NULL").Error; err != nil {
		return fmt.Errorf("backfill chunk_index: %w", err)
	}
	if err := db.Exec(`
		INSERT INTO session_team_assignments (id, session_id, team_id, assigned_at)
		SELECT uuid_generate_v4(), s.session_id, s.team_id, s.created_at
		FROM sessions s
		WHERE s.team_id IS NOT NULL
		AND NOT EXISTS (
			SELECT 1 FROM session_team_assignments sta WHERE sta.session_id = s.session_id AND sta.revoked_at IS NULL
		)
	`).Error; err != nil {
		return fmt.Errorf("backfill session_team_assignments: %w", err)
	}
	return nil
}
