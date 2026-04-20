package jina

import (
	"bytes"
	"capstone-prog/core/repository"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

const jinaEndpoint = "https://api.jina.ai/v1/embeddings"

type JinaAdapter struct {
	apiKey string
	client *http.Client
}

func NewJinaAdapter(apiKey string) repository.EmbeddingAPIRepository {
	return &JinaAdapter{
		apiKey: apiKey,
		client: &http.Client{},
	}
}

type jinaRequest struct {
	Model      string   `json:"model"`
	Input      []string `json:"input"`
	Task       string   `json:"task"`
	Dimensions int      `json:"dimensions"`
}

type jinaResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
		Index     int       `json:"index"`
	} `json:"data"`
	Usage struct {
		TotalTokens int `json:"total_tokens"`
	} `json:"usage"`
}

func (a *JinaAdapter) Embed(ctx context.Context, text string) ([]float32, int, error) {
	embeddings, tokens, err := a.embedBatch(ctx, []string{text}, "retrieval.passage")
	if err != nil {
		return nil, 0, err
	}
	if len(embeddings) == 0 {
		return nil, 0, fmt.Errorf("no embedding returned")
	}
	return embeddings[0], tokens, nil
}

func (a *JinaAdapter) EmbedBatch(ctx context.Context, texts []string) ([][]float32, int, error) {
	return a.embedBatch(ctx, texts, "retrieval.passage")
}

func (a *JinaAdapter) EmbedQuery(ctx context.Context, text string) ([]float32, int, error) {
	embeddings, tokens, err := a.embedBatch(ctx, []string{text}, "retrieval.query")
	if err != nil {
		return nil, 0, err
	}
	if len(embeddings) == 0 {
		return nil, 0, fmt.Errorf("no embedding returned")
	}
	return embeddings[0], tokens, nil
}

func (a *JinaAdapter) embedBatch(ctx context.Context, texts []string, task string) ([][]float32, int, error) {
	reqBody := jinaRequest{
		Model:      "jina-embeddings-v4",
		Input:      texts,
		Task:       task,
		Dimensions: 2048,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, 0, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", jinaEndpoint, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("jina API returned status %d", resp.StatusCode)
	}

	var jinaResp jinaResponse
	if err := json.NewDecoder(resp.Body).Decode(&jinaResp); err != nil {
		return nil, 0, fmt.Errorf("decode response: %w", err)
	}

	if len(jinaResp.Data) == 0 {
		return nil, 0, fmt.Errorf("no embedding returned")
	}

	results := make([][]float32, len(jinaResp.Data))
	for _, item := range jinaResp.Data {
		if item.Index < len(results) {
			results[item.Index] = item.Embedding
		}
	}

	return results, jinaResp.Usage.TotalTokens, nil
}
