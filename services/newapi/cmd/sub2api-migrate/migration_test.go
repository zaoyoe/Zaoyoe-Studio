package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQuotaFromUSDPreservesSub2APIBalanceUnits(t *testing.T) {
	quota, err := quotaFromUSD(12.345678)
	require.NoError(t, err)
	assert.Equal(t, 6_172_839, quota)

	_, err = quotaFromUSD(10_000)
	require.Error(t, err)
}

func TestNormalizedLegacyKeyKeepsExistingClientCredentialCompatible(t *testing.T) {
	key, err := normalizedLegacyKey("sk-0123456789abcdef")
	require.NoError(t, err)
	assert.Equal(t, "0123456789abcdef", key)

	_, err = normalizedLegacyKey("0123456789abcdef")
	require.Error(t, err)
	_, err = normalizedLegacyKey("sk-segment-with-dashes")
	require.Error(t, err)
}

func TestPrepareMigratedUserIdentifiersGeneratesStableUniqueUsernames(t *testing.T) {
	users := []legacyUser{
		{ID: 35, Email: " first@example.com ", Username: ""},
		{ID: 36, Email: "second@example.com", Username: "ExistingUser"},
	}

	require.NoError(t, prepareMigratedUserIdentifiers(users))
	assert.Equal(t, "s2u-z", users[0].Username)
	assert.Equal(t, "first@example.com", users[0].Email)
	assert.Equal(t, "ExistingUser", users[1].Username)
}

func TestPrepareMigratedUserIdentifiersRejectsCaseInsensitiveLoginCollisions(t *testing.T) {
	tests := []struct {
		name    string
		users   []legacyUser
		message string
	}{
		{
			name: "username collision",
			users: []legacyUser{
				{ID: 1, Email: "one@example.com", Username: "Alice"},
				{ID: 2, Email: "two@example.com", Username: "alice"},
			},
			message: "case-insensitive username collision",
		},
		{
			name: "email collision",
			users: []legacyUser{
				{ID: 1, Email: "User@example.com", Username: "one"},
				{ID: 2, Email: "user@example.com", Username: "two"},
			},
			message: "case-insensitive email collision",
		},
		{
			name: "username and email collision",
			users: []legacyUser{
				{ID: 1, Email: "one@example.com", Username: "person@example.com"},
				{ID: 2, Email: "Person@example.com", Username: "person"},
			},
			message: "collides with legacy user 2 email",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := prepareMigratedUserIdentifiers(test.users)
			require.ErrorContains(t, err, test.message)
		})
	}
}

func TestValidateLegacyGroupAccessStateFailsClosed(t *testing.T) {
	tests := []struct {
		name                    string
		privilegedKeys          int
		allowedGroupAssignments int
		activeSubscriptions     int
		message                 string
	}{
		{name: "exclusive or subscription key", privilegedKeys: 1, message: "active API keys use exclusive or subscription groups"},
		{name: "user-specific authorization", allowedGroupAssignments: 1, message: "user-specific group authorizations"},
		{name: "active subscription", activeSubscriptions: 1, message: "active group subscriptions"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateLegacyGroupAccessState(test.privilegedKeys, test.allowedGroupAssignments, test.activeSubscriptions)
			require.ErrorContains(t, err, test.message)
		})
	}
	require.NoError(t, validateLegacyGroupAccessState(0, 0, 0))
}

func TestValidateLegacyUnsupportedStateFailsClosed(t *testing.T) {
	tests := []struct {
		name                    string
		frozenBalances          int
		userRPMLimits           int
		groupRPMLimits          int
		userGroupOverrides      int
		nonTokenPricing         int
		restrictedActiveGroups  int
		unsupportedGroupPricing int
		message                 string
	}{
		{name: "frozen balance", frozenBalances: 1, message: "in-flight frozen balances"},
		{name: "user RPM", userRPMLimits: 1, message: "users have RPM limits"},
		{name: "group RPM", groupRPMLimits: 1, message: "groups have RPM limits"},
		{name: "user group override", userGroupOverrides: 1, message: "group rate or RPM overrides"},
		{name: "non-token pricing", nonTokenPricing: 1, message: "non-token pricing records"},
		{name: "restricted active group", restrictedActiveGroups: 1, message: "active exclusive or subscription groups"},
		{name: "unsupported group pricing", unsupportedGroupPricing: 1, message: "peak, media-specific, or fixed image pricing"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateLegacyUnsupportedState(
				test.frozenBalances,
				test.userRPMLimits,
				test.groupRPMLimits,
				test.userGroupOverrides,
				test.nonTokenPricing,
				test.restrictedActiveGroups,
				test.unsupportedGroupPricing,
			)
			require.ErrorContains(t, err, test.message)
		})
	}
	require.NoError(t, validateLegacyUnsupportedState(0, 0, 0, 0, 0, 0, 0))
}

