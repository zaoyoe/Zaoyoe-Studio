package system_setting

import (
	"sync"

	"github.com/QuantumNous/new-api/setting/config"
)

const RegionalRestrictionConfigName = "regional_restriction"

type RegionalRestrictionSettings struct {
	Enabled                       bool     `json:"enabled"`
	RegistrationEnabled           bool     `json:"registration_enabled"`
	OAuthSignupEnabled            bool     `json:"oauth_signup_enabled"`
	APIKeyPageConfirmationEnabled bool     `json:"api_key_page_confirmation_enabled"`
	APIKeyCreateEnabled           bool     `json:"api_key_create_enabled"`
	BlockedCountryCodes           []string `json:"blocked_country_codes"`
	UnknownRegionPolicy           string   `json:"unknown_region_policy"`
	ConfirmationRevision          string   `json:"confirmation_revision"`
	ConfirmationFrequency         string   `json:"confirmation_frequency"`
	ConfirmationIntervalHours     int      `json:"confirmation_interval_hours"`
}

var (
	regionalRestrictionSettings = RegionalRestrictionSettings{
		Enabled:                       false,
		RegistrationEnabled:           false,
		OAuthSignupEnabled:            false,
		APIKeyPageConfirmationEnabled: false,
		APIKeyCreateEnabled:           false,
		BlockedCountryCodes:           []string{"CN"},
		UnknownRegionPolicy:           "allow",
		ConfirmationRevision:          "2026-06-17",
		ConfirmationFrequency:         "once_per_revision",
		ConfirmationIntervalHours:     24,
	}
	regionalRestrictionSettingsMutex sync.RWMutex
)

func init() {
	config.GlobalConfig.Register(RegionalRestrictionConfigName, &regionalRestrictionSettings)
}

// GetRegionalRestrictionSettings returns a detached snapshot safe for callers to retain.
func GetRegionalRestrictionSettings() RegionalRestrictionSettings {
	regionalRestrictionSettingsMutex.RLock()
	defer regionalRestrictionSettingsMutex.RUnlock()

	snapshot := regionalRestrictionSettings
	snapshot.BlockedCountryCodes = append([]string(nil), regionalRestrictionSettings.BlockedCountryCodes...)
	return snapshot
}

// UpdateRegionalRestrictionSettings applies one or more persisted fields atomically.
func UpdateRegionalRestrictionSettings(values map[string]string) error {
	regionalRestrictionSettingsMutex.Lock()
	defer regionalRestrictionSettingsMutex.Unlock()

	return config.UpdateConfigFromMap(&regionalRestrictionSettings, values)
}
