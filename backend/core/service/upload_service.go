package service

import (
	"bytes"
	"capstone-prog/core/helper"
	"capstone-prog/core/model"
	"capstone-prog/core/repository"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"log/slog"

	"encoding/json"

	md "github.com/JohannesKaufmann/html-to-markdown"
	"github.com/PuerkitoBio/goquery"
	"github.com/gabriel-vasile/mimetype"
	"github.com/gocolly/colly/v2"
	"github.com/google/uuid"
	"github.com/ledongthuc/pdf"
	pdfapi "github.com/pdfcpu/pdfcpu/pkg/api"
)

var mdImageRegex = regexp.MustCompile(`!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)`)

// noiseSelector strips navigation chrome, sidebars, and non-content boilerplate.
// Targets both semantic HTML5 elements and common CSS class patterns.
const noiseSelector = "script, style, meta, link, noscript, iframe, svg, " +
	"nav, header, footer, aside, " +
	"[role=navigation], [role=banner], [role=complementary], [role=contentinfo], " +
	".navbar, .nav-bar, .site-nav, .main-nav, .top-nav, .side-nav, " +
	".menu, .sidebar, .side-bar, .breadcrumb, .breadcrumbs, .cookie-banner, " +
	".kingster-top-bar, .kingster-mobile-header, .kingster-header-wrap, .kingster-header-container, " +
	".kingster-navigation, .kingster-page-title-wrap, .kingster-logo, .kingster-top-search-wrap, " +
	".gdlr-core-pbf-background-wrap, .kingster-header-background, [aria-hidden=true], .topmenu_holder, .mmenu_holder, .horiznav "

const maxResponseLogChars = 800
type outboundAuthorizationHeaderContextKey struct{}

func WithOutboundAuthorizationHeader(ctx context.Context, header string) context.Context {
	h := strings.TrimSpace(header)
	if h == "" {
		return ctx
	}
	return context.WithValue(ctx, outboundAuthorizationHeaderContextKey{}, h)
}

func outboundAuthorizationHeaderFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	val := ctx.Value(outboundAuthorizationHeaderContextKey{})
	h, ok := val.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(h)
}

func sanitizeHeaderValueForLog(name, value string) string {
	if value == "" {
		return ""
	}
	lower := strings.ToLower(name)
	if lower == "authorization" || lower == "cookie" || lower == "set-cookie" {
		return "[REDACTED]"
	}
	if len(value) > 200 {
		return value[:200] + "...(truncated)"
	}
	return value
}

func filteredHeadersForLog(headers http.Header) map[string]string {
	out := make(map[string]string)
	if headers == nil {
		return out
	}
	keys := []string{"User-Agent", "Referer", "Origin", "Accept", "Authorization", "Cookie"}
	for _, key := range keys {
		if val := headers.Get(key); val != "" {
			out[strings.ToLower(key)] = sanitizeHeaderValueForLog(key, val)
		}
	}
	return out
}

func collyRequestHeadersForLog(r *colly.Request) map[string]string {
	if r == nil || r.Headers == nil {
		return map[string]string{}
	}
	return filteredHeadersForLog(*r.Headers)
}

func responseSnippet(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	snippet := string(body)
	snippet = strings.Join(strings.Fields(snippet), " ")
	if len(snippet) > maxResponseLogChars {
		return snippet[:maxResponseLogChars] + "...(truncated)"
	}
	return snippet
}

