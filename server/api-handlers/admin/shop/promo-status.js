'use strict';

const { requireAdmin, sendJson } = require('../../../../api/_lib/admin');

const BREAKER_SELECT = 'id,state,opened_at,closed_at';
const BUDGET_SELECT = 'site,enabled,daily_budget_cny,spent_cny,budget_date';
const EVENT_SELECT = 'id,kind,site,occurred_at';
const EVENT_KINDS = new Set([
    'amount_mismatch',
    'identity_limit_hit',
    'budget_exhausted',
    'code_exhausted',
    'manual_open',
    'manual_close',
    'auto_open'
]);
const SITES = Object.freeze(['cn', 'intl']);
const MAX_RECENT_EVENTS = 10;
const UNAVAILABLE = Object.freeze({
    success: false,
    available: false,
    message: '游客促销状态暂不可用'
});

function todayInShanghai(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function normalizeDateOnly(value) {
    const normalized = String(value ?? '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeIso(value) {
    if (value == null || value === '') return null;
    const timestamp = Date.parse(String(value));
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function mapBudgetRows(rows, budgetDate) {
    if (!Array.isArray(rows) || rows.length !== SITES.length) return null;
    const bySite = new Map();
    for (const row of rows) {
        if (!SITES.includes(row?.site) || bySite.has(row.site) || typeof row.enabled !== 'boolean') return null;
        const dailyBudget = normalizeAmount(row.daily_budget_cny);
        const spent = normalizeAmount(row.spent_cny);
        const rowDate = normalizeDateOnly(row.budget_date);
        if (dailyBudget == null || spent == null || !rowDate) return null;
        const staleDate = rowDate !== budgetDate;
        const effectiveSpent = staleDate ? 0 : spent;
        bySite.set(row.site, {
            site: row.site,
            enabled: row.enabled,
            daily_budget_cny: dailyBudget,
            spent_cny: effectiveSpent,
            remaining_cny: Math.round(Math.max(0, dailyBudget - effectiveSpent) * 100) / 100,
            budget_date: rowDate,
            stale_date: staleDate
        });
    }
    if (SITES.some((site) => !bySite.has(site))) return null;
    return SITES.map((site) => bySite.get(site));
}

function mapEventRows(rows) {
    if (!Array.isArray(rows)) return null;
    return rows.map((row) => {
        const id = Number(row?.id);
        const occurredAt = normalizeIso(row?.occurred_at);
        if (!Number.isSafeInteger(id) || id < 1 || !EVENT_KINDS.has(row?.kind)) return null;
        if (row.site != null && !SITES.includes(row.site)) return null;
        if (!occurredAt) return null;
        return {
            id,
            kind: row.kind,
            site: row.site ?? null,
            occurred_at: occurredAt
        };
    });
}

async function readStatus(supabase) {
    const [breakerResult, budgetsResult, eventsResult] = await Promise.all([
        supabase.from('guest_shop_promo_breaker')
            .select(BREAKER_SELECT)
            .eq('id', 1)
            .maybeSingle(),
        supabase.from('guest_shop_promo_budget')
            .select(BUDGET_SELECT)
            .in('site', SITES),
        supabase.from('guest_shop_promo_breaker_events')
            .select(EVENT_SELECT)
            .order('occurred_at', { ascending: false })
            .limit(MAX_RECENT_EVENTS)
    ]);

    if (breakerResult?.error || budgetsResult?.error || eventsResult?.error) return null;
    const breaker = breakerResult?.data;
    if (!breaker || Number(breaker.id) !== 1 || !['open', 'closed'].includes(breaker.state)) return null;

    const budgetDate = todayInShanghai();
    const budgets = mapBudgetRows(budgetsResult?.data, budgetDate);
    const events = mapEventRows(eventsResult?.data);
    const openedAt = normalizeIso(breaker.opened_at);
    const closedAt = normalizeIso(breaker.closed_at);
    if (!budgets || !events) return null;
    if ((breaker.opened_at != null && !openedAt) || (breaker.closed_at != null && !closedAt)) return null;
    if (breaker.state === 'open' && (!openedAt || closedAt)) return null;
    if (breaker.state === 'closed' && openedAt) return null;

    return {
        success: true,
        available: true,
        breaker: {
            state: breaker.state,
            opened_at: openedAt,
            closed_at: closedAt
        },
        budget_date: budgetDate,
        budgets,
        events
    };
}

module.exports = async function guestPromoStatusHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (String(req?.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    let adminContext;
    try {
        adminContext = await requireAdmin(req, { permission: 'shop.manage' });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 401, {
            success: false,
            message: error?.message || 'Admin access required',
            code: error?.code || 'admin_access_required'
        });
    }

    // These tables deliberately have service_role-only grants. Falling back to a
    // request-scoped client would turn a valid RLS denial into stale/partial UI.
    if (!adminContext?.adminSupabase) {
        return sendJson(res, 503, UNAVAILABLE);
    }

    try {
        const payload = await readStatus(adminContext.adminSupabase);
        if (!payload) return sendJson(res, 503, UNAVAILABLE);
        return sendJson(res, 200, payload);
    } catch (_) {
        // Keep database errors, query details, and any unexpected row content out
        // of the response; the panel fails closed as a whole.
        return sendJson(res, 503, UNAVAILABLE);
    }
};

module.exports.constants = Object.freeze({
    BREAKER_SELECT,
    BUDGET_SELECT,
    EVENT_SELECT,
    MAX_RECENT_EVENTS
});
module.exports.readStatus = readStatus;
