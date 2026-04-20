package router

import (
	httpAdapter "capstone-prog/adapter/http"

	"github.com/gin-gonic/gin"
)

func EmbeddingRouter(router *gin.RouterGroup, handler *httpAdapter.EmbeddingHandler, authMiddleware gin.HandlerFunc) {
	group := router.Group("/embeddings")
	group.Use(authMiddleware)

	group.POST("", handler.CreateEmbedding) // POST /api/embeddings
	group.GET("", handler.GetEmbedding)     // GET /api/embeddings?file_key=xxx
}
