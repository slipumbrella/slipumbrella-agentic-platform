package service

import (
	"capstone-prog/core/helper"
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/pgvector/pgvector-go"
	"log/slog"
	"sync"
)

type embeddingTask struct {
	referenceID   uuid.UUID
	userID        uuid.UUID
	attachmentIDs []uuid.UUID
}

type EmbeddingService interface {
	CreateEmbeddings(ctx context.Context, referenceID, userID uuid.UUID, attachmentIDs []uuid.UUID) ([]*model.Embedding, error)
	GetByReferenceID(ctx context.Context, referenceID, userID uuid.UUID) ([]*model.Embedding, error)
	SearchSimilar(ctx context.Context, referenceID uuid.UUID, queryText string, topK int) ([]string, error)
}

type embeddingServiceImpl struct {
	embeddingRepo    repository.EmbeddingRepository
	attachmentRepo   repository.AttachmentRepository
	embeddingAPIRepo repository.EmbeddingAPIRepository
	r2Service        R2Service
	evaluationService EvaluationService
	taskQueue        chan embeddingTask
	wg               sync.WaitGroup
}

func NewEmbeddingService(
	embeddingRepo repository.EmbeddingRepository,
	attachmentRepo repository.AttachmentRepository,
	embeddingAPIRepo repository.EmbeddingAPIRepository,
	r2Service R2Service,
	evaluationService EvaluationService,
) EmbeddingService {
	s := &embeddingServiceImpl{
		embeddingRepo:    embeddingRepo,
		attachmentRepo:   attachmentRepo,
		embeddingAPIRepo: embeddingAPIRepo,
		r2Service:        r2Service,
		evaluationService: evaluationService,
		taskQueue:        make(chan embeddingTask, 100),
	}

	// Start workers
	s.wg.Add(1)
	go s.worker()

	return s
}

func (s *embeddingServiceImpl) worker() {
	defer s.wg.Done()
	slog.Info("Embedding background worker started")
	for task := range s.taskQueue {
		slog.Info("Processing embedding task", "reference_id", task.referenceID, "attachment_count", len(task.attachmentIDs))
		// Use background context for background work
		ctx := context.Background()
		_, err := s.processEmbeddings(ctx, task.referenceID, task.userID, task.attachmentIDs)
		if err != nil {
			slog.Error("Failed to process background embeddings", "reference_id", task.referenceID, "error", err)
		} else {
			slog.Info("Successfully processed background embeddings, triggering evaluation", "reference_id", task.referenceID)
			_, evalErr := s.evaluationService.TriggerEvaluation(ctx, task.referenceID, task.userID)
			if evalErr != nil {
				slog.Error("Failed to trigger post-embedding evaluation", "reference_id", task.referenceID, "error", evalErr)
			}
		}
	}
}

func (s *embeddingServiceImpl) CreateEmbeddings(ctx context.Context, referenceID, userID uuid.UUID, attachmentIDs []uuid.UUID) ([]*model.Embedding, error) {
	// Push to queue and return early (set status to syncing in DB)
	for _, id := range attachmentIDs {
		if err := s.attachmentRepo.UpdateEmbeddingStatus(ctx, id, "syncing"); err != nil {
			slog.Warn("Failed to update embedding status to syncing", "attachment_id", id, "error", err)
		}
	}

	task := embeddingTask{
		referenceID:   referenceID,
		userID:        userID,
		attachmentIDs: attachmentIDs,
	}

	select {
	case s.taskQueue <- task:
		slog.Info("Embedding task queued", "reference_id", referenceID)
		return nil, nil // Return nil, nil to indicate it was queued
	default:
		return nil, fmt.Errorf("embedding queue is full, please try again later")
	}
}

