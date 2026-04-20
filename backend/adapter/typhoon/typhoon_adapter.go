package typhoon

import (
	"bytes"
	"capstone-prog/core/repository"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/time/rate"
)

type TyphoonAdapter struct {
	apiKey  string
	limiter *rate.Limiter
}

func NewTyphoonAdapter(apiKey string) repository.OCRRepository {

	limit := rate.Every(time.Minute / 20)
	limiter := rate.NewLimiter(limit, 1)

	return &TyphoonAdapter{
		apiKey:  apiKey,
		limiter: limiter,
	}
}

type ocrParams struct {
	Model             string  `json:"model"`
	TaskType          string  `json:"task_type"`
	MaxTokens         int     `json:"max_tokens"`
	Temperature       float64 `json:"temperature"`
	TopP              float64 `json:"top_p"`
	RepetitionPenalty float64 `json:"repetition_penalty"`
}

func (a *TyphoonAdapter) ExtractText(ctx context.Context, file io.Reader, filename string, opts repository.OCROptions) (string, error) {
	// Wait for rate limiter permission (blocking queue)
	if err := a.limiter.Wait(ctx); err != nil {
		return "", fmt.Errorf("rate limiter error: %w", err)
	}

	params := ocrParams{
		Model:             "typhoon-ocr",
		TaskType:          "default",
		MaxTokens:         16384,
		Temperature:       0.1,
		TopP:              0.6,
		RepetitionPenalty: 1.2,
	}

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	// Use generic filename to avoid encoding issues with non-ASCII characters in headers
	part, err := writer.CreateFormFile("file", "document"+filepath.Ext(filename))
	if err != nil {
		return "", fmt.Errorf("create form file failed: %w", err)
	}

	_, err = io.Copy(part, file)
	if err != nil {
		return "", fmt.Errorf("copy file failed: %w", err)
	}

	writer.WriteField("model", params.Model)
	writer.WriteField("task_type", params.TaskType)
	writer.WriteField("max_tokens", strconv.Itoa(params.MaxTokens))
	writer.WriteField("temperature", strconv.FormatFloat(params.Temperature, 'f', -1, 64))
	writer.WriteField("top_p", strconv.FormatFloat(params.TopP, 'f', -1, 64))
	writer.WriteField("repetition_penalty", strconv.FormatFloat(params.RepetitionPenalty, 'f', -1, 64))

	// Only send pages if explicitly provided, matching the example
	if len(opts.Pages) > 0 {
		pagesJSON, err := json.Marshal(opts.Pages)
		if err == nil {
			writer.WriteField("pages", string(pagesJSON))
		}
	}

	writer.Close()

	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.opentyphoon.ai/v1/ocr", &buf)
	if err != nil {
		return "", fmt.Errorf("create request failed: %w", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+a.apiKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		slog.Error("typhoon OCR api error", "status", resp.StatusCode, "body", string(bodyBytes))
		return "", fmt.Errorf("api error: %d - %s", resp.StatusCode, string(bodyBytes))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read body failed: %w", err)
	}

	slog.Debug("typhoon OCR raw response", "body", string(body))

	// Parse response
	var result TyphoonOCRResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("unmarshal response failed: %w", err)
	}

	slog.Info("typhoon OCR parsed", "total_pages", result.TotalPages,
		"successful_pages", result.SuccessfulPages, "failed_pages", result.FailedPages,
		"results_count", len(result.Results))

	var textBuilder strings.Builder
	for i, res := range result.Results {
		slog.Debug("typhoon OCR result", "index", i, "filename", res.Filename, "success", res.Success)
		if !res.Success {
			continue
		}

		// Try standard choices format (OpenAI compatible)
		if len(res.Message.Choices) > 0 {
			for _, choice := range res.Message.Choices {
				textBuilder.WriteString(choice.Message.Content)
				textBuilder.WriteString("\n\n")
			}
		} else if res.Message.Content != "" {
			// Try direct content in message (some Typhoon versions)
			textBuilder.WriteString(res.Message.Content)
			textBuilder.WriteString("\n\n")
		} else if res.Content != "" {
			// Try direct content in result
			textBuilder.WriteString(res.Content)
			textBuilder.WriteString("\n\n")
		}
	}

	extracted := textBuilder.String()
	slog.Debug("typhoon OCR extracted text", "len", len(extracted))
	if extracted == "" {
		slog.Warn("typhoon OCR returned empty text — possible API structure change")
	}
	return extracted, nil
}

type TyphoonOCRResponse struct {
	TotalPages      int `json:"total_pages"`
	SuccessfulPages int `json:"successful_pages"`
	FailedPages     int `json:"failed_pages"`
	Results         []struct {
		Filename string `json:"filename"`
		Success  bool   `json:"success"`
		Content  string `json:"content"` // Fallback for direct content
		Message  struct {
			ID      string `json:"id"`
			Content string `json:"content"` // Fallback for direct content in message
			Choices []struct {
				Message struct {
					Content string `json:"content"`
					Role    string `json:"role"`
				} `json:"message"`
			} `json:"choices"`
		} `json:"message"`
	} `json:"results"`
}
