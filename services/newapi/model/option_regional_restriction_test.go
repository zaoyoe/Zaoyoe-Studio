package model

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeRegionalRestrictionOptionValue(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value string
		want  string
	}{
		{name: "boolean", key: "regional_restriction.enabled", value: " TRUE ", want: "true"},
		{name: "login boolean", key: "regional_restriction.login_enabled", value: " FALSE ", want: "false"},
		{name: "countries", key: "regional_restriction.blocked_country_codes", value: `["us"," CN ","US"]`, want: `["CN","US"]`},
		{name: "unknown policy", key: "regional_restriction.unknown_region_policy", value: " DENY ", want: "deny"},
		{name: "frequency", key: "regional_restriction.confirmation_frequency", value: " INTERVAL ", want: "interval"},
		{name: "revision", key: "regional_restriction.confirmation_revision", value: " 2026-08-03 ", want: "2026-08-03"},
		{name: "unicode revision counts characters", key: "regional_restriction.confirmation_revision", value: strings.Repeat("\u754c", 22), want: strings.Repeat("\u754c", 22)},
		{name: "interval", key: "regional_restriction.confirmation_interval_hours", value: "0024", want: "24"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeOptionValue(tt.key, tt.value)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestValidateRegionalRestrictionOptionRejectsMalformedValues(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value string
	}{
		{name: "invalid boolean", key: "regional_restriction.registration_enabled", value: "yes"},
		{name: "numeric boolean", key: "regional_restriction.registration_enabled", value: "1"},
		{name: "country object", key: "regional_restriction.blocked_country_codes", value: `{"CN":true}`},
		{name: "country null", key: "regional_restriction.blocked_country_codes", value: `null`},
		{name: "country length", key: "regional_restriction.blocked_country_codes", value: `["CHN"]`},
		{name: "country non ascii", key: "regional_restriction.blocked_country_codes", value: `["C1"]`},
		{name: "country unicode", key: "regional_restriction.blocked_country_codes", value: `["中A"]`},
		{name: "unknown policy", key: "regional_restriction.unknown_region_policy", value: "block"},
		{name: "frequency", key: "regional_restriction.confirmation_frequency", value: "daily"},
		{name: "empty revision", key: "regional_restriction.confirmation_revision", value: "  "},
		{name: "long revision", key: "regional_restriction.confirmation_revision", value: strings.Repeat("x", 65)},
		{name: "zero interval", key: "regional_restriction.confirmation_interval_hours", value: "0"},
		{name: "large interval", key: "regional_restriction.confirmation_interval_hours", value: "8761"},
		{name: "fractional interval", key: "regional_restriction.confirmation_interval_hours", value: "1.5"},
		{name: "unknown field", key: "regional_restriction.session_refresh_enabled", value: "true"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Error(t, validateOptionValue(tt.key, tt.value))
		})
	}
}