func resolveImageURL(pageURL, rawImageURL string) (string, error) {
	raw := strings.TrimSpace(strings.Trim(rawImageURL, "<>"))
	if raw == "" {
		return "", fmt.Errorf("empty image URL")
	}

	base, err := url.Parse(pageURL)
	if err != nil {
		return "", err
	}

	if strings.HasPrefix(raw, "//") {
		scheme := base.Scheme
		if scheme == "" {
			scheme = "https"
		}
		return scheme + ":" + raw, nil
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if parsed.IsAbs() {
		return parsed.String(), nil
	}
	return base.ResolveReference(parsed).String(), nil
}

func imageFetchProfiles(primary helper.UserAgentProfile) []helper.UserAgentProfile {
	rotated := helper.RandomizedUserAgentProfiles()
	profiles := make([]helper.UserAgentProfile, 0, len(rotated)+1)
	seen := make(map[string]bool)

	add := func(p helper.UserAgentProfile) {
		key := p.Name + "|" + p.Value
		if seen[key] {
			return
		}
		seen[key] = true
		profiles = append(profiles, p)
	}

	// Try the page-success profile first, then rotate through the pool.
	if primary.Name != "" || primary.Value != "" {
		add(primary)
	}
	for _, p := range rotated {
		add(p)
	}
	return profiles
}

func collectorForUserAgentProfile(profile helper.UserAgentProfile, authHeader string, opts ...colly.CollectorOption) *colly.Collector {
	collectorOpts := make([]colly.CollectorOption, 0, len(opts)+1)
	collectorOpts = append(collectorOpts, opts...)
	if profile.Value != "" {
		collectorOpts = append(collectorOpts, colly.UserAgent(profile.Value))
	}
	c := colly.NewCollector(collectorOpts...)
	c.OnRequest(func(r *colly.Request) {
		if profile.Value == "" {
			r.Headers.Set("User-Agent", "")
		}
		if authHeader != "" {
			r.Headers.Set("Authorization", authHeader)
		}
	})
	return c
}

// extractContent finds the primary content of a page.
// Prefers <main> or <article> over full <body>, then strips navigation noise.
func extractContent(s *goquery.Selection) string {
	// Clone content to avoid modifying the original DOM which other callbacks (like BFS link extraction) may need.
	htmlStr, err := s.Html()
	if err != nil {
		return s.Text()
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(htmlStr))
	if err != nil {
		return s.Text()
	}

	root := doc.Selection
	if main := root.Find("main"); main.Length() > 0 {
		root = main
	} else if article := root.Find("article"); article.Length() > 0 {
		root = article.First()
	}

	root.Find(noiseSelector).Remove()

	html, err := root.Html()
	if err != nil {
		return root.Text()
	}

	converter := md.NewConverter("", true, nil)
	markdown, err := converter.ConvertString(html)
	if err != nil {
		return root.Text()
	}
	return markdown
}

type UploadURLOptions struct {
	EnableBFS bool
	MaxPages  int // 0 = use default (50); capped at 100
}

type UploadService interface {
	UploadFile(ctx context.Context, file *multipart.FileHeader, referenceID string, pages []int, userID uuid.UUID) (*model.Attachment, error)
	UploadURL(ctx context.Context, url string, referenceID string, opts UploadURLOptions, userID uuid.UUID) ([]*model.Attachment, error)

	ListFiles(ctx context.Context, referenceID, userID uuid.UUID) ([]*model.Attachment, error)
	DeleteFile(ctx context.Context, id, userID uuid.UUID) error
	DeleteFilesBatch(ctx context.Context, ids []uuid.UUID, userID uuid.UUID) error
	GetFileContent(ctx context.Context, id, userID uuid.UUID) (string, error)
}

type uploadServiceImpl struct {
	attachmentRepo    repository.AttachmentRepository
	embeddingRepo     repository.EmbeddingRepository
	evaluationService EvaluationService
	ocrRepo           repository.OCRRepository
	r2Service         R2Service
	bucketName        string
	chatRepo          repository.ChatRepository
	teamRepo          repository.TeamRepository
	sessionRepo       repository.AgentSessionRepository
	urlValidator      func(string) error // defaults to validateURLForSSRF; overridable in tests
}

const MaxUploadSize = 20 * 1024 * 1024     // 20 MB
const typhoonMaxFileSize = 4 * 1024 * 1024 // 4 MB safe threshold (Typhoon limit is 4.5 MB)

var allowedMIMETypes = map[string]bool{
	"application/pdf": true,
	"image/jpeg":      true,
	"image/png":       true,
	"image/gif":       true,
	"image/webp":      true,
	"text/plain":      true,
	"text/csv":        true,
	"text/markdown":   true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
	"application/msword": true,
}

func NewUploadService(
	attachmentRepo repository.AttachmentRepository,
	embeddingRepo repository.EmbeddingRepository,
	evaluationService EvaluationService,
	ocrRepo repository.OCRRepository,
	r2Service R2Service,
	bucketName string,
	chatRepo repository.ChatRepository,
	teamRepo repository.TeamRepository,
	sessionRepo repository.AgentSessionRepository,
) UploadService {
	return &uploadServiceImpl{
		attachmentRepo:    attachmentRepo,
		embeddingRepo:     embeddingRepo,
		evaluationService: evaluationService,
		ocrRepo:           ocrRepo,
		r2Service:         r2Service,
		bucketName:        bucketName,
		chatRepo:          chatRepo,
		teamRepo:          teamRepo,
		sessionRepo:       sessionRepo,
		urlValidator:      validateURLForSSRF,
	}
}

func (s *uploadServiceImpl) UploadFile(ctx context.Context, file *multipart.FileHeader, referenceID string, pages []int, userID uuid.UUID) (*model.Attachment, error) {
	refUUID, err := uuid.Parse(referenceID)
	if err != nil {
		return nil, err
	}
	if err := s.authorizeReferenceOwnership(ctx, refUUID, userID); err != nil {
		return nil, err
	}

	// Validate file size
	if file.Size > MaxUploadSize {
		return nil, fmt.Errorf("file too large: max %dMB", MaxUploadSize/(1024*1024))
	}

	// Validate MIME type via magic-byte detection (not client-supplied header)
	src, err := file.Open()
	if err != nil {
		return nil, err
	}
	detected, err := mimetype.DetectReader(src)
	src.Close()
	if err != nil {
		return nil, fmt.Errorf("cannot detect file type: %w", err)
	}
	detectedMIME := detected.String()
	if idx := strings.Index(detectedMIME, ";"); idx != -1 {
		detectedMIME = strings.TrimSpace(detectedMIME[:idx])
	}
	if !allowedMIMETypes[detectedMIME] {
		slog.Warn("UploadFile: blocked MIME type", "mime", detectedMIME, "filename", file.Filename)
		return nil, fmt.Errorf("file type not allowed: %s", detectedMIME)
	}
	contentType := detectedMIME

	fileID := uuid.New().String()
	isOCR := strings.Contains(contentType, "pdf") || strings.Contains(contentType, "image")

	var contentToUpload interface{}
	var uploadContentType string
	var finalFileName string
	var fileKey string
	var finalSize int64

	if isOCR {
		src, err := file.Open()
		if err != nil {
			return nil, err
		}
		defer src.Close()

		tempFile, err := os.CreateTemp("", "upload-*"+filepath.Ext(file.Filename))
		if err != nil {
			return nil, fmt.Errorf("failed to create temp file: %w", err)
		}
		defer os.Remove(tempFile.Name()) // Clean up temp file
		if _, err := io.Copy(tempFile, src); err != nil {
			return nil, fmt.Errorf("write temp file: %w", err)
		}
		tempFile.Close()

		// If no pages provided, count them from the PDF to ensure Typhoon OCR reads all pages
		finalPages := pages
		if len(finalPages) == 0 && contentType == "application/pdf" {
			f, r, err := pdf.Open(tempFile.Name())
			if err == nil {
				numPages := r.NumPage()
				for i := 1; i <= numPages; i++ {
					finalPages = append(finalPages, i)
				}
				f.Close()
			}
		}

		// Run OCR
		ocrText, err := s.processOCR(ctx, tempFile.Name(), contentType, repository.OCROptions{Pages: finalPages})
		slog.Info("OCR process completed", "filename", file.Filename, "contentType", contentType, "isOCR", isOCR, "ocrTextLength", len(ocrText), "error", err)
		if err != nil {
			slog.Warn("OCR failed, falling back to original file upload", "error", err)
			isOCR = false // Fallback
		} else if strings.TrimSpace(ocrText) == "" {
			slog.Warn("OCR returned empty text, falling back to original file upload", "filename", file.Filename)
			isOCR = false // Fallback — don't store empty markdown in R2
		} else {
			// OCR Success
			contentToUpload = ocrText
			uploadContentType = "text/markdown"
			finalFileName = fmt.Sprintf("%s-%s.md", helper.SanitizeFilename(file.Filename), fileID)
			fileKey = fmt.Sprintf("%s/%s", referenceID, finalFileName)
			finalSize = int64(len(ocrText))
		}
	}

	if !isOCR {
		// Normal upload or fallback
		src, err := file.Open()
		if err != nil {
			return nil, err
		}
		defer src.Close()

		contentToUpload = src
		uploadContentType = contentType
		finalFileName = file.Filename
		fileKey = fmt.Sprintf("%s/%s-%s", referenceID, fileID, file.Filename)
		finalSize = file.Size
	}

	// Upload to R2
	if strContent, ok := contentToUpload.(string); ok {
		err := s.r2Service.UploadString(ctx, fileKey, strContent, uploadContentType)
		if err != nil {
			return nil, err
		}
	} else {

		src, err := file.Open()
		if err != nil {
			return nil, err
		}
		defer src.Close()
		err = s.r2Service.Upload(ctx, fileKey, src, uploadContentType)
		if err != nil {
			return nil, err
		}
	}

	attachment := &model.Attachment{
		ReferenceID:      refUUID,
		FileName:         finalFileName,
		FileSize:         finalSize,
		Bucket:           s.bucketName,
		FileKey:          fileKey,
		OriginalFileName: file.Filename,
	}

	err = s.attachmentRepo.Create(ctx, attachment)
	if err != nil {
		return nil, err
	}

	return attachment, nil
}

func (s *uploadServiceImpl) UploadURL(ctx context.Context, rawURL string, referenceID string, opts UploadURLOptions, userID uuid.UUID) ([]*model.Attachment, error) {
	refUUID, err := uuid.Parse(referenceID)
	if err != nil {
		return nil, err
	}
	if err := s.authorizeReferenceOwnership(ctx, refUUID, userID); err != nil {
		return nil, err
	}

	if err := s.urlValidator(rawURL); err != nil {
		slog.Warn("UploadURL: SSRF check failed", "url", rawURL, "error", err)
		return nil, fmt.Errorf("invalid or disallowed URL: %w", err)
	}

	if !opts.EnableBFS {
	attachment, err := s.scrapeSinglePage(ctx, rawURL, referenceID)
	if err != nil {
		return nil, fmt.Errorf("scraping failed after retries: %w", err)
	}
	return []*model.Attachment{attachment}, nil
	}

	// BFS crawl
	maxPages := opts.MaxPages
	if maxPages <= 0 {
		maxPages = 20
	}
	if maxPages > 20 {
		maxPages = 20
	}
	return s.crawlSite(ctx, rawURL, referenceID, maxPages)
}

func (s *uploadServiceImpl) scrapeSinglePage(ctx context.Context, rawURL string, referenceID string) (*model.Attachment, error) {
	profiles := helper.RandomizedUserAgentProfiles()
	authHeader := outboundAuthorizationHeaderFromContext(ctx)
	var lastErr error

	for idx, profile := range profiles {
		c := collectorForUserAgentProfile(profile, authHeader, colly.AllowURLRevisit())
		var lastStatusCode int
		var title string
		var mdContent strings.Builder

		c.OnError(func(r *colly.Response, err error) {
			if r != nil {
				lastStatusCode = r.StatusCode
				requestURL := rawURL
				if r.Request != nil && r.Request.URL != nil {
					requestURL = r.Request.URL.String()
				}
				slog.Warn(
					"scrapeSinglePage error",
					"url", requestURL,
					"user_agent_profile", profile.Name,
					"status_code", r.StatusCode,
					"response_content_type", r.Headers.Get("Content-Type"),
					"response_server", r.Headers.Get("Server"),
					"response_location", r.Headers.Get("Location"),
					"response_snippet", responseSnippet(r.Body),
					"request_headers", collyRequestHeadersForLog(r.Request),
					"error", err,
				)
				return
			}
			slog.Warn("scrapeSinglePage error", "url", rawURL, "user_agent_profile", profile.Name, "status_code", 0, "error", err)
		})

		c.OnHTML("title", func(e *colly.HTMLElement) {
			title = e.Text
		})
		c.OnHTML("body", func(e *colly.HTMLElement) {
			mdContent.WriteString(extractContent(e.DOM))
		})

		err := c.Visit(rawURL)
		if err != nil {
			lastErr = err
			if idx < len(profiles)-1 {
				slog.Warn(
					"scrapeSinglePage visit failed, rotating user-agent profile",
					"url", rawURL,
					"attempt", idx+1,
					"attempt_total", len(profiles),
					"user_agent_profile", profile.Name,
					"status_code", lastStatusCode,
					"error", err,
				)
			}
			continue
		}

		content := mdContent.String()
		if title == "" {
			title = "scraped_page"
		}

		slog.Info(
			"scrapeSinglePage success",
			"url", rawURL,
			"attempt", idx+1,
			"attempt_total", len(profiles),
			"user_agent_profile", profile.Name,
		)
		return s.uploadPageContentWithProfile(ctx, rawURL, referenceID, title, content, "", profile)
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("scraping failed: no user-agent profiles available")
}

func (s *uploadServiceImpl) crawlSite(ctx context.Context, rootURL string, referenceID string, maxPages int) ([]*model.Attachment, error) {
	parsedRoot, err := url.Parse(rootURL)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}
	allowedHost := parsedRoot.Hostname()
	// Ensure rootPath has a trailing slash so /dept/egco2 doesn't match /dept/egco
	rootPath := parsedRoot.Path
	if !strings.HasSuffix(rootPath, "/") {
		rootPath += "/"
	}

	profiles := helper.RandomizedUserAgentProfiles()
	authHeader := outboundAuthorizationHeaderFromContext(ctx)
	var lastErr error

	for idx, profile := range profiles {
		profile := profile
		var mu sync.Mutex
		attachments := make([]*model.Attachment, 0)
		var pageCount int32
		var lastStatusCode int

		c := collectorForUserAgentProfile(
			profile,
			authHeader,
			colly.AllowedDomains(allowedHost),
			colly.Async(false),
		)

		c.OnError(func(r *colly.Response, reqErr error) {
			if r != nil {
				lastStatusCode = r.StatusCode
				requestURL := rootURL
				if r.Request != nil && r.Request.URL != nil {
					requestURL = r.Request.URL.String()
				}
				slog.Warn(
					"crawlSite error",
					"url", requestURL,
					"user_agent_profile", profile.Name,
					"status_code", r.StatusCode,
					"response_content_type", r.Headers.Get("Content-Type"),
					"response_server", r.Headers.Get("Server"),
					"response_location", r.Headers.Get("Location"),
					"response_snippet", responseSnippet(r.Body),
					"request_headers", collyRequestHeadersForLog(r.Request),
					"error", reqErr,
				)
				return
			}
			slog.Warn("crawlSite error", "url", rootURL, "user_agent_profile", profile.Name, "status_code", 0, "error", reqErr)
		})

		// Per-request storage using colly context
		c.OnRequest(func(r *colly.Request) {
			// SSRF check for each URL
			if err := s.urlValidator(r.URL.String()); err != nil {
				slog.Warn("crawlSite: SSRF check failed", "url", r.URL.String(), "error", err)
				r.Abort()
				return
			}
			// Page limit check
			if atomic.AddInt32(&pageCount, 1) > int32(maxPages) {
				r.Abort()
				return
			}
		})

		c.OnHTML("a[href]", func(e *colly.HTMLElement) {
			link := e.Request.AbsoluteURL(e.Attr("href"))
			if link == "" {
				return
			}
			parsed, err := url.Parse(link)
			if err != nil {
				return
			}
			// Strip fragment; only visit pages under the root path
			parsed.Fragment = ""
			linkPath := parsed.Path
			if !strings.HasSuffix(linkPath, "/") {
				linkPath += "/"
			}
			if !strings.HasPrefix(linkPath, rootPath) {
				return
			}
			_ = c.Visit(parsed.String()) // colly deduplicates; AllowedDomains filters externals
		})

		c.OnHTML("title", func(e *colly.HTMLElement) {
			e.Request.Ctx.Put("title", e.Text)
		})

		c.OnHTML("body", func(e *colly.HTMLElement) {
			e.Request.Ctx.Put("content", extractContent(e.DOM))
		})

		c.OnScraped(func(r *colly.Response) {
			title := r.Ctx.Get("title")
			content := r.Ctx.Get("content")
			if content == "" {
				return // skip empty pages
			}

			pageURL := r.Request.URL.String()
			attachment, uploadErr := s.uploadPageContentWithProfile(ctx, pageURL, referenceID, title, content, "crawl/", profile)
			if uploadErr != nil {
				slog.Warn("crawlSite: failed to upload page", "url", pageURL, "user_agent_profile", profile.Name, "error", uploadErr)
				return
			}

			mu.Lock()
			attachments = append(attachments, attachment)
			mu.Unlock()
		})

		err = c.Visit(rootURL)
		if err != nil {
			lastErr = err
			if idx < len(profiles)-1 {
				slog.Warn(
					"crawlSite root visit failed, rotating user-agent profile",
					"url", rootURL,
					"attempt", idx+1,
					"attempt_total", len(profiles),
					"user_agent_profile", profile.Name,
					"status_code", lastStatusCode,
					"error", err,
				)
			}
			continue
		}

		slog.Info(
			"crawlSite root visit success",
			"url", rootURL,
			"attempt", idx+1,
			"attempt_total", len(profiles),
			"user_agent_profile", profile.Name,
		)
		return attachments, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("crawl failed: no user-agent profiles available")
}

// enrichMarkdownImages finds all markdown image references in content,
// fetches each image, runs it through Typhoon OCR, and replaces the
// image tag with the extracted text at the same position.
// Images that fail SSRF checks, network fetches, or OCR are left as-is.
func (s *uploadServiceImpl) enrichMarkdownImages(ctx context.Context, pageURL string, content string, profile helper.UserAgentProfile) string {
	imgHTTPClient := &http.Client{Timeout: 30 * time.Second}
	authHeader := outboundAuthorizationHeaderFromContext(ctx)
	matches := mdImageRegex.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		slog.Info("enrichMarkdownImages: no markdown images detected", "page_url", pageURL)
		return content
	}
	slog.Info("enrichMarkdownImages: detected markdown images", "page_url", pageURL, "count", len(matches))

	return mdImageRegex.ReplaceAllStringFunc(content, func(match string) string {
		sub := mdImageRegex.FindStringSubmatch(match)
		if len(sub) < 3 {
			return match
		}
		alt := sub[1]
		imgURL, err := resolveImageURL(pageURL, sub[2])
		if err != nil {
			slog.Warn("enrichMarkdownImages: invalid image URL", "page_url", pageURL, "raw_url", sub[2], "error", err)
			return match
		}
		if parsed, parseErr := url.Parse(imgURL); parseErr == nil {
			if strings.HasSuffix(strings.ToLower(parsed.Path), ".gif") {
				slog.Info("enrichMarkdownImages: skipping gif image", "url", imgURL)
				return match
			}
		}

		// SSRF guard
		if err := s.urlValidator(imgURL); err != nil {
			slog.Warn("enrichMarkdownImages: skipping image (SSRF check)", "url", imgURL, "error", err)
			return match
		}

		profiles := imageFetchProfiles(profile)
		var resp *http.Response
		var usedProfile helper.UserAgentProfile
		var fetched bool
		for idx, fetchProfile := range profiles {
			req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, imgURL, nil)
			if reqErr != nil {
				slog.Warn("enrichMarkdownImages: build request failed", "url", imgURL, "error", reqErr)
				return match
			}
			req.Header.Set("User-Agent", fetchProfile.Value)
			req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
			req.Header.Set("Referer", pageURL)
			if originURL, originErr := url.Parse(pageURL); originErr == nil && originURL.Scheme != "" && originURL.Host != "" {
				req.Header.Set("Origin", originURL.Scheme+"://"+originURL.Host)
			}
			if authHeader != "" {
				req.Header.Set("Authorization", authHeader)
			}

			candidateResp, fetchErr := imgHTTPClient.Do(req)
			if fetchErr != nil {
				slog.Warn(
					"enrichMarkdownImages: fetch failed, rotating user-agent profile",
					"url", imgURL,
					"attempt", idx+1,
					"attempt_total", len(profiles),
					"user_agent_profile", fetchProfile.Name,
					"request_headers", filteredHeadersForLog(req.Header),
					"error", fetchErr,
				)
				continue
			}

			if candidateResp.StatusCode != http.StatusOK {
				contentType := candidateResp.Header.Get("Content-Type")
				candidateResp.Body.Close()
				slog.Warn(
					"enrichMarkdownImages: non-200 response, rotating user-agent profile",
					"url", imgURL,
					"attempt", idx+1,
					"attempt_total", len(profiles),
					"user_agent_profile", fetchProfile.Name,
					"status", candidateResp.StatusCode,
					"content_type", contentType,
					"request_headers", filteredHeadersForLog(req.Header),
				)
				continue
			}

			resp = candidateResp
			usedProfile = fetchProfile
			fetched = true
			break
		}
		if !fetched || resp == nil {
			return match
		}
		defer resp.Body.Close()
		if strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "gif") {
			slog.Info("enrichMarkdownImages: skipping gif image by content-type", "url", imgURL, "user_agent_profile", usedProfile.Name)
			return match
		}
		slog.Info("enrichMarkdownImages: fetched image for OCR", "url", imgURL, "user_agent_profile", usedProfile.Name)

		imgBytes, err := io.ReadAll(io.LimitReader(resp.Body, MaxUploadSize))
		if err != nil {
			slog.Warn("enrichMarkdownImages: read body failed", "url", imgURL, "error", err)
			return match
		}

		// Determine filename extension from Content-Type or URL
		ext := ".jpg"
		if ct := resp.Header.Get("Content-Type"); ct != "" {
			if strings.Contains(ct, "png") {
				ext = ".png"
			} else if strings.Contains(ct, "gif") {
				ext = ".gif"
			} else if strings.Contains(ct, "webp") {
				ext = ".webp"
			}
		}

		ocrText, err := s.ocrRepo.ExtractText(ctx, bytes.NewReader(imgBytes), "image"+ext, repository.OCROptions{})
		if err != nil {
			slog.Warn("enrichMarkdownImages: OCR failed", "url", imgURL, "error", err)
			return match
		}

		ocrText = strings.TrimSpace(ocrText)
		if ocrText == "" {
			return match
		}

		label := alt
		if label == "" {
			label = "image"
		}
		return fmt.Sprintf("\n> **[Image: %s]**\n%s\n", label, ocrText)
	})
}

