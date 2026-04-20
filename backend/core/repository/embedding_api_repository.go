package repository

import "context"

type EmbeddingAPIRepository interface {
	Embed(ctx context.Context, text string) ([]float32, int, error)      // passage embedding
	EmbedBatch(ctx context.Context, texts []string) ([][]float32, int, error) // batch passage embedding
	EmbedQuery(ctx context.Context, text string) ([]float32, int, error) // query embedding (retrieval.query task)
}
