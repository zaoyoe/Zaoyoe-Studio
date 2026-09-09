package system_setting

import "github.com/QuantumNous/new-api/setting/config"

type LegalSettings struct {
	UserAgreement                  string `json:"user_agreement"`
	PrivacyPolicy                  string `json:"privacy_policy"`
	AcceptableUse                  string `json:"acceptable_use"`
	RefundPolicy                   string `json:"refund_policy"`
	RestrictedRegions              string `json:"restricted_regions"`
	APIKeyTermsEnabled             bool   `json:"api_key_terms_enabled"`
	APIKeyPrivacyEnabled           bool   `json:"api_key_privacy_enabled"`
	APIKeyAcceptableUseEnabled     bool   `json:"api_key_acceptable_use_enabled"`
	APIKeyRefundEnabled            bool   `json:"api_key_refund_enabled"`
	APIKeyRestrictedRegionsEnabled bool   `json:"api_key_restricted_regions_enabled"`
}

var defaultLegalSettings = LegalSettings{
	UserAgreement:                  "",
	PrivacyPolicy:                  "",
	AcceptableUse:                  "",
	RefundPolicy:                   "",
	RestrictedRegions:              "",
	APIKeyTermsEnabled:             true,
	APIKeyPrivacyEnabled:           true,
	APIKeyAcceptableUseEnabled:     true,
	APIKeyRefundEnabled:            true,
	APIKeyRestrictedRegionsEnabled: true,
}

func init() {
	config.GlobalConfig.Register("legal", &defaultLegalSettings)
}

func GetLegalSettings() *LegalSettings {
	return &defaultLegalSettings
}
