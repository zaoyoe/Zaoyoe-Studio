package system_setting

import "github.com/QuantumNous/new-api/setting/config"

type LegalSettings struct {
	UserAgreement     string `json:"user_agreement"`
	PrivacyPolicy     string `json:"privacy_policy"`
	AcceptableUse     string `json:"acceptable_use"`
	RefundPolicy      string `json:"refund_policy"`
	RestrictedRegions string `json:"restricted_regions"`
}

var defaultLegalSettings = LegalSettings{
	UserAgreement:     "",
	PrivacyPolicy:     "",
	AcceptableUse:     "",
	RefundPolicy:      "",
	RestrictedRegions: "",
}

func init() {
	config.GlobalConfig.Register("legal", &defaultLegalSettings)
}

func GetLegalSettings() *LegalSettings {
	return &defaultLegalSettings
}
