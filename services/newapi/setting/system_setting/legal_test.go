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
