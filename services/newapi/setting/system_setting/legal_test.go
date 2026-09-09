package system_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLegalSettingsAPIKeyConfirmationLinkDefaultsEnabled(t *testing.T) {
	settings := GetLegalSettings()

	assert.True(t, settings.APIKeyTermsEnabled)
	assert.True(t, settings.APIKeyPrivacyEnabled)
	assert.True(t, settings.APIKeyAcceptableUseEnabled)
	assert.True(t, settings.APIKeyRefundEnabled)
	assert.True(t, settings.APIKeyRestrictedRegionsEnabled)
}

func TestLegalSettingsAPIKeyConfirmationLinkVisibilityConfigPersistence(t *testing.T) {
	settings := defaultLegalSettings
	manager := config.NewConfigManager()
	manager.Register("legal", &settings)

	values := map[string]string{
		"legal.api_key_terms_enabled":              "false",
		"legal.api_key_privacy_enabled":            "true",
		"legal.api_key_acceptable_use_enabled":     "false",
		"legal.api_key_refund_enabled":             "true",
		"legal.api_key_restricted_regions_enabled": "false",
	}
	require.NoError(t, manager.LoadFromDB(values))

	assert.False(t, settings.APIKeyTermsEnabled)
	assert.True(t, settings.APIKeyPrivacyEnabled)
	assert.False(t, settings.APIKeyAcceptableUseEnabled)
	assert.True(t, settings.APIKeyRefundEnabled)
	assert.False(t, settings.APIKeyRestrictedRegionsEnabled)

	persisted := make(map[string]string)
	require.NoError(t, manager.SaveToDB(func(key, value string) error {
		persisted[key] = value
		return nil
	}))
	assert.Equal(t, values, map[string]string{
		"legal.api_key_terms_enabled":              persisted["legal.api_key_terms_enabled"],
		"legal.api_key_privacy_enabled":            persisted["legal.api_key_privacy_enabled"],
		"legal.api_key_acceptable_use_enabled":     persisted["legal.api_key_acceptable_use_enabled"],
		"legal.api_key_refund_enabled":             persisted["legal.api_key_refund_enabled"],
		"legal.api_key_restricted_regions_enabled": persisted["legal.api_key_restricted_regions_enabled"],
	})

	restored := LegalSettings{}
	restoreManager := config.NewConfigManager()
	restoreManager.Register("legal", &restored)
	require.NoError(t, restoreManager.LoadFromDB(persisted))
	assert.Equal(t, settings, restored)
}
