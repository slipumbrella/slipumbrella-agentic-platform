package request

type CreateEmbeddingRequest struct {
	ReferenceID   string   `json:"reference_id" binding:"required,uuid"`
	AttachmentIDs []string `json:"attachment_ids,omitempty"`
}
