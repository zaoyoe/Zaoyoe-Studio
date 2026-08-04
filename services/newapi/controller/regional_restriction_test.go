package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const regionalRestrictionTestSecret = "7c9a580c6cf24144478f297ba86198451917329310486ab940782207e00df97a"

func configureRegionalRestrictionTest(t *testing.T, update func(*system_setting.RegionalRestrictionSettings)) {
	t.Helper()
	require.NoError(t, i18n.Init())
	t.Setenv(regionalRestrictionSecretEnv, regionalRestrictionTestSecret)
	original := system_setting.GetRegionalRestrictionSettings()
	settings := system_setting.RegionalRestrictionSettings{
		Enabled:                       true,
		LoginEnabled:                  true,
		RegistrationEnabled:           true,
		OAuthSignupEnabled:            true,
		APIKeyPageConfirmationEnabled: true,
		APIKeyCreateEnabled:           true,
		BlockedCountryCodes:           []string{"CN"},
		UnknownRegionPolicy:           "allow",
		ConfirmationRevision:          "2026-06-17",
		ConfirmationFrequency:         "once_per_revision",
		ConfirmationIntervalHours:     24,
	}
	if update != nil {
		update(&settings)
	}
	require.NoError(t, applyRegionalRestrictionSettings(settings))
	t.Cleanup(func() {
		require.NoError(t, applyRegionalRestrictionSettings(original))
	})
}

func applyRegionalRestrictionSettings(settings system_setting.RegionalRestrictionSettings) error {
	values, err := config.ConfigToMap(&settings)
	if err != nil {
		return err
	}
	return system_setting.UpdateRegionalRestrictionSettings(values)
}

func newRegionalRestrictionContext(headers map[string]string) *gin.Context {
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	for key, value := range headers {
		context.Request.Header.Set(key, value)
	}
	return context
}

func trustedRegionalRestrictionHeaders(countryCode string) map[string]string {
	return map[string]string{
		regionalRestrictionCountryHeader: countryCode,
		regionalRestrictionSecretHeader:  regionalRestrictionTestSecret,
	}
}

func setTrustedRegionalRestrictionHeaders(request *http.Request, countryCode string) {
	request.Header.Set(regionalRestrictionCountryHeader, countryCode)
	request.Header.Set(regionalRestrictionSecretHeader, regionalRestrictionTestSecret)
}

func TestRegionalRestrictionCountryHeaderTrustBoundary(t *testing.T) {
	tests := []struct {
		name        string
		envSecret   string
		headers     map[string]string
		wantCode    string
		wantUnknown bool
	}{
		{
			name:        "missing application secret is unknown",
			headers:     trustedRegionalRestrictionHeaders("CN"),
			wantUnknown: true,
		},
		{
			name:        "missing request secret is unknown",
			envSecret:   regionalRestrictionTestSecret,
			headers:     map[string]string{regionalRestrictionCountryHeader: "CN"},
			wantUnknown: true,
		},
		{
			name:      "weak configured secret is unknown",
			envSecret: "too-short",
			headers: map[string]string{
				regionalRestrictionCountryHeader: "CN",
				regionalRestrictionSecretHeader:  "too-short",
			},
			wantUnknown: true,
		},
		{
			name:      "wrong request secret is unknown",
			envSecret: regionalRestrictionTestSecret,
			headers: map[string]string{
				regionalRestrictionCountryHeader: "CN",
				regionalRestrictionSecretHeader:  "incorrect-secret",
			},
			wantUnknown: true,
		},
		{
			name:      "matching secret accepts dedicated country header",
			envSecret: regionalRestrictionTestSecret,
			headers:   trustedRegionalRestrictionHeaders(" cn "),
			wantCode:  "CN",
		},
		{
			name:        "provider placeholder is unknown",
			envSecret:   regionalRestrictionTestSecret,
			headers:     trustedRegionalRestrictionHeaders("XX"),
			wantUnknown: true,
		},
		{
			name:        "invalid dedicated country is unknown",
			envSecret:   regionalRestrictionTestSecret,
			headers:     trustedRegionalRestrictionHeaders("USA"),
			wantUnknown: true,
		},
		{
			name:      "legacy provider headers are never trusted",
			envSecret: regionalRestrictionTestSecret,
			headers: map[string]string{
				regionalRestrictionSecretHeader: regionalRestrictionTestSecret,
				"CF-IPCountry":                  "CN",
				"X-Vercel-IP-Country":           "CN",
				"X-Appengine-Country":           "CN",
				"CloudFront-Viewer-Country":     "CN",
			},
			wantUnknown: true,
		},
		{
			name:      "dedicated country wins over spoofed legacy headers",
			envSecret: regionalRestrictionTestSecret,
			headers: map[string]string{
				regionalRestrictionCountryHeader: "JP",
				regionalRestrictionSecretHeader:  regionalRestrictionTestSecret,
				"CF-IPCountry":                   "CN",
				"X-Vercel-IP-Country":            "CN",
			},
			wantCode: "JP",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv(regionalRestrictionSecretEnv, test.envSecret)
			countryCode, unknown := regionalRestrictionRequestCountryCode(newRegionalRestrictionContext(test.headers))
			assert.Equal(t, test.wantCode, countryCode)
			assert.Equal(t, test.wantUnknown, unknown)
		})
	}
}

