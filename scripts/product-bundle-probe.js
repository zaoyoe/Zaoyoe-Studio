#!/usr/bin/env node

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';
const DEFAULT_SESSION_FILE = '/tmp/real_admin_session.json';
const DEFAULT_QUERY = 'site=all&startDate=2026-03-31&endDate=2026-04-06';

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function fetchRuntimeConfig(baseUrl) {
    const response = await fetch(`${baseUrl}/api/runtime/supabase-config`, {
        headers: {
            Accept: 'application/javascript'
        }
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Failed to load runtime config (${response.status})`);
    }

    const match = text.match(/var config = (\{[\s\S]*?\});/);
    if (!match) {
        throw new Error('Failed to parse runtime Supabase config');
    }

    return JSON.parse(match[1]);
}

async function probePermissionRpc(baseUrl, token, userId) {
    const runtimeConfig = await fetchRuntimeConfig(baseUrl);
    const restUrl = `${String(runtimeConfig.url || '').replace(/\/+$/, '')}/rest/v1/rpc/get_user_permissions`;
    const response = await fetch(restUrl, {
        method: 'POST',
        headers: {
            apikey: runtimeConfig.publishableKey,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            p_user_id: userId
        })
    });

    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch (_error) {
        payload = { raw: text };
    }

    return {
        status: response.status,
        ok: response.ok,
        payload
    };
}

async function resolveFreshAccessToken(baseUrl, sessionFile) {
    const session = readJson(sessionFile);
    const runtimeConfig = await fetchRuntimeConfig(baseUrl);
    const client = createClient(runtimeConfig.url, runtimeConfig.publishableKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });

    const email = String(session?.email || '').trim();
    const password = String(session?.password || '').trim();
    if (email && password) {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (!error && data?.session?.access_token) {
            writeJson(sessionFile, {
                ...session,
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
                expires_at: data.session.expires_at,
                user_id: data.user?.id || session.user_id || ''
            });
            return data.session.access_token;
        }
    }

    const accessToken = String(session?.access_token || '').trim();
    const refreshToken = String(session?.refresh_token || '').trim();
    if (!accessToken || !refreshToken) {
        throw new Error(`Session file is missing reusable credentials: ${sessionFile}`);
    }

    const { data, error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
    });
    if (error || !data?.session?.access_token) {
        throw new Error(error?.message || 'Failed to refresh product probe session');
    }

    writeJson(sessionFile, {
        ...session,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        user_id: data.user?.id || session.user_id || ''
    });
    return data.session.access_token;
}

async function requestJson(baseUrl, token, route, extraQuery = '') {
    const query = extraQuery ? `${DEFAULT_QUERY}&${extraQuery}` : DEFAULT_QUERY;
    const url = `${baseUrl}/api/admin?route=${encodeURIComponent(route)}&${query}`;
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch (_error) {
        payload = {
            raw: text
        };
    }

    return {
        route,
        status: response.status,
        ok: response.ok,
        payload
    };
}

async function createAdminStudioCookieSession(baseUrl, token) {
    const response = await fetch(`${baseUrl}/api/admin/access/session`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch (_error) {
        payload = {
            raw: text
        };
    }

    const setCookie = response.headers.get('set-cookie') || '';
    const cookie = String(setCookie || '')
        .split(';')[0]
        .trim();

    return {
        status: response.status,
        ok: response.ok,
        cookie,
        payload
    };
}

async function requestJsonWithCookie(baseUrl, cookie, route, extraQuery = '') {
    const query = extraQuery ? `${DEFAULT_QUERY}&${extraQuery}` : DEFAULT_QUERY;
    const url = `${baseUrl}/api/admin?route=${encodeURIComponent(route)}&${query}`;
    const response = await fetch(url, {
        headers: cookie ? { Cookie: cookie } : {}
    });
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch (_error) {
        payload = {
            raw: text
        };
    }

    return {
        route,
        status: response.status,
        ok: response.ok,
        payload
    };
}

function summarizeSegments(route, payload = null) {
    const segments = payload?.segments && typeof payload.segments === 'object'
        ? payload.segments
        : null;
    if (!segments) {
        return {
            route,
            topLevelMessage: String(payload?.message || ''),
            segmentSummaries: []
        };
    }

    return {
        route,
        topLevelMessage: String(payload?.message || ''),
        partialFailureCount: Number(payload?.partial_failure_count || 0),
        segmentSummaries: Object.entries(segments).map(([key, value]) => ({
            key,
            ok: value?.ok === true,
            statusCode: Number(value?.statusCode || 0),
            message: String(value?.message || ''),
            source: String(value?.source || '')
        }))
    };
}

async function main() {
    const baseUrl = String(process.env.PROBE_BASE_URL || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
    const sessionFile = String(process.env.PROBE_SESSION_FILE || DEFAULT_SESSION_FILE).trim() || DEFAULT_SESSION_FILE;
    const savedSession = readJson(sessionFile);
    const token = await resolveFreshAccessToken(baseUrl, sessionFile);
    const adminStudioSession = await createAdminStudioCookieSession(baseUrl, token);
    const cookie = adminStudioSession.cookie || '';
    const permissionProbe = await probePermissionRpc(
        baseUrl,
        token,
        String(savedSession?.user_id || '').trim()
    );

    const requests = [
        requestJson(baseUrl, token, 'analytics/product-summary-bundle'),
        requestJson(baseUrl, token, 'analytics/product-rank-bundle', 'limit=10'),
        requestJson(baseUrl, token, 'analytics/product-health-bundle', 'limit=10'),
        requestJson(baseUrl, token, 'analytics/product-funnel-bundle', 'limit=6'),
        requestJson(baseUrl, token, 'analytics/product-detail-bundle', 'productId=product-1&recentOrderLimit=6'),
        requestJsonWithCookie(baseUrl, cookie, 'analytics/product-summary-bundle'),
        requestJsonWithCookie(baseUrl, cookie, 'analytics/product-rank-bundle', 'limit=10'),
        requestJsonWithCookie(baseUrl, cookie, 'analytics/product-health-bundle', 'limit=10'),
        requestJsonWithCookie(baseUrl, cookie, 'analytics/product-funnel-bundle', 'limit=6'),
        requestJsonWithCookie(baseUrl, cookie, 'analytics/product-detail-bundle', 'productId=product-1&recentOrderLimit=6')
    ];

    const results = await Promise.allSettled(requests);
    const summaries = results.map((result, index) => {
        if (result.status === 'fulfilled') {
            return {
                requestIndex: index,
                ...result.value,
                summary: summarizeSegments(result.value.route, result.value.payload)
            };
        }
        return {
            requestIndex: index,
            error: result.reason?.message || String(result.reason || 'Unknown probe failure')
        };
    });

    console.log(JSON.stringify({
        generatedAt: new Date().toISOString(),
        baseUrl,
        sessionFile,
        permissionProbe,
        adminStudioSession: {
            status: adminStudioSession.status,
            ok: adminStudioSession.ok,
            hasCookie: Boolean(cookie),
            payload: adminStudioSession.payload
        },
        summaries
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