func TestShouldMigrateGlobalGroupOnlyAllowsPublicStandardActiveGroups(t *testing.T) {
	assert.True(t, shouldMigrateGlobalGroup(false, "active", false, "standard"))
	assert.False(t, shouldMigrateGlobalGroup(true, "active", false, "standard"))
	assert.False(t, shouldMigrateGlobalGroup(false, "disabled", false, "standard"))
	assert.False(t, shouldMigrateGlobalGroup(false, "active", true, "standard"))
	assert.False(t, shouldMigrateGlobalGroup(false, "active", false, "subscription"))
}

func TestBuildTargetOptionsOverridesExactLegacyTokenPricing(t *testing.T) {
	options, err := buildTargetOptions(
		[]bridgeGroup{{Name: "Legacy Pro", RateMultiplier: 0.25}},
		[]legacyPrice{{
			Model:           "sora-2",
			InputPrice:      0.000002,
			OutputPrice:     0.000012,
			CacheWritePrice: 0.0000025,
			CacheReadPrice:  0.0000002,
		}},
		map[string]string{
			"regional_restriction_unknown_region_policy": "allow",
		},
	)
	require.NoError(t, err)

	var modelRatios map[string]float64
	require.NoError(t, common.UnmarshalJsonStr(options["ModelRatio"], &modelRatios))
	assert.Equal(t, 1.0, modelRatios["sora-2"])
	var modelPrices map[string]float64
	require.NoError(t, common.UnmarshalJsonStr(options["ModelPrice"], &modelPrices))
	assert.NotContains(t, modelPrices, "sora-2")
	var completionRatios map[string]float64
	require.NoError(t, common.UnmarshalJsonStr(options["CompletionRatio"], &completionRatios))
	assert.Equal(t, 6.0, completionRatios["sora-2"])
	var cacheRatios map[string]float64
	require.NoError(t, common.UnmarshalJsonStr(options["CacheRatio"], &cacheRatios))
	assert.InDelta(t, 0.1, cacheRatios["sora-2"], 1e-12)
	var createCacheRatios map[string]float64
	require.NoError(t, common.UnmarshalJsonStr(options["CreateCacheRatio"], &createCacheRatios))
	assert.InDelta(t, 1.25, createCacheRatios["sora-2"], 1e-12)
	var billingModes map[string]string
	require.NoError(t, common.UnmarshalJsonStr(options["billing_setting.billing_mode"], &billingModes))
	assert.Equal(t, billing_setting.BillingModeTieredExpr, billingModes["sora-2"])
	var billingExpressions map[string]string
	require.NoError(t, common.UnmarshalJsonStr(options["billing_setting.billing_expr"], &billingExpressions))
	expression := billingExpressions["sora-2"]
	require.NotEmpty(t, expression)
	cache5mCost, _, err := billingexpr.RunExpr(expression, billingexpr.TokenParams{CC: 100})
	require.NoError(t, err)
	cache1hCost, _, err := billingexpr.RunExpr(expression, billingexpr.TokenParams{CC1h: 100})
	require.NoError(t, err)
	assert.InDelta(t, 250, cache5mCost, 1e-12)
	assert.InDelta(t, cache5mCost, cache1hCost, 1e-12, "Sub2API has one cache_write price and must not inherit NewAPI's 1h multiplier")
	var groupRatios map[string]float64
	require.NoError(t, common.UnmarshalJsonStr(options["GroupRatio"], &groupRatios))
	assert.Equal(t, 0.25, groupRatios["Legacy Pro"])
	var usableGroups map[string]string
	require.NoError(t, common.UnmarshalJsonStr(options["UserUsableGroups"], &usableGroups))
	assert.Equal(t, "Auto", usableGroups["auto"])
	var autoGroups []string
	require.NoError(t, common.UnmarshalJsonStr(options["AutoGroups"], &autoGroups))
	assert.Equal(t, []string{"Legacy Pro"}, autoGroups)
	assert.Equal(t, "true", options["DefaultUseAutoGroup"])
	assert.Equal(t, "allow", options["regional_restriction.unknown_region_policy"])
}

