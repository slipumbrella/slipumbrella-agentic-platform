package adapter_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"capstone-prog/config"
	httpAdapter "capstone-prog/adapter/http"
	"capstone-prog/core/data/request"
	coreResponse "capstone-prog/core/data/response"
	"capstone-prog/core/model"
	"capstone-prog/core/service"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)


type fakeOpenRouterModelRepository struct {
	listAllFn    func(ctx context.Context) ([]*model.OpenRouterModel, error)
	listActiveFn func(ctx context.Context) ([]*model.OpenRouterModel, error)
	getByUUIDFn  func(ctx context.Context, modelUUID uuid.UUID) (*model.OpenRouterModel, error)
	createFn     func(ctx context.Context, item *model.OpenRouterModel) error
	updateFn     func(ctx context.Context, modelUUID uuid.UUID, item *model.OpenRouterModel) error
	deleteFn     func(ctx context.Context, modelUUID uuid.UUID) error
}

func (f *fakeOpenRouterModelRepository) ListAll(ctx context.Context) ([]*model.OpenRouterModel, error) {
	if f.listAllFn == nil {
		return nil, nil
	}
	return f.listAllFn(ctx)
}

func (f *fakeOpenRouterModelRepository) ListActive(ctx context.Context) ([]*model.OpenRouterModel, error) {
	if f.listActiveFn == nil {
		return nil, nil
	}
	return f.listActiveFn(ctx)
}

func (f *fakeOpenRouterModelRepository) GetByUUID(ctx context.Context, modelUUID uuid.UUID) (*model.OpenRouterModel, error) {
	if f.getByUUIDFn == nil {
		return nil, nil
	}
	return f.getByUUIDFn(ctx, modelUUID)
}

func (f *fakeOpenRouterModelRepository) Create(ctx context.Context, item *model.OpenRouterModel) error {
	if f.createFn == nil {
		return nil
	}
	return f.createFn(ctx, item)
}

func (f *fakeOpenRouterModelRepository) Update(ctx context.Context, modelUUID uuid.UUID, item *model.OpenRouterModel) error {
	if f.updateFn == nil {
		return nil
	}
	return f.updateFn(ctx, modelUUID, item)
}

func (f *fakeOpenRouterModelRepository) Delete(ctx context.Context, modelUUID uuid.UUID) error {
	if f.deleteFn == nil {
		return nil
	}
	return f.deleteFn(ctx, modelUUID)
}


type fakeR2Service struct {
	uploadBytesFn func(ctx context.Context, key string, data []byte, contentType string) error
}

func (f *fakeR2Service) Get(ctx context.Context, key string) (*s3.HeadObjectOutput, error) {
	return nil, nil
}
func (f *fakeR2Service) Upload(ctx context.Context, key string, body io.Reader, contentType string) error {
	return nil
}
func (f *fakeR2Service) UploadBytes(ctx context.Context, key string, data []byte, contentType string) error {
	if f.uploadBytesFn != nil {
		return f.uploadBytesFn(ctx, key, data, contentType)
	}
	return nil
}
func (f *fakeR2Service) UploadString(ctx context.Context, key, content, contentType string) error {
	return nil
}
func (f *fakeR2Service) Download(ctx context.Context, key string) ([]byte, error) {
	return nil, nil
}
func (f *fakeR2Service) Delete(ctx context.Context, key string) error {
	return nil
}
func (f *fakeR2Service) List(ctx context.Context, prefix string, max int32) ([]string, error) {
	return nil, nil
}

func mockConfig() *config.Config {
	return &config.Config{
		R2_PUBLIC_URL: "https://cdn.example.com",
	}
}

