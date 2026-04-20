package adapter

import (
	"capstone-prog/core/data/request"
	"capstone-prog/core/data/response"
	"capstone-prog/core/model"
	"capstone-prog/core/service"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type EmbeddingHandler struct {
	embeddingService service.EmbeddingService
}

func NewEmbeddingHandler(embeddingService service.EmbeddingService) *EmbeddingHandler {
	return &EmbeddingHandler{embeddingService: embeddingService}
}

func buildEmbeddingResponse(embeddings []*model.Embedding) []response.EmbeddingItemResponse {
	type entry struct {
		emb        *model.Embedding
		chunkCount int
		tokenTotal int
	}
	seen := make(map[uuid.UUID]*entry)
	order := make([]uuid.UUID, 0)
	for _, e := range embeddings {
		if ex, ok := seen[e.AttachmentID]; ok {
			ex.chunkCount++
			ex.tokenTotal += e.TokenCount
		} else {
			seen[e.AttachmentID] = &entry{emb: e, chunkCount: 1, tokenTotal: e.TokenCount}
			order = append(order, e.AttachmentID)
		}
	}
	items := make([]response.EmbeddingItemResponse, 0, len(order))
	for _, id := range order {
		ex := seen[id]
		items = append(items, response.EmbeddingItemResponse{
			ID:           ex.emb.ID,
			AttachmentID: ex.emb.AttachmentID,
			FileKey:      ex.emb.FileKey,
			TokenCount:   ex.tokenTotal,
			ChunkCount:   ex.chunkCount,
			Model:        ex.emb.Model,
			IsEmbedded:   true,
		})
	}
	return items
}

func (h *EmbeddingHandler) CreateEmbedding(c *gin.Context) {
	var req request.CreateEmbeddingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	referenceID, _ := uuid.Parse(req.ReferenceID)

	var attachmentIDs []uuid.UUID
	for _, idStr := range req.AttachmentIDs {
		parsed, err := uuid.Parse(idStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid attachment_id: " + idStr})
			return
		}
		attachmentIDs = append(attachmentIDs, parsed)
	}

	embeddings, err := h.embeddingService.CreateEmbeddings(c.Request.Context(), referenceID, userID.(uuid.UUID), attachmentIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if embeddings == nil {
		c.JSON(http.StatusAccepted, response.CreateEmbeddingsResponse{
			ReferenceID: referenceID,
			Total:       0,
			Embeddings:  []response.EmbeddingItemResponse{},
			Message:     "Embedding processing started in background",
		})
		return
	}

	items := buildEmbeddingResponse(embeddings)

	c.JSON(http.StatusOK, response.CreateEmbeddingsResponse{
		ReferenceID: referenceID,
		Total:       len(items),
		Embeddings:  items,
	})
}

func (h *EmbeddingHandler) GetEmbedding(c *gin.Context) {
	referenceID := c.Query("reference_id")
	if referenceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reference_id query param required"})
		return
	}

	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	refUUID, err := uuid.Parse(referenceID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	embeddings, err := h.embeddingService.GetByReferenceID(c.Request.Context(), refUUID, userID.(uuid.UUID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	items := buildEmbeddingResponse(embeddings)

	c.JSON(http.StatusOK, response.CreateEmbeddingsResponse{
		ReferenceID: refUUID,
		Total:       len(items),
		Embeddings:  items,
	})
}
