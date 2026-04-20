package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

type AttachmentType string

const (
	AttachmentTypePDF   AttachmentType = "PDF"
	AttachmentTypeImage AttachmentType = "IMAGE"
	AttachmentTypeVideo AttachmentType = "VIDEO"
	AttachmentTypeAudio AttachmentType = "AUDIO"
	AttachmentTypeText  AttachmentType = "TEXT"
	AttachmentTypeCSV   AttachmentType = "CSV"
	AttachmentTypeURL   AttachmentType = "URL"
)

type Attachment struct {
	ID               uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	ReferenceID      uuid.UUID      `json:"-" gorm:"type:uuid;not null;index"`
	FileName         string         `json:"-" gorm:"type:text;not null"`
	FileSize         int64          `json:"file_size" gorm:"type:bigint;not null"`
	Bucket           string         `json:"-" gorm:"column:bucket_name;type:text;not null"`
	FileKey          string         `json:"-" gorm:"type:text;not null"`
	OriginalFileName string         `json:"original_file_name" gorm:"column:original_filename;type:text;not null"`
	Meta             datatypes.JSON `json:"-" gorm:"type:jsonb;default:'{}'::jsonb"`
	IsEmbedded       bool           `json:"is_embedded" gorm:"type:bool;default:false;not null"`
	EmbeddingStatus  string         `json:"embedding_status" gorm:"type:text;default:'pending';not null"`
	CreatedAt        time.Time      `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt        time.Time      `json:"-" gorm:"autoUpdateTime"`
}
