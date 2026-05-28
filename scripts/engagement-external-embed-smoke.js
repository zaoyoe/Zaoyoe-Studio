#!/usr/bin/env node

const http = require('node:http');
const https = require('node:https');

const publicSmoke = require('./engagement-public-visual-smoke');

const DEFAULT_TIMEOUT_MS = 90000;
const DEFAULT_PAGE_ID = 'gongyi';
const DEFAULT_SITE = 'cn';
const DEFAULT_VIEWPORT = Object.freeze({
    width: 1366,
    height: 860,
    mobile: false,
    theme: 'light'
});

function parseArgs(argv = []) {
    const options = {
        baseUrl: '',
        assetBase: '',
        apiOrigin: '',
        pageId: DEFAULT_PAGE_ID,
        site: DEFAULT_SITE,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        chromePath: '',
        keepOpen: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = String(argv[index] || '').trim();
        if (!arg) continue;
        if (arg === '--base-url') {
            options.baseUrl = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (arg === '--asset-base') {
            options.assetBase = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (arg === '--api-origin') {
            options.apiOrigin = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (arg === '--page-id') {
            options.pageId = String(argv[index + 1] || DEFAULT_PAGE_ID).trim().toLowerCase();
            index += 1;
            continue;
        }
        if (arg === '--site') {
            options.site = String(argv[index + 1] || DEFAULT_SITE).trim().toLowerCase() === 'intl' ? 'intl' : 'cn';
            index += 1;
            continue;
        }
        if (arg === '--timeout-ms') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed) && parsed > 0) options.timeoutMs = parsed;
            index += 1;
            continue;
        }
        if (arg === '--chrome-path') {
            options.chromePath = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (arg === '--keep-open') {
            options.keepOpen = true;
        }
    }

    return options;
}

function normalizeOrigin(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, '');
}

function escapeHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildExternalSmokeFeedItem(pageId = DEFAULT_PAGE_ID) {
    return {
        id: `external-smoke-${pageId}`,
        rule_id: `external-smoke-rule-${pageId}`,
        source: 'rule',
        source_module: 'engagement_external_embed_smoke',
        source_event_id: `external-smoke-${pageId}`,
        trigger_type: 'page_view',
        title: '公益站外部触达验收',
        content: '外部公益站已接入机器人触达。请前往 "My Wallet > Cards" 查看。',
        page_id: pageId,
        site: DEFAULT_SITE,
        placement: 'robot_bubble',
        priority: 99,
        action_label: 'Open cards',
        action_url: 'wallet://cards',
        dismiss_ttl_hours: 0,
        tone: 'calm',
        metadata: {
            action_path_label: 'My Wallet > Cards',
            wallet_view: 'cards',
            external_embed_smoke: true
        }
    };
}

