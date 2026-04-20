package router

import (
	adapter "capstone-prog/adapter/http"

	"github.com/gin-gonic/gin"
)

func BuilderRouter(router *gin.RouterGroup, handler *adapter.BuilderHandler, wsBuilderHandler *adapter.WSBuilderHandler, wsExecutionHandler *adapter.WSExecutionHandler, authMiddleware gin.HandlerFunc) {
	builderGroup := router.Group("/builder")
	builderGroup.Use(authMiddleware)

	builderGroup.POST("/chat", handler.Chat)
	builderGroup.POST("/sessions", handler.CreateSession)
	builderGroup.POST("/execute", handler.ExecutePlan)
	builderGroup.GET("/agents", handler.GetAgents)
	builderGroup.GET("/config", handler.GetConfig)
	builderGroup.GET("/sessions", handler.ListSessions)
	builderGroup.GET("/planning-sessions", handler.ListPlanningSessions)
	builderGroup.GET("/planning-sessions/:id/plan", handler.GetPlanningSessionPlan)
	builderGroup.GET("/sessions/:id/model-assignments", handler.GetModelAssignments)
	builderGroup.GET("/sessions/:id/messages", handler.GetMessages)
	builderGroup.PUT("/sessions/:id/model-assignments", handler.SaveModelAssignments)
	builderGroup.POST("/sessions/:id/model-assignments/confirm", handler.ConfirmModelAssignments)
	builderGroup.GET("/sessions/:id/workflow-traces", handler.ListWorkflowTraces)
	builderGroup.GET("/workflow-traces/:id", handler.GetWorkflowTrace)
	builderGroup.GET("/teams/:id/artifacts", handler.GetArtifacts)
	builderGroup.GET("/artifacts/:id/download", handler.DownloadArtifact)

	// WebSocket endpoints require the same authenticated session context as REST.
	wsGroup := router.Group("/ws")
	wsGroup.Use(authMiddleware)
	wsGroup.GET("/builder", wsBuilderHandler.HandleBuilderWS)
	wsGroup.GET("/execution", wsExecutionHandler.HandleExecutionWS)
}
