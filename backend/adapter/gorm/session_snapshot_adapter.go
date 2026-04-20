package gorm

import (
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"
	"errors"

	"gorm.io/gorm"
)

type SessionSnapshotRepository struct {
	db *gorm.DB
}

func NewSessionSnapshotRepository(db *gorm.DB) repository.SessionSnapshotRepository {
	return &SessionSnapshotRepository{db: db}
}

func (r *SessionSnapshotRepository) ListWorkflowTraces(ctx context.Context, sessionID string) ([]model.SessionSnapshot, error) {
	var snapshots []model.SessionSnapshot
	err := r.db.WithContext(ctx).
		Where("session_id = ? AND snapshot_type LIKE ?", sessionID, "workflow_trace:%").
		Order("updated_at DESC").
		Find(&snapshots).Error
	return snapshots, err
}

func (r *SessionSnapshotRepository) GetWorkflowTrace(ctx context.Context, traceID string) (*model.SessionSnapshot, error) {
	var snapshot model.SessionSnapshot
	err := r.db.WithContext(ctx).
		Where("snapshot_type LIKE ?", "workflow_trace:%").
		Where("(snapshot_type = ? OR data ->> 'trace_id' = ? OR id::text = ?)", "workflow_trace:"+traceID, traceID, traceID).
		Order("updated_at DESC").
		First(&snapshot).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &snapshot, nil
}
