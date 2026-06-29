package service

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestBuildOpenAIVideosURL(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		base string
		want string
	}{
		{"bare domain", "https://api.openai.com", "https://api.openai.com/v1/videos"},
		{"bare /v1", "https://api.openai.com/v1", "https://api.openai.com/v1/videos"},
		{"already videos", "https://api.openai.com/v1/videos", "https://api.openai.com/v1/videos"},
		{"third-party versioned path", "https://ark.cn-beijing.volces.com/api/v3", "https://ark.cn-beijing.volces.com/api/v3/videos"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, tt.want, buildOpenAIVideosURL(tt.base))
		})
	}
}

func TestForwardVideos_APIKeyPassthroughUsesVideosEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)

	reqBody := []byte(`{
		"model":"video-ds-2.0-fast",
		"prompt":"dragon and qilin facing off",
		"ratio":"16:9",
		"duration":5
	}`)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos/generations", bytes.NewReader(reqBody))
	c.Request.Header.Set("Content-Type", "application/json")

	upstream := &httpUpstreamRecorder{resp: &http.Response{
		StatusCode: http.StatusOK,
		Header: http.Header{
			"Content-Type": []string{"application/json"},
			"X-Request-Id": []string{"video-rid"},
		},
		Body: io.NopCloser(strings.NewReader(`{"id":"video-task-1","status":"queued","model":"jimeng-video-upstream"}`)),
	}}
	svc := &OpenAIGatewayService{
		cfg:          &config.Config{},
		httpUpstream: upstream,
	}
	groupID := int64(9)
	account := &Account{
		ID:       42,
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
		GroupIDs: []int64{groupID},
		Credentials: map[string]any{
			"api_key":  "sk-test",
			"base_url": "https://video.example.com/v1",
			"model_mapping": map[string]any{
				"video-ds-2.0-fast": "jimeng-video-upstream",
			},
		},
	}
	parsed, err := svc.ParseOpenAIVideosRequest(reqBody)
	require.NoError(t, err)

	result, err := svc.ForwardVideos(context.Background(), c, account, &groupID, reqBody, parsed, "")

	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, result)
	require.Equal(t, "video-rid", result.RequestID)
	require.Equal(t, "video-ds-2.0-fast", result.Model)
	require.Equal(t, "jimeng-video-upstream", result.BillingModel)
	require.Equal(t, "jimeng-video-upstream", result.UpstreamModel)
	require.Equal(t, "https://video.example.com/v1/videos", upstream.lastReq.URL.String())
	require.NotContains(t, upstream.lastReq.URL.String(), "/images/")
	require.Equal(t, "Bearer sk-test", upstream.lastReq.Header.Get("Authorization"))
	require.Equal(t, "jimeng-video-upstream", gjson.GetBytes(upstream.lastBody, "model").String())
	require.Equal(t, "dragon and qilin facing off", gjson.GetBytes(upstream.lastBody, "prompt").String())
}

func TestForwardVideos_FallsBackToLegacyVideosEndpointWhenUpstreamDoesNotSupportVideosRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)

	reqBody := []byte(`{
		"model":"video-ds-2.0-fast",
		"prompt":"dragon and qilin facing off",
		"ratio":"16:9",
		"duration":5
	}`)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(reqBody))
	c.Request.Header.Set("Content-Type", "application/json")

	upstream := &httpUpstreamRecorder{responses: []*http.Response{
		{
			StatusCode: http.StatusNotFound,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"error":{"message":"Invalid URL (POST /v1/videos)","type":"invalid_request_error"}}`)),
		},
		{
			StatusCode: http.StatusOK,
			Header: http.Header{
				"Content-Type": []string{"application/json"},
				"X-Request-Id": []string{"video-fallback-rid"},
			},
			Body: io.NopCloser(strings.NewReader(`{"id":"video-task-1","data":[{"video_url":"https://cdn.example.com/video.mp4"}]}`)),
		},
	}}
	svc := &OpenAIGatewayService{
		cfg:          &config.Config{},
		httpUpstream: upstream,
	}
	groupID := int64(9)
	account := &Account{
		ID:       70,
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
		GroupIDs: []int64{groupID},
		Credentials: map[string]any{
			"api_key":  "sk-test",
			"base_url": "https://video.example.com/v1",
		},
	}
	parsed, err := svc.ParseOpenAIVideosRequest(reqBody)
	require.NoError(t, err)

	result, err := svc.ForwardVideos(context.Background(), c, account, &groupID, reqBody, parsed, "")

	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, result)
	require.Equal(t, "video-fallback-rid", result.RequestID)
	require.Len(t, upstream.requests, 2)
	require.Equal(t, "https://video.example.com/v1/videos", upstream.requests[0].URL.String())
	require.Equal(t, "https://video.example.com/v1/videos/generations", upstream.requests[1].URL.String())
	require.Equal(t, "video-ds-2.0-fast", gjson.GetBytes(upstream.bodies[1], "model").String())
}

func TestForwardVideos_FallsBackToLegacyVideosEndpointWhenUpstreamReturnsBusiness404Envelope(t *testing.T) {
	gin.SetMode(gin.TestMode)

	reqBody := []byte(`{
		"model":"video-ds-2.0-fast",
		"prompt":"dragon and qilin facing off",
		"ratio":"16:9",
		"duration":5
	}`)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(reqBody))
	c.Request.Header.Set("Content-Type", "application/json")

	upstream := &httpUpstreamRecorder{responses: []*http.Response{
		{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"code":404,"msg":"","data":null}`)),
		},
		{
			StatusCode: http.StatusOK,
			Header: http.Header{
				"Content-Type": []string{"application/json"},
				"X-Request-Id": []string{"video-business-404-fallback-rid"},
			},
			Body: io.NopCloser(strings.NewReader(`{"id":"video-task-2","data":[{"video_url":"https://cdn.example.com/business-404-video.mp4"}]}`)),
		},
	}}
	svc := &OpenAIGatewayService{
		cfg:          &config.Config{},
		httpUpstream: upstream,
	}
	groupID := int64(9)
	account := &Account{
		ID:       70,
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
		GroupIDs: []int64{groupID},
		Credentials: map[string]any{
			"api_key":  "sk-test",
			"base_url": "https://video.example.com/v1",
		},
	}
	parsed, err := svc.ParseOpenAIVideosRequest(reqBody)
	require.NoError(t, err)

	result, err := svc.ForwardVideos(context.Background(), c, account, &groupID, reqBody, parsed, "")

	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, result)
	require.Equal(t, "video-business-404-fallback-rid", result.RequestID)
	require.Len(t, upstream.requests, 2)
	require.Equal(t, "https://video.example.com/v1/videos", upstream.requests[0].URL.String())
	require.Equal(t, "https://video.example.com/v1/videos/generations", upstream.requests[1].URL.String())
	require.Equal(t, "video-ds-2.0-fast", gjson.GetBytes(upstream.bodies[1], "model").String())
	require.Contains(t, rec.Body.String(), "business-404-video.mp4")
}