func TestOpenRouterModelHandler_ListReturnsAllModels(t *testing.T) {
	gin.SetMode(gin.TestMode)

	repo := &fakeOpenRouterModelRepository{
		listAllFn: func(_ context.Context) ([]*model.OpenRouterModel, error) {
			return []*model.OpenRouterModel{
				{
					ID:   "stepfun/step-3.5-flash:free",
					Name: "Step 3.5 Flash (free)",
					Tags: []string{"Steady"},
				},
			}, nil
		},
	}

	handler := httpAdapter.NewOpenRouterModelHandler(service.NewOpenRouterModelService(repo, &fakeR2Service{}, mockConfig()))
	router := gin.New()
	router.GET("/api/openrouter-models", handler.List)

	req := httptest.NewRequest(http.MethodGet, "/api/openrouter-models", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var payload coreResponse.ListOpenRouterModelsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Len(t, payload.Models, 1)
	require.Equal(t, "stepfun/step-3.5-flash:free", payload.Models[0].ID)
	require.Equal(t, []string{"Steady"}, payload.Models[0].Tags)
}

func TestOpenRouterModelHandler_ListActiveReturnsBuilderFields(t *testing.T) {
	gin.SetMode(gin.TestMode)

	repo := &fakeOpenRouterModelRepository{
		listActiveFn: func(_ context.Context) ([]*model.OpenRouterModel, error) {
			return []*model.OpenRouterModel{
				{
					UUID:          uuid.New(),
					ID:            "openai/gpt-4.1-mini",
					Name:          "GPT-4.1 Mini",
					Tags:          []string{"Steady", "Preview"},
					SelectionHint: "Balanced default for most teams.",
					AdvancedInfo:  "Price: Mid. Reasoning: Good general reasoning. Context: Handles long instructions.",
					Description:   "Balanced model",
					ContextLength: 128000,
					InputPrice:    0.4,
					OutputPrice:   1.6,
					IsReasoning:   false,
					IsActive:      true,
				},
			}, nil
		},
	}

	handler := httpAdapter.NewOpenRouterModelHandler(service.NewOpenRouterModelService(repo, &fakeR2Service{}, mockConfig()))
	router := gin.New()
	router.GET("/api/builder-models", handler.ListActive)

	req := httptest.NewRequest(http.MethodGet, "/api/builder-models", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var payload coreResponse.ListOpenRouterModelsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Len(t, payload.Models, 1)
	require.Equal(t, []string{"Steady", "Preview"}, payload.Models[0].Tags)
	require.Equal(t, "Balanced default for most teams.", payload.Models[0].SelectionHint)
	require.Equal(t, "Price: Mid. Reasoning: Good general reasoning. Context: Handles long instructions.", payload.Models[0].AdvancedInfo)
}

func TestOpenRouterModelHandler_GetReturnsModel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	modelUUID := uuid.New()

	repo := &fakeOpenRouterModelRepository{
		getByUUIDFn: func(_ context.Context, actualUUID uuid.UUID) (*model.OpenRouterModel, error) {
			assert.Equal(t, modelUUID, actualUUID)
			return &model.OpenRouterModel{
				UUID: modelUUID,
				ID:   "openai/gpt-4.1-mini",
				Name: "GPT-4.1 Mini",
				Tags: []string{"Steady"},
			}, nil
		},
	}

	handler := httpAdapter.NewOpenRouterModelHandler(service.NewOpenRouterModelService(repo, &fakeR2Service{}, mockConfig()))
	router := gin.New()
	router.GET("/api/openrouter-models/:uuid", handler.Get)

	req := httptest.NewRequest(http.MethodGet, "/api/openrouter-models/"+modelUUID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var payload coreResponse.GetOpenRouterModelResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Equal(t, modelUUID, payload.Model.UUID)
	require.Equal(t, "openai/gpt-4.1-mini", payload.Model.ID)
}

func TestOpenRouterModelHandler_CreateReturnsCreatedModel(t *testing.T) {
	gin.SetMode(gin.TestMode)

	repo := &fakeOpenRouterModelRepository{
		createFn: func(_ context.Context, item *model.OpenRouterModel) error {
			assert.Equal(t, "openai/gpt-4.1-mini", item.ID)
			assert.Equal(t, "GPT-4.1 Mini", item.Name)
			assert.Equal(t, []string{"Steady", "Preview"}, []string(item.Tags))
			assert.Equal(t, "Balanced default for most teams.", item.SelectionHint)
			assert.Equal(t, "Price: Mid. Reasoning: Good general reasoning. Context: Handles long instructions.", item.AdvancedInfo)
			assert.Equal(t, "Balanced model", item.Description)
			assert.Equal(t, 128000, item.ContextLength)
			assert.True(t, item.IsActive)
			return nil
		},
	}

	handler := httpAdapter.NewOpenRouterModelHandler(service.NewOpenRouterModelService(repo, &fakeR2Service{}, mockConfig()))
	router := gin.New()
	router.POST("/api/openrouter-models", handler.Create)

	body, err := json.Marshal(request.UpsertOpenRouterModelRequest{
		ID:            "  openai/gpt-4.1-mini  ",
		Name:          "  GPT-4.1 Mini  ",
		Tags:          []string{"  Steady  ", "  Preview "},
		SelectionHint: "  Balanced default for most teams.  ",
		AdvancedInfo:  "  Price: Mid. Reasoning: Good general reasoning. Context: Handles long instructions.  ",
		Description:   "  Balanced model  ",
		ContextLength: 128000,
		InputPrice:    0.4,
		OutputPrice:   1.6,
		IsReasoning:   false,
		IsActive:      true,
	})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/openrouter-models", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	var payload coreResponse.GetOpenRouterModelResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Equal(t, "openai/gpt-4.1-mini", payload.Model.ID)
	require.Equal(t, []string{"Steady", "Preview"}, payload.Model.Tags)
}

func TestOpenRouterModelHandler_CreateRejectsBlankTrimmedID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	repo := &fakeOpenRouterModelRepository{
		createFn: func(_ context.Context, _ *model.OpenRouterModel) error {
			t.Fatal("repository should not be called")
			return nil
		},
	}

	handler := httpAdapter.NewOpenRouterModelHandler(service.NewOpenRouterModelService(repo, &fakeR2Service{}, mockConfig()))
	router := gin.New()
	router.POST("/api/openrouter-models", handler.Create)

	body, err := json.Marshal(request.UpsertOpenRouterModelRequest{
		ID:   "   ",
		Name: "GPT-4.1 Mini",
	})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/openrouter-models", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), "model id is required")
}

func TestOpenRouterModelHandler_UpdateReturnsUpdatedModel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	modelUUID := uuid.New()

	repo := &fakeOpenRouterModelRepository{
		updateFn: func(_ context.Context, actualUUID uuid.UUID, item *model.OpenRouterModel) error {
			assert.Equal(t, modelUUID, actualUUID)
			assert.Equal(t, "openai/gpt-4.1", item.ID)
			assert.Equal(t, "GPT-4.1", item.Name)
			assert.Equal(t, []string{"Deep"}, []string(item.Tags))
			assert.Equal(t, "Best for harder tasks.", item.SelectionHint)
			assert.Equal(t, "Price: Higher. Reasoning: Deep. Context: Long prompt support.", item.AdvancedInfo)
			assert.Equal(t, "Upgraded model", item.Description)
			assert.True(t, item.IsActive)
			return nil
		},
		getByUUIDFn: func(_ context.Context, _ uuid.UUID) (*model.OpenRouterModel, error) {
			return &model.OpenRouterModel{
				UUID: modelUUID,
				Icon: "https://existing.icon",
			}, nil
		},
	}

	handler := httpAdapter.NewOpenRouterModelHandler(service.NewOpenRouterModelService(repo, &fakeR2Service{}, mockConfig()))
	router := gin.New()
	router.PUT("/api/openrouter-models/:uuid", handler.Update)

	body, err := json.Marshal(request.UpsertOpenRouterModelRequest{
		ID:            "  openai/gpt-4.1  ",
		Name:          "  GPT-4.1  ",
		Tags:          []string{"  Deep  "},
		SelectionHint: "  Best for harder tasks.  ",
		AdvancedInfo:  "  Price: Higher. Reasoning: Deep. Context: Long prompt support.  ",
		Description:   "  Upgraded model  ",
		IsActive:      true,
	})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPut, "/api/openrouter-models/"+modelUUID.String(), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var payload coreResponse.GetOpenRouterModelResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	require.Equal(t, "openai/gpt-4.1", payload.Model.ID)
	require.Equal(t, []string{"Deep"}, payload.Model.Tags)
}

