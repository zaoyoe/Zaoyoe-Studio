//go:build unit

package handler

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type regionalRestrictionSettingRepoStub struct {
	values map[string]string
}

func (s *regionalRestrictionSettingRepoStub) Get(ctx context.Context, key string) (*service.Setting, error) {
	panic("unexpected Get call")
}

func (s *regionalRestrictionSettingRepoStub) GetValue(ctx context.Context, key string) (string, error) {
	panic("unexpected GetValue call")
}

func (s *regionalRestrictionSettingRepoStub) Set(ctx context.Context, key, value string) error {
	panic("unexpected Set call")
}

func (s *regionalRestrictionSettingRepoStub) GetMultiple(ctx context.Context, keys []string) (map[string]string, error) {
	panic("unexpected GetMultiple call")
}

func (s *regionalRestrictionSettingRepoStub) SetMultiple(ctx context.Context, settings map[string]string) error {
	panic("unexpected SetMultiple call")
}

func (s *regionalRestrictionSettingRepoStub) GetAll(ctx context.Context) (map[string]string, error) {
	out := make(map[string]string, len(s.values))
	for key, value := range s.values {
		out[key] = value
	}
	return out, nil
}

func (s *regionalRestrictionSettingRepoStub) Delete(ctx context.Context, key string) error {
	panic("unexpected Delete call")
}

func newRegionalRestrictionTestContext(country string) *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/test", nil)
	if country != "" {
		c.Request.Header.Set("CF-IPCountry", country)
	}
	return c
}

func newRegionalRestrictionSettingService(values map[string]string) *service.SettingService {
	base := map[string]string{
		service.SettingKeyRegionalRestrictionEnabled:                   "true",
		service.SettingKeyRegionalRestrictionRegistrationEnabled:       "true",
		service.SettingKeyRegionalRestrictionLoginEnabled:              "true",
		service.SettingKeyRegionalRestrictionOAuthSignupEnabled:        "true",
		service.SettingKeyRegionalRestrictionAPIKeyPageConfirmation:    "true",
		service.SettingKeyRegionalRestrictionAPIKeyCreateEnabled:       "true",
		service.SettingKeyRegionalRestrictionBlockedCountryCodes:       `["CN"]`,
		service.SettingKeyRegionalRestrictionUnknownRegionPolicy:       "allow",
		service.SettingKeyRegionalRestrictionConfirmationRevision:      "2026-06-17",
		service.SettingKeyRegionalRestrictionConfirmationFrequency:     "once_per_revision",
		service.SettingKeyRegionalRestrictionConfirmationIntervalHours: "24",
	}
	for key, value := range values {
		base[key] = value
	}
	return service.NewSettingService(&regionalRestrictionSettingRepoStub{values: base}, &config.Config{})
}

func TestEvaluateRegionalRestrictionBlocksLoginWhenLoginScopeEnabled(t *testing.T) {
	settingSvc := newRegionalRestrictionSettingService(nil)

	result, err := evaluateRegionalRestriction(context.Background(), newRegionalRestrictionTestContext("CN"), settingSvc, regionalRestrictionScopeLogin)

	require.Error(t, err)
	require.Equal(t, regionalRestrictionReason, infraerrors.Reason(err))
	require.True(t, result.Enabled)
	require.True(t, result.Blocked)
	require.Equal(t, "CN", result.CountryCode)
}

func TestEvaluateRegionalRestrictionDefaultsLoginScopeToEnabledWhenSettingMissing(t *testing.T) {
	settingSvc := newRegionalRestrictionSettingService(map[string]string{
		service.SettingKeyRegionalRestrictionLoginEnabled: "",
	})

	result, err := evaluateRegionalRestriction(context.Background(), newRegionalRestrictionTestContext("CN"), settingSvc, regionalRestrictionScopeLogin)

	require.Error(t, err)
	require.Equal(t, regionalRestrictionReason, infraerrors.Reason(err))
	require.True(t, result.Enabled)
	require.True(t, result.Blocked)
	require.Equal(t, "CN", result.CountryCode)
}

