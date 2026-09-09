package common

import "strings"

const fatherKeyTopUpURL = "https://fatherkey.com"

func NormalizeTopUpLink(value string) string {
	trimmed := strings.TrimSpace(value)
	bareDomain := strings.ToLower(strings.TrimSuffix(trimmed, "/"))
	if bareDomain == "fatherkey.com" || bareDomain == "www.fatherkey.com" {
		return fatherKeyTopUpURL
	}
	return trimmed
}
