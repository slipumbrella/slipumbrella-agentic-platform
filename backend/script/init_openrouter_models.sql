-- Seed helper for openrouter_models.
-- Schema migration is owned by backend startup via GORM AutoMigrate + bootstrap logic.
-- Run this only after the application has created the table.

INSERT INTO openrouter_models (id, name, tags, selection_hint, advanced_info, description, context_length, input_price, output_price, is_reasoning, is_active) VALUES
    (
        'arcee-ai/trinity-large-preview:free',
        'Trinity Large Preview (free)',
        '["Deep"]'::jsonb,
        'Strong for creative and tool-heavy workflows.',
        'Price: Free to use on OpenRouter. Reasoning: Strong for multi-step tasks and agent workflows. Context: Handles very long prompts and large working sets.',
        'A 400B-parameter sparse MoE model (13B active per token) from Arcee AI. Excels at creative writing, storytelling, role-play, and real-time voice assistance, while also performing well in agentic harnesses (Cline, Kilo Code). Supports 512k context natively (served at 131k in preview). Best for agents that need both strong conversational quality and reliable tool-chain navigation.',
        131000, 0.00000000, 0.00000000, true, true
    ),
    (
        'stepfun/step-3.5-flash:free',
        'Step 3.5 Flash (free)',
        '["Steady"]'::jsonb,
        'Balanced speed and reasoning for general builder teams.',
        'Price: Free to use on OpenRouter. Reasoning: Good analytical depth without feeling too heavy. Context: High context window for long plans and research input.',
        'StepFun''s most capable open-source model. A sparse MoE reasoning model (196B total, 11B active) with 256k context. Ranks top-90% on the Agentic Index and top-84% on overall intelligence. Exceptionally fast even at long contexts. Best for analytical, research, or planning agents that need high-quality reasoning without cost.',
        256000, 0.00000000, 0.00000000, true, true
    ),
    (
        'z-ai/glm-4.5-air:free',
        'GLM 4.5 Air (free)',
        '["Swift"]'::jsonb,
        'Fast responses with optional deeper reasoning when needed.',
        'Price: Free to use on OpenRouter. Reasoning: Can switch between lighter responses and deeper thinking. Context: Large enough for long prompts while staying responsive.',
        'Lightweight MoE variant of Z.ai''s flagship GLM-4.5, purpose-built for agent-centric applications. Supports a hybrid inference mode: thinking mode for advanced reasoning and tool use, and non-thinking mode for fast real-time responses. Good balance of speed and reasoning capability for execution agents.',
        131072, 0.00000000, 0.00000000, true, true
    ),
    (
        'meta-llama/llama-3.3-70b-instruct:free',
        'Llama 3.3 70B Instruct (free)',
        '["Swift"]'::jsonb,
        'Reliable multilingual option for straightforward tasks.',
        'Price: Free to use on OpenRouter. Reasoning: Better for direct instructions than deep multi-step analysis. Context: Strong context size for summaries, extraction, and general chat.',
        'Meta''s instruction-tuned 70B open-weight model, optimised for multilingual dialogue. Supports English, German, French, Italian, Portuguese, Hindi, Spanish, and Thai. Suitable for simple extraction, summarisation, and tool-execution agents where a reliable, cost-free general-purpose model is sufficient.',
        128000, 0.00000000, 0.00000000, false, true
    )
ON CONFLICT (id) DO UPDATE SET
    name           = EXCLUDED.name,
    tags           = EXCLUDED.tags,
    selection_hint = EXCLUDED.selection_hint,
    advanced_info  = EXCLUDED.advanced_info,
    description    = EXCLUDED.description,
    context_length = EXCLUDED.context_length,
    input_price    = EXCLUDED.input_price,
    output_price   = EXCLUDED.output_price,
    is_reasoning   = EXCLUDED.is_reasoning,
    is_active      = EXCLUDED.is_active;