func TestEvaluateRegionalRestrictionPolicy(t *testing.T) {
	configureRegionalRestrictionTest(t, nil)

	tests := []struct {
		name        string
		headers     map[string]string
		wantBlocked bool
		wantCountry string
		wantUnknown bool
	}{
		{name: "blocked country", headers: trustedRegionalRestrictionHeaders("CN"), wantBlocked: true, wantCountry: "CN"},
		{name: "allowed country", headers: trustedRegionalRestrictionHeaders("US"), wantCountry: "US"},
		{name: "nonblocked VPN exit remains allowed", headers: trustedRegionalRestrictionHeaders("JP"), wantCountry: "JP"},
		{name: "unknown defaults to allowed", wantCountry: "UNKNOWN", wantUnknown: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := evaluateRegionalRestriction(newRegionalRestrictionContext(test.headers), regionalRestrictionScopeAPIKeyCreate)
			assert.Equal(t, test.wantBlocked, result.Blocked)
			assert.Equal(t, test.wantCountry, result.CountryCode)
			assert.Equal(t, test.wantUnknown, result.UnknownRegion)
		})
	}
}

func TestEvaluateLoginSessionRegionalRestrictionPolicy(t *testing.T) {
	configureRegionalRestrictionTest(t, nil)

	tests := []struct {
		name        string
		headers     map[string]string
		scope       string
		wantBlocked bool
	}{
		{name: "blocked country is denied", headers: trustedRegionalRestrictionHeaders("CN"), scope: regionalRestrictionScopeLogin, wantBlocked: true},
		{name: "nonblocked VPN exit is allowed", headers: trustedRegionalRestrictionHeaders("JP"), scope: regionalRestrictionScopeLogin},
		{name: "unknown region defaults to allowed", scope: regionalRestrictionScopeLogin},
		{name: "unrelated session scope is unaffected", headers: trustedRegionalRestrictionHeaders("CN"), scope: "refresh"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := evaluateRegionalRestriction(newRegionalRestrictionContext(test.headers), test.scope)
			assert.Equal(t, test.wantBlocked, result.Blocked)
		})
	}

	settings := system_setting.GetRegionalRestrictionSettings()
	settings.UnknownRegionPolicy = "deny"
	require.NoError(t, applyRegionalRestrictionSettings(settings))
	unknownDenied := evaluateRegionalRestriction(
		newRegionalRestrictionContext(nil),
		regionalRestrictionScopeLogin,
	)
	assert.True(t, unknownDenied.Blocked)

	settings.LoginEnabled = false
	require.NoError(t, applyRegionalRestrictionSettings(settings))
	result := evaluateRegionalRestriction(
		newRegionalRestrictionContext(trustedRegionalRestrictionHeaders("CN")),
		regionalRestrictionScopeLogin,
	)
	assert.False(t, result.Blocked)
}

