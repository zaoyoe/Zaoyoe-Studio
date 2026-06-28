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
		{"bare domain", "https://api.openai.com", "https://api.openai.com/v1/videos/generations"},
		{"bare /v1", "https://api.openai.com/v1", "https://api.openai.com/v1/videos/generations"},
		{"already videos", "https://api.openai.com/v1/videos/generations", "https://api.openai.com/v1/videos/generations"},
		{"third-party versioned path", "https://ark.cn-beijing.volces.com/api/v3", "https://ark.cn-beijing.volces.com/api/v3/videos/generations"},
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
	account := &Account{
		ID:       42,
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
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

	result, err := svc.ForwardVideos(context.Background(), c, account, reqBody, parsed, "")

	require.NoError(t, err)
	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, result)
	require.Equal(t, "video-rid", result.RequestID)
	require.Equal(t, "video-ds-2.0-fast", result.Model)
	require.Equal(t, "jimeng-video-upstream", result.BillingModel)
	require.Equal(t, "jimeng-video-upstream", result.UpstreamModel)
	require.Equal(t, "https://video.example.com/v1/videos/generations", upstream.lastReq.URL.String())
	require.NotContains(t, upstream.lastReq.URL.String(), "/images/")
	require.Equal(t, "Bearer sk-test", upstream.lastReq.Header.Get("Authorization"))
	require.Equal(t, "jimeng-video-upstream", gjson.GetBytes(upstream.lastBody, "model").String())
	require.Equal(t, "dragon and qilin facing off", gjson.GetBytes(upstream.lastBody, "prompt").String())
}
