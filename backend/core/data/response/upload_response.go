package response

type UploadResponse struct {
	FilePath string `json:"file_path"`
	FileSize int64  `json:"file_size"`
}

type GetAttachmentResponse struct {
	Attachment Attachment `json:"attachment"`
}

type ListAttachmentResponse struct {
	Attachments []Attachment `json:"attachments"`
}

type Attachment struct {
	ID               string `json:"id"`
	OriginalFileName string `json:"original_file_name"`
	FileSize         int64  `json:"file_size"`
	ContentType      string `json:"content_type"`
	CreatedAt        string `json:"created_at"`
	IsEmbedded       bool   `json:"is_embedded"`
	EmbeddingStatus  string `json:"embedding_status"`
}
