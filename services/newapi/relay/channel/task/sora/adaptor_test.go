package sora

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gin-gonic/gin"
)

func soraTestContext(t *testing.T, method, url, body string) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(method, url, strings.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	return ctx
}

func soraTestInfo(serverURL string) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl: serverURL,
			ApiKey:         "sk-test",
		},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{},
	}
}

func TestDoRequestFallsBackToLegacyVideosGenerationsOnRoute404(t *testing.T) {
	const requestBody = `{"model":"video-ds-2.0","prompt":"make a clip","duration":5}`

	var mu sync.Mutex
	var paths []string
	var bodies []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		mu.Lock()
		paths = append(paths, r.URL.Path)
		bodies = append(bodies, string(body))
		attempt := len(paths)
		mu.Unlock()

		if attempt == 1 {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"message":"Invalid URL (POST /v1/videos)"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"legacy-task-1"}`))
	}))
	defer server.Close()

	info := soraTestInfo(server.URL)
	adaptor := &TaskAdaptor{}
	adaptor.Init(info)
	ctx := soraTestContext(t, http.MethodPost, server.URL+"/v1/videos", requestBody)

	resp, err := adaptor.DoRequest(ctx, info, strings.NewReader(requestBody))
	require.NoError(t, err)
	require.NotNil(t, resp)
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.JSONEq(t, `{"id":"legacy-task-1"}`, string(responseBody))

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, []string{"/v1/videos", "/v1/videos/generations"}, paths)
	assert.Equal(t, []string{requestBody, requestBody}, bodies)
}

func TestDoRequestKeepsNonRoute404BodyAndDoesNotFallback(t *testing.T) {
	const requestBody = `{"model":"video-ds-2.0","prompt":"make a clip"}`
	const responseBody = `{"error":{"message":"video task not found"}}`
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(responseBody))
	}))
	defer server.Close()

	info := soraTestInfo(server.URL)
	adaptor := &TaskAdaptor{}
	adaptor.Init(info)
	ctx := soraTestContext(t, http.MethodPost, server.URL+"/v1/videos", requestBody)

	resp, err := adaptor.DoRequest(ctx, info, strings.NewReader(requestBody))
	require.NoError(t, err)
	require.NotNil(t, resp)
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	assert.Equal(t, responseBody, string(body))
	assert.Equal(t, 1, requests)
}

func TestShouldFallbackToLegacyVideosOnlyForRouteErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		body string
		want bool
	}{
		{name: "invalid url", body: `{"error":{"message":"Invalid URL (POST /v1/videos)"}}`, want: true},
		{name: "route not found", body: `{"error":{"message":"route not found"}}`, want: true},
		{name: "generic page not found", body: `404 page not found`, want: true},
		{name: "business not found", body: `{"error":{"message":"video task not found"}}`, want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			resp := &http.Response{
				StatusCode: http.StatusNotFound,
				Body:       io.NopCloser(strings.NewReader(test.body)),
			}
			assert.Equal(t, test.want, shouldFallbackToLegacyVideos(resp))
			remaining, err := io.ReadAll(resp.Body)
			require.NoError(t, err)
			assert.Equal(t, test.body, string(remaining))
			_ = resp.Body.Close()
		})
	}
}

func TestFetchTaskUsesCurrentVideosRoute(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodGet, r.Method)
		assert.Equal(t, "/v1/videos/task-123", r.URL.Path)
		assert.Equal(t, "Bearer sk-test", r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"task-123","status":"completed"}`))
	}))
	defer server.Close()

	adaptor := &TaskAdaptor{}
	resp, err := adaptor.FetchTask(server.URL, "sk-test", map[string]any{"task_id": "task-123"}, "")
	require.NoError(t, err)
	require.NotNil(t, resp)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

func TestBuildRequestURLKeepsRemixRoute(t *testing.T) {
	adaptor := &TaskAdaptor{baseURL: "https://upstream.example"}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{
			Action:       constant.TaskActionRemix,
			OriginTaskID: "task-123",
		},
	}
	url, err := adaptor.BuildRequestURL(info)
	require.NoError(t, err)
	assert.Equal(t, "https://upstream.example/v1/videos/task-123/remix", url)
}
