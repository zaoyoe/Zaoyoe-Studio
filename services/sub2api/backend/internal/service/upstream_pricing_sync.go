package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
)

const (
	upstreamPricingAPIURL      = "https://zzone.cc.cd/api/pricing"
	upstreamPricingMaxBytes    = 2 * 1024 * 1024
	upstreamPricingTimeout     = 12 * time.Second
	upstreamTokenBasePriceM    = 2.0
	upstreamPricingDetailLimit = 500
)

var upstreamPricingHTTPClient = &http.Client{
	Timeout: upstreamPricingTimeout,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

var loadUpstreamPricingCatalog = fetchUpstreamPricingCatalog

type upstreamPricingCatalog struct {
	Success        bool                   `json:"success"`
	Data           []upstreamPricingModel `json:"data"`
	GroupRatio     map[string]float64     `json:"group_ratio"`
	PricingVersion string                 `json:"pricing_version"`
}

type upstreamPricingModel struct {
	ModelName        string   `json:"model_name"`
	QuotaType        int      `json:"quota_type"`
	ModelRatio       float64  `json:"model_ratio"`
	ModelPrice       float64  `json:"model_price"`
	CompletionRatio  float64  `json:"completion_ratio"`
	CacheRatio       float64  `json:"cache_ratio"`
	CreateCacheRatio float64  `json:"create_cache_ratio"`
	EnableGroups     []string `json:"enable_groups"`
	BillingExpr      string   `json:"billing_expr"`
}

type upstreamTier struct {
	Label          string
	MaxInputTokens *int
	Input          float64
	Output         float64
	CacheRead      float64
	CacheWrite     float64
	CacheWrite1H   float64
}

type upstreamPricingCandidate struct {
	BillingMode BillingMode
	Input       float64
	Output      float64
	CacheRead   float64
	CacheWrite  float64
	PerRequest  float64
	Intervals   []PricingInterval
	Warning     string
}

type UpstreamPricingSyncRequest struct {
	Platform string
	Group    string
	Models   []string
}

type UpstreamPricingGroupOption struct {
	Name  string  `json:"name"`
	Ratio float64 `json:"ratio"`
}

type UpstreamPricingSyncDetail struct {
	Model      string  `json:"model"`
	Status     string  `json:"status"`
	Group      string  `json:"group,omitempty"`
	GroupRatio float64 `json:"group_ratio,omitempty"`
	Reason     string  `json:"reason,omitempty"`
}

type UpstreamPricingSyncResult struct {
	Channel        *Channel                    `json:"-"`
	Platform       string                      `json:"platform"`
	PricingVersion string                      `json:"pricing_version"`
	Added          int                         `json:"added"`
	Updated        int                         `json:"updated"`
	Unchanged      int                         `json:"unchanged"`
	Missing        int                         `json:"missing"`
	Skipped        int                         `json:"skipped"`
	Groups         map[string]int              `json:"groups"`
	Warnings       []string                    `json:"warnings"`
	Details        []UpstreamPricingSyncDetail `json:"details"`
}

var (
	upstreamBillingExprRE = regexp.MustCompile(`^v1:\s*len\s*(<=|<)\s*(\d{1,9})\s*\?\s*(tier\("[A-Za-z0-9_-]{1,80}"\s*,\s*[^)]{1,600}\))\s*:\s*(tier\("[A-Za-z0-9_-]{1,80}"\s*,\s*[^)]{1,600}\))$`)
	upstreamTierRE        = regexp.MustCompile(`^tier\(\s*"([A-Za-z0-9_-]{1,80})"\s*,\s*([^)]+)\s*\)$`)
	upstreamTermRE        = regexp.MustCompile(`^(p|c|cr|cc|cc1h)\s*\*\s*([0-9]+(?:\.[0-9]+)?)$`)
)

func fetchUpstreamPricingCatalog(ctx context.Context) (*upstreamPricingCatalog, error) {
	requestCtx, cancel := context.WithTimeout(ctx, upstreamPricingTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, upstreamPricingAPIURL, nil)
	if err != nil {
		return nil, infraerrors.BadRequest("UPSTREAM_PRICING_REQUEST_FAILED", "无法创建上游定价请求").WithCause(err)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := upstreamPricingHTTPClient.Do(req)
	if err != nil {
		if requestCtx.Err() != nil {
			return nil, infraerrors.New(504, "UPSTREAM_PRICING_TIMEOUT", "读取上游定价超时，请稍后重试").WithCause(err)
		}
		return nil, infraerrors.New(502, "UPSTREAM_PRICING_REQUEST_FAILED", "读取上游定价失败").WithCause(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, infraerrors.New(502, "UPSTREAM_PRICING_BAD_STATUS", fmt.Sprintf("读取上游定价失败（HTTP %d）", resp.StatusCode))
	}
	if resp.ContentLength > upstreamPricingMaxBytes {
		return nil, infraerrors.New(502, "UPSTREAM_PRICING_TOO_LARGE", "上游定价响应超出安全大小限制")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, upstreamPricingMaxBytes+1))
	if err != nil {
		return nil, infraerrors.New(502, "UPSTREAM_PRICING_READ_FAILED", "读取上游定价响应失败").WithCause(err)
	}
	if len(body) > upstreamPricingMaxBytes {
		return nil, infraerrors.New(502, "UPSTREAM_PRICING_TOO_LARGE", "上游定价响应超出安全大小限制")
	}

	var catalog upstreamPricingCatalog
	if err := json.Unmarshal(body, &catalog); err != nil {
		return nil, infraerrors.New(502, "UPSTREAM_PRICING_INVALID_JSON", "上游定价接口返回了无效 JSON").WithCause(err)
	}
	if !catalog.Success || len(catalog.Data) > 5000 || len(catalog.GroupRatio) == 0 {
		return nil, infraerrors.New(502, "UPSTREAM_PRICING_INVALID_RESPONSE", "上游定价接口未返回有效模型列表")
	}
	for i := range catalog.Data {
		catalog.Data[i].ModelName = strings.TrimSpace(catalog.Data[i].ModelName)
		if catalog.Data[i].ModelName == "" {
			return nil, infraerrors.New(502, "UPSTREAM_PRICING_INVALID_RESPONSE", "上游定价接口包含空模型名")
		}
	}
	return &catalog, nil
}

func normalizePricingModelName(model string) string {
	return strings.ToLower(strings.TrimSpace(model))
}

// pricingPatternCoversModel reports whether an existing exact or trailing-
// wildcard channel pricing entry already covers a concrete upstream model.
// Wildcards must be checked before adding catalog models, otherwise a sync
// would create conflicting exact entries beneath an intentional catch-all.
func pricingPatternCoversModel(pattern, model string) bool {
	pattern = normalizePricingModelName(pattern)
	model = normalizePricingModelName(model)
	if pattern == "" || model == "" {
		return false
	}
	if strings.HasSuffix(pattern, "*") {
		return strings.HasPrefix(model, strings.TrimSuffix(pattern, "*"))
	}
	return pattern == model
}

func pricingPatternsCoverModel(patterns []string, model string) bool {
	for _, pattern := range patterns {
		if pricingPatternCoversModel(pattern, model) {
			return true
		}
	}
	return false
}

func parseUpstreamTiers(expression string) ([]upstreamTier, error) {
	source := strings.TrimSpace(expression)
	if source == "" || len(source) > 1600 {
		return nil, fmt.Errorf("billing expression is empty or too long")
	}
	match := upstreamBillingExprRE.FindStringSubmatch(source)
	if len(match) != 5 {
		return nil, fmt.Errorf("unsupported billing expression")
	}
	threshold := 0
	if _, err := fmt.Sscanf(match[2], "%d", &threshold); err != nil || threshold <= 0 {
		return nil, fmt.Errorf("invalid billing threshold")
	}
	first, err := parseUpstreamTier(match[3])
	if err != nil {
		return nil, err
	}
	second, err := parseUpstreamTier(match[4])
	if err != nil {
		return nil, err
	}
	first.MaxInputTokens = &threshold
	second.MaxInputTokens = nil
	if match[1] == "<" {
		if threshold <= 1 {
			return nil, fmt.Errorf("invalid billing threshold")
		}
		first.MaxInputTokens = upstreamPtrInt(threshold - 1)
	}
	return []upstreamTier{first, second}, nil
}

func parseUpstreamTier(source string) (upstreamTier, error) {
	match := upstreamTierRE.FindStringSubmatch(strings.TrimSpace(source))
	if len(match) != 3 {
		return upstreamTier{}, fmt.Errorf("unsupported tier expression")
	}
	terms := strings.Split(match[2], "+")
	if len(terms) == 0 || len(terms) > 6 {
		return upstreamTier{}, fmt.Errorf("invalid tier terms")
	}
	tier := upstreamTier{Label: match[1]}
	seen := make(map[string]bool, len(terms))
	for _, rawTerm := range terms {
		term := upstreamTermRE.FindStringSubmatch(strings.TrimSpace(rawTerm))
		if len(term) != 3 || seen[term[1]] {
			return upstreamTier{}, fmt.Errorf("invalid tier term")
		}
		value := 0.0
		if _, err := fmt.Sscanf(term[2], "%f", &value); err != nil || !isFiniteNonNegative(value) || value > 1_000_000 {
			return upstreamTier{}, fmt.Errorf("invalid tier value")
		}
		seen[term[1]] = true
		switch term[1] {
		case "p":
			tier.Input = value
		case "c":
			tier.Output = value
		case "cr":
			tier.CacheRead = value
		case "cc":
			tier.CacheWrite = value
		case "cc1h":
			tier.CacheWrite1H = value
		}
	}
	if !seen["p"] || !seen["c"] {
		return upstreamTier{}, fmt.Errorf("tier must include input and output")
	}
	if !seen["cc1h"] {
		tier.CacheWrite1H = tier.CacheWrite
	}
	return tier, nil
}

func chooseUpstreamGroup(model upstreamPricingModel, catalog *upstreamPricingCatalog, requested string) (string, float64, error) {
	requested = strings.TrimSpace(requested)
	available := make([]string, 0, len(model.EnableGroups))
	seen := make(map[string]bool, len(model.EnableGroups))
	for _, group := range model.EnableGroups {
		group = strings.TrimSpace(group)
		ratio := catalog.GroupRatio[group]
		if group == "" || seen[group] || !isFinitePositive(ratio) || ratio > 1000 {
			continue
		}
		seen[group] = true
		available = append(available, group)
	}
	if len(available) == 0 {
		return "", 0, fmt.Errorf("model has no usable upstream pricing group")
	}
	if requested != "" {
		for _, group := range available {
			if group == requested {
				return group, catalog.GroupRatio[group], nil
			}
		}
		return "", 0, fmt.Errorf("requested upstream pricing group is not enabled for model")
	}
	sort.SliceStable(available, func(i, j int) bool {
		left, right := catalog.GroupRatio[available[i]], catalog.GroupRatio[available[j]]
		if left == right {
			return available[i] < available[j]
		}
		return left < right
	})
	group := available[0]
	return group, catalog.GroupRatio[group], nil
}

func buildUpstreamPricingCandidate(model upstreamPricingModel, groupRatio float64) (*upstreamPricingCandidate, error) {
	if !isFinitePositive(groupRatio) || groupRatio > 1000 {
		return nil, fmt.Errorf("invalid upstream group ratio")
	}
	if model.QuotaType == 1 {
		if !isFinitePositive(model.ModelPrice) || model.ModelPrice > 1_000_000 {
			return nil, fmt.Errorf("model has no usable request price")
		}
		return &upstreamPricingCandidate{
			BillingMode: BillingModePerRequest,
			// Keep the customer-facing channel price at the upstream
			// catalog's pre-group (official/reference) price. The selected
			// group ratio is stored separately as upstream cost metadata.
			PerRequest: model.ModelPrice,
		}, nil
	}
	if strings.TrimSpace(model.BillingExpr) != "" {
		tiers, err := parseUpstreamTiers(model.BillingExpr)
		if err != nil {
			return nil, err
		}
		intervals := make([]PricingInterval, 0, len(tiers))
		cacheWriteWarning := ""
		for index, tier := range tiers {
			if tier.CacheWrite != tier.CacheWrite1H {
				cacheWriteWarning = "上游同时提供普通与 1 小时缓存写入价；Sub2API 当前仅保存普通缓存写入价。"
			}
			inputM := tier.Input
			outputM := tier.Output
			cacheReadM := tier.CacheRead
			cacheWriteM := tier.CacheWrite
			if !isFinitePositive(inputM) || !isFinitePositive(outputM) || !isFiniteNonNegative(cacheReadM) || !isFiniteNonNegative(cacheWriteM) {
				return nil, fmt.Errorf("tier prices exceed the supported range")
			}
			input := perTokenPrice(inputM)
			output := perTokenPrice(outputM)
			cacheRead := perTokenPrice(cacheReadM)
			cacheWrite := perTokenPrice(cacheWriteM)
			minTokens := 0
			if index > 0 && tiers[index-1].MaxInputTokens != nil {
				// Sub2API uses (min_tokens, max_tokens] semantics. The next
				// tier therefore starts at the previous tier's upper bound.
				minTokens = *tiers[index-1].MaxInputTokens
			}
			intervals = append(intervals, PricingInterval{
				MinTokens:       minTokens,
				MaxTokens:       tier.MaxInputTokens,
				TierLabel:       tier.Label,
				InputPrice:      &input,
				OutputPrice:     &output,
				CacheWritePrice: &cacheWrite,
				CacheReadPrice:  &cacheRead,
				SortOrder:       index,
			})
		}
		return &upstreamPricingCandidate{
			BillingMode: BillingModeToken,
			Input:       *intervals[0].InputPrice,
			Output:      *intervals[0].OutputPrice,
			CacheRead:   *intervals[0].CacheReadPrice,
			CacheWrite:  *intervals[0].CacheWritePrice,
			Intervals:   intervals,
			Warning:     cacheWriteWarning,
		}, nil
	}

	if !isFinitePositive(model.ModelRatio) || model.ModelRatio > 100_000 || !isFinitePositive(model.CompletionRatio) || model.CompletionRatio > 100_000 {
		return nil, fmt.Errorf("model has no usable token ratios")
	}
	if !isFiniteNonNegative(model.CacheRatio) || model.CacheRatio > 100_000 || !isFiniteNonNegative(model.CreateCacheRatio) || model.CreateCacheRatio > 100_000 {
		return nil, fmt.Errorf("model has invalid cache ratios")
	}
	inputM := upstreamTokenBasePriceM * model.ModelRatio
	if !isFinitePositive(inputM) || !isFinitePositive(inputM*model.CompletionRatio) {
		return nil, fmt.Errorf("model token prices exceed the supported range")
	}
	input := perTokenPrice(inputM)
	output := perTokenPrice(inputM * model.CompletionRatio)
	cacheRead := perTokenPrice(inputM * nonNegative(model.CacheRatio))
	cacheWrite := perTokenPrice(inputM * nonNegative(model.CreateCacheRatio))
	return &upstreamPricingCandidate{
		BillingMode: BillingModeToken,
		Input:       input,
		Output:      output,
		CacheRead:   cacheRead,
		CacheWrite:  cacheWrite,
	}, nil
}

func (s *ChannelService) ListUpstreamPricingGroups(ctx context.Context) ([]UpstreamPricingGroupOption, string, error) {
	catalog, err := loadUpstreamPricingCatalog(ctx)
	if err != nil {
		return nil, "", err
	}
	groups := make([]UpstreamPricingGroupOption, 0, len(catalog.GroupRatio))
	for name, ratio := range catalog.GroupRatio {
		name = strings.TrimSpace(name)
		if name == "" || !isFinitePositive(ratio) || ratio > 1000 {
			continue
		}
		groups = append(groups, UpstreamPricingGroupOption{Name: name, Ratio: ratio})
	}
	sort.SliceStable(groups, func(i, j int) bool {
		if groups[i].Ratio == groups[j].Ratio {
			return groups[i].Name < groups[j].Name
		}
		return groups[i].Ratio < groups[j].Ratio
	})
	return groups, strings.TrimSpace(catalog.PricingVersion), nil
}

func (s *ChannelService) SyncUpstreamPricing(ctx context.Context, channelID int64, req UpstreamPricingSyncRequest) (*UpstreamPricingSyncResult, error) {
	platform := strings.ToLower(strings.TrimSpace(req.Platform))
	if platform == "" {
		return nil, infraerrors.BadRequest("MISSING_PARAMETER", "platform parameter is required")
	}
	channel, err := s.GetByID(ctx, channelID)
	if err != nil {
		return nil, err
	}
	catalog, err := loadUpstreamPricingCatalog(ctx)
	if err != nil {
		return nil, err
	}
	modelMap := make(map[string]upstreamPricingModel, len(catalog.Data))
	for _, model := range catalog.Data {
		modelMap[normalizePricingModelName(model.ModelName)] = model
	}
	requestedModels := make(map[string]bool, len(req.Models))
	for _, model := range req.Models {
		if normalized := normalizePricingModelName(model); normalized != "" {
			requestedModels[normalized] = true
		}
	}

	result := &UpstreamPricingSyncResult{
		Channel:        channel,
		Platform:       platform,
		PricingVersion: strings.TrimSpace(catalog.PricingVersion),
		Groups:         make(map[string]int),
		Warnings:       []string{},
		Details:        []UpstreamPricingSyncDetail{},
	}
	if strings.TrimSpace(req.Group) == "" {
		result.Warnings = append(result.Warnings, "未指定上游分组时，每个模型使用其可用分组中倍率最低的一档；不会修改 Sub2API 自有分组倍率。")
	}

	// Keep the existing channel model list authoritative for custom aliases and
	// wildcards, while allowing this sync to add catalog models that were never
	// entered into channel pricing. Without this pass, the model plaza can list
	// a model but has no channel-native price to display for it.
	existingPatterns := make([]string, 0)
	for _, entry := range channel.ModelPricing {
		entryPlatform := strings.ToLower(strings.TrimSpace(entry.Platform))
		if entryPlatform == "" {
			entryPlatform = PlatformAnthropic
		}
		if entryPlatform != platform {
			continue
		}
		existingPatterns = append(existingPatterns, entry.Models...)
	}

	newPricing := make([]ChannelModelPricing, 0, len(channel.ModelPricing))
	changed := false
	for _, entry := range channel.ModelPricing {
		entryPlatform := strings.ToLower(strings.TrimSpace(entry.Platform))
		if entryPlatform == "" {
			entryPlatform = PlatformAnthropic
		}
		if entryPlatform != platform {
			newPricing = append(newPricing, cloneChannelModelPricing(entry))
			continue
		}
		for _, modelName := range entry.Models {
			modelKey := normalizePricingModelName(modelName)
			if strings.HasSuffix(modelKey, "*") || (len(requestedModels) > 0 && !requestedModels[modelKey]) {
				newPricing = append(newPricing, clonePricingWithModels(entry, []string{modelName}))
				continue
			}
			upstreamModel, found := modelMap[modelKey]
			if !found {
				result.Missing++
				appendSyncDetail(result, UpstreamPricingSyncDetail{Model: modelName, Status: "missing", Reason: "上游模型广场未找到同名模型"})
				newPricing = append(newPricing, clonePricingWithModels(entry, []string{modelName}))
				continue
			}
			group, ratio, groupErr := chooseUpstreamGroup(upstreamModel, catalog, req.Group)
			if groupErr != nil {
				result.Skipped++
				appendSyncDetail(result, UpstreamPricingSyncDetail{Model: modelName, Status: "skipped", Reason: groupErr.Error()})
				newPricing = append(newPricing, clonePricingWithModels(entry, []string{modelName}))
				continue
			}
			candidate, buildErr := buildUpstreamPricingCandidate(upstreamModel, ratio)
			if buildErr != nil {
				result.Skipped++
				appendSyncDetail(result, UpstreamPricingSyncDetail{Model: modelName, Status: "skipped", Group: group, GroupRatio: ratio, Reason: buildErr.Error()})
				newPricing = append(newPricing, clonePricingWithModels(entry, []string{modelName}))
				continue
			}
			if candidate.Warning != "" {
				result.Warnings = append(result.Warnings, fmt.Sprintf("%s：%s", modelName, candidate.Warning))
			}
			next := clonePricingWithModels(entry, []string{modelName})
			applyUpstreamCandidate(&next, candidate, group, ratio, result.PricingVersion)
			if channelPricingEquivalent(&entry, &next) {
				result.Unchanged++
				appendSyncDetail(result, UpstreamPricingSyncDetail{Model: modelName, Status: "unchanged", Group: group, GroupRatio: ratio})
			} else {
				result.Updated++
				changed = true
				appendSyncDetail(result, UpstreamPricingSyncDetail{Model: modelName, Status: "updated", Group: group, GroupRatio: ratio})
			}
			result.Groups[group]++
			newPricing = append(newPricing, next)
		}
	}

	for _, upstreamModel := range catalog.Data {
		modelKey := normalizePricingModelName(upstreamModel.ModelName)
		if modelKey == "" || pricingPatternsCoverModel(existingPatterns, modelKey) {
			continue
		}
		if len(requestedModels) > 0 && !requestedModels[modelKey] {
			continue
		}

		// With an explicit group, only add models that are actually enabled in
		// that group. Models from other providers remain available to a later
		// sync targeting their own upstream group.
		if strings.TrimSpace(req.Group) != "" {
			if _, _, err := chooseUpstreamGroup(upstreamModel, catalog, req.Group); err != nil {
				continue
			}
		}
		group, ratio, groupErr := chooseUpstreamGroup(upstreamModel, catalog, req.Group)
		if groupErr != nil {
			result.Skipped++
			appendSyncDetail(result, UpstreamPricingSyncDetail{Model: upstreamModel.ModelName, Status: "skipped", Reason: groupErr.Error()})
			continue
		}
		candidate, buildErr := buildUpstreamPricingCandidate(upstreamModel, ratio)
		if buildErr != nil {
			result.Skipped++
			appendSyncDetail(result, UpstreamPricingSyncDetail{Model: upstreamModel.ModelName, Status: "skipped", Group: group, GroupRatio: ratio, Reason: buildErr.Error()})
			continue
		}
		if candidate.Warning != "" {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s：%s", upstreamModel.ModelName, candidate.Warning))
		}
		next := ChannelModelPricing{
			Platform: platform,
			Models:   []string{upstreamModel.ModelName},
		}
		applyUpstreamCandidate(&next, candidate, group, ratio, result.PricingVersion)
		newPricing = append(newPricing, next)
		existingPatterns = append(existingPatterns, upstreamModel.ModelName)
		result.Added++
		result.Groups[group]++
		appendSyncDetail(result, UpstreamPricingSyncDetail{
			Model:      upstreamModel.ModelName,
			Status:     "updated",
			Group:      group,
			GroupRatio: ratio,
			Reason:     "新增上游模型定价",
		})
		changed = true
	}

	if changed {
		if err := validatePricingEntries(newPricing); err != nil {
			return nil, fmt.Errorf("validate synced pricing: %w", err)
		}
		if err := s.repo.ReplaceModelPricing(ctx, channelID, newPricing); err != nil {
			return nil, fmt.Errorf("save synced pricing: %w", err)
		}
		s.invalidateCache()
		channel, err = s.GetByID(ctx, channelID)
		if err != nil {
			return nil, err
		}
		result.Channel = channel
	}
	return result, nil
}

func applyUpstreamCandidate(entry *ChannelModelPricing, candidate *upstreamPricingCandidate, group string, groupRatio float64, pricingVersion string) {
	entry.BillingMode = candidate.BillingMode
	entry.UpstreamCostMultiplier = float64Ptr(groupRatio)
	entry.UpstreamPricingGroup = strings.TrimSpace(group)
	entry.UpstreamPricingVersion = strings.TrimSpace(pricingVersion)
	entry.InputPrice = nil
	entry.OutputPrice = nil
	entry.CacheWritePrice = nil
	entry.CacheReadPrice = nil
	entry.ImageInputPrice = nil
	entry.ImageOutputPrice = nil
	entry.PerRequestPrice = nil
	entry.Intervals = nil
	if candidate.BillingMode == BillingModePerRequest {
		value := candidate.PerRequest
		entry.PerRequestPrice = &value
		return
	}
	input, output, cacheWrite, cacheRead := candidate.Input, candidate.Output, candidate.CacheWrite, candidate.CacheRead
	entry.InputPrice = &input
	entry.OutputPrice = &output
	entry.CacheWritePrice = &cacheWrite
	entry.CacheReadPrice = &cacheRead
	entry.Intervals = cloneIntervals(candidate.Intervals)
}

func channelPricingEquivalent(left, right *ChannelModelPricing) bool {
	if left == nil || right == nil || left.BillingMode != right.BillingMode || !floatPtrEqual(left.InputPrice, right.InputPrice) || !floatPtrEqual(left.OutputPrice, right.OutputPrice) || !floatPtrEqual(left.CacheWritePrice, right.CacheWritePrice) || !floatPtrEqual(left.CacheReadPrice, right.CacheReadPrice) || !floatPtrEqual(left.ImageInputPrice, right.ImageInputPrice) || !floatPtrEqual(left.ImageOutputPrice, right.ImageOutputPrice) || !floatPtrEqual(left.PerRequestPrice, right.PerRequestPrice) || !floatPtrEqual(left.UpstreamCostMultiplier, right.UpstreamCostMultiplier) || left.UpstreamPricingGroup != right.UpstreamPricingGroup || left.UpstreamPricingVersion != right.UpstreamPricingVersion || len(left.Intervals) != len(right.Intervals) {
		return false
	}
	for i := range left.Intervals {
		l, r := left.Intervals[i], right.Intervals[i]
		if l.MinTokens != r.MinTokens || !intPtrEqual(l.MaxTokens, r.MaxTokens) || l.TierLabel != r.TierLabel || l.SortOrder != r.SortOrder || !floatPtrEqual(l.InputPrice, r.InputPrice) || !floatPtrEqual(l.OutputPrice, r.OutputPrice) || !floatPtrEqual(l.CacheWritePrice, r.CacheWritePrice) || !floatPtrEqual(l.CacheReadPrice, r.CacheReadPrice) || !floatPtrEqual(l.PerRequestPrice, r.PerRequestPrice) {
			return false
		}
	}
	return true
}

func cloneChannelModelPricing(source ChannelModelPricing) ChannelModelPricing {
	return clonePricingWithModels(source, append([]string(nil), source.Models...))
}

func clonePricingWithModels(source ChannelModelPricing, models []string) ChannelModelPricing {
	clone := source
	clone.ID = 0
	clone.Models = append([]string(nil), models...)
	clone.Intervals = cloneIntervals(source.Intervals)
	return clone
}

func cloneIntervals(source []PricingInterval) []PricingInterval {
	if source == nil {
		return nil
	}
	clone := make([]PricingInterval, len(source))
	copy(clone, source)
	return clone
}

func appendSyncDetail(result *UpstreamPricingSyncResult, detail UpstreamPricingSyncDetail) {
	if len(result.Details) < upstreamPricingDetailLimit {
		result.Details = append(result.Details, detail)
	}
}

func perTokenPrice(pricePerMillion float64) float64 {
	return pricePerMillion / 1_000_000
}

func isFinitePositive(value float64) bool { return isFiniteNonNegative(value) && value > 0 }
func isFiniteNonNegative(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
}
func nonNegative(value float64) float64 {
	if !isFiniteNonNegative(value) {
		return 0
	}
	return value
}
func upstreamPtrInt(value int) *int { return &value }
func floatPtrEqual(left, right *float64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return math.Abs(*left-*right) <= 1e-15
}
func intPtrEqual(left, right *int) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}