function buildExternalProbeHtml({
    assetBase = '',
    apiOrigin = '',
    pageId = DEFAULT_PAGE_ID,
    site = DEFAULT_SITE
} = {}) {
    const feedItem = buildExternalSmokeFeedItem(pageId);
    return `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>External Engagement Probe</title>
    <style>
        body { min-height: 100vh; margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #eef7fb; color: #172033; }
        main { max-width: 760px; padding: 48px; }
    </style>
</head>
<body>
    <main>
        <h1>公益站外部承载验收</h1>
        <p>这个页面模拟 sub2api.fatherkey.com，通过主站 embed 加载客服机器人。</p>
    </main>
    <script>
    (function () {
        window.__externalEmbedSmoke = { feedHits: [], events: [], walletViews: [] };
        window.ZaoyoeWalletModalBootstrap = {
            open: function (view, context) {
                window.__externalEmbedSmoke.walletViews.push({ view: view || '', context: context || {} });
                return Promise.resolve(true);
            }
        };
        var originalFetch = window.fetch ? window.fetch.bind(window) : null;
        window.fetch = function (input, init) {
            var url = String((input && input.url) || input || '');
            if (url.indexOf('/api/engagement/feed') !== -1 || (url.indexOf('/api/public') !== -1 && url.indexOf('route=feed') !== -1)) {
                window.__externalEmbedSmoke.feedHits.push({
                    url: url,
                    credentials: init && init.credentials || ''
                });
                return Promise.resolve(new Response(JSON.stringify({
                    success: true,
                    page_id: ${JSON.stringify(pageId)},
                    site: ${JSON.stringify(site)},
                    trigger_type: 'page_view',
                    asset_center: {
                        style: {
                            enabled: true,
                            preset: 'studio_blue',
                            accent_color: '#6b9ece',
                            title_color: '#5f95cc',
                            bubble_background: '#ffffff',
                            text_color: '#1f2937',
                            radius_px: 22,
                            max_width_px: 420,
                            density: 'comfortable',
                            shadow: 'soft',
                            animation: 'none',
                            robot_variant: 'default'
                        },
                        assets: []
                    },
                    support_entry: { enabled: true, contexts: [], guides: [] },
                    items: [${JSON.stringify(feedItem)}]
                }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
            }
            if (url.indexOf('/api/engagement/event') !== -1 || (url.indexOf('/api/public') !== -1 && url.indexOf('route=event') !== -1)) {
                try {
                    window.__externalEmbedSmoke.events.push(JSON.parse((init && init.body) || '{}'));
                } catch (_) {
                    window.__externalEmbedSmoke.events.push({ raw: (init && init.body) || '' });
                }
                return Promise.resolve(new Response(JSON.stringify({ success: true, recorded: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
            }
            return originalFetch ? originalFetch(input, init) : Promise.resolve(new Response('{}', { status: 200 }));
        };
    }());
    </script>
    <script
        src="${escapeHtml(new URL('js/engagement-external-embed.js?v=20260505_GONGYI_EXTERNAL_ENGAGEMENT_1', assetBase).toString())}"
        data-page-id="${escapeHtml(pageId)}"
        data-site="${escapeHtml(site)}"
        data-api-origin="${escapeHtml(apiOrigin)}"
        data-asset-base="${escapeHtml(assetBase)}"
        async></script>
</body>
</html>`;
}

async function startExternalProbeServer(options = {}) {
    const port = await publicSmoke.findFreePort();
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
        if (url.pathname === '/' || url.pathname === '/gongyi-external.html') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(buildExternalProbeHtml(options));
            return;
        }
        res.statusCode = 404;
        res.end('Not found');
    });
    await new Promise((resolve, reject) => {
        server.listen(port, '127.0.0.1', resolve);
        server.on('error', reject);
    });
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        pageUrl: `http://127.0.0.1:${port}/gongyi-external.html`,
        close: () => new Promise((resolve) => server.close(resolve))
    };
}

function requestRaw(urlString = '', options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.request(url, {
            method: options.method || 'GET',
            headers: options.headers || {}
        }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => resolve({
                statusCode: response.statusCode,
                headers: response.headers,
                body
            }));
        });
        request.on('error', reject);
        if (options.body) request.write(options.body);
        request.end();
    });
}

async function probeCors({ apiOrigin = '', externalOrigin = '', method = 'GET', route = 'feed' } = {}) {
    const url = new URL(`/api/engagement/${route}`, apiOrigin);
    if (route === 'feed') {
        url.searchParams.set('page_id', DEFAULT_PAGE_ID);
        url.searchParams.set('site', DEFAULT_SITE);
        url.searchParams.set('reader_key', 'external_smoke_probe');
        url.searchParams.set('limit', '1');
    }
    return requestRaw(url.toString(), {
        method: 'OPTIONS',
        headers: {
            Origin: externalOrigin,
            'Access-Control-Request-Method': method,
            'Access-Control-Request-Headers': 'Content-Type'
        }
    });
}