func (s *uploadServiceImpl) uploadPageContent(ctx context.Context, pageURL string, referenceID string, title string, content string, keyPrefix string) (*model.Attachment, error) {
	return s.uploadPageContentWithProfile(
		ctx,
		pageURL,
		referenceID,
		title,
		content,
		keyPrefix,
		helper.UserAgentProfile{Name: "default"},
	)
}

func (s *uploadServiceImpl) uploadPageContentWithProfile(ctx context.Context, pageURL string, referenceID string, title string, content string, keyPrefix string, profile helper.UserAgentProfile) (*model.Attachment, error) {
	// Determine filename: prefer title, fall back to URL path slug
	slug := title
	if slug == "" {
		if u, err := url.Parse(pageURL); err == nil {
			slug = strings.Trim(u.Path, "/")
			slug = strings.ReplaceAll(slug, "/", "-")
		}
	}
	if slug == "" {
		slug = "page"
	}

	fileID := uuid.New().String()
	fileName := fmt.Sprintf("%s-%s.md", helper.SanitizeFilename(slug), fileID)
	fileKey := fmt.Sprintf("%s/%s%s", referenceID, keyPrefix, fileName)

	// Enrich markdown: replace inline image references with OCR-extracted text
	if s.ocrRepo != nil {
		content = s.enrichMarkdownImages(ctx, pageURL, content, profile)
	}

	if err := s.r2Service.UploadString(ctx, fileKey, content, "text/markdown"); err != nil {
		return nil, err
	}

	refID, err := uuid.Parse(referenceID)
	if err != nil {
		return nil, err
	}

	displayName := title
	if displayName == "" || displayName == "scraped_page" {
		displayName = pageURL
	}

	meta, _ := json.Marshal(map[string]string{"source_url": pageURL})

	attachment := &model.Attachment{
		ReferenceID:      refID,
		FileName:         fileName,
		FileSize:         int64(len(content)),
		Bucket:           s.bucketName,
		FileKey:          fileKey,
		OriginalFileName: displayName,
		Meta:             meta,
	}

	if err := s.attachmentRepo.Create(ctx, attachment); err != nil {
		return nil, err
	}

	return attachment, nil
}