func TestEvaluateRegionalRestrictionAllowsLoginWhenScopeExplicitlyDisabled(t *testing.T) {
	settingSvc := newRegionalRestrictionSettingService(map[string]string{
		service.SettingKeyRegionalRestrictionLoginEnabled: "false",
	})

	result, err := evaluateRegionalRestriction(context.Background(), newRegionalRestrictionTestContext("CN"), settingSvc, regionalRestrictionScopeLogin)

	require.NoError(t, err)
	require.True(t, result.Enabled)
	require.False(t, result.Blocked)
}

func TestEvaluateRegionalRestrictionBlocksConfiguredCountryOnlyForEnabledScope(t *testing.T) {
	settingSvc := newRegionalRestrictionSettingService(nil)

	result, err := evaluateRegionalRestriction(context.Background(), newRegionalRestrictionTestContext("CN"), settingSvc, regionalRestrictionScopeAPIKeyCreate)

	require.Error(t, err)
	require.Equal(t, regionalRestrictionReason, infraerrors.Reason(err))
	require.True(t, result.Enabled)
	require.True(t, result.Blocked)
	require.Equal(t, "CN", result.CountryCode)
	require.Equal(t, "once_per_revision", result.ConfirmationFrequency)
	require.Equal(t, 24, result.ConfirmationIntervalHours)
}

func TestEvaluateRegionalRestrictionReturnsPromptFrequencySettings(t *testing.T) {
	settingSvc := newRegionalRestrictionSettingService(map[string]string{
		service.SettingKeyRegionalRestrictionConfirmationFrequency:     "interval",
		service.SettingKeyRegionalRestrictionConfirmationIntervalHours: "72",
	})

	result, err := evaluateRegionalRestriction(context.Background(), newRegionalRestrictionTestContext("US"), settingSvc, regionalRestrictionScopeAPIKeyPage)

	require.NoError(t, err)
	require.True(t, result.Enabled)
	require.True(t, result.ConfirmationRequired)
	require.False(t, result.Blocked)
	require.Equal(t, "interval", result.ConfirmationFrequency)
	require.Equal(t, 72, result.ConfirmationIntervalHours)
}

func TestEvaluateRegionalRestrictionAllowsVPNExitCountry(t *testing.T) {
	settingSvc := newRegionalRestrictionSettingService(nil)

	result, err := evaluateRegionalRestriction(context.Background(), newRegionalRestrictionTestContext("US"), settingSvc, regionalRestrictionScopeAPIKeyCreate)

	require.NoError(t, err)
	require.True(t, result.Enabled)
	require.False(t, result.Blocked)
	require.Equal(t, "US", result.CountryCode)
}

func TestEvaluateRegionalRestrictionAllowsUnknownRegionByDefault(t *testing.T) {
	settingSvc := newRegionalRestrictionSettingService(nil)

	result, err := evaluateRegionalRestriction(context.Background(), newRegionalRestrictionTestContext(""), settingSvc, regionalRestrictionScopeAPIKeyCreate)

	require.NoError(t, err)
	require.True(t, result.UnknownRegion)
	require.False(t, result.Blocked)
}

func TestEvaluateRegionalRestrictionScopeSwitchDoesNotBlockDisabledScope(t *testing.T) {
	settingSvc := newRegionalRestrictionSettingService(map[string]string{
		service.SettingKeyRegionalRestrictionAPIKeyCreateEnabled: "false",
	})

	result, err := evaluateRegionalRestriction(context.Background(), newRegionalRestrictionTestContext("CN"), settingSvc, regionalRestrictionScopeAPIKeyCreate)

	require.NoError(t, err)
	require.True(t, result.Enabled)
	require.False(t, result.Blocked)
}
