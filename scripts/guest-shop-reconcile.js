#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const {
    loadEnvFile
} = require('./guest-shop-readiness');
const {
    GUEST_PURPOSE,
    createGuestShopPaymentAdapter
} = require('../api/_lib/payments/guest-shop-adapter');

const DEFAULT_ENV_FILE = path.resolve(process.cwd(), '.env');
const FORBIDDEN_OUTPUT_KEYS = new Set([
    'claim_secret',
    'claim_secret_hash',
    'recovery_code',
    'content',
    'card_secret',
    'inventory_content',
    'response_payload',
    'payload_redacted',
    'raw_body',
    'secret',
    'provider_metadata'
]);

const ORDER_COLUMNS = [
    'id',
    'order_no',
    'site',
    'currency',
    'total_amount',
    'payment_status',
    'fulfillment_status',
    'refund_status',
    'paid_at',
    'updated_at',
    'created_at'
].join(', ');

const PAYMENT_COLUMNS = [
    'id',
    'guest_order_id',
    'merchant_order_no',
    'purpose',
    'provider',
    'channel',
    'provider_order_no',
    'site',
    'currency',
    'expected_amount',
    'paid_amount',
    'status',
    'sign_verified',
    'amount_verified',
    'currency_verified',
    'final_status_verified',
    'checkout_reference',
    'paid_at',
    'verified_at',
    'provider_metadata',
    'updated_at',
    'created_at'
].join(', ');

const EVENT_COLUMNS = [
    'id',
    'payment_order_id',
    'merchant_order_no',
    'provider',
    'event_key',
    'provider_event_id',
    'provider_order_no',
    'event_type',
    'observed_status',
    'body_sha256',
    'signature_verified',
    'amount_verified',
    'currency_verified',
    'final_status_verified',
    'processing_status',
    'received_at',
    'processed_at'
].join(', ');

function normalizeText(value, maxLength = 300) {
    if (value === undefined || value === null) return '';
    return String(value).trim().slice(0, Math.max(0, Number(maxLength) || 0));
}

function parseNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function amountsMatch(left, right) {
    if (left === undefined || left === null || right === undefined || right === null || left === '' || right === '') {
        return true;
    }
    const a = Number(left);
    const b = Number(right);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(a - b) < 0.005;
}

function parseReconcileArgs(argv = []) {
    const options = {
        localOnly: true,
        queryProvider: false,
        json: false,
        lookbackDays: 14,
        envFile: DEFAULT_ENV_FILE
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;
        if (value === '--local-only') {
            options.localOnly = true;
            options.queryProvider = false;
            continue;
        }
        if (value === '--query-provider') {
            options.queryProvider = true;
            options.localOnly = false;
            continue;
        }
        if (value === '--json') {
            options.json = true;
            continue;
        }
        if (value === '--lookback-days') {
            options.lookbackDays = Math.max(1, Math.min(90, parseNumber(argv[index + 1], 14)));
            index += 1;
            continue;
        }
        if (value === '--env-file') {
            const next = String(argv[index + 1] || '').trim();
            if (next) options.envFile = path.resolve(process.cwd(), next);
            index += 1;
        }
    }

    return options;
}

function sanitizeValue(value, key = '') {
    if (FORBIDDEN_OUTPUT_KEYS.has(String(key || '').toLowerCase())) return undefined;
    if (value === undefined || value === null) return value;
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item)).filter((item) => item !== undefined);
    }
    if (typeof value === 'object') {
        const next = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            if (FORBIDDEN_OUTPUT_KEYS.has(String(childKey).toLowerCase())) continue;
            const sanitized = sanitizeValue(childValue, childKey);
            if (sanitized !== undefined) next[childKey] = sanitized;
        }
        return next;
    }
    return value;
}

function addFinding(findings, code, severity, message, extra = {}) {
    findings.push(sanitizeValue({
        code,
        severity,
        message,
        ...extra
    }));
}

function isVerifiedEvent(event = {}) {
    const processing = normalizeText(event.processing_status, 40).toLowerCase();
    return event.signature_verified === true
        && (
            event.final_status_verified === true
            || ['verified', 'processed'].includes(processing)
        );
}

function providerStatusImpliesPaid(status) {
    return ['confirmed', 'paid', 'finished', 'success', 'succeeded', 'complete', 'completed'].includes(
        normalizeText(status, 40).toLowerCase()
    );
}

function providerStatusImpliesUnpaid(status) {
    return ['pending', 'waiting', 'expired', 'failed', 'refunded', 'unpaid', 'cancelled', 'canceled'].includes(
        normalizeText(status, 40).toLowerCase()
    );
}

