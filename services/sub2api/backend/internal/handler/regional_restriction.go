package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/service"

	"github.com/gin-gonic/gin"
)

const (
	regionalRestrictionReason  = "REGION_RESTRICTED"
	regionalRestrictionMessage = "The service is not offered to users located in restricted regions, including mainland China."

	regionalRestrictionScopeRegistration = "registration"
	regionalRestrictionScopeLogin        = "login"
	regionalRestrictionScopeOAuthSignup  = "oauth_signup"
	regionalRestrictionScopeAPIKeyPage   = "api_key_page"
	regionalRestrictionScopeAPIKeyCreate = "api_key_create"
)

type regionalRestrictionEvaluation struct {
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

func evaluateRegionalRestriction(ctx context.Context, c *gin.Context, settingSvc *service.SettingService, scope string) (regionalRestrictionEvaluation, error) {
	result := regionalRestrictionEvaluation{
		CountryCode:               "UNKNOWN",
		Revision:                  service.NormalizeRegionalRestrictionConfirmationRevision(""),
		ConfirmationFrequency:     service.NormalizeRegionalRestrictionConfirmationFrequency(""),
		ConfirmationIntervalHours: service.NormalizeRegionalRestrictionConfirmationIntervalHours(0),
	}
	if settingSvc == nil {
		return result, nil
	}

	settings, err := settingSvc.GetAllSettings(ctx)
	if err != nil {
		return result, err
	}
	if settings == nil {
		return result, nil
	}

	result.Enabled = settings.RegionalRestrictionEnabled
	result.ConfirmationRequired = settings.RegionalRestrictionEnabled && settings.RegionalRestrictionAPIKeyPageConfirmation
	result.Revision = service.NormalizeRegionalRestrictionConfirmationRevision(settings.RegionalRestrictionConfirmationRevision)
	result.ConfirmationFrequency = service.NormalizeRegionalRestrictionConfirmationFrequency(settings.RegionalRestrictionConfirmationFrequency)
	result.ConfirmationIntervalHours = service.NormalizeRegionalRestrictionConfirmationIntervalHours(settings.RegionalRestrictionConfirmationIntervalHours)
	if !settings.RegionalRestrictionEnabled || !regionalRestrictionScopeEnabled(settings, scope) {
		return result, nil
	}

	countryCode, unknownRegion := requestCountryCode(c)
	if countryCode != "" {
		result.CountryCode = countryCode
	}
	result.UnknownRegion = unknownRegion

	blocked := false
	if unknownRegion {
		blocked = service.NormalizeRegionalRestrictionUnknownRegionPolicy(settings.RegionalRestrictionUnknownRegionPolicy) == "deny"
	} else {
		blocked = regionalRestrictionCountryBlocked(countryCode, settings.RegionalRestrictionBlockedCountryCodes)
	}
	if !blocked {
		return result, nil
	}

	result.Blocked = true
	result.Message = regionalRestrictionMessage
	return result, regionalRestrictionError(scope, result)
}

func regionalRestrictionScopeEnabled(settings *service.SystemSettings, scope string) bool {
	if settings == nil {
		return false
	}
	switch scope {
	case regionalRestrictionScopeRegistration:
		return settings.RegionalRestrictionRegistrationEnabled
	case regionalRestrictionScopeLogin:
		return settings.RegionalRestrictionLoginEnabled
	case regionalRestrictionScopeOAuthSignup:
		return settings.RegionalRestrictionOAuthSignupEnabled
	case regionalRestrictionScopeAPIKeyPage:
		return settings.RegionalRestrictionAPIKeyPageConfirmation
	case regionalRestrictionScopeAPIKeyCreate:
		return settings.RegionalRestrictionAPIKeyCreateEnabled
	default:
		return false
	}
}

func requestCountryCode(c *gin.Context) (string, bool) {
	if c == nil {
		return "", true
	}
	for _, header := range []string{
		"CF-IPCountry",
		"X-Vercel-IP-Country",
		"X-Appengine-Country",
		"CloudFront-Viewer-Country",
	} {
		code := normalizeCountryCode(c.GetHeader(header))
		if code == "" {
			continue
		}
		if code == "XX" || code == "T1" {
			continue
		}
		return code, false
	}
	return "", true
}

func normalizeCountryCode(raw string) string {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if len(code) != 2 {
		return ""
	}
	for _, ch := range code {
		if ch < 'A' || ch > 'Z' {
			return ""
		}
	}
	return code
}

func regionalRestrictionCountryBlocked(countryCode string, blockedCodes []string) bool {
	countryCode = normalizeCountryCode(countryCode)
	if countryCode == "" {
		return false
	}
	for _, blockedCode := range service.NormalizeRegionalRestrictionCountryCodes(blockedCodes) {
		if countryCode == blockedCode {
			return true
		}
	}
	return false
}

func regionalRestrictionError(scope string, result regionalRestrictionEvaluation) error {
	unknownRegion := "false"
	if result.UnknownRegion {
		unknownRegion = "true"
	}
	return infraerrors.Forbidden(regionalRestrictionReason, regionalRestrictionMessage).WithMetadata(map[string]string{
		"scope":          scope,
		"country_code":   result.CountryCode,
		"unknown_region": unknownRegion,
	})
}

func isRegionalRestrictionError(err error) bool {
	return infraerrors.Reason(err) == regionalRestrictionReason
}

func (h *AuthHandler) ensureRegionalRestrictionAllows(c *gin.Context, scope string) error {
	if h == nil {
		return nil
	}
	_, err := evaluateRegionalRestriction(c.Request.Context(), c, h.settingSvc, scope)
	return err
}

func (h *AuthHandler) emailWouldCreateUser(ctx context.Context, client *dbent.Client, email string) (bool, error) {
	if client == nil {
		return false, infraerrors.ServiceUnavailable("PENDING_AUTH_NOT_READY", "pending auth service is not ready")
	}
	_, err := findUserByNormalizedEmail(ctx, client, strings.TrimSpace(strings.ToLower(email)))
	if err == nil {
		return false, nil
	}
	if errors.Is(err, service.ErrUserNotFound) {
		return true, nil
	}
	return false, err
}

func (h *AuthHandler) ensureRegionalRestrictionAllowsOAuthSignupIfNew(c *gin.Context, client *dbent.Client, email string) error {
	wouldCreate, err := h.emailWouldCreateUser(c.Request.Context(), client, email)
	if err != nil {
		if infraerrors.Code(err) >= http.StatusBadRequest && infraerrors.Code(err) < http.StatusInternalServerError {
			return err
		}
		return infraerrors.ServiceUnavailable("SERVICE_UNAVAILABLE", "service temporarily unavailable")
	}
	if !wouldCreate {
		return nil
	}
	return h.ensureRegionalRestrictionAllows(c, regionalRestrictionScopeOAuthSignup)
}
