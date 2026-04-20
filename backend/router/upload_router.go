package router

import (
	adapter "capstone-prog/adapter/http"

	"github.com/gin-gonic/gin"
)

func UploadRouter(router *gin.RouterGroup, handler *adapter.UploadAdapter, authMiddleware gin.HandlerFunc) {
	uploadGroup := router.Group("/uploads")
	uploadGroup.Use(authMiddleware)

	uploadGroup.POST("/file", handler.UploadFile)
	uploadGroup.POST("/url", handler.UploadURL)
	uploadGroup.GET("", handler.ListResources)

	uploadGroup.GET("/:id/content", handler.GetContent)
	uploadGroup.DELETE("/:id", handler.DeleteResource)
	uploadGroup.POST("/delete-batch", handler.BatchDelete) // Use POST for batch delete (body support)
}