func (s *uploadServiceImpl) ListFiles(ctx context.Context, referenceID, userID uuid.UUID) ([]*model.Attachment, error) {
	if err := s.authorizeReferenceOwnership(ctx, referenceID, userID); err != nil {
		return nil, err
	}
	return s.attachmentRepo.FindByReferenceID(ctx, referenceID)
}

func (s *uploadServiceImpl) DeleteFile(ctx context.Context, id, userID uuid.UUID) error {
	return s.DeleteFilesBatch(ctx, []uuid.UUID{id}, userID)
}

func (s *uploadServiceImpl) DeleteFilesBatch(ctx context.Context, ids []uuid.UUID, userID uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}

	attachments := make([]*model.Attachment, 0, len(ids))

	for _, id := range ids {
		attachment, err := s.attachmentRepo.FindByID(ctx, id)
		if err != nil {
			return ErrNotFound
		}
		if err := s.authorizeReferenceOwnership(ctx, attachment.ReferenceID, userID); err != nil {
			return err
		}
		attachments = append(attachments, attachment)
	}

	if len(attachments) == 0 {
		return ErrNotFound
	}

	// 1. Delete from R2 (Done individually as R2 often uses S3 standard which is per-object)
	for _, a := range attachments {
		_ = s.r2Service.Delete(ctx, a.FileKey)
	}

	// 2. Delete related embeddings
	for _, a := range attachments {
		_ = s.embeddingRepo.DeleteByAttachmentID(ctx, a.ID)
	}

	// 3. Delete attachments from DB
	if err := s.attachmentRepo.DeleteBatch(ctx, ids); err != nil {
		return err
	}

	// 4. Force re-evaluation if the deleted files were part of the knowledge base
	for _, a := range attachments {
		if a.IsEmbedded && a.ReferenceID != uuid.Nil {
			slog.Info("Triggering re-evaluation after batch file deletion", "reference_id", a.ReferenceID, "user_id", userID)
			_, _ = s.evaluationService.TriggerEvaluation(ctx, a.ReferenceID, userID)
			break
		}
	}

	return nil
}

