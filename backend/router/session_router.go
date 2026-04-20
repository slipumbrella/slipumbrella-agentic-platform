package router

import (
	httpAdapter "capstone-prog/adapter/http"

	"github.com/gin-gonic/gin"
)

func SessionRouter(router *gin.RouterGroup, handler *httpAdapter.SessionHandler, authMiddleware gin.HandlerFunc) {
	group := router.Group("/sessions")
	group.Use(authMiddleware)

	// POST /api/sessions/:session_id/chat
	group.POST("/:session_id/chat", handler.SendMessage)
}
