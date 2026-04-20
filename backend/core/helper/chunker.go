package helper

import (
	"strings"
	"unicode/utf8"
)

const (
	DefaultMaxChunkRunes = 1200
	DefaultOverlapRunes  = 120
)

// ChunkText splits text into overlapping chunks at paragraph boundaries.
// Each chunk is at most maxRunes runes. The last overlapRunes of the
// previous chunk are prepended to the next chunk for context continuity.
func ChunkText(text string, maxRunes, overlapRunes int) []string {
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) == 0 {
		return nil
	}

	// Split at paragraph boundaries (double newline)
	paragraphs := splitParagraphs(text)

	var chunks []string
	var current []rune
	var overlap []rune

	flush := func() {
		if len(current) == 0 {
			return
		}
		chunks = append(chunks, string(current))
		// carry last overlapRunes as prefix for next chunk
		if len(current) > overlapRunes {
			overlap = make([]rune, overlapRunes)
			copy(overlap, current[len(current)-overlapRunes:])
		} else {
			overlap = make([]rune, len(current))
			copy(overlap, current)
		}
		current = nil
	}

	for _, para := range paragraphs {
		runes := []rune(strings.TrimSpace(para))
		if len(runes) == 0 {
			continue
		}

		// If a single paragraph exceeds maxRunes, split it into sentences
		if len(runes) > maxRunes {
			for _, sentence := range splitSentences(string(runes), maxRunes) {
				sr := []rune(sentence)
				if len(current)+len(sr) > maxRunes {
					flush()
					current = append(overlap, sr...)
				} else {
					current = append(current, sr...)
				}
			}
			continue
		}

		if len(current)+len(runes)+1 > maxRunes {
			flush()
			current = append(overlap, runes...)
		} else {
			if len(current) > 0 {
				current = append(current, '\n')
			}
			current = append(current, runes...)
		}
	}
	flush()

	return chunks
}

// splitParagraphs splits on \n\n (normalises \r\n first).
func splitParagraphs(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	return strings.Split(text, "\n\n")
}

// splitSentences splits a long paragraph at sentence-ending punctuation,
// keeping each segment at most maxRunes runes.
func splitSentences(text string, maxRunes int) []string {
	sentenceEnds := map[rune]bool{'.': true, '?': true, '!': true, '。': true, '？': true, '！': true}
	runes := []rune(text)
	var segments []string
	start := 0

	for i, r := range runes {
		if sentenceEnds[r] && i-start >= maxRunes/2 {
			segments = append(segments, strings.TrimSpace(string(runes[start:i+1])))
			start = i + 1
		}
		if i-start >= maxRunes {
			segments = append(segments, strings.TrimSpace(string(runes[start:i+1])))
			start = i + 1
		}
	}
	if start < len(runes) {
		segments = append(segments, strings.TrimSpace(string(runes[start:])))
	}
	return segments
}
