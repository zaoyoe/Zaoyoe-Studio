package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const apiKeyPasswordConfirmationTestSecret = "dca131b4fe8f4f8b9057ffbf7b454507616241f878a421a7e1b9507295165124"

type apiKeyPasswordConfirmationResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Code    string `json:"code"`
	Data    struct {
		ProofToken string `json:"proof_token"`
		ExpiresAt  int64  `json:"expires_at"`
		Method     string `json:"method"`
		Scope      string `json:"scope"`
	} `json:"data"`
}

func setupAPIKeyPasswordConfirmationTest(t *testing.T, rawPassword string) (*gorm.DB, service.AuthIdentity) {
	t.Helper()

	previousDB := model.DB
	previousLogDB := model.LOG_DB
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()
	previousRedisEnabled := common.RedisEnabled
	previousSessionSecret := common.SessionSecret
	previousGinMode := gin.Mode()
	previousRegionalSettings := system_setting.GetRegionalRestrictionSettings()

	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())
	t.Setenv(regionalRestrictionSecretEnv, apiKeyPasswordConfirmationTestSecret)
	regionalSettings := system_setting.RegionalRestrictionSettings{
		Enabled:                       true,
		LoginEnabled:                  false,
		RegistrationEnabled:           true,
		OAuthSignupEnabled:            true,
		APIKeyPageConfirmationEnabled: true,
		APIKeyCreateEnabled:           true,
		BlockedCountryCodes:           []string{"CN"},
		UnknownRegionPolicy:           "allow",
		ConfirmationRevision:          "api-key-password-confirmation-test",
		ConfirmationFrequency:         "once_per_revision",
		ConfirmationIntervalHours:     24,
	}
	regionalValues, err := config.ConfigToMap(&regionalSettings)
	require.NoError(t, err)
	require.NoError(t, system_setting.UpdateRegionalRestrictionSettings(regionalValues))

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.Log{}))
	model.DB = db
	model.LOG_DB = db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.SessionSecret = "api-key-password-confirmation-session-secret"

	storedPassword := ""
	if rawPassword != "" {
		storedPassword, err = common.Password2Hash(rawPassword)
		require.NoError(t, err)
	}
	user := &model.User{
		Username:    "api-key-password-user",
		Password:    storedPassword,
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 3,
	}
	require.NoError(t, db.Create(user).Error)
	identity := service.AuthIdentity{
		UserID:          user.Id,
		SessionID:       "api-key-password-session",
		UserAuthVersion: user.AuthVersion,
		SessionVersion:  2,
	}

	t.Cleanup(func() {
		previousRegionalValues, cleanupErr := config.ConfigToMap(&previousRegionalSettings)
		require.NoError(t, cleanupErr)
		require.NoError(t, system_setting.UpdateRegionalRestrictionSettings(previousRegionalValues))
		model.DB = previousDB
		model.LOG_DB = previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		common.RedisEnabled = previousRedisEnabled
		common.SessionSecret = previousSessionSecret
		gin.SetMode(previousGinMode)
		sqlDB, cleanupErr := db.DB()
		if cleanupErr == nil {
			require.NoError(t, sqlDB.Close())
		}
	})

	return db, identity
}

func newAPIKeyPasswordConfirmationContext(t *testing.T, method string, target string, body any, identity service.AuthIdentity) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()

	payload, err := common.Marshal(body)
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(method, target, bytes.NewReader(payload))
	context.Request.Header.Set("Content-Type", "application/json")
	context.Set("id", identity.UserID)
	context.Set("session_id", identity.SessionID)
	context.Set("auth_version", identity.UserAuthVersion)
	context.Set("session_version", identity.SessionVersion)
	return context, recorder
}

func decodeAPIKeyPasswordConfirmationResponse(t *testing.T, recorder *httptest.ResponseRecorder) apiKeyPasswordConfirmationResponse {
	t.Helper()

	var response apiKeyPasswordConfirmationResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}

func setAPIKeyPasswordConfirmationCountry(request *http.Request, countryCode string) {
	request.Header.Set(regionalRestrictionCountryHeader, countryCode)
	request.Header.Set(regionalRestrictionSecretHeader, apiKeyPasswordConfirmationTestSecret)
}

func TestUniversalVerifyPasswordIssuesAPIKeyCreateProof(t *testing.T) {
	_, identity := setupAPIKeyPasswordConfirmationTest(t, "CurrentPassword123")
	context, recorder := newAPIKeyPasswordConfirmationContext(t, http.MethodPost, "/api/verify", map[string]any{
		"method":   secureVerificationMethodPassword,
		"password": "CurrentPassword123",
		"scope":    securityProofScopeAPIKeyCreate,
	}, identity)

	UniversalVerify(context)

	response := decodeAPIKeyPasswordConfirmationResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	require.NotEmpty(t, response.Data.ProofToken)
	assert.Positive(t, response.Data.ExpiresAt)
	assert.Equal(t, secureVerificationMethodPassword, response.Data.Method)
	assert.Equal(t, securityProofScopeAPIKeyCreate, response.Data.Scope)
	method, err := service.VerifySecurityProof(
		response.Data.ProofToken,
		identity,
		securityProofScopeAPIKeyCreate,
		[]string{secureVerificationMethodPassword},
	)
	require.NoError(t, err)
	assert.Equal(t, secureVerificationMethodPassword, method)
}

