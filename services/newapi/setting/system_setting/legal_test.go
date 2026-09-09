package system_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLegalSettingsLoadFiveDocumentsIndependently(t *testing.T) {
	settings := GetLegalSettings()
	originalSettings := *settings
	t.Cleanup(func() {
		*settings = originalSettings
	})

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"legal.user_agreement":     "terms-content",
		"legal.privacy_policy":     "privacy-content",
		"legal.acceptable_use":     "acceptable-use-content",
		"legal.refund_policy":      "refund-content",
		"legal.restricted_regions": "restricted-regions-content",
	}))

	assert.Equal(t, "terms-content", settings.UserAgreement)
	assert.Equal(t, "privacy-content", settings.PrivacyPolicy)
	assert.Equal(t, "acceptable-use-content", settings.AcceptableUse)
	assert.Equal(t, "refund-content", settings.RefundPolicy)
	assert.Equal(t, "restricted-regions-content", settings.RestrictedRegions)
}

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
	for key, value := range values {
		assert.Equal(t, value, persisted[key])
	}

	restored := LegalSettings{}
	restoreManager := config.NewConfigManager()
	restoreManager.Register("legal", &restored)
	require.NoError(t, restoreManager.LoadFromDB(persisted))
	assert.Equal(t, settings, restored)
}
