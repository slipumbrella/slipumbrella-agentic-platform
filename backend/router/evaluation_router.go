package router

import (
	httpAdapter "capstone-prog/adapter/http"

	"github.com/gin-gonic/gin"
)

func EvaluationRouter(router *gin.RouterGroup, handler *httpAdapter.EvaluationHandler, authMiddleware gin.HandlerFunc) {
	group := router.Group("/evaluations")
	group.Use(authMiddleware)

	group.POST("", handler.TriggerEvaluation)              // POST /api/evaluations
	group.GET("", handler.GetEvaluation)                   // GET /api/evaluations?reference_id=xxx
	group.GET("/:id/stream", handler.StreamEvaluation)     // GET /api/evaluations/:reference_id/stream (SSE)
}
