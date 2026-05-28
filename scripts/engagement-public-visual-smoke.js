#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const { createLocalPreviewApp } = require('./local-preview-server');

const DEFAULT_TIMEOUT_MS = 90000;
const DEFAULT_PAGES = Object.freeze(['home', 'prompts', 'shop', 'verify', 'guestbook', 'gongyi']);
const DEFAULT_SCENARIOS = Object.freeze(['desktop', 'mobile', 'dark']);
const PAGE_DEFINITIONS = Object.freeze({
    home: { label: 'Home', path: '/' },
    prompts: { label: 'Prompts', path: '/prompts.html' },
    shop: { label: 'Shop', path: '/shop.html' },
    verify: { label: 'Verify', path: '/verify.html' },
    guestbook: { label: 'Guestbook', path: '/guestbook.html' },
    gongyi: {
        label: 'Gongyi',
        path: '/gongyi.html',
        externalRedirect: true,
        externalHost: 'sub2api.fatherkey.com'
    }
});
const SCENARIO_DEFINITIONS = Object.freeze({
    desktop: { label: 'desktop light', width: 1366, height: 860, mobile: false, theme: 'light', placement: 'robot_bubble' },
    mobile: { label: 'mobile light', width: 390, height: 844, mobile: true, theme: 'light', placement: 'robot_bubble' },
    dark: { label: 'desktop dark', width: 1366, height: 860, mobile: false, theme: 'dark', placement: 'top_banner' }
});
const CHROME_CANDIDATES = Object.freeze([
    process.env.CHROME_BIN || '',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
    'chromium-browser',
    'chromium'
].filter(Boolean));

function parseList(value = '', fallback = []) {
    const raw = String(value || '').trim();
    if (!raw || raw === 'all') return [...fallback];
    return raw
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index);
}

function parseArgs(argv = []) {
    const options = {
        baseUrl: '',
        pages: [...DEFAULT_PAGES],
        scenarios: [...DEFAULT_SCENARIOS],
        timeoutMs: DEFAULT_TIMEOUT_MS,
        chromePath: '',
        keepOpen: false,
        skipExternal: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = String(argv[index] || '').trim();
        if (!arg) continue;
        if (arg === '--base-url') {
            options.baseUrl = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (arg === '--pages') {
            options.pages = parseList(argv[index + 1], DEFAULT_PAGES).filter((pageId) => PAGE_DEFINITIONS[pageId]);
            index += 1;
            continue;
        }
        if (arg === '--scenarios' || arg === '--viewports') {
            options.scenarios = parseList(argv[index + 1], DEFAULT_SCENARIOS).filter((scenarioId) => SCENARIO_DEFINITIONS[scenarioId]);
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
            continue;
        }
        if (arg === '--skip-external') {
            options.skipExternal = true;
            continue;
        }
    }

    if (!options.pages.length) options.pages = [...DEFAULT_PAGES];
    if (!options.scenarios.length) options.scenarios = [...DEFAULT_SCENARIOS];
    return options;
}

function normalizeBaseUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, '');
}

function buildPageUrl(baseUrl = '', pageId = '') {
    const page = PAGE_DEFINITIONS[pageId] || PAGE_DEFINITIONS.home;
    const url = new URL(page.path, `${normalizeBaseUrl(baseUrl)}/`);
    url.searchParams.set('engagementSmoke', '1');
    return url.toString();
}

