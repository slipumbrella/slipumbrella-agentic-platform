package router

import (
	adapter "capstone-prog/adapter/http"

	"github.com/gin-gonic/gin"
)

func AuthRouter(router *gin.RouterGroup, handler *adapter.AuthHandler, authMiddleware gin.HandlerFunc, rateLimiter *adapter.UserRateLimiter) {
	authGroup := router.Group("/auth")
	authGroup.Use(adapter.UserRateLimitMiddleware(rateLimiter))
	{
		// authGroup.POST("/signup", handler.Signup) // Restricted to Admin Only via /api/users
		authGroup.POST("/login", handler.Login)
		authGroup.POST("/refresh", handler.RefreshToken)
		authGroup.POST("/logout", handler.Logout)
	}

	protected := router.Group("/auth")
	protected.Use(authMiddleware)
	{
		// TODO: Add protected auth routes here
		protected.GET("/me", handler.Me)
	}
}
