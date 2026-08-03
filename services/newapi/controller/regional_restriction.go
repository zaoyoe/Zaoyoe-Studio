package controller

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

const (
	regionalRestrictionReason        = "REGION_RESTRICTED"
	regionalRestrictionMessage       = "The service is not offered to users located in restricted regions, including mainland China."
	regionalRestrictionCountryHeader = "X-NewAPI-Edge-Country"
	regionalRestrictionSecretHeader  = "X-NewAPI-Edge-Secret"
	regionalRestrictionSecretEnv     = "NEWAPI_REGIONAL_EDGE_SECRET"
	regionalRestrictionMinSecretSize = 32

	regionalRestrictionScopeRegistration = "registration"
	regionalRestrictionScopeOAuthSignup  = "oauth_signup"
	regionalRestrictionScopeAPIKeyPage   = "api_key_page"
	regionalRestrictionScopeAPIKeyCreate = "api_key_create"
)

type RegionalRestrictionEvaluation struct {
	Enabled                   bool   `json:"enabled"`
	ConfirmationRequired      bool   `json:"confirmation_required"`
	Blocked                   bool   `json:"blocked"`
	CountryCode               string `json:"country_code"`
	UnknownRegion             bool   `json:"unknown_region"`
	Revision                  string `json:"revision"`
	ConfirmationFrequency     string `json:"confirmation_frequency"`
	ConfirmationIntervalHours int    `json:"confirmation_interval_hours"`
	Message                   string `json:"message,omitempty"`
}

type RegionalRestrictionError struct {
	Scope      string
	Evaluation RegionalRestrictionEvaluation
}

func (e *RegionalRestrictionError) Error() string {
	return regionalRestrictionMessage
}

func evaluateRegionalRestriction(c *gin.Context, scope string) RegionalRestrictionEvaluation {
	settings := system_setting.GetRegionalRestrictionSettings()
	result := RegionalRestrictionEvaluation{
		Enabled:                   settings.Enabled,
		ConfirmationRequired:      settings.Enabled && settings.APIKeyPageConfirmationEnabled,
		CountryCode:               "UNKNOWN",
		Revision:                  settings.ConfirmationRevision,
		ConfirmationFrequency:     settings.ConfirmationFrequency,
		ConfirmationIntervalHours: settings.ConfirmationIntervalHours,
	}
	if !settings.Enabled || !regionalRestrictionScopeEnabled(settings, scope) {
		return result
	}

	countryCode, unknownRegion := regionalRestrictionRequestCountryCode(c)
	result.UnknownRegion = unknownRegion
	if !unknownRegion {
		result.CountryCode = countryCode
	}

	if unknownRegion {
		result.Blocked = settings.UnknownRegionPolicy == "deny"
	} else {
		for _, blockedCode := range settings.BlockedCountryCodes {
			if countryCode == normalizeRegionalRestrictionCountryCode(blockedCode) {
				result.Blocked = true
				break
			}
		}
	}
	if result.Blocked {
		result.Message = regionalRestrictionMessage
	}
	return result
}

func regionalRestrictionScopeEnabled(settings system_setting.RegionalRestrictionSettings, scope string) bool {
	switch scope {
	case regionalRestrictionScopeRegistration:
		return settings.RegistrationEnabled
	case regionalRestrictionScopeOAuthSignup:
		return settings.OAuthSignupEnabled
	case regionalRestrictionScopeAPIKeyPage:
		return settings.APIKeyPageConfirmationEnabled
	case regionalRestrictionScopeAPIKeyCreate:
		return settings.APIKeyCreateEnabled
	default:
		return false
	}
}

func regionalRestrictionRequestCountryCode(c *gin.Context) (string, bool) {
	if c == nil {
		return "", true
	}

	expectedSecret := os.Getenv(regionalRestrictionSecretEnv)
	providedSecret := c.GetHeader(regionalRestrictionSecretHeader)
	if len(expectedSecret) < regionalRestrictionMinSecretSize || providedSecret == "" || !regionalRestrictionSecretsEqual(expectedSecret, providedSecret) {
		return "", true
	}

	countryCode := normalizeRegionalRestrictionCountryCode(c.GetHeader(regionalRestrictionCountryHeader))
	if countryCode == "" || countryCode == "XX" || countryCode == "T1" {
		return "", true
	}
	return countryCode, false
}

func regionalRestrictionSecretsEqual(expected, provided string) bool {
	// Fixed-size digests keep the equality check independent of either input length.
	expectedDigest := sha256.Sum256([]byte(expected))
	providedDigest := sha256.Sum256([]byte(provided))
	return subtle.ConstantTimeCompare(expectedDigest[:], providedDigest[:]) == 1
}

func normalizeRegionalRestrictionCountryCode(raw string) string {
	countryCode := strings.ToUpper(strings.TrimSpace(raw))
	if len(countryCode) != 2 {
		return ""
	}
	for _, character := range countryCode {
		if character < 'A' || character > 'Z' {
			return ""
		}
	}
	return countryCode
}

func ensureRegionalRestrictionAllows(c *gin.Context, scope string) error {
	evaluation := evaluateRegionalRestriction(c, scope)
	if !evaluation.Blocked {
		return nil
	}
	return &RegionalRestrictionError{Scope: scope, Evaluation: evaluation}
}

func writeRegionalRestrictionError(c *gin.Context, err error) bool {
	var restrictionError *RegionalRestrictionError
	if !errors.As(err, &restrictionError) {
		return false
	}
	c.JSON(http.StatusForbidden, gin.H{
		"success": false,
		"code":    regionalRestrictionReason,
		"reason":  regionalRestrictionReason,
		"message": regionalRestrictionMessage,
		"data":    restrictionError.Evaluation,
	})
	return true
}

func GetRegionalRestrictionStatus(c *gin.Context) {
	scope := c.DefaultQuery("scope", regionalRestrictionScopeAPIKeyPage)
	if scope != regionalRestrictionScopeAPIKeyPage && scope != regionalRestrictionScopeAPIKeyCreate {
		scope = regionalRestrictionScopeAPIKeyPage
	}
	common.ApiSuccess(c, evaluateRegionalRestriction(c, scope))
}