function buildSmokeFeedItem(pageId = 'home', scenario = {}) {
    const placement = scenario.placement || 'robot_bubble';
    return {
        id: `visual-smoke-${pageId}-${placement}`,
        rule_id: `visual-smoke-rule-${pageId}-${placement}`,
        source: 'rule',
        source_module: 'engagement_visual_smoke',
        source_event_id: `visual-smoke-${pageId}`,
        trigger_type: 'page_view',
        title: pageId === 'shop' ? 'Coupon ready' : 'Visual smoke notice',
        content: 'A test coupon is available. Open "My Wallet > Cards" to inspect it.',
        page_id: pageId,
        site: 'cn',
        placement,
        priority: 99,
        action_label: 'Open cards',
        action_url: 'wallet://cards',
        dismiss_ttl_hours: 0,
        tone: pageId === 'shop' ? 'commerce' : 'info',
        metadata: {
            action_path_label: 'My Wallet > Cards',
            wallet_view: 'cards',
            visual_smoke: true
        }
    };
}

function getPlacementSelector(placement = 'robot_bubble') {
    if (placement === 'robot_bubble') return '.message-preview.engagement-preview';
    return `.engagement-surface.engagement-surface--${placement}`;
}

function resolveChromePath(preferredPath = '') {
    const candidates = [String(preferredPath || '').trim(), ...CHROME_CANDIDATES].filter(Boolean);
    for (const candidate of candidates) {
        if (candidate.includes(path.sep)) {
            if (fs.existsSync(candidate)) return candidate;
            continue;
        }
        return candidate;
    }
    throw new Error('Unable to locate Chrome. Use --chrome-path or CHROME_BIN.');
}

function delay(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function requestJson(urlString = '') {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.request(url, {
            method: 'GET',
            headers: { Accept: 'application/json' }
        }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(body || '{}'));
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.on('error', reject);
        request.end();
    });
}

function requestText(urlString = '') {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.request(url, { method: 'GET' }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => resolve(body));
        });
        request.on('error', reject);
        request.end();
    });
}

function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = Number(address?.port || 0);
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

async function startLocalPreviewServer() {
    const port = await findFreePort();
    const { app } = createLocalPreviewApp({ port });
    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(port, '127.0.0.1', () => resolve(instance));
        instance.on('error', reject);
    });
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve) => server.close(resolve))
    };
}

function createChromeUserDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-public-smoke-chrome-'));
}

function cleanupChromeUserDataDir(dir = '') {
    const resolved = String(dir || '').trim();
    if (!resolved || !path.resolve(resolved).startsWith(path.resolve(os.tmpdir()))) return;
    try {
        fs.rmSync(resolved, { recursive: true, force: true });
    } catch (_) {
        // Best effort cleanup.
    }
}

async function waitForChromeVersion(debugPort, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() <= deadline) {
        try {
            const payload = await requestJson(`http://127.0.0.1:${debugPort}/json/version`);
            if (payload?.webSocketDebuggerUrl) return payload;
        } catch (error) {
            lastError = error;
        }
        await delay(150);
    }
    throw lastError || new Error('Timed out waiting for Chrome DevTools endpoint');
}

async function launchChrome(options = {}) {
    const debugPort = await findFreePort();
    const chromePath = resolveChromePath(options.chromePath);
    const userDataDir = createChromeUserDataDir();
    const args = [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--metrics-recording-only',
        '--disable-default-apps',
        '--mute-audio',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        'about:blank'
    ];
    const child = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });
    child.stdout.on('data', () => {});
    const version = await waitForChromeVersion(debugPort);
    return {
        chromePath,
        debugPort,
        webSocketDebuggerUrl: version.webSocketDebuggerUrl,
        child,
        userDataDir,
        getStderr: () => stderr,
        close: async () => {
            if (!child.killed) {
                try { child.kill('SIGTERM'); } catch (_) {}
                await Promise.race([
                    new Promise((resolve) => child.once('close', resolve)),
                    delay(2000)
                ]);
                if (!child.killed) {
                    try { child.kill('SIGKILL'); } catch (_) {}
                }
            }
            cleanupChromeUserDataDir(userDataDir);
        }
    };
}

class CdpClient extends EventEmitter {
    constructor(wsUrl) {
        super();
        this.wsUrl = wsUrl;
        this.nextId = 1;
        this.pending = new Map();
        this.socket = null;
    }

