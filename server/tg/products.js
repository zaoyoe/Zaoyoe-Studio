'use strict';

const PRODUCTS = Object.freeze({ premium_3: ['telegram_premium', 3], premium_6: ['telegram_premium', 6], premium_12: ['telegram_premium', 12], stars: ['telegram_stars', null] });
function safeProduct(row) {
    const product = PRODUCTS[row?.product_key];
    if (!product || row.product_family !== product[0] || row.term_months !== product[1]
        || row.currency !== 'CNY' || typeof row.enabled !== 'boolean') return null;
    const version = Number(row.price_version);
    if (!Number.isSafeInteger(version) || version < 1) return null;
    const stars = row.product_key === 'stars';
    const raw = stars ? row.unit_price_micros : row.price_minor;
    const price = raw == null ? null : Number(raw);
    if (price === null ? row.enabled : !Number.isSafeInteger(price) || price < 1 || price > (stars ? 1000000000 : 100000000)) return null;
    if (stars && (!Number.isSafeInteger(row.min_stars) || !Number.isSafeInteger(row.max_stars)
        || row.min_stars < 50 || row.max_stars < row.min_stars || row.max_stars > 1000000)) return null;
    const result = { product_id: row.product_key, product_family: product[0], term_months: product[1], enabled: row.enabled, currency: 'CNY', price_version: version,
        ...(stars ? { unit_price_micros: price, min_stars: row.min_stars, max_stars: row.max_stars } : { price_minor: price }) };
    if (typeof row.updated_at === 'string') result.updated_at = row.updated_at;
    return result;
}
module.exports = { PRODUCTS, safeProduct };
