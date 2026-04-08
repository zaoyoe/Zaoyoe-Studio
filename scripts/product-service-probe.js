#!/usr/bin/env node

const path = require('path');
const {
    applyPreviewEnvToProcess,
    getDefaultEnvFiles,
    loadPreviewEnv
} = require('./local-preview-server');
const { getSupabaseAdmin } = require('../api/_lib/admin');
const {
    loadProductAnalyticsDataset,
    buildProductSummaryPayload,
    buildProductRankPayloads,
    buildProductHealthPayloads,
    buildProductFunnelPayload
} = require('../server/api-handlers/admin/analytics/_product-analytics-builders');

const repoRoot = path.resolve(__dirname, '..');
applyPreviewEnvToProcess(loadPreviewEnv(getDefaultEnvFiles(repoRoot), process.env));

async function main() {
    const supabase = getSupabaseAdmin();
    const site = process.env.PRODUCT_PROBE_SITE || 'all';
    const startIso = process.env.PRODUCT_PROBE_START || '2026-03-31T00:00:00.000Z';
    const endIso = process.env.PRODUCT_PROBE_END || '2026-04-06T23:59:59.999Z';

    const result = {
        generatedAt: new Date().toISOString(),
        site,
        startIso,
        endIso
    };

    try {
        const dataset = await loadProductAnalyticsDataset(supabase, {
            site,
            startIso,
            endIso,
            includeInventory: true,
            includeEvents: true
        });

        result.dataset = {
            products: Array.isArray(dataset.products) ? dataset.products.length : -1,
            orders: Array.isArray(dataset.orders) ? dataset.orders.length : -1,
            inventory: Array.isArray(dataset.inventory) ? dataset.inventory.length : -1,
            events: Array.isArray(dataset.events) ? dataset.events.length : -1
        };

        const summary = buildProductSummaryPayload({
            ...dataset,
            site
        });
        const ranks = buildProductRankPayloads({
            ...dataset,
            site,
            limit: 10
        });
        const health = buildProductHealthPayloads({
            ...dataset,
            site,
            limit: 10
        });
        const funnel = buildProductFunnelPayload({
            ...dataset,
            site,
            limit: 6
        });

        result.summary = {
            buyers: summary?.summary?.buyer_count || 0,
            orders: summary?.summary?.order_count || 0,
            gmv: summary?.summary?.gmv_points || 0
        };
        result.ranks = {
            salesTop: Array.isArray(ranks?.salesTop?.rows) ? ranks.salesTop.rows.length : -1,
            refundRateTop: Array.isArray(ranks?.refundRateTop?.rows) ? ranks.refundRateTop.rows.length : -1
        };
        result.health = {
            lowStockProducts: Array.isArray(health?.lowStockProducts?.rows) ? health.lowStockProducts.rows.length : -1,
            deliveryRiskProducts: Array.isArray(health?.deliveryRiskProducts?.rows) ? health.deliveryRiskProducts.rows.length : -1
        };
        result.funnel = {
            stages: Array.isArray(funnel?.summary?.stages) ? funnel.summary.stages.length : -1,
            productRows: Array.isArray(funnel?.productRows) ? funnel.productRows.length : -1
        };
    } catch (error) {
        result.error = {
            message: error?.message || 'Unknown product service probe failure',
            stack: error?.stack || ''
        };
    }

    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
