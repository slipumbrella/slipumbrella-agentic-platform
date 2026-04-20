package adapter

import (
	"capstone-prog/core/data/request"
	"capstone-prog/core/data/response"
	"capstone-prog/core/service"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"io"
)

type OpenRouterModelHandler struct {
	service service.OpenRouterModelService
}

func NewOpenRouterModelHandler(service service.OpenRouterModelService) *OpenRouterModelHandler {
	return &OpenRouterModelHandler{service: service}
}

func (h *OpenRouterModelHandler) List(c *gin.Context) {
	models, err := h.service.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch models"})
		return
	}

	c.JSON(http.StatusOK, response.NewListOpenRouterModelsResponse(models))
}

func (h *OpenRouterModelHandler) ListActive(c *gin.Context) {
	models, err := h.service.ListActive(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch models"})
		return
	}

	c.JSON(http.StatusOK, response.NewListOpenRouterModelsResponse(models))
}

func (h *OpenRouterModelHandler) Get(c *gin.Context) {
	item, err := h.service.Get(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		switch {
		case isOpenRouterModelValidationError(err):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "Model not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch model"})
		}
		return
	}

	c.JSON(http.StatusOK, response.NewGetOpenRouterModelResponse(item))
}

func (h *OpenRouterModelHandler) Create(c *gin.Context) {
	var req request.UpsertOpenRouterModelRequest
	if err := c.ShouldBind(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	var iconBytes []byte
	file, err := c.FormFile("icon_file")
	if err == nil && file != nil {
		f, err := file.Open()
		if err == nil {
			iconBytes, _ = io.ReadAll(f)
			f.Close()
		}
	}

	item, err := h.service.Create(c.Request.Context(), req, iconBytes)
	if err != nil {
		if isOpenRouterModelValidationError(err) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create model"})
		return
	}

	c.JSON(http.StatusCreated, response.NewGetOpenRouterModelResponse(item))
}

func (h *OpenRouterModelHandler) Update(c *gin.Context) {
	var req request.UpsertOpenRouterModelRequest
	if err := c.ShouldBind(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	var iconBytes []byte
	file, err := c.FormFile("icon_file")
	if err == nil && file != nil {
		f, err := file.Open()
		if err == nil {
			iconBytes, _ = io.ReadAll(f)
			f.Close()
		}
	}

	item, err := h.service.Update(c.Request.Context(), c.Param("uuid"), req, iconBytes)
	if err != nil {
		switch {
		case isOpenRouterModelValidationError(err):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "Model not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update model"})
		}
		return
	}

	c.JSON(http.StatusOK, response.NewGetOpenRouterModelResponse(item))
}

func (h *OpenRouterModelHandler) Delete(c *gin.Context) {
	err := h.service.Delete(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		switch {
		case isOpenRouterModelValidationError(err):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "Model not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete model"})
		}
		return
	}

	c.Status(http.StatusNoContent)
}

func isOpenRouterModelValidationError(err error) bool {
	return errors.Is(err, service.ErrOpenRouterModelIDRequired) ||
		errors.Is(err, service.ErrOpenRouterModelNameRequired) ||
		errors.Is(err, service.ErrOpenRouterModelTagsRequired) ||
		errors.Is(err, service.ErrOpenRouterModelTagsBlank) ||
		errors.Is(err, service.ErrOpenRouterModelUUIDRequired)
}