func TestForwardVideos_UsesConfiguredVideoEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)

	reqBody := []byte(`{"model":"custom-video","prompt":"city timelapse"}`)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos/generations", bytes.NewReader(reqBody))
	c.Request.Header.Set("Content-Type", "application/json")

	upstream := &httpUpstreamRecorder{resp: &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(`{"id":"video-task-1"}`)),
	}}
	svc := &OpenAIGatewayService{
		cfg:          &config.Config{},
		httpUpstream: upstream,
	}
	groupID := int64(9)
	account := &Account{
		ID:       71,
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
		GroupIDs: []int64{groupID},
		Credentials: map[string]any{
			"api_key":        "sk-test",
			"base_url":       "https://video.example.com/v1",
			"video_endpoint": "/custom/videos",
		},
	}
	parsed, err := svc.ParseOpenAIVideosRequest(reqBody)
	require.NoError(t, err)

	_, err = svc.ForwardVideos(context.Background(), c, account, &groupID, reqBody, parsed, "")

	require.NoError(t, err)
	require.Equal(t, "https://video.example.com/v1/custom/videos", upstream.lastReq.URL.String())
	require.Len(t, upstream.requests, 1)
}

func TestForwardVideoTask_UsesBoundVideoTaskAccountForStatusAndContent(t *testing.T) {
	gin.SetMode(gin.TestMode)

	groupID := int64(9)
	cache := &stubGatewayCache{}
	upstream := &httpUpstreamRecorder{responses: []*http.Response{
		{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"id":"task-123","status":"succeeded"}`)),
		},
		{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"video/mp4"}},
			Body:       io.NopCloser(strings.NewReader(`mp4-bytes`)),
		},
	}}
	account := &Account{
		ID:       88,
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
		GroupIDs: []int64{groupID},
		Credentials: map[string]any{
			"api_key":  "sk-test",
			"base_url": "https://video.example.com/v1",
		},
	}
	svc := &OpenAIGatewayService{
		accountRepo:  stubOpenAIAccountRepo{accounts: []Account{*account}},
		cache:        cache,
		cfg:          &config.Config{},
		httpUpstream: upstream,
	}
	require.NoError(t, svc.BindOpenAIVideoTask(context.Background(), &groupID, account, "task-123"))

	resolved, err := svc.ResolveOpenAIVideoTaskAccount(context.Background(), &groupID, "task-123")
	require.NoError(t, err)
	require.Equal(t, int64(88), resolved.ID)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/videos/task-123", nil)
	result, err := svc.ForwardVideoTask(context.Background(), c, resolved, "task-123", false)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "https://video.example.com/v1/videos/task-123", upstream.requests[0].URL.String())
	require.Equal(t, "Bearer sk-test", upstream.requests[0].Header.Get("Authorization"))

	contentRec := httptest.NewRecorder()
	contentCtx, _ := gin.CreateTestContext(contentRec)
	contentCtx.Request = httptest.NewRequest(http.MethodGet, "/v1/videos/task-123/content", nil)
	_, err = svc.ForwardVideoTask(context.Background(), contentCtx, resolved, "task-123", true)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, contentRec.Code)
	require.Equal(t, "video/mp4", contentRec.Header().Get("Content-Type"))
	require.Equal(t, "https://video.example.com/v1/videos/task-123/content", upstream.requests[1].URL.String())
	require.Equal(t, "mp4-bytes", contentRec.Body.String())
}

func TestResolveOpenAIVideoTaskAccount_RejectsOtherGroup(t *testing.T) {
	groupID := int64(9)
	otherGroupID := int64(10)
	cache := &stubGatewayCache{}
	account := &Account{
		ID:       88,
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
		GroupIDs: []int64{groupID},
		Credentials: map[string]any{
			"api_key":  "sk-test",
			"base_url": "https://video.example.com/v1",
		},
	}
	svc := &OpenAIGatewayService{
		accountRepo: stubOpenAIAccountRepo{accounts: []Account{*account}},
		cache:       cache,
		cfg:         &config.Config{},
	}
	require.NoError(t, svc.BindOpenAIVideoTask(context.Background(), &groupID, account, "task-123"))

	_, err := svc.ResolveOpenAIVideoTaskAccount(context.Background(), &otherGroupID, "task-123")
	require.Error(t, err)
}
