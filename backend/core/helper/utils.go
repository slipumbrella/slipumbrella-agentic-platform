package helper

import (
	"strings"
)

func SanitizeFilename(name string) string {
	return strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, name)
}

func GetContentType(mimeType string) string {
	if strings.Contains(mimeType, "pdf") {
		return "PDF"
	}
	if strings.Contains(mimeType, "image") {
		return "IMAGE"
	}
	if strings.Contains(mimeType, "video") {
		return "VIDEO"
	}
	if strings.Contains(mimeType, "audio") {
		return "AUDIO"
	}
	return "TEXT"
}
