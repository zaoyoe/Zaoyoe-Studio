package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	appI18n "github.com/QuantumNous/new-api/i18n"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func useRelayConcurrencyMiniRedis(t *testing.T) *redis.Client {
	t.Helper()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	require.NoError(t, client.Ping(context.Background()).Err())
	previousEnabled := common.RedisEnabled
	previousClient := common.RDB
	common.RedisEnabled = true
	common.RDB = client
	t.Cleanup(func() {
		_ = client.Close()
		common.RedisEnabled = previousEnabled
		common.RDB = previousClient
	})
	return client
}

func relayConcurrencyTestContext(limit int, userID int, requestID string) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	c.Set("id", userID)
	c.Set(common.RequestIdKey, requestID)
	common.SetContextKey(c, constant.ContextKeyUserRelayConcurrency, limit)
	return c, recorder
}

func TestRelayConcurrencyLeaseRejectsAtLimitAndAllowsAfterRelease(t *testing.T) {
	gin.SetMode(gin.TestMode)
	useRelayConcurrencyMiniRedis(t)

	ctx, _ := relayConcurrencyTestContext(1, 42, "request-one")
	first, acquired, err := acquireRelayConcurrencyLease(ctx.Request.Context(), 42, 1, "request-one", func() {})
	require.NoError(t, err)
	require.True(t, acquired)
	t.Cleanup(first.Release)

	second, acquired, err := acquireRelayConcurrencyLease(ctx.Request.Context(), 42, 1, "request-two", func() {})
	require.NoError(t, err)
	assert.False(t, acquired)
	assert.Nil(t, second)

	first.Release()
	second, acquired, err = acquireRelayConcurrencyLease(ctx.Request.Context(), 42, 1, "request-two", func() {})
	require.NoError(t, err)
	require.True(t, acquired)
	second.Release()
}

func TestRelayConcurrencyMiddlewareFailsClosedWithoutRedis(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, appI18n.Init())
	previousEnabled := common.RedisEnabled
	previousClient := common.RDB
	common.RedisEnabled = false
	common.RDB = nil
	t.Cleanup(func() {
		common.RedisEnabled = previousEnabled
		common.RDB = previousClient
	})

	router := gin.New()
	router.POST(
		"/v1/chat/completions",
		func(c *gin.Context) {
			c.Set("id", 42)
			common.SetContextKey(c, constant.ContextKeyUserRelayConcurrency, 1)
		},
		RelayConcurrencyLimit(),
		func(c *gin.Context) { c.Status(http.StatusNoContent) },
	)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	router.ServeHTTP(response, request)

	assert.Equal(t, http.StatusServiceUnavailable, response.Code)
	assert.Contains(t, response.Body.String(), "relay_concurrency_unavailable")
}

func TestRelayConcurrencyMiddlewareLeavesUnmigratedUsersUnlimited(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousEnabled := common.RedisEnabled
	previousClient := common.RDB
	common.RedisEnabled = false
	common.RDB = nil
	t.Cleanup(func() {
		common.RedisEnabled = previousEnabled
		common.RDB = previousClient
	})

	router := gin.New()
	router.POST("/v1/chat/completions", RelayConcurrencyLimit(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	router.ServeHTTP(response, request)

	assert.Equal(t, http.StatusNoContent, response.Code)
}
