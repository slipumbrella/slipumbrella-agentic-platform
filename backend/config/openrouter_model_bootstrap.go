package config

import (
	"capstone-prog/core/model"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func bootstrapOpenRouterModels(db *gorm.DB) error {
	if err := db.Exec(`
		UPDATE openrouter_models
		SET uuid = uuid_generate_v4()
		WHERE uuid IS NULL
	`).Error; err != nil {
		return fmt.Errorf("backfill openrouter model uuid: %w", err)
	}

	if err := db.Exec(`
		DO $$
		BEGIN
			IF EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = current_schema()
				  AND table_name = 'openrouter_models'
				  AND column_name = 'tag'
			) THEN
				UPDATE openrouter_models
				SET tags = CASE
					WHEN tag IS NULL OR btrim(tag) = '' THEN '[]'::jsonb
					ELSE jsonb_build_array(btrim(tag))
				END
				WHERE tags IS NULL OR tags = '[]'::jsonb;
			END IF;
		END $$;
	`).Error; err != nil {
		return fmt.Errorf("backfill openrouter model tags: %w", err)
	}

	if err := db.Exec(`
		ALTER TABLE openrouter_models
		ALTER COLUMN uuid SET DEFAULT uuid_generate_v4(),
		ALTER COLUMN uuid SET NOT NULL,
		ALTER COLUMN id SET NOT NULL,
		ALTER COLUMN tags SET DEFAULT '[]'::jsonb,
		ALTER COLUMN tags SET NOT NULL,
		ALTER COLUMN selection_hint SET DEFAULT '',
		ALTER COLUMN selection_hint SET NOT NULL,
		ALTER COLUMN advanced_info SET DEFAULT '',
		ALTER COLUMN advanced_info SET NOT NULL,
		ALTER COLUMN description SET DEFAULT '',
		ALTER COLUMN description SET NOT NULL,
		ALTER COLUMN context_length SET DEFAULT 8192,
		ALTER COLUMN context_length SET NOT NULL,
		ALTER COLUMN input_price SET DEFAULT 0,
		ALTER COLUMN input_price SET NOT NULL,
		ALTER COLUMN output_price SET DEFAULT 0,
		ALTER COLUMN output_price SET NOT NULL,
		ALTER COLUMN is_reasoning SET DEFAULT FALSE,
		ALTER COLUMN is_reasoning SET NOT NULL,
		ALTER COLUMN is_active SET DEFAULT TRUE,
		ALTER COLUMN is_active SET NOT NULL
	`).Error; err != nil {
		return fmt.Errorf("finalize openrouter model columns: %w", err)
	}

	if err := db.Exec(`
		DO $$
		BEGIN
			IF EXISTS (
				SELECT 1
				FROM pg_constraint
				WHERE conname = 'openrouter_models_pkey'
				  AND conrelid = 'openrouter_models'::regclass
				  AND NOT EXISTS (
				  	SELECT 1
				  	FROM pg_constraint c
				  	JOIN pg_attribute a
				  		ON a.attrelid = c.conrelid
				  		AND a.attnum = ANY(c.conkey)
				  	WHERE c.conname = 'openrouter_models_pkey'
				  	  AND c.conrelid = 'openrouter_models'::regclass
				  	  AND a.attname = 'uuid'
				  )
			) THEN
				ALTER TABLE openrouter_models DROP CONSTRAINT openrouter_models_pkey;
				ALTER TABLE openrouter_models ADD CONSTRAINT openrouter_models_pkey PRIMARY KEY (uuid);
			END IF;
		END $$;
	`).Error; err != nil {
		return fmt.Errorf("set openrouter model primary key: %w", err)
	}

	if err := db.Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS openrouter_models_id_key
		ON openrouter_models (id)
	`).Error; err != nil {
		return fmt.Errorf("ensure openrouter model id unique index: %w", err)
	}

	if err := seedOpenRouterModels(db); err != nil {
		return fmt.Errorf("seed openrouter models: %w", err)
	}

	return nil
}

func seedOpenRouterModels(db *gorm.DB) error {
	items := defaultOpenRouterModels()
	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"name":           gorm.Expr("EXCLUDED.name"),
			"tags":           gorm.Expr("EXCLUDED.tags"),
			"selection_hint": gorm.Expr("EXCLUDED.selection_hint"),
			"advanced_info":  gorm.Expr("EXCLUDED.advanced_info"),
			"description":    gorm.Expr("EXCLUDED.description"),
			"context_length": gorm.Expr("EXCLUDED.context_length"),
			"input_price":    gorm.Expr("EXCLUDED.input_price"),
			"output_price":   gorm.Expr("EXCLUDED.output_price"),
			"is_reasoning":   gorm.Expr("EXCLUDED.is_reasoning"),
			"is_active":      gorm.Expr("EXCLUDED.is_active"),
		}),
	}).Create(&items).Error
}

func defaultOpenRouterModels() []model.OpenRouterModel {
	return []model.OpenRouterModel{
		{
			ID:            "arcee-ai/trinity-large-preview:free",
			Name:          "Trinity Large Preview (free)",
			Tags:          []string{"Deep"},
			SelectionHint: "Strong for creative and tool-heavy workflows.",
			AdvancedInfo:  "Price: Free to use on OpenRouter. Reasoning: Strong for multi-step tasks and agent workflows. Context: Handles very long prompts and large working sets.",
			Description:   "A 400B-parameter sparse MoE model (13B active per token) from Arcee AI. Excels at creative writing, storytelling, role-play, and real-time voice assistance, while also performing well in agentic harnesses (Cline, Kilo Code). Supports 512k context natively (served at 131k in preview). Best for agents that need both strong conversational quality and reliable tool-chain navigation.",
			ContextLength: 131000,
			InputPrice:    0,
			OutputPrice:   0,
			IsReasoning:   true,
			IsActive:      true,
		},
		{
			ID:            "stepfun/step-3.5-flash:free",
			Name:          "Step 3.5 Flash (free)",
			Tags:          []string{"Steady"},
			SelectionHint: "Balanced speed and reasoning for general builder teams.",
			AdvancedInfo:  "Price: Free to use on OpenRouter. Reasoning: Good analytical depth without feeling too heavy. Context: High context window for long plans and research input.",
			Description:   "StepFun's most capable open-source model. A sparse MoE reasoning model (196B total, 11B active) with 256k context. Ranks top-90% on the Agentic Index and top-84% on overall intelligence. Exceptionally fast even at long contexts. Best for analytical, research, or planning agents that need high-quality reasoning without cost.",
			ContextLength: 256000,
			InputPrice:    0,
			OutputPrice:   0,
			IsReasoning:   true,
			IsActive:      true,
		},
		{
			ID:            "z-ai/glm-4.5-air:free",
			Name:          "GLM 4.5 Air (free)",
			Tags:          []string{"Swift"},
			SelectionHint: "Fast responses with optional deeper reasoning when needed.",
			AdvancedInfo:  "Price: Free to use on OpenRouter. Reasoning: Can switch between lighter responses and deeper thinking. Context: Large enough for long prompts while staying responsive.",
			Description:   "Lightweight MoE variant of Z.ai's flagship GLM-4.5, purpose-built for agent-centric applications. Supports a hybrid inference mode: thinking mode for advanced reasoning and tool use, and non-thinking mode for fast real-time responses. Good balance of speed and reasoning capability for execution agents.",
			ContextLength: 131072,
			InputPrice:    0,
			OutputPrice:   0,
			IsReasoning:   true,
			IsActive:      true,
		},
		{
			ID:            "meta-llama/llama-3.3-70b-instruct:free",
			Name:          "Llama 3.3 70B Instruct (free)",
			Tags:          []string{"Swift"},
			SelectionHint: "Reliable multilingual option for straightforward tasks.",
			AdvancedInfo:  "Price: Free to use on OpenRouter. Reasoning: Better for direct instructions than deep multi-step analysis. Context: Strong context size for summaries, extraction, and general chat.",
			Description:   "Meta's instruction-tuned 70B open-weight model, optimised for multilingual dialogue. Supports English, German, French, Italian, Portuguese, Hindi, Spanish, and Thai. Suitable for simple extraction, summarisation, and tool-execution agents where a reliable, cost-free general-purpose model is sufficient.",
			ContextLength: 128000,
			InputPrice:    0,
			OutputPrice:   0,
			IsReasoning:   false,
			IsActive:      true,
		},
	}
}