async function runBrowserProbe({ pageUrl, apiOrigin, chromePath, timeoutMs, keepOpen }) {
    let chrome = null;
    let cdp = null;
    try {
        chrome = await publicSmoke.launchChrome({ chromePath, keepOpen });
        cdp = await publicSmoke.createPageSession(chrome.webSocketDebuggerUrl);
        await cdp.client.send('Emulation.setDeviceMetricsOverride', {
            width: DEFAULT_VIEWPORT.width,
            height: DEFAULT_VIEWPORT.height,
            deviceScaleFactor: 1,
            mobile: DEFAULT_VIEWPORT.mobile
        }, cdp.sessionId);
        await cdp.client.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-color-scheme', value: DEFAULT_VIEWPORT.theme }]
        }, cdp.sessionId).catch(() => {});
        await publicSmoke.navigateTo(cdp.client, cdp.sessionId, pageUrl, timeoutMs);
        await publicSmoke.waitForEvaluation(
            cdp.client,
            cdp.sessionId,
            'Boolean(window.ZaoyoeExternalEngagement && window.ZaoyoeExternalEngagement.config && window.ZaoyoeExternalEngagement.config.pageId === "gongyi")',
            Boolean,
            timeoutMs
        );
        await publicSmoke.evaluate(cdp.client, cdp.sessionId, 'window.ZaoyoeExternalEngagement.warm().then(function () { return true; })');
        await publicSmoke.waitForEvaluation(
            cdp.client,
            cdp.sessionId,
            'Boolean(window.chatWidget && window.ZaoyoeEngagement && document.querySelector(".chat-widget-fab"))',
            Boolean,
            timeoutMs
        );
        await publicSmoke.evaluate(cdp.client, cdp.sessionId, 'window.ZaoyoeEngagement.refresh().then(function () { return true; })');
        const metrics = await publicSmoke.waitForEvaluation(
            cdp.client,
            cdp.sessionId,
            `(() => {
                const bubble = document.querySelector('.message-preview.engagement-preview');
                if (!bubble) return null;
                const rect = bubble.getBoundingClientRect();
                return {
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    text: bubble.textContent || '',
                    hasRouteLink: Boolean(bubble.querySelector('.engagement-preview__path-link'))
                };
            })()`,
            (value) => value && value.width >= 180 && value.height >= 72 && value.hasRouteLink,
            timeoutMs
        );
        await publicSmoke.evaluate(cdp.client, cdp.sessionId, `(() => {
            const routeLink = document.querySelector('.message-preview.engagement-preview .engagement-preview__path-link');
            if (routeLink) routeLink.click();
            return true;
        })()`);
        const runtime = await publicSmoke.waitForEvaluation(
            cdp.client,
            cdp.sessionId,
            `(() => {
                const state = window.__externalEmbedSmoke || {};
                return {
                    feedHits: state.feedHits || [],
                    events: state.events || [],
                    walletViews: state.walletViews || [],
                    pageId: window.ZaoyoeExternalEngagement?.config?.pageId || '',
                    apiOrigin: window.ZaoyoeExternalEngagement?.config?.apiOrigin || ''
                };
            })()`,
            (value) => value
                && Array.isArray(value.events)
                && value.events.some((event) => event.event_type === 'view')
                && value.events.some((event) => event.event_type === 'click')
                && Array.isArray(value.walletViews)
                && value.walletViews.some((entry) => entry.view === 'cards'),
            timeoutMs
        );

        const feedHit = Array.isArray(runtime.feedHits) ? runtime.feedHits[0] : null;
        const failures = [];
        if (!feedHit?.url || !feedHit.url.startsWith(apiOrigin)) failures.push('feed did not use configured API origin');
        if (feedHit?.credentials !== 'omit') failures.push('external feed did not use credentials=omit');
        if (runtime.pageId !== DEFAULT_PAGE_ID) failures.push('external page id was not gongyi');
        if (!runtime.events.some((event) => event.page_id === DEFAULT_PAGE_ID)) failures.push('events did not report page_id=gongyi');
        if (!runtime.events.some((event) => event.metadata?.external_host === true)) failures.push('events did not include external_host=true');

        return {
            status: failures.length ? 'failed' : 'passed',
            metrics,
            runtime,
            failures
        };
    } finally {
        if (cdp?.client) cdp.client.close();
        if (chrome && !keepOpen) await chrome.close();
    }
}