func TestUniversalVerifyPasswordRejectsInvalidCredentialsWithoutProof(t *testing.T) {
	tests := []struct {
		name              string
		storedPassword    string
		submittedPassword string
	}{
		{name: "wrong password", storedPassword: "CurrentPassword123", submittedPassword: "WrongPassword123"},
		{name: "passwordless account", submittedPassword: "AnyPassword123"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, identity := setupAPIKeyPasswordConfirmationTest(t, test.storedPassword)
			context, recorder := newAPIKeyPasswordConfirmationContext(t, http.MethodPost, "/api/verify", map[string]any{
				"method":   secureVerificationMethodPassword,
				"password": test.submittedPassword,
				"scope":    securityProofScopeAPIKeyCreate,
			}, identity)

			UniversalVerify(context)

			response := decodeAPIKeyPasswordConfirmationResponse(t, recorder)
			assert.False(t, response.Success)
			assert.NotEmpty(t, response.Message)
			assert.Empty(t, response.Data.ProofToken)
		})
	}
}

func TestUniversalVerifyPasswordRejectsNonAPIKeyScope(t *testing.T) {
	_, identity := setupAPIKeyPasswordConfirmationTest(t, "CurrentPassword123")
	context, recorder := newAPIKeyPasswordConfirmationContext(t, http.MethodPost, "/api/verify", map[string]any{
		"method":   secureVerificationMethodPassword,
		"password": "CurrentPassword123",
		"scope":    securityProofScopeChannelKeyRead,
	}, identity)

	UniversalVerify(context)

	response := decodeAPIKeyPasswordConfirmationResponse(t, recorder)
	assert.False(t, response.Success)
	assert.Empty(t, response.Data.ProofToken)
}

func TestAddTokenRequiresPasswordProofBeforeDatabaseMutation(t *testing.T) {
	db, identity := setupAPIKeyPasswordConfirmationTest(t, "CurrentPassword123")
	context, recorder := newAPIKeyPasswordConfirmationContext(t, http.MethodPost, "/api/token/", map[string]any{
		"name":            "missing-password-proof",
		"expired_time":    -1,
		"remain_quota":    0,
		"unlimited_quota": true,
		"group":           "default",
	}, identity)
	setAPIKeyPasswordConfirmationCountry(context.Request, "US")

	AddToken(context)

	response := decodeAPIKeyPasswordConfirmationResponse(t, recorder)
	assert.Equal(t, http.StatusForbidden, recorder.Code)
	assert.False(t, response.Success)
	assert.Equal(t, "SECURITY_PROOF_REQUIRED", response.Code)
	var tokenCount int64
	require.NoError(t, db.Model(&model.Token{}).Count(&tokenCount).Error)
	assert.Zero(t, tokenCount)
}

func TestAddTokenAcceptsPasswordProofBoundToCurrentSession(t *testing.T) {
	db, identity := setupAPIKeyPasswordConfirmationTest(t, "CurrentPassword123")
	verifyContext, verifyRecorder := newAPIKeyPasswordConfirmationContext(t, http.MethodPost, "/api/verify", map[string]any{
		"method":   secureVerificationMethodPassword,
		"password": "CurrentPassword123",
		"scope":    securityProofScopeAPIKeyCreate,
	}, identity)
	UniversalVerify(verifyContext)
	verifyResponse := decodeAPIKeyPasswordConfirmationResponse(t, verifyRecorder)
	require.True(t, verifyResponse.Success, verifyResponse.Message)
	require.NotEmpty(t, verifyResponse.Data.ProofToken)

	tokenRequest := map[string]any{
		"name":            "password-confirmed-key",
		"expired_time":    -1,
		"remain_quota":    0,
		"unlimited_quota": true,
		"group":           "default",
	}
	wrongSessionIdentity := identity
	wrongSessionIdentity.SessionID = "different-session"
	wrongSessionContext, wrongSessionRecorder := newAPIKeyPasswordConfirmationContext(t, http.MethodPost, "/api/token/", tokenRequest, wrongSessionIdentity)
	wrongSessionContext.Request.Header.Set("X-Security-Proof", verifyResponse.Data.ProofToken)
	setAPIKeyPasswordConfirmationCountry(wrongSessionContext.Request, "US")
	AddToken(wrongSessionContext)
	wrongSessionResponse := decodeAPIKeyPasswordConfirmationResponse(t, wrongSessionRecorder)
	assert.Equal(t, http.StatusForbidden, wrongSessionRecorder.Code)
	assert.Equal(t, "SECURITY_PROOF_INVALID", wrongSessionResponse.Code)

	context, recorder := newAPIKeyPasswordConfirmationContext(t, http.MethodPost, "/api/token/", tokenRequest, identity)
	context.Request.Header.Set("X-Security-Proof", verifyResponse.Data.ProofToken)
	setAPIKeyPasswordConfirmationCountry(context.Request, "US")
	AddToken(context)

	response := decodeAPIKeyPasswordConfirmationResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var tokens []model.Token
	require.NoError(t, db.Find(&tokens).Error)
	require.Len(t, tokens, 1)
	assert.Equal(t, identity.UserID, tokens[0].UserId)
	assert.Equal(t, "password-confirmed-key", tokens[0].Name)
}
