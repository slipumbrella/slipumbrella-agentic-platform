package adapter_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"

	httpAdapter "capstone-prog/adapter/http"
	"capstone-prog/core/service"
)

// fakeBuilderService embeds the interface so only SendMessage needs implementing.
type fakeBuilderService struct {
	service.BuilderService
	sendMessageFn func(ctx context.Context, sessionID, message string, userID uuid.UUID) (string, error)
}

func (f *fakeBuilderService) SendMessage(ctx context.Context, sessionID, message string, userID uuid.UUID) (string, error) {
	return f.sendMessageFn(ctx, sessionID, message, userID)
}

func TestSessionHandler_SendMessage_OK(t *testing.T) {
	gin.SetMode(gin.TestMode)

	svc := &fakeBuilderService{
		sendMessageFn: func(_ context.Context, sessionID, message string, _ uuid.UUID) (string, error) {
			assert.Equal(t, "session-abc", sessionID)
			assert.Equal(t, "hello", message)
			return "Answer: A", nil
		},
	}

	handler := httpAdapter.NewSessionHandler(svc)
	r := gin.New()
	r.POST("/sessions/:session_id/chat", func(c *gin.Context) {
		c.Set("user_id", uuid.New())
	}, handler.SendMessage)

	body, _ := json.Marshal(map[string]string{"message": "hello"})
	req := httptest.NewRequest(http.MethodPost, "/sessions/session-abc/chat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "Answer: A", resp["response"])
	assert.Equal(t, "session-abc", resp["session_id"])
}

func TestSessionHandler_SendMessage_MissingMessage(t *testing.T) {
	gin.SetMode(gin.TestMode)

	svc := &fakeBuilderService{
		sendMessageFn: func(_ context.Context, _, _ string, _ uuid.UUID) (string, error) {
			t.Fatal("service should not be called")
			return "", nil
		},
	}

	handler := httpAdapter.NewSessionHandler(svc)
	r := gin.New()
	r.POST("/sessions/:session_id/chat", func(c *gin.Context) {
		c.Set("user_id", uuid.New())
	}, handler.SendMessage)

	body, _ := json.Marshal(map[string]string{}) // no "message"
	req := httptest.NewRequest(http.MethodPost, "/sessions/session-abc/chat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSessionHandler_SendMessage_NotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)

	svc := &fakeBuilderService{
		sendMessageFn: func(_ context.Context, _, _ string, _ uuid.UUID) (string, error) {
			return "", service.ErrNotFound
		},
	}

	handler := httpAdapter.NewSessionHandler(svc)
	r := gin.New()
	r.POST("/sessions/:session_id/chat", func(c *gin.Context) {
		c.Set("user_id", uuid.New())
	}, handler.SendMessage)

	body, _ := json.Marshal(map[string]string{"message": "hello"})
	req := httptest.NewRequest(http.MethodPost, "/sessions/session-abc/chat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestSessionHandler_SendMessage_Forbidden(t *testing.T) {
	gin.SetMode(gin.TestMode)

	svc := &fakeBuilderService{
		sendMessageFn: func(_ context.Context, _, _ string, _ uuid.UUID) (string, error) {
			return "", service.ErrForbidden
		},
	}

	handler := httpAdapter.NewSessionHandler(svc)
	r := gin.New()
	r.POST("/sessions/:session_id/chat", func(c *gin.Context) {
		c.Set("user_id", uuid.New())
	}, handler.SendMessage)

	body, _ := json.Marshal(map[string]string{"message": "hello"})
	req := httptest.NewRequest(http.MethodPost, "/sessions/session-abc/chat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestSessionHandler_SendMessage_InternalError(t *testing.T) {
	gin.SetMode(gin.TestMode)

	svc := &fakeBuilderService{
		sendMessageFn: func(_ context.Context, _, _ string, _ uuid.UUID) (string, error) {
			return "", errors.New("stream recv: rpc error")
		},
	}

	handler := httpAdapter.NewSessionHandler(svc)
	r := gin.New()
	r.POST("/sessions/:session_id/chat", func(c *gin.Context) {
		c.Set("user_id", uuid.New())
	}, handler.SendMessage)

	body, _ := json.Marshal(map[string]string{"message": "hello"})
	req := httptest.NewRequest(http.MethodPost, "/sessions/session-abc/chat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
