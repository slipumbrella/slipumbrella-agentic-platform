package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/pgvector/pgvector-go"
)

type Embedding struct {
	ID           uuid.UUID       `json:"id" gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	AttachmentID uuid.UUID       `json:"attachment_id" gorm:"type:uuid;not null;uniqueIndex:idx_embedding_chunk"`
	ChunkIndex   int             `json:"chunk_index" gorm:"type:int;not null;default:0;uniqueIndex:idx_embedding_chunk"`
	ReferenceID  uuid.UUID       `json:"reference_id" gorm:"type:uuid;not null;index:idx_embedding_tenant"`
	UserID       uuid.UUID       `json:"user_id" gorm:"type:uuid;not null;index:idx_embedding_tenant"`
	FileKey      string          `json:"file_key" gorm:"type:text;not null;index"`
	Content      string          `json:"content" gorm:"type:text"`
	Vector       pgvector.Vector `json:"-" gorm:"type:vector(2048);not null"`
	TokenCount   int             `json:"token_count" gorm:"type:int"`
	Model        string          `json:"model" gorm:"type:text;not null"`
	CreatedAt    time.Time       `json:"created_at" gorm:"autoCreateTime"`
}