func (s *uploadServiceImpl) GetFileContent(ctx context.Context, id, userID uuid.UUID) (string, error) {
	attachment, err := s.attachmentRepo.FindByID(ctx, id)
	if err != nil {
		return "", ErrNotFound
	}

	if err := s.authorizeReferenceOwnership(ctx, attachment.ReferenceID, userID); err != nil {
		return "", err
	}

	content, err := s.r2Service.Download(ctx, attachment.FileKey)
	if err != nil {
		return "", fmt.Errorf("download from R2: %w", err)
	}

	return string(content), nil
}

func (s *uploadServiceImpl) processOCR(ctx context.Context, filePath string, contentType string, opts repository.OCROptions) (string, error) {
	// For PDFs, check size and chunk if necessary to stay within Typhoon's 4.5 MB limit.
	if contentType == "application/pdf" {
		stat, err := os.Stat(filePath)
		if err != nil {
			return "", fmt.Errorf("stat PDF: %w", err)
		}
		if stat.Size() > typhoonMaxFileSize {
			slog.Info("processOCR: PDF exceeds Typhoon limit, chunking", "size", stat.Size(), "file", filePath)
			return s.processLargePDF(ctx, filePath, opts)
		}
	}

	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	text, err := s.ocrRepo.ExtractText(ctx, file, filepath.Base(filePath), opts)
	if err != nil {
		return "", err
	}

	return text, nil
}