func TestFetchGroupModelsUsesBridgeKeyAndReturnsStableUniqueModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/models", r.URL.Path)
		assert.Equal(t, "Bearer sk-bridge", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"model-b"},{"id":"model-a"},{"id":"model-b"}]}`))
	}))
	defer server.Close()

	models, err := fetchGroupModels(context.Background(), server.URL, "sk-bridge")
	require.NoError(t, err)
	assert.Equal(t, []string{"model-a", "model-b"}, models)
}

func TestBuildLegacyBillingExprPreservesSub2APIContextTierBoundaries(t *testing.T) {
	firstMax := 256_000
	expression, err := buildLegacyBillingExpr(legacyPrice{
		Model:           "claude-tiered",
		InputPrice:      0.000003,
		OutputPrice:     0.000015,
		CacheWritePrice: 0.00000375,
		CacheReadPrice:  0.0000003,
		Intervals: []legacyPriceInterval{
			{
				MinTokens:       0,
				MaxTokens:       &firstMax,
				InputPrice:      0.000003,
				OutputPrice:     0.000015,
				CacheWritePrice: 0.00000375,
				CacheReadPrice:  0.0000003,
			},
			{
				MinTokens:       firstMax,
				InputPrice:      0.000006,
				OutputPrice:     0.0000225,
				CacheWritePrice: 0.0000075,
				CacheReadPrice:  0.0000006,
			},
		},
	})
	require.NoError(t, err)

	firstTierCost, firstTrace, err := billingexpr.RunExpr(expression, billingexpr.TokenParams{P: 1_000, Len: float64(firstMax)})
	require.NoError(t, err)
	assert.InDelta(t, 3_000, firstTierCost, 1e-12)
	assert.Equal(t, "sub2api_1", firstTrace.MatchedTier)

	secondTierCost, secondTrace, err := billingexpr.RunExpr(expression, billingexpr.TokenParams{P: 1_000, Len: float64(firstMax + 1)})
	require.NoError(t, err)
	assert.InDelta(t, 6_000, secondTierCost, 1e-12)
	assert.Equal(t, "sub2api_2", secondTrace.MatchedTier)

	cache5mCost, _, err := billingexpr.RunExpr(expression, billingexpr.TokenParams{CC: 1_000, Len: 1})
	require.NoError(t, err)
	cache1hCost, _, err := billingexpr.RunExpr(expression, billingexpr.TokenParams{CC1h: 1_000, Len: 1})
	require.NoError(t, err)
	assert.InDelta(t, cache5mCost, cache1hCost, 1e-12)
}

func TestBuildLegacyBillingExprRejectsPricingGaps(t *testing.T) {
	firstMax := 100
	_, err := buildLegacyBillingExpr(legacyPrice{
		InputPrice:  0.000001,
		OutputPrice: 0.000002,
		Intervals: []legacyPriceInterval{
			{MinTokens: 0, MaxTokens: &firstMax, InputPrice: 0.000001, OutputPrice: 0.000002},
			{MinTokens: 101, InputPrice: 0.000002, OutputPrice: 0.000004},
		},
	})
	require.ErrorContains(t, err, "gaps and overlaps")
}

func TestMigratedTokenStatusKeepsDeletedGroupKeysUnavailable(t *testing.T) {
	assert.Equal(t, 1, migratedTokenStatus(legacyToken{Status: "active"}))
	assert.Equal(t, 2, migratedTokenStatus(legacyToken{Status: "disabled"}))
	assert.Equal(t, 2, migratedTokenStatus(legacyToken{Status: "active", GroupDeleted: true}),
		"Sub2API returns GROUP_DELETED for this state, so migration must not revive the key")
}
