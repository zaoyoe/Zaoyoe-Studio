const {
    normalizeAdminSite,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    buildOrderProfitAttributionByOrderId,
    syncOrderProfitLedger
} = require('./_profit-ledger');

const DEFAULT_BACKFILL_LIMIT = 25;
const MAX_BACKFILL_LIMIT = 100;

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeText(value, maxLength = 200) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeSite(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function normalizePositiveInteger(value, fallback = DEFAULT_BACKFILL_LIMIT, maxValue = MAX_BACKFILL_LIMIT) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return Math.min(parsed, maxValue);
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function normalizeDateTime(value, { endOfDay = false } = {}) {
    const raw = normalizeText(value, 80);
    if (!raw) return '';
    const isoLike = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
        : raw;
    const parsed = new Date(isoLike);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function normalizeBackfillInput(searchParams, body = {}) {
    return {
        site: normalizeSite(body.site || searchParams.get('site')),
        limit: normalizePositiveInteger(body.limit || searchParams.get('limit')),
        cursor: normalizeText(body.cursor || searchParams.get('cursor'), 80),
        since: normalizeDateTime(body.since || body.dateFrom || searchParams.get('since') || searchParams.get('dateFrom')),
        until: normalizeDateTime(body.until || body.dateTo || searchParams.get('until') || searchParams.get('dateTo'), { endOfDay: true }),
        dryRun: normalizeBoolean(body.dryRun ?? body.dry_run ?? searchParams.get('dryRun') ?? searchParams.get('dry_run'), false),
        includeRefunded: normalizeBoolean(body.includeRefunded ?? body.include_refunded ?? searchParams.get('includeRefunded') ?? searchParams.get('include_refunded'), true)
    };
}

async function parseJsonBody(req) {
    if (!req || req.body == null) return {};
    if (typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
    if (typeof req.body !== 'string' || !req.body.trim()) return {};
    try {
        const parsed = JSON.parse(req.body);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        const parseError = new Error('Invalid JSON body');
        parseError.statusCode = 400;
        throw parseError;
    }
}

async function loadBackfillCandidateOrders(supabase, options = {}) {
    let query = supabase
        .from('shop_orders')
        .select('id, site, created_at, refund_status')
        .order('created_at', { ascending: true })
        .limit(options.limit + 1);

    if (options.site !== 'all') {
        query = query.eq('site', options.site);
    }
    if (options.cursor) {
        query = query.gt('created_at', options.cursor);
    }
    if (options.since) {
        query = query.gte('created_at', options.since);
    }
    if (options.until) {
        query = query.lte('created_at', options.until);
    }
    if (!options.includeRefunded) {
        query = query.not('refund_status', 'in', '("refunded","full_refund")');
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const pageRows = rows.slice(0, options.limit);
    return {
        rows: pageRows,
        hasMore: rows.length > options.limit,
        nextCursor: pageRows.length ? (pageRows[pageRows.length - 1]?.created_at || '') : ''
    };
}

async function backfillProfitLedgerForOrders(supabase, orderRows = [], options = {}) {
    const results = [];

    for (const row of orderRows) {
        const orderId = normalizeText(row?.id, 160);
        if (!orderId) continue;

        try {
            const attributionContext = await buildOrderProfitAttributionByOrderId(supabase, orderId);
            if (!attributionContext.order || !attributionContext.attribution) {
                results.push({
                    order_id: orderId,
                    status: 'skipped',
                    reason: 'missing_order'
                });
                continue;
            }

            if (options.dryRun) {
                results.push({
                    order_id: orderId,
                    site: attributionContext.order.site || row.site || 'cn',
                    created_at: attributionContext.order.created_at || row.created_at || null,
                    status: 'dry_run',
                    entry_count: Array.isArray(attributionContext.attribution.profit_ledger_entries)
                        ? attributionContext.attribution.profit_ledger_entries.length
                        : 0,
                    profit_ledger_status: attributionContext.attribution.profit_ledger_status || 'none',
                    net_profit_cny: attributionContext.attribution.net_profit_cny ?? null,
                    cost_coverage: attributionContext.attribution.cost_coverage || null
                });
                continue;
            }

            const syncResult = await syncOrderProfitLedger(
                supabase,
                attributionContext.order,
                attributionContext.attribution,
                {
                    userId: options.userId,
                    reason: 'shop_profit_ledger_backfill'
                }
            );

            results.push({
                order_id: orderId,
                site: attributionContext.order.site || row.site || 'cn',
                created_at: attributionContext.order.created_at || row.created_at || null,
                status: syncResult.synced ? 'synced' : 'preview',
                source: syncResult.source || 'preview',
                entry_count: Array.isArray(syncResult.entries) ? syncResult.entries.length : 0,
                profit_ledger_status: syncResult.status || 'none',
                net_profit_cny: attributionContext.attribution.net_profit_cny ?? null,
                cost_coverage: attributionContext.attribution.cost_coverage || null
            });
        } catch (error) {
            results.push({
                order_id: orderId,
                status: 'failed',
                message: error?.message || 'Backfill failed'
            });
        }
    }

    return results;
}

module.exports = async function adminShopProfitLedgerBackfillHandler(req, res) {
    const method = String(req.method || '').toUpperCase();
    if (!['GET', 'POST'].includes(method)) {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'shop.manage' });

        if (method === 'GET') {
            return sendJson(res, 200, {
                success: true,
                endpoint: 'shop/profit-ledger-backfill',
                method: 'POST',
                limits: {
                    default: DEFAULT_BACKFILL_LIMIT,
                    max: MAX_BACKFILL_LIMIT
                },
                params: ['site', 'since', 'until', 'cursor', 'limit', 'dryRun', 'includeRefunded']
            });
        }

        const body = await parseJsonBody(req);
        const options = normalizeBackfillInput(getSearchParams(req), body);
        const candidates = await loadBackfillCandidateOrders(supabase, options);
        const results = await backfillProfitLedgerForOrders(supabase, candidates.rows, {
            dryRun: options.dryRun,
            userId: user?.id
        });
        const synced = results.filter((row) => row.status === 'synced').length;
        const failed = results.filter((row) => row.status === 'failed').length;

        if (!options.dryRun && results.length) {
            await writeAdminAuditLog({
                supabase,
                adminId: user?.id,
                module: 'shop',
                site: options.site,
                actionType: 'shop.profit_ledger.backfill',
                details: {
                    limit: options.limit,
                    cursor: options.cursor || null,
                    since: options.since || null,
                    until: options.until || null,
                    processed: results.length,
                    synced,
                    failed,
                    has_more: candidates.hasMore,
                    next_cursor: candidates.nextCursor || null
                }
            });
        }

        return sendJson(res, 200, {
            success: true,
            dryRun: options.dryRun,
            site: options.site,
            limit: options.limit,
            processed: results.length,
            synced,
            failed,
            hasMore: candidates.hasMore,
            nextCursor: candidates.hasMore ? candidates.nextCursor : '',
            results
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to backfill shop profit ledger'
        });
    }
};

module.exports._private = {
    backfillProfitLedgerForOrders,
    loadBackfillCandidateOrders,
    normalizeBackfillInput
};
