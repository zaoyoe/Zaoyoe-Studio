package service

import (
	"context"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

type modelPricingQuoteRateRepoStub struct {
	UserGroupRateRepository
	rate *float64
}

func (s *modelPricingQuoteRateRepoStub) GetByUserAndGroup(context.Context, int64, int64) (*float64, error) {
	return s.rate, nil
}

func TestGetModelPricingQuotesAppliesUserGroupAndPeakMultipliers(t *testing.T) {
	userRate := 1.5
	billing := NewBillingService(&config.Config{}, nil)
	billing.fallbackPrices["gpt-5.4"] = &ModelPricing{
		InputPricePerToken:         2e-6,
		OutputPricePerToken:        10e-6,
		CacheCreationPricePerToken: 2.5e-6,
		CacheReadPricePerToken:     0.2e-6,
	}
	rateRepo := &modelPricingQuoteRateRepoStub{rate: &userRate}
	service := &GatewayService{
		cfg:               &config.Config{Default: config.DefaultConfig{RateMultiplier: 1}},
		billingService:    billing,
		resolver:          NewModelPricingResolver(nil, billing),
		userGroupRateRepo: rateRepo,
	}
	groupID := int64(12)
	apiKey := &APIKey{
		UserID:  77,
		GroupID: &groupID,
		Group: &Group{
			ID:                 groupID,
			RateMultiplier:     1.2,
			SubscriptionType:   SubscriptionTypeSubscription,
			PeakRateEnabled:    true,
			PeakStart:          "14:00",
			PeakEnd:            "18:00",
			PeakRateMultiplier: 2,
		},
	}

	quotes := service.getModelPricingQuotesAt(
		context.Background(),
		apiKey,
		[]string{"gpt-5.4"},
		time.Date(2026, 7, 29, 15, 0, 0, 0, time.UTC),
	)

	require.Len(t, quotes, 1)
	quote := quotes[0]
	require.True(t, quote.Available)
	require.Equal(t, "gpt-5.4", quote.BillingModel)
	require.InDelta(t, 3, quote.EffectiveMultiplier, 1e-12)
	require.InDelta(t, 6, *quote.InputPricePerMillion, 1e-12)
	require.InDelta(t, 30, *quote.OutputPricePerMillion, 1e-12)
	require.InDelta(t, 7.5, *quote.CacheWritePricePerMillion, 1e-12)
	require.InDelta(t, 0.6, *quote.CacheReadPricePerMillion, 1e-12)
}

func TestPricingQuoteBillingModelUsesConfiguredBillingSource(t *testing.T) {
	require.Equal(t, "requested-model", pricingQuoteBillingModel(ChannelMappingResult{
		MappedModel:        "mapped-model",
		BillingModelSource: BillingModelSourceRequested,
	}, "requested-model"))
	require.Equal(t, "mapped-model", pricingQuoteBillingModel(ChannelMappingResult{
		MappedModel:        "mapped-model",
		BillingModelSource: BillingModelSourceChannelMapped,
	}, "requested-model"))
	require.Equal(t, "upstream-model", pricingQuoteBillingModel(ChannelMappingResult{
		MappedModel:        "upstream-model",
		BillingModelSource: BillingModelSourceUpstream,
	}, "requested-model"))
}

func TestGetModelPricingQuotesMarksUnknownModelUnavailable(t *testing.T) {
	billing := NewBillingService(&config.Config{}, nil)
	service := &GatewayService{
		cfg:            &config.Config{Default: config.DefaultConfig{RateMultiplier: 1}},
		billingService: billing,
		resolver:       NewModelPricingResolver(nil, billing),
	}

	quotes := service.GetModelPricingQuotes(context.Background(), nil, []string{"definitely-unknown-model"})

	require.Len(t, quotes, 1)
	require.False(t, quotes[0].Available)
	require.Nil(t, quotes[0].InputPricePerMillion)
	require.Nil(t, quotes[0].OutputPricePerMillion)
}