func TestPasswordLoginRegionalRestrictionUsesRequestLanguage(t *testing.T) {
	configureRegionalRestrictionTest(t, nil)
	originalPasswordLoginEnabled := common.PasswordLoginEnabled
	common.PasswordLoginEnabled = true
	t.Cleanup(func() {
		common.PasswordLoginEnabled = originalPasswordLoginEnabled
	})

	tests := []struct {
		name        string
		language    string
		wantMessage string
	}{
		{
			name:        "english",
			language:    "en-US",
			wantMessage: "The service is not offered to users located in restricted regions, including mainland China.",
		},
		{
			name:        "simplified chinese",
			language:    "zh-CN",
			wantMessage: "本服务不向位于受限制地区的用户提供，包括中国大陆。",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest(
				http.MethodPost,
				"/api/user/login",
				strings.NewReader(`{"username":"existing-user","password":"secret"}`),
			)
			context.Request.Header.Set("Content-Type", "application/json")
			context.Request.Header.Set("Accept-Language", test.language)
			setTrustedRegionalRestrictionHeaders(context.Request, "CN")

			Login(context)

			require.Equal(t, http.StatusForbidden, recorder.Code)
			var response struct {
				Success bool                          `json:"success"`
				Code    string                        `json:"code"`
				Reason  string                        `json:"reason"`
				Message string                        `json:"message"`
				Data    RegionalRestrictionEvaluation `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.False(t, response.Success)
			assert.Equal(t, regionalRestrictionReason, response.Code)
			assert.Equal(t, regionalRestrictionReason, response.Reason)
			assert.Equal(t, test.wantMessage, response.Message)
			assert.Equal(t, test.wantMessage, response.Data.Message)
			assert.True(t, response.Data.Blocked)
			assert.Equal(t, "CN", response.Data.CountryCode)
		})
	}
}

func TestSetupLoginRegionalRestrictionBlocksBeforeSessionCreation(t *testing.T) {
	configureRegionalRestrictionTest(t, nil)
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.UserSession{}))
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
	})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/oauth/github", nil)
	setTrustedRegionalRestrictionHeaders(context.Request, "CN")

	setupLogin(&model.User{Id: 1, Status: common.UserStatusEnabled}, context)

	require.Equal(t, http.StatusForbidden, recorder.Code)
	assert.Contains(t, recorder.Body.String(), regionalRestrictionReason)
	var sessionCount int64
	require.NoError(t, db.Model(&model.UserSession{}).Count(&sessionCount).Error)
	assert.Zero(t, sessionCount)
}

func TestEvaluateRegionalRestrictionUnknownDenyAndDisabledScopes(t *testing.T) {
	configureRegionalRestrictionTest(t, func(settings *system_setting.RegionalRestrictionSettings) {
		settings.UnknownRegionPolicy = "deny"
	})

	unknown := evaluateRegionalRestriction(newRegionalRestrictionContext(nil), regionalRestrictionScopeAPIKeyCreate)
	assert.True(t, unknown.Blocked)
	assert.True(t, unknown.UnknownRegion)

	settings := system_setting.GetRegionalRestrictionSettings()
	settings.APIKeyCreateEnabled = false
	require.NoError(t, applyRegionalRestrictionSettings(settings))
	scopeDisabled := evaluateRegionalRestriction(newRegionalRestrictionContext(trustedRegionalRestrictionHeaders("CN")), regionalRestrictionScopeAPIKeyCreate)
	assert.False(t, scopeDisabled.Blocked)

	settings.Enabled = false
	settings.APIKeyCreateEnabled = true
	require.NoError(t, applyRegionalRestrictionSettings(settings))
	masterDisabled := evaluateRegionalRestriction(newRegionalRestrictionContext(trustedRegionalRestrictionHeaders("CN")), regionalRestrictionScopeAPIKeyCreate)
	assert.False(t, masterDisabled.Blocked)
}

func TestRegionalRestrictionStatusReturnsOKWhenBlocked(t *testing.T) {
	configureRegionalRestrictionTest(t, nil)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/token/regional-restriction?scope=api_key_create", nil)
	setTrustedRegionalRestrictionHeaders(context.Request, "CN")

	GetRegionalRestrictionStatus(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool                          `json:"success"`
		Message string                        `json:"message"`
		Data    RegionalRestrictionEvaluation `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.Empty(t, response.Message)
	assert.True(t, response.Data.Blocked)
	assert.Equal(t, "CN", response.Data.CountryCode)
}

func TestRegionalRestrictionStatusInvalidScopeFallsBackToAPIKeyPage(t *testing.T) {
	configureRegionalRestrictionTest(t, func(settings *system_setting.RegionalRestrictionSettings) {
		settings.APIKeyCreateEnabled = false
		settings.APIKeyPageConfirmationEnabled = true
	})
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/token/regional-restriction?scope=invalid", nil)
	setTrustedRegionalRestrictionHeaders(context.Request, "CN")

	GetRegionalRestrictionStatus(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool                          `json:"success"`
		Data    RegionalRestrictionEvaluation `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.True(t, response.Data.Blocked)
	assert.True(t, response.Data.ConfirmationRequired)
}

func TestGetStatusExposesRegionalRestrictionSettings(t *testing.T) {
	configureRegionalRestrictionTest(t, func(settings *system_setting.RegionalRestrictionSettings) {
		settings.BlockedCountryCodes = []string{"CN", "HK"}
		settings.UnknownRegionPolicy = "deny"
		settings.ConfirmationFrequency = "interval"
		settings.ConfirmationIntervalHours = 72
	})
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)

	GetStatus(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Enabled                   bool     `json:"regional_restriction_enabled"`
			RegistrationEnabled       bool     `json:"regional_restriction_registration_enabled"`
			OAuthSignupEnabled        bool     `json:"regional_restriction_oauth_signup_enabled"`
			APIKeyPageEnabled         bool     `json:"regional_restriction_api_key_page_confirmation_enabled"`
			APIKeyCreateEnabled       bool     `json:"regional_restriction_api_key_create_enabled"`
			BlockedCountryCodes       []string `json:"regional_restriction_blocked_country_codes"`
			UnknownRegionPolicy       string   `json:"regional_restriction_unknown_region_policy"`
			ConfirmationRevision      string   `json:"regional_restriction_confirmation_revision"`
			ConfirmationFrequency     string   `json:"regional_restriction_confirmation_frequency"`
			ConfirmationIntervalHours int      `json:"regional_restriction_confirmation_interval_hours"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	assert.True(t, response.Data.Enabled)
	assert.True(t, response.Data.RegistrationEnabled)
	assert.True(t, response.Data.OAuthSignupEnabled)
	assert.True(t, response.Data.APIKeyPageEnabled)
	assert.True(t, response.Data.APIKeyCreateEnabled)
	assert.Equal(t, []string{"CN", "HK"}, response.Data.BlockedCountryCodes)
	assert.Equal(t, "deny", response.Data.UnknownRegionPolicy)
	assert.Equal(t, "2026-06-17", response.Data.ConfirmationRevision)
	assert.Equal(t, "interval", response.Data.ConfirmationFrequency)
	assert.Equal(t, 72, response.Data.ConfirmationIntervalHours)
}

func TestRegionalRestrictionBlocksRegistrationBeforeRequestParsing(t *testing.T) {
	configureRegionalRestrictionTest(t, nil)
	originalRegisterEnabled := common.RegisterEnabled
	originalPasswordRegisterEnabled := common.PasswordRegisterEnabled
	common.RegisterEnabled = true
	common.PasswordRegisterEnabled = true
	t.Cleanup(func() {
		common.RegisterEnabled = originalRegisterEnabled
		common.PasswordRegisterEnabled = originalPasswordRegisterEnabled
	})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/user/register", strings.NewReader("not-json"))
	setTrustedRegionalRestrictionHeaders(context.Request, "CN")
	Register(context)

	assertRegionalRestrictionResponse(t, recorder)
}

func TestRegionalRestrictionBlocksRegistrationVerificationEmail(t *testing.T) {
	configureRegionalRestrictionTest(t, nil)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/verification?email=invalid", nil)
	setTrustedRegionalRestrictionHeaders(context.Request, "CN")
	SendEmailVerification(context)

	assertRegionalRestrictionResponse(t, recorder)
}

func TestRegionalRestrictionAllowsExistingUserVerificationEmail(t *testing.T) {
	configureRegionalRestrictionTest(t, nil)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/verification?email=invalid", nil)
	setTrustedRegionalRestrictionHeaders(context.Request, "CN")
	context.Set("id", 42)
	SendEmailVerification(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	assert.NotEqual(t, regionalRestrictionReason, response.Code)
}

type regionalRestrictionOAuthProvider struct {
	existing bool
}

func (*regionalRestrictionOAuthProvider) GetName() string { return "Regional OAuth" }
func (*regionalRestrictionOAuthProvider) IsEnabled() bool { return true }
func (*regionalRestrictionOAuthProvider) ExchangeToken(context.Context, string, *gin.Context) (*oauth.OAuthToken, error) {
	return &oauth.OAuthToken{}, nil
}
func (*regionalRestrictionOAuthProvider) GetUserInfo(context.Context, *oauth.OAuthToken) (*oauth.OAuthUser, error) {
	return &oauth.OAuthUser{}, nil
}
func (provider *regionalRestrictionOAuthProvider) IsUserIDTaken(string) bool {
	return provider.existing
}
func (*regionalRestrictionOAuthProvider) FillUserByProviderID(user *model.User, _ string) error {
	user.Id = 42
	user.Status = common.UserStatusEnabled
	return nil
}
func (*regionalRestrictionOAuthProvider) SetProviderUserID(*model.User, string) {}
func (*regionalRestrictionOAuthProvider) GetProviderPrefix() string             { return "region_" }

func TestRegionalRestrictionAllowsExistingOAuthIdentityAndBlocksNewSignup(t *testing.T) {
	configureRegionalRestrictionTest(t, nil)
	originalRegisterEnabled := common.RegisterEnabled
	common.RegisterEnabled = true
	t.Cleanup(func() { common.RegisterEnabled = originalRegisterEnabled })
	context := newRegionalRestrictionContext(trustedRegionalRestrictionHeaders("CN"))
	oauthUser := &oauth.OAuthUser{ProviderUserID: "external-user"}

	existingUser, err := findOrCreateOAuthUser(context, &regionalRestrictionOAuthProvider{existing: true}, oauthUser, "")
	require.NoError(t, err)
	assert.Equal(t, 42, existingUser.Id)

	_, err = findOrCreateOAuthUser(context, &regionalRestrictionOAuthProvider{}, oauthUser, "")
	var restrictionError *RegionalRestrictionError
	require.ErrorAs(t, err, &restrictionError)
	assert.Equal(t, regionalRestrictionScopeOAuthSignup, restrictionError.Scope)
}

func TestOAuthHandlerReturnsRegionalRestrictionForbiddenForNewIdentity(t *testing.T) {
	configureRegionalRestrictionTest(t, nil)
	previousDB := model.DB
	previousDatabaseType := common.MainDatabaseType()
	previousRegisterEnabled := common.RegisterEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.AuthFlow{}))
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RegisterEnabled = true
	providerName := "regional-restriction-test"
	oauth.Register(providerName, &regionalRestrictionOAuthProvider{})
	t.Cleanup(func() {
		oauth.Unregister(providerName)
		model.DB = previousDB
		common.SetMainDatabaseType(previousDatabaseType)
		common.RegisterEnabled = previousRegisterEnabled
	})
	flowToken, _, err := model.CreateAuthFlow(model.AuthFlowCreate{
		Purpose:   model.AuthFlowPurposeOAuth,
		Provider:  providerName,
		Intent:    model.AuthFlowIntentLogin,
		Payload:   `{}`,
		ExpiresAt: time.Now().Add(oauthAuthFlowTTL),
	})
	require.NoError(t, err)
	router := gin.New()
	router.GET("/api/oauth/:provider", HandleOAuth)
	request := httptest.NewRequest(http.MethodGet, "/api/oauth/"+providerName+"?state="+flowToken+"&code=test", nil)
	setTrustedRegionalRestrictionHeaders(request, "CN")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	assertRegionalRestrictionResponse(t, recorder)
}

func TestRegionalRestrictionBlocksAPIKeyCreationBeforeMutation(t *testing.T) {
	configureRegionalRestrictionTest(t, nil)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/token/", strings.NewReader("not-json"))
	setTrustedRegionalRestrictionHeaders(context.Request, "CN")
	AddToken(context)

	assertRegionalRestrictionResponse(t, recorder)
}

func TestRegistrationSkipsBlockedAutomaticDefaultToken(t *testing.T) {
	configureRegionalRestrictionTest(t, func(settings *system_setting.RegionalRestrictionSettings) {
		settings.RegistrationEnabled = false
	})
	previousDB := model.DB
	previousDatabaseType := common.MainDatabaseType()
	previousRedisEnabled := common.RedisEnabled
	previousGenerateDefaultToken := constant.GenerateDefaultToken
	previousRegisterEnabled := common.RegisterEnabled
	previousPasswordRegisterEnabled := common.PasswordRegisterEnabled
	previousEmailVerificationEnabled := common.EmailVerificationEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}))
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	constant.GenerateDefaultToken = true
	common.RegisterEnabled = true
	common.PasswordRegisterEnabled = true
	common.EmailVerificationEnabled = false
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousDatabaseType)
		common.RedisEnabled = previousRedisEnabled
		constant.GenerateDefaultToken = previousGenerateDefaultToken
		common.RegisterEnabled = previousRegisterEnabled
		common.PasswordRegisterEnabled = previousPasswordRegisterEnabled
		common.EmailVerificationEnabled = previousEmailVerificationEnabled
	})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/user/register", strings.NewReader(`{"username":"blocked-token-user","password":"password123"}`))
	context.Request.Header.Set("Content-Type", "application/json")
	setTrustedRegionalRestrictionHeaders(context.Request, "CN")
	Register(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, response.Message)
	var userCount int64
	require.NoError(t, db.Model(&model.User{}).Count(&userCount).Error)
	assert.EqualValues(t, 1, userCount)
	var tokenCount int64
	require.NoError(t, db.Model(&model.Token{}).Count(&tokenCount).Error)
	assert.Zero(t, tokenCount)
}

func assertRegionalRestrictionResponse(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	require.Equal(t, http.StatusForbidden, recorder.Code)
	var response struct {
		Success bool                          `json:"success"`
		Code    string                        `json:"code"`
		Reason  string                        `json:"reason"`
		Message string                        `json:"message"`
		Data    RegionalRestrictionEvaluation `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	assert.Equal(t, regionalRestrictionReason, response.Code)
	assert.Equal(t, regionalRestrictionReason, response.Reason)
	assert.Equal(t, regionalRestrictionMessage, response.Message)
	assert.True(t, response.Data.Blocked)
}