func TestOpenRouterModelHandler_CreateRejectsEmptyTags(t *testing.T) {
	gin.SetMode(gin.TestMode)

	repo := &fakeOpenRouterModelRepository{
		createFn: func(_ context.Context, _ *model.OpenRouterModel) error {
			t.Fatal("repository should not be called")
			return nil
		},
	}

	handler := httpAdapter.NewOpenRouterModelHandler(service.NewOpenRouterModelService(repo, &fakeR2Service{}, mockConfig()))
	router := gin.New()
	router.POST("/api/openrouter-models", handler.Create)

	body, err := json.Marshal(request.UpsertOpenRouterModelRequest{
		ID:   "openai/gpt-4.1-mini",
		Name: "GPT-4.1 Mini",
		Tags: []string{},
	})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/openrouter-models", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), "model tags are required")
}

func TestOpenRouterModelHandler_CreateRejectsBlankTrimmedTagEntry(t *testing.T) {
	gin.SetMode(gin.TestMode)

	repo := &fakeOpenRouterModelRepository{
		createFn: func(_ context.Context, _ *model.OpenRouterModel) error {
			t.Fatal("repository should not be called")
			return nil
		},
	}

	handler := httpAdapter.NewOpenRouterModelHandler(service.NewOpenRouterModelService(repo, &fakeR2Service{}, mockConfig()))
	router := gin.New()
	router.POST("/api/openrouter-models", handler.Create)

	body, err := json.Marshal(request.UpsertOpenRouterModelRequest{
		ID:   "openai/gpt-4.1-mini",
		Name: "GPT-4.1 Mini",
		Tags: []string{"Steady", "   "},
	})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/openrouter-models", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), "model tags must not contain blank values")
}

