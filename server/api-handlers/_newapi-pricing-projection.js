const BILLING_VARIABLE_FIELDS = Object.freeze({
    p: ['input_price_per_million'],
    c: ['output_price_per_million'],
    cr: ['cache_read_price_per_million'],
    cc: ['cache_write_price_per_million', 'cache_write_5m_price_per_million'],
    cc1h: ['cache_write_1h_price_per_million'],
    img_o: ['image_output_price_per_million']
});

const BILLING_VARIABLE_PATTERN = 'cc1h|img_o|cr|cc|p|c';
const NON_NEGATIVE_NUMBER_PATTERN = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const BILLING_TERM_PATTERN = `(?:${BILLING_VARIABLE_PATTERN})\\s*\\*\\s*${NON_NEGATIVE_NUMBER_PATTERN}`;
const BILLING_BODY_PATTERN = new RegExp(`^\\s*${BILLING_TERM_PATTERN}(?:\\s*\\+\\s*${BILLING_TERM_PATTERN})*\\s*$`);
const BILLING_TERM_EXTRACTOR = new RegExp(`\\b(${BILLING_VARIABLE_PATTERN})\\s*\\*\\s*(${NON_NEGATIVE_NUMBER_PATTERN})`, 'g');
const LENGTH_CONDITION_PATTERN = new RegExp(`^len\\s*(<=|<|>=|>)\\s*(${NON_NEGATIVE_NUMBER_PATTERN})\\s*\\?\\s*`);

function normalizeNonNegativeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function stripExpressionVersion(value = '') {
    return String(value || '').trim().replace(/^v\d+:/, '').trim();
}

function parseTierRates(body = '') {
    const normalized = String(body || '').trim();
    if (!BILLING_BODY_PATTERN.test(normalized)) return null;

    const rates = {};
    const extractor = new RegExp(BILLING_TERM_EXTRACTOR.source, 'g');
    let match = extractor.exec(normalized);
    while (match) {
        const variable = match[1];
        const rate = normalizeNonNegativeNumber(match[2]);
        if (rate === null || Object.prototype.hasOwnProperty.call(rates, variable)) return null;
        rates[variable] = rate;
        match = extractor.exec(normalized);
    }
    return Object.keys(rates).length ? rates : null;
}

function parseTierCall(value = '') {
    const match = String(value || '').trim().match(/^tier\("([^"]*)",\s*([\s\S]+)\)$/);
    if (!match) return null;
    const rates = parseTierRates(match[2]);
    return rates ? { sourceLabel: match[1], rates } : null;
}

function projectTierRates(rates = {}, groupRatio = 1) {
    const ratio = normalizeNonNegativeNumber(groupRatio);
    if (ratio === null) return null;

    const projected = {};
    Object.entries(rates).forEach(([variable, rate]) => {
        (BILLING_VARIABLE_FIELDS[variable] || []).forEach((field) => {
            projected[field] = rate * ratio;
        });
    });
    return projected;
}

function formatTokenThreshold(value) {
    if (value >= 1000000 && value % 1000000 === 0) return `${value / 1000000}M`;
    if (value >= 1000 && value % 1000 === 0) return `${value / 1000}K`;
    return String(value);
}

function buildLengthIntervals(operator, threshold, matchingTier, fallbackTier, groupRatio) {
    if (!Number.isSafeInteger(threshold) || threshold < 1) return null;
    const matchingRates = projectTierRates(matchingTier.rates, groupRatio);
    const fallbackRates = projectTierRates(fallbackTier.rates, groupRatio);
    if (!matchingRates || !fallbackRates) return null;

    const formattedThreshold = formatTokenThreshold(threshold);
    if (operator === '<=' || operator === '<') {
        const boundary = operator === '<=' ? threshold : threshold - 1;
        return [
            {
                min_tokens: 0,
                max_tokens: boundary,
                tier_label: `${operator} ${formattedThreshold} Token`,
                ...matchingRates
            },
            {
                min_tokens: boundary,
                max_tokens: null,
                tier_label: `${operator === '<=' ? '>' : '>='} ${formattedThreshold} Token`,
                ...fallbackRates
            }
        ];
    }

    const boundary = operator === '>' ? threshold : threshold - 1;
    return [
        {
            min_tokens: 0,
            max_tokens: boundary,
            tier_label: `${operator === '>' ? '<=' : '<'} ${formattedThreshold} Token`,
            ...fallbackRates
        },
        {
            min_tokens: boundary,
            max_tokens: null,
            tier_label: `${operator} ${formattedThreshold} Token`,
            ...matchingRates
        }
    ];
}

function projectNewApiTieredPricing(expression = '', groupRatio = 1) {
    const body = stripExpressionVersion(expression);
    if (!body || body.includes('|||')) return null;

    const singleTier = parseTierCall(body);
    if (singleTier) {
        const fields = projectTierRates(singleTier.rates, groupRatio);
        return fields ? { fields, intervals: [] } : null;
    }

    const condition = body.match(LENGTH_CONDITION_PATTERN);
    if (!condition) return null;
    const branches = body.slice(condition[0].length).split(/\s*:\s*/);
    if (branches.length !== 2) return null;

    const matchingTier = parseTierCall(branches[0]);
    const fallbackTier = parseTierCall(branches[1]);
    const threshold = Number(condition[2]);
    if (!matchingTier || !fallbackTier) return null;

    const intervals = buildLengthIntervals(
        condition[1],
        threshold,
        matchingTier,
        fallbackTier,
        groupRatio
    );
    return intervals ? { fields: {}, intervals } : null;
}

module.exports = {
    projectNewApiTieredPricing
};
