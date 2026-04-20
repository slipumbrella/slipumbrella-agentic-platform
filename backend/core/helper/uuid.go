package helper

import (
	"fmt"

	"github.com/google/uuid"
)

func ToUUID(id string) (uuid.UUID, error) {
	ID, err := uuid.Parse(id)
	if err != nil {
		fmt.Println("Invalid UUID:", err)
		return uuid.Nil, fmt.Errorf("invalid UUID: %w", err)
	}
	return ID, nil
}
