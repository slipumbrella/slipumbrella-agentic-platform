package repository

import (
	"capstone-prog/core/model"
	"context"
)

type SessionSnapshotRepository interface {
	ListWorkflowTraces(ctx context.Context, sessionID string) ([]model.SessionSnapshot, error)
	GetWorkflowTrace(ctx context.Context, traceID string) (*model.SessionSnapshot, error)
}
