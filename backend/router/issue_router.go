package router

import (
	httpAdapter "capstone-prog/adapter/http"

	"github.com/gin-gonic/gin"
)

func IssueRouter(api *gin.RouterGroup, handler *httpAdapter.IssueHandler, authMiddleware, adminMiddleware gin.HandlerFunc) {
	issueGroup := api.Group("/issues")
	issueGroup.Use(authMiddleware)

	// Users can create issues
	issueGroup.POST("", handler.CreateIssue)

	// Admin only routes
	adminGroup := issueGroup.Group("/admin")
	adminGroup.Use(adminMiddleware)
	adminGroup.GET("", handler.GetAllIssues)
	adminGroup.PATCH("/:id/status", handler.UpdateIssueStatus)
}
