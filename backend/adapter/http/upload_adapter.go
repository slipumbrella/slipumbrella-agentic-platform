package adapter

import (
	"capstone-prog/core/data/request"
	"capstone-prog/core/service"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type UploadAdapter struct {
	uploadService service.UploadService
}

func NewUploadAdapter(uploadService service.UploadService) *UploadAdapter {
	return &UploadAdapter{uploadService: uploadService}
}

// UploadFile handles file uploads
func (a *UploadAdapter) UploadFile(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxUploadSize+1024)
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userID := userIDVal.(uuid.UUID)

	var req request.UploadRequest
	if err := c.ShouldBind(&req); err != nil {
		slog.Warn("UploadFile: invalid request", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		slog.Warn("UploadFile: missing file field", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}

	// Parse optional pages field
	var pages []int
	if req.Pages != "" {
		if err := json.Unmarshal([]byte(req.Pages), &pages); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid pages format: expected JSON like [1, 2, 3]"})
			return
		}
	}

	attachment, err := a.uploadService.UploadFile(c.Request.Context(), file, req.ReferenceID, pages, userID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
			return
		case errors.Is(err, service.ErrForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		errMsg := err.Error()
		if strings.HasPrefix(errMsg, "file too large") || strings.HasPrefix(errMsg, "file type not allowed") {
			c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
			return
		}
		slog.Error("UploadFile: service error", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusInternalServerError, gin.H{"error": "File upload failed"})
		return
	}

	c.JSON(http.StatusOK, attachment)
}

// UploadURL handles URL scraping
func (a *UploadAdapter) UploadURL(c *gin.Context) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userID := userIDVal.(uuid.UUID)
	var req request.UploadURLRequest
	if err := c.ShouldBind(&req); err != nil {
		slog.Warn("UploadURL: invalid request", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	maxPages := req.MaxPages
	if maxPages <= 0 {
		maxPages = 50
	}

	opts := service.UploadURLOptions{
		EnableBFS: req.CrawlBFS,
		MaxPages:  maxPages,
	}

	outboundAuthHeader := strings.TrimSpace(c.GetHeader("Authorization"))
	if outboundAuthHeader == "" {
		if token, err := c.Cookie("token"); err == nil && token != "" {
			outboundAuthHeader = "Bearer " + token
		}
	}
	ctx := service.WithOutboundAuthorizationHeader(c.Request.Context(), outboundAuthHeader)
	attachments, err := a.uploadService.UploadURL(ctx, req.URL, req.ReferenceID, opts, userID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
			return
		case errors.Is(err, service.ErrForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		if strings.HasPrefix(err.Error(), "invalid or disallowed URL") {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		slog.Error("UploadURL: service error", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusInternalServerError, gin.H{"error": "URL upload failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"attachments": attachments})
}

func (a *UploadAdapter) ListResources(c *gin.Context) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userID := userIDVal.(uuid.UUID)
	var req request.ListFileRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		slog.Warn("ListResources: invalid query", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	refID, err := uuid.Parse(req.ReferenceID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	attachments, err := a.uploadService.ListFiles(c.Request.Context(), refID, userID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
			return
		case errors.Is(err, service.ErrForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		slog.Error("ListResources: service error", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list files"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"attachments": attachments})
}

func (a *UploadAdapter) GetContent(c *gin.Context) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	userID := userIDVal.(uuid.UUID)
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	content, err := a.uploadService.GetFileContent(c.Request.Context(), id, userID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
			return
		case errors.Is(err, service.ErrForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		slog.Error("GetContent: service error", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get file content"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"content": content})
}

func (a *UploadAdapter) DeleteResource(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	err = a.uploadService.DeleteFile(c.Request.Context(), id, userID.(uuid.UUID))
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
			return
		case errors.Is(err, service.ErrForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		slog.Error("DeleteResource: service error", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete file"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (a *UploadAdapter) BatchDelete(c *gin.Context) {
	var req struct {
		IDs []uuid.UUID `json:"ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	if err := a.uploadService.DeleteFilesBatch(c.Request.Context(), req.IDs, userID.(uuid.UUID)); err != nil {
		switch {
		case errors.Is(err, service.ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
			return
		case errors.Is(err, service.ErrForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		slog.Error("BatchDelete: service error", "error", err, "ip", c.ClientIP())
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Batch delete failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "batch deleted"})
}
