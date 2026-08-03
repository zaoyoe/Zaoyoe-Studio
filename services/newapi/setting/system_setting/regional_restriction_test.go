package system_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRegionalRestrictionSettingsDefaults(t *testing.T) {
	settings := GetRegionalRestrictionSettings()

	assert.False(t, settings.Enabled)
	assert.False(t, settings.RegistrationEnabled)
	assert.False(t, settings.OAuthSignupEnabled)
	assert.False(t, settings.APIKeyPageConfirmationEnabled)
	assert.False(t, settings.APIKeyCreateEnabled)
	assert.Equal(t, []string{"CN"}, settings.BlockedCountryCodes)
	assert.Equal(t, "allow", settings.UnknownRegionPolicy)
	assert.Equal(t, "2026-06-17", settings.ConfirmationRevision)
	assert.Equal(t, "once_per_revision", settings.ConfirmationFrequency)
	assert.Equal(t, 24, settings.ConfirmationIntervalHours)
}

func TestGetRegionalRestrictionSettingsReturnsDetachedSnapshot(t *testing.T) {
	first := GetRegionalRestrictionSettings()
	require.NotEmpty(t, first.BlockedCountryCodes)
	first.BlockedCountryCodes[0] = "US"

	second := GetRegionalRestrictionSettings()
	assert.Equal(t, []string{"CN"}, second.BlockedCountryCodes)
}

func TestRegionalRestrictionSettingsPersistenceRoundTrip(t *testing.T) {
	settings := &RegionalRestrictionSettings{}
	manager := config.NewConfigManager()
	manager.Register(RegionalRestrictionConfigName, settings)

	values := map[string]string{
		"regional_restriction.enabled":                           "true",
		"regional_restriction.blocked_country_codes":             `["CN","US"]`,
		"regional_restriction.unknown_region_policy":             "deny",
		"regional_restriction.confirmation_revision":             "2026-08-03",
		"regional_restriction.confirmation_frequency":            "interval",
		"regional_restriction.confirmation_interval_hours":       "48",
		"regional_restriction.api_key_create_enabled":            "true",
		"regional_restriction.api_key_page_confirmation_enabled": "true",
	}
	require.NoError(t, manager.LoadFromDB(values))

	assert.True(t, settings.Enabled)
	assert.True(t, settings.APIKeyPageConfirmationEnabled)
	assert.True(t, settings.APIKeyCreateEnabled)
	assert.Equal(t, []string{"CN", "US"}, settings.BlockedCountryCodes)
	assert.Equal(t, "deny", settings.UnknownRegionPolicy)
	assert.Equal(t, "2026-08-03", settings.ConfirmationRevision)
	assert.Equal(t, "interval", settings.ConfirmationFrequency)
	assert.Equal(t, 48, settings.ConfirmationIntervalHours)
}
