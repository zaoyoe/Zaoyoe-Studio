const {
    normalizeAdminSite,
    sendJson
} = require('../../../../api/_lib/admin');
const paymentsSummaryHandler = require('../payments/summary');
const ticketMetricsHandler = require('../tickets/metrics');
const commentsSummaryHandler = require('../comments/summary');
const verifyMonitorHandler = require('../settings/verify-monitor');

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function createMemoryResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = Number(code) || 200;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            if (!state.body) {
                return {};
            }

            try {
                return JSON.parse(state.body);
            } catch (_) {
                return {};
            }
        },
        get statusCode() {
            return state.statusCode;
        }
    };
}

function setSearchParamIfPresent(searchParams, key, value) {
    const normalizedKey = String(key || '').trim();
    const normalizedValue = String(value || '').trim();
    if (!normalizedKey || !normalizedValue) {
        return;
    }

    searchParams.set(normalizedKey, normalizedValue);
}

function buildNestedAdminUrl(route, searchParams = new URLSearchParams()) {
    const url = new URL('http://localhost/api/admin');
    url.searchParams.set('route', String(route || '').trim());

    for (const [key, value] of searchParams.entries()) {
        setSearchParamIfPresent(url.searchParams, key, value);
    }

    return `${url.pathname}${url.search}`;
}

function buildSegmentResult(statusCode, payload = {}) {
    const normalizedStatusCode = Number(statusCode) || 500;
    const ok = normalizedStatusCode >= 200
        && normalizedStatusCode < 300
        && payload?.success !== false;

    return {
        ok,
        statusCode: normalizedStatusCode,
        message: ok ? '' : String(payload?.message || 'Admin snapshot segment failed'),
        payload: payload && typeof payload === 'object' ? payload : {}
    };
}

async function invokeNestedAdminHandler(handler, req, {
    route,
    searchParams = new URLSearchParams(),
    site = 'all'
} = {}) {
    const response = createMemoryResponse();
    const nestedReq = {
        ...req,
        method: 'GET',
        url: buildNestedAdminUrl(route, searchParams),
        adminRoute: String(route || '').trim(),
        adminSite: normalizeAdminSite(site, { defaultValue: 'all' }) || 'all'
    };

    try {
        await handler(nestedReq, response);
        return buildSegmentResult(response.statusCode, response.json());
    } catch (error) {
        return buildSegmentResult(Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Admin snapshot segment failed'
        });
    }
}

function buildPaymentsSearchParams(params, site = 'all') {
    const searchParams = new URLSearchParams();
    setSearchParamIfPresent(searchParams, 'site', site);
    setSearchParamIfPresent(searchParams, 'view', params.get('view') || 'ops');

    const startDate = params.get('startDate');
    const endDate = params.get('endDate');
    if (startDate && endDate) {
        searchParams.set('startDate', startDate);
        searchParams.set('endDate', endDate);
        return searchParams;
    }

    setSearchParamIfPresent(searchParams, 'days', params.get('days') || '7');
    return searchParams;
}

function buildTicketsSearchParams(params, site = 'all') {
    const searchParams = new URLSearchParams();
    setSearchParamIfPresent(searchParams, 'site', site);

    const startDate = params.get('startDate');
    const endDate = params.get('endDate');
    if (startDate && endDate) {
        searchParams.set('startDate', startDate);
        searchParams.set('endDate', endDate);
        return searchParams;
    }

    if (params.has('days')) {
        setSearchParamIfPresent(searchParams, 'days', params.get('days') || '7');
    }

    return searchParams;
}

function buildCommentsSearchParams(params, site = 'all') {
    const searchParams = new URLSearchParams();
    setSearchParamIfPresent(searchParams, 'site', site);
    return searchParams;
}

function buildVerifyMonitorSearchParams(params, site = 'all') {
    const searchParams = new URLSearchParams();
    setSearchParamIfPresent(searchParams, 'site', site);
    setSearchParamIfPresent(searchParams, 'taskPage', params.get('taskPage') || '1');
    setSearchParamIfPresent(searchParams, 'taskPageSize', params.get('taskPageSize') || '5');
    setSearchParamIfPresent(searchParams, 'failurePage', params.get('failurePage') || '1');
    setSearchParamIfPresent(searchParams, 'failurePageSize', params.get('failurePageSize') || '5');
    return searchParams;
}

module.exports = async function analyticsSnapshotBundleHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    const params = getQueryParams(req);
    const site = normalizeAdminSite(params.get('site') || req.adminSite, { defaultValue: 'all' }) || 'all';

    const [payments, tickets, comments, verifyMonitor] = await Promise.all([
        invokeNestedAdminHandler(paymentsSummaryHandler, req, {
            route: 'payments/summary',
            searchParams: buildPaymentsSearchParams(params, site),
            site
        }),
        invokeNestedAdminHandler(ticketMetricsHandler, req, {
            route: 'tickets/metrics',
            searchParams: buildTicketsSearchParams(params, site),
            site
        }),
        invokeNestedAdminHandler(commentsSummaryHandler, req, {
            route: 'comments/summary',
            searchParams: buildCommentsSearchParams(params, site),
            site
        }),
        invokeNestedAdminHandler(verifyMonitorHandler, req, {
            route: 'settings/verify-monitor',
            searchParams: buildVerifyMonitorSearchParams(params, site),
            site
        })
    ]);

    return sendJson(res, 200, {
        success: true,
        site,
        generated_at: new Date().toISOString(),
        partial_failure_count: [payments, tickets, comments, verifyMonitor].filter((segment) => !segment.ok).length,
        payments,
        tickets,
        comments,
        verifyMonitor
    });
};