function buildSummary(results = {}, durationMs = 0) {
    const failures = [
        ...(results.feedCors?.failures || []),
        ...(results.eventCors?.failures || []),
        ...(results.browser?.failures || [])
    ];
    const lines = [
        'Engagement External Embed Smoke',
        `Status: ${failures.length ? 'FAILED' : 'PASSED'}`,
        `Duration: ${Math.round(durationMs)}ms`,
        ''
    ];
    lines.push(`${results.feedCors?.status === 'passed' ? 'PASS' : 'FAIL'} CORS feed preflight`);
    lines.push(`${results.eventCors?.status === 'passed' ? 'PASS' : 'FAIL'} CORS event preflight`);
    lines.push(`${results.browser?.status === 'passed' ? 'PASS' : 'FAIL'} external embed browser runtime`);
    failures.forEach((failure) => lines.push(`  - ${failure}`));
    return {
        status: failures.length ? 'failed' : 'passed',
        failures,
        text: lines.join('\n')
    };
}

function evaluateCorsProbe(response = {}, origin = '') {
    const failures = [];
    if (Number(response.statusCode || 0) !== 204) failures.push(`expected 204 preflight, received ${response.statusCode}`);
    if (response.headers?.['access-control-allow-origin'] !== origin) failures.push('missing Access-Control-Allow-Origin for external origin');
    if (!String(response.headers?.['access-control-allow-methods'] || '').includes('OPTIONS')) failures.push('missing OPTIONS in Access-Control-Allow-Methods');
    return {
        status: failures.length ? 'failed' : 'passed',
        failures,
        response
    };
}

async function runExternalEmbedSmoke(options = {}) {
    const parsed = { ...parseArgs([]), ...options };
    const startedAt = Date.now();
    let preview = null;
    let external = null;
    try {
        const baseUrl = normalizeOrigin(parsed.baseUrl);
        preview = baseUrl ? { baseUrl, close: async () => {} } : await publicSmoke.startLocalPreviewServer();
        const apiOrigin = normalizeOrigin(parsed.apiOrigin || preview.baseUrl);
        const assetBase = `${normalizeOrigin(parsed.assetBase || preview.baseUrl)}/`;
        external = await startExternalProbeServer({
            apiOrigin,
            assetBase,
            pageId: parsed.pageId || DEFAULT_PAGE_ID,
            site: parsed.site || DEFAULT_SITE
        });

        const feedCors = evaluateCorsProbe(await probeCors({
            apiOrigin,
            externalOrigin: external.baseUrl,
            method: 'GET',
            route: 'feed'
        }), external.baseUrl);
        const eventCors = evaluateCorsProbe(await probeCors({
            apiOrigin,
            externalOrigin: external.baseUrl,
            method: 'POST',
            route: 'event'
        }), external.baseUrl);
        const browser = await runBrowserProbe({
            pageUrl: external.pageUrl,
            apiOrigin,
            chromePath: parsed.chromePath,
            timeoutMs: parsed.timeoutMs,
            keepOpen: parsed.keepOpen
        });
        return {
            ...buildSummary({ feedCors, eventCors, browser }, Date.now() - startedAt),
            baseUrl: preview.baseUrl,
            externalUrl: external.pageUrl,
            feedCors,
            eventCors,
            browser
        };
    } finally {
        if (external) await external.close();
        if (preview) await preview.close();
    }
}

if (require.main === module) {
    runExternalEmbedSmoke(parseArgs(process.argv.slice(2)))
        .then((summary) => {
            console.log(summary.text);
            process.exit(summary.status === 'passed' ? 0 : 1);
        })
        .catch((error) => {
            console.error('Engagement External Embed Smoke failed:');
            console.error(error?.stack || error?.message || String(error));
            process.exit(1);
        });
}

module.exports = {
    buildExternalProbeHtml,
    buildExternalSmokeFeedItem,
    buildSummary,
    evaluateCorsProbe,
    parseArgs,
    probeCors,
    runExternalEmbedSmoke,
    startExternalProbeServer
};
