package router

import (
	adapter "capstone-prog/adapter/http"

	"github.com/gin-gonic/gin"
)

func StatsRouter(router *gin.RouterGroup, handler *adapter.StatsHandler, authMiddleware gin.HandlerFunc) {
	statsGroup := router.Group("/stats")
	statsGroup.Use(authMiddleware)
	statsGroup.GET("/token-usage", handler.GetTokenUsage)
}
