package service

import (
	"context"
	"strings"
)

type requestIDContextKey string

const evaluationRequestIDKey requestIDContextKey = "evaluation_request_id"

func ContextWithRequestID(ctx context.Context, requestID string) context.Context {
	trimmed := strings.TrimSpace(requestID)
	if trimmed == "" {
		return ctx
	}
	return context.WithValue(ctx, evaluationRequestIDKey, trimmed)
}

func RequestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v, _ := ctx.Value(evaluationRequestIDKey).(string)
	return strings.TrimSpace(v)
}