function reconcileGuestShopRecords({
    orders = [],
    payments = [],
    events = [],
    providerSnapshots = []
} = {}) {
    const findings = [];
    const ordersById = new Map();
    const paymentsById = new Map();
    const paymentsByOrderId = new Map();
    const paymentsByMerchant = new Map();
    const eventsByPaymentId = new Map();
    const snapshotsByMerchant = new Map();

    for (const order of orders || []) {
        const id = normalizeText(order?.id, 80);
        if (id) ordersById.set(id, order);
    }
    for (const payment of payments || []) {
        const id = normalizeText(payment?.id, 80);
        const orderId = normalizeText(payment?.guest_order_id, 80);
        const merchant = normalizeText(payment?.merchant_order_no, 120);
        if (id) paymentsById.set(id, payment);
        if (orderId) paymentsByOrderId.set(orderId, payment);
        if (merchant) paymentsByMerchant.set(merchant, payment);
    }
    for (const event of events || []) {
        const paymentId = normalizeText(event?.payment_order_id, 80);
        if (!paymentId) {
            addFinding(findings, 'event_without_payment', 'warning', '支付事件没有关联 payment_order_id / 本地支付单。', {
                event_key: event?.event_key || null,
                merchant_order_no: event?.merchant_order_no || null,
                provider: event?.provider || null
            });
            continue;
        }
        if (!eventsByPaymentId.has(paymentId)) eventsByPaymentId.set(paymentId, []);
        eventsByPaymentId.get(paymentId).push(event);
        if (!paymentsById.has(paymentId) && !paymentsByMerchant.has(normalizeText(event?.merchant_order_no, 120))) {
            addFinding(findings, 'event_without_payment', 'warning', '支付事件指向的本地支付单不存在。', {
                event_key: event?.event_key || null,
                payment_order_id: paymentId,
                merchant_order_no: event?.merchant_order_no || null
            });
        }
    }
    for (const snapshot of providerSnapshots || []) {
        const merchant = normalizeText(snapshot?.merchant_order_no, 120);
        if (merchant) snapshotsByMerchant.set(merchant, snapshot);
    }

    for (const order of orders || []) {
        const payment = paymentsByOrderId.get(normalizeText(order?.id, 80));
        if (!payment) {
            addFinding(findings, 'order_without_payment', 'critical', '本地订单没有对应的 guest_shop_payment_orders 记录。', {
                order_no: order.order_no,
                order_id: order.id,
                payment_status: order.payment_status
            });
            continue;
        }

        if (normalizeText(order.site, 10) && normalizeText(payment.site, 10) && order.site !== payment.site) {
            addFinding(findings, 'site_mismatch', 'critical', '订单站点与支付单站点不一致。', {
                order_no: order.order_no,
                order_site: order.site,
                payment_site: payment.site
            });
        }
        if (normalizeText(order.currency, 8) && normalizeText(payment.currency, 8) && order.currency !== payment.currency) {
            addFinding(findings, 'currency_mismatch', 'critical', '订单币种与支付单币种不一致。', {
                order_no: order.order_no,
                order_currency: order.currency,
                payment_currency: payment.currency
            });
        }
        if (!amountsMatch(order.total_amount, payment.expected_amount)
            || (payment.paid_amount !== undefined && payment.paid_amount !== null && !amountsMatch(payment.expected_amount, payment.paid_amount)
                && ['confirmed', 'amount_mismatch', 'overpaid', 'partial'].includes(normalizeText(payment.status, 40).toLowerCase()))) {
            addFinding(findings, 'amount_mismatch', 'critical', '订单金额、支付期望金额或实付金额不一致。', {
                order_no: order.order_no,
                order_amount: order.total_amount,
                expected_amount: payment.expected_amount,
                paid_amount: payment.paid_amount
            });
        }

        const localConfirmed = ['confirmed'].includes(normalizeText(order.payment_status, 40).toLowerCase())
            || ['confirmed'].includes(normalizeText(payment.status, 40).toLowerCase());
        if (localConfirmed) {
            const relatedEvents = eventsByPaymentId.get(normalizeText(payment.id, 80)) || [];
            if (!relatedEvents.some((event) => isVerifiedEvent(event))) {
                addFinding(findings, 'confirmed_without_verified_event', 'critical', '本地已确认支付，但没有验签且终态验证通过的支付事件。', {
                    order_no: order.order_no,
                    merchant_order_no: payment.merchant_order_no,
                    payment_status: order.payment_status,
                    payment_row_status: payment.status
                });
            }
        }
    }

    for (const payment of payments || []) {
        if (normalizeText(payment.purpose, 40) && normalizeText(payment.purpose, 40) !== GUEST_PURPOSE) {
            addFinding(findings, 'purpose_not_shop_direct', 'critical', '支付用途不是 shop_direct。', {
                order_no: ordersById.get(normalizeText(payment?.guest_order_id, 80))?.order_no || null,
                merchant_order_no: payment.merchant_order_no,
                purpose: payment.purpose
            });
        }
        if (!ordersById.has(normalizeText(payment?.guest_order_id, 80))) {
            addFinding(findings, 'payment_without_order', 'critical', '本地支付单没有对应的游客订单。', {
                merchant_order_no: payment.merchant_order_no,
                guest_order_id: payment.guest_order_id,
                provider: payment.provider
            });
        }

        const snapshot = snapshotsByMerchant.get(normalizeText(payment.merchant_order_no, 120));
        if (!snapshot) continue;

        if (snapshot.query_error) {
            addFinding(findings, 'provider_query_failed', 'warning', 'provider 查询失败，保持 review，不得自动确认。', {
                merchant_order_no: payment.merchant_order_no,
                provider: payment.provider,
                error: normalizeText(snapshot.query_error, 180)
            });
            continue;
        }

        const localStatus = normalizeText(payment.status, 40).toLowerCase();
        const snapshotStatus = snapshot.status;
        if (providerStatusImpliesPaid(snapshotStatus) && ['pending', 'created', 'review'].includes(localStatus)) {
            addFinding(findings, 'provider_paid_local_pending', 'critical', 'provider 已付款，本地仍 pending/created/review。', {
                merchant_order_no: payment.merchant_order_no,
                provider_status: snapshotStatus,
                local_status: localStatus
            });
        }
        if (providerStatusImpliesUnpaid(snapshotStatus) && localStatus === 'confirmed') {
            addFinding(findings, 'provider_unpaid_local_confirmed', 'critical', '本地已确认，但 provider 仍显示未付款/失败/退款。', {
                merchant_order_no: payment.merchant_order_no,
                provider_status: snapshotStatus,
                local_status: localStatus
            });
        }
        if (snapshot.amount !== undefined && snapshot.amount !== null && !amountsMatch(payment.expected_amount, snapshot.amount)) {
            addFinding(findings, 'amount_mismatch', 'critical', 'provider 金额与本地期望金额不一致。', {
                merchant_order_no: payment.merchant_order_no,
                expected_amount: payment.expected_amount,
                provider_amount: snapshot.amount
            });
        }
        if (snapshot.currency && payment.currency && normalizeText(snapshot.currency, 8) !== normalizeText(payment.currency, 8)) {
            addFinding(findings, 'currency_mismatch', 'critical', 'provider 币种与本地支付单不一致。', {
                merchant_order_no: payment.merchant_order_no,
                payment_currency: payment.currency,
                provider_currency: snapshot.currency
            });
        }
        if (snapshot.site && payment.site && normalizeText(snapshot.site, 10) !== normalizeText(payment.site, 10)) {
            addFinding(findings, 'site_mismatch', 'critical', 'provider 站点与本地支付单不一致。', {
                merchant_order_no: payment.merchant_order_no,
                payment_site: payment.site,
                provider_site: snapshot.site
            });
        }
        if (snapshot.purpose && normalizeText(snapshot.purpose, 40) !== GUEST_PURPOSE) {
            addFinding(findings, 'purpose_not_shop_direct', 'critical', 'provider 快照用途不是 shop_direct。', {
                merchant_order_no: payment.merchant_order_no,
                purpose: snapshot.purpose
            });
        }
    }

    const counts = {};
    for (const finding of findings) {
        counts[finding.code] = (counts[finding.code] || 0) + 1;
    }

    return {
        summary: {
            order_count: (orders || []).length,
            payment_count: (payments || []).length,
            event_count: (events || []).length,
            provider_snapshot_count: (providerSnapshots || []).length,
            finding_count: findings.length,
            counts_by_code: counts
        },
        findings
    };
}

