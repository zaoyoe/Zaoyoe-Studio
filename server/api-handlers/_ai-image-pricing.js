function toObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeNumber(value, fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER, precision = 6 } = {}) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const factor = 10 ** Math.max(0, Number(precision) || 0);
    return Math.min(max, Math.max(min, Math.round(parsed * factor) / factor));
}

function normalizePoints(value, fallback = 0) {
    return normalizeNumber(value, fallback, { min: 0, max: Number.MAX_SAFE_INTEGER, precision: 6 });
}

function normalizeInt(value, fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeBillingStrategy(value = 'per_request') {
    const normalized = String(value || '').trim().toLowerCase().replace(/-/g, '_');
    return ['per_request', 'token_sub2api', 'fixed_points'].includes(normalized)
        ? normalized
        : 'per_request';
}

function normalizeProviderId(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw === '*' || raw.toLowerCase() === 'all') return '*';
    return raw
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function normalizeAiImagePricingMetadata(value = {}) {
    const metadata = toObject(value);
    const pricing = toObject(metadata.pricing);
    const rates = toObject(pricing.rates);
    const estimate = toObject(pricing.estimate);
    const billingStrategy = normalizeBillingStrategy(
        metadata.billing_strategy
        || metadata.billingStrategy
        || pricing.billing_strategy
        || pricing.billingStrategy
    );
    const providerId = normalizeProviderId(
        metadata.provider_id
        || metadata.providerId
        || pricing.provider_id
        || pricing.providerId
    );
    const providerLabel = String(
        metadata.provider_label
        || metadata.providerLabel
        || pricing.provider_label
        || pricing.providerLabel
        || ''
    ).trim().slice(0, 120);

    return {
        ...metadata,
        billing_strategy: billingStrategy,
        provider_id: providerId,
        providerId,
        provider_label: providerLabel,
        providerLabel,
        pricing: {
            ...pricing,
            billing_strategy: billingStrategy,
            provider_id: providerId,
            providerId,
            provider_label: providerLabel,
            providerLabel,
            unit: pricing.unit || (billingStrategy === 'token_sub2api' ? 'sub2api_actual_cost_usd' : 'points'),
            cost_source: pricing.cost_source || pricing.costSource || (billingStrategy === 'token_sub2api' ? 'sub2api_usage_actual_cost' : ''),
            points_per_usd: normalizeNumber(pricing.points_per_usd ?? pricing.pointsPerUsd, 1, { min: 0, max: 1000, precision: 6 }) || 1,
            request_base: normalizeNumber(pricing.request_base ?? pricing.requestBase ?? pricing.per_request ?? pricing.perRequest, 0, { precision: 2 }),
            multiplier: normalizeNumber(pricing.multiplier, 1, { min: 0, max: 1000, precision: 4 }) || 1,
            rates: {
                input: normalizeNumber(rates.input ?? rates.input_per_million ?? rates.inputPerMillion, 0),
                output: normalizeNumber(rates.output ?? rates.output_per_million ?? rates.outputPerMillion, 0),
                cache_write: normalizeNumber(rates.cache_write ?? rates.cacheWrite, 0),
                cache_read: normalizeNumber(rates.cache_read ?? rates.cacheRead, 0),
                image_output: normalizeNumber(rates.image_output ?? rates.imageOutput, 0)
            },
            estimate: {
                input_tokens: normalizeInt(estimate.input_tokens ?? estimate.inputTokens, 0),
                output_tokens: normalizeInt(estimate.output_tokens ?? estimate.outputTokens, 0),
                cache_write_tokens: normalizeInt(estimate.cache_write_tokens ?? estimate.cacheWriteTokens, 0),
                cache_read_tokens: normalizeInt(estimate.cache_read_tokens ?? estimate.cacheReadTokens, 0),
                image_output_tokens: normalizeInt(estimate.image_output_tokens ?? estimate.imageOutputTokens, 0),
                estimated_points: normalizePoints(estimate.estimated_points ?? estimate.estimatedPoints, 0)
            },
            sub2api_compatible: billingStrategy === 'token_sub2api'
        }
    };
}

function pickNestedValue(source = {}, paths = []) {
    for (const path of paths) {
        let current = source;
        for (const key of path) {
            if (!current || typeof current !== 'object' || Array.isArray(current) || !(key in current)) {
                current = undefined;
                break;
            }
            current = current[key];
        }
        if (current !== undefined && current !== null && current !== '') {
            return {
                value: current,
                path: path.join('.')
            };
        }
    }
    return null;
}

function extractAiImageSub2ApiActualCost(value = {}) {
    const usage = toObject(value);
    if (!Object.keys(usage).length) return null;
    const candidate = pickNestedValue(usage, [
        ['sub2api', 'actual_cost'],
        ['sub2api', 'actualCost'],
        ['sub2api', 'actual_cost_usd'],
        ['sub2api', 'actualCostUsd'],
        ['sub2api_usage', 'actual_cost'],
        ['sub2apiUsage', 'actualCost'],
        ['billing', 'actual_cost'],
        ['billing', 'actualCost'],
        ['pricing', 'actual_cost'],
        ['pricing', 'actualCost'],
        ['usage', 'actual_cost'],
        ['usage', 'actualCost'],
        ['actual_cost'],
        ['actualCost'],
        ['actual_cost_usd'],
        ['actualCostUsd'],
        ['sub2api_actual_cost'],
        ['sub2apiActualCost'],
        ['sub2api_cost'],
        ['sub2apiCost']
    ]);
    if (!candidate) return null;
    const cost = normalizePoints(candidate.value, 0);
    if (cost <= 0) return null;
    return {
        cost,
        path: candidate.path
    };
}

function getAiImagePricingStrategy(rule = {}) {
    return normalizeAiImagePricingMetadata(rule.metadata || {}).billing_strategy;
}

function getAiImagePricingProviderId(rule = {}) {
    return normalizeAiImagePricingMetadata(rule.metadata || {}).provider_id
        || normalizeProviderId(rule.provider_id || rule.providerId);
}

function normalizeAiImagePricingUsage(value = {}) {
    const usage = toObject(value);
    const inputDetails = toObject(usage.input_tokens_details || usage.inputTokenDetails || usage.prompt_tokens_details || usage.promptTokenDetails);
    const outputDetails = toObject(usage.output_tokens_details || usage.outputTokenDetails || usage.completion_tokens_details || usage.completionTokenDetails);
    const cacheCreation = toObject(usage.cache_creation || usage.cacheCreation);
    const inputTokens = normalizeInt(
        usage.input_tokens
        ?? usage.inputTokens
        ?? usage.prompt_tokens
        ?? usage.promptTokens
        ?? usage.promptTokenCount
        ?? usage.total_input_tokens
        ?? usage.totalInputTokens,
        0
    );
    const outputTokens = normalizeInt(
        usage.output_tokens
        ?? usage.outputTokens
        ?? usage.completion_tokens
        ?? usage.completionTokens
        ?? usage.candidatesTokenCount
        ?? usage.total_output_tokens
        ?? usage.totalOutputTokens,
        0
    );
    const cacheReadTokens = normalizeInt(
        usage.cache_read_tokens
        ?? usage.cacheReadTokens
        ?? usage.cache_read_input_tokens
        ?? usage.cacheReadInputTokens
        ?? inputDetails.cached_tokens
        ?? inputDetails.cachedTokens,
        0
    );
    const cacheWriteTokens = normalizeInt(
        usage.cache_write_tokens
        ?? usage.cacheWriteTokens
        ?? usage.cache_creation_tokens
        ?? usage.cacheCreationTokens
        ?? usage.cache_creation_input_tokens
        ?? usage.cacheCreationInputTokens,
        normalizeInt(cacheCreation.ephemeral_5m_input_tokens ?? cacheCreation.ephemeral5mInputTokens, 0)
            + normalizeInt(cacheCreation.ephemeral_1h_input_tokens ?? cacheCreation.ephemeral1hInputTokens, 0)
    );
    const imageOutputTokens = normalizeInt(
        usage.image_output_tokens
        ?? usage.imageOutputTokens
        ?? outputDetails.image_tokens
        ?? outputDetails.imageTokens,
        0
    );

    return {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_write_tokens: cacheWriteTokens,
        cache_read_tokens: cacheReadTokens,
        image_output_tokens: imageOutputTokens,
        total_tokens: normalizeInt(usage.total_tokens ?? usage.totalTokens ?? usage.totalTokenCount, inputTokens + outputTokens)
    };
}

function calculateAiImageSub2ApiTokenPoints(rule = {}, usageInput = {}) {
    const metadata = normalizeAiImagePricingMetadata(rule.metadata || {});
    const pricing = metadata.pricing;
    const rates = pricing.rates;
    const usage = normalizeAiImagePricingUsage(usageInput);
    const billableInputTokens = Math.max(0, usage.input_tokens - usage.cache_read_tokens);
    const billableOutputTokens = Math.max(0, usage.output_tokens - usage.image_output_tokens);
    const inputCost = billableInputTokens * rates.input / 1000000;
    const outputCost = billableOutputTokens * rates.output / 1000000;
    const cacheWriteCost = usage.cache_write_tokens * rates.cache_write / 1000000;
    const cacheReadCost = usage.cache_read_tokens * rates.cache_read / 1000000;
    const imageOutputCost = usage.image_output_tokens * rates.image_output / 1000000;
    const totalCost = pricing.request_base + inputCost + outputCost + cacheWriteCost + cacheReadCost + imageOutputCost;
    const actualCost = totalCost * pricing.multiplier;

    return {
        points: normalizePoints(actualCost, 0),
        billing_strategy: 'token_sub2api',
        usage,
        breakdown: {
            request_base: normalizePoints(pricing.request_base, 0),
            input: normalizePoints(inputCost, 0),
            output: normalizePoints(outputCost, 0),
            cache_write: normalizePoints(cacheWriteCost, 0),
            cache_read: normalizePoints(cacheReadCost, 0),
            image_output: normalizePoints(imageOutputCost, 0),
            total: normalizePoints(totalCost, 0),
            actual: normalizePoints(actualCost, 0),
            multiplier: pricing.multiplier
        }
    };
}

function estimateAiImageRulePoints(rule = {}, quantity = 1) {
    const strategy = getAiImagePricingStrategy(rule);
    const count = normalizeInt(quantity, 1, { min: 1, max: 1000 });
    if (strategy === 'token_sub2api') {
        const metadata = normalizeAiImagePricingMetadata(rule.metadata || {});
        const estimate = metadata.pricing.estimate;
        const result = calculateAiImageSub2ApiTokenPoints(rule, estimate);
        return {
            estimatedPoints: result.points || normalizePoints(rule.points, 0),
            source: 'rule',
            billingStrategy: strategy,
            pricing: result
        };
    }
    const points = normalizePoints(rule.points, 0);
    const multiplier = strategy === 'fixed_points' ? 1 : count;
    return {
        estimatedPoints: normalizePoints(points * multiplier, 0),
        source: 'rule',
        billingStrategy: strategy,
        pricing: {
            billing_strategy: strategy,
            points
        }
    };
}

function calculateAiImageRuleChargePoints(task = {}, usageInput = {}) {
    const pricing = toObject(toObject(task.metadata).pricing);
    const matchedRule = toObject(pricing.matched_rule || pricing.matchedRule);
    if (!matchedRule.id && !matchedRule.metadata) {
        return {
            points: normalizePoints(task.estimated_points, 0),
            source: 'estimated'
        };
    }

    const strategy = getAiImagePricingStrategy(matchedRule);
    if (strategy === 'token_sub2api') {
        const actual = extractAiImageSub2ApiActualCost(usageInput);
        if (actual) {
            const metadata = normalizeAiImagePricingMetadata(matchedRule.metadata || {});
            const pointsPerUsd = metadata.pricing.points_per_usd || 1;
            const points = normalizePoints(actual.cost * pointsPerUsd, 0);
            return {
                points,
                source: 'sub2api_actual_cost',
                pricing: {
                    billing_strategy: 'token_sub2api',
                    source: 'sub2api_actual_cost',
                    cost_source: 'sub2api_usage_actual_cost',
                    actual_cost_usd: actual.cost,
                    points_per_usd: pointsPerUsd,
                    usage_cost_field: actual.path,
                    usage: normalizeAiImagePricingUsage(usageInput),
                    breakdown: {
                        total: actual.cost,
                        actual: points,
                        points_per_usd: pointsPerUsd
                    }
                }
            };
        }
        const result = calculateAiImageSub2ApiTokenPoints(matchedRule, usageInput);
        return {
            points: result.points || normalizePoints(task.estimated_points, 0),
            source: 'token_sub2api_fallback',
            pricing: {
                ...result,
                source: 'manual_token_fallback'
            }
        };
    }

    const deliveredQuantity = normalizeInt(toObject(task.metadata).delivery?.charge_quantity ?? task.quantity, 1, { min: 1, max: 1000 });
    return {
        points: estimateAiImageRulePoints(matchedRule, deliveredQuantity).estimatedPoints,
        source: strategy,
        pricing: {
            billing_strategy: strategy
        }
    };
}

module.exports = {
    calculateAiImageRuleChargePoints,
    calculateAiImageSub2ApiTokenPoints,
    extractAiImageSub2ApiActualCost,
    estimateAiImageRulePoints,
    getAiImagePricingProviderId,
    getAiImagePricingStrategy,
    normalizeProviderId,
    normalizeAiImagePricingMetadata,
    normalizeAiImagePricingUsage
};
