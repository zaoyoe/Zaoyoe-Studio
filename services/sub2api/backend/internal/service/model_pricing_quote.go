package service

import (
	"context"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/timezone"
)

const pricePerMillionScale = 1_000_000

// ModelPricingQuote is the API-key-scoped effective price shown to clients.
// It deliberately omits channel, account, user, and internal pricing-source data.
type ModelPricingQuote struct {
	ID                          string                      `json:"id"`
	BillingModel                string                      `json:"billing_model"`
	BillingMode                 BillingMode                 `json:"billing_mode"`
	EffectiveMultiplier         float64                     `json:"effective_multiplier"`
	Available                   bool                        `json:"available"`
	InputPricePerMillion        *float64                    `json:"input_price_per_million,omitempty"`
	OutputPricePerMillion       *float64                    `json:"output_price_per_million,omitempty"`
	CacheWritePricePerMillion   *float64                    `json:"cache_write_price_per_million,omitempty"`
	CacheWrite5mPricePerMillion *float64                    `json:"cache_write_5m_price_per_million,omitempty"`
	CacheWrite1hPricePerMillion *float64                    `json:"cache_write_1h_price_per_million,omitempty"`
	CacheReadPricePerMillion    *float64                    `json:"cache_read_price_per_million,omitempty"`
	ImageOutputPricePerMillion  *float64                    `json:"image_output_price_per_million,omitempty"`
	PerRequestPrice             *float64                    `json:"per_request_price,omitempty"`
	Intervals                   []ModelPricingIntervalQuote `json:"intervals,omitempty"`
}

// ModelPricingIntervalQuote is an effective token-range or request-tier price.
type ModelPricingIntervalQuote struct {
	MinTokens                 int      `json:"min_tokens"`
	MaxTokens                 *int     `json:"max_tokens"`
	TierLabel                 string   `json:"tier_label,omitempty"`
	InputPricePerMillion      *float64 `json:"input_price_per_million,omitempty"`
	OutputPricePerMillion     *float64 `json:"output_price_per_million,omitempty"`
	CacheWritePricePerMillion *float64 `json:"cache_write_price_per_million,omitempty"`
	CacheReadPricePerMillion  *float64 `json:"cache_read_price_per_million,omitempty"`
	PerRequestPrice           *float64 `json:"per_request_price,omitempty"`
}

// GetModelPricingQuotes resolves the same model pricing and effective text
// multiplier used by usage settlement for the current API key.
func (s *GatewayService) GetModelPricingQuotes(ctx context.Context, apiKey *APIKey, modelIDs []string) []ModelPricingQuote {
	return s.getModelPricingQuotesAt(ctx, apiKey, modelIDs, timezone.Now())
}

func (s *GatewayService) getModelPricingQuotesAt(ctx context.Context, apiKey *APIKey, modelIDs []string, now time.Time) []ModelPricingQuote {
	multiplier := s.effectiveTextPricingMultiplier(ctx, apiKey, now)
	quotes := make([]ModelPricingQuote, 0, len(modelIDs))
	seen := make(map[string]struct{}, len(modelIDs))

	for _, modelID := range modelIDs {
		if modelID == "" {
			continue
		}
		if _, ok := seen[modelID]; ok {
			continue
		}
		seen[modelID] = struct{}{}

		billingModel := s.resolvePricingQuoteBillingModel(ctx, apiKey, modelID)
		quote := ModelPricingQuote{
			ID:                  modelID,
			BillingModel:        billingModel,
			BillingMode:         BillingModeToken,
			EffectiveMultiplier: multiplier,
		}

		resolver := s.resolver
		if resolver == nil && s.billingService != nil {
			resolver = NewModelPricingResolver(s.channelService, s.billingService)
		}
		if resolver == nil {
			quotes = append(quotes, quote)
			continue
		}

		var groupID *int64
		// ModelPricingResolver's channel override path requires a channel service;
		// omit the group lookup when running without one (for example, lightweight
		// deployments or isolated tests) and use the global LiteLLM/fallback price.
		if s.channelService != nil {
			if apiKey != nil && apiKey.GroupID != nil {
				groupID = apiKey.GroupID
			} else if apiKey != nil && apiKey.Group != nil && apiKey.Group.ID > 0 {
				groupID = &apiKey.Group.ID
			}
		}
		resolved := resolver.Resolve(ctx, PricingInput{Model: billingModel, GroupID: groupID})
		if resolved == nil {
			quotes = append(quotes, quote)
			continue
		}

		quote.BillingMode = resolved.Mode
		if quote.BillingMode == "" {
			quote.BillingMode = BillingModeToken
		}
		quote.Intervals = effectiveIntervalQuotes(resolved, multiplier)

		switch quote.BillingMode {
		case BillingModePerRequest, BillingModeImage:
			quote.Available = resolved.DefaultPerRequestPrice >= 0 && (resolved.DefaultPerRequestPrice > 0 || len(quote.Intervals) > 0)
			if resolved.DefaultPerRequestPrice > 0 || len(quote.Intervals) == 0 {
				quote.PerRequestPrice = scaledPricePtr(resolved.DefaultPerRequestPrice, multiplier, 1)
			}
		default:
			if resolved.BasePricing != nil {
				applyEffectiveTokenPricing(&quote, resolved.BasePricing, multiplier)
				quote.Available = true
			} else if len(quote.Intervals) > 0 {
				quote.Available = true
			}
		}

		quotes = append(quotes, quote)
	}

	return quotes
}

