package openrouter

import (
	"bytes"
	"capstone-prog/core/repository"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

const openrouterEndpoint = "https://openrouter.ai/api/v1/embeddings"
const defaultModel = "qwen/qwen3-embedding-8b"
const defaultDimensions = 2048

type OpenRouterAdapter struct {
	apiKey string
	client *http.Client
}

func NewOpenRouterAdapter(apiKey string) repository.EmbeddingAPIRepository {
	return &OpenRouterAdapter{
		apiKey: apiKey,
		client: &http.Client{},
	}
}

type openRouterRequest struct {
	Model      string   `json:"model"`
	Input      []string `json:"input"`
	Dimensions int      `json:"dimensions"`
}

type openRouterResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
		Index     int       `json:"index"`
	} `json:"data"`
	Usage struct {
		TotalTokens int `json:"total_tokens"`
	} `json:"usage"`
}

func (a *OpenRouterAdapter) Embed(ctx context.Context, text string) ([]float32, int, error) {
	embeddings, tokens, err := a.EmbedBatch(ctx, []string{text})
	if err != nil {
		return nil, 0, err
	}
	if len(embeddings) == 0 {
		return nil, 0, fmt.Errorf("no embedding returned")
	}
	return embeddings[0], tokens, nil
}

func (a *OpenRouterAdapter) EmbedBatch(ctx context.Context, texts []string) ([][]float32, int, error) {
	return a.embedBatch(ctx, texts)
}

func (a *OpenRouterAdapter) EmbedQuery(ctx context.Context, text string) ([]float32, int, error) {
	embeddings, tokens, err := a.EmbedBatch(ctx, []string{text})
	if err != nil {
		return nil, 0, err
	}
	if len(embeddings) == 0 {
		return nil, 0, fmt.Errorf("no embedding returned")
	}
	return embeddings[0], tokens, nil
}

func (a *OpenRouterAdapter) embedBatch(ctx context.Context, texts []string) ([][]float32, int, error) {
	reqBody := openRouterRequest{
		Model:      defaultModel,
		Input:      texts,
		Dimensions: defaultDimensions,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, 0, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", openrouterEndpoint, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	req.Header.Set("HTTP-Referer", "https://slipumbrella.com")
	req.Header.Set("X-Title", "slipumbrella embedding service")

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("openrouter API returned status %d", resp.StatusCode)
	}

	var orResp openRouterResponse
	if err := json.NewDecoder(resp.Body).Decode(&orResp); err != nil {
		return nil, 0, fmt.Errorf("decode response: %w", err)
	}

	if len(orResp.Data) == 0 {
		return nil, 0, fmt.Errorf("no embedding returned")
	}

	results := make([][]float32, len(orResp.Data))
	// OpenRouter returns data with indices, let's map them correctly
	for _, item := range orResp.Data {
		if item.Index < len(results) {
			results[item.Index] = item.Embedding
		}
	}

	return results, orResp.Usage.TotalTokens, nil
}