    async connect() {
        this.socket = new WebSocket(this.wsUrl);
        this.socket.on('message', (data) => this.handleMessage(data));
        await new Promise((resolve, reject) => {
            this.socket.once('open', resolve);
            this.socket.once('error', reject);
        });
        return this;
    }

    handleMessage(data) {
        let message = null;
        try {
            message = JSON.parse(data.toString());
        } catch (_) {
            return;
        }

        if (message.id && this.pending.has(message.id)) {
            const { resolve, reject } = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (message.error) {
                reject(new Error(message.error.message || JSON.stringify(message.error)));
            } else {
                resolve(message.result || {});
            }
            return;
        }

        if (message.method) {
            this.emit(message.method, message.params || {}, message.sessionId || '');
        }
    }

    send(method, params = {}, sessionId = '') {
        const id = this.nextId;
        this.nextId += 1;
        const message = { id, method, params };
        if (sessionId) message.sessionId = sessionId;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify(message), (error) => {
                if (error) {
                    this.pending.delete(id);
                    reject(error);
                }
            });
        });
    }

    waitForEvent(method, predicate = () => true, timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Timed out waiting for CDP event ${method}`));
            }, timeoutMs);
            const handler = (params, sessionId) => {
                if (!predicate(params, sessionId)) return;
                cleanup();
                resolve({ params, sessionId });
            };
            const cleanup = () => {
                clearTimeout(timer);
                this.off(method, handler);
            };
            this.on(method, handler);
        });
    }

    close() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.close();
        }
    }
}

async function createPageSession(browserWsUrl) {
    const client = await new CdpClient(browserWsUrl).connect();
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {});
    return { client, sessionId, targetId };
}

async function evaluate(client, sessionId, expression, options = {}) {
    const result = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: options.awaitPromise !== false,
        returnByValue: options.returnByValue !== false,
        userGesture: options.userGesture !== false
    }, sessionId);
    if (result.exceptionDetails) {
        const text = result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'Runtime evaluation failed';
        throw new Error(text);
    }
    return result.result?.value;
}

async function waitForEvaluation(client, sessionId, expression, validate, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let lastValue = null;
    while (Date.now() <= deadline) {
        lastValue = await evaluate(client, sessionId, expression).catch(() => null);
        if (validate(lastValue)) return lastValue;
        await delay(200);
    }
    throw new Error(`Timed out waiting for expression. Last value: ${JSON.stringify(lastValue)}`);
}

function buildInitStubScript() {
    return `
(function () {
    function makeQuery(data) {
        var result = { data: Array.isArray(data) ? data : [], error: null };
        var chain = {
            select: function () { return chain; },
            eq: function () { return chain; },
            in: function () { return chain; },
            order: function () { return chain; },
            limit: function () { return chain; },
            single: function () { return Promise.resolve({ data: null, error: null }); },
            maybeSingle: function () { return Promise.resolve({ data: null, error: null }); },
            insert: function () { return Promise.resolve({ data: null, error: null }); },
            upsert: function () { return Promise.resolve({ data: null, error: null }); },
            update: function () { return chain; },
            delete: function () { return chain; },
            then: function (resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
            catch: function (reject) { return Promise.resolve(result).catch(reject); }
        };
        return chain;
    }
    window.__engagementSmoke = window.__engagementSmoke || { events: [], walletViews: [] };
    window.supabaseClient = {
        auth: {
            getUser: function () { return Promise.resolve({ data: { user: null }, error: null }); },
            getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
            onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
        },
        rpc: function () { return Promise.resolve({ data: false, error: null }); },
        from: function () { return makeQuery([]); },
        channel: function () { return { on: function () { return this; }, subscribe: function () { return this; }, unsubscribe: function () {} }; },
        removeChannel: function () {},
        storage: { from: function () { return { upload: function () { return Promise.resolve({ data: null, error: null }); }, getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } }
    };
    window.ZaoyoeUserPresence = { start: function () {} };
    window.ZaoyoeAdminPresence = { start: function () {} };
    window.AdminAccess = { getCurrentAdminAccess: function () { return Promise.resolve({ user: null, isAdmin: false }); } };
    if (!window.__engagementSmokeFetchHooked && window.fetch && window.Response) {
        window.__engagementSmokeFetchHooked = true;
        var smokeOriginalFetch = window.fetch.bind(window);
        window.fetch = function (input, init) {
            var url = String((input && input.url) || input || '');
            var isEngagementFeed = url.indexOf('/api/engagement/feed') !== -1 || (url.indexOf('/api/public') !== -1 && url.indexOf('scope=engagement') !== -1 && url.indexOf('route=feed') !== -1);
            var isEngagementEvent = url.indexOf('/api/engagement/event') !== -1 || (url.indexOf('/api/public') !== -1 && url.indexOf('scope=engagement') !== -1 && url.indexOf('route=event') !== -1);
            if (isEngagementFeed) {
                window.__engagementSmoke.feedHits = (window.__engagementSmoke.feedHits || 0) + 1;
                return Promise.resolve(new Response(JSON.stringify({
                    success: true,
                    items: window.__engagementSmokeFeedItem ? [window.__engagementSmokeFeedItem] : [],
                    asset_center: { style: { enabled: true }, assets: [] },
                    support_entry: { enabled: true, contexts: [], guides: [] }
                }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
            }
            if (isEngagementEvent) {
                window.__engagementSmoke.eventHits = (window.__engagementSmoke.eventHits || 0) + 1;
                try {
                    window.__engagementSmoke.events.push(JSON.parse((init && init.body) || '{}'));
                } catch (_) {}
                return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
            }
            return smokeOriginalFetch(input, init);
        };
    }
}());`;
}

function buildInstallHooksExpression(feedItem = {}) {
    return `
(function () {
    ${buildInitStubScript()}
    window.localStorage && window.localStorage.removeItem('zaoyoe_engagement_dismissed_v1');
    window.__engagementSmoke = { events: [], walletViews: [], feedHits: 0, eventHits: 0 };
    window.__engagementSmokeFeedItem = ${JSON.stringify(feedItem)};
    window.ZaoyoeWalletModalBootstrap = {
        open: function (view, context) {
            window.__engagementSmoke.walletViews.push({ view: view || '', context: context || {} });
            return Promise.resolve(true);
        }
    };
    var originalFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function (input, init) {
        var url = String((input && input.url) || input || '');
        var isEngagementFeed = url.indexOf('/api/engagement/feed') !== -1 || (url.indexOf('/api/public') !== -1 && url.indexOf('scope=engagement') !== -1 && url.indexOf('route=feed') !== -1);
        var isEngagementEvent = url.indexOf('/api/engagement/event') !== -1 || (url.indexOf('/api/public') !== -1 && url.indexOf('scope=engagement') !== -1 && url.indexOf('route=event') !== -1);
        if (isEngagementFeed) {
            window.__engagementSmoke.feedHits += 1;
            return Promise.resolve(new Response(JSON.stringify({
                success: true,
                items: window.__engagementSmokeFeedItem ? [window.__engagementSmokeFeedItem] : [],
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
                support_entry: {
                    enabled: true,
                    entry_label: 'Quick help',
                    contexts: [{ id: 'default', label: 'Quick help', shortcuts: ['live_chat'], enabled: true }],
                    guides: []
                }
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if (isEngagementEvent) {
            window.__engagementSmoke.eventHits += 1;
            try {
                window.__engagementSmoke.events.push(JSON.parse((init && init.body) || '{}'));
            } catch (_) {
                window.__engagementSmoke.events.push({ raw: (init && init.body) || '' });
            }
            return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return originalFetch ? originalFetch(input, init) : Promise.resolve(new Response('{}', { status: 200 }));
    };
    return true;
}());`;
}

async function navigateTo(client, sessionId, url, timeoutMs = 30000) {
    const loadPromise = client.waitForEvent('Page.loadEventFired', (params, eventSessionId) => eventSessionId === sessionId, timeoutMs)
        .catch(() => null);
    await client.send('Page.navigate', { url }, sessionId);
    await loadPromise;
    await waitForEvaluation(client, sessionId, 'document.readyState', (value) => value === 'complete' || value === 'interactive', timeoutMs);
}

async function applyScenario(client, sessionId, scenario = {}) {
    await client.send('Emulation.setDeviceMetricsOverride', {
        width: scenario.width,
        height: scenario.height,
        deviceScaleFactor: scenario.mobile ? 2 : 1,
        mobile: scenario.mobile === true
    }, sessionId);
    await client.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scenario.theme || 'light' }]
    }, sessionId).catch(() => {});
}

async function warmEngagementRuntime(client, sessionId, timeoutMs = 30000) {
    await evaluate(client, sessionId, `
(async function () {
    if (window.ZaoyoeChatWidgetBootstrap && typeof window.ZaoyoeChatWidgetBootstrap.warm === 'function') {
        await window.ZaoyoeChatWidgetBootstrap.warm();
    }
    return true;
}());`);
    await waitForEvaluation(
        client,
        sessionId,
        'Boolean(window.chatWidget && window.ZaoyoeEngagement && document.querySelector(".chat-widget-fab"))',
        Boolean,
        timeoutMs
    );
    await evaluate(client, sessionId, 'window.chatWidget && window.chatWidget.ready ? window.chatWidget.ready.then(function () { return true; }) : true;');
}

function buildMetricsExpression(selector = '') {
    return `
(function () {
    var selector = ${JSON.stringify(selector)};
    var element = document.querySelector(selector);
    if (!element) return { exists: false, selector: selector };
    var rect = element.getBoundingClientRect();
    var style = window.getComputedStyle(element);
    var routeLink = element.querySelector('.engagement-preview__path-link');
    return {
        exists: true,
        selector: selector,
        text: element.textContent || '',
        role: element.getAttribute('role') || '',
        ariaLive: element.getAttribute('aria-live') || '',
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity || 0),
        backgroundColor: style.backgroundColor,
        color: style.color,
        overflowViewport: rect.left < -1 || rect.top < -1 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1,
        hasRouteLink: Boolean(routeLink),
        routeText: routeLink ? routeLink.textContent.trim() : ''
    };
}());`;
}

function assertSmokeMetrics(metrics = {}, context = {}) {
    const failures = [];
    const maxWidth = Math.min(420, Math.max(0, Number(metrics.viewportWidth || 0) - (context.scenario?.mobile ? 32 : 48))) + 3;
    if (!metrics.exists) failures.push('surface is missing');
    if (metrics.display === 'none' || metrics.visibility === 'hidden' || Number(metrics.opacity) <= 0) failures.push('surface is hidden');
    if (Number(metrics.width || 0) < 120 || Number(metrics.height || 0) < 40) failures.push(`surface is too small (${metrics.width}x${metrics.height})`);
    if (Number(metrics.width || 0) > maxWidth && context.placement === 'robot_bubble') failures.push(`bubble is too wide (${metrics.width}px > ${maxWidth}px)`);
    if (metrics.overflowViewport) failures.push(`surface overflows viewport (${metrics.left},${metrics.top},${metrics.right},${metrics.bottom})`);
    if (!['status', 'dialog'].includes(String(metrics.role || ''))) failures.push(`unexpected role ${metrics.role || '<empty>'}`);
    if (!['polite', 'assertive'].includes(String(metrics.ariaLive || ''))) failures.push(`unexpected aria-live ${metrics.ariaLive || '<empty>'}`);
    if (!metrics.hasRouteLink) failures.push('route path link is missing');
    if (!/Wallet\s*>\s*Cards|我的钱包\s*[>＞]\s*卡券/i.test(String(metrics.routeText || ''))) failures.push(`route path text is wrong: ${metrics.routeText || '<empty>'}`);
    if (context.scenario?.theme === 'dark' && /255,\s*255,\s*255/.test(String(metrics.backgroundColor || ''))) {
        failures.push('dark scenario still uses a pure white bubble background');
    }
    return failures;
}

async function runPageScenario(client, sessionId, baseUrl, pageId, scenarioId, options = {}) {
    const page = PAGE_DEFINITIONS[pageId];
    const scenario = SCENARIO_DEFINITIONS[scenarioId];
    if (!page || !scenario) {
        return { status: 'failed', label: `${pageId}/${scenarioId}`, failures: ['unknown page or scenario'] };
    }

    if (page.externalRedirect) {
        if (options.skipExternal) {
            return { status: 'skipped', label: `${pageId}/${scenarioId}`, text: 'external page skipped by flag' };
        }
        const html = await requestText(buildPageUrl(baseUrl, pageId));
        const refreshMatch = html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]*>/i);
        const refreshTag = refreshMatch ? refreshMatch[0] : '';
        const redirectCheck = {
            hasRefresh: Boolean(refreshTag),
            content: refreshTag,
            hasLocalWidgetLoader: /chat-widget-loader\.js/i.test(html)
        };
        const ok = redirectCheck.hasRefresh
            && String(redirectCheck.content || '').includes(page.externalHost)
            && redirectCheck.hasLocalWidgetLoader === false;
        return {
            status: ok ? 'skipped' : 'failed',
            label: `${pageId}/${scenarioId}`,
            text: ok ? `external redirect host ${page.externalHost}` : 'external redirect contract failed',
            failures: ok ? [] : [JSON.stringify(redirectCheck)]
        };
    }

    await applyScenario(client, sessionId, scenario);
    const feedItem = buildSmokeFeedItem(pageId, scenario);
    await navigateTo(client, sessionId, buildPageUrl(baseUrl, pageId), options.timeoutMs);
    await evaluate(client, sessionId, buildInstallHooksExpression(feedItem));
    await warmEngagementRuntime(client, sessionId, options.timeoutMs);
    await evaluate(client, sessionId, 'window.__engagementSmokeFeedItem = ' + JSON.stringify(feedItem) + '; true;');
    await evaluate(client, sessionId, 'window.ZaoyoeEngagement.refresh(); true;');
    const selector = getPlacementSelector(scenario.placement);
    const metrics = await waitForEvaluation(
        client,
        sessionId,
        buildMetricsExpression(selector),
        (value) => value?.exists === true && Number(value.width || 0) > 0,
        options.timeoutMs
    );
    const failures = assertSmokeMetrics(metrics, {
        page,
        pageId,
        scenario,
        scenarioId,
        placement: scenario.placement
    });

    await evaluate(client, sessionId, `
(function () {
    var element = document.querySelector(${JSON.stringify(selector)});
    var route = element && element.querySelector('.engagement-preview__path-link');
    if (route) route.click();
    return true;
}());`);
    const interaction = await waitForEvaluation(
        client,
        sessionId,
        '(window.__engagementSmoke && { walletViews: window.__engagementSmoke.walletViews, events: window.__engagementSmoke.events, feedHits: window.__engagementSmoke.feedHits, eventHits: window.__engagementSmoke.eventHits }) || null',
        (value) => value && Array.isArray(value.walletViews) && value.walletViews.length > 0,
        Math.min(12000, options.timeoutMs)
    ).catch((error) => ({ error: error.message, walletViews: [], events: [] }));

    if (!Array.isArray(interaction.walletViews) || !interaction.walletViews.some((entry) => entry.view === 'cards')) {
        failures.push('route click did not open wallet cards');
    }
    if (!Array.isArray(interaction.events) || !interaction.events.some((entry) => entry.event_type === 'view')) {
        failures.push('view event was not reported');
    }
    if (!Array.isArray(interaction.events) || !interaction.events.some((entry) => entry.event_type === 'click')) {
        failures.push('click event was not reported');
    }

    return {
        status: failures.length ? 'failed' : 'passed',
        label: `${pageId}/${scenarioId}`,
        text: `${page.label} ${scenario.label} ${scenario.placement} ${metrics.width}x${metrics.height}`,
        metrics,
        failures
    };
}

function buildSummary(results = [], durationMs = 0) {
    const passed = results.filter((item) => item.status === 'passed').length;
    const skipped = results.filter((item) => item.status === 'skipped').length;
    const failed = results.filter((item) => item.status === 'failed').length;
    const lines = [
        'Engagement Public Visual Smoke',
        `Status: ${failed ? 'FAILED' : 'PASSED'}`,
        `Passed: ${passed}`,
        `Skipped: ${skipped}`,
        `Failed: ${failed}`,
        `Duration: ${Math.round(durationMs)}ms`,
        ''
    ];
    results.forEach((item) => {
        const prefix = item.status === 'passed' ? 'PASS' : (item.status === 'skipped' ? 'SKIP' : 'FAIL');
        lines.push(`${prefix} ${item.label} - ${item.text || ''}`.trim());
        (item.failures || []).forEach((failure) => lines.push(`  - ${failure}`));
    });
    return {
        status: failed ? 'failed' : 'passed',
        passed,
        skipped,
        failed,
        text: lines.join('\n')
    };
}

async function runVisualSmoke(options = {}) {
    const parsed = {
        ...parseArgs([]),
        ...options
    };
    const startedAt = Date.now();
    let preview = null;
    let chrome = null;
    let cdp = null;
    const results = [];

    try {
        const baseUrl = normalizeBaseUrl(parsed.baseUrl);
        preview = baseUrl ? { baseUrl, close: async () => {} } : await startLocalPreviewServer();
        chrome = await launchChrome(parsed);
        cdp = await createPageSession(chrome.webSocketDebuggerUrl);
        await cdp.client.send('Page.addScriptToEvaluateOnNewDocument', {
            source: buildInitStubScript()
        }, cdp.sessionId);

        for (const pageId of parsed.pages) {
            for (const scenarioId of parsed.scenarios) {
                const result = await runPageScenario(cdp.client, cdp.sessionId, preview.baseUrl, pageId, scenarioId, parsed);
                results.push(result);
            }
        }

        return {
            ...buildSummary(results, Date.now() - startedAt),
            baseUrl: preview.baseUrl,
            chromePath: chrome.chromePath,
            results
        };
    } finally {
        if (cdp?.client) cdp.client.close();
        if (chrome && !parsed.keepOpen) await chrome.close();
        if (preview) await preview.close();
    }
}

if (require.main === module) {
    runVisualSmoke(parseArgs(process.argv.slice(2)))
        .then((summary) => {
            console.log(summary.text);
            process.exit(summary.status === 'passed' ? 0 : 1);
        })
        .catch((error) => {
            console.error('Engagement Public Visual Smoke failed:');
            console.error(error?.stack || error?.message || String(error));
            process.exit(1);
        });
}

module.exports = {
    DEFAULT_PAGES,
    DEFAULT_SCENARIOS,
    PAGE_DEFINITIONS,
    SCENARIO_DEFINITIONS,
    assertSmokeMetrics,
    buildPageUrl,
    buildSmokeFeedItem,
    buildSummary,
    createPageSession,
    delay,
    evaluate,
    findFreePort,
    getPlacementSelector,
    launchChrome,
    navigateTo,
    parseArgs,
    runVisualSmoke,
    startLocalPreviewServer,
    waitForEvaluation
};
