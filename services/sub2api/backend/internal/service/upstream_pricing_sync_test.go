//go:build unit

package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type upstreamPricingRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn upstreamPricingRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestFetchUpstreamPricingCatalogUsesFixedEndpointAndRejectsInvalidResponses(t *testing.T) {
	originalClient := upstreamPricingHTTPClient
	t.Cleanup(func() { upstreamPricingHTTPClient = originalClient })

	t.Run("fixed endpoint", func(t *testing.T) {
		upstreamPricingHTTPClient = &http.Client{Transport: upstreamPricingRoundTripFunc(func(req *http.Request) (*http.Response, error) {
			require.Equal(t, upstreamPricingAPIURL, req.URL.String())
			require.Equal(t, http.MethodGet, req.Method)
			require.Equal(t, "application/json", req.Header.Get("Accept"))
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"success":true,"group_ratio":{"default":1},"data":[]}`)),
			}, nil
		})}
		catalog, err := fetchUpstreamPricingCatalog(context.Background())
		require.NoError(t, err)
		require.Equal(t, 1.0, catalog.GroupRatio["default"])
	})

	t.Run("malformed json", func(t *testing.T) {
		upstreamPricingHTTPClient = &http.Client{Transport: upstreamPricingRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`not-json`))}, nil
		})}
		_, err := fetchUpstreamPricingCatalog(context.Background())
		require.Error(t, err)
	})

	t.Run("oversized response", func(t *testing.T) {
		upstreamPricingHTTPClient = &http.Client{Transport: upstreamPricingRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode:    http.StatusOK,
				Header:        make(http.Header),
				ContentLength: upstreamPricingMaxBytes + 1,
				Body:          io.NopCloser(strings.NewReader(`{}`)),
			}, nil
		})}
		_, err := fetchUpstreamPricingCatalog(context.Background())
		require.Error(t, err)
	})
}

func TestParseUpstreamTiersUsesSub2APIBoundaries(t *testing.T) {
	tiers, err := parseUpstreamTiers(`v1:len <= 256000 ? tier("input_lte_256k", p * 1.2 + cr * 0.12 + cc * 1.5 + c * 7.2) : tier("input_gt_256k", p * 4.8 + cr * 0.48 + cc * 6 + c * 28.8)`)
	require.NoError(t, err)
	require.Len(t, tiers, 2)
	require.Equal(t, 256000, *tiers[0].MaxInputTokens)
	require.Nil(t, tiers[1].MaxInputTokens)

	candidate, err := buildUpstreamPricingCandidate(upstreamPricingModel{}, 0.16)
	require.Error(t, err)
	require.Nil(t, candidate)

	model := upstreamPricingModel{BillingExpr: `v1:len <= 256000 ? tier("input_lte_256k", p * 1.2 + cr * 0.12 + cc * 1.5 + c * 7.2) : tier("input_gt_256k", p * 4.8 + cr * 0.48 + cc * 6 + c * 28.8)`}
	candidate, err = buildUpstreamPricingCandidate(model, 0.16)
	require.NoError(t, err)
	require.Len(t, candidate.Intervals, 2)
	require.Equal(t, 0, candidate.Intervals[0].MinTokens)
	require.Equal(t, 256000, *candidate.Intervals[0].MaxTokens)
	require.Equal(t, 256000, candidate.Intervals[1].MinTokens)
	require.Nil(t, candidate.Intervals[1].MaxTokens)
	// The candidate stores the official/reference price. The selected upstream
	// group ratio is persisted separately by applyUpstreamCandidate.
	require.InDelta(t, 1.2/1_000_000, *candidate.Intervals[0].InputPrice, 1e-15)
	require.InDelta(t, 7.2/1_000_000, *candidate.Intervals[0].OutputPrice, 1e-15)
	require.InDelta(t, 4.8/1_000_000, *candidate.Intervals[1].InputPrice, 1e-15)
	require.InDelta(t, 28.8/1_000_000, *candidate.Intervals[1].OutputPrice, 1e-15)
}

func TestBuildUpstreamStaticPricingConvertsPerMillionToPerToken(t *testing.T) {
	candidate, err := buildUpstreamPricingCandidate(upstreamPricingModel{
		ModelRatio:       3,
		CompletionRatio:  3,
		CacheRatio:       0.1,
		CreateCacheRatio: 1.25,
	}, 0.16)
	require.NoError(t, err)
	require.Equal(t, BillingModeToken, candidate.BillingMode)
	require.InDelta(t, 6.0/1_000_000, candidate.Input, 1e-15)
	require.InDelta(t, 18.0/1_000_000, candidate.Output, 1e-15)
	require.InDelta(t, 0.6/1_000_000, candidate.CacheRead, 1e-15)
	require.InDelta(t, 7.5/1_000_000, candidate.CacheWrite, 1e-15)
}

func TestBuildUpstreamPerRequestPricingKeepsReferencePrice(t *testing.T) {
	candidate, err := buildUpstreamPricingCandidate(upstreamPricingModel{
		QuotaType:  1,
		ModelPrice: 0.25,
	}, 0.16)
	require.NoError(t, err)
	require.Equal(t, BillingModePerRequest, candidate.BillingMode)
	require.InDelta(t, 0.25, candidate.PerRequest, 1e-15)
}

func TestChooseUpstreamGroupPrefersRequestedAndOtherwiseLowestRatio(t *testing.T) {
	catalog := &upstreamPricingCatalog{GroupRatio: map[string]float64{
		"国产模型":      0.26,
		"补贴分组-国产模型": 0.16,
	}}
	model := upstreamPricingModel{EnableGroups: []string{"国产模型", "补贴分组-国产模型"}}

	group, ratio, err := chooseUpstreamGroup(model, catalog, "")
	require.NoError(t, err)
	require.Equal(t, "补贴分组-国产模型", group)
	require.Equal(t, 0.16, ratio)

	group, ratio, err = chooseUpstreamGroup(model, catalog, "国产模型")
	require.NoError(t, err)
	require.Equal(t, "国产模型", group)
	require.Equal(t, 0.26, ratio)

	_, _, err = chooseUpstreamGroup(model, catalog, "不存在")
	require.Error(t, err)
}

func TestParseUpstreamTiersRejectsExecutableOrMalformedExpressions(t *testing.T) {
	for _, expression := range []string{
		`v1:globalThis.process.exit()`,
		`v1:len <= 1 ? tier("a", p * 1 + c * -1) : tier("b", p * 2 + c * 2)`,
		`v1:len <= 1 ? tier("a", p * 1 + p * 2 + c * 1) : tier("b", p * 2 + c * 2)`,
	} {
		tiers, err := parseUpstreamTiers(expression)
		require.Error(t, err)
		require.Nil(t, tiers)
	}
}

func TestSyncUpstreamPricingWritesChannelNativePricesWithoutChangingGroups(t *testing.T) {
	originalLoader := loadUpstreamPricingCatalog
	t.Cleanup(func() { loadUpstreamPricingCatalog = originalLoader })
	loadUpstreamPricingCatalog = func(_ context.Context) (*upstreamPricingCatalog, error) {
		return &upstreamPricingCatalog{
			Success:        true,
			PricingVersion: "test-version",
			GroupRatio:     map[string]float64{"补贴分组-国产模型": 0.16},
			Data: []upstreamPricingModel{{
				ModelName:    "qwen3.6-flash",
				EnableGroups: []string{"补贴分组-国产模型"},
				BillingExpr:  `v1:len <= 256000 ? tier("short", p * 1.2 + cr * 0.12 + cc * 1.5 + c * 7.2) : tier("long", p * 4.8 + cr * 0.48 + cc * 6 + c * 28.8)`,
			}},
		}, nil
	}

	channel := &Channel{
		ID:       7,
		GroupIDs: []int64{42},
		ModelPricing: []ChannelModelPricing{{
			Platform:    PlatformOpenAI,
			Models:      []string{"qwen3.6-flash"},
			BillingMode: BillingModeToken,
			InputPrice:  float64Ptr(1),
			OutputPrice: float64Ptr(1),
		}},
	}
	var persisted []ChannelModelPricing
	repo := &mockChannelRepository{
		getByIDFn: func(_ context.Context, _ int64) (*Channel, error) { return channel, nil },
		replaceModelPricingFn: func(_ context.Context, _ int64, pricing []ChannelModelPricing) error {
			persisted = pricing
			channel.ModelPricing = pricing
			return nil
		},
		listAllFn: func(_ context.Context) ([]Channel, error) { return []Channel{*channel}, nil },
	}
	svc := newTestChannelService(repo)

	result, err := svc.SyncUpstreamPricing(context.Background(), channel.ID, UpstreamPricingSyncRequest{Platform: PlatformOpenAI})
	require.NoError(t, err)
	require.Equal(t, "test-version", result.PricingVersion)
	require.Zero(t, result.Added)
	require.Equal(t, 1, result.Updated)
	require.Len(t, persisted, 1)
	require.Equal(t, []int64{42}, result.Channel.GroupIDs)
	require.InDelta(t, 1.2/1_000_000, *persisted[0].Intervals[0].InputPrice, 1e-15)
	require.InDelta(t, 7.2/1_000_000, *persisted[0].Intervals[0].OutputPrice, 1e-15)
	require.Equal(t, 0.16, *persisted[0].UpstreamCostMultiplier)
	require.Equal(t, "补贴分组-国产模型", persisted[0].UpstreamPricingGroup)
	require.Equal(t, "test-version", persisted[0].UpstreamPricingVersion)
	require.Equal(t, 256000, persisted[0].Intervals[1].MinTokens)
}

func TestSyncUpstreamPricingAddsMissingCatalogModelsForSelectedGroup(t *testing.T) {
	originalLoader := loadUpstreamPricingCatalog
	t.Cleanup(func() { loadUpstreamPricingCatalog = originalLoader })
	loadUpstreamPricingCatalog = func(_ context.Context) (*upstreamPricingCatalog, error) {
		return &upstreamPricingCatalog{
			Success:        true,
			PricingVersion: "test-add-version",
			GroupRatio: map[string]float64{
				"国产模型":    0.26,
				"GPT pro": 0.1,
			},
			Data: []upstreamPricingModel{
				{
					ModelName:       "qwen3.6-flash",
					ModelRatio:      0.6,
					CompletionRatio: 6,
					CacheRatio:      0.1,
					EnableGroups:    []string{"国产模型"},
				},
				{
					ModelName:       "codex-auto-review",
					ModelRatio:      2.5,
					CompletionRatio: 6,
					CacheRatio:      0.1,
					EnableGroups:    []string{"GPT pro"},
				},
			},
		}, nil
	}

	channel := &Channel{
		ID: 9,
		ModelPricing: []ChannelModelPricing{{
			Platform:    PlatformOpenAI,
			Models:      []string{"custom-alias"},
			BillingMode: BillingModeToken,
		}},
	}
	var persisted []ChannelModelPricing
	repo := &mockChannelRepository{
		getByIDFn: func(_ context.Context, _ int64) (*Channel, error) { return channel, nil },
		replaceModelPricingFn: func(_ context.Context, _ int64, pricing []ChannelModelPricing) error {
			persisted = pricing
			channel.ModelPricing = pricing
			return nil
		},
		listAllFn: func(_ context.Context) ([]Channel, error) { return []Channel{*channel}, nil },
	}

	result, err := newTestChannelService(repo).SyncUpstreamPricing(context.Background(), channel.ID, UpstreamPricingSyncRequest{
		Platform: PlatformOpenAI,
		Group:    "国产模型",
	})
	require.NoError(t, err)
	require.Equal(t, 1, result.Added)
	require.Zero(t, result.Updated)
	require.Equal(t, 1, result.Missing)
	require.Len(t, persisted, 2)
	require.Equal(t, "qwen3.6-flash", persisted[1].Models[0])
	require.Equal(t, PlatformOpenAI, persisted[1].Platform)
	require.Equal(t, BillingModeToken, persisted[1].BillingMode)
	require.InDelta(t, 0.6*2/1_000_000, *persisted[1].InputPrice, 1e-15)
	require.Equal(t, 0.26, *persisted[1].UpstreamCostMultiplier)
	require.Equal(t, "国产模型", persisted[1].UpstreamPricingGroup)
	require.Equal(t, "test-add-version", persisted[1].UpstreamPricingVersion)
}

func TestPricingPatternsCoverExactAndWildcardModels(t *testing.T) {
	require.True(t, pricingPatternsCoverModel([]string{"qwen3.6-flash", "claude-opus-*"}, "QWEN3.6-FLASH"))
	require.True(t, pricingPatternsCoverModel([]string{"qwen3.6-flash", "claude-opus-*"}, "claude-opus-4-7"))
	require.False(t, pricingPatternsCoverModel([]string{"qwen3.6-flash", "claude-opus-*"}, "qwen3.7-plus"))
}
