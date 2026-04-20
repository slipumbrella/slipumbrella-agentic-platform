package response

import "github.com/google/uuid"

type EmbeddingItemResponse struct {
	ID           uuid.UUID `json:"id"`
	AttachmentID uuid.UUID `json:"attachment_id"`
	FileKey      string    `json:"file_key"`
	TokenCount   int       `json:"token_count"`
	ChunkCount   int       `json:"chunk_count"`
	Model        string    `json:"model"`
	IsEmbedded   bool      `json:"is_embedded"`
}

type CreateEmbeddingsResponse struct {
	ReferenceID uuid.UUID               `json:"reference_id"`
	Total       int                     `json:"total"`
	Embeddings  []EmbeddingItemResponse `json:"embeddings"`
	Message     string                  `json:"message,omitempty"`
}
