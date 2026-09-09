package sora

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestShouldFallbackVideoCreateEndpoint(t *testing.T) {
	for _, body := range []string{
		`{"error":{"message":"Invalid URL (POST /v1/videos)"}}`,
		`{"message":"route not found"}`,
		`404 page not found`,
		``,
	} {
		assert.True(t, shouldFallbackVideoCreateEndpoint([]byte(body)), body)
	}
	assert.False(t, shouldFallbackVideoCreateEndpoint([]byte(`{"error":{"message":"model not found"}}`)))
}

func TestDoRequestFallsBackToLegacyVideoGenerationsRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.URL.Path == "/v1/videos" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":{"message":"Invalid URL (POST /v1/videos)"}}`)
			return
		}
		require.Equal(t, "/v1/videos/generations", r.URL.Path)
		require.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"video-task-1"}`)
	}))
	defer server.Close()

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"model":"video-ds-2.0","prompt":"test"}`))
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType: constant.ChannelTypeOpenAI, ChannelBaseUrl: server.URL, ApiKey: "test-key",
	}, TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	adaptor := &TaskAdaptor{}
	adaptor.Init(info)

	response, err := adaptor.DoRequest(c, info, strings.NewReader(`{"model":"video-ds-2.0","prompt":"test"}`))
	require.NoError(t, err)
	require.NotNil(t, response)
	defer response.Body.Close()
	assert.Equal(t, http.StatusOK, response.StatusCode)
	assert.Equal(t, []string{"/v1/videos", "/v1/videos/generations"}, paths)
}

func TestDoRequestPreservesNonRouteNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"error":{"message":"model not found"}}`)
	}))
	defer server.Close()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"model":"unknown"}`))
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType: constant.ChannelTypeOpenAI, ChannelBaseUrl: server.URL, ApiKey: "test-key",
	}, TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	adaptor := &TaskAdaptor{}
	adaptor.Init(info)
	response, err := adaptor.DoRequest(c, info, strings.NewReader(`{"model":"unknown"}`))
	require.NoError(t, err)
	require.NotNil(t, response)
	defer response.Body.Close()
	body, readErr := io.ReadAll(response.Body)
	require.NoError(t, readErr)
	assert.Equal(t, http.StatusNotFound, response.StatusCode)
	assert.JSONEq(t, `{"error":{"message":"model not found"}}`, string(body))
	assert.False(t, adaptor.legacyGenerationsEndpoint)
}