func (s *GatewayService) effectiveTextPricingMultiplier(ctx context.Context, apiKey *APIKey, now time.Time) float64 {
	multiplier := 1.0
	if s != nil && s.cfg != nil {
		multiplier = s.cfg.Default.RateMultiplier
	}
	if apiKey != nil && apiKey.Group != nil {
		groupID := apiKey.Group.ID
		if apiKey.GroupID != nil {
			groupID = *apiKey.GroupID
		}
		userID := apiKey.UserID
		if apiKey.User != nil && apiKey.User.ID > 0 {
			userID = apiKey.User.ID
		}
		if groupID > 0 {
			multiplier = s.getUserGroupRateMultiplier(ctx, userID, groupID, apiKey.Group.RateMultiplier)
		}
	}
	textMultiplier, _ := computePeakAwareMultipliers(apiKey, multiplier, now)
	return textMultiplier
}

func (s *GatewayService) resolvePricingQuoteBillingModel(ctx context.Context, apiKey *APIKey, requestedModel string) string {
	if s == nil || s.channelService == nil || apiKey == nil {
		return requestedModel
	}
	groupID := int64(0)
	if apiKey.GroupID != nil {
		groupID = *apiKey.GroupID
	} else if apiKey.Group != nil {
		groupID = apiKey.Group.ID
	}
	if groupID <= 0 {
		return requestedModel
	}
	mapping := s.channelService.ResolveChannelMapping(ctx, groupID, requestedModel)
	return pricingQuoteBillingModel(mapping, requestedModel)
}

func pricingQuoteBillingModel(mapping ChannelMappingResult, requestedModel string) string {
	switch mapping.BillingModelSource {
	case BillingModelSourceRequested:
		return requestedModel
	case BillingModelSourceChannelMapped, BillingModelSourceUpstream:
		if mapping.MappedModel != "" {
			return mapping.MappedModel
		}
	}
	if mapping.MappedModel != "" {
		return mapping.MappedModel
	}
	return requestedModel
}

func applyEffectiveTokenPricing(quote *ModelPricingQuote, pricing *ModelPricing, multiplier float64) {
	if quote == nil || pricing == nil {
		return
	}
	quote.InputPricePerMillion = scaledPricePtr(pricing.InputPricePerToken, multiplier, pricePerMillionScale)
	quote.OutputPricePerMillion = scaledPricePtr(pricing.OutputPricePerToken, multiplier, pricePerMillionScale)
	if pricing.CacheCreationPricePerToken > 0 || pricing.CacheCreationPriceExplicit {
		quote.CacheWritePricePerMillion = scaledPricePtr(pricing.CacheCreationPricePerToken, multiplier, pricePerMillionScale)
	}
	if pricing.CacheCreation5mPrice > 0 {
		quote.CacheWrite5mPricePerMillion = scaledPricePtr(pricing.CacheCreation5mPrice, multiplier, pricePerMillionScale)
	}
	if pricing.CacheCreation1hPrice > 0 {
		quote.CacheWrite1hPricePerMillion = scaledPricePtr(pricing.CacheCreation1hPrice, multiplier, pricePerMillionScale)
	}
	if pricing.CacheReadPricePerToken > 0 {
		quote.CacheReadPricePerMillion = scaledPricePtr(pricing.CacheReadPricePerToken, multiplier, pricePerMillionScale)
	}
	if pricing.ImageOutputPricePerToken > 0 || pricing.ImageOutputPriceExplicit {
		quote.ImageOutputPricePerMillion = scaledPricePtr(pricing.ImageOutputPricePerToken, multiplier, pricePerMillionScale)
	}
}

func effectiveIntervalQuotes(resolved *ResolvedPricing, multiplier float64) []ModelPricingIntervalQuote {
	if resolved == nil {
		return nil
	}
	intervals := resolved.Intervals
	if resolved.Mode == BillingModePerRequest || resolved.Mode == BillingModeImage {
		intervals = resolved.RequestTiers
	}
	quotes := make([]ModelPricingIntervalQuote, 0, len(intervals))
	for i := range intervals {
		iv := intervals[i]
		quote := ModelPricingIntervalQuote{
			MinTokens: iv.MinTokens,
			MaxTokens: iv.MaxTokens,
			TierLabel: iv.TierLabel,
		}
		quote.InputPricePerMillion = scaledOptionalPrice(iv.InputPrice, multiplier, pricePerMillionScale)
		quote.OutputPricePerMillion = scaledOptionalPrice(iv.OutputPrice, multiplier, pricePerMillionScale)
		quote.CacheWritePricePerMillion = scaledOptionalPrice(iv.CacheWritePrice, multiplier, pricePerMillionScale)
		quote.CacheReadPricePerMillion = scaledOptionalPrice(iv.CacheReadPrice, multiplier, pricePerMillionScale)
		quote.PerRequestPrice = scaledOptionalPrice(iv.PerRequestPrice, multiplier, 1)
		quotes = append(quotes, quote)
	}
	return quotes
}

func scaledOptionalPrice(price *float64, multiplier, scale float64) *float64 {
	if price == nil {
		return nil
	}
	return scaledPricePtr(*price, multiplier, scale)
}

func scaledPricePtr(price, multiplier, scale float64) *float64 {
	value := price * multiplier * scale
	return &value
}
