package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestSupportEndpointsRequireDashboardSessionAndFailClosed(t *testing.T) {
	accessToken, pat := setupSupportControllerTest(t)
	t.Setenv(service.SupportGatewayURLEnv, "")
	t.Setenv(service.SupportGatewayHMACSecretEnv, "")

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/user/support/context", middleware.UserAuth(), GetSupportContext)
	router.GET("/api/user/support/messages", middleware.UserAuth(), GetSupportMessages)
	router.POST("/api/user/support/messages", middleware.UserAuth(), CreateSupportMessage)

	tests := []struct {
		name       string
		method     string
		path       string
		token      string
		body       string
		wantStatus int
		wantCode   string
	}{
		{
			name:       "personal API token is rejected",
			method:     http.MethodGet,
			path:       "/api/user/support/messages",
			token:      pat,
			wantStatus: http.StatusForbidden,
			wantCode:   "AUTH_SESSION_REQUIRED",
		},
		{
			name:       "context requires a relative page path",
			method:     http.MethodGet,
			path:       "/api/user/support/context?page_path=https%3A%2F%2Fevil.example%2Faccount",
			token:      accessToken,
			wantStatus: http.StatusBadRequest,
			wantCode:   "SUPPORT_INVALID_REQUEST",
		},
		{
			name:       "message requires a safe idempotency key",
			method:     http.MethodPost,
			path:       "/api/user/support/messages",
			token:      accessToken,
			body:       `{"text":"Need help","client_message_id":"bad id","page":{"path":"/dashboard"}}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "SUPPORT_INVALID_REQUEST",
		},
		{
			name:       "configured gateway is required before sending user text",
			method:     http.MethodPost,
			path:       "/api/user/support/messages",
			token:      accessToken,
			body:       `{"text":"Need help with a request","client_message_id":"message-1","page":{"path":"/dashboard/keys","title":"Keys"}}`,
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   "SUPPORT_GATEWAY_UNAVAILABLE",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
			if test.body != "" {
				request.Header.Set("Content-Type", "application/json")
			}
			request.Header.Set("Authorization", "Bearer "+test.token)
			recorder := httptest.NewRecorder()

			router.ServeHTTP(recorder, request)

			assert.Equal(t, test.wantStatus, recorder.Code)
			var response struct {
				Success bool   `json:"success"`
				Code    string `json:"code"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.False(t, response.Success)
			assert.Equal(t, test.wantCode, response.Code)
		})
	}
}

func TestNormalizeSupportMessageTextAcceptsCanonicalAndLegacyField(t *testing.T) {
	text, err := normalizeSupportMessageText("  canonical text  ", "")
	require.NoError(t, err)
	assert.Equal(t, "canonical text", text)

	text, err = normalizeSupportMessageText("", " legacy content ")
	require.NoError(t, err)
	assert.Equal(t, "legacy content", text)

	_, err = normalizeSupportMessageText("canonical", "different legacy content")
	require.Error(t, err)
}

func TestSupportMessageListQueryCapsHistoryAtFiftyMessages(t *testing.T) {
	gin.SetMode(gin.TestMode)

	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodGet, "/api/user/support/messages?limit=50", nil)
	cursor, limit, err := supportMessageListQuery(context)
	require.NoError(t, err)
	assert.Empty(t, cursor)
	assert.Equal(t, 50, limit)

	overLimitContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	overLimitContext.Request = httptest.NewRequest(http.MethodGet, "/api/user/support/messages?limit=51", nil)
	_, _, err = supportMessageListQuery(overLimitContext)
	require.Error(t, err)
}

func setupSupportControllerTest(t *testing.T) (string, string) {
	t.Helper()
	previousDB := model.DB
	previousDatabaseType := common.MainDatabaseType()
	previousRedisEnabled := common.RedisEnabled
	previousSessionSecret := common.SessionSecret

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}))
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.SessionSecret = "support-controller-session-secret"
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousDatabaseType)
		common.RedisEnabled = previousRedisEnabled
		common.SessionSecret = previousSessionSecret
	})

	sessionUser := &model.User{
		Username:    "support-session-user",
		Password:    "password-placeholder",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		Email:       "session@example.com",
		AffCode:     "support-session-aff",
		AuthVersion: 1,
	}
	require.NoError(t, db.Create(sessionUser).Error)
	now := time.Now().Unix()
	session := &model.UserSession{
		SID:             "support-live-session",
		UserID:          sessionUser.Id,
		Version:         1,
		UserAuthVersion: sessionUser.AuthVersion,
		Status:          model.UserSessionStatusActive,
		RefreshHash:     "support-refresh-hash",
		LoginMethod:     "password",
		CreatedAt:       now,
		LastActiveAt:    now,
		ExpiresAt:       now + 3600,
	}
	require.NoError(t, model.CreateUserSession(session))
	accessToken, _, err := service.IssueAccessToken(service.AuthIdentity{
		UserID:          sessionUser.Id,
		SessionID:       session.SID,
		UserAuthVersion: session.UserAuthVersion,
		SessionVersion:  session.Version,
	})
	require.NoError(t, err)

	pat := "support-test-personal-token"
	patUser := &model.User{
		Username:    "support-pat-user",
		Password:    "password-placeholder",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AccessToken: &pat,
		AffCode:     "support-pat-aff",
		AuthVersion: 1,
	}
	require.NoError(t, db.Create(patUser).Error)
	return accessToken, pat
}
