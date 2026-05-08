import { createClient } from '@supabase/supabase-js';
import { next } from '@vercel/functions';

const ADMIN_STUDIO_PATHS = new Set(['/admin-studio', '/admin-studio.html']);
const ROOT_ENTRY_PATHS = new Set(['/', '/index.html']);
const PUBLIC_SUPABASE_URL_ENV_NAMES = Object.freeze([
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_URL'
]);
const SITE_LAYOUT_CACHE_TTL_MS = 15 * 1000;
const SITE_LAYOUT_FALLBACK_CACHE_TTL_MS = 5 * 1000;

let siteLayoutHelpersPromise = null;
let supabaseAdminClient = null;
let cachedSiteLayouts = null;
let cachedSiteLayoutsExpiresAt = 0;

async function loadAdminStudioAccessHelpers() {
    return import('./api/_lib/admin-studio-access.mjs');
}

function unwrapModuleExports(moduleRecord) {
    return moduleRecord?.default || moduleRecord || {};
}

async function loadSiteLayoutHelpers() {
    if (!siteLayoutHelpersPromise) {
        siteLayoutHelpersPromise = import('./server/api-handlers/_site-layout.js');
    }
    return unwrapModuleExports(await siteLayoutHelpersPromise);
}

function getCookieValue(cookieHeader, cookieName) {
    if (!cookieHeader || !cookieName) return '';

    const segments = String(cookieHeader).split(';');
    for (const segment of segments) {
        const [rawName, ...rawValueParts] = segment.trim().split('=');
        if (rawName === cookieName) {
            return decodeURIComponent(rawValueParts.join('=') || '');
        }
    }
    return '';
}

function getFirstEnvValue(names = [], env = process.env) {
    for (const name of names) {
        const value = String(env?.[name] || '').trim();
        if (value) {
            return value;
        }
    }
    return '';
}

function getOptionalSupabaseServiceRoleKey(env = process.env) {
    return String(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_KEY || '').trim();
}

function getOptionalSupabaseUrl(env = process.env) {
    const value = getFirstEnvValue(PUBLIC_SUPABASE_URL_ENV_NAMES, env);
    return value ? value.replace(/\/+$/, '') : '';
}

function getOptionalSiteLayoutSupabaseClient(env = process.env) {
    if (supabaseAdminClient) {
        return supabaseAdminClient;
    }

    const supabaseUrl = getOptionalSupabaseUrl(env);
    const serviceRoleKey = getOptionalSupabaseServiceRoleKey(env);
    if (!supabaseUrl || !serviceRoleKey) {
        return null;
    }

    try {
        supabaseAdminClient = createClient(
            supabaseUrl,
            serviceRoleKey,
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                    detectSessionInUrl: false
                }
            }
        );
    } catch (_) {
        supabaseAdminClient = null;
    }

    return supabaseAdminClient;
}

function isAdminStudioPath(pathname = '') {
    return ADMIN_STUDIO_PATHS.has(String(pathname || ''));
}

function isRootEntryPath(pathname = '') {
    return ROOT_ENTRY_PATHS.has(String(pathname || ''));
}

function detectRequestSite(requestUrl) {
    const url = requestUrl instanceof URL
        ? requestUrl
        : new URL(String(requestUrl || '/'), 'https://www.zaoyoe.com');

    const forcedSite = String(url.searchParams.get('site') || '').trim().toLowerCase();
    if (forcedSite === 'intl' || forcedSite === 'cn') {
        return forcedSite;
    }

    const hostname = String(url.hostname || '').trim().toLowerCase();
    if (hostname === 'zaoyoe.xyz' || hostname.endsWith('.zaoyoe.xyz')) {
        return 'intl';
    }

    return 'cn';
}

function buildPagePathMap(pageOptions = []) {
    return new Map(
        (Array.isArray(pageOptions) ? pageOptions : [])
            .filter((option) => option && typeof option === 'object')
            .map((option) => [
                String(option.key || '').trim().toLowerCase(),
                String(option.path || '').trim()
            ])
            .filter(([key, path]) => key && path)
    );
}

