const test = require('node:test');
const assert = require('node:assert/strict');

const {
    projectNewApiTieredPricing
} = require('../server/api-handlers/_newapi-pricing-projection');

test('NewAPI single-tier expressions project supported rates with the public group ratio', () => {
    const projected = projectNewApiTieredPricing(
        'tier("sub2api", p * 5 + c * 30 + cr * 0.5 + cc * 6.25 + cc1h * 7.5 + img_o * 2)',
        0.2
    );

    assert.deepEqual(projected, {
        fields: {
            input_price_per_million: 1,
            output_price_per_million: 6,
            cache_read_price_per_million: 0.1,
            cache_write_price_per_million: 1.25,
            cache_write_5m_price_per_million: 1.25,
            cache_write_1h_price_per_million: 1.5,
            image_output_price_per_million: 0.4
        },
        intervals: []
    });
});

test('NewAPI length tiers preserve <= and < integer token boundaries', () => {
    const lessThanOrEqual = projectNewApiTieredPricing(
        'v1:len <= 256000 ? tier("standard", p * 2 + c * 12 + cr * 0.2) : tier("long", p * 8 + c * 48 + cr * 0.8)',
        0.5
    );
    assert.deepEqual(lessThanOrEqual.intervals, [
        {
            min_tokens: 0,
            max_tokens: 256000,
            tier_label: '<= 256K Token',
            input_price_per_million: 1,
            output_price_per_million: 6,
            cache_read_price_per_million: 0.1
        },
        {
            min_tokens: 256000,
            max_tokens: null,
            tier_label: '> 256K Token',
            input_price_per_million: 4,
            output_price_per_million: 24,
            cache_read_price_per_million: 0.4
        }
    ]);

    const lessThan = projectNewApiTieredPricing(
        'v1:len < 32000 ? tier("short", p * 6 + c * 24) : tier("long", p * 8 + c * 28)',
        1
    );
    assert.equal(lessThan.intervals[0].max_tokens, 31999);
    assert.equal(lessThan.intervals[1].min_tokens, 31999);
    assert.equal(lessThan.intervals[0].tier_label, '< 32K Token');
    assert.equal(lessThan.intervals[1].tier_label, '>= 32K Token');
});

test('NewAPI reversed length tiers are sorted from shorter to longer contexts', () => {
    const greaterThan = projectNewApiTieredPricing(
        'len > 1000 ? tier("long", p * 4 + c * 8) : tier("short", p * 1 + c * 2)',
        1
    );
    assert.deepEqual(greaterThan.intervals.map((interval) => ({
        min: interval.min_tokens,
        max: interval.max_tokens,
        label: interval.tier_label,
        input: interval.input_price_per_million
    })), [
        { min: 0, max: 1000, label: '<= 1K Token', input: 1 },
        { min: 1000, max: null, label: '> 1K Token', input: 4 }
    ]);

    const greaterThanOrEqual = projectNewApiTieredPricing(
        'len >= 1000 ? tier("long", p * 4) : tier("short", p * 1)',
        1
    );
    assert.equal(greaterThanOrEqual.intervals[0].max_tokens, 999);
    assert.equal(greaterThanOrEqual.intervals[1].min_tokens, 999);
    assert.equal(greaterThanOrEqual.intervals[0].tier_label, '< 1K Token');
    assert.equal(greaterThanOrEqual.intervals[1].tier_label, '>= 1K Token');
});

test('NewAPI tier projection preserves explicit zero prices and rejects unsupported expressions', () => {
    assert.deepEqual(
        projectNewApiTieredPricing('tier("free", p * 1 + c * 2 + cr * 0)', 0),
        {
            fields: {
                input_price_per_million: 0,
                output_price_per_million: 0,
                cache_read_price_per_million: 0
            },
            intervals: []
        }
    );
    [
        'p <= 1000 ? tier("short", p * 1) : tier("long", p * 2)',
        'tier("base", p * 1) ||| (param("service_tier") == "priority" ? 2 : 1)',
        'tier("nonlinear", p * model_ratio + c * 2)',
        'tier("duplicate", p * 1 + p * 2)',
        'tier("unsupported", img * 1 + p * 2)'
    ].forEach((expression) => {
        assert.equal(projectNewApiTieredPricing(expression, 1), null, expression);
    });
});

test('current NewAPI multi-tier production expression shapes remain projectable', () => {
    const expressions = [
        'v1:len <= 256000 ? tier("input_lte_256k", p * 2 + cr * 0.2 + cc * 2.5 + c * 12) : tier("input_gt_256k", p * 8 + cr * 0.8 + cc * 10 + c * 48)',
        'v1:len <= 256000 ? tier("input_lte_256k_current_discount", p * 1.6 + cr * 0.16 + cc * 2 + c * 6.4) : tier("input_gt_256k_current_discount", p * 4.8 + cr * 0.48 + cc * 6 + c * 19.2)',
        'v1:len <= 272000 ? tier("standard", p * 5 + cr * 0.5 + cc * 6.25 + cc1h * 6.25 + c * 30) : tier("long_context", p * 10 + cr * 1 + cc * 12.5 + cc1h * 12.5 + c * 45)',
        'v1:len <= 272000 ? tier("standard", p * 2 + cr * 0.2 + cc * 2.5 + cc1h * 2.5 + c * 12) : tier("long_context", p * 4 + cr * 0.4 + cc * 5 + cc1h * 5 + c * 18)',
        'v1:len <= 512000 ? tier("input_lte_512k", p * 2.1 + cr * 0.42 + c * 8.4) : tier("input_gt_512k", p * 4.2 + cr * 0.84 + c * 16.8)',
        'v1:len <= 256000 ? tier("input_lte_256k", p * 1.2 + cr * 0.12 + cc * 1.5 + c * 7.2) : tier("input_gt_256k", p * 4.8 + cr * 0.48 + cc * 6 + c * 28.8)',
        'v1:len < 32000 ? tier("input_lt_32k", p * 6 + cr * 1.3 + c * 24) : tier("input_gte_32k", p * 8 + cr * 2 + c * 28)'
    ];

    expressions.forEach((expression) => {
        const projected = projectNewApiTieredPricing(expression, 0.4);
        assert.equal(projected?.intervals?.length, 2, expression);
    });
});