// processLargePDF splits an oversized PDF into page-range chunks, OCRs each chunk,
// and concatenates the results. Chunks that fail OCR are skipped with a warning.
func (s *uploadServiceImpl) processLargePDF(ctx context.Context, filePath string, opts repository.OCROptions) (string, error) {
	// Count pages so we can estimate chunk size.
	f, r, err := pdf.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("open PDF for chunking: %w", err)
	}
	numPages := r.NumPage()
	f.Close()

	if numPages == 0 {
		return "", fmt.Errorf("PDF has no readable pages")
	}

	stat, err := os.Stat(filePath)
	if err != nil {
		return "", fmt.Errorf("stat PDF: %w", err)
	}

	// Estimate how many pages fit in one chunk.
	avgPageSize := stat.Size() / int64(numPages)
	pagesPerChunk := int(typhoonMaxFileSize / avgPageSize)
	if pagesPerChunk < 1 {
		pagesPerChunk = 1
	}
	slog.Info("processLargePDF: splitting PDF", "total_pages", numPages, "pages_per_chunk", pagesPerChunk)

	var results strings.Builder

	for start := 1; start <= numPages; start += pagesPerChunk {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}

		end := start + pagesPerChunk - 1
		if end > numPages {
			end = numPages
		}

		chunkFile, err := os.CreateTemp("", "pdf-chunk-*.pdf")
		if err != nil {
			return "", fmt.Errorf("create chunk temp file: %w", err)
		}
		chunkPath := chunkFile.Name()
		chunkFile.Close()

		pageRange := fmt.Sprintf("%d-%d", start, end)
		if err := pdfapi.TrimFile(filePath, chunkPath, []string{pageRange}, nil); err != nil {
			slog.Warn("processLargePDF: trim failed, skipping chunk", "range", pageRange, "error", err)
			os.Remove(chunkPath)
			continue
		}

		// If opts.Pages was specified, remap original page numbers to chunk-local numbers.
		chunkOpts := repository.OCROptions{}
		if len(opts.Pages) > 0 {
			for _, p := range opts.Pages {
				if p >= start && p <= end {
					chunkOpts.Pages = append(chunkOpts.Pages, p-start+1)
				}
			}
		}

		chunkF, err := os.Open(chunkPath)
		if err != nil {
			slog.Warn("processLargePDF: open chunk failed", "range", pageRange, "error", err)
			os.Remove(chunkPath)
			continue
		}

		chunkText, err := s.ocrRepo.ExtractText(ctx, chunkF, "document.pdf", chunkOpts)
		chunkF.Close()
		os.Remove(chunkPath)

		if err != nil {
			slog.Warn("processLargePDF: OCR failed for chunk, skipping", "range", pageRange, "error", err)
			continue
		}

		results.WriteString(chunkText)
	}

	return results.String(), nil
}