func TestOpenRouterModelHandler_DeleteReturnsNoContent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	modelUUID := uuid.New()

	repo := &fakeOpenRouterModelRepository{
		deleteFn: func(_ context.Context, actualUUID uuid.UUID) error {
			assert.Equal(t, modelUUID, actualUUID)
			return nil
		},
	}

	handler := httpAdapter.NewOpenRouterModelHandler(service.NewOpenRouterModelService(repo, &fakeR2Service{}, mockConfig()))
	router := gin.New()
	router.DELETE("/api/openrouter-models/:uuid", handler.Delete)

	req := httptest.NewRequest(http.MethodDelete, "/api/openrouter-models/"+modelUUID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNoContent, rec.Code)
}

func TestOpenRouterModelHandler_GetReturnsNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)

	repo := &fakeOpenRouterModelRepository{
		getByUUIDFn: func(_ context.Context, _ uuid.UUID) (*model.OpenRouterModel, error) {
			return nil, gorm.ErrRecordNotFound
		},
	}

	handler := httpAdapter.NewOpenRouterModelHandler(service.NewOpenRouterModelService(repo, &fakeR2Service{}, mockConfig()))
	router := gin.New()
	router.GET("/api/openrouter-models/:uuid", handler.Get)

	req := httptest.NewRequest(http.MethodGet, "/api/openrouter-models/"+uuid.New().String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNotFound, rec.Code)
}
