package helper_test

import (
	"strings"
	"testing"
	"unicode/utf8"

	"capstone-prog/core/helper"
)

func TestChunkText_Empty(t *testing.T) {
	if got := helper.ChunkText("", 400, 50); got != nil {
		t.Errorf("expected nil for empty input, got %v", got)
	}
}

func TestChunkText_WhitespaceOnly(t *testing.T) {
	if got := helper.ChunkText("   \n\n  ", 400, 50); got != nil {
		t.Errorf("expected nil for whitespace-only input, got %v", got)
	}
}

func TestChunkText_ShortText(t *testing.T) {
	chunks := helper.ChunkText("Hello world", 400, 50)
	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0] != "Hello world" {
		t.Errorf("unexpected chunk: %q", chunks[0])
	}
}

func TestChunkText_RespectMaxRunes(t *testing.T) {
	para := "สวัสดีครับ นี่คือข้อความทดสอบสำหรับระบบ RAG "
	var sb strings.Builder
	for range 20 {
		sb.WriteString(para)
		sb.WriteString("\n\n")
	}
	text := sb.String()

	chunks := helper.ChunkText(text, 400, 50)
	if len(chunks) == 0 {
		t.Fatal("expected at least one chunk")
	}
	for i, c := range chunks {
		n := utf8.RuneCountInString(c)
		if n > 450 {
			t.Errorf("chunk %d exceeds max runes: %d", i, n)
		}
	}
}

func TestChunkText_OverlapCarried(t *testing.T) {
	first := strings.Repeat("x", 300)
	second := strings.Repeat("y", 300)
	chunks := helper.ChunkText(first+"\n\n"+second, 400, 50)
	if len(chunks) < 2 {
		t.Fatalf("expected at least 2 chunks, got %d", len(chunks))
	}
	// second chunk must begin with the last 50 runes of the first chunk (the overlap)
	overlap := first[len(first)-50:]
	if !strings.HasPrefix(chunks[1], overlap) {
		t.Errorf("second chunk does not start with overlap\ngot prefix: %q\nwant: %q", chunks[1][:50], overlap)
	}
}

func TestChunkText_SingleLongParagraph(t *testing.T) {
	long := strings.Repeat("a", 900)
	chunks := helper.ChunkText(long, 400, 50)
	if len(chunks) < 2 {
		t.Fatalf("expected multiple chunks for long paragraph, got %d", len(chunks))
	}
}
