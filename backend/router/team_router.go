package router

import (
	adapter "capstone-prog/adapter/http"

	"github.com/gin-gonic/gin"
)

func TeamRouter(router *gin.RouterGroup, handler *adapter.TeamHandler, lineHandler *adapter.LineHandler, authMiddleware gin.HandlerFunc) {
	teamGroup := router.Group("/teams")
	teamGroup.Use(authMiddleware)

	teamGroup.POST("", handler.CreateTeam)
	teamGroup.GET("", handler.ListTeams)
	teamGroup.GET("/:id", handler.GetTeam)
	teamGroup.PUT("/:id", handler.UpdateTeam)
	teamGroup.DELETE("/:id", handler.DeleteTeam)
	teamGroup.POST("/:id/sessions", handler.AssignSession)
	teamGroup.DELETE("/:id/sessions/:session_id", handler.UnassignSession)

	teamGroup.PUT("/:id/line", lineHandler.SaveConfig)
	teamGroup.GET("/:id/line", lineHandler.GetConfig)
	teamGroup.DELETE("/:id/line", lineHandler.DeleteConfig)
	teamGroup.GET("/:id/line/messages", lineHandler.ListMessages)
}
