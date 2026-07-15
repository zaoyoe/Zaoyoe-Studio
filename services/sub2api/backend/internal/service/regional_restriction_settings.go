package service

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"
)

const (
	defaultRegionalRestrictionUnknownRegionPolicy       = "allow"
	defaultRegionalRestrictionConfirmationRevision      = "2026-06-17"
	defaultRegionalRestrictionConfirmationFrequency     = "once_per_revision"
	defaultRegionalRestrictionConfirmationIntervalHours = 24
)

func NormalizeRegionalRestrictionCountryCodes(codes []string) []string {
	result := make([]string, 0, len(codes))
	seen := make(map[string]struct{}, len(codes))
	for _, code := range codes {
		code = strings.ToUpper(strings.TrimSpace(code))
		if len(code) != 2 {
			continue
		}
		valid := true
		for _, char := range code {
			if char < 'A' || char > 'Z' {
				valid = false
				break
			}
		}
		if !valid {
			continue
		}
		if _, ok := seen[code]; ok {
			continue
		}
		seen[code] = struct{}{}
		result = append(result, code)
	}
	if len(result) == 0 {
		return []string{"CN"}
	}
	sort.Strings(result)
	return result
}

func ParseRegionalRestrictionCountryCodes(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []string{"CN"}
	}
	var parsed []string
	if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
		return NormalizeRegionalRestrictionCountryCodes(parsed)
	}
	parts := strings.FieldsFunc(raw, func(char rune) bool {
		return char == ',' || char == ';' || char == '\n' || char == '\r' || char == '\t' || char == ' '
	})
	return NormalizeRegionalRestrictionCountryCodes(parts)
}

func NormalizeRegionalRestrictionUnknownRegionPolicy(raw string) string {
	if strings.EqualFold(strings.TrimSpace(raw), "deny") {
		return "deny"
	}
	return defaultRegionalRestrictionUnknownRegionPolicy
}

func NormalizeRegionalRestrictionConfirmationRevision(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return defaultRegionalRestrictionConfirmationRevision
	}
	if len(raw) > 64 {
		raw = raw[:64]
	}
	return raw
}

func NormalizeRegionalRestrictionConfirmationFrequency(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "always", "interval":
		return strings.ToLower(strings.TrimSpace(raw))
	default:
		return defaultRegionalRestrictionConfirmationFrequency
	}
}

func NormalizeRegionalRestrictionConfirmationIntervalHours(value int) int {
	if value <= 0 {
		return defaultRegionalRestrictionConfirmationIntervalHours
	}
	if value > 8760 {
		return 8760
	}
	return value
}

func ParseRegionalRestrictionConfirmationIntervalHours(raw string) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return defaultRegionalRestrictionConfirmationIntervalHours
	}
	return NormalizeRegionalRestrictionConfirmationIntervalHours(value)
}
