package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
	"github.com/Wei-Shaw/sub2api/internal/pkg/usagestats"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"

	"github.com/gin-gonic/gin"
)

type gatewayUsageLookupRepoStub struct {
	service.UsageLogRepository
	filters usagestats.UsageLogFilters
	logs    []service.UsageLog
}

func (s *gatewayUsageLookupRepoStub) ListWithFilters(_ context.Context, _ pagination.PaginationParams, filters usagestats.UsageLogFilters) ([]service.UsageLog, *pagination.PaginationResult, error) {
	s.filters = filters
	return s.logs, &pagination.PaginationResult{Total: int64(len(s.logs)), Page: 1, PageSize: 1, Pages: 1}, nil
}

func TestGatewayUsageByRequestIDReturnsCurrentAPIKeyUsageRecord(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := &gatewayUsageLookupRepoStub{
		logs: []service.UsageLog{{
			ID:           9,
			UserID:       7,
			APIKeyID:     42,
			RequestID:    "client:fatherkey-chat-cost-1",
			Model:        "kimi-k2.6",
			InputTokens:  2000,
			OutputTokens: 1000,
			TotalCost:    0.137502,
			ActualCost:   0.137502,
		}},
	}
	handler := &GatewayHandler{
		usageService: service.NewUsageService(repo, nil, nil, nil),
	}

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/usage?request_id=client:fatherkey-chat-cost-1", nil)
	c.Set(string(middleware2.ContextKeyAPIKey), &service.APIKey{ID: 42})
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 7})

	handler.Usage(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if repo.filters.APIKeyID != 42 || repo.filters.RequestID != "client:fatherkey-chat-cost-1" {
		t.Fatalf("filters=%+v", repo.filters)
	}

	var body struct {
		Mode        string `json:"mode"`
		RequestID   string `json:"request_id"`
		UsageRecord struct {
			RequestID  string  `json:"request_id"`
			ActualCost float64 `json:"actual_cost"`
		} `json:"usage_record"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Mode != "request" || body.RequestID != "client:fatherkey-chat-cost-1" {
		t.Fatalf("unexpected body=%+v", body)
	}
	if body.UsageRecord.RequestID != "client:fatherkey-chat-cost-1" || body.UsageRecord.ActualCost != 0.137502 {
		t.Fatalf("unexpected usage_record=%+v", body.UsageRecord)
	}
}

func TestGatewayUsageRequestPathReturnsCurrentAPIKeyUsageRecord(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := &gatewayUsageLookupRepoStub{
		logs: []service.UsageLog{{
			ID:           10,
			UserID:       7,
			APIKeyID:     42,
			RequestID:    "client:fatherkey-aiw-task-123",
			Model:        "deepseek-v4-flash",
			InputTokens:  244,
			OutputTokens: 536,
			TotalCost:    0.001,
			ActualCost:   0.001,
		}},
	}
	handler := &GatewayHandler{
		usageService: service.NewUsageService(repo, nil, nil, nil),
	}

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/usage/requests/client%3Afatherkey-aiw-task-123", nil)
	c.Params = gin.Params{{Key: "request_id", Value: "client:fatherkey-aiw-task-123"}}
	c.Set(string(middleware2.ContextKeyAPIKey), &service.APIKey{ID: 42})
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 7})

	handler.UsageRequest(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if repo.filters.APIKeyID != 42 || repo.filters.RequestID != "client:fatherkey-aiw-task-123" {
		t.Fatalf("filters=%+v", repo.filters)
	}

	var body struct {
		Mode        string `json:"mode"`
		RequestID   string `json:"request_id"`
		UsageRecord struct {
			RequestID  string  `json:"request_id"`
			ActualCost float64 `json:"actual_cost"`
		} `json:"usage_record"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Mode != "request" || body.RequestID != "client:fatherkey-aiw-task-123" {
		t.Fatalf("unexpected body=%+v", body)
	}
	if body.UsageRecord.RequestID != "client:fatherkey-aiw-task-123" || body.UsageRecord.ActualCost != 0.001 {
		t.Fatalf("unexpected usage_record=%+v", body.UsageRecord)
	}
}