export function buildSiteLayoutRedirectUrl(requestUrl, layouts = {}, pageOptions = []) {
    const url = requestUrl instanceof URL
        ? requestUrl
        : new URL(String(requestUrl || '/'), 'https://www.zaoyoe.com');

    if (!isRootEntryPath(url.pathname)) {
        return null;
    }

    const site = detectRequestSite(url);
    const layout = layouts && typeof layouts === 'object' && !Array.isArray(layouts)
        ? layouts[site]
        : null;
    const pagePathMap = buildPagePathMap(pageOptions);
    const fallbackRootPath = pagePathMap.get('home') || '/';
    const targetHref = pagePathMap.get(String(layout?.root_page_key || '').trim().toLowerCase()) || fallbackRootPath;

    if (!targetHref || targetHref === '/' || targetHref === '/index.html') {
        return null;
    }

    const targetUrl = new URL(targetHref, url);
    if (!targetUrl.search && url.search) {
        targetUrl.search = url.search;
    }

    if (targetUrl.toString() === url.toString()) {
        return null;
    }

    return targetUrl;
}

export { detectRequestSite };

async function loadResolvedSiteLayouts() {
    const siteLayoutHelpers = await loadSiteLayoutHelpers();
    const fallbackLayouts = siteLayoutHelpers.normalizeSiteLayouts({});
    const now = Date.now();

    if (cachedSiteLayouts && now < cachedSiteLayoutsExpiresAt) {
        return cachedSiteLayouts;
    }

    const supabase = getOptionalSiteLayoutSupabaseClient();
    if (!supabase) {
        cachedSiteLayouts = fallbackLayouts;
        cachedSiteLayoutsExpiresAt = now + SITE_LAYOUT_FALLBACK_CACHE_TTL_MS;
        return cachedSiteLayouts;
    }

    try {
        const query = supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', siteLayoutHelpers.SITE_LAYOUT_CONFIG_KEY);
        const { data, error } = await (typeof query.maybeSingle === 'function'
            ? query.maybeSingle()
            : query.single());

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        cachedSiteLayouts = siteLayoutHelpers.normalizeSiteLayouts(data?.config_value);
        cachedSiteLayoutsExpiresAt = Date.now() + SITE_LAYOUT_CACHE_TTL_MS;
        return cachedSiteLayouts;
    } catch (_) {
        cachedSiteLayouts = fallbackLayouts;
        cachedSiteLayoutsExpiresAt = Date.now() + SITE_LAYOUT_FALLBACK_CACHE_TTL_MS;
        return cachedSiteLayouts;
    }
}

async function maybeHandleSiteLayoutRootRedirect(requestUrl) {
    if (!isRootEntryPath(requestUrl.pathname)) {
        return null;
    }

    try {
        const [siteLayoutHelpers, layouts] = await Promise.all([
            loadSiteLayoutHelpers(),
            loadResolvedSiteLayouts()
        ]);
        const targetUrl = buildSiteLayoutRedirectUrl(
            requestUrl,
            layouts,
            siteLayoutHelpers.SITE_LAYOUT_PAGE_OPTIONS
        );

        if (!targetUrl) {
            return null;
        }

        return Response.redirect(targetUrl, 307);
    } catch (_) {
        return null;
    }
}

async function handleAdminStudioAccess(request, requestUrl) {
    const redirectUrl = new URL('/admin-entry', request.url);
    redirectUrl.searchParams.set('next', `${requestUrl.pathname}${requestUrl.search}`);

    try {
        const {
            getAdminStudioCookieName,
            verifyAdminStudioToken
        } = await loadAdminStudioAccessHelpers();
        const cookieValue = getCookieValue(
            request.headers.get('cookie') || '',
            getAdminStudioCookieName()
        );

        const payload = await verifyAdminStudioToken(cookieValue);
        if (payload?.sub) {
            return next();
        }
    } catch (_) {
        // Fail closed into the admin-entry trampoline instead of surfacing
        // a middleware invocation error to the browser.
    }

    return Response.redirect(redirectUrl, 307);
}

export default async function middleware(request) {
    const requestUrl = new URL(request.url);

    const siteLayoutRedirect = await maybeHandleSiteLayoutRootRedirect(requestUrl);
    if (siteLayoutRedirect) {
        return siteLayoutRedirect;
    }

    if (isAdminStudioPath(requestUrl.pathname)) {
        return handleAdminStudioAccess(request, requestUrl);
    }

    return next();
}

export const config = {
    matcher: ['/', '/index.html', '/admin-studio', '/admin-studio.html'],
    runtime: 'nodejs'
};
