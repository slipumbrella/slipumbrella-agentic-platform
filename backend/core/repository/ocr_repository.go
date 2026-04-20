package repository

import (
	"context"
	"io"
)

type OCROptions struct {
	Pages []int // specific page numbers, e.g. [1, 2, 3, 4]
}

type OCRRepository interface {
	ExtractText(ctx context.Context, file io.Reader, filename string, opts OCROptions) (string, error)
}