func (s *uploadServiceImpl) authorizeReferenceOwnership(ctx context.Context, referenceID, userID uuid.UUID) error {
	if referenceID == uuid.Nil {
		return ErrNotFound
	}

	if s.teamRepo != nil {
		if team, err := s.teamRepo.GetTeam(ctx, referenceID, userID); err == nil && team != nil {
			return nil
		}
	}

	if s.sessionRepo != nil {
		if session, err := s.sessionRepo.GetSession(ctx, referenceID.String(), userID); err == nil && session != nil {
			return nil
		}
	}

	if s.chatRepo != nil {
		ownerID, err := s.chatRepo.GetSessionOwner(ctx, referenceID)
		if err == nil {
			if ownerID == userID {
				return nil
			}
			return ErrForbidden
		}
	}

	return ErrNotFound
}

// Helpers

func validateURLForSSRF(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("URL scheme not allowed: %s", u.Scheme)
	}
	if u.Hostname() == "" {
		return fmt.Errorf("URL has no host")
	}
	addrs, err := net.LookupHost(u.Hostname())
	if err != nil {
		return fmt.Errorf("cannot resolve host: %w", err)
	}
	for _, addr := range addrs {
		if ip := net.ParseIP(addr); ip != nil && isPrivateIP(ip) {
			return fmt.Errorf("URL resolves to private/internal address")
		}
	}
	return nil
}

func isPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	for _, cidr := range []string{
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
		"100.64.0.0/10", "169.254.0.0/16", "::1/128", "fc00::/7", "fe80::/10",
	} {
		_, network, _ := net.ParseCIDR(cidr)
		if network != nil && network.Contains(ip) {
			return true
		}
	}
	return false
}