func (s *embeddingServiceImpl) processEmbeddings(ctx context.Context, referenceID, userID uuid.UUID, attachmentIDs []uuid.UUID) ([]*model.Embedding, error) {
	// 1. Query all attachments for this session
	attachments, err := s.attachmentRepo.FindByReferenceID(ctx, referenceID)
	if err != nil {
		return nil, fmt.Errorf("find attachments: %w", err)
	}

	if len(attachments) == 0 {
		return nil, fmt.Errorf("no attachments found for reference_id: %s", referenceID)
	}

	// 2. Filter by selected attachment IDs if provided
	if len(attachmentIDs) > 0 {
		idSet := make(map[uuid.UUID]struct{}, len(attachmentIDs))
		for _, id := range attachmentIDs {
			idSet[id] = struct{}{}
		}
		filtered := make([]*model.Attachment, 0, len(attachmentIDs))
		for _, a := range attachments {
			if _, ok := idSet[a.ID]; ok {
				filtered = append(filtered, a)
			}
		}
		attachments = filtered
		if len(attachments) == 0 {
			return nil, fmt.Errorf("none of the selected attachments belong to reference_id: %s", referenceID)
		}
	}

	// 2. Embed each attachment as chunks
	var results []*model.Embedding
	for _, attachment := range attachments {
		content, err := s.r2Service.Download(ctx, attachment.FileKey)
		if err != nil {
			return nil, fmt.Errorf("download from R2 (file_key=%s): %w", attachment.FileKey, err)
		}

		text := strings.TrimSpace(string(content))
		if utf8.RuneCountInString(text) < 20 {
			continue // skip empty or near-empty content
		}

		chunks := helper.ChunkText(text, helper.DefaultMaxChunkRunes, helper.DefaultOverlapRunes)
		if len(chunks) == 0 {
			continue
		}

		// Remove existing chunks for this attachment (handles re-embedding)
		if err := s.embeddingRepo.DeleteByAttachmentID(ctx, attachment.ID); err != nil {
			return nil, fmt.Errorf("delete old chunks (file_key=%s): %w", attachment.FileKey, err)
		}

		// Batch embedding: call API in groups of 16 chunks to reduce HTTP roundtrips
		const batchSize = 16
		var attachmentEmbeddings []*model.Embedding
		for i := 0; i < len(chunks); i += batchSize {
			end := i + batchSize
			if end > len(chunks) {
				end = len(chunks)
			}
			batch := chunks[i:end]
			vectors, totalTokens, err := s.embeddingAPIRepo.EmbedBatch(ctx, batch)
			if err != nil {
				return nil, fmt.Errorf("embedding API batch at chunk %d (file_key=%s): %w", i, attachment.FileKey, err)
			}

			for j, vector := range vectors {
				emb := &model.Embedding{
					ID:           uuid.New(),
					AttachmentID: attachment.ID,
					ChunkIndex:   i + j,
					ReferenceID:  referenceID,
					UserID:       userID,
					FileKey:      attachment.FileKey,
					Content:      batch[j],
					Vector:       pgvector.NewVector(vector),
					TokenCount:   totalTokens / len(batch), // Estimate per-chunk token count
					Model:        "qwen/qwen3-embedding-8b",
				}
				attachmentEmbeddings = append(attachmentEmbeddings, emb)
			}
		}

		// Batch save to database: one insert instead of N inserts
		if err := s.embeddingRepo.CreateBatch(ctx, attachmentEmbeddings); err != nil {
			return nil, fmt.Errorf("save batch (file_key=%s): %w", attachment.FileKey, err)
		}

		results = append(results, attachmentEmbeddings...)

		if err := s.attachmentRepo.MarkEmbedded(ctx, attachment.ID); err != nil {
			return nil, fmt.Errorf("mark embedded (file_key=%s): %w", attachment.FileKey, err)
		}
		if err := s.attachmentRepo.UpdateEmbeddingStatus(ctx, attachment.ID, "embedded"); err != nil {
			slog.Warn("Failed to update embedding status to embedded", "attachment_id", attachment.ID, "error", err)
		}
	}

	return results, nil
}

func (s *embeddingServiceImpl) GetByReferenceID(ctx context.Context, referenceID, userID uuid.UUID) ([]*model.Embedding, error) {
	return s.embeddingRepo.FindByReferenceIDAndUserID(ctx, referenceID, userID)
}

// SearchSimilar embeds queryText with retrieval.query task, finds top-K similar
// embeddings by referenceID, and returns their stored text content (truncated to 2000 chars each).
func (s *embeddingServiceImpl) SearchSimilar(ctx context.Context, referenceID uuid.UUID, queryText string, topK int) ([]string, error) {
	vector, _, err := s.embeddingAPIRepo.EmbedQuery(ctx, queryText)
	if err != nil {
		return nil, fmt.Errorf("embed query: %w", err)
	}

	results, err := s.embeddingRepo.SearchByVector(ctx, referenceID, pgvector.NewVector(vector), topK)
	if err != nil {
		return nil, fmt.Errorf("vector search: %w", err)
	}

	const maxChunkLen = 2000
	chunks := make([]string, 0, len(results))
	for _, emb := range results {
		if emb.Content == "" {
			continue
		}
		text := emb.Content
		if utf8.RuneCountInString(text) > maxChunkLen {
			// truncate at rune boundary
			runes := []rune(text)
			text = string(runes[:maxChunkLen])
		}
		chunks = append(chunks, text)
	}
	return chunks, nil
}
