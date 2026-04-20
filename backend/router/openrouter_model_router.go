package router

import (
	adapter "capstone-prog/adapter/http"

	"github.com/gin-gonic/gin"
)

func OpenRouterModelRouter(router *gin.RouterGroup, handler *adapter.OpenRouterModelHandler) {
	router.GET("", handler.List)
	router.GET("/:uuid", handler.Get)
	router.POST("", handler.Create)
	router.PUT("/:uuid", handler.Update)
	router.DELETE("/:uuid", handler.Delete)
}