async function fetchPagedRows(buildQuery, pageSize = 500, maxPages = 20) {
    const rows = [];
    for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await buildQuery().range(from, to);
        if (error) throw error;
        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);
        if (batch.length < pageSize) break;
    }
    return rows;
}

function firstEnvValue(env, names) {
    for (const name of names) {
        const value = normalizeText(env?.[name], 1000);
        if (value) return value;
    }
    return '';
}

function createSupabaseFromEnv(env) {
    const url = firstEnvValue(env, ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_URL']);
    const key = firstEnvValue(env, ['SUPABASE_SERVICE_ROLE_KEY']);
    if (!url || !key) {
        throw new Error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，无法读取游客对账数据。');
    }
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function extractProviderPaymentId(payment = {}) {
    const metadata = payment.provider_metadata && typeof payment.provider_metadata === 'object'
        ? payment.provider_metadata
        : {};
    return normalizeText(
        metadata.payment_id || metadata.provider_payment_id || payment.checkout_reference,
        120
    );
}

async function queryProviderSnapshots(payments = [], options = {}) {
    const snapshots = [];
    const adapter = options.adapter || createGuestShopPaymentAdapter({
        supabase: options.supabase,
        env: options.env
    });

    for (const payment of payments || []) {
        const merchant = normalizeText(payment.merchant_order_no, 120);
        const provider = normalizeText(payment.provider, 40).toLowerCase();
        try {
            const result = await adapter.queryGuestPayment({
                provider,
                site: payment.site,
                merchantOrderNo: merchant,
                providerOrderNo: payment.provider_order_no,
                paymentId: extractProviderPaymentId(payment)
            });
            snapshots.push({
                merchant_order_no: result.merchant_order_no || merchant,
                provider,
                status: result.effective_status || result.status,
                amount: result.paid_amount ?? result.amount,
                currency: result.currency,
                site: payment.site,
                purpose: result.purpose || GUEST_PURPOSE
            });
        } catch (error) {
            snapshots.push({
                merchant_order_no: merchant,
                provider,
                site: payment.site,
                query_error: normalizeText(error?.message || error, 180)
            });
        }
    }
    return snapshots;
}

async function loadLocalRecords(supabase, lookbackDays, now = new Date()) {
    const sinceIso = new Date(now.getTime() - Number(lookbackDays) * 24 * 60 * 60 * 1000).toISOString();
    const [orders, payments, events] = await Promise.all([
        fetchPagedRows(() => supabase.from('guest_shop_orders').select(ORDER_COLUMNS).gte('updated_at', sinceIso).order('updated_at', { ascending: false })),
        fetchPagedRows(() => supabase.from('guest_shop_payment_orders').select(PAYMENT_COLUMNS).gte('updated_at', sinceIso).order('updated_at', { ascending: false })),
        fetchPagedRows(() => supabase.from('guest_shop_payment_events').select(EVENT_COLUMNS).gte('updated_at', sinceIso).order('updated_at', { ascending: false }))
    ]);
    return { orders, payments, events };
}

function formatHumanReport(result, options) {
    const lines = [
        `游客支付对账（${options.queryProvider ? '含 provider 查询' : '仅本地 --local-only'}）`,
        `订单 ${result.summary.order_count} / 支付单 ${result.summary.payment_count} / 事件 ${result.summary.event_count} / 发现 ${result.summary.finding_count}`,
        `counts: ${JSON.stringify(result.summary.counts_by_code)}`
    ];
    if (!result.findings.length) {
        lines.push('未发现本地不一致。');
        return lines.join('\n');
    }
    for (const finding of result.findings.slice(0, 50)) {
        lines.push(`- [${finding.severity}] ${finding.code}: ${finding.message} ${finding.order_no || finding.merchant_order_no || ''}`.trim());
    }
    if (result.findings.length > 50) {
        lines.push(`… 其余 ${result.findings.length - 50} 条已省略，使用 --json 查看全部。`);
    }
    return lines.join('\n');
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
    const options = parseReconcileArgs(argv);
    const env = dependencies.env || loadEnvFile(options.envFile, process.env);
    const supabase = dependencies.supabase || createSupabaseFromEnv(env);
    const local = await loadLocalRecords(supabase, options.lookbackDays, dependencies.now);
    let providerSnapshots = dependencies.providerSnapshots || [];
    if (options.queryProvider) {
        providerSnapshots = await queryProviderSnapshots(local.payments, {
            adapter: dependencies.adapter,
            supabase,
            env
        });
    }
    const result = reconcileGuestShopRecords({
        ...local,
        providerSnapshots
    });
    const output = options.json ? `${JSON.stringify(sanitizeValue(result), null, 2)}\n` : `${formatHumanReport(result, options)}\n`;
    if (dependencies.stdout) {
        dependencies.stdout.write(output);
    } else {
        process.stdout.write(output);
    }
    return result.summary.finding_count > 0 ? 1 : 0;
}

if (require.main === module) {
    main().then((code) => {
        process.exit(code);
    }).catch((error) => {
        const message = normalizeText(error?.message || error, 240);
        process.stderr.write(`游客对账失败：${message}\n`);
        process.exit(2);
    });
}

module.exports = {
    EVENT_COLUMNS,
    ORDER_COLUMNS,
    PAYMENT_COLUMNS,
    parseReconcileArgs,
    reconcileGuestShopRecords,
    sanitizeValue,
    queryProviderSnapshots,
    main
};
