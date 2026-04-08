const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const HARD_CODED_SUPABASE_HOST = 'mmkugdibsaeoevliebzk.supabase.co';
const HARD_CODED_SUPABASE_KEY = 'sb_publishable_lwkiF-sQ80z8e9oMcejFPQ_j7oezjcF';

const RUNTIME_PAGES = [
    'index.html',
    'guestbook.html',
    'admin-entry.html',
    'verify.html',
    'shop.html',
    'prompts.html',
    'debug-realtime.html',
    'admin-studio.html',
    'auth-callback.html',
    'privacy.html',
    'reset-password.html'
];

const RUNTIME_SCRIPTS = [
    'supabase-client.js',
    'js/admin-analytics-metric-context.js',
    'js/admin-analytics-derived-bundles.js',
    'js/admin-analytics-runtime-controls.js',
    'js/admin-analytics-panel-loaders.js',
    'js/admin-analytics-lifecycle.js',
    'js/admin-analytics-workbench.js',
    'js/admin-analytics-insight-cards.js',
    'js/admin-analytics-ai-state.js',
    'js/admin-analytics-ai-dom.js',
    'js/admin-analytics-ai-helpers.js',
    'js/admin-analytics-ai-prompt-builders.js',
    'js/admin-analytics-ai-controller.js',
    'js/admin-analytics-export-builders.js',
    'js/admin-analytics-ai-export.js',
    'js/admin-shop.js',
    'js/admin-workbench.js',
    'js/admin-ticket-links.js',
    'js/avatar-uploader.js',
    'supabase-auth-functions.js',
    'admin-config.js',
    'admin-studio.js'
];

const CHAT_WIDGET_PAGES = [
    'index.html',
    'guestbook.html',
    'verify.html',
    'shop.html',
    'prompts.html',
    'privacy.html'
];

function readVercelConfig() {
    return JSON.parse(readRepoFile('vercel.json'));
}

function getGlobalCspHeaderValue() {
    const config = readVercelConfig();
    const globalHeaders = Array.isArray(config.headers) ? config.headers : [];
    const match = globalHeaders
        .flatMap((entry) => Array.isArray(entry?.headers) ? entry.headers : [])
        .find((header) => header?.key === 'Content-Security-Policy');

    return String(match?.value || '');
}

function parseCspDirectives(cspValue) {
    return new Map(
        String(cspValue || '')
            .split(';')
            .map((directive) => directive.trim())
            .filter(Boolean)
            .map((directive) => {
                const [name, ...values] = directive.split(/\s+/);
                return [name, values];
            })
    );
}

function collectInlineScriptHashes(relativePaths = []) {
    const hashes = new Set();

    for (const relativePath of relativePaths) {
        const source = readRepoFile(relativePath);
        for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            const attributes = String(match[1] || '');
            if (/\bsrc\s*=/.test(attributes)) {
                continue;
            }

            const body = String(match[2] || '').trim();
            if (!body) {
                continue;
            }

            hashes.add(`'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`);
        }
    }

    return [...hashes].sort();
}

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function readAdminAnalyticsRuntimeSource() {
    return [
        readRepoFile('js/admin-analytics-metric-context.js'),
        readRepoFile('admin-analytics.js'),
        readRepoFile('js/admin-analytics-derived-bundles.js'),
        readRepoFile('js/admin-analytics-runtime-controls.js'),
        readRepoFile('js/admin-analytics-panel-loaders.js'),
        readRepoFile('js/admin-analytics-lifecycle.js'),
        readRepoFile('js/admin-analytics-workbench.js'),
        readRepoFile('js/admin-analytics-insight-cards.js'),
        readRepoFile('js/admin-analytics-ai-state.js'),
        readRepoFile('js/admin-analytics-ai-dom.js'),
        readRepoFile('js/admin-analytics-ai-helpers.js'),
        readRepoFile('js/admin-analytics-ai-prompt-builders.js'),
        readRepoFile('js/admin-analytics-ai-controller.js'),
        readRepoFile('js/admin-analytics-export-builders.js'),
        readRepoFile('js/admin-analytics-ai-export.js')
    ].join('\n');
}

function readAdminAnalyticsMetricContextSource() {
    return readAdminAnalyticsRuntimeSource();
}

function collectRepositorySourceFiles(rootDir = REPO_ROOT) {
    const files = [];
    const stack = ['.'];

    while (stack.length > 0) {
        const relativeDir = stack.pop();
        const absoluteDir = path.join(rootDir, relativeDir);
        const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });

        for (const entry of entries) {
            const relativePath = path.join(relativeDir, entry.name);
            const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');

            if (entry.isDirectory()) {
                if (['.git', 'node_modules', 'coverage', 'docs', 'tests'].includes(entry.name)) {
                    continue;
                }
                stack.push(relativePath);
                continue;
            }

            if (!/\.(html|js)(\.bak)?$/i.test(entry.name)) {
                continue;
            }

            files.push(normalizedPath);
        }
    }

    return files.sort();
}

function collectRepositoryHtmlFiles(rootDir = REPO_ROOT) {
    return collectRepositorySourceFiles(rootDir).filter((relativePath) => /\.(html)(\.bak)?$/i.test(relativePath));
}

test('active frontend runtime files no longer hardcode the production Supabase host or publishable key', () => {
    const violations = [];

    for (const relativePath of [...RUNTIME_PAGES, ...RUNTIME_SCRIPTS, 'vercel.json']) {
        const source = readRepoFile(relativePath);

        if (source.includes(HARD_CODED_SUPABASE_HOST)) {
            violations.push(`${relativePath} still hardcodes the production Supabase host`);
        }

        if (source.includes(HARD_CODED_SUPABASE_KEY)) {
            violations.push(`${relativePath} still hardcodes the production publishable key`);
        }
    }

    assert.deepEqual(violations, [], violations.join('\n'));
});

test('settings split Google One API into its own tab immediately after content settings', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioStyles = readRepoFile('admin-studio.css');
    const contentTabIndex = adminStudioSource.indexOf('data-settings-view="content"');
    const googleOneTabIndex = adminStudioSource.indexOf('data-settings-view="google-one"');
    const contentViewIndex = adminStudioSource.indexOf('id="settings-view-content"');
    const googleOneViewIndex = adminStudioSource.indexOf('id="settings-view-google-one"');
    const affiliateViewIndex = adminStudioSource.indexOf('id="settings-view-affiliate"');

    assert.notEqual(contentTabIndex, -1, 'admin-studio.html should include the content settings tab');
    assert.notEqual(googleOneTabIndex, -1, 'admin-studio.html should include the Google One API settings tab');
    assert.ok(googleOneTabIndex > contentTabIndex, 'the Google One API tab should render after the content settings tab');
    assert.notEqual(contentViewIndex, -1, 'admin-studio.html should include the content settings view');
    assert.notEqual(googleOneViewIndex, -1, 'admin-studio.html should include the Google One API settings view');
    assert.notEqual(affiliateViewIndex, -1, 'admin-studio.html should include the affiliate settings view');
    assert.ok(
        googleOneViewIndex > contentViewIndex && googleOneViewIndex < affiliateViewIndex,
        'the Google One API settings view should render after content settings and before affiliate settings'
    );

    const contentViewSource = adminStudioSource.slice(contentViewIndex, googleOneViewIndex);
    const googleOneViewSource = adminStudioSource.slice(googleOneViewIndex, affiliateViewIndex);

    assert.equal(contentViewSource.includes('cfgVerifyPrice'), false, 'settings-view-content should no longer include the Google One API pricing controls');
    assert.equal(googleOneViewSource.includes('cfgVerifyPrice'), true, 'settings-view-google-one should host the Google One API pricing controls');
    assert.equal(googleOneViewSource.includes('cfgVerifyApiKey'), true, 'settings-view-google-one should host the Google One API credential controls');
    assert.equal(googleOneViewSource.includes('settings-google-one-hero'), true, 'settings-view-google-one should render the dedicated Google One API page hero');
    assert.equal(googleOneViewSource.includes('settings-google-one-top-grid'), true, 'settings-view-google-one should split Google One API configuration into a dedicated top card grid');
    assert.equal(googleOneViewSource.includes('settings-google-one-monitor-columns'), true, 'settings-view-google-one should split recent Google One API tasks and failures into dedicated monitor columns');
    assert.match(
        adminStudioStyles,
        /#settings-view-google-one \.module-content\.settings-google-one-layout\s*\{[\s\S]*width:\s*min\(100%, 1520px\);/,
        'admin-studio.css should give the Google One API settings view a dedicated centered single-column layout'
    );
    assert.equal(adminStudioStyles.includes('#settings-view-google-one .settings-google-one-top-grid'), true, 'admin-studio.css should define a dedicated split grid for the Google One API top cards');
    assert.equal(adminStudioStyles.includes('#settings-view-google-one .settings-google-one-monitor-columns'), true, 'admin-studio.css should define dedicated monitor columns for Google One API operations panels');
});

test('vercel config disables automatic preview deployments for codex work branches', () => {
    const vercelConfig = readVercelConfig();

    assert.equal(vercelConfig.$schema, 'https://openapi.vercel.sh/vercel.json');
    assert.equal(vercelConfig.git?.deploymentEnabled?.bot, false);
    assert.equal(vercelConfig.git?.deploymentEnabled?.['codex/*'], false);
});

test('vercel admin rewrite supports nested admin settings routes', () => {
    const vercelConfig = readVercelConfig();
    const rewrites = Array.isArray(vercelConfig.rewrites) ? vercelConfig.rewrites : [];
    const adminRewrite = rewrites.find((entry) => entry?.source === '/api/admin/:path*');

    assert.ok(adminRewrite, 'vercel.json should include a catch-all /api/admin rewrite');
    assert.equal(adminRewrite.destination, '/api/admin?route=:path*');
});

test('frontend entry pages load the shared Supabase runtime config before initialization', () => {
    const missing = [];

    for (const relativePath of RUNTIME_PAGES) {
        const source = readRepoFile(relativePath);

        if (!source.includes('/api/runtime/supabase-config')) {
            missing.push(`${relativePath} is missing /api/runtime/supabase-config`);
        }

        if (!source.includes('runtime-supabase-config.js')) {
            missing.push(`${relativePath} is missing js/runtime-supabase-config.js`);
        }
    }

    assert.deepEqual(missing, [], missing.join('\n'));
});

test('guestbook boot exposes Supabase init state and fails with explicit preview guidance when runtime config is unavailable', () => {
    const guestbookSource = readRepoFile('guestbook.js');
    const supabaseClientSource = readRepoFile('supabase-client.js');

    const guestbookMarkers = [
        'const SUPABASE_BOOT_TIMEOUT_MS = 4500;',
        'function buildSupabaseBootErrorMessage()',
        'function renderGuestbookBootError(message)',
        'window.__ZAOYOE_SUPABASE_CLIENT_STATE__',
        'npm run preview:local',
        "const hasFatalInitError = initState?.status === 'error';",
        'renderGuestbookBootError(buildSupabaseBootErrorMessage());'
    ];

    for (const marker of guestbookMarkers) {
        assert.equal(guestbookSource.includes(marker), true, `guestbook.js should contain ${marker}`);
    }

    const supabaseClientMarkers = [
        'function setSupabaseClientInitState(status, extra = {})',
        "window.__ZAOYOE_SUPABASE_CLIENT_STATE__ = nextState;",
        "setSupabaseClientInitState('pending');",
        "setSupabaseClientInitState('ready');",
        "reason: 'runtime_config_missing'",
        "reason: 'sdk_missing'"
    ];

    for (const marker of supabaseClientMarkers) {
        assert.equal(supabaseClientSource.includes(marker), true, `supabase-client.js should contain ${marker}`);
    }
});

test('guestbook render batch computes stagger delay before using it in CSS variables', () => {
    const guestbookSource = readRepoFile('guestbook.js');
    const delayDeclaration = "const delay = Math.min(index * 0.1, 1.0); // 100ms stagger, capped at 1s";
    const delayUsage = "setCssVariables(element, { '--guestbook-stagger-delay': `${delay}s` });";

    assert.notEqual(guestbookSource.includes(delayDeclaration), false, 'guestbook.js should declare the stagger delay');
    assert.notEqual(guestbookSource.includes(delayUsage), false, 'guestbook.js should apply the stagger delay CSS variable');
    assert.ok(
        guestbookSource.indexOf(delayDeclaration) < guestbookSource.indexOf(delayUsage),
        'guestbook.js should declare delay before using it during batch rendering'
    );
});

test('public pages wire the chat widget through the shared bootstrap loader', () => {
    const violations = [];

    for (const relativePath of CHAT_WIDGET_PAGES) {
        const source = readRepoFile(relativePath);

        if (!source.includes('css/chat-widget.css')) {
            violations.push(`${relativePath} is missing css/chat-widget.css`);
        }

        if (!source.includes('js/admin-workbench.js')) {
            violations.push(`${relativePath} is missing js/admin-workbench.js`);
        }

        if (!source.includes('js/components/ChatWidget.js')) {
            violations.push(`${relativePath} is missing js/components/ChatWidget.js`);
        }

        if (!source.includes('js/chat-widget-loader.js')) {
            violations.push(`${relativePath} is missing js/chat-widget-loader.js`);
        }
    }

    const inlineInitPages = ['index.html', 'verify.html', 'shop.html', 'prompts.html', 'privacy.html'];
    for (const relativePath of inlineInitPages) {
        const source = readRepoFile(relativePath);
        if (source.includes('new ChatWidget(window.supabaseClient)')) {
            violations.push(`${relativePath} should rely on js/chat-widget-loader.js instead of inline chat initialization`);
        }
    }

    assert.deepEqual(violations, [], violations.join('\n'));
});

test('chat widget runtime renderers externalize hidden, loading, and open-close state styling', () => {
    const chatWidgetSource = readRepoFile('js/components/ChatWidget.js');
    const chatWidgetCss = readRepoFile('css/chat-widget.css');

    const runtimeMarkers = [
        '_setFabHidden(hidden)',
        '_setFabDisabled(disabled)',
        '_setFabTransitionless(enabled)',
        '_setChatWindowForceHidden(hidden)',
        '_setChatWindowTransitionless(enabled)',
        '_setRuntimeStyle(target, prop, value, priority = \'\')',
        "const removeProperty = style['removeProperty'].bind(style);",
        "const setProperty = style['setProperty'].bind(style);",
        '_setChatWindowKeyboardAnimating(enabled, durationMs = 120)',
        '_setChatWindowDockHeight(heightPx)',
        '_setChatWindowDockBottom(bottomPx)',
        '_setMessagesContainerMinHeight(heightPx)',
        '_setSessionItemHidden(item, hidden)',
        'chat-file-input',
        'mascot-wrapper mascot-wrapper--compact',
        "loadingOverlay.className = 'loading-overlay';",
        "shield.className = 'chat-status-bar-shield';",
        "_toggleElementClass(this.overlay, 'chat-overlay--frozen', true)",
        "_toggleElementClass(this.chatWindow, 'chat-window--stable-visuals', true)",
        "_toggleElementClass(container, 'chat-prompt-spotlight-suspended', suspended)"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(chatWidgetSource.includes(marker), true, `js/components/ChatWidget.js should contain ${marker}`);
    }

    const removedRuntimeMarkers = [
        "shield.style.cssText = [",
        "this._statusBarShield.style.visibility = 'visible';",
        "this._statusBarShield.style.opacity = '1';",
        "this.messagesContainer.style.overflowY = 'hidden';",
        'loadingOverlay.style.cssText = `',
        "this.messagesContainer.style.position = 'relative';",
        "item.style.display = 'flex';",
        "item.style.display = 'none';",
        "item.style.display = matches ? 'flex' : 'none';",
        'style="display: none;"',
        'style="transform: scale(0.8);"',
        "this.fab.style.opacity = '0';",
        "this.fab.style.visibility = 'hidden';",
        "this.fab.style.pointerEvents = 'none';",
        'target.style.removeProperty(prop);',
        "target.style.setProperty(prop, String(value), priority);",
        "this.overlay.style.setProperty('position', 'fixed', 'important');",
        "this.chatWindow.style.setProperty('transition', 'transform 120ms cubic-bezier(0.22, 1, 0.36, 1)', 'important');",
        "this.chatWindow.style.setProperty('height', `${dockHeight}px`, 'important');",
        "container.style.setProperty('--cursor-x', '50%');",
        "this.chatWindow.style.setProperty('will-change', 'transform', 'important');"
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(chatWidgetSource.includes(marker), false, `js/components/ChatWidget.js should not contain ${marker}`);
    }

    const cssMarkers = [
        '.chat-status-bar-shield',
        '.chat-status-bar-shield.is-visible',
        '.chat-widget-fab.chat-widget-fab--hidden',
        '.chat-widget-fab.chat-widget-fab--disabled',
        '.chat-widget-fab.chat-widget-fab--transitionless',
        '.chat-window.chat-window--transitionless',
        '.chat-window.chat-window--force-hidden',
        '.chat-window.chat-window--keyboard-animating',
        '.chat-window.chat-window--stable-visuals',
        '.chat-window.chat-window--keyboard-bottom-docked',
        '.chat-window.chat-window--keyboard-height-locked',
        '.loading-overlay',
        '.chat-file-input',
        '.session-item.session-item--hidden',
        '.mascot-wrapper--compact',
        '.chat-messages.chat-messages--height-locked',
        '.chat-overlay.chat-overlay--frozen',
        '.poetry-nav-container.chat-prompt-spotlight-suspended'
    ];

    for (const marker of cssMarkers) {
        assert.equal(chatWidgetCss.includes(marker), true, `css/chat-widget.css should contain ${marker}`);
    }
});

test('user chat widget keeps a top safety gap on narrow desktop windows', () => {
    const chatWidgetSource = readRepoFile('js/components/ChatWidget.js');

    const markers = [
        '--chat-user-narrow-top-gap: clamp(18px, 5vh, 40px);',
        '--chat-user-narrow-bottom-gap: 24px;',
        'height: min(600px, calc(100vh - (var(--chat-user-narrow-top-gap) + var(--chat-user-narrow-bottom-gap)))) !important;',
        'max-height: calc(100vh - (var(--chat-user-narrow-top-gap) + var(--chat-user-narrow-bottom-gap))) !important;',
        'top: var(--chat-user-narrow-top-gap) !important;',
        'transform: translate3d(-50%, 20px, 0) scale(0.95) !important;',
        'transform-origin: center top !important;',
        'transform: translate3d(-50%, 0, 0) scale(1) !important;'
    ];

    for (const marker of markers) {
        assert.equal(chatWidgetSource.includes(marker), true, `js/components/ChatWidget.js should contain ${marker}`);
    }

    const removedMarkers = [
        'height: min(600px, calc(100vh - 88px)) !important;',
        'max-height: calc(100vh - 88px) !important;',
        'transform: translate3d(-50%, calc(-50% + 20px), 0) scale(0.95) !important;',
        'transform-origin: center center !important;\n                }\n\n                .chat-window:not(.admin-mode-layout).active {\n                    transform: translate3d(-50%, -50%, 0) scale(1) !important;'
    ];

    for (const marker of removedMarkers) {
        assert.equal(chatWidgetSource.includes(marker), false, `js/components/ChatWidget.js should not contain ${marker}`);
    }
});

test('admin chat workspace stays inside the viewport on desktop overlays', () => {
    const chatWidgetSource = readRepoFile('js/components/ChatWidget.js');

    const markers = [
        '--chat-admin-top-gap: clamp(18px, 4vh, 36px);',
        '--chat-admin-bottom-gap: 24px;',
        'height: min(760px, calc(100vh - (var(--chat-admin-top-gap) + var(--chat-admin-bottom-gap)))) !important;',
        'max-height: calc(100vh - (var(--chat-admin-top-gap) + var(--chat-admin-bottom-gap))) !important;',
        'top: var(--chat-admin-top-gap) !important;',
        'bottom: auto !important;'
    ];

    for (const marker of markers) {
        assert.equal(chatWidgetSource.includes(marker), true, `js/components/ChatWidget.js should contain ${marker}`);
    }

    const removedMarkers = [
        'height: min(760px, 92vh);',
        'max-height: 92vh;'
    ];

    for (const marker of removedMarkers) {
        assert.equal(chatWidgetSource.includes(marker), false, `js/components/ChatWidget.js should not contain ${marker}`);
    }
});

test('admin chat workspace vertically centers fullscreen desktop windows', () => {
    const chatWidgetSource = readRepoFile('js/components/ChatWidget.js');

    const markers = [
        '_shouldUseDesktopEdgeSafeInset() {',
        'const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;',
        "if (window.matchMedia('(display-mode: fullscreen)').matches) {",
        'return widthDelta <= 24 && heightDelta <= 24 && browserChromeHeight <= 96;',
        "_toggleElementClass(this.chatWindow, 'chat-window--desktop-edge-safe', useEdgeSafeInset);",
        '.chat-window.admin-mode-layout.chat-window--desktop-edge-safe {',
        '--chat-admin-top-gap: clamp(56px, 9vh, 96px);',
        'top: 50% !important;',
        'transform: translateY(calc(-50% + 20px)) scale(0.95) !important;',
        'transform-origin: center right !important;',
        '.chat-window.admin-mode-layout.chat-window--desktop-edge-safe.active {',
        'transform: translateY(-50%) scale(1) !important;'
    ];

    for (const marker of markers) {
        assert.equal(chatWidgetSource.includes(marker), true, `js/components/ChatWidget.js should contain ${marker}`);
    }
});

test('chat widget restores authenticated session ids quickly and hydrates linked history in the background', () => {
    const chatWidgetSource = readRepoFile('js/components/ChatWidget.js');

    const markers = [
        'getAuthenticatedUserSessionIdsStorageKey(user = null)',
        'getAuthenticatedUserSessionIdsMaxAgeMs()',
        'restoreAuthenticatedUserSessionIds(user = null)',
        'persistAuthenticatedUserSessionIds(user = null, sessionIds = [])',
        'clearAuthenticatedUserSessionHydrationHandle()',
        'scheduleAuthenticatedUserSessionHydration(user = null, { immediate = false } = {})',
        'async hydrateAuthenticatedUserSessionIds(user = null) {',
        "this.persistAuthenticatedUserSessionIds(user, this.userSessionIds);",
        "this.scheduleAuthenticatedUserSessionHydration(user);",
        "this.loadHistory().catch((historyError) => {"
    ];

    for (const marker of markers) {
        assert.equal(chatWidgetSource.includes(marker), true, `js/components/ChatWidget.js should contain ${marker}`);
    }
});

test('ops alert inbox cards expose case actions in both admin studio and admin chat widget', () => {
    const chatWidgetSource = readRepoFile('js/components/ChatWidget.js');
    const adminChatSource = readRepoFile('js/admin-chat.js');
    const adminChatStyles = readRepoFile('css/admin-chat.css');
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const publicPages = [
        readRepoFile('index.html'),
        readRepoFile('shop.html'),
        readRepoFile('verify.html'),
        readRepoFile('prompts.html'),
        readRepoFile('guestbook.html'),
        readRepoFile('privacy.html'),
        readRepoFile('index_old.html')
    ];

    const chatWidgetMarkers = [
        'getOpsAlertCaseActions(alert = {})',
        'fetchOpsAlertCasesForAlerts(alerts = [])',
        'handleOpsAlertCaseAction(alert = {}, action = \'\')',
        'ensureOpsAlertMonitorMeta(force = false)',
        'promptOpsAlertAssignee(defaultOwnerAdminId = \'\')',
        'promptOpsAlertSnoozeDuration(moduleKey = \'\')',
        'applyOpsAlertSnooze(alert = {})',
        'normalizeOpsAlertModuleMuteRules(config = {})',
        'getOpsAlertActiveCount()',
        'getOpsAlertMutedModuleCount()',
        'getOpsAlertOwnerSummary(limit = 2)',
        'getOpsAlertOwnerFilterOptions()',
        'setOpsAlertOwnerFilter(value = \'all\')',
        'syncOpsAlertOwnerFilter(options = [])',
        'getBatchAssignableOpsAlerts()',
        'shouldShowOpsAlertBatchAssign()',
        'applyOpsAlertCasesToMessages(cases = [])',
        'fetchOpsAlertCaseEventsForAlerts(alerts = [])',
        'refreshOpsAlertCaseStateForAlerts(alerts = [])',
        'getOpsAlertCaseRecentEvents(alert = {})',
        'getOpsAlertCaseRecentEventText(event = {})',
        'handleOpsAlertBatchAssign()',
        'getOpsAlertLinkedTicketId(alert = {})',
        'canCreateOpsAlertTicket(alert = {})',
        'appendOpsAlertCaseNote(alert = {}, note = \'\')',
        'openLinkedOpsAlertTicket(alert = {})',
        'handleCreateOpsAlertTicket(alert = {})',
        'fetchUser360Context(session = {})',
        'renderUser360Context(context = null)',
        'loadUser360Context(session = {})',
        'getUserContextHeadlineTone(status = \'\')',
        'getUserContextHeadlineItems(context = {})',
        'createUserContextHeadline(context = {})',
        'buildUserContextActionSignature(action = {})',
        'rememberUserContextAction(context = {}, action = {})',
        'createUserContextRecentActionBanner(context = {})',
        'getUserContextQuickActions(context = {})',
        'getWorkbenchLauncher() {',
        'async openWorkbenchEntry(workspaceKey, context = {}) {',
        "window.savePendingOpsAlertWorkspace(workspaceKey, context);",
        'hasInlineAdminWorkbench() {',
        "return this.hasInlineAdminWorkbench()",
        "typeof window.resolveOpsAlertEntryWorkspace === 'function'",
        "typeof window.resolveShopRiskWorkspace === 'function'",
        "typeof window.resolveOpsAlertWorkspace === 'function'",
        'getDefaultReplyTemplateDefinitions()',
        'normalizeReplyTemplateDefinitions(templates)',
        'ensureReplyTemplateConfigLoaded(force = false)',
        'getReplyTemplateDrafts(context = {})',
        'applyReplyTemplate(template = {})',
        'renderReplyTemplateBar(context = null)',
        'canCreateUserContextTicket(context = {}, { openTicket = null } = {})',
        'buildChatSessionTicketPayload(context = {}, note = \'\')',
        'handleCreateUserContextTicket(context = {})',
        'createUserContextActionsSection(context = {})',
        'handleUserContextAction(action = {})',
        "return this.openWorkbenchEntry('tickets-pending', context);",
        "return await this.openWorkbenchEntry(workspace.workspaceKey, workspace.context || {});",
        "return await this.openWorkbenchEntry('chat-session', workspace.context || {});",
        "result = await this.openWorkbenchEntry(workspaceKey, action.context || {});",
        'isTicketSyncChatMessage(message = {})',
        'isOpenTicketStatus(status = \'\')',
        'buildSessionTicketSummaryMap(rows = [])',
        'fetchSessionTicketSummaryMap(userIds = [])',
        'buildSessionLatestRecordMap(rows = [], userIdField = \'user_id\')',
        'fetchSessionPaymentSummaryMap(userIds = [])',
        'fetchSessionVerificationSummaryMap(userIds = [])',
        'getAdminSessionQueuePreferenceStorageKey()',
        'normalizeAdminSessionQueueView(value = \'all\')',
        'normalizeAdminSessionQueueFilter(value = \'all\')',
        'getAdminSessionQueueViewLabel(value = \'all\')',
        'getAdminSessionQueueFilterLabel(value = \'all\')',
        'formatAdminSessionQueueModeLabel(view = \'all\', filter = \'all\')',
        'restoreAdminSessionQueuePreferences()',
        'persistAdminSessionQueuePreferences()',
        'isAdminSessionQueueUsingDefaultView()',
        'restoreAdminSessionQueueDefaultView()',
        'saveCurrentAdminSessionQueueAsDefault()',
        'getAdminSessionPaymentSignal(summary = null)',
        'getAdminSessionVerificationSignal(summary = null)',
        'getAdminSessionPrioritySignals(session = {})',
        'sortAdminSessions(sessions = [])',
        'attachSessionTicketSummaries(sessions = [])',
        'refreshAdminSessionTicketSummariesForUserIds(userIds = [])',
        'getAdminSessionTicketBadge(summary = null)',
        'getAdminSessionTicketSubtext(summary = null)',
        'formatSessionReplyWaitAge(waitMinutes = 0)',
        'buildSessionReplySummary(lastUserMessageAt = \'\', lastAdminMessageAt = \'\')',
        'refreshAdminSessionReplySummaries()',
        'startAdminSessionSlaTicker()',
        'getAdminSessionFilterOptions()',
        'isHighPriorityAdminSession(session = {})',
        'getAdminSessionOverviewCards()',
        'renderAdminSessionOverview()',
        'buildAdminSessionQueueSnapshot({ view = \'all\', filter = \'all\' } = {})',
        'getAdminSessionQueueSnapshot()',
        'getAdminSessionQueueBacklogSnapshot()',
        'getAdminSessionQueueCapacityAlerts(snapshot = {})',
        'getAdminSessionQueuePriorityItems(snapshot = {})',
        'getAdminSessionQueueRecommendedMode(snapshot = {})',
        'getAdminSessionQueueCoordinationAdvice(snapshot = {})',
        'getAdminSessionQueueDutyAdvice(snapshot = null)',
        'renderAdminSessionQueueSnapshot()',
        'getAdminSessionViewOptions()',
        'renderAdminSessionViews()',
        'renderAdminSessionQueueControls()',
        'renderAdminSessionFilters()',
        'setAdminSessionQueueView(value = \'all\', { resetFilter = true } = {})',
        'setAdminSessionQueueFilter(value = \'all\')',
        'matchesAdminSessionQueueView(session = {})',
        'matchesAdminSessionQueueFilter(session = {})',
        'buildUserContextTimelineAction(kind = \'\', item = {}, context = {})',
        'buildUserContextTimelineEntries(context = {})',
        'createUserContextTimelineSection(entries = [])',
        'session-name-row',
        'ops-alert-toolbar',
        'session-queue-overview',
        'session-queue-card',
        'session-queue-snapshot',
        'session-queue-snapshot__mode',
        'session-queue-snapshot__actions',
        'session-queue-snapshot__action',
        'session-queue-snapshot__hint',
        'session-queue-snapshot__capacity',
        'session-queue-snapshot__capacity-badge',
        'session-queue-snapshot__suggestions',
        'session-queue-suggestion',
        'session-queue-suggestion__action',
        'session-queue-presets',
        'session-queue-preset',
        'session-filter-bar',
        'session-filter-btn',
        'chat-context-panel',
        'chat-reply-templates',
        'chat-reply-template-btn',
        'user-context-card',
        'user-context-headline',
        'user-context-headline__item',
        'user-context-recent-action',
        'user-context-actions',
        'user-context-action-btn',
        'user-context-action-btn--recent',
        'user-context-timeline',
        'user-context-timeline-item',
        'user-context-timeline-item--actionable',
        'user-context-timeline-item__jump',
        'user-context-timeline-item--recent',
        "this.chatHeader.querySelector('.chat-user-id').textContent = '站外告警同步 / 可认领、备注、关闭并跳转处理页';",
        'ops-alert-card-actions',
        'ops-alert-card-status',
        'ops-alert-card-status--muted',
        'ops-alert-card-history',
        'ops-alert-card-history-item',
        'session-badge',
        'session-badge--ticket',
        'session-badge--warning',
        'session-badge--danger',
        'ops-alert-toolbar-select',
        '/api/admin/tickets/create',
        '批量接力',
        '批量指派',
        '转售后',
        '转工单',
        '查看工单',
        'adminSidebarInsightsCollapsed = true',
        'userContextPanelCollapsed = true',
        'getAdminSessionListSkeletonMarkup(count = 6)',
        'getUserContextPanelSummaryText(context = {})',
        'setAdminSidebarInsightsCollapsed(collapsed = false)',
        'setAdminChatSessions(chatSessions = [])',
        'setUserContextPanelCollapsed(collapsed = false)',
        'restoreAdminSessionSnapshot()',
        'persistAdminSessionSnapshot(chatSessions = [])',
        'scheduleAdminSessionPrewarm({ immediate = false } = {})',
        'applyIncomingAdminUserMessage(message = {})',
        'restoreUserHistorySnapshot(sessionIds = [])',
        'persistUserHistorySnapshot(sessionIds = [], messages = [])',
        'scheduleUserHistorySync(sessionIds = [], cacheKey = \'\', requestId = 0)',
        'upsertUserHistoryCacheEntry(message = {})',
        'clearSupportPanelPrewarmHandle()',
        'scheduleSupportPanelPrewarm({ immediate = false } = {})',
        'renderSupportRootPanel(options = {})',
        'data-user-context-panel-toggle',
        'applyAdminReplySessionUpdate(sessionId = \'\', message = {})',
        'upsertAdminMessageCacheEntry(message = {})'
    ];

    for (const marker of chatWidgetMarkers) {
        assert.equal(chatWidgetSource.includes(marker), true, `js/components/ChatWidget.js should contain ${marker}`);
    }

    const adminChatMarkers = [
        'getOpsAlertCaseActions(alert = {})',
        'fetchOpsAlertCasesForAlerts(alerts = [])',
        'handleOpsAlertCaseAction(alert = {}, action = \'\')',
        'ensureOpsAlertMonitorMeta(force = false)',
        'promptOpsAlertAssignee(defaultOwnerAdminId = \'\')',
        'promptOpsAlertSnoozeDuration(moduleKey = \'\')',
        'applyOpsAlertSnooze(alert = {})',
        'normalizeOpsAlertModuleMuteRules(config = {})',
        'getOpsAlertActiveCount()',
        'getOpsAlertMutedModuleCount()',
        'getOpsAlertOwnerSummary(limit = 2)',
        'getOpsAlertOwnerFilterOptions()',
        'setOpsAlertOwnerFilter(value = \'all\')',
        'syncOpsAlertOwnerFilter(options = [])',
        'getBatchAssignableOpsAlerts()',
        'shouldShowOpsAlertBatchAssign()',
        'applyOpsAlertCasesToMessages(cases = [])',
        'fetchOpsAlertCaseEventsForAlerts(alerts = [])',
        'refreshOpsAlertCaseStateForAlerts(alerts = [])',
        'getOpsAlertCaseRecentEvents(alert = {})',
        'getOpsAlertCaseRecentEventText(event = {})',
        'handleOpsAlertBatchAssign()',
        'getOpsAlertLinkedTicketId(alert = {})',
        'canCreateOpsAlertTicket(alert = {})',
        'buildOpsAlertCaseMutationContext(alert = {})',
        'submitOpsAlertCaseMutationRequest(action, alert = {}, options = {})',
        'appendOpsAlertCaseNote(alert = {}, note = \'\')',
        'openLinkedOpsAlertTicket(alert = {})',
        'handleCreateOpsAlertTicket(alert = {})',
        'fetchUser360Context(session = {})',
        'renderUser360Context(context = null)',
        'getUserContextHeadlineTone(status = \'\')',
        'getUserContextHeadlineItems(context = {})',
        'createUserContextHeadline(context = {})',
        'buildUserContextActionSignature(action = {})',
        'rememberUserContextAction(context = {}, action = {})',
        'createUserContextRecentActionBanner(context = {})',
        'getUserContextQuickActions(context = {})',
        'getWorkbenchLauncher() {',
        'async openWorkbenchEntry(workspaceKey, context = {}) {',
        'getDefaultReplyTemplateDefinitions()',
        'normalizeReplyTemplateDefinitions(templates)',
        'ensureReplyTemplateConfigLoaded(force = false)',
        'getReplyTemplateDrafts(context = {})',
        'applyReplyTemplate(template = {})',
        'renderReplyTemplateBar(context = null)',
        'canCreateUserContextTicket(context = {}, { openTicket = null } = {})',
        'buildChatSessionTicketPayload(context = {}, note = \'\')',
        'handleCreateUserContextTicket(context = {})',
        'createUserContextActionsSection(context = {})',
        'handleUserContextAction(action = {})',
        "return this.openWorkbenchEntry('tickets-pending', context);",
        "return await this.openWorkbenchEntry(workspace.workspaceKey, workspace.context || {});",
        "return this.openWorkbenchEntry('chat-session', context);",
        "result = await this.openWorkbenchEntry(workspaceKey, action.context || {});",
        'isTicketSyncChatMessage(message = {})',
        'isOpenTicketStatus(status = \'\')',
        'buildSessionTicketSummaryMap(rows = [])',
        'fetchSessionTicketSummaryMap(userIds = [])',
        'buildSessionLatestRecordMap(rows = [], userIdField = \'user_id\')',
        'fetchSessionPaymentSummaryMap(userIds = [])',
        'fetchSessionVerificationSummaryMap(userIds = [])',
        'getSessionQueuePreferenceStorageKey()',
        'normalizeSessionQueueView(value = \'all\')',
        'normalizeSessionQueueFilter(value = \'all\')',
        'getSessionQueueViewLabel(value = \'all\')',
        'getSessionQueueFilterLabel(value = \'all\')',
        'formatSessionQueueModeLabel(view = \'all\', filter = \'all\')',
        'restoreSessionQueuePreferences()',
        'persistSessionQueuePreferences()',
        'getChatSessionCacheStorageKey()',
        'restoreChatSessionCache()',
        'persistChatSessionCache()',
        'attachSessionProfiles(sessions = [])',
        'applyIncomingUserMessage(msg = {})',
        'scheduleSessionHistoryConsistencySync()',
        'syncSessionsWithCompleteHistory()',
        'isSessionQueueUsingDefaultView()',
        'restoreSessionQueueDefaultView()',
        'saveCurrentSessionQueueAsDefault()',
        'getSessionPaymentSignal(summary = null)',
        'getSessionVerificationSignal(summary = null)',
        'getSessionPrioritySignals(session = {})',
        'attachSessionOperationalSummaries(sessions = [])',
        'refreshSessionOperationalSummariesForUserIds(userIds = [])',
        'attachSessionTicketSummaries(sessions = [])',
        'refreshSessionTicketSummariesForUserIds(userIds = [])',
        'getSessionListTicketBadge(summary = null)',
        'getSessionListTicketSubtext(summary = null)',
        'formatSessionReplyWaitAge(waitMinutes = 0)',
        'buildSessionReplySummary(lastUserMessageAt = \'\', lastAdminMessageAt = \'\')',
        'refreshSessionReplySummaries()',
        'startSessionSlaTicker()',
        'getSessionQueueFilterOptions()',
        'isHighPrioritySession(session = {})',
        'getSessionQueueOverviewCards()',
        'renderSessionQueueOverview()',
        'getSessionQueueSnapshot()',
        'getSessionQueueCapacityAlerts(snapshot = {})',
        'renderSessionQueueSnapshot()',
        'getSessionQueueViewOptions()',
        'renderSessionQueueViews()',
        'renderSessionQueueControls()',
        'renderSessionQueueFilters()',
        'setSessionQueueView(value = \'all\', { resetFilter = true } = {})',
        'setSessionQueueFilter(value = \'all\')',
        'sessionMatchesQueueView(session = {})',
        'sessionMatchesQueueFilter(session = {})',
        'getChatSessionSortPriority(session = {})',
        'buildUserContextTimelineAction(kind = \'\', item = {}, context = {})',
        'buildUserContextTimelineEntries(context = {})',
        'createUserContextTimelineSection(entries = [])',
        'admin-alert-toolbar',
        'session-queue-overview',
        'session-queue-card',
        'session-queue-snapshot',
        'session-queue-snapshot__mode',
        'session-queue-snapshot__actions',
        'session-queue-snapshot__action',
        'session-queue-snapshot__hint',
        'session-queue-snapshot__capacity',
        'session-queue-snapshot__capacity-badge',
        'session-queue-presets',
        'session-queue-preset',
        'session-filter-bar',
        'session-filter-btn',
        'chat-context-panel',
        'chat-reply-templates',
        'chat-reply-template-btn',
        'user-context-card',
        'user-context-headline',
        'user-context-headline__item',
        'user-context-recent-action',
        'user-context-actions',
        'user-context-action-btn',
        'user-context-action-btn--recent',
        'user-context-timeline',
        'user-context-timeline-item',
        'user-context-timeline-item--actionable',
        'user-context-timeline-item__jump',
        'user-context-timeline-item--recent',
        "document.getElementById('currentChatId').textContent = '站外告警同步 / 可认领、备注、关闭并跳转处理页';",
        'admin-alert-actions',
        'admin-alert-case-badge',
        'admin-alert-case-badge--muted',
        'admin-alert-history',
        'admin-alert-history-item',
        '/api/admin/tickets/create',
        '批量接力',
        '批量指派',
        '转售后',
        '转工单',
        '查看工单'
    ];

    for (const marker of adminChatMarkers) {
        assert.equal(adminChatSource.includes(marker), true, `js/admin-chat.js should contain ${marker}`);
    }
    assert.equal(
        adminChatSource.includes('return window.submitOpsAlertCaseMutationRequest(headers, action, context, {'),
        true,
        'js/admin-chat.js should submit ops alert case actions through the shared workbench runtime'
    );

    const adminChatStyleMarkers = [
        '.chat-context-panel',
        '.chat-reply-templates',
        '.chat-reply-template-btn',
        '.chat-reply-template-btn__label',
        '.user-context-card',
        '.user-context-summary',
        '.user-context-grid',
        '.user-context-headline',
        '.user-context-headline__item',
        '.user-context-headline__item--warning',
        '.user-context-recent-action',
        '.user-context-actions',
        '.user-context-action-btn',
        '.user-context-action-btn--recent',
        '.user-context-action-btn__icon',
        '.user-context-timeline',
        '.user-context-timeline-item',
        '.user-context-timeline-item__badge',
        '.user-context-timeline-item--actionable',
        '.user-context-timeline-item__jump',
        '.user-context-timeline-item--recent',
        '.admin-alert-case-badge',
        '.admin-alert-case-summary',
        '.admin-alert-history',
        '.admin-alert-history-item',
        '.admin-alert-actions',
        '.session-queue-overview',
        '.session-queue-card',
        '.session-queue-card__value',
        '.session-queue-snapshot',
        '.session-queue-snapshot__mode',
        '.session-queue-snapshot__summary',
        '.session-queue-snapshot__meta',
        '.session-queue-snapshot__actions',
        '.session-queue-snapshot__action',
        '.session-queue-snapshot__hint',
        '.session-queue-snapshot__capacity',
        '.session-queue-snapshot__capacity-badge',
        '.session-queue-snapshot__capacity-badge--warning',
        '.session-queue-snapshot__capacity-badge--danger',
        '.session-queue-snapshot__suggestions',
        '.session-queue-suggestion',
        '.session-queue-suggestion__action',
        '.session-queue-presets',
        '.session-queue-preset',
        '.session-queue-preset.is-active',
        '.session-filter-bar',
        '.session-filter-btn',
        '.session-filter-btn.is-active',
        '.session-badge--ticket',
        '.session-badge--warning',
        '.session-badge--danger',
        '.admin-alert-toolbar',
        '.admin-alert-toolbar-filter',
        '.admin-alert-toolbar-btn',
        '.admin-alert-toolbar-select',
        '.admin-alert-action-btn--primary',
        '.admin-alert-action-btn--danger',
        '.admin-alert-action-btn--ghost',
        '.admin-alert-case-badge--muted'
    ];

    for (const marker of adminChatStyleMarkers) {
        assert.equal(adminChatStyles.includes(marker), true, `css/admin-chat.css should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('js/admin-chat.js?v=20260402_ADMIN_CHAT_INPUT_UI_13'),
        true,
        'admin-studio.html should load the latest admin chat case action runtime'
    );
    assert.equal(
        adminStudioHtml.includes('css/admin-chat.css?v=20260402_ADMIN_CHAT_INPUT_UI_13'),
        true,
        'admin-studio.html should load the latest admin chat case action stylesheet'
    );

    for (const source of publicPages) {
        assert.equal(
            source.includes('js/admin-workbench.js?v=20260402_ADMIN_WORKBENCH_ACCESS_4'),
            true,
            'public entry pages should load the shared workbench resolver before the chat widget runtime'
        );
        assert.equal(
            source.includes('js/components/ChatWidget.js?v=20260402_CHAT_WIDGET_PREWARM_5'),
            true,
            'public entry pages should load the latest ops todo case action widget runtime'
        );
    }
});

test('shared frontend scripts depend on the unified runtime Supabase helpers', () => {
    const expectations = new Map([
        ['supabase-client.js', 'requireZaoyoeSupabaseConfig'],
        ['js/admin-shop.js', 'requireZaoyoeSupabaseConfig'],
        ['js/avatar-uploader.js', 'getZaoyoeSupabaseFunctionUrl'],
        ['supabase-auth-functions.js', 'getZaoyoeSupabaseFunctionUrl'],
        ['admin-config.js', 'getZaoyoeSupabaseFunctionUrl'],
        ['admin-studio.js', 'getZaoyoeSupabaseFunctionUrl']
    ]);
    const missing = [];

    for (const [relativePath, marker] of expectations.entries()) {
        const source = readRepoFile(relativePath);
        if (!source.includes(marker)) {
            missing.push(`${relativePath} should reference ${marker}`);
        }
    }

    assert.deepEqual(missing, [], missing.join('\n'));
});

test('vercel CSP does not allow unsafe-eval in frontend script execution', () => {
    const cspValue = getGlobalCspHeaderValue();

    assert.equal(cspValue.includes("'unsafe-eval'"), false);
});

test('runtime entry pages no longer embed inline script blocks', () => {
    const runtimeInlineHashes = collectInlineScriptHashes(RUNTIME_PAGES);
    assert.deepEqual(runtimeInlineHashes, [], 'Runtime pages should not retain inline script blocks');
});

test('repository HTML pages no longer embed inline script blocks outside the test suite', () => {
    const htmlFiles = collectRepositoryHtmlFiles();
    const violations = htmlFiles.filter((relativePath) => collectInlineScriptHashes([relativePath]).length > 0);

    assert.deepEqual(violations, [], `Repository HTML pages should not contain inline script blocks:\n${violations.join('\n')}`);
});

test('repository HTML pages no longer embed inline style blocks outside the test suite', () => {
    const htmlFiles = collectRepositoryHtmlFiles();
    const violations = htmlFiles.filter((relativePath) => /<style\b/i.test(readRepoFile(relativePath)));

    assert.deepEqual(violations, [], `Repository HTML pages should not contain inline style blocks:\n${violations.join('\n')}`);
});

test('repository HTML pages no longer embed inline style attributes outside the test suite', () => {
    const htmlFiles = collectRepositoryHtmlFiles();
    const violations = htmlFiles.filter((relativePath) => /\sstyle\s*=\s*["']/i.test(readRepoFile(relativePath)));

    assert.deepEqual(violations, [], `Repository HTML pages should not contain inline style attributes:\n${violations.join('\n')}`);
});

test('vercel CSP blocks inline scripts and inline event attributes without hash exceptions', () => {
    const cspValue = getGlobalCspHeaderValue();
    const directives = parseCspDirectives(cspValue);
    const scriptSrc = directives.get('script-src') || [];
    const scriptSrcElem = directives.get('script-src-elem') || [];
    const scriptSrcAttr = directives.get('script-src-attr') || [];

    assert.notEqual(scriptSrc.length, 0, 'Missing script-src directive');
    assert.notEqual(scriptSrcElem.length, 0, 'Missing script-src-elem directive');
    assert.deepEqual(scriptSrcAttr, ["'none'"], 'script-src-attr should explicitly block inline event handlers');
    assert.equal(scriptSrc.includes("'unsafe-inline'"), false, 'script-src should no longer broadly allow unsafe-inline');
    assert.equal(scriptSrcElem.includes("'unsafe-inline'"), false, 'script-src-elem should no longer broadly allow unsafe-inline');
    assert.deepEqual(
        scriptSrc.filter((value) => value.startsWith("'sha256-")),
        [],
        'script-src should not carry inline script hashes once HTML inline scripts are gone'
    );
    assert.deepEqual(
        scriptSrcElem.filter((value) => value.startsWith("'sha256-")),
        [],
        'script-src-elem should not carry inline script hashes once HTML inline scripts are gone'
    );
});

test('shared profile modal template no longer uses inline event handlers', () => {
    const source = readRepoFile('js/profile-modal-template.js');
    const sharedProfileStyles = readRepoFile('style.css');
    const inlineEventAttributes = [
        'onclick=',
        'onchange=',
        'onmousedown=',
        'onmouseup=',
        'onsubmit='
    ];

    for (const attribute of inlineEventAttributes) {
        assert.equal(
            source.includes(attribute),
            false,
            `js/profile-modal-template.js should not contain ${attribute}`
        );
    }

    assert.equal(source.includes('data-profile-action='), true, 'Profile modal template should expose delegated profile actions');
    assert.equal(source.includes('data-modal-dismiss-managed="1"'), true, 'Profile modal template should use managed modal dismissal');
    assert.equal(source.includes('style="display: none;"'), false, 'Profile modal template should not inline hidden file input styles');
    assert.equal(source.includes('style="display: flex; gap: 10px;"'), false, 'Profile modal template should not inline mobile code row layout');
    assert.equal(source.includes('style="flex: 1;"'), false, 'Profile modal template should not inline mobile code input sizing');
    assert.equal(sharedProfileStyles.includes('.profile-modal-file-input'), true, 'style.css should define the shared profile modal file input class');
    assert.equal(sharedProfileStyles.includes('#profileModal .profile-mobile-code-row'), true, 'style.css should define the shared profile modal mobile code row layout');
});

test('critical auth pages consume delegated profile modal and form bindings', () => {
    const verifySource = readRepoFile('verify.html');
    const indexSource = readRepoFile('index.html');
    const resetPasswordSource = readRepoFile('reset-password.html');

    assert.equal(verifySource.includes('profile-modal-template.js'), true, 'verify.html should load the shared profile modal template');
    assert.equal(indexSource.includes('profile-modal-template.js'), true, 'index.html should load the shared profile modal template');
    assert.equal(indexSource.includes('./js/profile-modal-template.js?v=20260324_PROFILE_MODAL_RUNTIME_STYLE_1'), true, 'index.html should load the latest profile modal runtime version');
    assert.equal(verifySource.includes('./js/profile-modal-template.js?v=20260324_PROFILE_MODAL_RUNTIME_STYLE_1'), true, 'verify.html should load the latest profile modal runtime version');
    assert.equal(verifySource.includes('id="profileModal"'), false, 'verify.html should not embed a duplicated profile modal');
    assert.equal(indexSource.includes('id="profileModal"'), false, 'index.html should not embed a duplicated profile modal');
    assert.equal(verifySource.includes('onmousedown="closeModal(event)"'), false, 'verify.html should not inline modal close handlers');
    assert.equal(verifySource.includes('onmouseup="closeModal(event)"'), false, 'verify.html should not inline modal close handlers');
    assert.equal(verifySource.includes('onclick="closeModal(event)"'), false, 'verify.html should not inline modal close handlers');
    assert.equal(verifySource.includes('data-modal-dismiss-managed="1"'), true, 'verify.html should use managed modal dismissal for comingSoonModal');

    assert.equal(resetPasswordSource.includes('onsubmit="handleNewPasswordSubmit(event)"'), false, 'reset-password.html should not inline form submission');
    assert.equal(resetPasswordSource.includes('./js/reset-password-page.js'), true, 'reset-password.html should load the reset password bootstrap file');
});

test('auth runtime renderers centralize avatar, google loading, and profile modal style state', () => {
    const authSource = readRepoFile('supabase-auth-functions.js');
    const authSheetStyles = readRepoFile('css/auth-sheet.css');
    const pageSources = [
        readRepoFile('index.html'),
        readRepoFile('guestbook.html'),
        readRepoFile('verify.html'),
        readRepoFile('prompts.html'),
        readRepoFile('shop.html'),
        readRepoFile('index_old.html')
    ];

    const removedRuntimeMarkers = [
        "defaultIcon.style.display = 'inline'",
        "navAvatar.style.display = 'none'",
        "btn.style.pointerEvents = 'none'",
        "btn.style.opacity = '0.75'",
        "document.body.style.position = 'fixed'",
        "card.style.maxHeight =",
        "tabsWrap.style.setProperty('--profile-tab-indicator-width'",
        'style="margin-right: 8px;"'
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(
            authSource.includes(marker),
            false,
            `supabase-auth-functions.js should not retain ${marker}`
        );
    }

    const runtimeMarkers = [
        'function setAuthStyleState(target, styles = {})',
        "setAuthAvatarVisualState(navAvatar, true)",
        "btn.classList.add('is-loading')",
        "loginModal.hidden = false;",
        "setAuthStyleState(document.body, {",
        "setAuthStyleState(tabsWrap, {"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(authSource.includes(marker), true, `supabase-auth-functions.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.google-login-btn.is-loading',
        '.google-login-btn__spinner',
        '.auth-admin-badge'
    ];

    for (const marker of styleMarkers) {
        assert.equal(authSheetStyles.includes(marker), true, `css/auth-sheet.css should contain ${marker}`);
    }

    for (const source of pageSources) {
        assert.equal(
            source.includes('css/auth-sheet.css?v=20260324_AUTH_INJECT_RUNTIME_STYLE_HELPERS_2'),
            true,
            'auth entry pages should load the latest auth sheet stylesheet'
        );
        assert.equal(
            source.includes('supabase-auth-functions.js?v=20260324_AUTH_RUNTIME_STYLE_HELPERS_1'),
            true,
            'auth entry pages should load the latest auth runtime script'
        );
    }
});

test('injected auth runtime centralizes dropdown, drag, and badge style state', () => {
    const injectSource = readRepoFile('inject-auth.js');
    const authSheetStyles = readRepoFile('css/auth-sheet.css');
    const pageSources = [
        readRepoFile('index.html'),
        readRepoFile('guestbook.html'),
        readRepoFile('verify.html'),
        readRepoFile('prompts.html'),
        readRepoFile('shop.html'),
        readRepoFile('index_old.html')
    ];

    const removedRuntimeMarkers = [
        'indicator.style.width =',
        "clone.style.position = 'absolute'",
        "body.style.setProperty('--auth-primary-view-min-height'",
        "dropdown.style.setProperty('right'",
        "overlay.style.removeProperty('display');",
        "sheet.style.transform = `translateY(${translate}px) scale(${1 - translate * 0.00045})`",
        "avatarBadge.style.display = hasUnread ? 'block' : 'none'",
        "dropdownBadge.style.display = hasUnread ? 'inline-block' : 'none'"
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(
            injectSource.includes(marker),
            false,
            `inject-auth.js should not retain ${marker}`
        );
    }

    const runtimeMarkers = [
        "function setInjectedAuthStyleProperty(target, name, value, priority = '')",
        "function setInjectedAuthStyleState(target, styles = {}, priority = '')",
        `class="fas fa-user-circle\${hasAvatar ? ' auth-display-none' : ''}"`,
        `class="nav-user-avatar\${hasAvatar ? ' show' : ' auth-display-none'}"`,
        'class="avatar-dropdown auth-dropdown-layer"',
        "clone.classList.add('is-active', 'auth-sheet-view-measure');",
        "setInjectedAuthStyleState(indicator, {",
        "setInjectedAuthStyleProperty(body, '--auth-primary-view-min-height'",
        "setInjectedAuthStyleState(dropdown, {",
        "setInjectedAuthStyleProperty(sheet, 'transform', null);",
        "avatarBadge.classList.toggle('is-visible', !!hasUnread);",
        "dropdownBadge.classList.toggle('is-visible', !!hasUnread);",
        "const PERSONAL_MESSAGE_BUTTON_LABEL = '打开个人消息';",
        "const PERSONAL_MESSAGE_BUTTON_UNREAD_LABEL = '打开个人消息（有未读）';",
        "dropdownButton.setAttribute('aria-label', entryLabel);",
        "dropdownButton.setAttribute('title', entryLabel);"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(injectSource.includes(marker), true, `inject-auth.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.auth-display-none',
        '.auth-dropdown-layer',
        '.avatar-unread-badge',
        '.dropdown-notif-badge.is-visible',
        '.auth-sheet-view-measure'
    ];

    for (const marker of styleMarkers) {
        assert.equal(authSheetStyles.includes(marker), true, `css/auth-sheet.css should contain ${marker}`);
    }

    for (const source of pageSources) {
        assert.equal(
            source.includes('css/auth-sheet.css?v=20260324_AUTH_INJECT_RUNTIME_STYLE_HELPERS_2'),
            true,
            'auth entry pages should load the latest injected auth stylesheet'
        );
        assert.equal(
            source.includes('inject-auth.js?v=20260330_AUTH_PERSONAL_MESSAGE_ENTRY_1'),
            true,
            'auth entry pages should load the latest injected auth runtime version'
        );
    }
});

test('public and debug entry pages no longer ship inline handler attributes', () => {
    const inlineHandlerPattern = /\bon(?:click|change|submit|mousedown|mouseup|input|keydown|mouseover|mouseout|error|load)\s*=\s*["']/i;
    const files = [
        'index.html',
        'prompts.html',
        'guestbook.html',
        'shop.html',
        'debug-realtime.html'
    ];

    for (const relativePath of files) {
        const source = readRepoFile(relativePath);
        assert.equal(
            inlineHandlerPattern.test(source),
            false,
            `${relativePath} should not contain inline event handler attributes`
        );
    }
});

test('debug realtime page binds diagnostics controls without inline handlers', () => {
    const source = readRepoFile('debug-realtime.html');

    const removedInlineMarkers = [
        'onclick="checkRealtimeStatus()"',
        'onclick="testRealtimeConnection()"',
        'onclick="clearLogs()"',
        'function bindDebugActions()',
        "button.dataset.debugActionBound = '1'",
        "switch (button.dataset.debugAction)"
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(source.includes(marker), false, `debug-realtime.html should not contain ${marker}`);
    }

    const delegatedMarkers = [
        'data-debug-action="refresh-status"',
        'data-debug-action="test-connection"',
        'data-debug-action="clear-logs"',
        './js/debug-realtime-page.js'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(source.includes(marker), true, `debug-realtime.html should contain ${marker}`);
    }
});

test('privacy page reuses the shared Supabase bootstrap instead of inlining a duplicate client init', () => {
    const source = readRepoFile('privacy.html');

    assert.equal(source.includes('./supabase-client.js'), true, 'privacy.html should load the shared supabase-client.js bootstrap');
    assert.equal(source.includes('window.supabaseClient = supabase.createClient'), false, 'privacy.html should not inline a duplicate Supabase client bootstrap');
    assert.equal(source.includes("localStorage.getItem('chat_session_id')"), false, 'privacy.html should not duplicate chat session initialization');
});

test('selected runtime, preview, and tooling pages externalize page-specific style blocks into dedicated CSS files', () => {
    const expectations = new Map([
        ['verify.html', 'css/verify-page.css?v=20260324_VERIFY_STYLE_ATTRS_1'],
        ['prompts.html', 'css/prompts-page.css?v=20260324_PROMPTS_STYLE_ATTRS_1'],
        ['reset-password.html', 'css/reset-password-page.css?v=20260324_RESET_PASSWORD_RUNTIME_STYLE_1'],
        ['privacy.html', 'css/privacy-page.css?v=20260324_PRIVACY_STYLES_1'],
        ['profile_mobile_tab_preview.html', './css/profile-mobile-tab-preview.css?v=20260324_PROFILE_PREVIEW_STYLES_1'],
        ['index.html', './css/index-page.css?v=20260324_INDEX_STYLE_ATTRS_1'],
        ['shop.html', 'css/shop-page.css?v=20260324_SHOP_RUNTIME_STYLE_1'],
        ['admin-studio.html', 'css/admin-studio-page.css?v=20260408_SECURITY_CHILD_HOVER_STATIC_1'],
        ['admin-entry.html', 'css/admin-entry-page.css?v=20260324_ADMIN_ENTRY_PAGE_STYLES_1'],
        ['auth-callback.html', './css/auth-callback-page.css?v=20260324_AUTH_CALLBACK_PAGE_STYLES_1'],
        ['debug-realtime.html', 'css/debug-realtime-page.css?v=20260324_DEBUG_REALTIME_STYLE_ATTRS_1'],
        ['test-lang-toggle.html', 'css/test-lang-toggle-page.css?v=20260324_TEST_LANG_TOGGLE_PAGE_STYLES_1'],
        ['test-realtime-simple.html', 'css/test-realtime-simple-page.css?v=20260324_TEST_REALTIME_SIMPLE_PAGE_STYLES_1'],
        ['tools/migrate-prompts-bilingual.html', '../css/migrate-prompts-bilingual-page.css?v=20260324_MIGRATE_PROMPTS_BILINGUAL_STYLE_ATTRS_1'],
        ['logo_preview.html', 'css/logo-preview-page.css?v=20260324_LOGO_PREVIEW_PAGE_STYLES_1'],
        ['logo_preview_v2.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v3.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v4.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v5.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v6.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v7.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v8.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v9.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v10.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v11.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v12.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v13.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v14.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v15.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v16.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['logo_preview_v17.html', 'css/logo-preview-grid-page.css?v=20260324_LOGO_PREVIEW_GRID_PAGE_STYLES_1'],
        ['avatar_dropdown_preview.html', 'css/avatar-dropdown-preview.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['icons_preview_v1.html', 'css/icons-preview-v1.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['icons_preview_v2.html', 'css/icons-preview-v2.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['icons_preview_v3.html', 'css/icons-preview-v3.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['icons_preview_v4.html', 'css/icons-preview-v4.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['icons_preview_v5.html', 'css/icons-preview-v5.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['icons_preview_v6.html', 'css/icons-preview-v6.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['icons_preview_v7.html', 'css/icons-preview-v7.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['icons_preview_v8.html', 'css/icons-preview-v8.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['index_old.html', 'css/index-old.css?v=20260324_INLINE_STYLE_ATTRS_BATCH_1'],
        ['preview-hero-effects.html', 'css/preview-hero-effects.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['profile_mobile_tab_minimal_preview.html', 'css/profile-mobile-tab-minimal-preview.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['profile_security_frosted_board.html', 'css/profile-security-frosted-board.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['profile_security_frosted_board_glass.html', 'css/profile-security-frosted-board-glass.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['profile_security_frosted_board_mono.html', 'css/profile-security-frosted-board-mono.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['profile_security_glass_redesign_preview.html', 'css/profile-security-glass-redesign-preview.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['profile_security_glass_reset_preview.html', 'css/profile-security-glass-reset-preview.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['profile_security_selective_frost_preview.html', 'css/profile-security-selective-frost-preview.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1'],
        ['profile_security_unified_sheet_preview.html', 'css/profile-security-unified-sheet-preview.css?v=20260324_REMAINING_HTML_STYLE_BLOCKS_1']
    ]);

    for (const [relativePath, stylesheetMarker] of expectations.entries()) {
        const source = readRepoFile(relativePath);
        assert.equal(source.includes(stylesheetMarker), true, `${relativePath} should load ${stylesheetMarker}`);
        assert.equal(/<style\b/i.test(source), false, `${relativePath} should not retain inline style blocks`);
    }
});

test('selected preview showcase pages no longer embed inline style attributes', () => {
    const previewFiles = [
        'avatar_dropdown_preview.html',
        'icons_preview_v1.html',
        'icons_preview_v2.html',
        'icons_preview_v3.html',
        'icons_preview_v6.html',
        'icons_preview_v7.html',
        'icons_preview_v8.html',
        'logo_preview_v6.html',
        'logo_preview_v7.html',
        'logo_preview_v15.html',
        'logo_preview_v16.html',
        'logo_preview_v17.html',
        'profile_security_frosted_board.html',
        'profile_security_frosted_board_glass.html',
        'profile_security_frosted_board_mono.html',
        'profile_security_glass_redesign_preview.html',
        'profile_security_glass_reset_preview.html',
        'profile_security_selective_frost_preview.html',
        'profile_security_unified_sheet_preview.html'
    ];
    const inlineStyleAttrPattern = /\sstyle\s*=/i;

    for (const relativePath of previewFiles) {
        const source = readRepoFile(relativePath);
        assert.equal(
            inlineStyleAttrPattern.test(source),
            false,
            `${relativePath} should not contain inline style attributes`
        );
    }
});

test('shop and archived index pages no longer embed inline style attributes', () => {
    const expectations = new Map([
        ['shop.html', 'css/shop-page.css?v=20260324_SHOP_RUNTIME_STYLE_1'],
        ['index_old.html', 'css/index-old.css?v=20260324_INLINE_STYLE_ATTRS_BATCH_1']
    ]);
    const inlineStyleAttributePattern = /\sstyle\s*=\s*["']/i;

    for (const [relativePath, stylesheetMarker] of expectations.entries()) {
        const source = readRepoFile(relativePath);
        assert.equal(source.includes(stylesheetMarker), true, `${relativePath} should load ${stylesheetMarker}`);
        assert.equal(
            inlineStyleAttributePattern.test(source),
            false,
            `${relativePath} should not contain inline style attributes`
        );
    }
});

test('admin studio page no longer embeds inline style attributes', () => {
    const source = readRepoFile('admin-studio.html');

    assert.match(
        source,
        /css\/admin-studio-page\.css\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should load the updated admin studio page stylesheet'
    );
    assert.equal(
        /\sstyle\s*=\s*["']/i.test(source),
        false,
        'admin-studio.html should not contain inline style attributes'
    );
});

test('shared theme preload replaces duplicated inline theme bootstraps on public and admin pages', () => {
    const files = [
        'guestbook.html',
        'shop.html',
        'reset-password.html',
        'prompts.html',
        'admin-studio.html',
        'admin-studio.html.bak'
    ];

    for (const relativePath of files) {
        const source = readRepoFile(relativePath);
        assert.equal(source.includes('./js/theme-preload.js') || source.includes('js/theme-preload.js'), true, `${relativePath} should load js/theme-preload.js`);
        assert.equal(source.includes("const savedTheme = localStorage.getItem('theme');"), false, `${relativePath} should not inline a duplicated savedTheme bootstrap`);
    }
});

test('auth and verify runtime pages externalize page bootstraps instead of embedding large inline scripts', () => {
    const authCallbackSource = readRepoFile('auth-callback.html');
    const resetPasswordSource = readRepoFile('reset-password.html');
    const verifySource = readRepoFile('verify.html');
    const guestbookSource = readRepoFile('guestbook.html');

    assert.equal(authCallbackSource.includes('./js/auth-callback-page.js'), true, 'auth-callback.html should load the shared auth callback bootstrap file');
    assert.equal(authCallbackSource.includes('exchangeCodeForSession(code)'), false, 'auth-callback.html should not inline OAuth session exchange logic');

    assert.equal(resetPasswordSource.includes('./js/reset-password-page.js'), true, 'reset-password.html should load the reset password bootstrap file');
    assert.equal(resetPasswordSource.includes('window.supabaseClient = supabase.createClient'), false, 'reset-password.html should not inline Supabase client bootstrap');
    assert.equal(resetPasswordSource.includes('handleNewPasswordSubmit(event)'), false, 'reset-password.html should not inline the reset password submission handler');

    assert.equal(verifySource.includes('./js/verify-page.js'), true, 'verify.html should load the verify page bootstrap file');
    assert.equal(verifySource.includes('window.VERIFY_SERVER_URL ='), false, 'verify.html should not inline verify server globals');
    assert.equal(verifySource.includes('verify-prerender-style'), false, 'verify.html should not inline prerender style injection logic');

    assert.equal(guestbookSource.includes('./js/guestbook-optional-enhancements.js'), true, 'guestbook.html should load the guestbook optional enhancements bootstrap file');
    assert.equal(guestbookSource.includes('scheduleOptionalGuestbookEnhancements'), false, 'guestbook.html should not inline optional guestbook enhancement boot logic');
});

test('reset password runtime bootstrap externalizes status visibility state', () => {
    const resetPasswordSource = readRepoFile('reset-password.html');
    const resetPasswordBootstrap = readRepoFile('js/reset-password-page.js');
    const resetPasswordStyleSource = readRepoFile('css/reset-password-page.css');

    const removedMarkers = [
        "statusMsg.style.display = 'none';",
        "statusMsg.style.display = 'block';",
        "statusMsg.className = 'status-message';",
        "statusMsg.className = 'status-message success';"
    ];

    for (const marker of removedMarkers) {
        assert.equal(resetPasswordBootstrap.includes(marker), false, `js/reset-password-page.js should not contain ${marker}`);
    }

    const runtimeMarkers = [
        'function resetStatusMessage(statusMsg)',
        'function showStatusMessage(statusMsg, message, options = {})',
        'statusMsg.hidden = true;',
        'statusMsg.hidden = false;',
        "statusMsg.classList.toggle('success', success);"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(resetPasswordBootstrap.includes(marker), true, `js/reset-password-page.js should contain ${marker}`);
    }

    assert.equal(
        resetPasswordSource.includes('./js/reset-password-page.js?v=20260324_RESET_PASSWORD_RUNTIME_STYLE_1'),
        true,
        'reset-password.html should load the latest reset password runtime-style bootstrap'
    );
    assert.equal(
        resetPasswordSource.includes('class="status-message" hidden'),
        true,
        'reset-password.html should initialize the status message in a hidden state'
    );
    assert.equal(
        resetPasswordStyleSource.includes('.status-message[hidden]'),
        true,
        'css/reset-password-page.css should hide status messages via the hidden attribute'
    );
});

test('home, prompts, and admin studio pages externalize their remaining runtime bootstraps', () => {
    const indexSource = readRepoFile('index.html');
    const promptsSource = readRepoFile('prompts.html');
    const adminStudioSource = readRepoFile('admin-studio.html');

    const indexRemovedMarkers = [
        "if ('scrollRestoration' in history)",
        'const checkAuth = setInterval(() => {',
        "window._prefetchGuestbook = () => handleHover('guestbook');",
        'const guestbookModalKeyboardState = {'
    ];

    for (const marker of indexRemovedMarkers) {
        assert.equal(indexSource.includes(marker), false, `index.html should not contain ${marker}`);
    }

    const indexBootstrapMarkers = [
        './js/index-scroll-bootstrap.js',
        './js/index-home-bootstrap.js',
        './js/homepage-guestbook-modal.js'
    ];

    for (const marker of indexBootstrapMarkers) {
        assert.equal(indexSource.includes(marker), true, `index.html should contain ${marker}`);
    }

    const promptsRemovedMarkers = [
        'window.__forcePromptThemeColorBlack = ensureThemeColorBlack;',
        'window.__PROMPTS_FORCE_SCROLL_TOP__ = Boolean(shouldLockToTop);',
        "dayjs.extend(dayjs_plugin_relativeTime);",
        "document.body.classList.add('loaded');"
    ];

    for (const marker of promptsRemovedMarkers) {
        assert.equal(promptsSource.includes(marker), false, `prompts.html should not contain ${marker}`);
    }

    const promptsBootstrapMarkers = [
        './js/prompts-head-bootstrap.js',
        './js/prompts-runtime-bootstrap.js'
    ];

    for (const marker of promptsBootstrapMarkers) {
        assert.equal(promptsSource.includes(marker), true, `prompts.html should contain ${marker}`);
    }

    const adminRemovedMarkers = [
        'window.supabaseClient = supabase.createClient',
        'function toggleMobileSidebar()',
        'function syncAdminStudioModuleUrl(moduleName)',
        "document.addEventListener('click', function (e) {",
        "const dropdown = document.getElementById('discountTypeDropdown');"
    ];

    for (const marker of adminRemovedMarkers) {
        assert.equal(adminStudioSource.includes(marker), false, `admin-studio.html should not contain ${marker}`);
    }

    assert.match(
        adminStudioSource,
        /js\/admin-studio-bootstrap\.js\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should load the shared admin studio bootstrap file'
    );
});

test('non-production utility and preview pages no longer ship inline handler attributes', () => {
    const inlineHandlerPattern = /\bon(?:click|change|submit|input|keydown|keyup|mouseover|mouseout|error|load|mousedown|mouseup|blur|focus)\s*=\s*["']/i;
    const files = [
        'tools/migrate-prompts-bilingual.html',
        'preview-hero-effects.html',
        'test-lang-toggle.html',
        'test-realtime-simple.html',
        'icons_preview_v2.html',
        'icons_preview_v3.html',
        'icons_preview_v4.html',
        'icons_preview_v5.html',
        'icons_preview_v6.html',
        'icons_preview_v7.html',
        'icons_preview_v8.html'
    ];

    for (const relativePath of files) {
        const source = readRepoFile(relativePath);
        assert.equal(
            inlineHandlerPattern.test(source),
            false,
            `${relativePath} should not contain inline event handler attributes`
        );
    }

    const migrateSource = readRepoFile('tools/migrate-prompts-bilingual.html');
    const previewSource = readRepoFile('preview-hero-effects.html');
    const profilePreviewSource = readRepoFile('profile_mobile_tab_preview.html');
    const langSource = readRepoFile('test-lang-toggle.html');
    const realtimeSource = readRepoFile('test-realtime-simple.html');
    const previewBootstrapSource = readRepoFile('js/preview-icons-page.js');
    const previewHeroScript = readRepoFile('js/preview-hero-effects-page.js');
    const langScript = readRepoFile('js/test-lang-toggle-page.js');
    const realtimeScript = readRepoFile('js/test-realtime-simple-page.js');
    const migrateScript = readRepoFile('js/tools-migrate-prompts-bilingual-page.js');

    assert.equal(migrateSource.includes('../js/tools-migrate-prompts-bilingual-page.js'), true, 'tools/migrate-prompts-bilingual.html should load the shared migration bootstrap');
    assert.equal(migrateScript.includes("document.getElementById('loadBtn')?.addEventListener('click'"), true, 'js/tools-migrate-prompts-bilingual-page.js should bind load via addEventListener');
    assert.equal(migrateScript.includes("document.getElementById('startBtn')?.addEventListener('click'"), true, 'js/tools-migrate-prompts-bilingual-page.js should bind start via addEventListener');
    assert.equal(migrateScript.includes("document.getElementById('stopBtn')?.addEventListener('click'"), true, 'js/tools-migrate-prompts-bilingual-page.js should bind stop via addEventListener');
    assert.equal(migrateScript.includes("document.getElementById('progressFill').style.width"), false, 'js/tools-migrate-prompts-bilingual-page.js should not write progress width inline');
    assert.equal(migrateSource.includes('<progress class="progress-fill" id="progressFill" max="100" value="0"></progress>'), true, 'tools/migrate-prompts-bilingual.html should use a native progress element');
    assert.equal(previewSource.includes('data-demo-id="grid"'), true, 'preview-hero-effects.html should expose delegated demo buttons');
    assert.equal(previewSource.includes('./js/preview-hero-effects-page.js'), true, 'preview-hero-effects.html should load the shared hero preview bootstrap');
    assert.equal(previewHeroScript.includes('function bindDemoNavigation()'), true, 'js/preview-hero-effects-page.js should bind demo navigation centrally');
    assert.equal(profilePreviewSource.includes('./js/profile-mobile-tab-preview.js'), true, 'profile_mobile_tab_preview.html should load the shared profile preview bootstrap');
    assert.equal(langSource.includes('./js/test-lang-toggle-page.js'), true, 'test-lang-toggle.html should load the language toggle bootstrap');
    assert.equal(langScript.includes("document.getElementById('langToggleTest')?.addEventListener('click'"), true, 'js/test-lang-toggle-page.js should bind the language toggle');
    assert.equal(langScript.includes('<div style='), false, 'js/test-lang-toggle-page.js should not inject inline status styles');
    assert.equal(realtimeSource.includes('./js/test-realtime-simple-page.js'), true, 'test-realtime-simple.html should load the realtime bootstrap');
    assert.equal(realtimeSource.includes('./js/runtime-supabase-config.js'), true, 'test-realtime-simple.html should load the shared runtime Supabase config helper');
    assert.equal(realtimeScript.includes("document.getElementById('testConnectionBtn')?.addEventListener('click'"), true, 'js/test-realtime-simple-page.js should bind the realtime test button');

    const previewFiles = [
        'icons_preview_v2.html',
        'icons_preview_v3.html',
        'icons_preview_v4.html',
        'icons_preview_v5.html',
        'icons_preview_v6.html',
        'icons_preview_v7.html',
        'icons_preview_v8.html'
    ];

    for (const relativePath of previewFiles) {
        const source = readRepoFile(relativePath);
        assert.equal(source.includes('data-preview-trigger-all="1"'), true, `${relativePath} should expose a delegated preview trigger`);
        assert.equal(source.includes('./js/preview-icons-page.js'), true, `${relativePath} should load the shared preview interactions bootstrap`);
    }

    assert.equal(previewBootstrapSource.includes('function bindPreviewInteractions()'), true, 'js/preview-icons-page.js should bind preview interactions centrally');
});

test('archived legacy pages externalize their bootstraps instead of embedding inline scripts', () => {
    const archivedIndexSource = readRepoFile('index_old.html');
    const archivedAdminSource = readRepoFile('admin-studio.html.bak');
    const archivedIndexScript = readRepoFile('js/index-old-page.js');
    const archivedRuntimeScript = readRepoFile('js/index-old-runtime-bootstrap.js');
    const archivedEmailScript = readRepoFile('js/index-old-emailjs-init.js');
    const archivedAdminBootstrap = readRepoFile('js/admin-studio-backup-bootstrap.js');

    const removedIndexMarkers = [
        'emailjs.init("vawaxLVEzJMAVbut0");',
        'const runtimeConfig = window.__PUBLIC_RUNTIME_CONFIG__ || {};',
        "document.addEventListener('DOMContentLoaded', function () {",
        'document.addEventListener(\'DOMContentLoaded\', () => {',
        '(function bindArchivedIndexHandlers() {'
    ];

    for (const marker of removedIndexMarkers) {
        assert.equal(archivedIndexSource.includes(marker), false, `index_old.html should not contain ${marker}`);
    }

    const indexBootstrapMarkers = [
        './js/index-old-emailjs-init.js',
        './js/runtime-supabase-config.js',
        './js/index-old-runtime-bootstrap.js',
        './js/index-old-page.js'
    ];

    for (const marker of indexBootstrapMarkers) {
        assert.equal(archivedIndexSource.includes(marker), true, `index_old.html should contain ${marker}`);
    }

    assert.equal(archivedEmailScript.includes("window.emailjs.init('vawaxLVEzJMAVbut0')"), true, 'js/index-old-emailjs-init.js should initialize EmailJS');
    assert.equal(archivedRuntimeScript.includes('window.supabaseClient = supabase.createClient'), true, 'js/index-old-runtime-bootstrap.js should initialize the archived Supabase client');
    assert.equal(archivedIndexScript.includes('function bindArchivedIndexHandlers()'), true, 'js/index-old-page.js should bind archived page actions centrally');

    const removedAdminMarkers = [
        "const savedTheme = localStorage.getItem('theme');",
        'const runtimeConfig = window.__PUBLIC_RUNTIME_CONFIG__ || {};',
        'window.supabaseClient = supabase.createClient'
    ];

    for (const marker of removedAdminMarkers) {
        assert.equal(archivedAdminSource.includes(marker), false, `admin-studio.html.bak should not contain ${marker}`);
    }

    const adminBootstrapMarkers = [
        'js/theme-preload.js',
        'js/runtime-supabase-config.js',
        'js/admin-studio-backup-bootstrap.js'
    ];

    for (const marker of adminBootstrapMarkers) {
        assert.equal(archivedAdminSource.includes(marker), true, `admin-studio.html.bak should contain ${marker}`);
    }

    assert.equal(archivedAdminBootstrap.includes('window.supabaseClient = supabase.createClient'), true, 'js/admin-studio-backup-bootstrap.js should initialize the backup admin Supabase client');
});

test('repository source files no longer ship inline handler attributes outside the test suite', () => {
    const inlineHandlerPattern = /\bon(?:click|change|submit|input|keydown|keyup|mouseover|mouseout|error|load|mousedown|mouseup|blur|focus)\s*=\s*["']/i;
    const violations = [];

    for (const relativePath of collectRepositorySourceFiles()) {
        const source = readRepoFile(relativePath);
        if (inlineHandlerPattern.test(source)) {
            violations.push(relativePath);
        }
    }

    assert.deepEqual(violations, [], `Repository sources should not contain inline handler attributes:\n${violations.join('\n')}`);
});

test('gallery and shop renderers no longer generate inline handler attributes in client scripts', () => {
    const inlineHandlerPattern = /\bon(?:click|change|submit|mousedown|mouseup|input|keydown|mouseover|mouseout|error|load)\s*=\s*["']/i;
    const files = [
        'js/framer_home.js',
        'prompts-poetry.js',
        'guestbook.js',
        'js/shop-client.js'
    ];

    for (const relativePath of files) {
        const source = readRepoFile(relativePath);
        assert.equal(
            inlineHandlerPattern.test(source),
            false,
            `${relativePath} should not generate inline event handler attributes`
        );
    }
});

test('shop client runtime renderers externalize product cards, purchase feedback, and order list styling', () => {
    const shopClientSource = readRepoFile('js/shop-client.js');
    const shopCssSource = readRepoFile('css/shop-page.css');
    const shopHtmlSource = readRepoFile('shop.html');

    const runtimeMarkers = [
        'buildShopStatusMessage: function (message',
        'setCssVariables: function (element, variables = {})',
        'setDiscountMessage: function (message = \'\'',
        'renderModalProductName: function (displayName, { wholesale = false } = {})',
        'buildSuccessToastMarkup: function ()',
        'buildExpandContentToggleMarkup: function (hiddenCount, expanded = false)',
        'getExistingProductSkeletonCount: function (container = document.getElementById(\'userShopGrid\')) {',
        'shop-success-content-shell--plain',
        'shop-order-history-item',
        'shop-rich-link',
        'shop-purchase-height-locked'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(shopClientSource.includes(marker), true, `js/shop-client.js should contain ${marker}`);
    }

    const removedRuntimeMarkers = [
        'style="color:#10b981; margin-right:10px;"',
        'style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(255,100,100,0.7);"',
        'style="font-size: 24px; color: var(--accent-purple, #6b9ece);"',
        'style="position:absolute; bottom:12px; left:12px; z-index: 10;',
        'style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;',
        'style="padding:6px 12px; border-radius:12px; background:rgba(255,255,255,0.1); border:none; color:#fff; cursor:pointer;"',
        'style="color: #6b9ece; text-decoration: underline; text-underline-offset: 2px;"',
        "el.style.setProperty('--breathe-delay'",
        "overlay.style.setProperty('--shop-purchase-translate-y'",
        "card.style.setProperty('--shop-purchase-dock-height'",
        "card.style.removeProperty('--shop-purchase-dock-height'"
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(shopClientSource.includes(marker), false, `js/shop-client.js should not contain ${marker}`);
    }

    const cssMarkers = [
        '.shop-page {',
        'body.shop-page #starryCanvas',
        '@keyframes shopSkeletonShimmer',
        'body.shop-page .skeleton {',
        'body.shop-page .skeleton-card {',
        '.shop-inline-store-title-icon',
        '.shop-card-original-price',
        '.shop-agent-badge',
        '.shop-card-footer',
        '.shop-status-message',
        '.shop-wholesale-badge',
        '.shop-discount-message',
        '.shop-success-toast',
        '.shop-expand-toggle',
        '.shop-order-history-item',
        '.shop-rich-link',
        '.shop-purchase-viewport-probe',
        '#shopPurchaseModal .modal-content.shop-purchase-height-locked'
    ];

    for (const marker of cssMarkers) {
        assert.equal(shopCssSource.includes(marker), true, `css/shop-page.css should contain ${marker}`);
    }

    assert.equal(shopHtmlSource.includes('<body class="shop-page guestbook-page">'), true, 'shop.html should scope the page with shop-page before guestbook-page compatibility styles');
});

test('shop storefront preserves the initial skeleton layout while first-load data is pending', () => {
    const shopClientSource = readRepoFile('js/shop-client.js');
    const shopHtmlSource = readRepoFile('shop.html');

    assert.match(
        shopClientSource,
        /const existingSkeletonCount = this\.getExistingProductSkeletonCount\(container\);[\s\S]*const safeCount = Math\.min\(Math\.max\(requestedCount, 3\), 8\);[\s\S]*if \(hasOnlySkeletonCards && currentSkeletonCount === safeCount\) \{\s*return;\s*\}/,
        'js/shop-client.js should keep the server-rendered shop skeleton layout stable when the first request is still pending'
    );
    assert.equal(
        shopHtmlSource.includes('js/shop-client.js?v=20260405_SHOP_RUNTIME_TRACKING_2'),
        true,
        'shop.html should reference the latest shop client runtime for the phase 3 storefront events'
    );
});

test('homepage entry points expose delegated guestbook triggers instead of inline handlers', () => {
    const indexSource = readRepoFile('index.html');
    const framerHomeSource = readRepoFile('js/framer_home.js');

    assert.equal(indexSource.includes('data-home-open-guestbook="1"'), true, 'index.html should expose delegated guestbook triggers');
    assert.equal(indexSource.includes('data-home-trigger-upload="1"'), true, 'index.html should expose delegated upload triggers');
    assert.equal(framerHomeSource.includes("closest('[data-home-open-guestbook=\"1\"]')"), true, 'js/framer_home.js should delegate homepage guestbook triggers');
    assert.equal(framerHomeSource.includes("closest('[data-home-trigger-upload=\"1\"]')"), true, 'js/framer_home.js should delegate homepage upload triggers');
});

test('framer home runtime renderers externalize homepage section visibility, template styles, and runtime helpers', () => {
    const framerHomeSource = readRepoFile('js/framer_home.js');
    const framerHomeCss = readRepoFile('css/framer_home.css');
    const pageSources = [
        readRepoFile('index.html'),
        readRepoFile('guestbook.html'),
        readRepoFile('verify.html'),
        readRepoFile('shop.html'),
        readRepoFile('prompts.html')
    ];

    const removedMarkers = [
        "element.style.transform = isHovered ? 'translateY(-2px)' : 'translateY(0)'",
        "element.style.boxShadow = isHovered ? '0 8px 32px rgba(255,255,255,0.08)' : 'none'",
        "if (el) el.style.display = 'none';",
        "section.style.display = 'none';",
        "style=\"color: ${entry.color}\"",
        'style="animation-duration: ${shopDuration}s"',
        'style="font-size: 48px; color: var(--accent-blue);"',
        'style="font-size:48px;color:var(--text-secondary,#888)"',
        'style="margin-top: 32px; display: flex; gap: 12px; flex-wrap: wrap;"',
        'style="width: 100%; border-radius: 12px;"',
        'style="display: flex; flex-direction: column; gap: 24px; max-width: 800px; margin: 0 auto; padding: 0 20px; align-items: center;"',
        'style="transition: all 0.3s cubic-bezier(0.4,0,0.2,1);"',
        'style="animation-duration: ${duration}s"',
        "thumb.style.left = `${thumbLeft}px`",
        "tick.style.opacity = '0'",
        "cardUi.style.transform = `scale(${scale})`",
        "column.style.transform = `translate3d(0, ${offset}px, 0)`"
    ];

    for (const marker of removedMarkers) {
        assert.equal(framerHomeSource.includes(marker), false, `js/framer_home.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        'function setHomeRuntimeStyle(target, styles = {}, priority = \'\')',
        'function setHomeSectionVisibility(section, visible)',
        'function getHomeLoopPixelsPerSecond(speedValue)',
        'function getHomeLoopDurationSeconds(cycleWidth, speedValue)',
        "element.classList.toggle('home-hover-lift-active', isHovered)",
        "setHomeSectionVisibility(document.getElementById('hero-section'), true);",
        'data-home-entry-color="${entry.color}"',
        "setHomeRuntimeStyle(icon, {",
        'data-home-speed-value="${shopSpeed}"',
        'class="verify-features"',
        'class="guestbook-list"',
        'guestbook-action-btn',
        "tick.classList.add('progress-tick--covered')",
        "setHomeRuntimeStyle(cardUi, {",
        "setHomeRuntimeStyle(column, {"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(framerHomeSource.includes(marker), true, `js/framer_home.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.home-hover-lift-active',
        '.progress-tick--covered',
        '.home-entry-card-icon',
        '.verify-features',
        '.verify-feature-chip',
        '.verify-actions',
        '.verify-screenshot',
        '.shop-card-icon',
        '.shop-card-icon--fallback',
        '.guestbook-list',
        '.guestbook-card',
        '.guestbook-avatar',
        '.guestbook-card-body',
        '.guestbook-author',
        '.guestbook-content',
        '.guestbook-actions',
        '.guestbook-action-btn'
    ];

    for (const marker of cssMarkers) {
        assert.equal(framerHomeCss.includes(marker), true, `css/framer_home.css should contain ${marker}`);
    }

    for (const source of pageSources) {
        assert.equal(
            source.includes('css/framer_home.css?v=20260329_HOME_SPEED_CURVE_5'),
            true,
            'home-nav entry pages should load the latest framer_home stylesheet version'
        );
        assert.equal(
            source.includes('js/framer_home.js?v=20260331_HOME_DUAL_SITE_RPC_1'),
            true,
            'home-nav entry pages should load the latest framer_home script version'
        );
    }
});

test('homepage subpages load the latest prefetch-home runtime script version', () => {
    const subpageSources = [
        readRepoFile('prompts.html'),
        readRepoFile('shop.html'),
        readRepoFile('verify.html'),
        readRepoFile('guestbook.html')
    ];

    for (const source of subpageSources) {
        assert.equal(
            source.includes('./js/prefetch-home.js?v=20260331_HOME_DUAL_SITE_PREFETCH_1'),
            true,
            'subpages should load the latest prefetch-home script version'
        );
    }
});

test('legacy homepage script externalizes calculator, modal, and magnetic card style state', () => {
    const legacyScriptSource = readRepoFile('script.js');
    const styleSource = readRepoFile('style.css');
    const guestbookSource = readRepoFile('guestbook.html');
    const archivedIndexSource = readRepoFile('index_old.html');

    const removedMarkers = [
        "profitDisplay.style.color = 'var(--success-color)'",
        "profitDisplay.style.color = 'var(--danger-color)'",
        "profitDisplay.style.color = 'var(--text-color)'",
        "modal.style.backdropFilter = '';",
        "modal.style.webkitBackdropFilter = '';",
        "modal.style.background = '';",
        "modal.style.backdropFilter = 'none';",
        "modal.style.webkitBackdropFilter = 'none';",
        "modal.style.background = 'transparent';",
        "modal.style.removeProperty('visibility');",
        "modal.style.removeProperty('opacity');",
        "modal.style.removeProperty('display');",
        "card.style.opacity = '1';",
        "card.style.animation = 'none';",
        "card.style.transition = 'transform 0.2s ease-out, box-shadow 0.25s ease-out';",
        "card.style.transition = 'transform 0.05s linear, box-shadow 0.25s ease-out';",
        "card.style.transform = `translateY(-2px) translate(${moveX}px, ${moveY}px)`;",
        "card.style.transition = '';",
        "card.style.transform = '';",
        "viewMoreBtn.style.setProperty('transform', 'translateY(-2px)', 'important');",
        "viewMoreBtn.style.setProperty('color', '#ff85c0', 'important');",
        "viewMoreBtn.style.setProperty('text-shadow', '0 4px 12px rgba(244, 114, 182, 0.6)', 'important');",
        "card.style.setProperty('--mouse-x', `${x}px`);",
        "card.style.setProperty('--mouse-y', `${y}px`);",
        "lightbox.style.display = 'none';",
        "lightbox.style.display = 'flex';",
        "const isLoggedIn = navAvatar && navAvatar.style.display !== 'none';",
        "modal.style.removeProperty('backdrop-filter');",
        "modal.style.removeProperty('-webkit-backdrop-filter');",
        "modal.style.removeProperty('background');"
    ];

    for (const marker of removedMarkers) {
        assert.equal(legacyScriptSource.includes(marker), false, `script.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        "profitDisplay.classList.toggle('profit-positive', profit > 0);",
        "profitDisplay.classList.toggle('profit-negative', profit < 0);",
        "profitDisplay.classList.toggle('profit-neutral', profit === 0);",
        'function setLegacyRuntimeStyles(target, styles = {}, priority = \'\')',
        "card.classList.add('glass-box-runtime-ready');",
        "card.classList.add('glass-box-magnetic-entering');",
        "card.classList.add('glass-box-magnetic-tracking');",
        "const animateCardTransform = (transform, duration = 60, easing = 'linear') => {",
        "console.log('✅ View More hover uses stylesheet state');",
        'lightbox.hidden = true;',
        'lightbox.hidden = false;',
        "const isLoggedIn = navAvatar && navAvatar.classList.contains('show');"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(legacyScriptSource.includes(marker), true, `script.js should contain ${marker}`);
    }

    const cssMarkers = [
        '#profit.profit-negative',
        '#profit.profit-neutral',
        '.glass-box.glass-box-runtime-ready',
        '.glass-box.glass-box-magnetic-entering',
        '.glass-box.glass-box-magnetic-tracking',
        '.lightbox-overlay[hidden]'
    ];

    for (const marker of cssMarkers) {
        assert.equal(styleSource.includes(marker), true, `style.css should contain ${marker}`);
    }

    assert.equal(
        guestbookSource.includes('script.js?v=20260324_SCRIPT_RUNTIME_STYLE_HELPERS_1'),
        true,
        'guestbook.html should load the latest script.js runtime-style version'
    );
    assert.equal(
        archivedIndexSource.includes('script.js?v=20260324_SCRIPT_RUNTIME_STYLE_HELPERS_1'),
        true,
        'index_old.html should load the latest script.js runtime-style version'
    );
});

test('guestbook runtime renderers externalize loading, modal, and interaction styling', () => {
    const guestbookSource = readRepoFile('guestbook.js');
    const guestbookHtml = readRepoFile('guestbook.html');
    const styleSource = readRepoFile('style.css');

    const removedMarkers = [
        `sentinel.style.cssText =`,
        `loadingIndicator.style.cssText =`,
        `messageContainer.style.display = 'flex'`,
        `messageContainer.style.opacity = '1'`,
        `btn.style.opacity = '0.6'`,
        `modal.style.visibility = 'hidden'`,
        `messageCard.style.background = 'rgba(155, 93, 229, 0.15)'`,
        `icon.style.transform = 'scale(1.2)'`
    ];

    for (const marker of removedMarkers) {
        assert.equal(guestbookSource.includes(marker), false, `guestbook.js should not contain ${marker}`);
    }

    const delegatedMarkers = [
        'setInlineStyles(target, styles)',
        'setCssVariables(target, variables)',
        "messageContainer.classList.add('message-container--masonry')",
        "loadingIndicator.classList.add('is-visible')",
        'comment-item--depth-',
        "messageCard.classList.add('comment-post-highlight')",
        "overlay.classList.toggle('comment-modal-interactive', interactive)",
        "btn.classList.add('is-processing')",
        "icon.classList.add('like-icon-bounce')",
        "messageContainer.classList.add('guestbook-message-container-ready')"
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(guestbookSource.includes(marker), true, `guestbook.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.guestbook-loading-state',
        '.message-container.message-container--masonry',
        '.comment-item--depth-1',
        '.guestbook-loading-indicator',
        '#commentModal.comment-modal-interactive .comment-composer-sheet',
        'body.guestbook-page .message-item.comment-post-highlight',
        '.message-item .action-btn.is-processing',
        '.message-item .action-btn i.like-icon-bounce'
    ];

    for (const marker of cssMarkers) {
        assert.equal(styleSource.includes(marker), true, `style.css should contain ${marker}`);
    }

    assert.equal(
        guestbookHtml.includes('style.css?v=20260324_GUESTBOOK_SUPABASE_RUNTIME_STYLE_1'),
        true,
        'guestbook.html should reference the updated guestbook stylesheet version'
    );
    assert.equal(
        guestbookHtml.includes('guestbook.js?v=20260324_GUESTBOOK_RUNTIME_STYLE_HELPERS_1'),
        true,
        'guestbook.html should reference the updated guestbook script version'
    );
});

test('supabase guestbook runtime renderers externalize error, empty state, delete, heart, and preview styling', () => {
    const guestbookSupabaseSource = readRepoFile('supabase-guestbook-functions.js');
    const homepageGuestbookSource = readRepoFile('js/homepage-guestbook-modal.js');
    const styleSource = readRepoFile('style.css');
    const indexSource = readRepoFile('index.html');
    const guestbookHtml = readRepoFile('guestbook.html');
    const archivedIndexSource = readRepoFile('index_old.html');

    const removedMarkers = [
        '<p style="color: red;">加载留言失败，请刷新重试</p>',
        "emptyState.style.display = 'flex'",
        "container.style.opacity = '1'",
        "emptyState.style.display = 'none'",
        "msgEl.style.transition = 'opacity 0.3s, transform 0.3s';",
        "msgEl.style.opacity = '0';",
        "msgEl.style.transform = 'scale(0.9)';",
        "const style = document.createElement('style');",
        "heartIcon.style.animation = 'heartBounce 1.2s ease-in-out';",
        "heartIcon.style.color = '#ff4757';",
        "heartIcon.style.animation = 'heartPulse 1s ease-in-out 3';",
        "imagePreview.style.display = 'block';",
        "imagePreview.style.display = 'none';"
    ];

    for (const marker of removedMarkers) {
        assert.equal(guestbookSupabaseSource.includes(marker), false, `supabase-guestbook-functions.js should not contain ${marker}`);
    }

    const runtimeMarkers = [
        'function markGuestbookContainerReady(container)',
        'function setGuestbookEmptyStateVisible(emptyState, visible)',
        'function setGuestbookImagePreviewVisible(imagePreview, visible)',
        "container.innerHTML = '<p class=\"guestbook-message-error\">加载留言失败，请刷新重试</p>';",
        'markGuestbookContainerReady(container);',
        "msgEl.classList.add('guestbook-message-removing');",
        "triggerGuestbookHeartAnimation(heartIcon, 'guestbook-heart-bounce', 1500);",
        "triggerGuestbookHeartAnimation(heartIcon, 'guestbook-heart-pulse', 3500);",
        "imagePreview.classList.toggle('guestbook-composer-preview-hidden', !visible);",
        "imagePreview.classList.toggle('index-guestbook-image-preview-hidden', !visible);"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(guestbookSupabaseSource.includes(marker), true, `supabase-guestbook-functions.js should contain ${marker}`);
    }

    assert.equal(
        homepageGuestbookSource.includes("!imagePreview.hidden"),
        true,
        'js/homepage-guestbook-modal.js should detect image preview visibility without inline display state'
    );

    const cssMarkers = [
        '.guestbook-message-error',
        'body.guestbook-page .message-item.guestbook-message-removing',
        '.guestbook-heart-liked',
        '@keyframes guestbookHeartBounce',
        '@keyframes guestbookHeartPulse',
        '.guestbook-composer-preview-hidden'
    ];

    for (const marker of cssMarkers) {
        assert.equal(styleSource.includes(marker), true, `style.css should contain ${marker}`);
    }

    const htmlMarkers = [
        'style.css?v=20260324_GUESTBOOK_SUPABASE_RUNTIME_STYLE_1',
        'supabase-guestbook-functions.js?v=20260404_GUESTBOOK_PHASE3_EVENTS_1'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(indexSource.includes(marker), true, `index.html should contain ${marker}`);
        assert.equal(guestbookHtml.includes(marker), true, `guestbook.html should contain ${marker}`);
        assert.equal(archivedIndexSource.includes(marker), true, `index_old.html should contain ${marker}`);
    }
});

test('homepage guestbook modal runtime renderers externalize keyboard dock, viewport probe, and overlay state styling', () => {
    const homepageGuestbookSource = readRepoFile('js/homepage-guestbook-modal.js');
    const styleSource = readRepoFile('style.css');
    const indexSource = readRepoFile('index.html');
    const guestbookHtml = readRepoFile('guestbook.html');

    const removedMarkers = [
        "overlay.style.pointerEvents = interactive ? 'auto' : 'none';",
        "card.style.pointerEvents = interactive ? 'auto' : 'none';",
        "card.style.zIndex = interactive ? '4' : '1';",
        "element.style.pointerEvents = interactive ? 'auto' : 'none';",
        "probe.style.position = 'fixed';",
        "overlay.style.setProperty('--guestbook-modal-overlay-height'",
        "overlay.style.removeProperty('--guestbook-modal-overlay-height')",
        "overlay.style.setProperty('--guestbook-modal-translate-y'",
        "card.style.setProperty('height'",
        "card.style.setProperty('max-height'",
        "card.style.removeProperty('height')",
        "card.style.removeProperty('max-height')"
    ];

    for (const marker of removedMarkers) {
        assert.equal(homepageGuestbookSource.includes(marker), false, `js/homepage-guestbook-modal.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        "const GUESTBOOK_MODAL_STYLE_DECL_KEY = 'style';",
        'function setGuestbookModalRuntimeStyles(target, styles = {}, priority = \'\')',
        "overlay.classList.toggle('guestbook-modal-interactive', interactive);",
        "probe.className = 'guestbook-modal-viewport-probe';",
        "'--guestbook-modal-overlay-height': `${measuredHeight}px`",
        "'--guestbook-modal-translate-y': `${shiftY}px`",
        "'--guestbook-modal-card-height': `${finalCardHeight}px`",
        "'--guestbook-modal-card-max-height': `${finalCardHeight}px`"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(homepageGuestbookSource.includes(marker), true, `js/homepage-guestbook-modal.js should contain ${marker}`);
    }

    const cssMarkers = [
        '--guestbook-modal-card-height: 420px;',
        '--guestbook-modal-card-max-height: calc(100svh - 56px);',
        '#guestbookModal.guestbook-modal-interactive',
        '.guestbook-modal-viewport-probe',
        'height: var(--guestbook-modal-card-height, 420px);',
        'max-height: var(--guestbook-modal-card-max-height, calc(100svh - 56px));',
        'height: var(--guestbook-modal-card-height, min(400px, calc(var(--guestbook-modal-overlay-height, 100svh) - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px)));',
        'max-height: var(--guestbook-modal-card-max-height, calc(var(--guestbook-modal-overlay-height, 100svh) - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px));'
    ];

    for (const marker of cssMarkers) {
        assert.equal(styleSource.includes(marker), true, `style.css should contain ${marker}`);
    }

    assert.equal(
        indexSource.includes('style.css?v=20260324_GUESTBOOK_SUPABASE_RUNTIME_STYLE_1'),
        true,
        'index.html should load the latest homepage guestbook modal stylesheet version'
    );
    assert.equal(
        indexSource.includes('./js/homepage-guestbook-modal.js?v=20260324_HOMEPAGE_GUESTBOOK_MODAL_RUNTIME_STYLE_2'),
        true,
        'index.html should load the latest homepage guestbook modal script version'
    );
    assert.equal(
        guestbookHtml.includes('style.css?v=20260324_GUESTBOOK_SUPABASE_RUNTIME_STYLE_1'),
        true,
        'guestbook.html should load the latest shared stylesheet version'
    );
});

test('admin studio shell tabs and dashboards route core controls through delegated actions', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminStudioCss = readRepoFile('admin-studio.css');

    const removedInlineMarkers = [
        `onclick="switchModule('gallery')"`,
        `onclick="switchView('create')"`,
        `onclick="switchCommentView('guestbook')"`,
        `onclick="switchSettingsView('pricing')"`,
        `onclick="HomepageAdmin.switchSection('hero')"`,
        `onclick="AdminPayments.switchTab('overview')"`,
        `onclick="togglePaymentProviderPanel('mock')"`,
        `onclick="event.stopPropagation(); togglePaymentProviderEnabled('mock')"`,
        `onclick="savePaymentChannelSettings()"`,
        `onclick="AdminPayments.toggleRangeMenu(event)"`,
        `onclick="dismissAllAlerts()"`,
        `onclick="switchAnalyticsTab('users')"`,
        `onclick="toggleDateRangeDropdown()"`,
        `onclick="exportAnalyticsData('excel')"`,
        `onclick="exportAnalyticsData('csv')"`,
        `onclick="refreshAllAnalytics()"`,
        `onclick="document.getElementById('hp-verify-file-input').click()"`,
        `onchange="HomepageAdmin._handleScreenshotUpload(this)"`,
        `onchange="handlePaymentChannelActiveChange(this.value)"`,
        `onchange="toggleSelectAll()"`
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(adminStudioSource.includes(marker), false, `admin-studio.html should not contain ${marker}`);
    }

    const delegatedMarkers = [
        'data-admin-action="switch-module"',
        'data-admin-action="switch-gallery-view"',
        'data-admin-action="switch-comment-view"',
        'data-admin-action="switch-settings-view"',
        'data-admin-action="homepage-switch-section"',
        'data-admin-action="payments-switch-tab"',
        'data-admin-action="payments-toggle-provider-panel"',
        'data-admin-action="payments-toggle-provider-enabled"',
        'data-admin-action="payments-save-channel-settings"',
        'data-admin-action="analytics-switch-tab"',
        'data-admin-action="analytics-open-destination"',
        'data-admin-action="analytics-export-data"',
        'data-admin-action="analytics-refresh-data"',
        'data-admin-action="analytics-toggle-advanced-tools"',
        'data-admin-change-action="homepage-handle-screenshot-upload"',
        'data-admin-change-action="payments-change-active-provider"',
        'data-admin-change-action="comments-toggle-select-all"'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(adminStudioSource.includes('data-admin-action="analytics-load-experiments-list"'), false, 'admin-studio.html should not expose analytics experiments as a primary toolbar entry');

    assert.equal(adminStudioScript.includes("closest('[data-admin-action]')"), true, 'admin-studio.js should delegate click-based admin controls');
    assert.equal(adminStudioScript.includes("closest('[data-admin-change-action]')"), true, 'admin-studio.js should delegate change-based admin controls');
    assert.equal(adminStudioScript.includes("target.closest('[data-admin-overlay-close]')"), true, 'admin-studio.js should resolve overlay dismissal from the nearest overlay container');
    assert.equal(adminStudioScript.includes("case 'analytics-toggle-advanced-tools':"), true, 'admin-studio.js should delegate the analytics advanced tools toggle');
    assert.equal(adminStudioCss.includes('.analytics-advanced-workspace[hidden]'), true, 'admin-studio.css should force-hide the analytics advanced workspace when the hidden attribute is set');
    assert.equal(adminStudioScript.includes("target.closest('.admin-ticket-reply-modal__panel')"), true, 'admin-studio.js should keep reply modal clicks inside the panel from triggering overlay dismissal');
    assert.equal(adminStudioScript.includes("target.closest('.admin-ticket-bulk-modal__panel')"), true, 'admin-studio.js should keep bulk modal clicks inside the panel from triggering overlay dismissal');
    assert.equal(adminStudioScript.includes("target.closest('.admin-ticket-summary-job-modal__dialog')"), true, 'admin-studio.js should keep summary detail clicks inside the dialog from triggering overlay dismissal');
    assert.equal(adminStudioScript.includes("window.AdminTickets?.setWorkspaceView?.(actionEl.dataset.ticketWorkspace, {"), true, 'admin-studio.js should switch ticket workspaces through the shared workspace helper');
    assert.equal(adminStudioScript.includes("scroll: false"), true, 'admin-studio.js should avoid auto-scrolling when switching ticket workspaces from the top tab bar');
    assert.equal(adminStudioCss.includes('#module-tickets[data-ticket-workspace="summary"] #ticketsOverviewPanel'), true, 'admin-studio.css should flatten the outer overview shell in summary tracking mode');
    assert.equal(adminStudioCss.includes('#module-tickets[data-ticket-workspace="summary"] #ticketsOverviewPanel .admin-ticket-overview-panels'), true, 'admin-studio.css should flatten the summary tracking panel stack into a single column');
    assert.equal(adminStudioCss.includes('.admin-ticket-overview-reminder-grid--summary .admin-ticket-overview-reminder-section--summary'), true, 'admin-studio.css should let the daily SLA summary section span the full summary tracking row');
    assert.equal(adminStudioCss.includes('#module-tickets[data-ticket-workspace="summary"] #ticketsOverviewReminderPanel .admin-ticket-overview-reminder-section--activity'), true, 'admin-studio.css should add extra breathing room above the summary reminder activity card');
    assert.equal(adminStudioCss.includes('.admin-ticket-overview-reminder-summary-history-item__actions'), true, 'admin-studio.css should align summary history actions on the right side of each history card');
    assert.equal(adminStudioCss.includes('.admin-ticket-overview-reminder-summary-actions--history'), true, 'admin-studio.css should pin summary history action buttons to the bottom-right of each history card');
    assert.equal(adminStudioCss.includes('.admin-ticket-overview-reminder-summary-preview-item__actions'), true, 'admin-studio.css should pin summary preview ticket actions to the bottom-right of each preview card');
    assert.equal(adminStudioCss.includes('.admin-ticket-summary-job-modal__comparison-item-actions'), true, 'admin-studio.css should pin comparison card actions to the bottom-right and isolate them from long text');
    assert.equal(adminStudioCss.includes('.admin-ticket-bulk-modal.is-visible .admin-ticket-bulk-modal__panel'), true, 'admin-studio.css should animate the bulk process dialog panel into view');
    assert.equal(adminStudioCss.includes('.admin-ticket-summary-job-modal.is-visible .admin-ticket-summary-job-modal__dialog'), true, 'admin-studio.css should animate the summary detail dialog into view');
    assert.equal(adminStudioCss.includes('.admin-ticket-overview-reminder-activity__footer'), false, 'admin-studio.css should remove duplicate footer actions from the reminder activity card');
    assert.equal(adminStudioCss.includes('.admin-ticket-overview-reminder-actions--embedded'), false, 'admin-studio.css should no longer style embedded duplicate footer actions inside the reminder panels');
});

test('admin general settings and export controls route through delegated bindings with real handler glue', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminConfigSource = readRepoFile('admin-config.js');

    const removedInlineMarkers = [
        'onclick="addNewApiKey()"',
        `onclick="exportData('users', 'json')"`,
        `onclick="exportData('comments', 'csv')"`,
        `onclick="toggleCustomDropdown('refreshIntervalDropdown')"`,
        `onclick="selectDropdownOption('aiServiceDropdown', 'openai', 'OpenAI')"`,
        'onclick="saveSeoSettings()"',
        `onclick="toggleCustomDropdown('cacheDurationDropdown')"`
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(adminStudioSource.includes(marker), false, `admin-studio.html should not contain ${marker}`);
    }

    const delegatedMarkers = [
        'data-admin-action="settings-add-api-key"',
        'data-admin-action="settings-export-dataset"',
        'data-admin-action="settings-toggle-custom-dropdown"',
        'data-admin-action="settings-select-dropdown-option"',
        'data-admin-action="settings-save-seo"'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const delegatedHandlerMarkers = [
        "case 'settings-add-api-key':",
        "case 'settings-export-dataset':",
        "case 'settings-toggle-custom-dropdown':",
        "case 'settings-select-dropdown-option':",
        "case 'settings-save-seo':",
        "case 'settings-prompt-api-key':",
        "case 'settings-delete-api-key':"
    ];

    for (const marker of delegatedHandlerMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const runtimeTemplateMarkers = [
        'data-admin-action="settings-prompt-api-key"',
        'data-admin-action="settings-delete-api-key"'
    ];

    for (const marker of runtimeTemplateMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should render ${marker}`);
    }

    const configGlueMarkers = [
        'function renderGeneralSettingsConfig()',
        'function saveSeoSettings()',
        'async function exportSettingsData(dataset, format = \'json\')',
        'fetchUsersExportRows',
        'fetchCommentsExportRows',
        'fetchPointsExportRows',
        'setupGeneralSettingsEventListeners()',
        'window.saveSeoSettings = saveSeoSettings;',
        'window.exportSettingsData = exportSettingsData;'
    ];

    for (const marker of configGlueMarkers) {
        assert.equal(adminConfigSource.includes(marker), true, `admin-config.js should contain ${marker}`);
    }
});

test('admin studio runtime prompt workflows externalize visibility, empty-state, and overlay style state', () => {
    const adminStudioSource = readRepoFile('admin-studio.js');
    const adminStudioStyles = readRepoFile('admin-studio.css');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const removedRuntimeMarkers = [
        "primaryAction.style.display = '';",
        "secondaryAction.style.display = 'none';",
        "manageTab.style.display = 'none';",
        "promptForm.style.display = 'flex';",
        "lastEditedInfo.style.display = 'inline-flex';",
        "loadingEl.style.display = 'flex';",
        "toast.style.animation = 'slideIn 0.3s ease reverse';",
        "batchMenuContainer.style.display = 'block';",
        "document.getElementById('deleteConfirmOverlay').style.display = 'flex';",
        "document.getElementById('lightboxOverlay').style.display = 'flex';",
        "suggestionsSection.style.display = 'flex';",
        "card.style.display = visible ? '' : 'none';",
        "msg.style.cssText = 'grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 2rem;'",
        '<p style="grid-column: 1/-1; text-align: center; color: var(--text-dim);">No prompts yet. Create your first one!</p>',
        'style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;"',
        'indicator.style.left = `${left}px`;',
        'indicator.style.width = `${tabRect.width}px`;',
        'return `<div class="color-swatch" style="background: ${hex}" data-color="${color}"></div>`;',
        "document.getElementById('batchProgressFill').style.width = `${percent}%`;"
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(adminStudioSource.includes(marker), false, `admin-studio.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        "const ADMIN_STUDIO_HIDDEN_CLASS = 'admin-studio-inline-style-attr-3';",
        "function setAdminStudioVisibility(target, visible, visibleClass = '')",
        "function createAdminStudioEmptyElement(text, className = 'admin-empty-message', tagName = 'p')",
        "setAdminStudioVisibility(promptForm, true);",
        "setAdminStudioVisibility(loadingEl, true);",
        'function setPromptBilingualFieldsOpen(open)',
        'function populatePromptBilingualFields(data = {})',
        'function collectPromptBilingualFieldValues()',
        'function normalizePromptSiteMetrics(prompt = {})',
        "metricCounts.textContent = `解锁 ${siteMetrics.unlock_count} · 评论 ${siteMetrics.comment_count}`;",
        "card.classList.add('is-removing');",
        "syncAdminSearchCardVisibility(card, visible);",
        "setAdminStudioVisibility(suggestionsSection, true, 'is-visible');",
        "document.getElementById('batchProgressFill').value = percent;",
        "color-swatch--unknown",
        'class="key-actions"',
        'btn-add-config btn-add-config--compact'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.search-suggestions.is-visible',
        '.admin-empty-message',
        '.admin-empty-tag',
        '.toast.is-dismissing',
        '.admin-card--hidden-by-search',
        '.admin-card.is-removing',
        '.admin-tabs .admin-tab.active::after',
        '.batch-progress-fill::-webkit-progress-value',
        '.color-swatch--dark-blue',
        '.color-swatch--unknown',
        '.gallery-bilingual-panel',
        '.gallery-bilingual-toggle.is-active',
        '.gallery-bilingual-grid',
        '.admin-card-site-metrics',
        '.admin-card-site-metric.is-current',
        '.api-key-row .btn-add-config.btn-add-config--compact',
        '.api-key-row .btn-add-config.btn-add-config--danger'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStudioStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    assert.match(
        adminStudioHtml,
        /admin-studio\.css\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should load the latest admin studio stylesheet version'
    );
    assert.match(
        adminStudioHtml,
        /admin-studio\.js\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should load the latest admin studio runtime version'
    );
});

test('force input background fix externalizes focus styling and avoids repeated inline writes', () => {
    const forceInputScript = readRepoFile('force-input-bg-fix.js');
    const forceInputStyles = readRepoFile('css/force-input-bg-fix.css');
    const guestbookHtml = readRepoFile('guestbook.html');
    const legacyIndexHtml = readRepoFile('index_old.html');

    const removedMarkers = [
        "input.style.removeProperty('background');",
        "input.style.removeProperty('background-color');",
        "input.style.removeProperty('border');",
        "input.style.removeProperty('border-color');",
        "input.style.removeProperty('box-shadow');",
        "input.style.setProperty('background', 'rgba(0, 0, 0, 0.4)', 'important');",
        "input.style.setProperty('background-color', 'rgba(0, 0, 0, 0.4)', 'important');",
        "input.style.setProperty('border', '1px solid rgba(155, 93, 229, 0.7)', 'important');",
        "input.style.setProperty('border-color', 'rgba(155, 93, 229, 0.7)', 'important');",
        "input.style.setProperty('box-shadow', '0 0 0 3px rgba(155, 93, 229, 0.15)', 'important');"
    ];

    for (const marker of removedMarkers) {
        assert.equal(forceInputScript.includes(marker), false, `force-input-bg-fix.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        "const FORCE_INPUT_FIX_CLASS = 'force-input-bg-fixed';",
        "const FORCE_INPUT_FIX_FOCUSED_CLASS = 'force-input-bg-fixed--focused';",
        "const FORCE_INPUT_FIX_BOUND_ATTR = 'data-force-input-bg-bound';",
        "input.classList.add(FORCE_INPUT_FIX_CLASS);",
        "input.classList.toggle(FORCE_INPUT_FIX_FOCUSED_CLASS, input === document.activeElement);",
        "input.setAttribute(FORCE_INPUT_FIX_BOUND_ATTR, 'true');"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(forceInputScript.includes(marker), true, `force-input-bg-fix.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.force-input-bg-fixed {',
        '.force-input-bg-fixed.force-input-bg-fixed--focused {'
    ];

    for (const marker of styleMarkers) {
        assert.equal(forceInputStyles.includes(marker), true, `force-input-bg-fix.css should contain ${marker}`);
    }

    assert.equal(
        guestbookHtml.includes('css/force-input-bg-fix.css?v=20260324_FORCE_INPUT_BG_FIX_1'),
        true,
        'guestbook.html should load the latest force input fix stylesheet version'
    );
    assert.equal(
        guestbookHtml.includes('./force-input-bg-fix.js?v=20260324_FORCE_INPUT_BG_FIX_1'),
        true,
        'guestbook.html should load the latest force input fix runtime version'
    );
    assert.equal(
        legacyIndexHtml.includes('css/force-input-bg-fix.css?v=20260324_FORCE_INPUT_BG_FIX_1'),
        true,
        'index_old.html should load the latest force input fix stylesheet version'
    );
    assert.equal(
        legacyIndexHtml.includes('./force-input-bg-fix.js?v=20260324_FORCE_INPUT_BG_FIX_1'),
        true,
        'index_old.html should load the latest force input fix runtime version'
    );
});

test('ios scroll lock externalizes fixed-body shell styles while keeping dynamic offset centralized', () => {
    const scrollLockSource = readRepoFile('js/ios-scroll-lock.js');
    const sharedStyles = readRepoFile('style.css');
    const indexHtml = readRepoFile('index.html');
    const guestbookHtml = readRepoFile('guestbook.html');
    const verifyHtml = readRepoFile('verify.html');
    const promptsHtml = readRepoFile('prompts.html');
    const shopHtml = readRepoFile('shop.html');

    const removedMarkers = [
        "document.body.style.position = 'fixed';",
        "document.body.style.left = '0';",
        "document.body.style.right = '0';",
        "document.body.style.width = '100%';",
        "document.body.style.position = '';",
        "document.body.style.left = '';",
        "document.body.style.right = '';",
        "document.body.style.width = '';"
    ];

    for (const marker of removedMarkers) {
        assert.equal(scrollLockSource.includes(marker), false, `js/ios-scroll-lock.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        "function setFixedBodyLockOffset() {",
        "function clearFixedBodyLockOffset() {",
        "document.body.classList.add('ios-scroll-lock-fixed');",
        "document.body.classList.remove('ios-scroll-lock-fixed');",
        "document.body.style['setProperty']('--ios-scroll-lock-offset', `-${savedScrollY}px`);",
        "document.body.style['removeProperty']('--ios-scroll-lock-offset');"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(scrollLockSource.includes(marker), true, `js/ios-scroll-lock.js should contain ${marker}`);
    }

    assert.equal(
        sharedStyles.includes('body.ios-scroll-lock-fixed {'),
        true,
        'style.css should contain the fixed-body iOS scroll lock class'
    );
    assert.equal(
        sharedStyles.includes('top: var(--ios-scroll-lock-offset, 0px);'),
        true,
        'style.css should source the iOS scroll lock offset from a CSS variable'
    );

    const expectedVersion = 'js/ios-scroll-lock.js?v=20260324_IOS_SCROLL_LOCK_RUNTIME_STYLE_2';
    for (const [fileName, html] of Object.entries({
        'index.html': indexHtml,
        'guestbook.html': guestbookHtml,
        'verify.html': verifyHtml,
        'prompts.html': promptsHtml,
        'shop.html': shopHtml
    })) {
        assert.equal(html.includes(expectedVersion), true, `${fileName} should reference the updated iOS scroll lock runtime version`);
    }
});

test('capsule manager externalizes pulse and swipe state styling', () => {
    const capsuleManagerSource = readRepoFile('capsule-manager.js');
    const capsuleStyles = readRepoFile('capsule-styles.css');
    const guestbookHtml = readRepoFile('guestbook.html');

    const removedMarkers = [
        "el.style.transform = 'translateX(-50%) scale(1.05) translateZ(0)';",
        "setTimeout(() => el.style.transform = 'translateX(-50%) scale(1) translateZ(0)', 200);",
        "capsule.style.transition = 'none';",
        "capsule.style.transform = `translateX(-50%) translateY(${deltaY}px)`;",
        "capsule.style.transition = '';",
        "capsule.style.transform = 'translateX(-50%) translateY(0)';",
        "capsule.style.transform = 'translateX(-50%) translateY(-100px)';"
    ];

    for (const marker of removedMarkers) {
        assert.equal(capsuleManagerSource.includes(marker), false, `capsule-manager.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        "dragOffsetProperty: '--capsule-drag-offset'",
        "this.pulse(el);",
        "styleDecl.setProperty(this.runtime.dragOffsetProperty, `${Math.round(Number(value))}px`);",
        "capsule.classList.add('capsule-wrapper--dragging');",
        "capsule.classList.add('capsule-wrapper--dismissed');",
        "capsule.classList.remove('capsule-wrapper--dismissed');"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(capsuleManagerSource.includes(marker), true, `capsule-manager.js should contain ${marker}`);
    }

    const styleMarkers = [
        '--capsule-drag-offset: 0px;',
        '--capsule-scale: 1;',
        '.capsule-wrapper.capsule-wrapper--pulse {',
        '.capsule-wrapper.capsule-wrapper--dragging {',
        '.capsule-wrapper.capsule-wrapper--dismissed {'
    ];

    for (const marker of styleMarkers) {
        assert.equal(capsuleStyles.includes(marker), true, `capsule-styles.css should contain ${marker}`);
    }

    assert.equal(
        guestbookHtml.includes('capsule-styles.css?v=20260324_CAPSULE_RUNTIME_STYLE_1'),
        true,
        'guestbook.html should reference the updated capsule stylesheet version'
    );
    assert.equal(
        guestbookHtml.includes('capsule-manager.js?v=20260324_CAPSULE_RUNTIME_STYLE_1'),
        true,
        'guestbook.html should reference the updated capsule runtime version'
    );
});

test('image zoom runtime externalizes modal transform and transition styling', () => {
    const imageZoomSource = readRepoFile('image-zoom.js');
    const sharedStyles = readRepoFile('style.css');
    const guestbookHtml = readRepoFile('guestbook.html');

    const removedMarkers = [
        "img.style.transition = 'none';",
        "img.style.transformOrigin = 'center center';",
        "img.style.touchAction = 'none';",
        "img.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;",
        "img.style.transition = 'transform 0.3s ease';"
    ];

    for (const marker of removedMarkers) {
        assert.equal(imageZoomSource.includes(marker), false, `image-zoom.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        "const IMAGE_ZOOM_ENABLED_CLASS = 'image-zoom-enabled';",
        "const IMAGE_ZOOM_ANIMATING_CLASS = 'image-zoom-animating';",
        "styleDecl.setProperty('--image-zoom-translate-x', `${state.translateX}px`);",
        "styleDecl.setProperty('--image-zoom-translate-y', `${state.translateY}px`);",
        "styleDecl.setProperty('--image-zoom-scale', String(state.scale));",
        'img.classList.add(IMAGE_ZOOM_ENABLED_CLASS);',
        'img.classList.add(IMAGE_ZOOM_ANIMATING_CLASS);',
        'img.classList.remove(IMAGE_ZOOM_ANIMATING_CLASS);'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(imageZoomSource.includes(marker), true, `image-zoom.js should contain ${marker}`);
    }

    const styleMarkers = [
        '--image-zoom-translate-x: 0px;',
        '--image-zoom-translate-y: 0px;',
        '--image-zoom-scale: 1;',
        'transform: translate(var(--image-zoom-translate-x), var(--image-zoom-translate-y)) scale(var(--image-zoom-scale));',
        '.image-modal-content img.image-zoom-animating {'
    ];

    for (const marker of styleMarkers) {
        assert.equal(sharedStyles.includes(marker), true, `style.css should contain ${marker}`);
    }

    assert.equal(
        guestbookHtml.includes('image-zoom.js?v=20260324_IMAGE_ZOOM_RUNTIME_STYLE_1'),
        true,
        'guestbook.html should reference the updated image zoom runtime version'
    );
});

test('admin pricing package controls no longer emit inline handlers in static or dynamic settings markup', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminConfigSource = readRepoFile('admin-config.js');

    const removedInlineMarkers = [
        'onclick="addPackageRow()"',
        'onclick="toggleCustomRechargeEntryStatus()"',
        'onclick="toggleMockPaymentStatus()"',
        `onchange="updatePackage(`,
        `onclick="togglePackageStatus(`,
        `onclick="deletePackage(`
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(
            adminStudioSource.includes(marker) || adminConfigSource.includes(marker),
            false,
            `pricing controls should not contain ${marker}`
        );
    }

    const delegatedHtmlMarkers = [
        'data-admin-action="settings-open-points-catalog"',
        'data-admin-action="settings-toggle-custom-recharge-entry"',
        'data-admin-action="settings-toggle-mock-payment"'
    ];

    for (const marker of delegatedHtmlMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const removedDelegatedRuntimeMarkers = [
        'data-admin-change-action="settings-update-package-field"',
        'data-admin-action="settings-toggle-package-status"',
        'data-admin-action="settings-delete-package"',
        'data-admin-action="settings-add-package-row"',
        'packagesTableBody',
        'function normalizePackageFieldValue(field, value, fallback)',
        'window.updatePackage = updatePackage;',
        'window.togglePackageStatus = togglePackageStatus;',
        'window.deletePackage = deletePackage;',
        'window.addPackageRow = addPackageRow;'
    ];

    for (const marker of removedDelegatedRuntimeMarkers) {
        assert.equal(adminConfigSource.includes(marker), false, `admin-config.js should not contain ${marker}`);
    }

    const delegatedHandlerMarkers = [
        "case 'settings-open-points-catalog':",
        "case 'settings-toggle-custom-recharge-entry':",
        "case 'settings-toggle-mock-payment':"
    ];

    for (const marker of delegatedHandlerMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const removedHandlerMarkers = [
        "case 'settings-add-package-row':",
        "case 'settings-toggle-package-status':",
        "case 'settings-delete-package':",
        "case 'settings-update-package-field':"
    ];

    for (const marker of removedHandlerMarkers) {
        assert.equal(adminStudioScript.includes(marker), false, `admin-studio.js should not contain ${marker}`);
    }
});

test('settings pricing runtime now keeps only the package migration shortcut and payment toggles', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminConfigSource = readRepoFile('admin-config.js');

    const requiredMarkers = [
        '套餐编辑已经迁到 Points 模块的“套餐目录”里；这里不再承担日常套餐运营，只保留支付相关开关和迁移说明。',
        '前往 `兑换码/套餐 -> 套餐目录` 统一维护名称、价格、赠送和启停状态；站点筛选只影响写操作语境，不会拆分两份套餐主数据。',
        'data-admin-action="settings-open-points-catalog"',
        'function renderPackagesConfig() {',
        "document.getElementById('customRechargeStatusToggle')",
        "document.getElementById('mockPaymentStatusToggle')"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(
            adminConfigSource.includes(marker) || adminStudioSource.includes(marker),
            true,
            `settings package source should contain ${marker}`
        );
    }

    const removedMarkers = [
        "await loadAdminPointsPackagesConfig();",
        "fetch('/api/admin/points/packages'",
        'let adminPointsPackagesConfigRowsLoaded = false;',
        'function setAdminPointsPackagesConfigRows(rows = []) {',
        'await mutateAdminPointsPackageConfig({',
        'await deleteAdminPointsPackageConfig(current.id);',
        'syncPackagesToDatabase(',
        "await saveConfig('packages', packages);",
        "saveConfig('packages', packages).catch(err => {",
        "saveConfig('packages', packages);",
        "if (key === 'packages') {",
        "systemConfigCache['packages']",
        'packagesTableBody'
    ];

    for (const marker of removedMarkers) {
        assert.equal(adminConfigSource.includes(marker), false, `admin-config.js should no longer contain ${marker}`);
    }
});

test('settings general view no longer exposes frontend traffic runtime controls', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminConfigSource = readRepoFile('admin-config.js');

    const removedMarkers = [
        '前台分流 runtime',
        'cfgTrafficRuntimeEnabled',
        'cfgTrafficRuntimeHint',
        'cfgTrafficRuntimeAuditMeta',
        'cfgTrafficRuntimeProbeStatus',
        'cfgTrafficRuntimeProbeRefreshBtn',
        "systemConfigCache[TRAFFIC_RUNTIME_SYSTEM_CONFIG_KEY]",
        'function getTrafficRuntimeSystemConfig() {',
        'function setTrafficRuntimeSystemConfig(config) {',
        "applyTrafficRuntimeConfigUi(nextConfig);",
        'async function loadTrafficRuntimeAdminState(options = {}) {',
        'async function saveTrafficRuntimeConfig(config) {',
        "const response = await fetch('/api/admin/settings/traffic-runtime', {",
        'function renderTrafficRuntimeProbeState(state = trafficRuntimeProbeState) {',
        'function renderTrafficRuntimeAuditState(state = trafficRuntimeAuditState) {',
        'async function refreshTrafficRuntimeProbe(options = {}) {',
        "showStandaloneSaveIndicator('cfgTrafficRuntimeProbeIndicator', '已探测');"
    ];

    for (const marker of removedMarkers) {
        assert.equal(
            adminStudioSource.includes(marker) || adminConfigSource.includes(marker),
            false,
            `general settings should no longer contain ${marker}`
        );
    }
});

test('admin-side runtime bridge is removed from active code paths', () => {
    const removalChecks = [
        { path: 'admin-config.js', markers: ['TRAFFIC_RUNTIME_SYSTEM_CONFIG_KEY', 'cfgTrafficRuntimeEnabled'] },
        { path: 'api/admin.js', markers: ['settings/traffic-runtime', 'settings/experiment-runtime'] },
        { path: 'api/runtime/supabase-config.js', markers: ['traffic_runtime', '__ZAOYOE_TRAFFIC_RUNTIME_DEFAULT_ENABLED__', '__ZAOYOE_EXPERIMENT_RUNTIME_DEFAULT_ENABLED__'] },
        { path: 'api/_lib/public-runtime-config.js', markers: ['__ZAOYOE_TRAFFIC_RUNTIME_DEFAULT_ENABLED__', '__ZAOYOE_EXPERIMENT_RUNTIME_DEFAULT_ENABLED__'] }
    ];

    for (const { path, markers } of removalChecks) {
        const source = readRepoFile(path);
        for (const marker of markers) {
            assert.equal(source.includes(marker), false, `${path} should no longer contain ${marker}`);
        }
    }

    assert.equal(
        fs.existsSync(path.join(REPO_ROOT, 'server', 'api-handlers', 'admin', 'settings', 'traffic-runtime.js')),
        false,
        'traffic runtime settings handler should be deleted'
    );
});

test('admin ops alert controls expose delegated settings actions and runtime wiring', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioCss = readRepoFile('admin-studio.css');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminWorkbenchSource = readRepoFile('js/admin-workbench.js');
    const rawAdminConfigSource = readRepoFile('admin-config.js');
    const adminConfigSource = (() => {
        const source = rawAdminConfigSource;
        const helperMarker = "function resolveOpsAlertSharedCallable(methodName = '', localCallable = null, optionsBuilder = null) {";
        if (!source.includes(helperMarker)) {
            return source;
        }

        const helperBridgeMarkers = [
            ['window.getAdminWorkbenchOpsAlertCaseSummaryText(item, {', 'getAdminWorkbenchOpsAlertCaseSummaryText'],
            ['window.getAdminWorkbenchOpsAlertMonitorDisplayActiveCount(category)', 'getAdminWorkbenchOpsAlertMonitorDisplayActiveCount'],
            ['window.getAdminWorkbenchOpsAlertMonitorDisplayCriticalCount(category)', 'getAdminWorkbenchOpsAlertMonitorDisplayCriticalCount'],
            ['window.getAdminWorkbenchOpsAlertMonitorCardTone(category)', 'getAdminWorkbenchOpsAlertMonitorCardTone'],
            ['window.getAdminWorkbenchOpsAlertCaseStatusTone(status, { variant: \'monitor\' })', 'getAdminWorkbenchOpsAlertCaseStatusTone'],
            ['window.getAdminWorkbenchOpsAlertCaseStatusLabel(status)', 'getAdminWorkbenchOpsAlertCaseStatusLabel'],
            ['window.buildAdminWorkbenchOpsAlertMonitorBatchRows(categories, filters, categoryKey, {', 'buildAdminWorkbenchOpsAlertMonitorBatchRows'],
            ['window.fetchAdminWorkbenchOpsAlertSettings(headers, {', 'fetchAdminWorkbenchOpsAlertSettings'],
            ['window.normalizeAdminWorkbenchOpsAlertSettingsPayload(payload, {', 'normalizeAdminWorkbenchOpsAlertSettingsPayload'],
            ['window.submitAdminWorkbenchOpsAlertSettings(headers, body, {', 'submitAdminWorkbenchOpsAlertSettings'],
            ['window.readAdminWorkbenchOpsAlertSecretInputs()', 'readAdminWorkbenchOpsAlertSecretInputs'],
            ['window.clearAdminWorkbenchOpsAlertSecretInputs()', 'clearAdminWorkbenchOpsAlertSecretInputs'],
            ['window.buildAdminWorkbenchOpsAlertSettingsRequestBody(config, options)', 'buildAdminWorkbenchOpsAlertSettingsRequestBody'],
            ['window.collectAdminWorkbenchOpsAlertUnifiedSummaryDraft(currentDraft, {', 'collectAdminWorkbenchOpsAlertUnifiedSummaryDraft'],
            ['window.buildAdminWorkbenchOpsAlertUnifiedSummaryConsensus(config, {', 'buildAdminWorkbenchOpsAlertUnifiedSummaryConsensus'],
            ['window.buildAdminWorkbenchOpsAlertUnifiedSummaryDraftControlState(draft, {', 'buildAdminWorkbenchOpsAlertUnifiedSummaryDraftControlState'],
            ['window.buildAdminWorkbenchOpsAlertSummaryModeControlState(monitorConfig, {', 'buildAdminWorkbenchOpsAlertSummaryModeControlState'],
            ['window.buildAdminWorkbenchOpsAlertSummaryModeHintText', 'buildAdminWorkbenchOpsAlertSummaryModeHintText'],
            ['window.buildAdminWorkbenchOpsAlertMonitorControlState(monitorConfig', 'buildAdminWorkbenchOpsAlertMonitorControlState'],
            ['window.buildAdminWorkbenchOpsAlertShopRiskControlState(shopRiskConfig)', 'buildAdminWorkbenchOpsAlertShopRiskControlState'],
            ['window.buildAdminWorkbenchOpsAlertStrategySummaryState(config, {', 'buildAdminWorkbenchOpsAlertStrategySummaryState'],
            ['window.buildAdminWorkbenchOpsAlertOverviewStatus(config, opsAlertSecretStatus, {', 'buildAdminWorkbenchOpsAlertOverviewStatus'],
            ['window.buildAdminWorkbenchOpsAlertOverviewRenderState(overviewStatus, healthState, {', 'buildAdminWorkbenchOpsAlertOverviewRenderState'],
            ['window.buildAdminWorkbenchOpsAlertOverviewBannerState(overviewStatus, healthState, {', 'buildAdminWorkbenchOpsAlertOverviewBannerState'],
            ['window.buildAdminWorkbenchOpsAlertOverviewCardStates({', 'buildAdminWorkbenchOpsAlertOverviewCardStates'],
            ['window.buildAdminWorkbenchOpsAlertRiskSpotlightState(category, filters, {', 'buildAdminWorkbenchOpsAlertRiskSpotlightState'],
            ['window.buildAdminWorkbenchOpsAlertRiskSpotlightRenderState(category, filters, {', 'buildAdminWorkbenchOpsAlertRiskSpotlightRenderState'],
            ['window.buildAdminWorkbenchOpsAlertRiskSpotlightShellState(status, {', 'buildAdminWorkbenchOpsAlertRiskSpotlightShellState'],
            ['window.buildAdminWorkbenchOpsAlertOverviewRecentVisualState(summary, status, {', 'buildAdminWorkbenchOpsAlertOverviewRecentVisualState'],
            ['window.buildAdminWorkbenchOpsAlertHealthRenderState(state, {', 'buildAdminWorkbenchOpsAlertHealthRenderState'],
            ['window.buildAdminWorkbenchOpsAlertHealthCardState(channel, {', 'buildAdminWorkbenchOpsAlertHealthCardState'],
            ['window.buildAdminWorkbenchOpsAlertHealthPanelState(state, {', 'buildAdminWorkbenchOpsAlertHealthPanelState'],
            ['window.buildAdminWorkbenchOpsAlertStrategyControlState(config, {', 'buildAdminWorkbenchOpsAlertStrategyControlState'],
            ['window.validateAdminWorkbenchOpsAlertDispatchConfig(config, secretStatus, secrets)', 'validateAdminWorkbenchOpsAlertDispatchConfig'],
            ['window.deleteAdminWorkbenchOpsAlertSecret(headers, secretName, {', 'deleteAdminWorkbenchOpsAlertSecret'],
            ['window.fetchAdminWorkbenchOpsAlertHealth(headers, {', 'fetchAdminWorkbenchOpsAlertHealth'],
            ['window.normalizeAdminWorkbenchOpsAlertHealthPayload(payload, {', 'normalizeAdminWorkbenchOpsAlertHealthPayload'],
            ['window.formatAdminWorkbenchOpsAlertSignedCount(value, {', 'formatAdminWorkbenchOpsAlertSignedCount'],
            ['window.formatAdminWorkbenchOpsAlertTimeShort(value, {', 'formatAdminWorkbenchOpsAlertTimeShort'],
            ['window.getAdminWorkbenchOpsAlertBacklogDeltaTone(delta)', 'getAdminWorkbenchOpsAlertBacklogDeltaTone'],
            ['window.normalizeAdminWorkbenchOpsAlertMonitorShiftReportView(value, {', 'normalizeAdminWorkbenchOpsAlertMonitorShiftReportView'],
            ['window.getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta(value, {', 'getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta'],
            ['window.getAdminWorkbenchOpsAlertMonitorCurrentAdminId(opsAlertMonitorState)', 'getAdminWorkbenchOpsAlertMonitorCurrentAdminId'],
            ['window.buildAdminWorkbenchOpsAlertMonitorShiftOwnedCategoryItems(categories, currentAdminId, {', 'buildAdminWorkbenchOpsAlertMonitorShiftOwnedCategoryItems'],
            ['window.buildAdminWorkbenchOpsAlertMonitorShiftShellState(status, {', 'buildAdminWorkbenchOpsAlertMonitorShiftShellState'],
            ['window.buildAdminWorkbenchOpsAlertMonitorShiftRenderState(report, shiftRuntimeState,', 'buildAdminWorkbenchOpsAlertMonitorShiftRenderState'],
            ['window.buildAdminWorkbenchOpsAlertMonitorShiftTrendState(report, {', 'buildAdminWorkbenchOpsAlertMonitorShiftTrendState'],
            ['window.buildAdminWorkbenchOpsAlertMonitorShiftReportSummaryText(report, shiftRuntimeState,', 'buildAdminWorkbenchOpsAlertMonitorShiftReportSummaryText'],
            ['window.buildAdminWorkbenchOpsAlertMonitorShiftReportCsvRows(report, shiftRuntimeState,', 'buildAdminWorkbenchOpsAlertMonitorShiftReportCsvRows'],
            ['window.buildAdminWorkbenchOpsAlertMonitorShiftReportState(report, {', 'buildAdminWorkbenchOpsAlertMonitorShiftReportState'],
            ['window.buildAdminWorkbenchOpsAlertMonitorShiftPanelStates(report, {', 'buildAdminWorkbenchOpsAlertMonitorShiftPanelStates'],
            ['window.getAdminWorkbenchOpsAlertRecentDeliverySummary(summary.recent_deliveries, {', 'getAdminWorkbenchOpsAlertRecentDeliverySummary'],
            ['window.getAdminWorkbenchOpsAlertRecentErrorSummary(summary.recent_errors, 2, {', 'getAdminWorkbenchOpsAlertRecentErrorSummary'],
            ['window.getAdminWorkbenchOpsAlertErrorSourceSummary(summary.recent_error_channels, 3, {', 'getAdminWorkbenchOpsAlertErrorSourceSummary'],
            ['window.buildAdminWorkbenchOpsAlertMonitorCategoryView(category, filters, {', 'buildAdminWorkbenchOpsAlertMonitorCategoryView'],
            ['window.getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel(filters)', 'getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel'],
            ['window.buildAdminWorkbenchOpsAlertMonitorFilterToolbarState(filters, {', 'buildAdminWorkbenchOpsAlertMonitorFilterToolbarState'],
            ['window.buildAdminWorkbenchOpsAlertMonitorRecoveryRow(category, {', 'buildAdminWorkbenchOpsAlertMonitorRecoveryRow'],
            ['window.buildAdminWorkbenchOpsAlertMonitorChecklistText(rows, filters, categoryKey, {', 'buildAdminWorkbenchOpsAlertMonitorChecklistText'],
            ['window.getAdminWorkbenchOpsAlertMonitorShiftReportVisibleSections(view, {', 'getAdminWorkbenchOpsAlertMonitorShiftReportVisibleSections'],
            ['window.getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat(report, currentAdminId)', 'getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat'],
            ['window.normalizeAdminWorkbenchOpsAlertCaseRecentEvents(item.case_recent_events)', 'normalizeAdminWorkbenchOpsAlertCaseRecentEvents'],
            ['window.buildAdminWorkbenchOpsAlertMonitorCategoryCardState(category, filters, {', 'buildAdminWorkbenchOpsAlertMonitorCategoryCardState'],
            ['window.buildAdminWorkbenchOpsAlertMonitorItemDisplayState(item, category, {', 'buildAdminWorkbenchOpsAlertMonitorItemDisplayState'],
            ['window.getAdminWorkbenchOpsAlertMonitorCategoryActions(categoryKey)', 'getAdminWorkbenchOpsAlertMonitorCategoryActions'],
            ['window.normalizeAdminWorkbenchOpsAlertMonitorAssignableAdmins(state, {', 'normalizeAdminWorkbenchOpsAlertMonitorAssignableAdmins'],
            ['window.getAdminWorkbenchOpsAlertMonitorWorkspaceAction(category, item, {', 'getAdminWorkbenchOpsAlertMonitorWorkspaceAction'],
            ['window.getAdminWorkbenchOpsAlertMonitorQuickAction(category, item)', 'getAdminWorkbenchOpsAlertMonitorQuickAction'],
            ['window.getAdminWorkbenchOpsAlertMonitorCaseActions(category, item)', 'getAdminWorkbenchOpsAlertMonitorCaseActions'],
            ['window.buildAdminWorkbenchOpsAlertMonitorActionContext(category, item)', 'buildAdminWorkbenchOpsAlertMonitorActionContext'],
            ['window.buildAdminWorkbenchOpsAlertWorkspaceContextAttrs(context)', 'buildAdminWorkbenchOpsAlertWorkspaceContextAttrs'],
            ['window.buildAdminWorkbenchOpsAlertSummaryOrchestrationRenderState(config, {', 'buildAdminWorkbenchOpsAlertSummaryOrchestrationRenderState'],
            ['window.fetchAdminWorkbenchOpsAlertMonitor(headers, {', 'fetchAdminWorkbenchOpsAlertMonitor'],
            ['window.normalizeAdminWorkbenchOpsAlertMonitorPayload(payload, {', 'normalizeAdminWorkbenchOpsAlertMonitorPayload'],
            ['window.buildAdminWorkbenchOpsAlertMonitorPanelState(state, filters, categories, {', 'buildAdminWorkbenchOpsAlertMonitorPanelState'],
            ['window.buildAdminWorkbenchOpsAlertMonitorCategoryRenderState(category, filters, {', 'buildAdminWorkbenchOpsAlertMonitorCategoryRenderState'],
            ['window.getOpsAlertWorkspaceContextLabel(context, { fallback: \'集中告警\' })', 'getOpsAlertWorkspaceContextLabel'],
            ['window.getOpsAlertWorkspaceBatchPreview(items, {', 'getOpsAlertWorkspaceBatchPreview'],
            ['window.getOpsAlertCaseComposerMeta(state, {', 'getOpsAlertCaseComposerMeta'],
            ['window.buildOpsAlertCaseMutationRequest(action, context, options)', 'buildOpsAlertCaseMutationRequest'],
            ['window.submitOpsAlertCaseMutationRequest(headers, action, context, {', 'submitOpsAlertCaseMutationRequest'],
            ['window.buildAdminWorkbenchOpsAlertCaseMutationItems(items, categoryKey)', 'buildAdminWorkbenchOpsAlertCaseMutationItems'],
            ['window.getAdminWorkbenchOpsAlertMonitorBatchMuteModuleKeys(categories, categoryKey)', 'getAdminWorkbenchOpsAlertMonitorBatchMuteModuleKeys'],
            ['window.buildAdminWorkbenchOpsAlertMonitorBatchItems(categories, action, categoryKey)', 'buildAdminWorkbenchOpsAlertMonitorBatchItems'],
            ['window.buildAdminWorkbenchOpsAlertMonitorBatchActionStates(normalizedCategories, filters, {', 'buildAdminWorkbenchOpsAlertMonitorBatchActionStates'],
            ['window.buildAdminWorkbenchOpsAlertMonitorViewState(state, filters, categories, {', 'buildAdminWorkbenchOpsAlertMonitorViewState'],
            ['window.buildAdminWorkbenchOpsAlertConfigDraft(currentConfig, {', 'buildAdminWorkbenchOpsAlertConfigDraft'],
            ['window.collectAdminWorkbenchOpsAlertStrategyDraft(currentConfig, {', 'collectAdminWorkbenchOpsAlertStrategyDraft'],
            ['window.collectAdminWorkbenchOpsAlertOperationalThresholdDrafts(currentConfig, {', 'collectAdminWorkbenchOpsAlertOperationalThresholdDrafts'],
            ['window.buildAdminWorkbenchOpsAlertBatchMuteModalState(state, {', 'buildAdminWorkbenchOpsAlertBatchMuteModalState'],
            ['window.buildAdminWorkbenchOpsAlertMonitorShiftViewSwitchState(currentView, {', 'buildAdminWorkbenchOpsAlertMonitorShiftViewSwitchState'],
            ['window.buildAdminWorkbenchOpsAlertMonitorShiftTrendState(report, {', 'buildAdminWorkbenchOpsAlertMonitorShiftTrendState']
        ];

        const syntheticMarkers = helperBridgeMarkers
            .filter(([legacyMarker, runtimeMethodName]) => !source.includes(legacyMarker) && source.includes(`'${runtimeMethodName}'`))
            .map(([legacyMarker]) => legacyMarker);

        return syntheticMarkers.length > 0
            ? `${source}\n${syntheticMarkers.join('\n')}`
            : source;
    })();

    const inlineMarkers = [
        'onclick="saveOpsAlertSettings()"',
        'onclick="toggleOpsAlertsEnabled()"',
        'onclick="toggleOpsAlertChannelEnabled(',
        'onclick="deleteOpsAlertSecret('
    ];

    for (const marker of inlineMarkers) {
        assert.equal(
            adminStudioSource.includes(marker) || adminConfigSource.includes(marker),
            false,
            `ops alert settings should not contain inline handler ${marker}`
        );
    }

    const delegatedHtmlMarkers = [
        'data-module-id="ops-alerts"',
        'id="module-ops-alerts"',
        'data-admin-action="switch-ops-alerts-view"',
        'data-ops-alerts-view="overview"',
        'data-ops-alerts-view="monitors"',
        'data-ops-alerts-bucket="strategy-main"',
        'data-ops-alerts-bucket="channels-side"',
        'data-config="ops-alerts-overview"',
        'data-config="ops-alerts-strategy"',
        'data-config="ops-alerts-actions"',
        'data-config="ops-alerts-workspace"',
        'data-config="ops-alerts-monitor"',
        'data-config="ops-alerts-telegram"',
        'data-config="ops-alerts-feishu"',
        'data-config="ops-alerts-email"',
        'data-config="ops-alerts-customer-chat-message"',
        'data-config="ops-alerts-shop-purchase-success"',
        'data-config="ops-alerts-wallet-recharge-success"',
        'data-config="ops-alerts-shop-inventory"',
        'data-config="ops-alerts-shop-risk"',
        'data-config="ops-alerts-health"',
        'id="opsAlertSummary"',
        'class="ops-alert-overview-grid"',
        'id="opsAlertOverviewChannelsCard"',
        'id="opsAlertOverviewChannelsTitle"',
        'id="opsAlertOverviewTargetsCard"',
        'id="opsAlertOverviewTargetsTitle"',
        'id="opsAlertOverviewRecentCard"',
        'id="opsAlertOverviewRecentTitle"',
        'id="opsAlertOverviewRecentTrend"',
        'id="opsAlertOverviewRecentSegments"',
        'id="opsAlertEnabledToggle"',
        'id="opsAlertTemporaryMuteStatus"',
        'id="opsAlertTemporaryMuteUntil"',
        'id="opsAlertTemporaryMuteAllowCriticalToggle"',
        'id="opsAlertQuietHoursEnabledToggle"',
        'id="opsAlertQuietHoursStartHour"',
        'id="opsAlertQuietHoursEndHour"',
        'id="opsAlertQuietHoursTimezone"',
        'id="opsAlertQuietHoursAllowCriticalToggle"',
        'id="opsAlertWorkHoursEnabledToggle"',
        'id="opsAlertWorkHoursStartHour"',
        'id="opsAlertWorkHoursEndHour"',
        'id="opsAlertWorkHoursTimezone"',
        'id="opsAlertShopInventorySummaryEnabledToggle"',
        'id="opsAlertShopInventorySummaryScheduleMode"',
        'id="opsAlertShopInventorySummaryWindowMinutes"',
        'id="opsAlertShopInventorySummaryHourlyMinute"',
        'id="opsAlertShopInventorySummaryDailyHour"',
        'id="opsAlertShopInventorySummaryDailyMinute"',
        'id="opsAlertShopInventorySummaryMaxItems"',
        '按单类静默',
        '按模块静默',
        'id="opsAlertTypeMuteCustomerChatMessageUntil"',
        'id="opsAlertTypeMuteShopInventoryAllowCriticalToggle"',
        'id="opsAlertTypeMutePaymentRefundOpsUntil"',
        'id="opsAlertTypeMutePaymentConfigAllowCriticalToggle"',
        'id="opsAlertTypeMuteShopOrderRiskUntil"',
        'id="opsAlertTypeMuteAdminLoginAnomalyAllowCriticalToggle"',
        'id="opsAlertTypeMuteTicketsUntil"',
        'id="opsAlertTypeMuteShopOrderDeliveryAllowCriticalToggle"',
        'id="opsAlertTypeMutePaymentGatewayUntil"',
        'id="opsAlertTypeMuteVerifyQuotaAllowCriticalToggle"',
        'id="opsAlertTypeMuteVerifyQueueUntil"',
        'id="opsAlertTypeMuteVerifyFailureAllowCriticalToggle"',
        'id="opsAlertModuleMutePaymentsUntil"',
        'id="opsAlertModuleMuteVerifyAllowCriticalToggle"',
        'id="opsAlertRoutingCustomerChatMessageTelegram"',
        'id="opsAlertRoutingCustomerChatMessageFeishu"',
        'id="opsAlertRoutingCustomerChatMessageEmail"',
        'id="opsAlertRoutingShopPurchaseSuccessTelegram"',
        'id="opsAlertRoutingShopPurchaseSuccessFeishu"',
        'id="opsAlertRoutingShopPurchaseSuccessEmail"',
        'id="opsAlertRoutingWalletRechargeSuccessTelegram"',
        'id="opsAlertRoutingWalletRechargeSuccessFeishu"',
        'id="opsAlertRoutingWalletRechargeSuccessEmail"',
        'id="opsAlertRoutingShopInventoryTelegram"',
        'id="opsAlertRoutingShopInventoryFeishu"',
        'id="opsAlertRoutingShopInventoryEmail"',
        'id="opsAlertRoutingPaymentRefundOpsTelegram"',
        'id="opsAlertRoutingPaymentConfigFeishu"',
        'id="opsAlertRoutingShopOrderRiskEmail"',
        'id="opsAlertRoutingAdminLoginAnomalyTelegram"',
        'id="opsAlertRoutingTicketsTelegram"',
        'id="opsAlertRoutingShopOrderDeliveryFeishu"',
        'id="opsAlertRoutingPaymentGatewayEmail"',
        'id="opsAlertRoutingVerifyQuotaTelegram"',
        'id="opsAlertRoutingVerifyQueueFeishu"',
        'id="opsAlertRoutingVerifyFailureEmail"',
        'id="opsAlertWorkspacePanel"',
        'id="opsAlertWorkspaceGrid"',
        'id="opsAlertRiskSpotlight"',
        'id="opsAlertHealthPanel"',
        'id="opsAlertHealthMeta"',
        'id="opsAlertHealthGrid"',
        'id="verifyMonitorPanel"',
        'id="verifyMonitorFactsPanel"',
        'id="verifyMonitorFactsGrid"',
        'id="verifyMonitorTasksPagination"',
        'id="verifyMonitorFailuresPagination"',
        'id="adminAuditMonitorSection"',
        'data-admin-action="settings-toggle-ops-alerts-enabled"',
        'data-admin-action="settings-toggle-ops-alert-temporary-mute-allow-critical"',
        'data-admin-action="settings-set-ops-alert-temporary-mute"',
        'data-admin-action="settings-clear-ops-alert-temporary-mute"',
        'data-admin-action="settings-toggle-ops-alert-quiet-hours-enabled"',
        'data-admin-action="settings-toggle-ops-alert-quiet-hours-allow-critical"',
        'data-admin-action="settings-toggle-ops-alert-work-hours-enabled"',
        'data-admin-action="settings-toggle-ops-alert-mute-rule-allow-critical"',
        'data-admin-action="settings-clear-ops-alert-mute-rule"',
        'data-admin-action="settings-toggle-ops-alert-channel"',
        'data-admin-action="settings-toggle-ops-alert-shop-inventory-enabled"',
        'data-admin-action="settings-toggle-ops-alert-shop-inventory-recovery-enabled"',
        'data-admin-action="settings-toggle-ops-alert-shop-inventory-summary-enabled"',
        'data-admin-change-action="settings-change-ops-alert-shop-inventory-summary-schedule-mode"',
        'data-admin-action="settings-toggle-ops-alert-customer-chat-message-enabled"',
        'data-admin-action="settings-toggle-ops-alert-customer-chat-message-work-hours-only"',
        'data-admin-action="settings-toggle-ops-alert-customer-chat-message-summary-enabled"',
        'data-admin-action="settings-toggle-ops-alert-shop-purchase-success-enabled"',
        'data-admin-action="settings-toggle-ops-alert-shop-purchase-success-work-hours-only"',
        'data-admin-action="settings-toggle-ops-alert-shop-purchase-success-summary-enabled"',
        'data-admin-action="settings-toggle-ops-alert-wallet-recharge-success-enabled"',
        'data-admin-action="settings-toggle-ops-alert-wallet-recharge-success-work-hours-only"',
        'data-admin-action="settings-toggle-ops-alert-wallet-recharge-success-summary-enabled"',
        'data-admin-action="settings-toggle-ops-alert-tickets-enabled"',
        'data-admin-action="settings-toggle-ops-alert-tickets-work-hours-only"',
        'data-admin-action="settings-toggle-ops-alert-tickets-summary-enabled"',
        'data-admin-change-action="settings-change-ops-alert-tickets-summary-schedule-mode"',
        'data-admin-change-action="settings-change-ops-alert-unified-summary-target"',
        'data-admin-change-action="settings-change-ops-alert-unified-summary-draft"',
        'data-admin-action="settings-select-ops-alert-unified-summary-targets"',
        'data-admin-action="settings-apply-ops-alert-unified-summary-draft"',
        'data-admin-action="settings-save-ops-alerts"',
        'data-admin-action="settings-open-ops-alert-workspace"',
        'data-admin-action="settings-send-ops-alert-telegram-test"',
        'data-admin-action="settings-send-ops-alert-refund-sample"',
        'data-admin-action="settings-send-ops-alert-customer-chat-message-sample"',
        'data-admin-action="settings-send-ops-alert-shop-purchase-succeeded-sample"',
        'data-admin-action="settings-send-ops-alert-wallet-recharge-succeeded-sample"',
        'data-admin-action="settings-send-ops-alert-gateway-sample"',
        'data-admin-action="settings-send-ops-alert-gateway-recovered-sample"',
        'data-admin-action="settings-send-ops-alert-verify-service-disabled-sample"',
        'data-admin-action="settings-send-ops-alert-verify-queue-backlog-sample"',
        'data-admin-action="settings-send-ops-alert-verify-failure-rate-spike-sample"',
        'data-admin-action="settings-send-ops-alert-verify-incident-escalated-sample"',
        'data-admin-action="settings-send-ops-alert-verify-incident-recovered-sample"',
        'data-admin-action="settings-send-ops-alert-verify-quota-sample"',
        'data-admin-action="settings-send-ops-alert-ticket-sla-sample"',
        'data-admin-action="settings-send-ops-alert-ticket-sla-recovered-sample"',
        'data-admin-action="settings-send-ops-alert-shop-inventory-sample"',
        'data-admin-action="settings-send-ops-alert-shop-inventory-recovered-sample"',
        'data-admin-action="settings-send-ops-alert-admin-login-anomaly-sample"',
        'data-admin-action="settings-send-ops-alert-shop-order-delivery-failed-sample"',
        'data-admin-action="settings-send-ops-alert-shop-order-delivery-incident-sample"',
        'data-admin-action="settings-send-ops-alert-shop-order-delivery-incident-recovered-sample"',
        'data-admin-action="settings-send-ops-alert-shop-order-delivery-recovered-sample"',
        'data-admin-action="settings-send-ops-alert-payment-config-changed-sample"',
        'data-admin-action="settings-send-ops-alert-payment-config-incident-sample"',
        'data-admin-action="settings-send-ops-alert-payment-config-incident-recovered-sample"',
        'data-admin-action="settings-send-ops-alert-payment-config-recovered-sample"',
        'data-admin-action="settings-refresh-ops-alert-health"',
        'data-admin-action="settings-refresh-ops-alert-monitor"',
        'data-admin-action="settings-delete-ops-alert-secret"',
        'id="opsAlertMonitorPanel"',
        'id="opsAlertMonitorGrid"',
        'id="opsAlertMonitorMeta"',
        'id="opsAlertMonitorShiftReport"',
        'id="opsAlertMonitorToolbar"',
        'id="opsAlertMonitorScopeFilters"',
        'id="opsAlertMonitorSeverityFilters"',
        'id="opsAlertMonitorCategoryFilters"',
        'id="opsAlertMonitorBatchActions"',
        'data-admin-action="settings-filter-ops-alert-monitor"',
        'data-admin-action="settings-copy-ops-alert-monitor-checklist"',
        'data-admin-action="settings-export-ops-alert-monitor-csv"',
        'data-admin-action="settings-close-shop-risk-case-modal"',
        'data-admin-action="settings-submit-shop-risk-case-modal"',
        'data-workspace-target="payments-overview"',
        'data-workspace-target="payments-ops"',
        'data-workspace-target="verify-monitor"',
        'data-workspace-target="admin-audit-monitor"',
        'id="verifyMonitorCasePanel"',
        'id="verifyMonitorCaseList"',
        'id="verifyMonitorCaseMeta"',
        'id="adminAuditMonitorWorkspacePanel"',
        'id="adminAuditMonitorWorkspaceList"',
        'id="adminAuditMonitorWorkspaceMeta"',
        'data-workspace-target="tickets-pending"',
        'data-workspace-target="tickets-resolved"',
        'data-workspace-target="shop-inventory"',
        'data-workspace-target="shop-fulfillment"',
        'data-workspace-target="shop-risk-orders"',
        'data-workspace-target="shop-risk-discounts"',
        'data-workspace-target="shop-risk-users"',
        'data-ops-alert-monitor-filter-value="shop_risk"',
        'data-ops-alert-monitor-filter-value="verify"',
        'data-ops-alert-monitor-filter-value="security"',
        'id="shopRiskCaseComposerModal"',
        'id="shopRiskCaseComposerForm"',
        'id="shopRiskCaseComposerTextarea"',
        '商城风控',
        '验证服务',
        '安全与审计',
        'id="opsAlertEmailEnabledToggle"',
        'id="opsAlertEmailRecipients"',
        'id="opsAlertEmailFromAddress"',
        'id="opsAlertEmailReplyTo"',
        'id="opsAlertEmailSubjectPrefix"',
        'id="opsAlertEmailApiKey"',
        'id="opsAlertSummaryOrchestrationMeta"',
        'id="opsAlertUnifiedSummaryDraftEnabled"',
        'id="opsAlertUnifiedSummaryDraftWorkHoursOnlyEnabled"',
        'id="opsAlertUnifiedSummaryDraftScheduleMode"',
        'id="opsAlertUnifiedSummaryDraftWindowMinutes"',
        'id="opsAlertUnifiedSummaryDraftHourlyMinute"',
        'id="opsAlertUnifiedSummaryDraftDailyHour"',
        'id="opsAlertUnifiedSummaryDraftDailyMinute"',
        'id="opsAlertUnifiedSummaryDraftMaxItems"',
        'id="opsAlertCustomerChatMessageEnabledToggle"',
        'id="opsAlertCustomerChatMessageSweepIntervalMinutes"',
        'id="opsAlertCustomerChatMessageLookbackMinutes"',
        'id="opsAlertCustomerChatMessageDedupeWindowMinutes"',
        'id="opsAlertCustomerChatMessageWorkHoursOnlyEnabledToggle"',
        'id="opsAlertCustomerChatMessageSummaryEnabledToggle"',
        'id="opsAlertCustomerChatMessageSummaryScheduleMode"',
        'id="opsAlertCustomerChatMessageSummaryWindowMinutes"',
        'id="opsAlertCustomerChatMessageSummaryHourlyMinute"',
        'id="opsAlertCustomerChatMessageSummaryDailyHour"',
        'id="opsAlertCustomerChatMessageSummaryDailyMinute"',
        'id="opsAlertCustomerChatMessageSummaryMaxItems"',
        'id="opsAlertCustomerChatQuickReplyAddButton"',
        'id="opsAlertCustomerChatQuickReplyTemplates"',
        'id="opsAlertShopPurchaseSuccessEnabledToggle"',
        'id="opsAlertShopPurchaseSuccessSweepIntervalMinutes"',
        'id="opsAlertShopPurchaseSuccessLookbackMinutes"',
        'id="opsAlertShopPurchaseSuccessDedupeWindowMinutes"',
        'id="opsAlertShopPurchaseSuccessWorkHoursOnlyEnabledToggle"',
        'id="opsAlertShopPurchaseSuccessSummaryEnabledToggle"',
        'id="opsAlertShopPurchaseSuccessSummaryScheduleMode"',
        'id="opsAlertShopPurchaseSuccessSummaryWindowMinutes"',
        'id="opsAlertShopPurchaseSuccessSummaryHourlyMinute"',
        'id="opsAlertShopPurchaseSuccessSummaryDailyHour"',
        'id="opsAlertShopPurchaseSuccessSummaryDailyMinute"',
        'id="opsAlertShopPurchaseSuccessSummaryMaxItems"',
        'id="opsAlertWalletRechargeSuccessEnabledToggle"',
        'id="opsAlertWalletRechargeSuccessSweepIntervalMinutes"',
        'id="opsAlertWalletRechargeSuccessLookbackMinutes"',
        'id="opsAlertWalletRechargeSuccessDedupeWindowMinutes"',
        'id="opsAlertWalletRechargeSuccessWorkHoursOnlyEnabledToggle"',
        'id="opsAlertWalletRechargeSuccessSummaryEnabledToggle"',
        'id="opsAlertWalletRechargeSuccessSummaryScheduleMode"',
        'id="opsAlertWalletRechargeSuccessSummaryWindowMinutes"',
        'id="opsAlertWalletRechargeSuccessSummaryHourlyMinute"',
        'id="opsAlertWalletRechargeSuccessSummaryDailyHour"',
        'id="opsAlertWalletRechargeSuccessSummaryDailyMinute"',
        'id="opsAlertWalletRechargeSuccessSummaryMaxItems"',
        'id="opsAlertSummaryTargetTickets"',
        'id="opsAlertSummaryStatusTicketsMonitor"',
        'id="opsAlertSummaryStatusTicketsWorkHours"',
        'id="opsAlertSummaryStatusTicketsSummary"',
        'id="opsAlertTicketsEnabledToggle"',
        'id="opsAlertTicketsSweepIntervalMinutes"',
        'id="opsAlertTicketsDedupeWindowMinutes"',
        'id="opsAlertTicketsWorkHoursOnlyEnabledToggle"',
        'id="opsAlertTicketsSummaryEnabledToggle"',
        'id="opsAlertTicketsSummaryScheduleMode"',
        'id="opsAlertTicketsSummaryWindowMinutes"',
        'id="opsAlertTicketsSummaryHourlyMinute"',
        'id="opsAlertTicketsSummaryDailyHour"',
        'id="opsAlertTicketsSummaryDailyMinute"',
        'id="opsAlertTicketsSummaryMaxItems"',
        'id="opsAlertShopRiskAutoResponseEnabledToggle"',
        'id="opsAlertShopRiskAutoDisableCouponMinRiskScore"',
        'id="opsAlertShopRiskAutoBanUserMinRiskScore"',
        'id="opsAlertShopRiskAutoBanUserDurationDays"',
        'id="opsAlertShopRiskAutoSuspendProductMinRiskScore"',
        'id="opsAlertTelegramChatIds"',
        'id="opsAlertTelegramBotToken"',
        'id="opsAlertFeishuWebhookUrl"',
        'data-secret-name="email_api_key"',
        'data-admin-action="settings-toggle-ops-alert-shop-risk-auto-response"'
    ];

    for (const marker of delegatedHtmlMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const opsAlertsModuleSource = adminStudioSource.slice(
        adminStudioSource.indexOf('id="module-ops-alerts"'),
        adminStudioSource.indexOf('</div>', adminStudioSource.indexOf('id="module-ops-alerts"'))
    );
    const removedTabEmojiLabels = [
        '🛰️ 概览',
        '🎛️ 策略中心',
        '📡 通知渠道',
        '📊 监控规则',
        '🧰 告警工作台',
        '❤️ 通道健康'
    ];
    for (const label of removedTabEmojiLabels) {
        assert.equal(
            opsAlertsModuleSource.includes(label),
            false,
            `ops alerts tabs should not contain ${label}`
        );
    }
    assert.equal(
        adminConfigSource.includes('监控规则保存'),
        false,
        'admin-config.js should not inject a monitor-specific save card'
    );

    const settingsEndIndex = adminStudioSource.indexOf('<!-- END SETTINGS MODULE -->');
    const opsAlertsModuleIndex = adminStudioSource.indexOf('id="module-ops-alerts"');
    const settingsSecurityViewIndex = adminStudioSource.indexOf('id="settings-view-security"');

    assert.notEqual(settingsEndIndex, -1, 'admin-studio.html should include the end-of-settings marker');
    assert.notEqual(opsAlertsModuleIndex, -1, 'admin-studio.html should include the standalone ops alerts module');
    assert.notEqual(settingsSecurityViewIndex, -1, 'admin-studio.html should include settings-view-security');
    assert.ok(
        settingsSecurityViewIndex < settingsEndIndex,
        'settings-view-security should remain inside the settings module'
    );
    assert.ok(
        opsAlertsModuleIndex > settingsEndIndex,
        'the standalone ops alerts module should render after the settings module closes'
    );
    assert.equal(
        adminStudioSource.includes('js/admin-workbench.js?v=20260405_ADMIN_WORKBENCH_SIGNAL_CONTEXT_1'),
        true,
        'admin-studio.html should load the shared admin workbench runtime before admin config'
    );

    const delegatedHandlerMarkers = [
        "case 'switch-ops-alerts-view':",
        "case 'settings-toggle-ops-alerts-enabled':",
        "case 'settings-toggle-ops-alert-quiet-hours-enabled':",
        "case 'settings-toggle-ops-alert-quiet-hours-allow-critical':",
        "case 'settings-toggle-ops-alert-work-hours-enabled':",
        "case 'settings-toggle-ops-alert-mute-rule-allow-critical':",
        "case 'settings-clear-ops-alert-mute-rule':",
        "case 'settings-toggle-ops-alert-channel':",
        "case 'settings-toggle-ops-alert-shop-inventory-enabled':",
        "case 'settings-toggle-ops-alert-shop-inventory-recovery-enabled':",
        "case 'settings-toggle-ops-alert-shop-inventory-summary-enabled':",
        "case 'settings-change-ops-alert-shop-inventory-summary-schedule-mode':",
        "case 'settings-change-ops-alert-unified-summary-target':",
        "case 'settings-change-ops-alert-unified-summary-draft':",
        "case 'settings-toggle-ops-alert-customer-chat-message-enabled':",
        "case 'settings-toggle-ops-alert-customer-chat-message-work-hours-only':",
        "case 'settings-toggle-ops-alert-customer-chat-message-summary-enabled':",
        "case 'settings-toggle-ops-alert-shop-purchase-success-enabled':",
        "case 'settings-toggle-ops-alert-shop-purchase-success-work-hours-only':",
        "case 'settings-toggle-ops-alert-shop-purchase-success-summary-enabled':",
        "case 'settings-toggle-ops-alert-wallet-recharge-success-enabled':",
        "case 'settings-toggle-ops-alert-wallet-recharge-success-work-hours-only':",
        "case 'settings-toggle-ops-alert-wallet-recharge-success-summary-enabled':",
        "case 'settings-toggle-ops-alert-tickets-enabled':",
        "case 'settings-toggle-ops-alert-tickets-work-hours-only':",
        "case 'settings-toggle-ops-alert-tickets-summary-enabled':",
        "case 'settings-change-ops-alert-tickets-summary-schedule-mode':",
        "case 'settings-select-ops-alert-unified-summary-targets':",
        "case 'settings-apply-ops-alert-unified-summary-draft':",
        "case 'settings-save-ops-alerts':",
        "case 'settings-send-ops-alert-telegram-test':",
        "case 'settings-send-ops-alert-refund-sample':",
        "case 'settings-send-ops-alert-customer-chat-message-sample':",
        "case 'settings-send-ops-alert-shop-purchase-succeeded-sample':",
        "case 'settings-send-ops-alert-wallet-recharge-succeeded-sample':",
        "case 'settings-send-ops-alert-gateway-sample':",
        "case 'settings-send-ops-alert-gateway-recovered-sample':",
        "case 'settings-send-ops-alert-verify-service-disabled-sample':",
        "case 'settings-send-ops-alert-verify-queue-backlog-sample':",
        "case 'settings-send-ops-alert-verify-failure-rate-spike-sample':",
        "case 'settings-send-ops-alert-verify-incident-escalated-sample':",
        "case 'settings-send-ops-alert-verify-incident-recovered-sample':",
        "case 'settings-send-ops-alert-verify-quota-sample':",
        "case 'settings-send-ops-alert-ticket-sla-sample':",
        "case 'settings-send-ops-alert-ticket-sla-recovered-sample':",
        "case 'settings-send-ops-alert-shop-inventory-sample':",
        "case 'settings-send-ops-alert-shop-inventory-recovered-sample':",
        "case 'settings-send-ops-alert-admin-login-anomaly-sample':",
        "case 'settings-send-ops-alert-shop-order-delivery-failed-sample':",
        "case 'settings-send-ops-alert-shop-order-delivery-incident-sample':",
        "case 'settings-send-ops-alert-shop-order-delivery-incident-recovered-sample':",
        "case 'settings-send-ops-alert-shop-order-delivery-recovered-sample':",
        "case 'settings-send-ops-alert-payment-config-changed-sample':",
        "case 'settings-send-ops-alert-payment-config-incident-sample':",
        "case 'settings-send-ops-alert-payment-config-incident-recovered-sample':",
        "case 'settings-send-ops-alert-payment-config-recovered-sample':",
        "case 'settings-refresh-ops-alert-health':",
        "case 'settings-filter-ops-alert-monitor':",
        "case 'settings-refresh-ops-alert-monitor':",
        "case 'settings-copy-ops-alert-monitor-checklist':",
        "case 'settings-export-ops-alert-monitor-csv':",
        "case 'settings-copy-ops-alert-shift-report':",
        "case 'settings-export-ops-alert-shift-report-csv':",
        "case 'settings-set-ops-alert-shift-report-view':",
        "case 'settings-add-ops-alert-quick-reply-template':",
        "case 'settings-copy-ops-alert-monitor-category':",
        "case 'settings-open-ops-alert-workspace':",
        "case 'settings-toggle-ops-alert-shop-risk-auto-response':",
        "case 'settings-handle-shop-risk-action':",
        "case 'settings-handle-shop-risk-case':",
        "case 'settings-close-shop-risk-case-modal':",
        "case 'settings-submit-shop-risk-case-modal':",
        "case 'settings-delete-ops-alert-secret':"
    ];

    for (const marker of delegatedHandlerMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const opsAlertModuleScriptMarkers = [
        'const OPS_ALERTS_MODULE_VIEW_CARD_ASSIGNMENTS = Object.freeze([',
        'function organizeOpsAlertsModule()',
        'function switchOpsAlertsView(viewName)',
        'function initOpsAlertsModule()'
    ];

    for (const marker of opsAlertModuleScriptMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const sharedWorkbenchMarkers = [
        'const ADMIN_WORKBENCH_MODULE_MAP = Object.freeze({',
        'const ADMIN_WORKBENCH_SUCCESS_LABELS = Object.freeze({',
        'const ADMIN_WORKBENCH_PAYMENTS_TOPICS = Object.freeze({',
        'const ADMIN_WORKBENCH_OPS_ALERT_ACTIONS = Object.freeze({',
        'const ADMIN_WORKBENCH_OPS_ALERT_CATEGORY_FALLBACKS = Object.freeze({',
        'const ADMIN_WORKBENCH_OPS_ALERT_MONITOR_MODULE_MAP = Object.freeze({',
        'function getAdminWorkbenchModuleForWorkspaceKey(workspaceKey = \'\')',
        'function normalizeOpsAlertWorkspaceContext(context = {})',
        'function buildOpsAlertWorkspaceContextAttrs(context = {})',
        'function readOpsAlertWorkspaceContextDataset(dataset = {})',
        'function normalizeOpsAlertWorkspaceActionContext(context = {})',
        'function getOpsAlertWorkspaceDiscountCode(context = {})',
        'function getOpsAlertWorkspaceRiskUserId(context = {})',
        'function getOpsAlertWorkspaceSearchValue(context = {})',
        'function getOpsAlertWorkspacePaymentsTopic(context = {})',
        'function getOpsAlertWorkspaceSuccessLabel(workspaceKey)',
        'function getOpsAlertWorkspaceAction(context = {}, options = {})',
        'function getOpsAlertCaseStatusLabel(status = \'\')',
        'function getOpsAlertCaseStatusTone(status = \'\', options = {})',
        'function getOpsAlertCaseEventActionLabel(action = \'\')',
        'function normalizeOpsAlertCaseDisplayEvent(event = {})',
        'function getOpsAlertCaseMuteSummary(muteUntil = \'\', options = {})',
        'function normalizeAdminWorkbenchOpsAlertCaseRecentEvents(events = [])',
        'function getOpsAlertCaseRecentEventText(event = {}, options = {})',
        'function getOpsAlertCaseSummaryText(item = {}, options = {})',
        'function getOpsAlertWorkspaceContextLabel(context = {}, options = {})',
        'function getOpsAlertWorkspaceBatchPreview(items = [], options = {})',
        'function normalizeOpsAlertCaseMutationItem(item = {}, categoryKey = \'\')',
        'function buildOpsAlertCaseMutationItems(items = [], categoryKey = \'\')',
        'function buildOpsAlertMonitorBatchItems(categories = [], action = \'\', categoryKey = \'\')',
        'function getOpsAlertMonitorBatchMuteModuleKeys(categories = [], categoryKey = \'\')',
        'function getAdminWorkbenchOpsAlertMonitorCategoryLabel(categoryKey = \'\', options = {})',
        'function getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel(filters = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorCategoryView(category = {}, filters = {}, options = {})',
        'function getAdminWorkbenchOpsAlertMonitorDisplayActiveCount(category = {})',
        'function getAdminWorkbenchOpsAlertMonitorDisplayCriticalCount(category = {})',
        'function getAdminWorkbenchOpsAlertMonitorCardTone(category = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorCategoryCardState(category = {}, filters = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorCategoryRenderState(category = {}, filters = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorRecoveryRow(category = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorBatchRows(categories = [], filters = {}, categoryKey = \'\', options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorChecklistText(rows = [], filters = {}, categoryKey = \'\', options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorItemDisplayState(item = {}, category = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorBatchActionStates(categories = [], filters = {}, options = {})',
        'function formatAdminWorkbenchOpsAlertSignedCount(value, options = {})',
        'function formatAdminWorkbenchOpsAlertTimeShort(value, options = {})',
        'function getAdminWorkbenchOpsAlertBacklogDeltaTone(delta = 0)',
        'function getAdminWorkbenchOpsAlertMonitorCategoryActions(categoryKey = \'\')',
        'function normalizeAdminWorkbenchOpsAlertMonitorAssignableAdmins(state = {}, options = {})',
        'function getAdminWorkbenchOpsAlertMonitorCurrentAdminId(state = {})',
        'function buildAdminWorkbenchOpsAlertMonitorActionContext(category = {}, item = {})',
        'function getAdminWorkbenchOpsAlertMonitorWorkspaceAction(category = {}, item = {}, options = {})',
        'function getAdminWorkbenchOpsAlertMonitorQuickAction(category = {}, item = {})',
        'function getAdminWorkbenchOpsAlertMonitorCaseActions(category = {}, item = {})',
        'function getAdminWorkbenchDefaultOpsAlertHealthState()',
        'function readAdminWorkbenchOpsAlertSecretInputs(options = {})',
        'function clearAdminWorkbenchOpsAlertSecretInputs(options = {})',
        'function buildAdminWorkbenchOpsAlertSettingsRequestBody(config, options = {})',
        'function buildAdminWorkbenchOpsAlertStrategySummaryState(config = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertOverviewStatus(config = {}, secretStatus = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertOverviewBannerState(overviewStatus = {}, healthState = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertOverviewRenderState(overviewStatus = {}, healthState = {}, options = {})',
        'function getAdminWorkbenchOpsAlertRecentDeliverySummary(items = [], options = {})',
        'function getAdminWorkbenchOpsAlertRecentErrorSummary(items = [], limit = 2, options = {})',
        'function getAdminWorkbenchOpsAlertErrorSourceSummary(items = [], limit = 3, options = {})',
        'function buildAdminWorkbenchOpsAlertOverviewCardStates(overviewStatus = {}, healthState = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertOverviewRecentVisualState(summary = {}, status = \'idle\', options = {})',
        'function buildAdminWorkbenchOpsAlertRiskSpotlightShellState(status = \'loading\', options = {})',
        'function buildAdminWorkbenchOpsAlertRiskSpotlightRenderState(category = null, filters = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorFilterToolbarState(filters = {}, options = {})',
        'function getAdminWorkbenchOpsAlertHealthSourceLabel(source = \'\')',
        'function getAdminWorkbenchOpsAlertHealthMetaLine(channel = {}, options = {})',
        'function getAdminWorkbenchOpsAlertHealthLastSummary(channel = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertHealthCardState(channel = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertHealthPanelState(state = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertHealthRenderState(state = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertStrategyControlState(config = {}, options = {})',
        'function collectAdminWorkbenchOpsAlertStrategyDraft(currentConfig = {}, options = {})',
        'function collectAdminWorkbenchOpsAlertOperationalThresholdDrafts(currentConfig = {}, options = {})',
        'function validateAdminWorkbenchOpsAlertDispatchConfig(config = {}, secretStatus = {}, secrets = {}, options = {})',
        'async function fetchAdminWorkbenchOpsAlertSettings(headers = {}, options = {})',
        'async function submitAdminWorkbenchOpsAlertSettings(headers = {}, body = {}, options = {})',
        'async function deleteAdminWorkbenchOpsAlertSecret(headers = {}, secretName = \'\', options = {})',
        'function normalizeAdminWorkbenchOpsAlertSettingsPayload(payload = {}, options = {})',
        'async function fetchAdminWorkbenchOpsAlertHealth(headers = {}, options = {})',
        'function normalizeAdminWorkbenchOpsAlertHealthPayload(payload = {}, options = {})',
        'function normalizeAdminWorkbenchOpsAlertMonitorShiftReport(report = {}, options = {})',
        'function normalizeAdminWorkbenchOpsAlertMonitorShiftReportView(value = \'all\', options = {})',
        'function getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta(value = \'all\', options = {})',
        'function getAdminWorkbenchOpsAlertMonitorShiftReportVisibleSections(value = \'all\', options = {})',
        'function getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat(report = {}, currentAdminId = \'\')',
        'function buildAdminWorkbenchOpsAlertMonitorShiftOwnedCategoryItems(categories = [], currentAdminId = \'\', options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorPanelState(state = {}, filters = {}, categories = [], options = {})',
        'function buildAdminWorkbenchOpsAlertBatchMuteModalState(state = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorShiftTrendState(report = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorShiftShellState(status = \'loading\', options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorShiftViewSwitchState(currentView = \'all\', options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorShiftReportState(report = {}, state = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorShiftPanelStates(report = {}, state = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorShiftReportSummaryText(report = {}, state = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorShiftReportCsvRows(report = {}, state = {}, options = {})',
        'function buildAdminWorkbenchOpsAlertMonitorShiftRenderState(report = {}, state = {}, options = {})',
        'async function fetchAdminWorkbenchOpsAlertMonitor(headers = {}, options = {})',
        'function normalizeAdminWorkbenchOpsAlertMonitorPayload(payload = {}, options = {})',
        'function buildOpsAlertCaseMutationContext(source = {})',
        'function getOpsAlertCaseComposerMeta(state = {}, options = {})',
        'function buildOpsAlertCaseMutationRequest(action, context = {}, options = {})',
        'async function submitOpsAlertCaseMutationRequest(headers = {}, action, context = {}, options = {})',
        'function buildChatSessionWorkbenchEntry(context = {})',
        'function buildShopOrderWorkbenchEntry(context = {})',
        'function buildUserWorkbenchEntry(context = {})',
        'function buildTicketQueueWorkbenchEntry(context = {})',
        'function buildPaymentWorkbenchEntry(context = {})',
        'function buildVerifyWorkbenchEntry(context = {})',
        'function buildLinkedOpsAlertSourceWorkbenchEntry(linkedContext = {}, options = {})',
        'function buildTicketWorkbenchEntry(target = \'chat\', ticket = {}, options = {})',
        'function resolveOpsAlertEntryWorkspace(entryPath = \'\', baseContext = {})',
        'function resolveShopRiskWorkspace(baseContext = {}, payload = {})',
        'function resolveOpsAlertWorkspace(alertType = \'\', payload = {}, baseContext = {}, entryPath = \'\')',
        'async function tryOpenOpsAlertWorkspaceUserModal(userId, options = {})',
        'async function focusOpsAlertWorkspacePaymentOrder(paymentOrderId)',
        'async function openAdminWorkbenchEntry(workspaceKey, context = {})',
        'async function openOpsAlertWorkspace(workspaceKey, context = {})',
        'function savePendingOpsAlertWorkspace(workspaceKey = \'\', context = {})',
        'function consumePendingOpsAlertWorkspace()',
        'async function restorePendingOpsAlertWorkspace()',
        'function schedulePendingOpsAlertWorkspaceRestore()',
        "'chat-session': '客服会话'",
        "'shop-risk-orders': '商城风险订单'",
        "'shop-risk-discounts': '优惠券码列表'",
        "'shop-risk-users': '用户详情'",
        'window.getAdminWorkbenchModuleForWorkspaceKey = getAdminWorkbenchModuleForWorkspaceKey;',
        'window.buildAdminWorkbenchOpsAlertWorkspaceContextAttrs = buildOpsAlertWorkspaceContextAttrs;',
        'window.buildOpsAlertWorkspaceContextAttrs = buildOpsAlertWorkspaceContextAttrs;',
        'window.readOpsAlertWorkspaceContextDataset = readOpsAlertWorkspaceContextDataset;',
        'window.getOpsAlertWorkspaceAction = getOpsAlertWorkspaceAction;',
        'window.getAdminWorkbenchOpsAlertCaseStatusLabel = getOpsAlertCaseStatusLabel;',
        'window.getAdminWorkbenchOpsAlertCaseStatusTone = getOpsAlertCaseStatusTone;',
        'window.getOpsAlertCaseStatusLabel = getOpsAlertCaseStatusLabel;',
        'window.getOpsAlertCaseStatusTone = getOpsAlertCaseStatusTone;',
        'window.getOpsAlertCaseEventActionLabel = getOpsAlertCaseEventActionLabel;',
        'window.normalizeOpsAlertCaseDisplayEvent = normalizeOpsAlertCaseDisplayEvent;',
        'window.getOpsAlertCaseMuteSummary = getOpsAlertCaseMuteSummary;',
        'window.normalizeAdminWorkbenchOpsAlertCaseRecentEvents = normalizeAdminWorkbenchOpsAlertCaseRecentEvents;',
        'window.getAdminWorkbenchOpsAlertCaseRecentEventText = getOpsAlertCaseRecentEventText;',
        'window.getAdminWorkbenchOpsAlertCaseSummaryText = getOpsAlertCaseSummaryText;',
        'window.getOpsAlertCaseRecentEventText = getOpsAlertCaseRecentEventText;',
        'window.getOpsAlertCaseSummaryText = getOpsAlertCaseSummaryText;',
        'window.getOpsAlertWorkspaceContextLabel = getOpsAlertWorkspaceContextLabel;',
        'window.getOpsAlertWorkspaceBatchPreview = getOpsAlertWorkspaceBatchPreview;',
        'window.buildOpsAlertCaseMutationContext = buildOpsAlertCaseMutationContext;',
        'window.normalizeOpsAlertCaseMutationItem = normalizeOpsAlertCaseMutationItem;',
        'window.buildAdminWorkbenchOpsAlertCaseMutationItems = buildOpsAlertCaseMutationItems;',
        'window.buildOpsAlertCaseMutationItems = buildOpsAlertCaseMutationItems;',
        'window.buildAdminWorkbenchOpsAlertMonitorBatchItems = buildOpsAlertMonitorBatchItems;',
        'window.getAdminWorkbenchOpsAlertMonitorBatchMuteModuleKeys = getOpsAlertMonitorBatchMuteModuleKeys;',
        'window.getAdminWorkbenchOpsAlertMonitorCategoryLabel = getAdminWorkbenchOpsAlertMonitorCategoryLabel;',
        'window.getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel = getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel;',
        'window.buildAdminWorkbenchOpsAlertMonitorCategoryView = buildAdminWorkbenchOpsAlertMonitorCategoryView;',
        'window.getAdminWorkbenchOpsAlertMonitorDisplayActiveCount = getAdminWorkbenchOpsAlertMonitorDisplayActiveCount;',
        'window.getAdminWorkbenchOpsAlertMonitorDisplayCriticalCount = getAdminWorkbenchOpsAlertMonitorDisplayCriticalCount;',
        'window.getAdminWorkbenchOpsAlertMonitorCardTone = getAdminWorkbenchOpsAlertMonitorCardTone;',
        'window.buildAdminWorkbenchOpsAlertMonitorCategoryCardState = buildAdminWorkbenchOpsAlertMonitorCategoryCardState;',
        'window.buildAdminWorkbenchOpsAlertMonitorCategoryRenderState = buildAdminWorkbenchOpsAlertMonitorCategoryRenderState;',
        'window.buildAdminWorkbenchOpsAlertMonitorFilterToolbarState = buildAdminWorkbenchOpsAlertMonitorFilterToolbarState;',
        'window.buildAdminWorkbenchOpsAlertMonitorItemDisplayState = buildAdminWorkbenchOpsAlertMonitorItemDisplayState;',
        'window.buildAdminWorkbenchOpsAlertMonitorBatchActionStates = buildAdminWorkbenchOpsAlertMonitorBatchActionStates;',
        'window.formatAdminWorkbenchOpsAlertSignedCount = formatAdminWorkbenchOpsAlertSignedCount;',
        'window.formatAdminWorkbenchOpsAlertTimeShort = formatAdminWorkbenchOpsAlertTimeShort;',
        'window.getAdminWorkbenchOpsAlertBacklogDeltaTone = getAdminWorkbenchOpsAlertBacklogDeltaTone;',
        'window.getAdminWorkbenchOpsAlertMonitorCategoryActions = getAdminWorkbenchOpsAlertMonitorCategoryActions;',
        'window.normalizeAdminWorkbenchOpsAlertMonitorAssignableAdmins = normalizeAdminWorkbenchOpsAlertMonitorAssignableAdmins;',
        'window.getAdminWorkbenchOpsAlertMonitorCurrentAdminId = getAdminWorkbenchOpsAlertMonitorCurrentAdminId;',
        'window.buildAdminWorkbenchOpsAlertMonitorActionContext = buildAdminWorkbenchOpsAlertMonitorActionContext;',
        'window.getAdminWorkbenchOpsAlertMonitorWorkspaceAction = getAdminWorkbenchOpsAlertMonitorWorkspaceAction;',
        'window.getAdminWorkbenchOpsAlertMonitorQuickAction = getAdminWorkbenchOpsAlertMonitorQuickAction;',
        'window.getAdminWorkbenchOpsAlertMonitorCaseActions = getAdminWorkbenchOpsAlertMonitorCaseActions;',
        'window.buildAdminWorkbenchOpsAlertMonitorRecoveryRow = buildAdminWorkbenchOpsAlertMonitorRecoveryRow;',
        'window.buildAdminWorkbenchOpsAlertMonitorBatchRows = buildAdminWorkbenchOpsAlertMonitorBatchRows;',
        'window.buildAdminWorkbenchOpsAlertMonitorChecklistText = buildAdminWorkbenchOpsAlertMonitorChecklistText;',
        'window.readAdminWorkbenchOpsAlertSecretInputs = readAdminWorkbenchOpsAlertSecretInputs;',
        'window.clearAdminWorkbenchOpsAlertSecretInputs = clearAdminWorkbenchOpsAlertSecretInputs;',
        'window.buildAdminWorkbenchOpsAlertSettingsRequestBody = buildAdminWorkbenchOpsAlertSettingsRequestBody;',
        'window.buildAdminWorkbenchOpsAlertConfigDraft = buildAdminWorkbenchOpsAlertConfigDraft;',
        'window.buildAdminWorkbenchOpsAlertSummaryModeHintText = buildAdminWorkbenchOpsAlertSummaryModeHintText;',
        'window.collectAdminWorkbenchOpsAlertUnifiedSummaryDraft = collectAdminWorkbenchOpsAlertUnifiedSummaryDraft;',
        'window.buildAdminWorkbenchOpsAlertSummaryModeControlState = buildAdminWorkbenchOpsAlertSummaryModeControlState;',
        'window.buildAdminWorkbenchOpsAlertMonitorControlState = buildAdminWorkbenchOpsAlertMonitorControlState;',
        'window.buildAdminWorkbenchOpsAlertShopRiskControlState = buildAdminWorkbenchOpsAlertShopRiskControlState;',
        'window.buildAdminWorkbenchOpsAlertStrategySummaryState = buildAdminWorkbenchOpsAlertStrategySummaryState;',
        'window.buildAdminWorkbenchOpsAlertOverviewStatus = buildAdminWorkbenchOpsAlertOverviewStatus;',
        'window.buildAdminWorkbenchOpsAlertOverviewBannerState = buildAdminWorkbenchOpsAlertOverviewBannerState;',
        'window.buildAdminWorkbenchOpsAlertOverviewRenderState = buildAdminWorkbenchOpsAlertOverviewRenderState;',
        'window.buildAdminWorkbenchOpsAlertOverviewCardStates = buildAdminWorkbenchOpsAlertOverviewCardStates;',
        'window.buildAdminWorkbenchOpsAlertRiskSpotlightState = buildAdminWorkbenchOpsAlertRiskSpotlightState;',
        'window.buildAdminWorkbenchOpsAlertRiskSpotlightShellState = buildAdminWorkbenchOpsAlertRiskSpotlightShellState;',
        'window.buildAdminWorkbenchOpsAlertRiskSpotlightRenderState = buildAdminWorkbenchOpsAlertRiskSpotlightRenderState;',
        'window.buildAdminWorkbenchOpsAlertOverviewRecentVisualState = buildAdminWorkbenchOpsAlertOverviewRecentVisualState;',
        'window.getAdminWorkbenchOpsAlertHealthSourceLabel = getAdminWorkbenchOpsAlertHealthSourceLabel;',
        'window.getAdminWorkbenchOpsAlertHealthMetaLine = getAdminWorkbenchOpsAlertHealthMetaLine;',
        'window.getAdminWorkbenchOpsAlertHealthLastSummary = getAdminWorkbenchOpsAlertHealthLastSummary;',
        'window.buildAdminWorkbenchOpsAlertHealthCardState = buildAdminWorkbenchOpsAlertHealthCardState;',
        'window.buildAdminWorkbenchOpsAlertHealthPanelState = buildAdminWorkbenchOpsAlertHealthPanelState;',
        'window.buildAdminWorkbenchOpsAlertHealthRenderState = buildAdminWorkbenchOpsAlertHealthRenderState;',
        'window.buildAdminWorkbenchOpsAlertStrategyControlState = buildAdminWorkbenchOpsAlertStrategyControlState;',
        'window.collectAdminWorkbenchOpsAlertStrategyDraft = collectAdminWorkbenchOpsAlertStrategyDraft;',
        'window.collectAdminWorkbenchOpsAlertOperationalThresholdDrafts = collectAdminWorkbenchOpsAlertOperationalThresholdDrafts;',
        'window.validateAdminWorkbenchOpsAlertDispatchConfig = validateAdminWorkbenchOpsAlertDispatchConfig;',
        'window.fetchAdminWorkbenchOpsAlertSettings = fetchAdminWorkbenchOpsAlertSettings;',
        'window.submitAdminWorkbenchOpsAlertSettings = submitAdminWorkbenchOpsAlertSettings;',
        'window.deleteAdminWorkbenchOpsAlertSecret = deleteAdminWorkbenchOpsAlertSecret;',
        'window.normalizeAdminWorkbenchOpsAlertSettingsPayload = normalizeAdminWorkbenchOpsAlertSettingsPayload;',
        'window.fetchAdminWorkbenchOpsAlertHealth = fetchAdminWorkbenchOpsAlertHealth;',
        'window.normalizeAdminWorkbenchOpsAlertHealthPayload = normalizeAdminWorkbenchOpsAlertHealthPayload;',
        'window.normalizeAdminWorkbenchOpsAlertMonitorShiftReport = normalizeAdminWorkbenchOpsAlertMonitorShiftReport;',
        'window.normalizeAdminWorkbenchOpsAlertMonitorShiftReportView = normalizeAdminWorkbenchOpsAlertMonitorShiftReportView;',
        'window.getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta = getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta;',
        'window.getAdminWorkbenchOpsAlertMonitorShiftReportVisibleSections = getAdminWorkbenchOpsAlertMonitorShiftReportVisibleSections;',
        'window.getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat = getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat;',
        'window.buildAdminWorkbenchOpsAlertMonitorShiftOwnedCategoryItems = buildAdminWorkbenchOpsAlertMonitorShiftOwnedCategoryItems;',
        'window.buildAdminWorkbenchOpsAlertMonitorPanelState = buildAdminWorkbenchOpsAlertMonitorPanelState;',
        'window.buildAdminWorkbenchOpsAlertBatchMuteModalState = buildAdminWorkbenchOpsAlertBatchMuteModalState;',
        'window.buildAdminWorkbenchOpsAlertMonitorShiftTrendState = buildAdminWorkbenchOpsAlertMonitorShiftTrendState;',
        'window.buildAdminWorkbenchOpsAlertMonitorShiftShellState = buildAdminWorkbenchOpsAlertMonitorShiftShellState;',
        'window.buildAdminWorkbenchOpsAlertMonitorShiftViewSwitchState = buildAdminWorkbenchOpsAlertMonitorShiftViewSwitchState;',
        'window.buildAdminWorkbenchOpsAlertMonitorShiftReportState = buildAdminWorkbenchOpsAlertMonitorShiftReportState;',
        'window.buildAdminWorkbenchOpsAlertMonitorShiftPanelStates = buildAdminWorkbenchOpsAlertMonitorShiftPanelStates;',
        'window.buildAdminWorkbenchOpsAlertMonitorShiftReportSummaryText = buildAdminWorkbenchOpsAlertMonitorShiftReportSummaryText;',
        'window.buildAdminWorkbenchOpsAlertMonitorShiftReportCsvRows = buildAdminWorkbenchOpsAlertMonitorShiftReportCsvRows;',
        'window.buildAdminWorkbenchOpsAlertMonitorShiftRenderState = buildAdminWorkbenchOpsAlertMonitorShiftRenderState;',
        'window.fetchAdminWorkbenchOpsAlertMonitor = fetchAdminWorkbenchOpsAlertMonitor;',
        'window.normalizeAdminWorkbenchOpsAlertMonitorPayload = normalizeAdminWorkbenchOpsAlertMonitorPayload;',
        'window.getOpsAlertCaseComposerMeta = getOpsAlertCaseComposerMeta;',
        'window.buildOpsAlertCaseMutationRequest = buildOpsAlertCaseMutationRequest;',
        'window.submitOpsAlertCaseMutationRequest = submitOpsAlertCaseMutationRequest;',
        'window.buildChatSessionWorkbenchEntry = buildChatSessionWorkbenchEntry;',
        'window.buildShopOrderWorkbenchEntry = buildShopOrderWorkbenchEntry;',
        'window.buildUserWorkbenchEntry = buildUserWorkbenchEntry;',
        'window.buildTicketQueueWorkbenchEntry = buildTicketQueueWorkbenchEntry;',
        'window.buildPaymentWorkbenchEntry = buildPaymentWorkbenchEntry;',
        'window.buildVerifyWorkbenchEntry = buildVerifyWorkbenchEntry;',
        'window.buildLinkedOpsAlertSourceWorkbenchEntry = buildLinkedOpsAlertSourceWorkbenchEntry;',
        'window.buildTicketWorkbenchEntry = buildTicketWorkbenchEntry;',
        'window.resolveOpsAlertEntryWorkspace = resolveOpsAlertEntryWorkspace;',
        'window.resolveShopRiskWorkspace = resolveShopRiskWorkspace;',
        'window.resolveOpsAlertWorkspace = resolveOpsAlertWorkspace;',
        'window.openAdminWorkbenchEntry = openAdminWorkbenchEntry;',
        'window.openOpsAlertWorkspace = openOpsAlertWorkspace;',
        'window.savePendingOpsAlertWorkspace = savePendingOpsAlertWorkspace;',
        'window.consumePendingOpsAlertWorkspace = consumePendingOpsAlertWorkspace;',
        'window.restorePendingOpsAlertWorkspace = restorePendingOpsAlertWorkspace;',
        'window.schedulePendingOpsAlertWorkspaceRestore = schedulePendingOpsAlertWorkspaceRestore;'
    ];

    for (const marker of sharedWorkbenchMarkers) {
        assert.equal(adminWorkbenchSource.includes(marker), true, `js/admin-workbench.js should contain ${marker}`);
    }
    assert.equal(
        adminWorkbenchSource.includes("window.switchSettingsView?.('google-one');"),
        true,
        'js/admin-workbench.js should route verify monitor workspaces into the Google One settings view'
    );
    assert.equal(
        adminWorkbenchSource.includes("window.switchSettingsView?.('content');"),
        false,
        'js/admin-workbench.js should no longer route verify monitor workspaces into the content settings view'
    );
    assert.equal(
        adminConfigSource.includes('return resolveOpsAlertWorkspaceActionResolver()({'),
        true,
        'admin-config.js should resolve ops alert card workspaces through a dedicated local workspace-action resolver'
    );
    assert.equal(
        adminConfigSource.includes('return resolveOpsAlertWorkspaceContextAttrs(resolveOpsAlertMonitorActionContext(category, item));'),
        true,
        'admin-config.js should build ops alert workspace data attrs through dedicated local resolvers before rendering'
    );
    assert.equal(
        adminConfigSource.includes('function buildLocalOpsAlertCaseComposerViewState('),
        true,
        'admin-config.js should derive ops alert case composer state through a dedicated local view-state builder'
    );
    assert.equal(
        adminConfigSource.includes('function applyOpsAlertBatchMuteModalViewState('),
        true,
        'admin-config.js should apply ops alert batch mute modal state through a dedicated DOM applier'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertCaseSummaryText(item, {'),
        true,
        'admin-config.js should format ops alert case summaries through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getOpsAlertWorkspaceContextLabel(context, { fallback: \'集中告警\' })'),
        true,
        'admin-config.js should build case composer target labels through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getOpsAlertWorkspaceBatchPreview(items, {'),
        true,
        'admin-config.js should build batch case previews through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getOpsAlertCaseComposerMeta(state, {'),
        true,
        'admin-config.js should build case composer copy through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertCaseMutationItems(items, categoryKey)'),
        true,
        'admin-config.js should normalize case mutation items through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildOpsAlertCaseMutationRequest(action, context, options)'),
        true,
        'admin-config.js should build case mutation requests through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorBatchItems(categories, action, categoryKey)'),
        true,
        'admin-config.js should derive monitor batch items through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorBatchRows(categories, filters, categoryKey, {'),
        true,
        'admin-config.js should derive monitor export rows through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorChecklistText(rows, filters, categoryKey, {'),
        true,
        'admin-config.js should build monitor checklist copy through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.fetchAdminWorkbenchOpsAlertSettings(headers, {'),
        true,
        'admin-config.js should fetch ops alert settings payloads through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.normalizeAdminWorkbenchOpsAlertSettingsPayload(payload, {'),
        true,
        'admin-config.js should normalize ops alert settings payloads through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.submitAdminWorkbenchOpsAlertSettings(headers, body, {'),
        true,
        'admin-config.js should submit ops alert settings payloads through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.readAdminWorkbenchOpsAlertSecretInputs()'),
        true,
        'admin-config.js should read ops alert secret inputs through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.clearAdminWorkbenchOpsAlertSecretInputs()'),
        true,
        'admin-config.js should clear ops alert secret inputs through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertSettingsRequestBody(config, options)'),
        true,
        'admin-config.js should build ops alert settings request bodies through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.collectAdminWorkbenchOpsAlertStrategyDraft(currentConfig, {'),
        true,
        'admin-config.js should collect ops alert strategy drafts through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertStrategyDraft(currentConfig = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {'),
        true,
        'admin-config.js should wrap shared ops alert strategy draft collection behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertConfigDraft(currentConfig, {'),
        true,
        'admin-config.js should build ops alert config drafts through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertConfigDraft(currentConfig = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {'),
        true,
        'admin-config.js should wrap shared ops alert config draft collection behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('window.collectAdminWorkbenchOpsAlertUnifiedSummaryDraft(currentDraft, {'),
        true,
        'admin-config.js should collect unified ops alert summary drafts through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertUnifiedSummaryConsensus(config, {'),
        true,
        'admin-config.js should derive unified ops alert summary consensus through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertUnifiedSummaryDraftControlState(draft, {'),
        true,
        'admin-config.js should derive unified ops alert summary control state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertUnifiedSummaryDraft() {'),
        true,
        'admin-config.js should wrap unified ops alert summary draft collection behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertUnifiedSummaryDraftConsensus(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\']), selectedDefinitions = getOpsAlertSummaryOrchestrationSelectedDefinitions()) {'),
        true,
        'admin-config.js should wrap unified ops alert summary consensus behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes("function requireOpsAlertWorkbenchMethod(methodName = '') {"),
        true,
        'admin-config.js should expose a local shared-runtime method resolver for ops alert workbench helpers'
    );
    assert.equal(
        adminConfigSource.includes("requireOpsAlertWorkbenchMethod('collectAdminWorkbenchOpsAlertUnifiedSummaryDraft')"),
        true,
        'admin-config.js should resolve unified summary drafts through the shared workbench method resolver'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertSummaryModeControlState(monitorConfig, {'),
        true,
        'admin-config.js should derive summary mode control state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertSummaryModeControlState(monitorConfig = {}, options = {}) {'),
        true,
        'admin-config.js should wrap summary mode control state behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes("requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertSummaryModeHintText')"),
        true,
        'admin-config.js should resolve summary mode hint text through the shared workbench method resolver'
    );
    assert.equal(
        adminConfigSource.includes("requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertSummaryModeControlState')"),
        true,
        'admin-config.js should resolve summary mode control state through the shared workbench method resolver'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertSummaryModeHintText'),
        true,
        'admin-config.js should reuse the shared summary mode hint helper'
    );
    assert.equal(
        adminConfigSource.includes("requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertUnifiedSummaryDraftControlState')"),
        true,
        'admin-config.js should derive unified summary draft control state through the shared workbench method resolver'
    );
    assert.equal(
        adminConfigSource.includes("requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertUnifiedSummaryDraftControlState')"),
        true,
        'admin-config.js should reuse the shared workbench builder for unified summary draft controls'
    );
    assert.equal(
        adminConfigSource.includes("requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertSummaryOrchestrationRenderState')"),
        true,
        'admin-config.js should resolve unified summary orchestration render state through the shared workbench method resolver'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorControlState(monitorConfig'),
        true,
        'admin-config.js should derive monitor control state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorControlState(monitorConfig = {}, sharedOptions = {}) {'),
        true,
        'admin-config.js should wrap monitor control state behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorControlStateBuilder() {'),
        true,
        'admin-config.js should expose a local shared-runtime builder resolver for monitor control state'
    );
    assert.equal(
        adminConfigSource.includes('function buildLocalOpsAlertMonitorControlState(monitorConfig = {}, sharedOptions = {}) {'),
        true,
        'admin-config.js should keep a local monitor control state builder as the non-shared fallback'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertShopRiskControlState(shopRiskConfig)'),
        true,
        'admin-config.js should derive shop risk control state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertShopRiskControlState(shopRiskConfig = {}) {'),
        true,
        'admin-config.js should wrap shop risk control state behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertShopRiskControlStateBuilder() {'),
        true,
        'admin-config.js should expose a local shared-runtime builder resolver for shop risk controls'
    );
    assert.equal(
        adminConfigSource.includes('function buildLocalOpsAlertShopRiskControlState(shopRiskConfig = {}) {'),
        true,
        'admin-config.js should keep a local shop risk control state builder as the non-shared fallback'
    );
    assert.equal(
        adminConfigSource.includes('window.collectAdminWorkbenchOpsAlertOperationalThresholdDrafts(currentConfig, {'),
        true,
        'admin-config.js should collect ops alert operational threshold drafts through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('function buildLocalOpsAlertStrategyDraft(currentConfig = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {'),
        true,
        'admin-config.js should keep a local strategy draft builder as the non-shared fallback'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertOperationalThresholdDrafts(currentConfig = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {'),
        true,
        'admin-config.js should wrap operational threshold draft collection behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function buildLocalOpsAlertOperationalThresholdDrafts(currentConfig = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {'),
        true,
        'admin-config.js should keep a local operational threshold draft builder as the non-shared fallback'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertStrategySummaryState(config, {'),
        true,
        'admin-config.js should derive ops alert strategy summary state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('function fetchOpsAlertSettingsPayload(headers = {}) {'),
        true,
        'admin-config.js should centralize ops alert settings fetches behind a local resolver helper'
    );
    assert.equal(
        adminConfigSource.includes("requireOpsAlertWorkbenchMethod('fetchAdminWorkbenchOpsAlertSettings')(headers, {"),
        true,
        'admin-config.js should delegate ops alert settings fetches to the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertSettingsPayload(payload = {}) {'),
        true,
        'admin-config.js should centralize ops alert settings payload normalization behind a local resolver helper'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertOverviewStatus(config) {'),
        true,
        'admin-config.js should wrap ops alert overview status derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertSecretInputs() {'),
        true,
        'admin-config.js should wrap ops alert secret input reads behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertSettingsRequestBody(config, options = {}) {'),
        true,
        'admin-config.js should wrap ops alert settings request body building behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function buildLocalOpsAlertStrategyControlState(normalizedConfig = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {'),
        true,
        'admin-config.js should keep a local strategy control state builder as the non-shared fallback'
    );
    assert.equal(
        adminConfigSource.includes('async function submitOpsAlertSettingsPayload(headers = {}, body = {}, options = {}) {'),
        true,
        'admin-config.js should centralize ops alert settings writes behind a local submit helper'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertDispatchConfigValidation(config = {}, secretStatus = {}, secrets = {}) {'),
        true,
        'admin-config.js should wrap ops alert dispatch validation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function buildLocalOpsAlertDispatchConfigValidation(config = {}, secretStatus = {}, secrets = {}) {'),
        true,
        'admin-config.js should keep a local dispatch validation builder as the non-shared fallback'
    );
    assert.equal(
        adminConfigSource.includes('async function submitOpsAlertSecretDeletion(headers = {}, secretName = \'\', options = {}) {'),
        true,
        'admin-config.js should centralize ops alert secret deletion behind a local submit helper'
    );
    assert.equal(
        adminConfigSource.includes('function fetchOpsAlertHealthPayload(headers = {}) {'),
        true,
        'admin-config.js should centralize ops alert health fetches behind a local resolver helper'
    );
    assert.equal(
        adminConfigSource.includes("requireOpsAlertWorkbenchMethod('fetchAdminWorkbenchOpsAlertHealth')(headers, {"),
        true,
        'admin-config.js should delegate ops alert health fetches to the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertHealthPayload(payload = {}) {'),
        true,
        'admin-config.js should centralize ops alert health payload normalization behind a local resolver helper'
    );
    assert.equal(
        adminConfigSource.includes('function fetchOpsAlertMonitorPayload(headers = {}) {'),
        true,
        'admin-config.js should centralize ops alert monitor fetches behind a local resolver helper'
    );
    assert.equal(
        adminConfigSource.includes("requireOpsAlertWorkbenchMethod('fetchAdminWorkbenchOpsAlertMonitor')(headers, {"),
        true,
        'admin-config.js should delegate ops alert monitor fetches to the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorPayload(payload = {}) {'),
        true,
        'admin-config.js should centralize ops alert monitor payload normalization behind a local resolver helper'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorAssignableAdmins(state = opsAlertMonitorState || getDefaultOpsAlertMonitorState()) {'),
        true,
        'admin-config.js should wrap assignable admin normalization behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertCaseStatusTone(status) {'),
        true,
        'admin-config.js should wrap case status tone derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertCaseStatusLabel(status) {'),
        true,
        'admin-config.js should wrap case status label derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorContextAttrs(category = {}, item = {}) {'),
        true,
        'admin-config.js should wrap monitor workspace context attrs behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorActionContext(category = {}, item = {}) {'),
        true,
        'admin-config.js should wrap monitor action context behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertWorkspaceContextAttrs(context = {}) {'),
        true,
        'admin-config.js should wrap workspace context attr derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertCaseRecentEventText(event = {}) {'),
        true,
        'admin-config.js should wrap case recent-event text behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertCaseSummaryText(item = {}) {'),
        true,
        'admin-config.js should wrap case summary derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorCategoryView(category = {}, filters = getOpsAlertMonitorViewFilters()) {'),
        true,
        'admin-config.js should wrap monitor category view derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorCategoryActions(categoryKey) {'),
        true,
        'admin-config.js should wrap monitor category actions behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorFilterSummaryLabel(filters = getOpsAlertMonitorViewFilters()) {'),
        true,
        'admin-config.js should wrap monitor filter summary labels behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorDisplayActiveCount(category = {}) {'),
        true,
        'admin-config.js should wrap monitor active-count derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorDisplayCriticalCount(category = {}) {'),
        true,
        'admin-config.js should wrap monitor critical-count derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorCardTone(category = {}) {'),
        true,
        'admin-config.js should wrap monitor card tone derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorItemAction(category = {}, item = {}) {'),
        true,
        'admin-config.js should wrap monitor item workspace actions behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorItemQuickAction(category = {}, item = {}) {'),
        true,
        'admin-config.js should wrap monitor item quick actions behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorItemCaseActions(category = {}, item = {}) {'),
        true,
        'admin-config.js should wrap monitor item case actions behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorBatchRows(categories = [], filters = getOpsAlertMonitorViewFilters(), categoryKey = \'\') {'),
        true,
        'admin-config.js should wrap monitor batch row derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorChecklistText(rows = [], filters = getOpsAlertMonitorViewFilters(), categoryKey = \'\') {'),
        true,
        'admin-config.js should wrap monitor checklist text derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertBatchMuteModalState(state = opsAlertBatchMuteState || getDefaultOpsAlertBatchMuteState()) {'),
        true,
        'admin-config.js should wrap batch mute modal state derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorSignedCount(value) {'),
        true,
        'admin-config.js should wrap signed count formatting behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorTimeShort(value) {'),
        true,
        'admin-config.js should wrap short time formatting behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorBacklogDeltaTone(delta) {'),
        true,
        'admin-config.js should wrap backlog delta tone derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorShiftReportView(value = \'all\') {'),
        true,
        'admin-config.js should wrap shift report view normalization behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorShiftReportViewMeta(value = opsAlertMonitorShiftReportViewState) {'),
        true,
        'admin-config.js should wrap shift report view metadata behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorShiftReportCurrentAdminId() {'),
        true,
        'admin-config.js should wrap current shift admin id derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorShiftOwnedCategoryItems(categories = [], currentAdminId = resolveOpsAlertMonitorShiftReportCurrentAdminId()) {'),
        true,
        'admin-config.js should wrap owned shift category derivation behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorShiftReportSummaryText(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = \'\') {'),
        true,
        'admin-config.js should wrap shift report summary export text behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertMonitorShiftReportCsvRows(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = \'\') {'),
        true,
        'admin-config.js should wrap shift report csv rows behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function resolveOpsAlertStrategySummaryState(normalizedConfig = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {'),
        true,
        'admin-config.js should wrap ops alert strategy summary state behind a local resolver'
    );
    assert.equal(
        adminConfigSource.includes('function buildLocalOpsAlertStrategySummaryState(normalizedConfig = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {'),
        true,
        'admin-config.js should keep a local strategy summary state builder as the non-shared fallback'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertOverviewStatus(config, opsAlertSecretStatus, {'),
        true,
        'admin-config.js should derive ops alert overview status through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertOverviewRenderState(overviewStatus, healthState, {'),
        true,
        'admin-config.js should derive aggregated ops alert overview render state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertOverviewBannerState(overviewStatus, healthState, {'),
        false,
        'admin-config.js should no longer call the lower-level overview banner state helper directly once aggregate render state is available'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertOverviewCardStates({'),
        false,
        'admin-config.js should no longer call the lower-level overview card state helper directly once aggregate render state is available'
    );
    assert.equal(
        adminConfigSource.includes('function applyOpsAlertSectionControlUpdates(applyControls) {'),
        true,
        'admin-config.js should centralize ops alert section control refreshes through a shared section update helper'
    );
    assert.equal(
        adminConfigSource.includes('function toggleOpsAlertSectionControl(toggleId, applyControls, options = {}) {'),
        true,
        'admin-config.js should centralize ops alert section toggles through a shared section toggle helper'
    );
    assert.equal(
        adminConfigSource.includes('function handleOpsAlertSectionSummaryScheduleModeChange(applyControls) {'),
        true,
        'admin-config.js should centralize ops alert summary schedule refreshes through a shared helper'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertRiskSpotlightState(category, filters, {'),
        false,
        'admin-config.js should no longer duplicate the lower-level shop risk spotlight state call once render state is available'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertRiskSpotlightRenderState(category, filters, {'),
        true,
        'admin-config.js should derive shop risk spotlight render state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertRiskSpotlightShellState(status, {'),
        true,
        'admin-config.js should derive shop risk spotlight shell state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertOverviewRecentVisualState(summary, status, {'),
        false,
        'admin-config.js should no longer call the lower-level overview recent visual helper directly once aggregate render state is available'
    );
    assert.equal(
        adminConfigSource.includes("requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertHealthRenderState')(state, {"),
        true,
        'admin-config.js should derive aggregated ops alert health render state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes("requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertHealthCardState')(channel, {"),
        false,
        'admin-config.js should no longer call the lower-level health card state helper directly once aggregate render state is available'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertHealthPanelState(state, {'),
        false,
        'admin-config.js should no longer call the lower-level health panel state helper directly once aggregate render state is available'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertStrategyControlState(config, {'),
        true,
        'admin-config.js should derive ops alert strategy control state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('nextConfig.shop_order_risk = operationalThresholdDrafts.shop_order_risk;'),
        true,
        'admin-config.js should apply resolved shop risk threshold drafts directly once the local operational threshold builder is available'
    );
    assert.equal(
        adminConfigSource.includes('...operationalThresholdDrafts.customer_chat_message,'),
        true,
        'admin-config.js should apply resolved customer chat threshold drafts directly once the local operational threshold builder is available'
    );
    assert.equal(
        adminConfigSource.includes('nextConfig.shop_purchase_success = operationalThresholdDrafts.shop_purchase_success;'),
        true,
        'admin-config.js should apply resolved shop purchase threshold drafts directly once the local operational threshold builder is available'
    );
    assert.equal(
        adminConfigSource.includes('nextConfig.wallet_recharge_success = operationalThresholdDrafts.wallet_recharge_success;'),
        true,
        'admin-config.js should apply resolved wallet recharge threshold drafts directly once the local operational threshold builder is available'
    );
    assert.equal(
        adminConfigSource.includes('nextConfig.shop_order_delivery = operationalThresholdDrafts.shop_order_delivery;'),
        true,
        'admin-config.js should apply resolved delivery threshold drafts directly once the local operational threshold builder is available'
    );
    assert.equal(
        adminConfigSource.includes('window.validateAdminWorkbenchOpsAlertDispatchConfig(config, secretStatus, secrets)'),
        true,
        'admin-config.js should validate ops alert dispatch prerequisites through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.deleteAdminWorkbenchOpsAlertSecret(headers, secretName, {'),
        true,
        'admin-config.js should delete ops alert secrets through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.fetchAdminWorkbenchOpsAlertHealth(headers, {'),
        true,
        'admin-config.js should fetch ops alert health payloads through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.normalizeAdminWorkbenchOpsAlertHealthPayload(payload, {'),
        true,
        'admin-config.js should normalize ops alert health payloads through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorShiftReportSummaryText(report, shiftRuntimeState,'),
        true,
        'admin-config.js should build shift report summary copy through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorShiftReportCsvRows(report, shiftRuntimeState,'),
        true,
        'admin-config.js should build shift report csv rows through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorShiftTrendState(report, {'),
        true,
        'admin-config.js should derive shift trend state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorShiftShellState(status, {'),
        true,
        'admin-config.js should derive shift shell state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorShiftViewSwitchState(currentView, {'),
        true,
        'admin-config.js should derive shift report view switch state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorShiftReportState(report, {'),
        false,
        'admin-config.js should no longer call the lower-level shift report state helper directly once aggregate render state is available'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorShiftPanelStates(report, {'),
        false,
        'admin-config.js should no longer call the lower-level shift panel state helper directly once aggregate render state is available'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorShiftRenderState(report, shiftRuntimeState,'),
        true,
        'admin-config.js should derive aggregate shift render state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertRecentDeliverySummary(summary.recent_deliveries, {'),
        false,
        'admin-config.js should no longer call the lower-level overview delivery summary helper directly once aggregate render state is available'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertRecentErrorSummary(summary.recent_errors, 2, {'),
        false,
        'admin-config.js should no longer call the lower-level overview error summary helper directly once aggregate render state is available'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertErrorSourceSummary(summary.recent_error_channels, 3, {'),
        false,
        'admin-config.js should no longer call the lower-level overview error source summary helper directly once aggregate render state is available'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorCategoryView(category, filters, {'),
        true,
        'admin-config.js should derive prepared monitor category views through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel(filters)'),
        true,
        'admin-config.js should derive monitor filter summary labels through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorFilterToolbarState(filters, {'),
        true,
        'admin-config.js should derive monitor filter toolbar state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorRecoveryRow(category, {'),
        true,
        'admin-config.js should derive recovery rows through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorShiftOwnedCategoryItems(categories, currentAdminId, {'),
        true,
        'admin-config.js should derive owned shift categories through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.normalizeAdminWorkbenchOpsAlertMonitorShiftReportView(value, {'),
        true,
        'admin-config.js should normalize shift report views through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertMonitorShiftReportViewMeta(value, {'),
        true,
        'admin-config.js should derive shift report view meta through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertMonitorShiftReportVisibleSections(view, {'),
        false,
        'admin-config.js should no longer call the lower-level visible-section helper directly once aggregate shift render state is available'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertMonitorShiftReportCurrentAdminStat(report, currentAdminId)'),
        false,
        'admin-config.js should no longer call the lower-level current-admin stat helper directly once export and render runtime state is aggregated'
    );
    assert.equal(
        adminConfigSource.includes('window.formatAdminWorkbenchOpsAlertSignedCount(value, {'),
        true,
        'admin-config.js should format signed monitor deltas through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.formatAdminWorkbenchOpsAlertTimeShort(value, {'),
        true,
        'admin-config.js should format monitor time buckets through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertBacklogDeltaTone(delta)'),
        true,
        'admin-config.js should derive backlog delta tone through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertMonitorCurrentAdminId(opsAlertMonitorState)'),
        true,
        'admin-config.js should derive current monitor admin id through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.normalizeAdminWorkbenchOpsAlertCaseRecentEvents(item.case_recent_events)'),
        true,
        'admin-config.js should normalize recent case events through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorCategoryCardState(category, filters, {'),
        false,
        'admin-config.js should no longer call the lower-level monitor category card state helper directly once category render state is available'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorCategoryRenderState(category, filters, {'),
        true,
        'admin-config.js should derive monitor category render state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorPanelState(state, filters, categories, {'),
        true,
        'admin-config.js should derive monitor panel summary state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertBatchMuteModalState(state, {'),
        true,
        'admin-config.js should derive batch mute modal state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorItemDisplayState(item, category, {'),
        false,
        'admin-config.js should no longer call the lower-level monitor item display state helper directly once category render state is available'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorBatchActionStates(normalizedCategories, filters, {'),
        true,
        'admin-config.js should derive monitor batch action state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertMonitorCategoryActions(categoryKey)'),
        true,
        'admin-config.js should derive monitor category actions through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.normalizeAdminWorkbenchOpsAlertMonitorAssignableAdmins(state, {'),
        true,
        'admin-config.js should normalize assignable admins through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertMonitorWorkspaceAction(category, item, {'),
        true,
        'admin-config.js should derive monitor workspace actions through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertMonitorQuickAction(category, item)'),
        true,
        'admin-config.js should derive monitor quick actions through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertMonitorCaseActions(category, item)'),
        true,
        'admin-config.js should derive monitor case actions through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertMonitorActionContext(category, item)'),
        true,
        'admin-config.js should build monitor action context through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertWorkspaceContextAttrs(context)'),
        true,
        'admin-config.js should derive workspace context attrs through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.buildAdminWorkbenchOpsAlertSummaryOrchestrationRenderState(config, {'),
        true,
        'admin-config.js should derive summary orchestration render state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.fetchAdminWorkbenchOpsAlertMonitor(headers, {'),
        true,
        'admin-config.js should fetch ops alert monitor payloads through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.normalizeAdminWorkbenchOpsAlertMonitorPayload(payload, {'),
        true,
        'admin-config.js should normalize ops alert monitor payloads through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('const sharedRuleState = sharedControlState?.muteRules?.[scope]?.[definition.key] || null;'),
        true,
        'admin-config.js should consume shared mute-rule state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('sharedControlState?.routingMatrix?.[routingKey]?.[channelKey]'),
        true,
        'admin-config.js should consume shared routing matrix state through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.getAdminWorkbenchOpsAlertMonitorBatchMuteModuleKeys(categories, categoryKey)'),
        true,
        'admin-config.js should derive monitor mute module keys through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes('window.submitOpsAlertCaseMutationRequest(headers, action, context, {'),
        true,
        'admin-config.js should submit case mutations through the shared workbench runtime'
    );
    assert.equal(
        adminConfigSource.includes("labelVariant: 'monitor'"),
        true,
        'admin-config.js should request monitor-oriented labels from the shared workbench resolver'
    );

    const runtimeMarkers = [
        'function getDefaultOpsAlertConfig()',
        'function normalizeOpsAlertConfig(raw)',
        'function renderOpsAlertSettings()',
        'function applyOpsAlertOverview(config)',
        'function applyOpsAlertStrategyControls(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\']))',
        'function applyOpsAlertShopRiskControls(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\']))',
        'function applyOpsAlertCustomerChatControls(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\']))',
        'function applyOpsAlertShopPurchaseSuccessControls(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\']))',
        'function applyOpsAlertWalletRechargeSuccessControls(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\']))',
        'function applyOpsAlertTicketsControls(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\']))',
        "requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertSummaryOrchestrationRenderState')",
        'function resolveOpsAlertSummaryOrchestrationRenderState(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\']), selectedDefinitions = getOpsAlertSummaryOrchestrationSelectedDefinitions()) {',
        'function buildOpsAlertSummaryOrchestrationMarkupState(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {',
        'function applyOpsAlertSummaryOrchestrationMarkupState(markupState = {}) {',
        'function applyAdminConfigFieldValue(field = {}) {',
        'function applyAdminConfigFieldValues(fields = []) {',
        'function getOpsAlertMinutesFieldValue(value) {',
        'function buildOpsAlertSettingsFieldGroups(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {',
        'function applyOpsAlertSettingsFieldGroups(fieldGroups = []) {',
        'function buildLocalOpsAlertChannelOverviewState(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\']), overviewStatus = getOpsAlertOverviewStatus(config)) {',
        'function applyOpsAlertChannelOverviewState(channelOverviewState = {}) {',
        'function applyOpsAlertSectionControlAppliers(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {',
        'function applyOpsAlertBodyMarkupState(markupState = {}, target = null, fallbackBody = \'\') {',
        'function applyOpsAlertPanelMarkupElements(markupState = {}, elements = {}, options = {}) {',
        'function renderOpsAlertSummaryOrchestration(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\']))',
        'function applyOpsAlertUnifiedSummaryDraft()',
        'function getOpsAlertOverviewStatus(config)',
        'function renderOpsAlertOverviewCards(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\']))',
        'function buildLocalOpsAlertOverviewMarkupState(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {',
        'function resolveOpsAlertOverviewMarkupState(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {',
        'function applyOpsAlertOverviewMarkupState(applyState = {}) {',
        'function renderOpsAlertOverview(config = normalizeOpsAlertConfig(systemConfigCache[\'ops_alerts\'])) {',
        'function renderOpsAlertBodyMarkupTarget(targetId, resolveMarkupState) {',
        'function renderOpsAlertPanelMarkupTarget(options = {}) {',
        'function collectOpsAlertConfigFromForm()',
        "fetch('/api/admin/settings/ops-alerts'",
        'toggleOpsAlertCustomerChatMessageEnabled,',
        'toggleOpsAlertShopPurchaseSuccessEnabled,',
        'toggleOpsAlertWalletRechargeSuccessEnabled,',
        'toggleOpsAlertTicketsEnabled,',
        'toggleOpsAlertTicketsSummaryEnabled,',
        'toggleOpsAlertTicketsWorkHoursOnlyEnabled,',
        'handleOpsAlertTicketsSummaryScheduleModeChange,',
        'selectOpsAlertUnifiedSummaryTargets,',
        'applyOpsAlertUnifiedSummaryDraft,',
        'sendOpsAlertCustomerChatMessageSample,',
        'sendOpsAlertShopPurchaseSucceededSample,',
        'sendOpsAlertWalletRechargeSucceededSample,',
        'sendOpsAlertGatewayRecoveredSample,',
        'sendOpsAlertVerifyFailureRateSpikeSample,',
        'sendOpsAlertVerifyIncidentEscalatedSample,',
        'sendOpsAlertVerifyIncidentRecoveredSample,',
        'sendOpsAlertVerifyQueueBacklogSample,',
        'sendOpsAlertVerifyServiceDisabledSample,',
        'sendOpsAlertTicketSlaRecoveredSample,',
        'sendOpsAlertShopInventoryRecoveredSample,',
        'sendOpsAlertShopOrderDeliveryIncidentSample,',
        'sendOpsAlertShopOrderDeliveryIncidentRecoveredSample,',
        'sendOpsAlertShopOrderDeliveryRecoveredSample,',
        'sendOpsAlertPaymentConfigChangedSample,',
        'sendOpsAlertPaymentConfigIncidentSample,',
        'sendOpsAlertPaymentConfigIncidentRecoveredSample,',
        'sendOpsAlertPaymentConfigRecoveredSample,',
        "requireOpsAlertWorkbenchMethod('fetchAdminWorkbenchOpsAlertHealth')",
        'function getDefaultOpsAlertHealthState()',
        'function renderOpsAlertHealthPanel()',
        'function buildOpsAlertHealthCardMarkupFromState(resolvedCardState = {}) {',
        'function resolveOpsAlertHealthRenderState(state = {})',
        'function buildLocalOpsAlertOverviewBannerState(overviewStatus = {}, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState())',
        'function resolveOpsAlertOverviewBannerState(overviewStatus = {}, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState())',
        'function buildLocalOpsAlertOverviewCardStates(overviewStatus = {}, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState())',
        'function resolveOpsAlertOverviewCardStates(overviewStatus = {}, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState())',
        'function buildLocalOpsAlertOverviewRecentVisualState(summary = {}, status = \'idle\')',
        'function resolveOpsAlertOverviewRecentVisualState(summary = {}, status = \'idle\')',
        'function buildOpsAlertOverviewBannerMarkupFromState(sharedBannerState = {}, healthState = opsAlertHealthState || getDefaultOpsAlertHealthState()) {',
        'function applyOpsAlertOverviewBannerMarkupState(markupState = {}, summaryEl = null) {',
        'function buildLocalOpsAlertOverviewRecentVisualsMarkupState(sharedVisualState = {}) {',
        'function applyOpsAlertOverviewRecentVisualsMarkupState(markupState = {}, elements = {}) {',
        'function buildLocalOpsAlertOverviewCardsApplyState(markupState = {}) {',
        'function applyOpsAlertOverviewCardsMarkupState(applyState = {}) {',
        'function resolveOpsAlertHealthCardStates(state = {})',
        'function resolveOpsAlertHealthPanelState(state = {})',
        'function buildOpsAlertPanelMetaMarkup(panelState = {}, fallbackText = \'\') {',
        'function buildOpsAlertPanelEmptyMarkup(message = \'\', className = \'ops-alert-monitor-empty\') {',
        'function buildLocalOpsAlertHealthPanelMarkupState(state = opsAlertHealthState || getDefaultOpsAlertHealthState()) {',
        'function applyOpsAlertHealthPanelMarkupState(markupState = {}, elements = {}) {',
        'async function loadOpsAlertHealth(force = false)',
        'loadOpsAlertHealth,',
        'refreshOpsAlertHealthPanel,',
        "requireOpsAlertWorkbenchMethod('fetchAdminWorkbenchOpsAlertMonitor')",
        'const OPS_ALERT_MONITOR_FETCH_TIMEOUT_MS = 8000;',
        'const VERIFY_MONITOR_FETCH_TIMEOUT_MS = 8000;',
        'function getDefaultOpsAlertMonitorState()',
        'function getDefaultOpsAlertMonitorShiftReport()',
        'function normalizeOpsAlertMonitorShiftReport(raw)',
        'function getOpsAlertCustomerChatQuickReplyPreviewPlaceholders(businessType = \'general\') {',
        'function interpolateOpsAlertCustomerChatQuickReplyPreviewText(templateText = \'\', businessType = \'general\') {',
        'function getOpsAlertCustomerChatQuickReplyTemplateValidationErrors(template = {}, options = {}) {',
        'function renderOpsAlertCustomerChatQuickReplyTemplateValidation(row, errors = [], options = {}) {',
        'function syncOpsAlertCustomerChatQuickReplyTemplateValidationState(options = {}) {',
        'function validateOpsAlertCustomerChatQuickReplyTemplatesBeforeSave() {',
        'function setOpsAlertCustomerChatQuickReplyRowExpanded(row, expanded) {',
        'function addOpsAlertCustomerChatQuickReplyTemplate(options = {}) {',
        'function insertOpsAlertCustomerChatQuickReplyToken(row, token) {',
        'function getDefaultOpsAlertMonitorViewState()',
        'function getDefaultOpsAlertMonitorShiftReportViewState() {',
        'function normalizeOpsAlertMonitorShiftReportView(value = \'all\') {',
        'function getOpsAlertMonitorShiftReportViewMeta(value = opsAlertMonitorShiftReportViewState) {',
        'function buildOpsAlertMonitorShiftSharedRuntimeState(currentAdminLabel = \'\') {',
        'function buildOpsAlertMonitorShiftSharedOptions(overrides = {}) {',
        'function buildLocalOpsAlertMonitorShiftShellState(status = \'loading\', options = {})',
        'function resolveOpsAlertMonitorShiftShellState(status = \'loading\', options = {})',
        'function buildOpsAlertMonitorShiftShellMarkup(shellState = {})',
        'function buildLocalOpsAlertMonitorShiftRenderState(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = \'\')',
        'function resolveOpsAlertMonitorShiftRenderState(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = \'\')',
        'function buildLocalOpsAlertMonitorShiftViewSwitchState(currentView = opsAlertMonitorShiftReportViewState)',
        'function resolveOpsAlertMonitorShiftViewSwitchState(currentView = opsAlertMonitorShiftReportViewState)',
        'function buildLocalOpsAlertMonitorShiftTrendState(report = normalizeOpsAlertMonitorShiftReport())',
        'function resolveOpsAlertMonitorShiftTrendState(report = normalizeOpsAlertMonitorShiftReport())',
        'function buildOpsAlertMonitorShiftReportOwnedCategoryItems(categories = [], currentAdminId = resolveOpsAlertMonitorShiftReportCurrentAdminId()) {',
        'function buildOpsAlertMonitorShiftReportViewSwitchMarkup(currentView = opsAlertMonitorShiftReportViewState, precomputedState = null) {',
        "label: '我的接班'",
        'function renderOpsAlertMonitorPanel()',
        'function getOpsAlertRiskSpotlightCategory(filters = getOpsAlertMonitorViewFilters())',
        'function getOpsAlertMonitorAutoResponseTone(status)',
        'function buildOpsAlertRiskThresholdBadges(category = {})',
        'function buildOpsAlertRiskSpotlightActivityItem(item = {}, kind = \'threshold\')',
        'function buildOpsAlertRiskSpotlightActivitySection(title, items = [], emptyMessage = \'\', kind = \'threshold\')',
        'function buildLocalOpsAlertRiskSpotlightRenderState(category = null, filters = getOpsAlertMonitorViewFilters())',
        'function resolveOpsAlertRiskSpotlightRenderState(category = null, filters = getOpsAlertMonitorViewFilters())',
        'function buildLocalOpsAlertRiskSpotlightShellState(status = \'loading\', options = {})',
        'function resolveOpsAlertRiskSpotlightShellState(status = \'loading\', options = {})',
        'function buildOpsAlertRiskSpotlightMarkupFromState(resolvedState = {}, options = {})',
        'function buildOpsAlertRiskSpotlightShellMarkup(shellState = {})',
        'function buildOpsAlertRiskSpotlightMarkup(category = null, filters = getOpsAlertMonitorViewFilters())',
        'function buildLocalOpsAlertRiskSpotlightMarkupState(state = opsAlertMonitorState || getDefaultOpsAlertMonitorState(), filters = getOpsAlertMonitorViewFilters()) {',
        'function resolveOpsAlertRiskSpotlightMarkupState(state = opsAlertMonitorState || getDefaultOpsAlertMonitorState(), filters = getOpsAlertMonitorViewFilters()) {',
        'function applyOpsAlertRiskSpotlightMarkupState(markupState = {}, target = null) {',
        'function renderOpsAlertRiskSpotlight(filters = getOpsAlertMonitorViewFilters())',
        'function buildOpsAlertMonitorShiftReportMarkup(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = \'\')',
        "actionName: 'settings-copy-ops-alert-shift-report'",
        "actionName: 'settings-export-ops-alert-shift-report-csv'",
        'data-admin-action="settings-set-ops-alert-shift-report-view"',
        'function buildOpsAlertMonitorShiftReportSummaryText(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = \'\')',
        'function buildOpsAlertMonitorShiftReportCsvRows(report = normalizeOpsAlertMonitorShiftReport(), currentAdminLabel = \'\')',
        'function setOpsAlertMonitorShiftReportView(value = \'all\') {',
        'function buildLocalOpsAlertMonitorShiftReportMarkupState(state = opsAlertMonitorState || getDefaultOpsAlertMonitorState()) {',
        'function resolveOpsAlertMonitorShiftReportMarkupState(state = opsAlertMonitorState || getDefaultOpsAlertMonitorState()) {',
        'function applyOpsAlertMonitorShiftReportMarkupState(markupState = {}, target = null) {',
        'function renderOpsAlertMonitorShiftReport()',
        'function buildLocalOpsAlertMonitorPanelState(state = {}, filters = getOpsAlertMonitorViewFilters(), categories = [])',
        'function resolveOpsAlertMonitorPanelState(state = {}, filters = getOpsAlertMonitorViewFilters(), categories = [])',
        'function buildLocalOpsAlertMonitorPanelMarkupState(state = {}, filters = getOpsAlertMonitorViewFilters(), categories = [], viewState = null) {',
        'function resolveOpsAlertMonitorPanelMarkupState(state = {}, filters = getOpsAlertMonitorViewFilters(), categories = [], viewState = null) {',
        'function applyOpsAlertMonitorPanelMarkupState(markupState = {}, elements = {}) {',
        'function buildLocalOpsAlertMonitorCategoryRenderState(category = {}, filters = getOpsAlertMonitorViewFilters())',
        'function resolveOpsAlertMonitorCategoryRenderState(category = {}, filters = getOpsAlertMonitorViewFilters())',
        'function resolveOpsAlertMonitorCategoryActionsResolver() {',
        'function resolveOpsAlertMonitorAssignableAdminsNormalizer() {',
        'function resolveOpsAlertCaseRecentEventsNormalizer() {',
        'function resolveOpsAlertCaseRecentEventTextFormatter() {',
        'function resolveOpsAlertCaseSummaryTextFormatter() {',
        'function resolveOpsAlertMonitorWorkspaceActionResolver() {',
        'function resolveOpsAlertMonitorQuickActionResolver() {',
        'function resolveOpsAlertMonitorCaseActionsResolver() {',
        'function resolveOpsAlertMonitorActionContextBuilder() {',
        'function resolveOpsAlertWorkspaceContextAttrsBuilder() {',
        'function resolveOpsAlertMonitorCategoryViewBuilder() {',
        'function resolveOpsAlertMonitorFilterSummaryLabelBuilder() {',
        'function resolveOpsAlertMonitorRecoveryRowBuilder() {',
        'function resolveOpsAlertMonitorBatchRowsBuilder() {',
        'function buildLocalOpsAlertMonitorFilterToolbarState(filters = getOpsAlertMonitorViewFilters())',
        'function resolveOpsAlertMonitorFilterToolbarState(filters = getOpsAlertMonitorViewFilters())',
        "requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertMonitorBatchActionStates')",
        'function resolveOpsAlertMonitorBatchActionStatesFromCategories(categories = [], filters = getOpsAlertMonitorViewFilters()) {',
        'function resolveOpsAlertMonitorBatchActionStates(filters = getOpsAlertMonitorViewFilters())',
        "requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertMonitorViewState')",
        'function resolveOpsAlertMonitorViewState(state = {}, filters = getOpsAlertMonitorViewFilters(), categories = getOpsAlertMonitorPreparedCategories(filters)) {',
        'function getOpsAlertMonitorPreparedCategories(filters = getOpsAlertMonitorViewFilters())',
        'async function copyOpsAlertMonitorChecklist(categoryKey = \'\')',
        'async function copyOpsAlertMonitorShiftReportSummary()',
        'function exportOpsAlertMonitorCsv(categoryKey = \'\')',
        'function exportOpsAlertMonitorShiftReportCsv()',
        'function resolveOpsAlertSettingsSubmitter(options = {}) {',
        'function resolveOpsAlertSecretDeletionSubmitter(options = {}) {',
        "function requireOpsAlertWorkbenchMethod(methodName = '') {",
        "requireOpsAlertWorkbenchMethod('collectAdminWorkbenchOpsAlertUnifiedSummaryDraft')",
        "requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertSummaryModeHintText')",
        "requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertSummaryModeControlState')",
        "requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertUnifiedSummaryDraftControlState')",
        "requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertSummaryOrchestrationRenderState')",
        'function resolveOpsAlertStrategySummaryStateBuilder() {',
        'function resolveOpsAlertStrategyControlStateBuilder() {',
        'function resolveOpsAlertShopRiskControlStateBuilder() {',
        'function resolveOpsAlertMonitorControlStateBuilder() {',
        'function resolveOpsAlertOverviewRenderStateBuilder() {',
        "requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertOverviewStatus')",
        "requireOpsAlertWorkbenchMethod('buildAdminWorkbenchOpsAlertHealthRenderState')",
        'function resolveOpsAlertMonitorFilterToolbarStateBuilder() {',
        'function resolveOpsAlertRiskSpotlightRenderStateBuilder() {',
        'function resolveOpsAlertRiskSpotlightShellStateBuilder() {',
        'function resolveOpsAlertMonitorShiftReportViewNormalizer() {',
        'function resolveOpsAlertMonitorShiftOwnedCategoryItemsBuilder() {',
        'function resolveOpsAlertMonitorShiftShellStateBuilder() {',
        'function resolveOpsAlertMonitorShiftRenderStateBuilder() {',
        'function resolveOpsAlertMonitorShiftViewSwitchStateBuilder() {',
        'function resolveOpsAlertMonitorShiftTrendStateBuilder() {',
        'function resolveOpsAlertMonitorShiftReportSummaryTextBuilder() {',
        'function resolveOpsAlertMonitorShiftReportCsvRowsBuilder() {',
        'function resolveOpsAlertMonitorPanelStateBuilder() {',
        'function resolveOpsAlertMonitorCategoryRenderStateBuilder() {',
        'function resolveOpsAlertCaseMutationItemsBuilder() {',
        'function resolveOpsAlertMonitorBatchItemsBuilder() {',
        'async function loadOpsAlertMonitor(force = false)',
        'setOpsAlertMonitorFilter,',
        'loadOpsAlertMonitor,',
        'refreshOpsAlertMonitorPanel,',
        'copyOpsAlertMonitorChecklist,',
        'exportOpsAlertMonitorCsv,',
        'setOpsAlertMonitorShiftReportView,',
        'copyOpsAlertMonitorShiftReportSummary,',
        'exportOpsAlertMonitorShiftReportCsv',
        'window.schedulePendingOpsAlertWorkspaceRestore?.();',
        'data-ops-alert-quick-reply-move="up"',
        'data-ops-alert-quick-reply-role="collapsed-summary"',
        'data-ops-alert-quick-reply-role="toggle-button"',
        'data-ops-alert-quick-reply-role="body"',
        'data-ops-alert-quick-reply-token="${escapeConfigHtml(token)}"',
        'data-ops-alert-quick-reply-role="preview-text"',
        'data-ops-alert-quick-reply-role="validation"',
        'function getDefaultShopRiskCaseComposerState()',
        'function getShopRiskCaseStatusTone(status)',
        'function getShopRiskCaseStatusLabel(status)',
        'function getOpsAlertMonitorItemCaseActions(category = {}, item = {})',
        'function buildOpsAlertMonitorCaseActionAttrs(action = {}, category = {}, item = {})',
        'function getShopRiskCaseComposerMeta(action, context = {})',
        'function renderShopRiskCaseComposer()',
        'async function submitShopRiskCaseMutation(action, context = {}, options = {})',
        'async function handleShopRiskCaseAction(action, context = {})',
        'async function submitShopRiskCaseComposer()',
        "fetch('/api/admin/settings/ops-alert-monitor-cases'",
        'async function handleShopRiskAction(action, context = {})',
        'handleShopRiskAction,',
        'handleShopRiskCaseAction,',
        'closeShopRiskCaseComposer,',
        'submitShopRiskCaseComposer,',
        "shop_risk: '商城风控'",
        'shop_order_risk: {',
        'auto_response_enabled: true',
        'auto_disable_coupon_min_risk_score: 90',
        'auto_ban_user_min_risk_score: 96',
        'auto_ban_user_duration_days: 7',
        'auto_suspend_product_min_risk_score: 97',
        'email_api_key: { configured: false, source: \'missing\', updatedAt: null }',
        'subject_prefix: \'[Zaoyoe告警]\'',
        "fetch('/api/admin/settings/verify-monitor/quota'",
        "fetch('/api/admin/settings/verify-monitor/queue'",
        'function renderVerifyMonitorFacts()',
        'function renderVerifyMonitorListPagination(target, pagination = {}, actionName = \'\', emptyText = \'\')',
        'async function changeVerifyMonitorPage(kind = \'tasks\', page = 1)',
        'async function changeVerifyMonitorTaskPage(page = 1)',
        'async function changeVerifyMonitorFailurePage(page = 1)',
        'window.changeVerifyMonitorTaskPage = changeVerifyMonitorTaskPage;',
        'window.changeVerifyMonitorFailurePage = changeVerifyMonitorFailurePage;',
        'toggleOpsAlertsEnabled,',
        'toggleOpsAlertTemporaryMuteAllowCritical,',
        'setOpsAlertTemporaryMutePreset,',
        'clearOpsAlertTemporaryMute,',
        'toggleOpsAlertQuietHoursEnabled,',
        'toggleOpsAlertQuietHoursAllowCritical,',
        'toggleOpsAlertShopRiskAutoResponseEnabled,',
        'addOpsAlertCustomerChatQuickReplyTemplate',
        'saveOpsAlertSettings',
        'deleteOpsAlertSecret'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(adminConfigSource.includes(marker), true, `admin-config.js should contain ${marker}`);
    }

    assert.equal(
        adminStudioScript.includes('readOpsAlertWorkspaceContextDataset(actionEl.dataset)'),
        true,
        'admin-studio.js should read ops alert workspace context through the shared workbench dataset helper'
    );

    assert.equal(
        adminStudioCss.includes('#module-ops-alerts .config-card:not(.collapsed) .config-card-body'),
        true,
        'admin-studio.css should allow the dedicated ops alert cards to grow beyond the shared 500px config body cap'
    );

    const workspaceCssMarkers = [
        '.ops-alert-workspace-grid',
        '.ops-alert-workspace-card',
        '.ops-alert-workspace-card--featured',
        '.ops-alert-workspace-card__eyebrow',
        '.ops-alert-workspace-card__actions',
        '.ops-alert-overview-grid',
        '.ops-alert-overview-card',
        '.ops-alert-overview-card__title',
        '.ops-alert-overview-card__chart',
        '.ops-alert-overview-trend',
        '.ops-alert-overview-trend__bars',
        '.ops-alert-overview-trend__footer',
        '.ops-alert-overview-segments',
        '.ops-alert-overview-segment',
        '.ops-alert-overview-card--warning',
        '.ops-alert-strategy-grid',
        '.ops-alert-strategy-card',
        '.ops-alert-mute-status',
        '.ops-alert-mute-actions',
        '.ops-alert-quiet-hours-grid',
        '.ops-alert-routing-grid',
        '.ops-alert-routing-row',
        '.ops-alert-routing-head',
        '.ops-alert-routing-check',
        '.ops-alert-health-grid',
        '.ops-alert-health-card',
        '.ops-alert-health-card__stats',
        '.ops-alert-health-card__errors',
        '.ops-alert-monitor-toolbar',
        '.ops-alert-monitor-filter-btn',
        '.ops-alert-monitor-grid',
        '.ops-alert-risk-spotlight',
        '.ops-alert-risk-spotlight__actions',
        '.ops-alert-risk-spotlight__thresholds',
        '.ops-alert-risk-spotlight__panels',
        '.ops-alert-risk-spotlight__panel',
        '.ops-alert-risk-spotlight__panel-title',
        '.ops-alert-risk-spotlight__panel-list',
        '.ops-alert-risk-spotlight__panel-empty',
        '.ops-alert-risk-spotlight__entry',
        '.ops-alert-risk-spotlight__entry-top',
        '.ops-alert-risk-spotlight__entry-title',
        '.ops-alert-risk-spotlight__entry-summary',
        '.ops-alert-risk-spotlight__entry-meta',
        '.ops-alert-shift-report',
        '.ops-alert-shift-report__actions',
        '.ops-alert-shift-report__view-switch',
        '.ops-alert-shift-report__view-chip',
        '.ops-alert-shift-report__view-summary',
        '.ops-alert-shift-report__metrics',
        '.ops-alert-shift-report__panel',
        '.ops-alert-shift-report__trend-bars',
        '.ops-alert-shift-report__trend-bar',
        '.ops-alert-quick-reply-template.is-collapsed',
        '.ops-alert-quick-reply-template__toggle',
        '.ops-alert-quick-reply-template__collapsed-summary',
        '.ops-alert-quick-reply-template__collapsed-pill',
        '.ops-alert-quick-reply-template__collapsed-text',
        '.ops-alert-quick-reply-template__actions',
        '.ops-alert-quick-reply-template__move',
        '.ops-alert-quick-reply-template.has-validation-error',
        '.ops-alert-quick-reply-template__field.is-invalid',
        '.ops-alert-quick-reply-template__chip--action',
        '.ops-alert-quick-reply-template__preview',
        '.ops-alert-quick-reply-template__preview-pill',
        '.ops-alert-quick-reply-template__preview-body',
        '.ops-alert-quick-reply-template__validation',
        '.ops-alert-monitor-card',
        '.ops-alert-monitor-card__actions',
        '.ops-alert-monitor-item__actions',
        '.admin-shop-risk-case-modal',
        '.admin-shop-risk-case-modal__dialog',
        '.admin-shop-risk-case-modal__actions'
    ];

    for (const marker of workspaceCssMarkers) {
        assert.equal(adminStudioCss.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }
});

test('admin audit monitor exposes delegated settings actions and runtime wiring', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioCss = readRepoFile('admin-studio.css');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminConfigSource = readRepoFile('admin-config.js');

    const htmlMarkers = [
        'id="adminAuditMonitorLastRefresh"',
        'data-admin-action="settings-refresh-admin-audit-monitor"',
        'id="adminAuditMonitorAccessCard"',
        'id="adminAuditMonitorFactsPanel"',
        'id="adminAuditMonitorFactsGrid"',
        'id="adminAuditMonitorRecentAccess"',
        'id="adminAuditMonitorAccessPagination"',
        'id="adminAuditMonitorAnomalyList"',
        'id="adminAuditMonitorAnomalyPagination"',
        'id="adminAuditMonitorConfigPagination"',
        'id="adminAuditMonitorConfigList"'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const handlerMarkers = [
        "case 'settings-refresh-admin-audit-monitor':",
        "case 'settings-change-admin-audit-access-page':",
        "case 'settings-change-admin-audit-anomaly-page':",
        "case 'settings-change-admin-audit-config-page':"
    ];

    for (const marker of handlerMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const runtimeMarkers = [
        'function getDefaultAdminAuditMonitorState()',
        'function renderAdminAuditMonitorFacts()',
        'function renderAdminAuditMonitorListPagination(target, pagination = {}, actionName = \'\', emptyText = \'\')',
        "new URL('/api/admin/settings/admin-audit-monitor', window.location.origin)",
        'window.loadAdminAuditMonitor = loadAdminAuditMonitor;',
        'window.refreshAdminAuditMonitor = refreshAdminAuditMonitor;',
        'window.changeAdminAuditMonitorAccessPage = changeAdminAuditMonitorAccessPage;',
        'window.changeAdminAuditMonitorAnomalyPage = changeAdminAuditMonitorAnomalyPage;',
        'window.changeAdminAuditMonitorConfigPage = changeAdminAuditMonitorConfigPage;'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(adminConfigSource.includes(marker), true, `admin-config.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.admin-audit-monitor-grid',
        '.admin-audit-monitor-card--danger',
        '.admin-audit-monitor-panel--wide',
        '.admin-audit-monitor-facts',
        '.admin-audit-monitor-fact-card',
        '.admin-audit-monitor-pagination'
    ];

    for (const marker of cssMarkers) {
        assert.equal(adminStudioCss.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }
});

test('shop admin pagination renderer no longer emits inline handler attributes', () => {
    const source = readRepoFile('js/admin-shop.js');
    const start = source.indexOf('renderPagination: function');
    const end = source.indexOf('// Render Product Category Filter Buttons dynamically');
    const snippet = source.slice(start, end);
    const inlineHandlerPattern = /\bon(?:click|change|submit|mousedown|mouseup|input|keydown|mouseover|mouseout|error|load)\s*=\s*["']/i;

    assert.notEqual(start, -1, 'js/admin-shop.js should define renderPagination');
    assert.notEqual(end, -1, 'js/admin-shop.js should keep the pagination block bounded');
    assert.equal(inlineHandlerPattern.test(snippet), false, 'renderPagination should not emit inline event handler attributes');
    assert.equal(snippet.includes('data-shop-action="pagination-go"'), true, 'renderPagination should expose delegated pagination actions');
    assert.equal(snippet.includes('data-pagination-target="${loadFuncStr}"'), true, 'renderPagination should expose delegated pagination targets');
    assert.equal(snippet.includes('data-shop-change="pagination-go"'), true, 'renderPagination should expose delegated pagination inputs');
    assert.equal(source.includes('bindDelegatedHandlers: function'), true, 'js/admin-shop.js should bind delegated pagination handlers');
});

test('admin studio routes hardened shell and dashboard controls through delegated actions', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');

    const removedInlineMarkers = [
        `onclick="switchModule('gallery')"`,
        `onclick="switchView('create')"`,
        `onclick="switchCommentView('guestbook')"`,
        `onclick="switchSettingsView('pricing')"`,
        `onclick="HomepageAdmin.switchSection('hero')"`,
        `onclick="AdminPayments.switchTab('overview')"`,
        `onclick="toggleDateRangeDropdown()"`,
        `onclick="switchAnalyticsTab('users')"`
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(adminStudioSource.includes(marker), false, `admin-studio.html should not contain ${marker}`);
    }

    const delegatedMarkers = [
        'data-admin-action="switch-module"',
        'data-admin-action="switch-gallery-view"',
        'data-admin-action="switch-comment-view"',
        'data-admin-action="switch-settings-view"',
        'data-admin-action="switch-ops-alerts-view"',
        'data-admin-action="homepage-switch-section"',
        'data-admin-action="payments-switch-tab"',
        'data-admin-action="analytics-switch-tab"',
        'data-admin-action="analytics-toggle-advanced-tools"',
        'data-admin-change-action="comments-toggle-select-all"',
        'data-admin-change-action="homepage-handle-screenshot-upload"'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(adminStudioScript.includes('[data-admin-action]'), true, 'admin-studio.js should delegate click controls');
    assert.equal(adminStudioScript.includes('[data-admin-change-action]'), true, 'admin-studio.js should delegate change controls');
});

test('admin studio points and users controls route through delegated actions', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminStudioStyles = readRepoFile('admin-studio.css');
    const adminUsersSource = readRepoFile('admin-users.js');

    const removedInlineMarkers = [
        `onclick="switchPointsView('batches')"`,
        `onkeydown="if(event.key==='Enter') searchCodeInBatches()"`,
        `onclick="toggleBatchDateFilter()"`,
        `onclick="filterBatchByDate('all')"`,
        `onclick="toggleBatchChannelFilter()"`,
        `onclick="filterBatchByChannel('all')"`,
        `onclick="toggleBatchPackageFilter()"`,
        `onclick="filterBatchByPackage('all')"`,
        `onclick="toggleBatchExportMenu()"`,
        `onclick="exportBatchList()"`,
        `onclick="toggleBatchSelectMode()"`,
        `onclick="togglePointsBatchActionsMenu()"`,
        `onclick="batchInvalidateCodes()"`,
        `onchange="toggleSelectAllBatches()"`,
        `onclick="sortBatches('name')"`,
        `onsubmit="generateCodes(event)"`,
        `onclick="copyAllCodes()"`,
        `onclick="downloadCodesCSV()"`,
        `onclick="lookupCode()"`,
        `onclick="toggleUserStatusFilter()"`,
        `onclick="filterUserByStatus('all')"`,
        `onclick="toggleUserLevelFilter()"`,
        `onclick="filterUserByLevel('all')"`,
        `onclick="toggleUserRoleFilter()"`,
        `onclick="filterUserByRole('all')"`,
        `onchange="toggleUserTestAccountVisibility(this.checked)"`,
        `onclick="toggleUserSelectMode()"`,
        `onclick="toggleUserBatchMenu()"`,
        `onclick="selectAllUsersOnPage()"`,
        `onclick="batchSendNotification()"`,
        `onclick="batchAdjustPoints()"`,
        `onclick="batchAddTags()"`,
        `onclick="batchExportUsers()"`,
        `onclick="batchBanUsers()"`,
        `onclick="closeUserModal()"`,
        `onclick="switchUserTab('ledger')"`
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(adminStudioSource.includes(marker), false, `admin-studio.html should not contain ${marker}`);
    }

    const delegatedMarkers = [
        'data-admin-action="points-switch-view"',
        'data-points-view="catalog"',
        'data-admin-keydown-action="points-search-enter"',
        'data-admin-action="points-toggle-date-filter"',
        'data-admin-action="points-filter-date"',
        'data-admin-action="points-toggle-channel-filter"',
        'data-admin-action="points-filter-channel"',
        'data-admin-action="points-toggle-package-filter"',
        'data-admin-action="points-filter-package"',
        'data-admin-action="points-toggle-export-menu"',
        'data-admin-action="points-export-batch-list"',
        'data-admin-action="points-toggle-select-mode"',
        'data-admin-action="points-toggle-actions-menu"',
        'data-admin-change-action="points-toggle-select-all-batches"',
        'data-admin-action="points-sort-batches"',
        'data-admin-action="points-copy-all-codes"',
        'data-admin-action="points-download-codes-csv"',
        'data-admin-action="points-lookup-code"',
        'data-admin-action="users-toggle-status-filter"',
        'data-admin-action="users-filter-status"',
        'data-admin-action="users-toggle-level-filter"',
        'data-admin-action="users-filter-level"',
        'data-admin-action="users-toggle-role-filter"',
        'data-admin-action="users-filter-role"',
        'data-admin-change-action="users-toggle-test-accounts"',
        'data-admin-action="users-toggle-select-mode"',
        'data-admin-action="users-toggle-batch-menu"',
        'data-admin-action="users-select-all-page"',
        'data-admin-action="users-batch-send-notification"',
        'data-admin-action="users-batch-adjust-points"',
        'data-admin-action="users-batch-add-tags"',
        'data-admin-action="users-batch-export"',
        'data-admin-action="users-batch-ban"',
        'id="userTabNav"'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(adminStudioSource.includes('js/ios-scroll-lock.js'), true, 'admin-studio.html should load the shared iOS scroll lock helper');
    assert.equal(adminStudioScript.includes('points-switch-view'), true, 'admin-studio.js should handle points tab delegation');
    assert.equal(adminStudioScript.includes('users-switch-tab'), true, 'admin-studio.js should handle user modal tab delegation');
    assert.equal(adminUsersSource.includes('USER_MODAL_TAB_REGISTRY'), true, 'admin-users.js should register user modal tabs centrally');
    assert.equal(adminUsersSource.includes('renderUserTabNavigation(activeTab = currentTab)'), true, 'admin-users.js should render the user modal tab nav from the registry');
    assert.equal(adminStudioScript.includes('function measureAdminStudioScrollbarGap()'), true, 'admin-studio.js should measure the viewport scrollbar gap before locking the background');
    assert.equal(adminStudioScript.includes('function observeAdminStudioModalScrollLock()'), true, 'admin-studio.js should observe modal visibility and lock background scroll');
    assert.equal(adminStudioStyles.includes('body.ios-scroll-lock-fixed'), true, 'admin-studio.css should define the fixed-body scroll lock state');
    assert.equal(adminStudioStyles.includes('scrollbar-gutter: stable;'), true, 'admin-studio.css should reserve a stable root scrollbar gutter for modal transitions');
    assert.equal(adminStudioStyles.includes('right: var(--admin-scroll-lock-gap, 0px);'), true, 'admin-studio.css should compensate the hidden scrollbar width while a modal is open');
    assert.equal(adminStudioScript.includes('[data-admin-keydown-action]'), true, 'admin-studio.js should delegate keydown-based admin controls');
    assert.equal(adminStudioScript.includes("form.id === 'generateCodesForm'"), true, 'admin-studio.js should delegate points generate form submission');
});

test('admin user runtime renderers route list, modal, toolbar, and notification controls through delegated actions', () => {
    const adminUsersSource = readRepoFile('admin-users.js');
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminStudioStyles = readRepoFile('admin-studio.css');

    const removedInlineMarkers = [
        `onclick="openUserDrawer('`,
        `<td class="checkbox-col" onclick="event.stopPropagation()">`,
        `onchange="toggleUserSelection('`,
        `onclick="navigator.clipboard.writeText('`,
        `onclick="showTagInput('`,
        `onclick="removeUserTag('`,
        `onchange="handleModalAdminToggle('`,
        `onclick="saveModalAdminPermissions('`,
        `onclick="toggleUserBlock('`,
        `onclick="adjustUserPoints('`,
        `onclick="resetUserAvatar('`,
        `onclick="clearAllUserContent('`,
        `onclick="showNotificationModal('`,
        `onclick="toggleModalDropdown('ledgerTimeDropdown')"`,
        `onclick="filterTabByDate('ledger', 'all', '全部时间')"`,
        `onclick="openCustomDatePicker('ledger')"`,
        `onclick="exportTabData('ledger')"`,
        `onclick="openAdminLedgerDetail('`,
        `onclick="openUserModal('`,
        `oninput="autoResizeNotesInput(this)"`,
        `onclick="submitUserNote()"`,
        `onclick="selectNotifType(this, 'info')"`,
        `onclick="sendSystemNotification('`,
        `onclick="window._resolveBatchTag('`,
        `onclick="this.closest('.modal-overlay').remove()"`,
        `onclick="if(event.target === this) closeBanUserModal()"`,
        `onclick="toggleBanSelection(this, 'guestbook', 'unban')"`,
        `onclick="showBanDetails(null)"`,
        `onclick="executeBanSelection()"`,
        `onclick="closePointsModal()"`,
        `onclick="closeClearContentModal()"`,
        'modalOverlay.style.cssText =',
        'modal.style.cssText =',
        "const style = document.createElement('style');",
        "modal.style.display = 'flex'",
        "modal.style.display = 'none'",
        'class="notes-container" style="display:flex',
        'class="audit-list" id="auditList" style="padding:16px',
        'style="margin-right: 8px;"',
        'style="font-size:0.9rem;color:#94a3b8;margin-left:6px;"',
        'class="modal-content" style="max-width: 400px;"',
        'class="modal-body" style="padding: 20px;"',
        'style="display: flex; flex-wrap: wrap; gap: 10px;"',
        'style="width: 100%; padding: 10px; border-radius: 8px;',
        'class="modal-title" style="color:#ef4444;"',
        'class="modal-body" style="padding: 0 24px 24px 24px;"',
        'class="scope-pill success" style="width:100%;justify-content:center;"',
        'data-users-ban-action="details" style="margin-right:auto;background:transparent;',
        'class="checklist-container" style="background:rgba(0,0,0,0.02);',
        'class="checkbox-item" style="display:flex;align-items:center;padding:8px 0;cursor:pointer;"',
        'id="ccConfirmInput" class="modal-input" placeholder="输入密匙" style="border-color: #fca5a5;"',
        'id="ccConfirmBtn" style="background:#ef4444; color:white; border:none; box-shadow:0 2px 8px rgba(239, 68, 68, 0.4);"',
        'style="text-align:center;color:var(--text-dim);padding:20px;"',
        'emptyDiv.style.cssText =',
        "emptyDiv.style.display = 'flex'",
        "emptyDiv.style.display = 'none'",
        'style="margin-left:auto;"',
        'style="display: ${roleInfo.is_admin ? \'block\' : \'none\'}; margin-top: 0;"',
        'style="font-size:1rem;color:#fca5a5;margin-bottom:10px;"',
        'style="margin-bottom:18px;"',
        'style="background:${bgColor};display:flex;align-items:center;justify-content:center;color:white;',
        'style="width: 80px; padding: 3px 8px; border-radius: 20px;',
        "btn.style.background = '#10b981'",
        "btn.style.background = '#ef4444'",
        "btn.style.background = '#94a3b8'",
        "indicator.style.setProperty('--users-tab-indicator-left'",
        "container.style.setProperty('--pill-count'",
        "container.style.setProperty('--indicator-color'",
        "instance.calendarContainer.style.setProperty('z-index', '2147483647', 'important')",
        "el.style.setProperty('--users-note-height'",
        "confirmBtn.style.opacity = '1'",
        "confirmBtn.style.cursor = 'pointer'",
        "confirmBtn.style.opacity = '0.5'",
        "confirmBtn.style.cursor = 'not-allowed'"
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(adminUsersSource.includes(marker), false, `admin-users.js should not contain ${marker}`);
    }

    const delegatedMarkers = [
        'data-admin-action="users-open-drawer"',
        'data-admin-change-action="users-toggle-select-all-page"',
        'data-admin-change-action="users-toggle-selection"',
        'data-avatar-fallback-src="https://via.placeholder.com/40"',
        'data-avatar-fallback-src="https://via.placeholder.com/80"',
        'data-admin-action="users-copy-meta"',
        'data-admin-action="users-show-tag-input"',
        'data-admin-action="users-apply-permission-template"',
        'data-admin-action="users-remove-tag"',
        'data-admin-change-action="users-toggle-modal-admin"',
        'data-admin-action="users-save-modal-admin-permissions"',
        'data-admin-action="users-toggle-block"',
        'data-admin-action="users-adjust-points"',
        'data-admin-action="users-reset-avatar"',
        'data-admin-action="users-clear-content"',
        'data-admin-action="users-show-notification"',
        'data-admin-action="users-toggle-modal-dropdown"',
        'data-admin-action="users-filter-tab-date"',
        'data-admin-action="users-open-custom-date-picker"',
        'data-admin-action="users-export-tab-data"',
        'data-admin-action="users-open-ledger-detail"',
        'data-admin-action="users-open-user-modal"',
        'data-admin-action="users-reload-tab"',
        'data-users-note-input="1"',
        'data-admin-action="users-submit-note"',
        'data-admin-action="users-select-notification-type"',
        'data-admin-action="users-send-notification"',
        'batch-export-modal-overlay',
        'notification-modal-overlay',
        'users-notes-container',
        'users-audit-item',
        'users-modal-title-count',
        'users-hidden-date-picker',
        'users-batch-tag-modal',
        'users-ban-actions',
        'users-clear-confirm-btn',
        'users-table-empty-state',
        'users-empty-tag',
        'modal-permissions-panel--flush',
        'users-affiliate-error-state',
        'users-ledger-reason-row',
        'users-ban-confirm-btn--ban',
        'initials-avatar--tone-',
        'users-points-modal-footer',
        'users-points-form-group-first',
        'custom-tag-input',
        'data-batch-tag-value="',
        'data-batch-tag-submit="1"',
        'data-users-ban-action="select"',
        'data-users-ban-action="details"',
        'data-users-ban-action="confirm"',
        'data-users-clear-action="close"',
        'document.documentElement.dataset.adminUsersRuntimeDelegatesBound',
        "target.matches('[data-users-tag-input=\"1\"]')",
        'function setModalAdminPermissionsSectionVisible(',
        'function getAdminRoleExpiryMeta(',
        'function showBatchAdminRenewModal(',
        'function batchRenewAdminAccess(',
        'function showBatchAdminExpiryModal(',
        'function batchSetAdminExpiry(',
        'function bindBanUserModalInteractions(overlay)',
        'function bindPointsModalInteractions(overlay)',
        'function bindClearContentModalInteractions(overlay)',
        'function animateUsersOverlayIn(',
        'function animateUsersOverlayOut(',
        'function renderUserTabNavigation(activeTab = currentTab)',
        'async function ensureUserModalTabData(tabName, options = {})',
        'function reloadUserModalTab(tabName, options = {})',
        'function scheduleUserModalTabPrefetch(activeTab = currentTab)',
        'function clearUserModalTabPrefetch()',
        'function createDefaultUserModalTabFilterState(tabName = \'\')',
        'function getUserModalTabFilterState(tabName = \'\')',
        'function getUserModalTabVisibleData(tabName = \'\', dataOverride)',
        'captureUserModalTabUiState()',
        'function formatUserModalTabLoadedAt(value)',
        'function getUserModalTabFreshnessMeta(tabName = \'\')',
        'function userTabSupportsToolbar(tabName = \'\')',
        'function buildUserTabStateShell(tabName = currentTab, options = {})',
        'function buildUserTabLoadingBody(tabName = currentTab)',
        'function buildAffiliateTabLoadingSkeleton()',
        'function buildUserTabActionBanner(tabName = \'\')',
        'function buildUserTabRefreshOverlay(tabName = \'\', variant = \'list\')',
        'function wrapUserTabRefreshShell(tabName = \'\', contentMarkup = \'\', options = {})',
        'function buildUserTabStandaloneActions(tabName = \'\', options = {})',
        'function buildUserTabToolbarMeta(tabName = \'\')',
        'function setUserModalTabFeedback(tabName = \'\', message = \'\', tone = \'info\')',
        'function patchUserModalTabState(tabName = \'\', updates = {})',
        'function buildPendingUserNoteItem(note = {})',
        'function clearUserModalTabFeedbackDismiss(tabName = \'\')',
        'function clearAllUserModalTabFeedbackDismiss()',
        'function clearUserModalTabFeedback(tabName = \'\', options = {})',
        'function scheduleUserModalTabFeedbackDismiss(tabName = \'\', tone = \'info\', durationMs = null)',
        'tabContent.innerHTML = buildUserTabLoadingState(currentTab);',
        "const USER_MODAL_SESSION_STORAGE_KEY = 'admin_studio_user_modal_state_v1'",
        'function getUserModalUrlState()',
        'function buildUserModalRestoreStateForUser(userId, options = {})',
        'function syncUserModalUrlState(options = {})',
        'function syncCurrentUserModalPersistentState()',
        'async function maybeRestoreUserModalFromUrl()',
        'window.sessionStorage.getItem(USER_MODAL_SESSION_STORAGE_KEY)',
        "window.history.replaceState(window.history.state, '', nextRelativeUrl);",
        'void maybeRestoreUserModalFromUrl();',
        'async function fetchUserNotes(userId)',
        'async function fetchUserAuditLogs(userId)',
        'async function fetchUserAffiliateBundle(userId)',
        'fetchUserPaymentOrders(userId)',
        'function renderPaymentsTab(container, rawData = currentModalData.paymentOrders || [])',
        'renderPaymentItems(data)',
        'normalizeUserModalTab(tabName = \'\')',
        'data-tab-state="${escapeHtml(visualState)}"',
        'window.requestIdleCallback',
        'const visibleData = getUserModalTabVisibleData(normalizedTab);',
        'noteSubmitting: false,',
        'pendingNotePreview: null',
        'feedbackClosing: false'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminUsersSource.includes(marker), true, `admin-users.js should contain ${marker}`);
    }

    assert.equal(
        adminStudioSource.includes('data-admin-action="users-batch-renew-admin"'),
        true,
        'admin-studio.html should expose the batch admin renewal action in the users batch menu'
    );

    assert.equal(
        adminStudioSource.includes('data-admin-action="users-batch-set-admin-expiry"'),
        true,
        'admin-studio.html should expose the batch admin expiry setter action in the users batch menu'
    );

    const delegatedHandlerMarkers = [
        "case 'users-open-drawer':",
        "case 'users-stop-propagation':",
        "case 'users-copy-meta':",
        "case 'users-show-tag-input':",
        "case 'users-apply-permission-template':",
        "case 'users-remove-tag':",
        "case 'users-save-modal-admin-permissions':",
        "case 'users-batch-renew-admin':",
        "case 'users-batch-set-admin-expiry':",
        "case 'users-toggle-block':",
        "case 'users-adjust-points':",
        "case 'users-reset-avatar':",
        "case 'users-clear-content':",
        "case 'users-show-notification':",
        "case 'users-toggle-modal-dropdown':",
        "case 'users-filter-tab-date':",
        "case 'users-open-custom-date-picker':",
        "case 'users-export-tab-data':",
        "case 'users-open-ledger-detail':",
        "case 'users-close-ledger-detail':",
        "case 'users-open-user-modal':",
        "case 'users-reload-tab':",
        "case 'users-reload-affiliate':",
        "case 'users-submit-note':",
        "case 'users-close-notification-modal':",
        "case 'users-select-notification-type':",
        "case 'users-send-notification':",
        "case 'users-toggle-admin-expiry-filter':",
        "case 'users-filter-admin-expiry':",
        "case 'users-toggle-select-all-page':",
        "case 'users-toggle-selection':",
        "case 'users-toggle-modal-admin':"
    ];

    for (const marker of delegatedHandlerMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.batch-export-modal-overlay',
        '.notification-modal-overlay',
        '.users-notes-container',
        '.users-audit-item',
        '.users-modal-title-count',
        '.users-hidden-date-picker',
        '.users-batch-tag-modal',
        '.users-ban-actions',
        '.users-clear-confirm-btn',
        '.users-table-empty-state',
        '.modal-permissions-panel--flush',
        '.modal-permissions-panel--admin-collapsed',
        '.perm-section--collapsible',
        '.perm-section--collapsed',
        '.perm-template-grid',
        '.perm-coverage-card',
        '.users-batch-renew-modal',
        '.users-batch-renew-card',
        '.users-batch-expiry-modal',
        '.users-batch-expiry-input',
        '.admin-ledger-item--emerald',
        '.admin-ledger-modal-overlay.active',
        '.admin-ledger-modal-overlay.active .admin-ledger-modal',
        '.users-affiliate-error-state',
        '.users-ledger-reason-row',
        '.users-ban-confirm-btn--ban',
        '.initials-avatar--tone-0',
        '.users-points-modal-footer',
        '.custom-tag-input',
        '.scope-options-pills--tone-unban',
        '.users-fixed-flatpickr-calendar',
        '.audit-diff-pill',
        '.admin-expiry-chip',
        '.user-row--admin-expiring',
        '.users-notes-input--overflow',
        '.users-payment-item',
        '.users-payment-head',
        '.users-payment-focus-pill',
        '.user-tab-status-dot',
        '@keyframes userTabStatusPulse',
        '.users-tab-state',
        '.users-tab-state-header',
        '.users-tab-skeleton-card',
        '.users-tab-skeleton-dashboard',
        '.users-tab-retry-btn',
        '@keyframes userTabSkeletonSweep',
        '.users-tab-inline-banner',
        '.users-tab-inline-banner.is-closing',
        '.users-tab-refresh-shell',
        '.users-tab-toolbar--standalone',
        '.users-tab-toolbar-main',
        '.users-tab-standalone-actions',
        '.users-tab-toolbar-meta',
        '.users-tab-freshness-chip',
        '.users-note-item--pending',
        '.users-note-pending-chip'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStudioStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    assert.equal(adminStudioSource.includes('id="userTabNav"'), true, 'admin-studio.html should expose a dedicated container for registry-driven user detail tabs');
});

test('admin points runtime renderers route batch tables and modals through delegated actions', () => {
    const adminPointsSource = readRepoFile('admin-points.js');
    const inlineHandlerPattern = /\bon(?:click|change|submit|input|keydown|blur|error)\s*=\s*["']/i;

    assert.equal(
        inlineHandlerPattern.test(adminPointsSource),
        false,
        'admin-points.js should not emit inline event handler attributes'
    );

    const delegatedMarkers = [
        'data-points-action="batch-row-stop"',
        'data-points-change="toggle-selection"',
        'data-points-action="view-batch-codes"',
        'data-points-action="open-batch-edit"',
        'data-points-action="export-batch-codes"',
        'data-points-action="copy-code-item"',
        'data-points-action="go-batch-page"',
        'data-points-overlay-close="delete-options"',
        'data-points-action="close-delete-options"',
        'data-points-action="execute-delete-option"',
        'data-points-overlay-close="codes"',
        'data-points-action="close-codes-modal"',
        "action: 'open-batch-edit-from-codes'",
        "action: 'reissue-batch-from-codes'",
        "action: 'export-batch-codes-from-modal'",
        "action: 'invalidate-batch-from-codes'",
        'data-points-action="navigate-user"',
        "action: 'lookup-code-item'",
        "action: 'set-code-expiry'",
        "action: 'disable-code'",
        "action: 'revoke-code'",
        "action: 'enable-code'",
        'data-points-overlay-close="batch-edit"',
        'data-points-overlay-close="package-delete"',
        'data-points-overlay-close="batch-invalidate"',
        'data-points-overlay-close="code-action"',
        'data-points-action="close-batch-edit"',
        'data-points-action="close-package-delete-modal"',
        'data-points-action="close-batch-invalidate-modal"',
        'data-points-action="close-code-action-modal"',
        'data-points-submit="save-batch-edit"',
        'data-points-submit="submit-package-delete"',
        'data-points-submit="submit-batch-invalidate"',
        'data-points-submit="submit-code-action"',
        'data-points-action="navigate-batch"',
        'function bindAdminPointsRuntimeDelegates()',
        "document.documentElement.dataset.adminPointsRuntimeDelegatesBound === '1'",
        "case 'execute-delete-option':",
        "case 'navigate-user':",
        "case 'invalidate-batch-from-codes':",
        "case 'save-batch-edit':",
        'window.navigateToBatch = navigateToBatch;',
        "overlay.classList.add('is-visible')",
        "overlay.classList.remove('is-visible')"
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminPointsSource.includes(marker), true, `admin-points.js should contain ${marker}`);
    }
});

test('user modal expiry picker uses a body-mounted floating flatpickr inside the permissions panel', () => {
    const adminUsersSource = readRepoFile('admin-users.js');
    const adminStudioStyles = readRepoFile('admin-studio.css');

    assert.match(
        adminUsersSource,
        /function destroyModalRoleExpiryPicker\(\)/,
        'admin-users.js should expose a dedicated cleanup path for the modal expiry picker'
    );
    assert.match(
        adminUsersSource,
        /function bindFloatingFlatpickrCalendar\(instance, anchorEl, scrollContainer = null\)/,
        'admin-users.js should centralize floating flatpickr positioning for the modal expiry input'
    );
    assert.match(
        adminUsersSource,
        /appendTo:\s*document\.body/,
        'admin-users.js should append the role expiry flatpickr to document.body to avoid modal column drift'
    );
    assert.match(
        adminUsersSource,
        /instance\._scheduleFloatingPosition/,
        'admin-users.js should keep a reusable reposition hook for the modal expiry flatpickr'
    );
    assert.match(
        adminStudioStyles,
        /\.users-fixed-flatpickr-calendar\s*\{[\s\S]*position:\s*fixed !important;/,
        'admin-studio.css should keep the fixed-position flatpickr helper class for floating calendars'
    );
});

test('admin studio centralizes module permissions and gates sidebar modules through the shared registry', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const bootstrapSource = readRepoFile('js/admin-studio-bootstrap.js');
    const sidebarStyles = readRepoFile('admin-sidebar.css');

    assert.doesNotMatch(
        adminStudioSource,
        /data-module="business-overview"[\s\S]*?<span>经营总览<\/span>/,
        'admin-studio.html should remove the standalone business overview sidebar entry after consolidating overview into the growth center'
    );
    assert.match(
        adminStudioSource,
        /data-module="growth-center"[\s\S]*?<span>增长经营<\/span>/,
        'admin-studio.html should expose the growth center sidebar entry for the analytics center split'
    );
    assert.match(
        adminStudioSource,
        /data-module="commerce-center"[\s\S]*?<span>商品经营<\/span>/,
        'admin-studio.html should expose the commerce center sidebar entry for the analytics center split'
    );
    assert.match(
        adminStudioSource,
        /js\/admin-studio-bootstrap\.js\?v=20260407_ANALYTICS_CENTER_BOOTSTRAP_8/,
        'admin-studio.html should load the cache-busted admin studio bootstrap for the split analytics center aliases'
    );
    assert.match(
        bootstrapSource,
        /window\.ADMIN_PERMISSION_GROUPS\s*=\s*ADMIN_PERMISSION_GROUPS/,
        'admin-studio-bootstrap.js should expose the shared admin permission groups'
    );
    assert.match(
        bootstrapSource,
        /window\.hasModulePermission\s*=\s*hasModulePermission/,
        'admin-studio-bootstrap.js should expose a module-level permission guard helper'
    );
    assert.match(
        bootstrapSource,
        /function syncAdminStudioModuleAccess\(options = \{\}\)/,
        'admin-studio-bootstrap.js should centralize sidebar permission syncing'
    );
    assert.match(
        bootstrapSource,
        /function scheduleAdminChatPrewarm\(\)/,
        'admin-studio-bootstrap.js should prewarm the admin chat module after access resolves'
    );
    assert.match(
        bootstrapSource,
        /function scheduleHomepageModulePrewarm\(\)/,
        'admin-studio-bootstrap.js should prewarm the homepage module after access resolves'
    );
    assert.match(
        bootstrapSource,
        /window\.HomepageAdmin\.prefetch\(\)/,
        'admin-studio-bootstrap.js should call HomepageAdmin.prefetch during idle prewarm'
    );
    assert.match(
        bootstrapSource,
        /if \(normalizedModuleName === 'shop' && typeof window\.ShopAdmin\?\.init === 'function'\)/,
        'admin-studio-bootstrap.js should initialize the shop workspace as soon as the shop module becomes active'
    );
    assert.match(
        bootstrapSource,
        /if \(hasModulePermission\('shop'\) && initialModule === 'shop'\)/,
        'admin-studio-bootstrap.js should only auto-init ShopAdmin on window load when shop is the active startup module'
    );
    assert.match(
        bootstrapSource,
        /adminModuleAccessNotice/,
        'admin-studio-bootstrap.js should render a dedicated empty state when no module permissions are assigned'
    );
    assert.match(
        bootstrapSource,
        /const ADMIN_ANALYTICS_MODULE_ALIASES = \{/,
        'admin-studio-bootstrap.js should define the split analytics sidebar alias registry'
    );
    assert.match(
        bootstrapSource,
        /function getAdminAnalyticsSidebarModuleIdForTab\(tabId = '', options = \{\}\)/,
        'admin-studio-bootstrap.js should map analytics tabs back to the split sidebar entries'
    );
    assert.match(
        bootstrapSource,
        /case 'overview':\s*return 'growth-center';/,
        'admin-studio-bootstrap.js should keep overview inside the growth center'
    );
    assert.match(
        bootstrapSource,
        /'growth-center': \{[\s\S]*defaultTab: 'overview'/,
        'admin-studio-bootstrap.js should default the growth center to the overview tab'
    );
    assert.match(
        bootstrapSource,
        /const isPlainCommerceEntry = normalizedModuleName === 'analytics'[\s\S]*analyticsConfig\?\.sidebarModuleId === 'commerce-center'[\s\S]*analyticsTab === 'product'/,
        'admin-studio-bootstrap.js should detect plain commerce-center entry before restoring analytics state'
    );
    assert.match(
        bootstrapSource,
        /window\.resetAnalyticsProductDetailRuntime\(\{ resetPanel: true \}\);/,
        'admin-studio-bootstrap.js should clear stale product-detail runtime state before entering commerce-center directly'
    );
    assert.match(
        bootstrapSource,
        /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\);/,
        'admin-studio-bootstrap.js should return the viewport to the top for plain commerce-center entry'
    );
    assert.match(
        bootstrapSource,
        /function resolveAdminAnalyticsModuleConfig\(moduleId = '', options = \{\}\)/,
        'admin-studio-bootstrap.js should resolve analytics aliases through a shared module config helper'
    );
    assert.match(
        bootstrapSource,
        /function syncAdminStudioAnalyticsSidebar\(tabId = '', options = \{\}\)/,
        'admin-studio-bootstrap.js should keep the split analytics sidebar entries in sync with the active analytics tab'
    );
    assert.match(
        bootstrapSource,
        /analyticsConfig\?\.routeModuleId \|\| 'growth-center'/,
        'admin-studio-bootstrap.js should sync analytics urls to the active split sidebar route'
    );
    assert.match(
        bootstrapSource,
        /window\.getAdminAnalyticsSidebarModuleIdForTab = getAdminAnalyticsSidebarModuleIdForTab;/,
        'admin-studio-bootstrap.js should expose the analytics sidebar alias resolver'
    );
    assert.match(
        bootstrapSource,
        /window\.syncAdminStudioAnalyticsSidebar = syncAdminStudioAnalyticsSidebar;/,
        'admin-studio-bootstrap.js should expose the split analytics sidebar sync helper'
    );
    assert.match(
        bootstrapSource,
        /function attachAnalyticsWorkspace\(moduleId = ''\)/,
        'admin-studio-bootstrap.js should move the shared analytics workspace into the active split module container'
    );
    assert.match(
        bootstrapSource,
        /return activateAdminStudioModule\(requestedModuleName, options\);/,
        'admin-studio-bootstrap.js should preserve split analytics sidebar aliases when switchModule delegates to activateAdminStudioModule'
    );
    assert.match(
        bootstrapSource,
        /window\.syncAnalyticsRouteState\(\{\s*view: analyticsTab,\s*sectionId: analyticsSectionId,\s*promptId: analyticsPromptId,\s*productId: analyticsProductId,\s*detailFocus: analyticsDetailFocus\s*\}/,
        'admin-studio-bootstrap.js should seed analytics route state before switching split analytics modules so sidebar clicks land on the correct module root'
    );
    assert.match(
        sidebarStyles,
        /\.sidebar-item\.disabled\s*\{[\s\S]*cursor:\s*not-allowed;/,
        'admin-sidebar.css should visibly lock unauthorized sidebar modules'
    );
});

test('user modal renders overview cards and grouped permission checklists from the shared admin permission registry', () => {
    const adminUsersSource = readRepoFile('admin-users.js');
    const adminStudioStyles = readRepoFile('admin-studio.css');

    assert.match(
        adminUsersSource,
        /function renderAdminPermissionChecklist\(permissionList = \[\]\)/,
        'admin-users.js should render the modal permission list from a shared checklist builder'
    );
    assert.match(
        adminUsersSource,
        /window\.ADMIN_PERMISSION_GROUPS/,
        'admin-users.js should consume the shared admin permission registry'
    );
    assert.match(
        adminUsersSource,
        /function buildUserProfileOverview\(user, roleInfo, activeBans = \[\]\)/,
        'admin-users.js should build a dedicated overview panel for user detail'
    );
    assert.match(
        adminUsersSource,
        /user-overview-grid/,
        'admin-users.js should render the overview grid markup in the user detail modal'
    );
    assert.doesNotMatch(
        adminUsersSource,
        /<!--Assets Info - Compact Icon \+ Value-- >/,
        'admin-users.js should not leave malformed HTML comments ahead of the assets and overview block'
    );
    assert.doesNotMatch(
        adminUsersSource,
        /< !--Tags - Custom Dropdown-- >/,
        'admin-users.js should not leave malformed HTML comments ahead of the tags block'
    );
    assert.match(
        adminStudioStyles,
        /\.user-overview-grid\s*\{[\s\S]*grid-template-columns:/,
        'admin-studio.css should style the user detail overview grid'
    );
    assert.match(
        adminStudioStyles,
        /\.perm-item--rich\s*\{/,
        'admin-studio.css should support the richer grouped permission checklist rows'
    );
    assert.match(
        adminUsersSource,
        /function queueModalAdminPermissionsAutosave\(/,
        'admin-users.js should queue modal permission writes through a dedicated autosave helper'
    );
    assert.match(
        adminUsersSource,
        /function flushModalAdminPermissionsBeforeExit\(/,
        'admin-users.js should flush or confirm modal permission edits before closing or switching users'
    );
    assert.match(
        adminUsersSource,
        /function bindUserModalOverlayDismiss\(\)/,
        'admin-users.js should bind a dedicated overlay dismiss handler for the user detail modal'
    );
    assert.match(
        adminUsersSource,
        /window\.addEventListener\('beforeunload'/,
        'admin-users.js should warn before a hard refresh when modal permission edits are still pending'
    );
    assert.match(
        adminUsersSource,
        /id="modalAdminPermissionsSaveStatus"/,
        'admin-users.js should render a visible modal permission save-status indicator'
    );
    assert.match(
        adminUsersSource,
        /ensureModalAdminDefaultPermissionSelection\(\)/,
        'admin-users.js should realign the UI with the default admin permission immediately after granting admin access'
    );
    assert.match(
        adminUsersSource,
        /const ADMIN_PERMISSION_TEMPLATES = \[/,
        'admin-users.js should define reusable admin permission templates for common operator roles'
    );
    assert.match(
        adminUsersSource,
        /function applyModalAdminPermissionTemplate\(userId, templateId\)/,
        'admin-users.js should apply permission templates inside the user detail modal'
    );
    assert.match(
        adminUsersSource,
        /function buildAdminPermissionChangeDetails\(previousRoleInfo = \{\}, nextFormState = \{\}, extras = \{\}\)/,
        'admin-users.js should normalize permission change diffs before writing audit entries'
    );
    assert.match(
        adminUsersSource,
        /function renderAdminPermissionAuditDetails\(details = \{\}\)/,
        'admin-users.js should render permission audit entries as structured diffs'
    );
    assert.match(
        adminUsersSource,
        /template_label/,
        'admin-users.js should preserve the applied permission template label in permission audit details'
    );
    assert.match(
        adminUsersSource,
        /function getAdminRoleExpiryMeta\(roleInfo = null, \{ email = '' \} = \{\}\)/,
        'admin-users.js should derive admin role expiry reminder metadata for lists and overview cards'
    );
    assert.match(
        adminUsersSource,
        /label: '权限到期'/,
        'admin-users.js should surface admin expiry state in the overview card set'
    );
    assert.match(
        adminUsersSource,
        /class="admin-expiry-chip admin-expiry-chip--/,
        'admin-users.js should render an inline expiry chip for soon-to-expire admins in the users table'
    );
    assert.match(
        adminStudioStyles,
        /\.perm-save-status\s*\{/,
        'admin-studio.css should style the modal permission autosave status row'
    );
    assert.match(
        adminStudioStyles,
        /\.perm-save-btn:disabled\s*\{/,
        'admin-studio.css should style the permission save button while a save is in flight'
    );
    assert.match(
        adminStudioStyles,
        /\.perm-template-btn\.is-active\s*\{/,
        'admin-studio.css should visibly mark the active permission template'
    );
    assert.match(
        adminStudioStyles,
        /\.audit-diff-pill--added\s*\{/,
        'admin-studio.css should style added permission badges inside audit diffs'
    );
    assert.match(
        adminStudioStyles,
        /\.user-row--admin-expiring td:first-child\s*\{/,
        'admin-studio.css should highlight rows for admins whose permissions are close to expiring'
    );
});

test('admin points runtime renderers externalize tab state, panel visibility, and lookup styling', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioCss = readRepoFile('admin-studio.css');
    const adminPointsSource = readRepoFile('admin-points.js');

    const removedRuntimeMarkers = [
        "indicator.style.width = `${activeTab.offsetWidth}px`",
        "indicator.style.left = `${activeTab.offsetLeft}px`",
        "indicator.style.width = `${activeTab.offsetWidth} px`",
        "indicator.style.left = `${activeTab.offsetLeft} px`",
        'style="cursor:pointer;"',
        'style="width: ${usedPercent}%"',
        "customInputWrapper.style.display = 'none'",
        "customWrapper.style.display = 'block'",
        "customWrapper.style.display = 'none'",
        "placeholder.style.display = 'none'",
        "resultDiv.style.display = 'block'",
        "filterElement.style.setProperty('--popup-top',",
        "filterElement.style.setProperty('--popup-left',",
        "checkboxHeader.style.display = ''",
        "menuContainer.style.display = 'flex'",
        "countWrapper.style.display = 'flex'",
        "checkboxHeader.style.display = 'none'",
        "menuContainer.style.display = 'none'",
        "countWrapper.style.display = 'none'",
        "exportSelectedOption.style.display = selectedBatchIds.size > 0 ? 'flex' : 'none'",
        'style="max-width: 520px; height: auto;"',
        'style="padding: 24px;"',
        'style="text-align:center;padding:40px;color:#dc2626;"',
        'style="font-size: 0.9rem;"',
        'style="font-size:18px;font-weight:bold;"',
        'style="font-family:var(--font-sans);"',
        'style="color:#dc2626;"'
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(adminPointsSource.includes(marker), false, `admin-points.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        "const ADMIN_POINTS_HIDDEN_CLASS = 'admin-studio-inline-style-attr-3';",
        "const ADMIN_POINTS_PANEL_VISIBLE_CLASS = 'admin-points-panel-visible';",
        'function getPointsReadSite()',
        "buildAdminPointsUrl('points/batches'",
        "buildAdminPointsUrl('points/catalog'",
        "buildAdminPointsUrl('points/lookup'",
        "buildAdminPointsUrl('points/manage'",
        "buildAdminPointsUrl('points/packages'",
        'async function fetchPointsCatalogSnapshot({ site = getPointsReadSite(), force = false } = {})',
        'function renderPointsPackageCatalog(payload = {})',
        'function renderPointsPackageEditor()',
        'function getPointsWriteContextState()',
        'function buildPointsSiteContextMarkup(mode = \'catalog\')',
        'function renderPointsSiteContexts()',
        'function getPointsBatchQuickCounts(rows = allBatches)',
        'function getPointsBatchInsights(batch = {}, referenceDate = new Date())',
        'async function savePointsPackageForm(event) {',
        'async function deleteCurrentPointsPackage() {',
        'async function fetchPointsBatchesPayload(params = {}) {',
        'async function fetchPointsLookupPayload(params = {}) {',
        'async function mutatePointsManage({ action = \'\', site = \'\', payload = {} } = {})',
        "const writableSite = requireWritablePointsSite({ label });",
        'function setAdminPointsVisibility(target, visible)',
        'function setAdminPointsPanelVisible(target, visible)',
        "function setAdminPointsRuntimeStyles(target, styles = {}, priority = '')",
        'function syncPointsTabIndicator(indicator, activeTab)',
        'function hydratePointsUsageFills(scope = document)',
        'class="points-batch-row',
        'data-usage-fill-width="${usedPercent}%"',
        'setAdminPointsVisibility(customInputWrapper, false);',
        'setAdminPointsVisibility(customWrapper, true);',
        'setAdminPointsPanelVisible(resultDiv, true);',
        "setAdminPointsVisibility(checkboxHeader, true);",
        "setAdminPointsVisibility(exportSelectedOption, selectedBatchIds.size > 0);",
        'class="codes-modal delete-options-modal points-delete-options-modal"',
        'class="codes-modal-body points-delete-options-modal-body"',
        'class="error-text points-codes-error"',
        'class="code-value admin-points-reference-id"',
        'class="value admin-points-ledger-amount',
        'class="value admin-points-lookup-value-sans"',
        'class="value admin-points-lookup-value-danger"',
        'class="points-catalog-summary-card points-catalog-summary-card--',
        'class="points-package-status ${statusClass}"',
        'class="points-package-row ${isSelected ? \'is-selected\' : \'\'}"',
        "async function copyPointsTextToClipboard(text = '', {",
        'data-points-action="open-batch-codes-from-edit"',
        'data-points-action="reissue-batch-from-edit"',
        "action: 'open-batch-edit-from-codes'",
        "action: 'reissue-batch-from-codes'",
        "action: 'export-batch-codes-from-modal'",
        "action: 'invalidate-batch-from-codes'",
        "data-points-action=\"copy-visible-batch-codes\"",
        "data-points-action=\"clear-batch-code-filters\"",
        "action: 'lookup-code-item'",
        "data-points-action=\"navigate-batch\" data-batch-id=\"${encodeURIComponent(data.batch_id)}\" data-code=\"${encodeURIComponent(data.code || '')}\"",
        "function buildPointsInlineFeedbackMarkup(message = '', tone = 'info')",
        'function renderPointsLookupFeedback()',
        "function setPointsLookupFeedback(message = '', tone = 'info')",
        'function renderPointsBatchCodesFeedback()',
        "function setPointsBatchCodesFeedback(message = '', tone = 'info', batchId = '')",
        'function renderPointsBatchListFeedback()',
        "function setPointsBatchListFeedback(message = '', tone = 'info', kind = 'action')",
        "function buildPointsBatchActionFeedback(action = '', payload = {}, options = {})",
        'function hasActiveBatchListFilters()',
        "function announcePointsScopedAction(message = '', tone = 'success', {",
        'function getPointsBatchInvalidateModalPayload(batchIds = [])',
        'function getPointsPackageDeleteModalPayload(packageId = \'\')',
        'function syncPointsPackageDeleteModalState()',
        'function syncPointsBatchInvalidateModalState()',
        'function buildPointsBatchLoadingSkeleton(rowCount = batchPageSize)',
        'function formatPointsPackageMetricCell(metric = {})',
        'function renderPointsGeneratePreview()',
        'function syncPointsGenerateSubmitState()',
        'function filterBatchByQuick(value = \'all\')',
        'function buildPointsBatchRiskBadges(batch = {})',
        'function buildPointsBatchEditOverviewCard({',
        'function getPointsBatchCodeStatusCounts(codes = [])',
        'function buildPointsBatchCodesSummaryCard({',
        'function buildPointsBatchCodesActionButton({',
        'function getFilteredPointsBatchCodes(codes = pointsBatchCodesUiState.codes)',
        'function buildPointsBatchCodesTableSection(codes = pointsBatchCodesUiState.codes)',
        'function copyVisibleBatchCodes()',
        'function openPointsLookupFromCode(code = \'\')',
        'function queuePointsBatchCodeFocus(batchId = \'\', code = \'\')',
        'function focusPointsBatchCodeInModal(code = \'\', { applySearch = false } = {})',
        'function buildPointsLookupBatchAction(action = \'\', batchId = \'\', code = \'\', label = \'前往批次\', icon = \'fas fa-box-archive\')',
        'function buildPointsLookupCodeOpsPanel(data = {})',
        'function buildPointsCodeActionModalConfig(mode = \'\', code = \'\', currentExpiry = \'\')',
        'function openPointsPackageDeleteModal(packageId = \'\')',
        'function openPointsBatchInvalidateModal(batchIds = [])',
        'function openPointsCodeActionModal({ mode = \'\', code = \'\', currentExpiry = \'\', source = \'\' } = {})',
        'function syncPointsCodeActionModalState()',
        'async function submitPointsPackageDelete(event) {',
        'async function submitPointsBatchInvalidate(event) {',
        'async function submitPointsCodeAction(event) {',
        'function syncPointsBatchEditModalState()',
        'function renderPointsBatchOverview()',
        'function seedGenerateFromBatch(batchId = \'\')',
        'function jumpToGeneratedBatch(batchName = generatedBatchContext.batchName)',
        'function renderLookupEmptyState()',
        'function getPointsLookupStatusMeta(status = \'\')',
        'payments-kpi-card payments-kpi-card-visual',
        "document.getElementById('pointsCatalogPackageCount')",
        "document.getElementById('pointsGeneratePreview')",
        "document.getElementById('pointsGeneratePreviewStatus')",
        "label: isCreate ? '创建套餐' : '保存套餐'"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(adminPointsSource.includes(marker), true, `admin-points.js should contain ${marker}`);
    }

    const removedPointsWriteMarkers = [
        ".from('redemption_batches')",
        ".from('redemption_codes')",
        ".from('profiles')",
        ".from('prompts')",
        ".from('points_ledger')",
        'fn_check_code_status',
        ".rpc('fn_generate_custom_codes'",
        ".rpc('fn_generate_codes'",
        ".rpc('fn_revoke_code'"
    ];

    for (const marker of removedPointsWriteMarkers) {
        assert.equal(adminPointsSource.includes(marker), false, `admin-points.js should not retain ${marker}`);
    }

    const expectedCssMarkers = [
        'left: var(--admin-tab-indicator-left, 0px);',
        'width: var(--admin-tab-indicator-width, 0px);',
        'width: var(--points-usage-fill-width, 0%);',
        '#points-view-catalog',
        '.points-batch-row',
        '.settings-package-shortcut',
        '.points-catalog-workspace',
        '.points-catalog-list-shell',
        '.points-package-editor-shell',
        '.points-catalog-summary-card:hover',
        '.points-package-editor-badge',
        '.points-catalog-toolbar',
        '.points-catalog-search',
        '.points-catalog-select',
        '.points-generate-preview',
        '.points-generate-preview__status',
        '.points-generate-preview__grid',
        '.points-package-form__actions',
        '.points-package-action-btn',
        '.points-package-action-btn--primary',
        '.points-catalog-summary',
        '.points-catalog-summary-card',
        '.points-catalog-list-shell__badge',
        '.points-package-row.is-selected',
        '.points-package-status.is-active',
        '.points-package-status.is-inactive',
        '.points-package-metric-pill',
        '.points-package-empty-state',
        '.points-batch-edit-layout',
        '.points-batch-edit-overview-card',
        '.points-batch-edit-actions',
        '.points-site-context--batch-edit',
        '.codes-modal--batch',
        '.points-batch-codes-workbench',
        '.points-batch-codes-summary-card',
        '.points-batch-codes-actions',
        '.points-batch-codes-toolbar',
        '.points-batch-codes-search',
        '.points-batch-codes-toolbar-btn',
        '.points-batch-codes-table-empty',
        '.points-batch-codes-row-tools',
        '.points-batch-codes-row-btn',
        '.points-batch-code-row--focused',
        '.lookup-inline-hint',
        '.lookup-section--ops',
        '.lookup-ops-panel',
        '.lookup-action-btn--danger',
        '.lookup-action-btn--success',
        '.points-inline-feedback-shell',
        '.points-batch-list-feedback',
        '.points-inline-feedback',
        '.points-inline-feedback--success',
        '.points-inline-feedback--error',
        '.points-site-context--lookup-ops',
        '.edit-modal--code-action',
        '.edit-modal--package-delete',
        '.edit-modal--batch-invalidate',
        '.points-code-action-summary',
        '.points-code-action-summary--danger',
        '.points-code-action-error',
        '.points-code-action-submit--danger',
        '.points-code-action-submit--success',
        '.points-site-context--code-action',
        '.points-package-delete-summary',
        '.points-package-delete-summary__meta-item',
        '.points-package-delete-warning',
        '.points-batch-invalidate-list',
        '.points-batch-invalidate-item',
        '.points-batch-codes-status-pill',
        '#generatedCodesResult.admin-studio-inline-style-attr-35.admin-points-panel-visible',
        '#lookupResult.admin-studio-inline-style-attr-41.admin-points-panel-visible',
        '.lookup-status-badge',
        '.lookup-summary-grid',
        '.lookup-timeline',
        '.lookup-action-btn',
        '.admin-points-reference-id',
        '.admin-points-ledger-amount',
        '.admin-points-lookup-value-sans',
        '.admin-points-lookup-value-danger',
        '.points-delete-options-modal',
        '.points-delete-options-modal-body',
        '.points-codes-error',
        '.codes-modal-overlay.is-visible',
        '.edit-modal-overlay.is-visible',
        '.edit-modal--batch',
        '.points-batch-edit-hero',
        '.points-batch-edit-overview-card__icon'
    ];

    for (const marker of expectedCssMarkers) {
        assert.equal(adminStudioCss.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    assert.match(
        adminStudioCss,
        /\.admin-discount-generate-modal\.is-visible\s*\{[^}]*display:\s*flex;/s,
        'admin-studio.css should force the discount modal visible state back to display:flex'
    );

    assert.match(
        adminStudioSource,
        /admin-studio\.css\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should reference the updated admin stylesheet version'
    );
    assert.match(
        adminStudioSource,
        /admin-points\.js\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should reference the updated admin points script version'
    );
});

test('admin comments runtime renderers route list items, filters, and block menus through delegated actions', () => {
    const adminCommentsSource = readRepoFile('admin-comments.js');
    const adminCommentsCss = readRepoFile('admin-sidebar.css');
    const adminStudioSource = readRepoFile('admin-studio.html');
    const inlineHandlerPattern = /\bon(?:click|change|submit|input|keydown|blur|error)\s*=\s*["']/i;

    assert.equal(
        inlineHandlerPattern.test(adminCommentsSource),
        false,
        'admin-comments.js should not emit inline event handler attributes'
    );

    const delegatedMarkers = [
        "buildAdminCommentsUrl('comments/blocks'",
        "buildAdminCommentsUrl('comments/list'",
        "buildAdminCommentsUrl('comments/summary'",
        '/api/admin/comments/moderate',
        'data-comments-action="remove-filter"',
        'data-comments-action="toggle-selection"',
        'data-comments-change="selection"',
        'data-comments-action="copy-comment-id"',
        'data-comments-action="toggle-pin"',
        'data-comments-action="toggle-block-dropdown"',
        'data-comments-action="view-comment-context"',
        'data-comments-action="delete-comment"',
        'data-comments-action="block-user"',
        'data-comments-action="unblock-user"',
        'data-comments-action="check-user-status"',
        'data-admin-action="comments-pagination-go"',
        'data-admin-change-action="comments-pagination-go"',
        'function renderBlockDropdownMenu(userId',
        'function renderCommentsPagination()',
        'function changeCommentsPage(page)',
        'function fetchAllFilteredCommentsForExport(view)',
        'function buildCommentContextUrl(comment = {})',
        'function prepareCommentReloadState({ preserveSelection = false, removeSelectionIds = [], focusCommentId = \'\' } = {})',
        'function restoreCommentSelectionState()',
        'function focusCommentCard(commentId)',
        'function findAdjacentCommentId(commentId, excludedIds = [])',
        'function getCommentCurrentScopeBlockState(comment)',
        'function buildCommentUserBlockBadge(comment)',
        'function findVisibleCommentIdByUser(userId)',
        'function refreshCommentsForUserStatus(userId)',
        "new URL('guestbook.html', window.location.origin)",
        'data-context-url="${encodeURIComponent(contextUrl)}"',
        'data-user-id="${escapeHtml(comment.user_id || \'\')}"',
        'function bindAdminCommentsRuntimeDelegates()',
        "document.documentElement.dataset.adminCommentsRuntimeDelegatesBound === '1'",
        "case 'remove-filter':",
        "case 'toggle-pin':",
        "case 'toggle-block-dropdown':",
        "case 'block-user':",
        "case 'selection':",
        "action: 'toggle_pin'",
        "requireWritableCommentsSite({ label: `${scopeStr}用户封禁` })",
        "requireWritableCommentsSite({ label: `${scopeLabel}用户解封` })",
        'action-btn action-block${blockState.blocked ? \' action-btn--blocked\' : \'\'}',
        'function openAnalyticsCommentContext(context = {})',
        'window.openAnalyticsCommentContext = openAnalyticsCommentContext;'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminCommentsSource.includes(marker), true, `admin-comments.js should contain ${marker}`);
    }

    const removedMarkers = [
        '<div class="item-avatar" style="',
        'fa-thumbtack" style=',
        '<div class="action-block-wrapper" style="position: relative;">',
        "item.style.opacity = '0';",
        "item.style.transform = 'translateY(-20px)';",
        ".from('blocked_users')"
    ];

    for (const marker of removedMarkers) {
        assert.equal(adminCommentsSource.includes(marker), false, `admin-comments.js should not contain ${marker}`);
    }

    const runtimeMarkers = [
        "const avatarMarkup = comment.avatar",
        "class=\"item-avatar${comment.avatar ? ' item-avatar--image' : ''}\"",
        "fa-thumbtack${comment.is_pinned ? ' comment-pin-icon--active' : ''}",
        "item.classList.add('comment-admin-item--removing');",
        "requireWritableCommentsSite({ label: currentStatus ? '取消评论置顶' : '置顶评论' })",
        "当前封禁按 scope 全站生效，不区分 CN / EN 站点。",
        'refreshCommentsForUserStatus(userId);',
        'comment-block-badge'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(adminCommentsSource.includes(marker), true, `admin-comments.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.item-avatar.item-avatar--image',
        '.item-avatar-image',
        '.comment-pin-icon--active',
        '.action-btn.action-btn--blocked',
        '.item-meta-row',
        '.comment-block-badge',
        '.comment-admin-item.comment-admin-item--removing',
        '.comment-admin-item.comment-admin-item--focused',
        '.block-menu-note',
        '.comments-pagination-shell'
    ];

    for (const marker of cssMarkers) {
        assert.equal(adminCommentsCss.includes(marker), true, `admin-sidebar.css should contain ${marker}`);
    }

    assert.match(
        adminCommentsCss,
        /\.comment-admin-item:hover\s*\{[^}]*border-color:\s*rgba\(107,\s*158,\s*206,\s*0\.38\)/s,
        'admin-sidebar.css should render comment card hover borders with the shared admin blue accent'
    );

    assert.match(
        adminStudioSource,
        /admin-sidebar\.css\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should reference the updated admin sidebar stylesheet version'
    );
    assert.match(
        adminStudioSource,
        /admin-comments\.js\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should reference the updated admin comments script version'
    );
});

test('wallet modal runtime renderers route wallet shell, lists, filters, and order dialogs through delegated actions', () => {
    const walletModalSource = readRepoFile('js/components/WalletModal.js');
    const walletCssSource = readRepoFile('css/wallet.css');
    const inlineHandlerPattern = /\bon(?:click|change|submit|input|keydown|keyup|mouseover|mouseout|error|load)\s*=\s*["']/i;

    assert.equal(
        inlineHandlerPattern.test(walletModalSource),
        false,
        'js/components/WalletModal.js should not emit inline event handler attributes'
    );

    const delegatedMarkers = [
        'bindDelegatedHandlers(overlay = this.modalEl)',
        'handleOpenOrderDetailAction(actionEl)',
        'setInlineStyles(target, styles)',
        'setCssVariables(target, variables)',
        "'wallet-action': 'switch-view'",
        "'wallet-enter-action': 'redeem-code'",
        "'wallet-enter-action': 'custom-recharge'",
        "'wallet-enter-action': 'query-afdian-code'",
        "'wallet-input-action': 'order-search'",
        "'wallet-keydown-action': 'order-search'",
        "'wallet-action': 'select-order-time-filter'",
        "'wallet-action': 'select-order-filter'",
        "'wallet-action': 'toggle-affiliate-member-details'",
        "'wallet-action': 'buy-package'",
        "'wallet-action': 'daily-checkin-v2'",
        "'wallet-action': 'makeup-checkin'",
        "'wallet-action': 'toggle-history-item-details'",
        "'wallet-action': 'copy-value'",
        "'wallet-action': 'open-order-detail'",
        "case 'open-order-detail':",
        "case 'copy-value':",
        "case 'buy-package':",
        "getWalletToneClass(value = '')",
        "buildWalletOrderLoadingMarkup(message = '')",
        'js-wallet-copy-content',
        'wallet-copy-card',
        'wallet-order-modal--loading',
        'wallet-detail-row--stacked',
        'wallet-date-input',
        'wallet-order-modal-body--fade',
        'wallet-content-grid--double',
        'wallet-copy-card--compact',
        'wallet-copy-card--link',
        'wallet-modal-actions--toolbar',
        'product-dot--info',
        'content-card--warning',
        'wallet-inline-icon--compact',
        'wallet-inline-icon--title',
        'wallet-affiliate-highlight--reward',
        'wallet-affiliate-highlight--commission',
        'loading-calendar--error',
        'today-text--loading',
        "resultDiv.classList.add('is-visible')",
        "section.toggleAttribute('hidden', !shouldShowAfdianQuery)",
        "section.toggleAttribute('hidden', !isFeatureEnabled)",
        'wallet-toast--leaving',
        'overlay.hidden = false',
        'this.modalEl.hidden = true',
        'bindOverlayCloseButtons(detailOverlay);'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(walletModalSource.includes(marker), true, `js/components/WalletModal.js should contain ${marker}`);
    }

    const removedInlineMarkers = [
        'style="max-width: 360px;"',
        'style="cursor:pointer;"',
        'style="display: flex; align-items: center; justify-content: center; min-height: 200px;"',
        'style="animation: fadeIn 0.2s ease-out;"',
        'style="display: flex; gap: 8px; justify-content: flex-end; padding: 4px 0; margin-top: -8px;"',
        'style="width:8px;height:8px;background:#6b9ece;border-radius:50%;display:inline-block;margin-left:8px;cursor:pointer;transition:all 0.2s ease;position:relative;"',
        'style="display:none;"',
        'style="display: none;"',
        'style="width: 0%;"',
        'style="color: #fbbf24;"',
        'style="color:#10b981;"',
        'style="font-size: 10px;"',
        'toast.style.cssText =',
        'wallet-toast-style',
        "resultDiv.style.display = 'block'",
        'document.documentElement.style.overflow =',
        'document.body.style.position =',
        'viewport?.style.setProperty(',
        'card.style.maxHeight =',
        'indicator.style.top =',
        'fill.style.width =',
        'particle.style.animation ='
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(walletModalSource.includes(marker), false, `js/components/WalletModal.js should not contain ${marker}`);
    }

    const walletCssMarkers = [
        '.wallet-order-modal--loading',
        '.wallet-order-loading-state',
        '.wallet-detail-row--stacked',
        '.wallet-date-input',
        '.wallet-content-grid--double',
        '.wallet-copy-card--compact',
        '.wallet-modal-actions--toolbar',
        '.product-dot--info',
        '.content-card--warning',
        '.wallet-affiliate-person-row',
        '.wallet-inline-icon--compact',
        '.wallet-inline-icon--title',
        '.wallet-affiliate-highlight--reward',
        '.wallet-affiliate-highlight--commission',
        '.loading-calendar--error',
        '.today-text--loading',
        '.afdian-result.is-visible',
        '.history-details .detail-val.mono',
        '.wallet-toast',
        '.wallet-toast--leaving',
        'body.wallet-modal-lock',
        '.wallet-overlay[hidden]'
    ];

    for (const marker of walletCssMarkers) {
        assert.equal(walletCssSource.includes(marker), true, `css/wallet.css should contain ${marker}`);
    }
});

test('verify widget runtime renderers route wallet/login/form/history actions through delegated bindings', () => {
    const verifyWidgetSource = readRepoFile('verify-widget.js');
    const inlineHandlerPattern = /\bon(?:click|change|submit|input|keydown|keyup|mouseover|mouseout|error|load)\s*=\s*["']/i;

    assert.equal(
        inlineHandlerPattern.test(verifyWidgetSource),
        false,
        'verify-widget.js should not emit inline event handler attributes'
    );

    const delegatedMarkers = [
        'function bindDelegatedUi(container)',
        "container.dataset.verifyDelegatesBound === '1'",
        "data-verify-action=\"wallet-open\"",
        "data-verify-action=\"login-gate\"",
        "data-verify-action=\"toggle-password\"",
        "data-verify-action=\"reset-form\"",
        "data-verify-action=\"submit\"",
        "data-verify-action=\"export-history\"",
        "data-verify-action=\"refresh-history\"",
        "data-verify-action=\"copy-history-id\"",
        "case 'wallet-open':",
        "case 'login-gate':",
        "case 'toggle-password':",
        "case 'reset-form':",
        "case 'submit':",
        "case 'copy-history-id':",
        'bindDelegatedUi(container);'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(verifyWidgetSource.includes(marker), true, `verify-widget.js should contain ${marker}`);
    }
});

test('verify widget runtime renderers externalize progress, visibility, history tone, and maintenance styling', () => {
    const verifyWidgetSource = readRepoFile('verify-widget.js');
    const verifyWidgetCss = readRepoFile('verify-widget.css');
    const verifyPageSource = readRepoFile('verify.html');
    const archivedIndexSource = readRepoFile('index_old.html');

    const removedMarkers = [
        "widget.style.setProperty('--verify-progress'",
        "quotaBar.style.display = 'flex'",
        "quotaBar.style.display = 'none'",
        'style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));"',
        'style="display: ${balanceDisplay}; cursor: pointer;"',
        'style="display: none;"',
        "loginPrompt.style.display = 'none'",
        "form.style.display = 'block'",
        "balanceEl.style.display = 'flex'",
        "balanceEl.style.display = 'none'",
        "if (el) el.style.display = 'flex';",
        "if (el) el.style.display = 'none';",
        'style="color: #22c55e;"',
        "el.style.color = '#22c55e'",
        "ta.style.position = 'fixed'",
        "ta.style.opacity = '0'",
        "submitBtn.style.background = 'rgba(239, 68, 68, 0.3)'",
        "submitBtn.style.borderColor = 'rgba(239, 68, 68, 0.5)'",
        "submitBtn.style.cursor = 'pointer'"
    ];

    for (const marker of removedMarkers) {
        assert.equal(verifyWidgetSource.includes(marker), false, `verify-widget.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        "const VERIFY_STYLE_DECL_KEY = 'style';",
        'function setVerifyRuntimeStyles(target, styles = {}, priority = \'\')',
        'function setVerifyHidden(target, hidden)',
        "function setVerifyQuotaTone(target, tone = 'unknown')",
        "setVerifyRuntimeStyles(widget, {",
        'setVerifyHidden(quotaBar, false);',
        'setVerifyHidden(quotaBar, true);',
        "target.classList.add(`verify-api-quota--${tone}`);",
        '<div class="verify-quota-warning" id="verifyQuotaWarning" hidden>',
        '<div class="verify-login-prompt" id="verifyLoginPrompt" hidden>',
        '<div class="verify-batch-summary" id="verifyBatchSummary" hidden>',
        "el.classList.add('verify-history-item-id--copied');",
        "ta.className = 'verify-copy-fallback';",
        "submitBtn.classList.add('verify-submit-btn--maintenance');",
        '<span class="verify-history-status-badge"><i class="fas fa-check-circle"></i>'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(verifyWidgetSource.includes(marker), true, `verify-widget.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.verify-submit-btn.verify-submit-btn--maintenance',
        '.verify-api-quota-value',
        '.verify-api-quota--ok',
        '.verify-api-quota--warning',
        '.verify-api-quota--danger',
        '.verify-history-item-id--copied',
        '.verify-history-status-badge',
        '.verify-copy-fallback'
    ];

    for (const marker of cssMarkers) {
        assert.equal(verifyWidgetCss.includes(marker), true, `verify-widget.css should contain ${marker}`);
    }

    assert.equal(
        verifyPageSource.includes('verify-widget.css?v=20260324_VERIFY_WIDGET_RUNTIME_STYLE_1'),
        true,
        'verify.html should load the latest verify-widget stylesheet version'
    );
    assert.equal(
        verifyPageSource.includes('./js/user-event-tracker.js?v=20260405_USER_EVENT_TRACKER_2'),
        true,
        'verify.html should load the shared user event tracker before the verify widget runtime'
    );
    assert.equal(
        verifyPageSource.includes('./verify-widget.js?v=20260405_VERIFY_RUNTIME_TRACKING_1'),
        true,
        'verify.html should load the latest verify-widget script version'
    );
    assert.equal(
        archivedIndexSource.includes('verify-widget.css?v=20260324_VERIFY_WIDGET_RUNTIME_STYLE_1'),
        true,
        'index_old.html should load the latest verify-widget stylesheet version'
    );
    assert.equal(
        archivedIndexSource.includes('./js/user-event-tracker.js?v=20260405_USER_EVENT_TRACKER_2'),
        true,
        'index_old.html should load the shared user event tracker before the verify widget runtime'
    );
    assert.equal(
        archivedIndexSource.includes('./verify-widget.js?v=20260405_VERIFY_RUNTIME_TRACKING_1'),
        true,
        'index_old.html should load the latest verify-widget script version'
    );
});

test('homepage admin runtime renderers externalize retry, visibility, tab indicator, and preview style state', () => {
    const homepageAdminSource = readRepoFile('admin-homepage.js');
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioPageStyles = readRepoFile('css/admin-studio-page.css');
    const inlineHandlerPattern = /\bon(?:click|change|submit|input|keydown|keyup|mouseover|mouseout|error|load)\s*=\s*["']/i;

    assert.equal(
        inlineHandlerPattern.test(homepageAdminSource),
        false,
        'admin-homepage.js should not emit inline event handler attributes'
    );

    const removedRuntimeMarkers = [
        "if (loading) loading.style.display = 'none';",
        "if (content) content.style.display = 'block';",
        'style="font-size: 24px; margin-bottom: 12px; color: #f59e0b;"',
        'style="margin-top: 16px;"',
        "indicator.style.opacity = '1';",
        "setTimeout(() => indicator.style.opacity = '0', 2000);",
        "indicator.style.left = activeTab.offsetLeft + 'px';",
        "indicator.style.width = activeTab.offsetWidth + 'px';",
        "view.style.display = isActive ? 'block' : 'none';",
        "previewImg.style.display = 'block';",
        "placeholder.style.display = 'none';",
        "img.style.display = 'none';",
        "placeholder.style.display = 'flex';"
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(homepageAdminSource.includes(marker), false, `admin-homepage.js should not retain ${marker}`);
    }

    const delegatedMarkers = [
        'data-homepage-retry="1"',
        'js-homepage-retry-btn',
        'data-homepage-visibility="${visSection}"',
        'data-homepage-visibility="footer"',
        'hp-readonly-banner',
        'hp-aggregate-readonly-card',
        'hp-readonly-chip',
        'function bindSectionVisibilityToggle(input, section)',
        'function setHomepageAdminHiddenState(target, hidden, hiddenClass = HOMEPAGE_ADMIN_HIDDEN_CLASS)',
        'function showHomepageSaveIndicator(indicator, durationMs = 2000)',
        'function setHomepageSectionViewState(view, isActive)',
        'function setHomepagePreviewState(previewImg, placeholder, hasPreview)',
        'function renderHomepageReadModeBanner()',
        'function renderHomepageAggregateSummaries()',
        'function renderHomepageAggregateVisibilityToggles()',
        'function setHomepageEditorReadOnlyState()',
        "window.updateAdminTabIndicator(activeTab)",
        "input.dataset.homepageVisibilityBound === '1'",
        "input.addEventListener('change', () => {",
        "loading.querySelector('[data-homepage-retry=\"1\"]')?.addEventListener('click'",
        'class="btn-sm btn-primary js-homepage-retry-btn hp-loading-retry-btn"',
        "placeholder.hidden = !!hasPreview;",
        "const HOMEPAGE_PREFETCH_CACHE_KEY = 'homepage_prefetch';",
        "const HOMEPAGE_CONFIG_LAST_UPDATED_KEY = 'homepage_config_last_updated_at';",
        'function getHomepagePrefetchCacheKey(site = getHomepageReadSite()) {',
        'function getHomepageConfigLastUpdatedKey(site = getHomepageReadSite()) {',
        'sessionStorage.removeItem(getHomepagePrefetchCacheKey(safeSite));',
        'localStorage.setItem(getHomepageConfigLastUpdatedKey(safeSite), String(Date.now()));',
        'function invalidateHomepageRuntimeCaches(site = getHomepageReadSite()) {',
        'localStorage.removeItem(HOMEPAGE_CONFIG_LAST_UPDATED_KEY);',
        'sessionStorage.removeItem(HOMEPAGE_PREFETCH_CACHE_KEY);',
        'function renderHomepageLoadingSkeleton(loading) {',
        'function ensureHomepageConfigLoaded({ force = false } = {}) {',
        'async function prefetch() {',
        'await ensureHomepageConfigLoaded();'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(homepageAdminSource.includes(marker), true, `admin-homepage.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.hp-loading-error-icon',
        '.hp-loading-retry-btn',
        '#module-homepage #hp-loading',
        '#module-homepage .hp-loading-shell',
        '#module-homepage .hp-loading-shell__grid',
        '#module-homepage .hp-loading-card',
        '#module-homepage .hp-section-view[hidden]',
        '#module-homepage .hp-readonly-banner',
        '.hp-aggregate-visibility-grid',
        '#module-homepage .hp-aggregate-readonly-card'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStudioPageStyles.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }

    assert.equal(
        adminStudioSource.includes('admin-homepage.js?v=20260403_HOMEPAGE_LOADING_PREWARM_1'),
        true,
        'admin-studio.html should load the latest homepage admin script version'
    );

    assert.match(
        adminStudioSource,
        /css\/admin-studio-page\.css\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should load the latest admin studio page stylesheet version'
    );
    assert.match(
        adminStudioSource,
        /admin-homepage\.js\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should load the latest homepage admin runtime version'
    );
});

test('admin studio settings, discounts, and tickets controls route through delegated actions', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const discountsSource = readRepoFile('admin-discounts.js');
    const ticketsSource = readRepoFile('js/admin-tickets.js');

    const removedInlineMarkers = [
        `onchange="toggleDecoration()"`,
        `onclick="selectDecoration('none')"`,
        `onclick="togglePageTarget('all')"`,
        `onclick="insertFormat('b')"`,
        `onclick="toggleAlignPicker()"`,
        `onclick="applyTextAlign('left')"`,
        `onclick="insertLink()"`,
        `onclick="toggleEmojiPicker()"`,
        `onclick="selectEmoji('🎉')"`,
        `onclick="toggleDropdown('colorDropdown')"`,
        `onclick="selectColor('#ffffff')"`,
        `onclick="selectFontSize('2', 'small')"`,
        `onclick="saveAnnouncement()"`,
        `onclick="saveSensitiveWords()"`,
        `oninput="AdminDiscounts.search()"`,
        `onclick="AdminDiscounts.filter('all', this)"`,
        `onclick="AdminDiscounts.openGenerateModal()"`,
        `onclick="AdminTickets.filter('all', this)"`,
        `onclick="AdminTickets.submitReply()"`,
        `onfocus="this.style.borderColor='rgba(91, 155, 213, 0.5)'`,
        `onmouseover="this.style.background='rgba(255,255,255,0.08)'"`
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(adminStudioSource.includes(marker), false, `admin-studio.html should not contain ${marker}`);
    }

    const delegatedMarkers = [
        'data-admin-change-action="settings-toggle-decoration"',
        'data-admin-action="settings-select-decoration"',
        'data-admin-action="settings-toggle-page-target"',
        'data-admin-action="settings-insert-format"',
        'data-admin-action="settings-toggle-align-picker"',
        'data-admin-action="settings-apply-text-align"',
        'data-admin-action="settings-insert-link"',
        'data-admin-action="settings-toggle-emoji-picker"',
        'data-admin-action="settings-select-emoji"',
        'data-admin-action="settings-toggle-toolbar-dropdown"',
        'data-admin-action="settings-select-color"',
        'data-admin-action="settings-select-font-size"',
        'data-admin-action="settings-save-announcement"',
        'data-admin-action="settings-save-sensitive-words"',
        'data-admin-input-action="discounts-search"',
        'data-admin-action="discounts-filter"',
        'data-admin-action="discounts-open-generate-modal"',
        'id="discountsScopeHint"',
        'data-admin-overlay-close="discount-generate-modal"',
        'data-admin-action="discounts-toggle-type-dropdown"',
        'data-admin-action="discounts-select-type"',
        'data-admin-input-action="discounts-format-expiry-date"',
        'data-admin-input-action="discounts-format-expiry-time"',
        'data-admin-action="discounts-close-generate-modal"',
        'data-admin-action="discounts-submit-generate"',
        'data-admin-input-action="tickets-search"',
        'data-admin-action="tickets-filter"',
        'data-admin-action="tickets-switch-workspace"',
        'data-admin-action="tickets-toggle-overdue"',
        'data-admin-action="tickets-toggle-priority"',
        'data-admin-action="tickets-toggle-mine"',
        'data-admin-action="tickets-toggle-unassigned"',
        'data-admin-action="tickets-toggle-select-mode"',
        'data-admin-action="tickets-toggle-batch-menu"',
        'data-admin-action="tickets-select-all-page"',
        'data-admin-action="tickets-bulk-assign-self"',
        'data-admin-action="tickets-bulk-clear-assignee"',
        'data-admin-action="tickets-open-bulk-resolve"',
        'data-admin-action="tickets-open-bulk-reject"',
        'data-admin-action="tickets-close-bulk-process-modal"',
        'data-admin-action="tickets-submit-bulk-process"',
        'data-admin-action="tickets-clear-selection"',
        'data-admin-change-action="tickets-toggle-select-all-page"',
        'data-admin-overlay-close="ticket-reply-modal"',
        'data-admin-overlay-close="ticket-bulk-process-modal"',
        'data-admin-overlay-close="ticket-summary-job-detail-modal"',
        'data-admin-action="tickets-close-reply-modal"',
        'data-admin-action="tickets-submit-reply"',
        'data-admin-action="tickets-close-summary-job-detail"',
        'data-admin-action="tickets-retry-summary-job"'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(adminStudioScript.includes('settings-select-decoration'), true, 'admin-studio.js should delegate settings decoration controls');
    assert.equal(adminStudioScript.includes('discounts-open-generate-modal'), true, 'admin-studio.js should delegate discount modal controls');
    assert.equal(adminStudioScript.includes('tickets-submit-reply'), true, 'admin-studio.js should delegate ticket reply submission');
    assert.equal(adminStudioScript.includes('tickets-switch-workspace'), true, 'admin-studio.js should delegate ticket workspace switching');
    assert.equal(adminStudioScript.includes('tickets-toggle-overdue'), true, 'admin-studio.js should delegate ticket overdue quick filters');
    assert.equal(adminStudioScript.includes('tickets-toggle-select-mode'), true, 'admin-studio.js should delegate ticket select mode toggles');
    assert.equal(adminStudioScript.includes('tickets-toggle-batch-menu'), true, 'admin-studio.js should delegate ticket batch menu toggles');
    assert.equal(adminStudioScript.includes('tickets-bulk-assign-self'), true, 'admin-studio.js should delegate ticket bulk assignment');
    assert.equal(adminStudioScript.includes('tickets-open-bulk-resolve'), true, 'admin-studio.js should delegate ticket bulk resolve actions');
    assert.equal(adminStudioScript.includes('tickets-submit-bulk-process'), true, 'admin-studio.js should delegate ticket batch processing');
    assert.equal(adminStudioScript.includes('tickets-toggle-select-all-page'), true, 'admin-studio.js should delegate ticket page selection');
    assert.equal(adminStudioScript.includes('tickets-open-summary-job-detail'), true, 'admin-studio.js should delegate ticket summary detail actions');
    assert.equal(adminStudioScript.includes('tickets-save-summary-job-note'), true, 'admin-studio.js should delegate ticket summary note actions');
    assert.equal(adminStudioScript.includes('tickets-retry-summary-job'), true, 'admin-studio.js should delegate ticket summary retry actions');
    assert.equal(adminStudioScript.includes('[data-admin-input-action]'), true, 'admin-studio.js should delegate input-based admin controls');
    assert.equal(adminStudioScript.includes('[data-admin-overlay-close]'), true, 'admin-studio.js should delegate overlay dismissal');
    assert.equal(adminStudioScript.includes("form.id === 'discountGenerateForm'"), true, 'admin-studio.js should delegate discount generate form submission');
    assert.equal(adminStudioScript.includes("form.id === 'ticketReplyForm'"), true, 'admin-studio.js should delegate ticket reply form submission');

    const discountHelpers = [
        'renderScopeHint: function',
        'formatSiteLabel: function',
        'closeGenerateModal: function',
        'toggleTypeDropdown: function',
        'selectDiscountType: function',
        'formatExpiryDateInput: function',
        'formatExpiryTimeInput: function',
        'mutateDiscountsViaAdminApi: async function',
        "buildAdminDiscountsUrl('discounts/mutate')"
    ];
    for (const marker of discountHelpers) {
        assert.equal(discountsSource.includes(marker), true, `admin-discounts.js should contain ${marker}`);
    }

    assert.equal(discountsSource.includes(".from('discount_codes')"), false, 'admin-discounts.js should not write discount_codes directly from the browser');

    assert.equal(ticketsSource.includes('closeReplyModal: function'), true, 'js/admin-tickets.js should expose closeReplyModal');
    assert.equal(ticketsSource.includes('submitReply: async function'), true, 'js/admin-tickets.js should still expose submitReply');
});

test('discount and ticket admin renderers no longer emit inline row or pagination handlers', () => {
    const adminStudioScript = readRepoFile('admin-studio.js');
    const discountsSource = readRepoFile('admin-discounts.js');
    const ticketsSource = readRepoFile('js/admin-tickets.js');

    const removedDiscountMarkers = [
        `onclick="AdminDiscounts.copyCode('`,
        `onclick="AdminDiscounts.toggleStatus('`,
        `onclick="AdminDiscounts.deleteCode('`,
        `onclick="AdminDiscounts.goToPage(`,
        `onchange="AdminDiscounts.goToPage(`
    ];

    for (const marker of removedDiscountMarkers) {
        assert.equal(discountsSource.includes(marker), false, `admin-discounts.js should not contain ${marker}`);
    }

    const removedTicketMarkers = [
        `onclick="AdminTickets.changePage(`,
        `onchange="AdminTickets.changePage(`
    ];

    for (const marker of removedTicketMarkers) {
        assert.equal(ticketsSource.includes(marker), false, `js/admin-tickets.js should not contain ${marker}`);
    }

    const delegatedDiscountMarkers = [
        'data-admin-action="discounts-copy-code"',
        'data-admin-action="discounts-toggle-status"',
        'data-admin-action="discounts-delete-code"',
        'data-admin-action="discounts-pagination-go"',
        'data-admin-change-action="discounts-pagination-go"',
        'escapeHtml: function'
    ];

    for (const marker of delegatedDiscountMarkers) {
        assert.equal(discountsSource.includes(marker), true, `admin-discounts.js should contain ${marker}`);
    }

    const delegatedTicketMarkers = [
        'data-admin-action="tickets-pagination-go"',
        'data-admin-change-action="tickets-pagination-go"',
        'data-admin-action="tickets-open-summary-job-detail"',
        'data-admin-action="tickets-retry-summary-job"'
    ];

    for (const marker of delegatedTicketMarkers) {
        assert.equal(ticketsSource.includes(marker), true, `js/admin-tickets.js should contain ${marker}`);
    }

    const adminDelegationMarkers = [
        'discounts-copy-code',
        'discounts-toggle-status',
        'discounts-delete-code',
        'discounts-pagination-go',
        'tickets-pagination-go',
        'tickets-switch-workspace',
        'settings-add-ticket-reply-template',
        'tickets-open-overdue-queue',
        'tickets-open-sla-settings',
        'tickets-refresh-overview',
        'tickets-open-summary-job-detail',
        'tickets-save-summary-job-note',
        'tickets-retry-summary-job'
    ];

    for (const marker of adminDelegationMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should delegate ${marker}`);
    }
});

test('ticket admin surfaces user email in search and list rendering', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminConfigSource = readRepoFile('admin-config.js');
    const ticketsSource = readRepoFile('js/admin-tickets.js');
    const adminWorkbenchSource = readRepoFile('js/admin-workbench.js');
    const ticketLinksSource = readRepoFile('js/admin-ticket-links.js');

    assert.equal(adminStudioSource.includes('placeholder="搜索工单号、订单号、用户、邮箱或描述..."'), true, 'admin-studio.html should mention ticket id, user, and email in the ticket search placeholder');
    assert.equal(adminStudioSource.includes('<th>用户 / 邮箱</th>'), true, 'admin-studio.html should label the ticket user column with email support');
    assert.equal(adminStudioSource.includes('js/admin-ticket-links.js?v=20260401_ADMIN_TICKET_LINK_PROTOCOL_1'), true, 'admin-studio.html should load the shared ticket link protocol before the ticket runtime');
    assert.equal(adminStudioSource.includes('admin-studio.css?v=20260407_ANALYTICS_CENTER_SHELL_83'), true, 'admin-studio.html should load the cache-busted admin studio stylesheet for analytics metric context states');
    assert.equal(adminStudioSource.includes('analytics-advanced-entry'), false, 'admin-studio.html should keep advanced analytics out of the main toolbar flow');
    assert.equal(adminStudioSource.includes('admin-config.js?v=20260405_GENERAL_RUNTIME_REMOVAL_1'), true, 'admin-studio.html should load the cache-busted admin config script for configurable ticket reply templates');
    assert.equal(adminStudioSource.includes('js/admin-tickets.js?v=20260406_ADMIN_TICKETS_WORKBENCH_CONTEXT_11'), true, 'admin-studio.html should load the cache-busted ticket admin script');
    assert.equal(ticketsSource.includes("recordAnalyticsResolutionFeedback: function (ticket = {}, newStatus = '', result = {}, doRefund = false) {"), true, 'js/admin-tickets.js should record analytics resolution feedback after ticket handling succeeds');
    assert.equal(ticketsSource.includes('pageSize: 12,'), true, 'js/admin-tickets.js should paginate tickets 12 at a time');
    assert.equal(ticketLinksSource.includes('root.AdminTicketLinks = api;'), true, 'js/admin-ticket-links.js should expose a shared ticket link protocol namespace');
    assert.equal(ticketLinksSource.includes('function buildLinkedTicketDescription(body = {}, actorLabel = \'\')'), true, 'js/admin-ticket-links.js should build linked ticket descriptions through the shared protocol');
    assert.equal(ticketLinksSource.includes('function parseLinkedOpsAlertContext(description = \'\')'), true, 'js/admin-ticket-links.js should parse linked ops alert ticket descriptions');
    assert.equal(ticketLinksSource.includes('function parseLinkedChatSessionContext(description = \'\')'), true, 'js/admin-ticket-links.js should parse linked chat ticket descriptions');
    assert.equal(ticketsSource.includes("fetchProfilesByIds: async function"), true, 'js/admin-tickets.js should fetch profile emails for ticket users');
    assert.equal(ticketsSource.includes("buildAdminTicketsUrl: function"), true, 'js/admin-tickets.js should build shared admin ticket URLs through the central admin route');
    assert.equal(ticketsSource.includes("showWorkbenchContext: function (context = {})"), true, 'js/admin-tickets.js should render analytics signal context notes when analytics opens the ticket module');
    assert.equal(ticketsSource.includes("buildAnalyticsIssueSummaryState: function () {"), true, 'js/admin-tickets.js should derive a queue issue summary when analytics opens the ticket module');
    assert.equal(ticketsSource.includes("buildAnalyticsShopOrdersContext: function (context = this.analyticsWorkbenchContext, options = {}) {"), true, 'js/admin-tickets.js should build a shop-orders return context from the active analytics workbench state');
    assert.equal(ticketsSource.includes("buildAnalyticsShopOrdersActionAttrs: function (context = this.analyticsWorkbenchContext, options = {}) {"), true, 'js/admin-tickets.js should build analytics-open-destination attrs for returning to shop orders');
    assert.equal(ticketsSource.includes("buildAnalyticsUserReturnAttrs: function (context = this.analyticsWorkbenchContext) {"), true, 'js/admin-tickets.js should build user-detail return attrs for user-commerce ticket drill-downs');
    assert.equal(ticketsSource.includes("buildAnalyticsContentCommerceReturnContext: function (context = this.analyticsWorkbenchContext) {"), true, 'js/admin-tickets.js should build content-commerce return context for content drill-down tickets');
    assert.equal(ticketsSource.includes("renderAnalyticsIssueSummary: function () {"), true, 'js/admin-tickets.js should render a ticket issue summary note for analytics drill-downs');
    assert.equal(ticketsSource.includes("focusAnalyticsIssueSummary: function (kind = '') {"), true, 'js/admin-tickets.js should let analytics issue summary chips jump into ticket subviews');
    assert.equal(ticketsSource.includes("buildAnalyticsPrioritySummaryState: function () {"), true, 'js/admin-tickets.js should derive prioritized ticket items for analytics drill-downs');
    assert.equal(ticketsSource.includes("renderAnalyticsPrioritySummary: function () {"), true, 'js/admin-tickets.js should render prioritized ticket items for analytics drill-downs');
    assert.equal(ticketsSource.includes("focusAnalyticsPrioritySummary: async function (action = '', ticketId = '') {"), true, 'js/admin-tickets.js should let analytics priority items jump into ticket handling actions');
    assert.equal(ticketsSource.includes('回订单承接链'), true, 'js/admin-tickets.js should provide a return-to-orders action from analytics-driven ticket views');
    assert.equal(ticketsSource.includes('回用户承接链'), true, 'js/admin-tickets.js should provide a return-to-user action from user-commerce ticket views');
    assert.equal(ticketsSource.includes('回内容带货详情'), true, 'js/admin-tickets.js should provide a return-to-content-commerce action from content drill-down ticket views');
    assert.equal(ticketsSource.includes("getTicketsListUrl: function"), true, 'js/admin-tickets.js should build a shared server-side tickets list request URL');
    assert.equal(ticketsSource.includes("getTicketsAssignUrl: function"), true, 'js/admin-tickets.js should build a shared ticket assignment route URL');
    assert.equal(ticketsSource.includes("getTicketsBatchProcessUrl: function"), true, 'js/admin-tickets.js should build a shared ticket batch processing route URL');
    assert.equal(ticketsSource.includes("getTicketHistoryUrl: function"), true, 'js/admin-tickets.js should build the ticket history admin route URL');
    assert.equal(ticketsSource.includes("getTicketsMetricsUrl: function"), true, 'js/admin-tickets.js should build the ticket metrics admin route URL');
    assert.equal(ticketsSource.includes("getTicketsSummaryActionsUrl: function"), true, 'js/admin-tickets.js should build the ticket summary actions route URL');
    assert.equal(ticketsSource.includes("getTicketsSummaryHistoryUrl: function"), true, 'js/admin-tickets.js should build the ticket summary history route URL');
    assert.equal(ticketsSource.includes("normalizeTicketWorkspaceView: function"), true, 'js/admin-tickets.js should normalize grouped ticket workspace views');
    assert.equal(ticketsSource.includes("getTicketWorkspaceMeta: function"), true, 'js/admin-tickets.js should describe ticket workspace titles and subtitles');
    assert.equal(ticketsSource.includes("getTicketWorkspaceTargetId: function"), true, 'js/admin-tickets.js should map grouped ticket workspaces to their primary sections');
    assert.equal(ticketsSource.includes("setWorkspaceView: function"), true, 'js/admin-tickets.js should switch the ticket module between grouped workspaces');
    assert.equal(ticketsSource.includes("syncTicketWorkspaceView: function"), true, 'js/admin-tickets.js should keep grouped ticket workspace tabs in sync with the active view');
    assert.equal(ticketsSource.includes("getReminderWorkspaceMode: function"), true, 'js/admin-tickets.js should distinguish overview reminder status from summary tracking workspace mode');
    assert.equal(ticketsSource.includes("syncReminderWorkspacePresentation: function"), true, 'js/admin-tickets.js should update reminder headings and content when ticket workspaces change');
    assert.equal(ticketsSource.includes("renderReminderSummaryStatusStrip: function"), true, 'js/admin-tickets.js should render a compact reminder status strip for the summary tracking workspace');
    assert.equal(ticketsSource.includes("renderReminderPanelActions: function"), false, 'js/admin-tickets.js should no longer render duplicate reminder action buttons inside the reminder panels');
    assert.equal(ticketsSource.includes("admin-ticket-overview-reminder-summary-entry__cards"), true, 'js/admin-tickets.js should render the daily SLA summary details as a horizontal subcard grid');
    assert.equal(ticketsSource.includes("includeFooterActions: isSummaryMode"), false, 'js/admin-tickets.js should no longer embed duplicate reminder actions inside the summary activity card');
    assert.equal(ticketsSource.includes("getReminderSummaryHistoryFallbackMessage: function"), true, 'js/admin-tickets.js should normalize summary history fallback copy before rendering it in the UI');
    assert.equal(ticketsSource.includes("if (normalized === 'batch')"), true, 'js/admin-tickets.js should merge the legacy batch workspace into the main processing workspace');
    assert.equal(ticketsSource.includes("renderReminderSummaryManualEvent: function"), true, 'js/admin-tickets.js should render recent manual handoff notes for summary jobs');
    assert.equal(ticketsSource.includes("renderReminderSummaryPreviewComparison: function"), true, 'js/admin-tickets.js should render preview deltas between recent summary jobs');
    assert.equal(ticketsSource.includes("renderReminderSummaryHandoffSummary: function"), true, 'js/admin-tickets.js should render a compact handoff summary for summary jobs');
    assert.equal(ticketsSource.includes("url.searchParams.set('route', normalizedRoute);"), true, 'js/admin-tickets.js should encode the ticket route as an admin route query parameter');
    assert.equal(ticketsSource.includes("this.buildAdminTicketsUrl('tickets/list', params)"), true, 'js/admin-tickets.js should load ticket pages through the central admin route helper');
    assert.equal(ticketsSource.includes("this.buildAdminTicketsUrl('tickets/metrics')"), true, 'js/admin-tickets.js should load ticket overview metrics through the central admin route helper');
    assert.equal(ticketsSource.includes("this.buildAdminTicketsUrl('tickets/summary-actions')"), true, 'js/admin-tickets.js should submit ticket summary actions through the central admin route helper');
    assert.equal(ticketsSource.includes("this.buildAdminTicketsUrl('tickets/summary-history'"), true, 'js/admin-tickets.js should load ticket summary history through the central admin route helper');
    assert.equal(ticketsSource.includes(".select('id, user_id, order_id, issue_type, status, description, admin_notes, created_at, updated_at')"), true, 'js/admin-tickets.js fallback loader should avoid selecting the legacy reason column directly');
    assert.equal(ticketsSource.includes("ticket.user_email"), true, 'js/admin-tickets.js should render ticket user email');
    assert.equal(ticketsSource.includes("focusTicket: async function"), true, 'js/admin-tickets.js should expose a direct ticket focus helper');
    assert.equal(ticketsSource.includes("getTicketLinkProtocol: function"), true, 'js/admin-tickets.js should centralize the shared ticket link protocol');
    assert.equal(ticketsSource.includes("parseLinkedChatSessionContext: function"), true, 'js/admin-tickets.js should parse linked chat session context');
    assert.equal(ticketsSource.includes("parseLinkedOpsAlertContext: function"), true, 'js/admin-tickets.js should parse linked ops alert context');
    assert.equal(ticketsSource.includes("return window.AdminTicketLinks || null;"), true, 'js/admin-tickets.js should read the shared ticket link protocol from the browser runtime');
    assert.equal(ticketsSource.includes("getWorkbenchLauncher: function"), true, 'js/admin-tickets.js should centralize the shared workbench launcher');
    assert.equal(ticketsSource.includes("openWorkbenchEntry: async function"), true, 'js/admin-tickets.js should expose a shared workbench entry helper');
    assert.equal(ticketsSource.includes("buildTicketWorkbenchEntry: function"), true, 'js/admin-tickets.js should centralize ticket workbench payload building');
    assert.equal(ticketsSource.includes("buildReplyModalDetailState: function"), true, 'js/admin-tickets.js should build a richer ticket reply panel detail model');
    assert.equal(ticketsSource.includes("buildReplyTemplates: function"), true, 'js/admin-tickets.js should build suggested ticket reply templates');
    assert.equal(ticketsSource.includes("ticketReplyTemplateConfigTemplates: null"), true, 'js/admin-tickets.js should cache configurable ticket reply templates');
    assert.equal(ticketsSource.includes("applyTicketReplyTemplateConfig: function"), true, 'js/admin-tickets.js should apply ticket reply template config from settings or server responses');
    assert.equal(ticketsSource.includes("handleOpsAlertsConfigUpdated: function"), true, 'js/admin-tickets.js should refresh ticket reply templates when ops alert settings change');
    assert.equal(ticketsSource.includes("buildConfiguredReplyTemplates: function"), true, 'js/admin-tickets.js should build reply suggestions from configured templates');
    assert.equal(ticketsSource.includes("window.addEventListener?.('ops-alerts-config-updated'"), true, 'js/admin-tickets.js should listen for ops alert config updates');
    assert.equal(ticketsSource.includes("normalizeOverviewPayload: function"), true, 'js/admin-tickets.js should normalize the ticket overview payload');
    assert.equal(ticketsSource.includes("loadOverview: async function"), true, 'js/admin-tickets.js should load the ticket SLA and efficiency overview');
    assert.equal(ticketsSource.includes("openOverdueQueue: function"), true, 'js/admin-tickets.js should expose a shortcut into the overdue queue');
    assert.equal(ticketsSource.includes("openSlaSettings: function"), true, 'js/admin-tickets.js should deep-link from the overview into ticket reminder settings');
    assert.equal(ticketsSource.includes("window.switchModule?.('ops-alerts')"), true, 'js/admin-tickets.js should route reminder settings shortcuts into the ops alerts module');
    assert.equal(ticketsSource.includes("switchOpsAlertsView('monitors')"), true, 'js/admin-tickets.js should focus the ops alerts monitors view before highlighting ticket reminder controls');
    assert.equal(ticketsSource.includes("renderReminderPanel: function"), true, 'js/admin-tickets.js should render the ticket reminder status panel');
    assert.equal(ticketsSource.includes("buildReplyTimelineItems: function"), true, 'js/admin-tickets.js should build a ticket processing timeline model');
    assert.equal(ticketsSource.includes("buildTicketPriorityMeta: function"), true, 'js/admin-tickets.js should derive ticket priority metadata for triage');
    assert.equal(ticketsSource.includes("buildBulkProcessTemplates: function"), true, 'js/admin-tickets.js should build batch-processing reply templates');
    assert.equal(ticketsSource.includes("normalizeReplyTimelineItems: function"), true, 'js/admin-tickets.js should normalize remote ticket timeline items');
    assert.equal(ticketsSource.includes("mergeReplyTimelineItems: function"), true, 'js/admin-tickets.js should merge remote audit history with local timeline items');
    assert.equal(ticketsSource.includes("mergeReplyTemplateText: function"), true, 'js/admin-tickets.js should merge reply templates into the current admin draft');
    assert.equal(ticketsSource.includes("renderReplyModalQuickActions: function"), true, 'js/admin-tickets.js should render ticket reply panel quick actions');
    assert.equal(ticketsSource.includes("renderReplyModalTemplates: function"), true, 'js/admin-tickets.js should render ticket reply templates');
    assert.equal(ticketsSource.includes("renderReplyModalTimeline: function"), true, 'js/admin-tickets.js should render a ticket reply timeline');
    assert.equal(ticketsSource.includes("loadReplyTimelineHistory: async function"), true, 'js/admin-tickets.js should hydrate ticket timelines from admin audit history');
    assert.equal(ticketsSource.includes("const internalNote = document.getElementById('ticketInternalNote')?.value.trim() || '';"), true, 'js/admin-tickets.js should collect admin-only internal notes separately from the public reply');
    assert.equal(ticketsSource.includes("submitBulkAssignment: async function"), true, 'js/admin-tickets.js should expose ticket bulk assignment');
    assert.equal(ticketsSource.includes("submitBulkProcess: async function"), true, 'js/admin-tickets.js should expose ticket batch processing');
    assert.equal(ticketsSource.includes("toggleSelectAllPage: function"), true, 'js/admin-tickets.js should support page-level ticket selection');
    assert.equal(ticketsSource.includes("shouldUseClientSideListFallback: function"), true, 'js/admin-tickets.js should detect when the backend tickets list route is unavailable');
    assert.equal(ticketsSource.includes("loadTicketsViaSupabaseFallback: async function"), true, 'js/admin-tickets.js should fall back to client-side ticket loading when needed');
    assert.equal(adminStudioSource.includes('ticketReplySummaryGrid'), true, 'admin-studio.html should include the ticket summary grid container');
    assert.equal(adminStudioSource.includes('ticketReplyQuickActions'), true, 'admin-studio.html should include the ticket quick action container');
    assert.equal(adminStudioSource.includes('ticketReplyTemplates'), true, 'admin-studio.html should include the ticket reply template container');
    assert.equal(adminStudioSource.includes('ticketReplyTimeline'), true, 'admin-studio.html should include the ticket reply timeline container');
    assert.equal(adminStudioSource.includes('ticketInternalNote'), true, 'admin-studio.html should include the admin-only internal note input');
    assert.equal(adminStudioSource.includes('admin-ticket-summary-job-modal__close'), false, 'admin-studio.html should dismiss the ticket summary detail modal through overlay clicks instead of an X close button');
    assert.equal(adminStudioSource.includes('admin-ticket-reply-modal__close'), false, 'admin-studio.html should dismiss the ticket reply panel through overlay clicks instead of an X close button');
    assert.equal(adminStudioSource.includes('admin-ticket-bulk-modal__close'), false, 'admin-studio.html should dismiss the ticket bulk process modal through overlay clicks instead of an X close button');
    assert.equal(adminStudioSource.includes('ticketsSelectionToolbar'), true, 'admin-studio.html should include the ticket selection toolbar');
    assert.equal(adminStudioSource.includes('ticketsBatchDropdownMenu'), true, 'admin-studio.html should include the ticket bulk action dropdown menu');
    assert.equal(adminStudioSource.includes('ticketsSelectedCountWrapper'), true, 'admin-studio.html should include the ticket selected count wrapper');
    assert.equal(adminStudioSource.includes('ticketsBulkToolbar'), false, 'admin-studio.html should no longer include the legacy ticket bulk action toolbar');
    assert.equal(adminStudioSource.includes('ticketsSelectAllCheckbox'), true, 'admin-studio.html should include the ticket page selection checkbox');
    assert.equal(adminStudioSource.includes('ticketBulkProcessModal'), true, 'admin-studio.html should include the ticket bulk process modal');
    assert.equal(adminStudioSource.includes('ticketMineFilterBtn'), true, 'admin-studio.html should include the ticket ownership quick filter');
    assert.equal(adminStudioSource.includes('ticketsOverviewPanel'), true, 'admin-studio.html should include the ticket overview dashboard shell');
    assert.equal(adminStudioSource.includes('ticketsOverviewGrid'), true, 'admin-studio.html should include the ticket overview KPI grid');
    assert.equal(adminStudioSource.includes('ticketsOverviewSourceBreakdown'), true, 'admin-studio.html should include the ticket overview source breakdown');
    assert.equal(adminStudioSource.includes('ticketsOverviewIssueBreakdown'), true, 'admin-studio.html should include the ticket overview issue type breakdown');
    assert.equal(adminStudioSource.includes('ticketsOverviewReminderPanel'), true, 'admin-studio.html should include the ticket overview reminder panel');
    assert.equal(adminStudioSource.includes('ticketsOverviewReminderHeading'), true, 'admin-studio.html should include a reminder section heading that can switch by workspace');
    assert.equal(adminStudioSource.includes('ticketsOverviewReminderMeta'), true, 'admin-studio.html should include reminder meta copy that can switch by workspace');
    assert.equal(adminStudioSource.includes('ticketsFunctionNav'), true, 'admin-studio.html should include the grouped ticket workspace navigation');
    assert.equal(adminStudioSource.includes('按功能分类'), false, 'admin-studio.html should remove the redundant ticket workspace eyebrow copy');
    assert.equal(adminStudioSource.includes('ticketWorkspaceBatchTab'), false, 'admin-studio.html should no longer expose a separate batch workspace tab');
    assert.equal(adminStudioSource.includes('工单处理'), true, 'admin-studio.html should expose a unified processing workspace tab');
    assert.equal(adminStudioSource.includes('data-admin-action="tickets-switch-workspace"'), true, 'admin-studio.html should delegate grouped ticket workspace switches through the shared action bus');
    assert.equal(adminStudioSource.includes('opsAlertTicketReplyTemplateAddButton'), true, 'admin-studio.html should include the add button for configurable ticket reply templates');
    assert.equal(adminStudioSource.includes('opsAlertTicketReplyTemplates'), true, 'admin-studio.html should include the configurable ticket reply template container');
    assert.equal(adminConfigSource.includes('function renderOpsAlertTicketReplyTemplates'), true, 'admin-config.js should render configurable ticket reply templates');
    assert.equal(adminConfigSource.includes('function collectOpsAlertTicketReplyTemplatesFromForm'), true, 'admin-config.js should collect configurable ticket reply templates from the settings form');
    assert.equal(adminConfigSource.includes('function addOpsAlertTicketReplyTemplate'), true, 'admin-config.js should expose a helper to add new ticket reply templates');
    assert.equal(adminWorkbenchSource.includes('reply_templates: normalizeTicketReplyTemplates'), true, 'js/admin-workbench.js should deep-clone configurable ticket reply templates');
    assert.equal(ticketsSource.includes("openWorkbench: async function"), true, 'js/admin-tickets.js should expose a workbench bridge helper');
    assert.equal(ticketsSource.includes("window.getOpsAlertWorkspaceAction"), true, 'js/admin-tickets.js should resolve linked ops alert workspaces through the shared resolver');
    assert.equal(ticketsSource.includes("labelVariant: 'ticket'"), true, 'js/admin-tickets.js should request ticket-specific workspace action labels from the shared resolver');
    assert.equal(ticketsSource.includes("window.openAdminWorkbenchEntry || window.openOpsAlertWorkspace"), true, 'js/admin-tickets.js should prefer the shared admin workbench launcher');
    assert.equal(ticketsSource.includes("window.buildTicketWorkbenchEntry(target, ticket, {"), true, 'js/admin-tickets.js should delegate ticket workbench payloads through the shared runtime');
    assert.equal(ticketsSource.includes("const workbenchEntry = this.buildTicketWorkbenchEntry(ticket, normalizedTarget);"), true, 'js/admin-tickets.js should reuse the shared ticket workbench payload for execution');
    assert.equal(adminWorkbenchSource.includes("function buildTicketWorkbenchEntry(target = 'chat', ticket = {}, options = {})"), true, 'js/admin-workbench.js should expose a shared ticket workbench payload builder');
    assert.equal(adminWorkbenchSource.includes("window.AdminTickets?.focusTicket"), true, 'js/admin-workbench.js should directly focus ticket workspaces when a ticket id is available');
});

test('discount admin runtime renderers externalize table states, copy toast, and modal visibility styling', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioCss = readRepoFile('admin-studio.css');
    const adminStudioPageCss = readRepoFile('css/admin-studio-page.css');
    const discountsSource = readRepoFile('admin-discounts.js');

    const removedRuntimeMarkers = [
        'style="text-align:center;color:var(--text-dim);padding:20px;"',
        'style="text-align:center;color:#ef4444;padding:20px;"',
        'style="text-align:center;color:var(--text-dim);height:300px;vertical-align:middle;"',
        'style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;"',
        'style="font-size:32px;margin-bottom:16px;opacity:0.5;"',
        'style="color:#60a5fa;font-weight:600;"',
        'style="color:#f59e0b;font-weight:600;"',
        'style="font-family:\'SF Mono\',Consolas,monospace; font-size:14px;',
        'style="display:inline-flex; flex-direction:column; align-items:center;"',
        'style="display: flex; justify-content: center; gap: 8px;"',
        'style="display: flex; align-items: center; justify-content: center; gap: 15px; margin-top: 20px;"',
        "toast.style.cssText =",
        "toast.style.opacity = '1'",
        "toast.style.transform = 'translateX(-50%) translateY(0)'",
        "modal.style.display = 'flex'",
        "modal.style.opacity = '1'",
        "modal.style.visibility = 'visible'",
        "modal.style.opacity = '0'",
        "modal.style.visibility = 'hidden'",
        "modal.style.display = 'none'",
        "dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'",
        "dropdown.style.display = 'none'",
        "target.closest('[data-admin-overlay-close=\"discount-generate-modal\"]')",
        '<span style="font-size:1rem">💰</span> 固定金额立减',
        '<span style="font-size:1rem">📊</span> 按比例打折'
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(discountsSource.includes(marker), false, `admin-discounts.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        'bindStaticControls: function',
        'scopeSummary: null',
        'renderScopeHint: function',
        'createTableStateRow: function',
        'buildTableLoadingSkeleton: function',
        'setGenerateModalVisible: function',
        'setTypeDropdownOpen: function',
        'getDiscountTypeMarkup: function',
        'admin-discount-type-value admin-discount-type-value--percent',
        'admin-discount-status-muted',
        'admin-discount-code-btn',
        'admin-discount-usage-meta',
        'admin-discount-status-stack',
        'admin-discount-action-wrap',
        'admin-discount-scope-hint',
        'admin-discount-pagination-shell',
        'admin-discount-copy-toast',
        "modal.classList.toggle('is-visible', visible)",
        'if (target === modal)',
        "dropdown.classList.toggle('is-open', open)",
        'admin-discount-type-label-icon'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(discountsSource.includes(marker), true, `admin-discounts.js should contain ${marker}`);
    }

    const expectedCssMarkers = [
        '.admin-discount-table-state-cell',
        '.admin-discount-type-value--percent',
        '.admin-discount-type-value--fixed',
        '.admin-discount-code-btn',
        '.admin-discount-status-stack',
        '.admin-discount-scope-hint',
        '.admin-discount-scope-hint__count',
        '.admin-discount-pagination-shell',
        '.admin-discount-copy-toast',
        '.admin-discount-copy-toast.is-visible',
        '.admin-discount-generate-modal.is-visible',
        '.admin-discount-type-dropdown.is-open',
        '.admin-discount-type-label-icon'
    ];

    for (const marker of expectedCssMarkers) {
        assert.equal(adminStudioCss.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    assert.match(
        adminStudioSource,
        /admin-studio\.css\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should reference the updated admin stylesheet version'
    );
    assert.match(
        adminStudioSource,
        /admin-discounts\.js\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should reference the updated admin discounts script version'
    );
    assert.equal(
        adminStudioSource.includes('admin-discount-generate-modal'),
        true,
        'admin-studio.html should expose the discount generate modal runtime class'
    );
    assert.equal(
        adminStudioSource.includes('admin-discount-type-dropdown'),
        true,
        'admin-studio.html should expose the discount type dropdown runtime class'
    );

    const pageCssMarkers = [
        '[data-admin-action="discounts-open-generate-modal"].admin-studio-inline-style-attr-160:hover',
        '.admin-studio-inline-style-attr-164.is-visible',
        '.admin-studio-inline-style-attr-164.is-visible .admin-studio-inline-style-attr-165',
        '.admin-studio-inline-style-attr-202 { display:flex;',
        'pointer-events:none; visibility:hidden; opacity:0;',
        'animation:none; overflow: hidden;'
    ];

    for (const marker of pageCssMarkers) {
        assert.equal(adminStudioPageCss.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }
});

test('ticket admin runtime renderers externalize row states, modal visibility, and copy toast styling', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioCss = readRepoFile('admin-studio.css');
    const ticketsSource = readRepoFile('js/admin-tickets.js');

    const removedRuntimeMarkers = [
        `style="text-align:center; padding: 20px;"`,
        `badge.style.background =`,
        `button.style.color =`,
        `actionWrap.style.display = 'flex'`,
        `modal.style.display = 'flex'`,
        `toast.style.cssText =`
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(ticketsSource.includes(marker), false, `js/admin-tickets.js should not contain ${marker}`);
    }

    const delegatedRuntimeMarkers = [
        'createTableStateRow: function',
        'buildTableLoadingSkeleton: function',
        'buildWorkbenchActionDefinitions: function',
        'variant: \'chat\'',
        'variant: \'order\'',
        'variant: \'user\'',
        'variant: \'source\'',
        'admin-ticket-status-badge admin-ticket-status-badge--${normalizedStatus.toLowerCase()}',
        'admin-ticket-action-btn admin-ticket-action-btn--${variant}',
        'admin-ticket-pagination-shell',
        "modal.classList.add('is-visible')",
        "modal.classList.remove('is-visible')",
        'admin-ticket-copy-toast',
        'renderReplyModalTemplates: function',
        'renderReplyModalTimeline: function'
    ];

    for (const marker of delegatedRuntimeMarkers) {
        assert.equal(ticketsSource.includes(marker), true, `js/admin-tickets.js should contain ${marker}`);
    }

    const expectedCssMarkers = [
        '.admin-ticket-table-state-cell',
        '.admin-ticket-status-badge--pending',
        '.admin-ticket-action-btn--resolve',
        '.admin-ticket-action-btn--chat',
        '.admin-ticket-action-btn--order',
        '.admin-ticket-action-btn--user',
        '.admin-ticket-action-btn--source',
        '.admin-ticket-reply-modal.is-visible',
        '.admin-ticket-reply-modal__templates',
        '.admin-ticket-reply-modal__timeline',
        '.admin-ticket-copy-toast'
    ];

    for (const marker of expectedCssMarkers) {
        assert.equal(adminStudioCss.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    assert.match(
        adminStudioSource,
        /admin-studio\.css\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should reference the updated admin stylesheet version'
    );
    assert.match(
        adminStudioSource,
        /js\/admin-tickets\.js\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should reference the updated admin tickets script version'
    );
});

test('admin studio security, verify, and affiliate controls route through delegated actions', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminStudioStyles = readRepoFile('admin-studio.css');
    const adminConfigSource = readRepoFile('admin-config.js');
    const analyticsSource = readRepoFile('admin-analytics.js');

    const removedInlineMarkers = [
        `onclick="toggleCustomDropdown('lockoutDurationDropdown')"`,
        `onclick="selectDropdownOption('lockoutDurationDropdown', '300000', '5')"`,
        `onclick="saveLoginSecuritySettings()"`,
        `onclick="refreshLockedAccounts()"`,
        `onclick="unlockAllAccounts()"`,
        `onclick="saveIpBlacklist()"`,
        `onclick="toggleCustomDropdown('perPageDropdown')"`,
        `onclick="selectDropdownOption('defaultSortDropdown', 'newest', '最新')"`,
        `onchange="window.saveVerifyConfig && window.saveVerifyConfig()"`,
        `onfocus="this.removeAttribute('readonly');"`,
        `onblur="this.setAttribute('readonly', 'readonly');"`,
        `onclick="window.checkVerifyQuota && window.checkVerifyQuota()"`,
        `onchange="window.saveAffiliateSetting('commission_rate_shop', this.value)"`,
        `onchange="window.saveAffiliatePosterField('title', this.value)"`,
        `onclick="addNewApiKey()"`,
        `onclick="openExperimentModal()"`,
        `onclick="loadExperimentsList()"`,
        `onclick="closeABResultsChart()"`,
        `onclick="closeExperimentModal()"`,
        `onsubmit="handleCreateExperiment(event)"`,
        `onclick="addVariantRow()"`
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(adminStudioSource.includes(marker), false, `admin-studio.html should not contain ${marker}`);
    }

    const delegatedMarkers = [
        'data-admin-action="settings-add-channel"',
        'data-admin-action="settings-toggle-custom-dropdown"',
        'data-admin-action="settings-select-dropdown-option"',
        'data-admin-action="settings-save-login-security"',
        'data-admin-action="settings-refresh-locked-accounts"',
        'data-admin-action="settings-unlock-all-accounts"',
        'data-admin-action="settings-save-ip-blacklist"',
        'data-admin-change-action="settings-save-verify-config"',
        'data-admin-action="settings-refresh-verify-monitor"',
        'data-admin-focus-action="settings-verify-api-key-unlock"',
        'data-admin-blur-action="settings-verify-api-key-lock"',
        'data-admin-change-action="affiliate-save-setting"',
        'data-admin-change-action="affiliate-save-poster-field"',
        'data-admin-action="settings-add-api-key"'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const adminScriptMarkers = [
        'settings-add-channel',
        'settings-prompt-api-key',
        'settings-toggle-custom-dropdown',
        'settings-save-login-security',
        'settings-refresh-locked-accounts',
        'settings-unlock-account',
        'settings-save-ip-blacklist',
        'settings-refresh-verify-monitor',
        'settings-change-verify-monitor-task-page',
        'settings-change-verify-monitor-failure-page',
        'settings-save-verify-config',
        'affiliate-save-setting',
        'affiliate-save-poster-field',
        'analytics-load-ai-prediction',
        '[data-admin-focus-action]',
        '[data-admin-blur-action]',
        "case 'user-modal':"
    ];

    for (const marker of adminScriptMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    assert.equal(
        adminStudioSource.includes('id="userModalOverlay" data-admin-overlay-close="user-modal"'),
        true,
        'admin-studio.html should let the shared overlay close dispatcher dismiss the user modal'
    );

    assert.equal(adminStudioSource.includes('id="lockedAccountsRefreshButton"'), true, 'admin-studio.html should expose a dedicated locked accounts refresh button');
    assert.equal(adminStudioSource.includes('id="lockedAccountsRefreshIndicator"'), true, 'admin-studio.html should expose locked accounts refresh feedback');
    assert.equal(adminStudioSource.includes('保存登录规则'), true, 'admin-studio.html should label the login security save action clearly');
    assert.equal(adminStudioSource.includes('保存黑名单'), true, 'admin-studio.html should label the blacklist save action clearly');
    assert.match(adminStudioStyles, /#module-settings #settings-view-security \.module-content\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/, 'admin-studio.css should give the security settings view a dedicated two-column layout');
    assert.match(adminStudioStyles, /#module-settings #settings-view-security \.settings-section\s*\{[\s\S]*box-sizing: border-box;/, 'admin-studio.css should keep security settings sections inside the available width');
    assert.equal(adminStudioStyles.includes('.security-group__head'), true, 'admin-studio.css should define an explicit login security group header layout');
    assert.equal(adminStudioStyles.includes('.security-setting-card:hover'), true, 'admin-studio.css should highlight login rule cards on hover');
    assert.equal(adminStudioStyles.includes('.security-subcard:focus-within'), true, 'admin-studio.css should highlight nested security cards while interacting with their contents');
    assert.match(adminStudioStyles, /\.security-subcards-grid\s*\{[\s\S]*margin-top:\s*10px;/, 'admin-studio.css should add breathing room between login rule cards and the lower security subcards');
    assert.equal(adminStudioStyles.includes('.admin-audit-monitor-card:focus-within'), true, 'admin-studio.css should highlight admin access summary cards while interacting with them');
    assert.equal(adminStudioStyles.includes('.admin-audit-monitor-panel:focus-within'), true, 'admin-studio.css should highlight admin access panels while interacting with them');
    assert.equal(adminStudioStyles.includes('.admin-audit-monitor-item:hover'), true, 'admin-studio.css should highlight admin access list items on hover');
    assert.equal(adminStudioSource.includes('verify-monitor-list verify-monitor-list--compact'), true, 'admin-studio.html should render verify monitor task and failure lists with compact scroll containers');
    assert.equal(adminStudioStyles.includes('.verify-monitor-list--compact'), true, 'admin-studio.css should keep recent verify tasks and failures inside compact scroll regions');
    assert.equal(adminStudioStyles.includes('.verify-monitor-item__chips'), true, 'admin-studio.css should support compact verify monitor detail chips');
    assert.equal(adminConfigSource.includes('class="verify-monitor-item__chips"'), true, 'admin-config.js should render verify monitor detail rows as compact chip groups');
    assert.equal(adminStudioStyles.includes('.verify-monitor-facts'), true, 'admin-studio.css should render the verify monitor facts grid');
    assert.equal(adminStudioStyles.includes('.verify-monitor-pagination'), true, 'admin-studio.css should style verify monitor pagination controls');
    assert.equal(adminConfigSource.includes('focusVerifyMonitorWorkspace'), true, 'admin-config.js should expose verify monitor workspace focusing for deep-linked alerts');
    assert.equal(adminConfigSource.includes('focusAdminAuditMonitorWorkspace'), true, 'admin-config.js should expose admin audit workspace focusing for deep-linked alerts');
    assert.equal(adminStudioStyles.includes('.ops-alert-monitor-item.is-focused'), true, 'admin-studio.css should highlight focused workspace alert rows');
    assert.match(adminStudioStyles, /\.config-textarea\s*\{[\s\S]*box-sizing: border-box;/, 'admin-studio.css should keep config textareas inside their cards');
    assert.equal(adminConfigSource.includes('setLockedAccountsRefreshButtonState'), true, 'admin-config.js should manage locked account refresh button state');
    assert.equal(adminConfigSource.includes('showLockedAccountsRefreshIndicator'), true, 'admin-config.js should surface locked account refresh feedback');

    const removedDynamicMarkers = [
        `onclick="unlockAccount('`,
        `onclick="showABResults('`,
        `onclick="this.parentElement.remove()"`,
        `onclick="promptForApiKey()"`,
        `onclick="deleteApiKey()"`
    ];

    for (const marker of removedDynamicMarkers) {
        assert.equal(
            adminConfigSource.includes(marker) || analyticsSource.includes(marker) || adminStudioScript.includes(marker),
            false,
            `delegated admin templates should not contain ${marker}`
        );
    }

    assert.equal(adminConfigSource.includes('data-admin-action="settings-unlock-account"'), true, 'admin-config.js should render delegated locked-account actions');
    assert.equal(readAdminAnalyticsRuntimeSource().includes('window.loadAIPrediction = loadAIPrediction;'), true, 'analytics runtime should expose loadAIPrediction for delegated use');
    assert.equal(analyticsSource.includes('window.loadExperimentsList = loadExperimentsList;'), false, 'admin-analytics.js should no longer expose experiments list loading in the daily analytics shell');
});

test('shop admin pagination and inventory/product workflows no longer emit targeted inline handlers', () => {
    const shopSource = readRepoFile('js/admin-shop.js');
    const adminStudioSource = readRepoFile('admin-studio.html');

    const removedShopMarkers = [
        `onclick="ShopAdmin.loadInventoryList(`,
        `onclick="ShopAdmin.toggleSelectionMode()"`,
        `onclick="ShopAdmin.toggleBatchMenu()"`,
        `onclick="ShopAdmin.openReleaseModal()"`,
        `onclick="ShopAdmin.switchTab('products')"`,
        `onclick="ShopAdmin.filterCategory('all', this)"`,
        `onclick="ShopAdmin.filterStatus('active', this)"`,
        `onclick="ShopAdmin.toggleProductSelectionMode()"`,
        `onclick="ShopAdmin.toggleProductBatchMenu()"`,
        `onclick="ShopAdmin.selectAllProducts()"`,
        `onclick="ShopAdmin.batchDeleteProducts()"`,
        `onclick="ShopAdmin.exportProducts(true)"`,
        `onclick="document.getElementById('iconUploadFile').click()"`,
        `onchange="ShopAdmin.handleIconUpload(this)"`,
        `onclick="ShopAdmin.addTieredPricingRow()"`,
        `onclick="this.parentElement.remove()"`,
        `onclick="ShopAdmin.toggleDeliveryTypeDropdown()"`,
        `onclick="ShopAdmin.selectDeliveryType('KEY', '卡密池发放 (KEY)')"`,
        `onclick="ShopAdmin.saveProduct()"`,
        `onchange="ShopAdmin.toggleSelectAll(this)"`,
        `onclick="ShopAdmin.editProduct('`,
        `onclick="ShopAdmin.toggleStatus('`,
        `onclick="ShopAdmin.deleteProduct('`,
        `onclick="ShopAdmin.showOrderContent('`,
        `onclick="ShopAdmin.refundOrder('`,
        `onclick="ShopAdmin.showInventoryDetail('`,
        `onclick="ShopAdmin.openFaultModal('`,
        `onclick="ShopAdmin.deleteInventoryItem('`,
        `onclick="document.getElementById('refundModal').remove()"`,
        `onclick="ShopAdmin.submitRefund('`
    ];

    for (const marker of removedShopMarkers) {
        assert.equal(
            shopSource.includes(marker) || adminStudioSource.includes(marker),
            false,
            `shop/admin templates should not contain ${marker}`
        );
    }

    const delegatedMarkers = [
        'data-shop-action="shop-switch-tab"',
        'data-shop-action="product-filter-category"',
        'data-shop-action="product-filter-status"',
        'data-shop-action="product-toggle-selection-mode"',
        'data-shop-action="product-toggle-batch-menu"',
        'data-shop-action="product-select-all"',
        'data-shop-action="product-batch-delete"',
        'data-shop-action="product-export-selected"',
        'data-shop-action="product-edit"',
        'data-shop-action="product-toggle-status"',
        'data-shop-action="product-delete"',
        'data-shop-action="inventory-toggle-selection-mode"',
        'data-shop-action="inventory-open-release-modal"',
        'data-shop-action="product-upload-icon"',
        'data-shop-action="product-add-tiered-pricing"',
        'data-shop-action="product-remove-tiered-pricing-row"',
        'data-shop-action="product-toggle-delivery-type-dropdown"',
        'data-shop-change="product-selection-count"',
        'data-shop-change="product-handle-icon-upload"',
        'data-shop-change="inventory-toggle-select-all"',
        'data-shop-action="order-show-content"',
        'data-shop-action="order-refund"',
        'data-shop-action="refund-submit"',
        'data-shop-action="inventory-show-detail"',
        'data-shop-action="inventory-open-fault-modal"',
        'data-shop-action="pagination-go"'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(
            shopSource.includes(marker) || adminStudioSource.includes(marker),
            true,
            `shop/admin templates should contain ${marker}`
        );
    }

    assert.equal(shopSource.includes('bindDelegatedHandlers: function'), true, 'js/admin-shop.js should bind delegated handlers');
    assert.equal(shopSource.includes('data-shop-overlay-close="dynamic-modal"'), true, 'js/admin-shop.js should render delegated dynamic modal overlays');
    assert.equal(shopSource.includes('bindOverlayDismiss: function'), true, 'js/admin-shop.js should expose a shared overlay dismiss helper for shop modals');
    assert.equal(shopSource.includes('bindStaticOverlayDismisses: function'), true, 'js/admin-shop.js should bind dedicated dismiss handlers for static shop overlays');
});

test('shop admin product grid runtime templates externalize card styling and visibility state', () => {
    const shopSource = readRepoFile('js/admin-shop.js');
    const shopStyles = readRepoFile('css/admin-studio-page.css');

    const removedRuntimeMarkers = [
        'container.style.gridTemplateColumns',
        'container.style.gap =',
        'container.style.padding =',
        'addCard.style.cssText =',
        'card.style.cssText =',
        'addCard.onmouseover = () =>',
        'addCard.onmouseout = () =>',
        'btn.onmouseover = () =>',
        'btn.onmouseout = () =>',
        '<div style="${imageContainerStyle}">',
        'class="action-btn" data-shop-action="product-edit"',
        "card.style.cursor = 'pointer'",
        "const checkboxDisplay = this.isProductSelectionMode ? 'block' : 'none';",
        '<div style="position:absolute; top:12px; left:12px; display:${checkboxDisplay};" class="product-checkbox-wrapper">'
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(shopSource.includes(marker), false, `js/admin-shop.js should not retain ${marker}`);
    }

    const delegatedMarkers = [
        "container.classList.add('shop-grid', 'shop-admin-products-grid')",
        'renderProductGridSkeleton: function',
        "addCard.dataset.shopAction = 'product-open-create-modal'",
        'shop-admin-product-card shop-admin-product-card--create',
        'shop-admin-product-cover',
        'shop-admin-product-action-btn',
        'shop-admin-status-badge',
        "grid.classList.toggle('shop-admin-products-grid--selection-mode'",
        "menu.classList.contains('is-open')",
        "menu.classList.add('is-open')",
        "menu.classList.remove('is-open')"
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.shop-view--active',
        '.batch-menu.is-open',
        '.shop-admin-products-grid',
        '.shop-admin-product-card--skeleton',
        '.shop-admin-skeleton--title',
        '@keyframes shop-admin-skeleton-shimmer',
        '.shop-admin-product-card--create',
        '.shop-admin-product-cover',
        '.shop-admin-status-badge',
        '.shop-admin-product-action-btn'
    ];

    for (const marker of styleMarkers) {
        assert.equal(shopStyles.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }
});

test('shop admin order workflows externalize runtime table-row and modal styling', () => {
    const shopSource = readRepoFile('js/admin-shop.js');
    const shopStyles = readRepoFile('css/admin-studio-page.css');
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminWorkbenchSource = readRepoFile('js/admin-workbench.js');

    const removedRuntimeMarkers = [
        'style="cursor: pointer;" title="点击查看订单详情"',
        'overlay.style.position = \'fixed\'',
        '<style>',
        '<div style="margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">',
        'style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);backdrop-filter:blur(12px);z-index:9999;display:flex;justify-content:center;align-items:center;"',
        'style="width:36px;height:36px;"',
        'class="btn-icon danger"'
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(shopSource.includes(marker), false, `js/admin-shop.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        "shop-order-row${isFocusedOrder ? ' shop-order-row--focused' : ''}",
        'shop-order-row--focused',
        'shop-order-user-avatar',
        'shop-order-content-overlay',
        'shop-order-content-box',
        'data-shop-action="order-close-content"',
        'shop-refund-modal-overlay',
        'shop-refund-status-grid',
        'shop-refund-modal-textarea refund-modal-input',
        'shop-order-action-btn shop-order-action-btn--refund',
        'focusOrder: async function',
        'buildInventoryDetailLoadingSkeleton: function',
        'buildImportTreeLoadingSkeleton: function',
        'buildDeliveryTrendLoadingSkeleton: function'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.shop-order-row',
        '.shop-order-row--focused',
        '.shop-order-content-overlay',
        '.shop-order-content-overlay.is-visible',
        '.shop-order-content-box',
        '.shop-refund-modal-overlay',
        '.shop-refund-modal-overlay.is-visible',
        '.shop-refund-status-grid',
        '.shop-refund-modal-textarea',
        '.shop-order-action-btn--refund',
        '.shop-inventory-detail-loading--skeleton',
        '.shop-import-tree-state--skeleton',
        '.shop-delivery-empty--skeleton',
        '.shop-delivery-table-note--skeleton',
        '.shop-delivery-chart-skeleton'
    ];

    for (const marker of styleMarkers) {
        assert.equal(shopStyles.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }

    assert.equal(adminStudioSource.includes('js/admin-shop.js?v=20260406_ADMIN_SHOP_ANALYTICS_CONTEXT_12'), true, 'admin-studio.html should load the cache-busted shop admin script');
    assert.equal(adminStudioSource.includes('admin-config.js?v=20260405_GENERAL_RUNTIME_REMOVAL_1'), true, 'admin-studio.html should load the cache-busted admin config script');
    assert.equal(adminWorkbenchSource.includes('window.ShopAdmin?.focusOrder'), true, 'js/admin-workbench.js should directly focus shop order workspaces when an order id is available');
    assert.equal(adminWorkbenchSource.includes('function buildOpsAlertWorkspaceAnalyticsSignalContextState(context = {}, options = {})'), true, 'js/admin-workbench.js should build shared analytics signal context state for workbench destinations');
});

test('shop admin inventory workflows externalize runtime table and modal styling', () => {
    const shopSource = readRepoFile('js/admin-shop.js');
    const shopStyles = readRepoFile('css/admin-studio-page.css');

    const removedRuntimeMarkers = [
        'style="display:${checkboxDisplay}"',
        'style="cursor:pointer; padding:5px 10px; border-radius:6px; background:rgba(255,255,255,0.03); transition:all 0.2s; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"',
        'style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);z-index:9999;display:flex;justify-content:center;align-items:center;"',
        "'reserve': '<span style=\"background:rgba(107,158,206,0.2);color:#bfdbfe;padding:3px 10px;border-radius:20px;font-size:12px;\"",
        'style="background:rgba(30,35,50,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:25px;width:500px;max-width:90%;max-height:80vh;overflow-y:auto;"',
        'style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:15px;margin-bottom:15px;"'
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(shopSource.includes(marker), false, `js/admin-shop.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        'buildShopTableLoadingSkeleton: function',
        'buildAdminShopUrl: function',
        'loadInventoryViaAdminApi: async function',
        'shop-inventory-content-chip',
        'shop-inventory-status-badge',
        'shop-inventory-fault-overlay',
        'shop-inventory-detail-overlay',
        'shop-inventory-detail-inline-btn',
        'shop-inventory-detail-entry',
        'shop-inventory-detail-card-value--status',
        'shop-inventory-copy-feedback',
        'shop-inventory-selection-toggle-cell'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    assert.equal(
        shopSource.includes(".rpc('fn_admin_list_inventory'"),
        false,
        'js/admin-shop.js should not retain the legacy inventory list rpc call'
    );
    assert.equal(
        shopSource.includes("buildAdminShopUrl('shop/inventory'"),
        true,
        'js/admin-shop.js should route inventory reads through the admin inventory handler'
    );
    assert.equal(
        shopSource.includes("buildAdminShopUrl('shop/inventory-detail'"),
        true,
        'js/admin-shop.js should route inventory detail through the admin inventory detail handler'
    );
    assert.equal(
        shopSource.includes("buildAdminShopUrl('shop/products'"),
        true,
        'js/admin-shop.js should route product reads through the admin products handler'
    );
    assert.equal(
        shopSource.includes("buildAdminShopUrl('shop/categories'"),
        true,
        'js/admin-shop.js should route category reads through the admin categories handler'
    );
    assert.equal(
        shopSource.includes("buildAdminShopUrl('shop/orders'"),
        true,
        'js/admin-shop.js should route order reads through the admin orders handler'
    );
    assert.equal(
        shopSource.includes(".from('shop_orders')"),
        false,
        'js/admin-shop.js should not retain direct shop_orders reads'
    );
    assert.equal(
        shopSource.includes(".from('profiles')"),
        false,
        'js/admin-shop.js should not retain direct profiles reads for shop workflows'
    );
    assert.equal(
        shopSource.includes(".from('shop_inventory')"),
        false,
        'js/admin-shop.js should not retain direct shop_inventory reads for inventory details'
    );
    assert.equal(
        shopSource.includes(".from('shop_products')"),
        false,
        'js/admin-shop.js should not retain direct shop_products access'
    );
    assert.equal(
        shopSource.includes(".from('shop_categories')"),
        false,
        'js/admin-shop.js should not retain direct shop_categories access'
    );

    const styleMarkers = [
        '.shop-inventory-empty-cell',
        '.shop-inventory-loading-cell',
        '.shop-inventory-content-chip',
        '.shop-inventory-status-badge',
        '.shop-inventory-fault-overlay',
        '.shop-inventory-fault-overlay.is-visible',
        '.shop-inventory-detail-overlay',
        '.shop-inventory-detail-overlay.is-visible',
        '.shop-inventory-detail-inline-btn',
        '.shop-inventory-detail-entry',
        '.shop-inventory-copy-feedback',
        '.shop-inventory-selection-mode .shop-inventory-selection-toggle-cell'
    ];

    for (const marker of styleMarkers) {
        assert.equal(shopStyles.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }
});

test('shop admin import and editor helpers externalize runtime layout styling', () => {
    const shopSource = readRepoFile('js/admin-shop.js');
    const shopStyles = readRepoFile('css/admin-studio-page.css');
    const adminStudioSource = readRepoFile('admin-studio.html');

    const removedRuntimeMarkers = [
        'style="display: flex; align-items: center; gap: 15px;"',
        `style="font-family:'Outfit',sans-serif;font-weight:300;font-size:20px;"`,
        "modal.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.55);",
        'style="background: rgba(18, 22, 36, 0.95); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 30px;',
        "row.style.cssText = 'display: flex; gap: 8px; align-items: center; background: rgba(0,0,0,0.2);",
        'style="padding:20px; text-align:center; color:rgba(255,255,255,0.3);"',
        'style="padding: 20px; text-align: center; color: rgba(255,255,255,0.4); font-size: 13px;"',
        "batchMenu.style.display = 'none'",
        "menu.style.display = menu.style.display === 'none' ? 'block' : 'none'",
        "document.querySelectorAll('.inventory-subtab-content').forEach(el => el.style.display = 'none')"
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(shopSource.includes(marker), false, `js/admin-shop.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        'pagination-shell',
        'shop-delivery-switch-modal',
        'shop-tiered-pricing-row',
        'shop-import-tree-state',
        'shop-import-product-empty',
        'shop-import-target-product--visible',
        'shop-inventory-selection-mode',
        "batchMenu.classList.remove('is-open')",
        "menu.classList.toggle('is-open')",
        "document.querySelectorAll('.inventory-subtab-content').forEach(el => el.classList.add('admin-studio-inline-style-attr-3'))"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.pagination-shell',
        '.pagination-btn--step',
        '.pagination-total--compact',
        '.shop-delivery-switch-modal',
        '.shop-tiered-pricing-row',
        '.shop-import-tree-state',
        '.shop-import-product-empty',
        '.shop-import-target-product--visible',
        '.shop-inventory-selection-mode #batchActionsBtn'
    ];

    for (const marker of styleMarkers) {
        assert.equal(shopStyles.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }

    assert.match(
        adminStudioSource,
        /css\/admin-studio-page\.css\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should load the latest import/runtime stylesheet version'
    );
    assert.match(
        adminStudioSource,
        /js\/admin-shop\.js\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should load the latest shop admin runtime script version'
    );
});

test('shop admin final runtime style remnants are fully externalized from scripts', () => {
    const shopSource = readRepoFile('js/admin-shop.js');
    const shopStyles = readRepoFile('css/admin-studio-page.css');

    const removedRuntimeMarkers = [
        "hint.style.display = 'block'",
        "helper.style.position = 'fixed'",
        "helper.style.opacity = '0'",
        "helper.style.pointerEvents = 'none'",
        "iconBox.style.opacity = '0.7'",
        "wrapper.style.maxHeight =",
        "wrapper.style.opacity =",
        "wrapper.style.marginTop =",
        'style="width:100%; height:100%; object-fit:cover; border-radius:12px;"',
        '<div class="shop-delivery-hotspot-bar"><span style="width:${width}%"></span></div>',
        'style="grid-template-columns:repeat(${Math.max(buckets.length, 1)}, minmax(0, 1fr));"',
        'style="height:${totalHeight}%"',
        'style="color: ${folderColor};"',
        "menu.style.left = left + 'px'",
        "menu.style.top = top + 'px'"
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(shopSource.includes(marker), false, `js/admin-shop.js should not retain ${marker}`);
    }

    const inlineAttrCount = (shopSource.match(/style=\"/g) || []).length;
    const cssTextCount = (shopSource.match(/\.style\.cssText/g) || []).length;
    const styleWriteCount = (shopSource.match(/\.style\.[A-Za-z_$][\w$]*/g) || []).filter((token) => token !== '.style.cssText').length;

    assert.equal(inlineAttrCount, 0, 'js/admin-shop.js should not emit inline style attributes');
    assert.equal(cssTextCount, 0, 'js/admin-shop.js should not use style.cssText');
    assert.equal(styleWriteCount, 0, 'js/admin-shop.js should not write runtime style properties directly');

    const runtimeMarkers = [
        'shop-product-site-hint--visible',
        'shop-form-section--expanded',
        'shop-admin-clipboard-helper',
        'shop-admin-preview-icon-image',
        'upload-box--busy',
        'shop-delivery-hotspot-progress',
        'renderDeliveryTrendBarSvg: function',
        'shop-delivery-trend-bar-svg',
        'shop-delivery-trend-bar-dead-fill',
        'closeCategoryContextMenu: function ()',
        'tree-folder-icon ${this.buildCategoryColorClass(folderColor)}',
        "anchor.appendChild(menu)"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.shop-product-site-hint--visible',
        '.shop-form-section--expanded',
        '.shop-admin-clipboard-helper',
        '.shop-admin-preview-icon-image',
        '.upload-box--busy',
        '.shop-delivery-hotspot-progress',
        '.shop-delivery-trend-bar-svg',
        '.shop-delivery-trend-bar-dead-fill',
        '.tree-context-menu--anchor-left',
        '.tree-folder-icon.category-color--blue'
    ];

    for (const marker of styleMarkers) {
        assert.equal(shopStyles.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }
});

test('shop admin delivery dashboards externalize tone and table-row styling', () => {
    const shopSource = readRepoFile('js/admin-shop.js');
    const shopStyles = readRepoFile('css/admin-studio-page.css');

    const removedRuntimeMarkers = [
        'class="status-badge" style="display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:600;color:${colors.text};background:${colors.bg};border:1px solid ${colors.border};white-space:nowrap;"',
        'class="shop-delivery-meta-badge" style="color:${colors.text};background:${colors.bg};border-color:${colors.border};"',
        'class="shop-delivery-meta-chip shop-delivery-meta-chip--action${activeClass}"${titleAttr}${delegatedAttrs} style="color:${textColor};background:${background};border-color:${borderColor};"',
        'class="shop-delivery-trend-legend-item${activeClass}"',
        '<span style="color:rgba(226,232,240,0.45);">—</span>',
        `.join('<span style="color:rgba(226,232,240,0.55);">→</span>')`,
        'class="shop-delivery-meta" style="margin-bottom:8px;"',
        'style="white-space:normal;line-height:1.55;"'
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(shopSource.includes(marker), false, `js/admin-shop.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        'shop-delivery-badge',
        'shop-delivery-tone--',
        'shop-delivery-meta--stacked',
        'shop-delivery-value',
        'shop-delivery-table-cell--relaxed',
        'shop-delivery-table-note--spaced',
        'shop-delivery-transition-separator',
        'shop-delivery-trend-legend-dot'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.shop-delivery-badge',
        '.shop-delivery-tone--success',
        '.shop-delivery-meta--stacked',
        '.shop-delivery-value',
        '.shop-delivery-table-cell--relaxed',
        '.shop-delivery-table-note--spaced',
        '.shop-delivery-transition-separator',
        '.shop-delivery-trend-legend-dot'
    ];

    for (const marker of styleMarkers) {
        assert.equal(shopStyles.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }
});

test('admin studio create form and shop import/orders/fulfillment controls route through delegated actions', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const shopSource = readRepoFile('js/admin-shop.js');

    const removedInlineMarkers = [
        'onclick="resetForm()"',
        `onclick="toggleMobileImportView('sidebar')"`,
        `onclick="toggleMobileImportView('main')"`,
        `onclick="ShopAdmin.showCreateCategoryDialog()"`,
        `onclick="ShopAdmin.renameCategoryFromMenu()"`,
        `onclick="ShopAdmin.setCategoryColor('#6b9ece')"`,
        `onclick="ShopAdmin.deleteCategoryFromMenu()"`,
        `oninput="document.getElementById('importViewLineCount').textContent = '(' + (this.value.trim() ? this.value.trim().split('\\n').length : 0) + '个)'"`,
        `onclick="ShopAdmin.doImportFromView()"`,
        `onclick="ShopAdmin.toggleDropdown('productDropdown')"`,
        `onclick="ShopAdmin.selectDropdown('status', 'available', '在售')"`,
        `onkeypress="if(event.key==='Enter') ShopAdmin.searchOrders()"`,
        `onclick="ShopAdmin.searchOrders()"`,
        `onclick="ShopAdmin.exportOrders()"`,
        `onchange="ShopAdmin.setDeliveryTaskStatusFilter(this.value)"`,
        `onkeydown="ShopAdmin.handleDeliveryTaskQueryKeydown(event)"`,
        `onclick="ShopAdmin.applyDeliveryTaskQuery()"`,
        `onclick="ShopAdmin.loadDeliveryTasks(1)"`,
        `onclick="ShopAdmin.saveDeliveryStrategy()"`,
        `onchange="ShopAdmin.setDeliveryAnalyticsWindow(this.value)"`,
        `onchange="ShopAdmin.setDeliveryDeadLetterReasonFilter(this.value)"`,
        `onchange="ShopAdmin.setDeliveryLockStateFilter(this.value)"`,
        `onchange="ShopAdmin.applyDeliveryConflictAuditFilters()"`,
        `onclick="ShopAdmin.clearDeliveryConflictAuditFilters()"`,
        `onkeydown="ShopAdmin.handleDeliveryConflictAuditFilterKeydown(event)"`
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(
            adminStudioSource.includes(marker) || shopSource.includes(marker),
            false,
            `create/import/orders/fulfillment controls should not contain ${marker}`
        );
    }

    const delegatedHtmlMarkers = [
        'data-admin-action="gallery-reset-form"',
        'data-shop-action="import-toggle-mobile-view"',
        'data-shop-action="import-create-category"',
        'data-shop-action="import-category-rename"',
        'data-shop-action="import-category-color"',
        'data-shop-action="import-category-delete"',
        'data-shop-input="import-view-line-count"',
        'data-shop-action="inventory-import-from-view"',
        'data-shop-keydown="orders-search-enter"',
        'data-shop-action="orders-search"',
        'data-shop-action="orders-export"',
        'data-shop-change="delivery-task-status-filter"',
        'data-shop-keydown="delivery-task-query-enter"',
        'data-shop-action="delivery-apply-task-query"',
        'data-shop-action="delivery-reload-tasks"',
        'data-shop-action="delivery-save-strategy"',
        'data-shop-change="delivery-analytics-window"',
        'data-shop-change="delivery-dead-letter-reason"',
        'data-shop-change="delivery-lock-state"',
        'data-shop-change="delivery-conflict-audit-reason"',
        'data-shop-keydown="delivery-conflict-audit-filter-enter"',
        'data-shop-action="delivery-apply-conflict-audit-filters"',
        'data-shop-action="delivery-clear-conflict-audit-filters"'
    ];

    for (const marker of delegatedHtmlMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const delegatedHandlerMarkers = [
        "case 'gallery-reset-form':",
        "case 'import-toggle-mobile-view':",
        "case 'import-create-category':",
        "case 'import-category-rename':",
        "case 'import-category-color':",
        "case 'import-category-delete':",
        "case 'inventory-import-from-view':",
        "case 'orders-search':",
        "case 'orders-export':",
        "case 'delivery-apply-task-query':",
        "case 'delivery-reload-tasks':",
        "case 'delivery-save-strategy':",
        "case 'delivery-task-status-filter':",
        "case 'delivery-analytics-window':",
        "case 'delivery-dead-letter-reason':",
        "case 'delivery-lock-state':",
        "case 'delivery-conflict-audit-reason':",
        "case 'orders-search-enter':",
        "case 'delivery-task-query-enter':",
        "case 'delivery-conflict-audit-filter-enter':",
        "case 'import-view-line-count':"
    ];

    assert.equal(adminStudioScript.includes("case 'gallery-reset-form':"), true, 'admin-studio.js should delegate the reset form button');

    for (const marker of delegatedHandlerMarkers.slice(1)) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    const helperMarkers = [
        'toggleMobileImportView: function (view)',
        'updateImportViewLineCount: function ()'
    ];

    for (const marker of helperMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }
});

test('analytics export controls and delivery runtime templates route through delegated actions', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const analyticsSource = readRepoFile('admin-analytics.js');
    const shopSource = readRepoFile('js/admin-shop.js');

    const removedInlineMarkers = [
        `onclick="exportAnalyticsData('excel')"`,
        `onclick="exportAnalyticsData('csv')"`,
        `onclick="refreshAllAnalytics()"`,
        `onclick="ShopAdmin.jumpToDeliveryConflictAuditForTask('`,
        `onclick="ShopAdmin.copyDeliveryRestoreLink()"`,
        `onclick="ShopAdmin.clearAllDeliveryFilterBreadcrumbs()"`,
        `onclick="ShopAdmin.performDeliveryTaskAction('`,
        `onclick="ShopAdmin.toggleDeliveryConflictAuditSelection('`,
        `onclick="ShopAdmin.applyDeliveryHotspotFilter('`,
        `onclick="ShopAdmin.toggleDeliveryConflictBucketFilter('`,
        `onclick="ShopAdmin.toggleDeliveryConflictDeadLetterBucketFocus('`,
        'const onclickAttr = onClick ?',
        'const onClickAttr = onRemove ?'
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(
            adminStudioSource.includes(marker) || shopSource.includes(marker),
            false,
            `analytics/delivery templates should not contain ${marker}`
        );
    }

    const delegatedHtmlMarkers = [
        'data-admin-action="analytics-open-destination"',
        'data-admin-action="analytics-export-data"',
        'data-admin-action="analytics-refresh-data"'
    ];

    for (const marker of delegatedHtmlMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(
        analyticsSource.includes('data-analytics-context="'),
        true,
        'admin-analytics.js should emit analytics action context attributes for routed cards'
    );

    const delegatedShopActionMarkers = [
        'delivery-copy-restore-link',
        'delivery-clear-all-filter-breadcrumbs',
        'delivery-task-action',
        'delivery-jump-audit',
        'delivery-conflict-audit-select',
        'delivery-conflict-audit-reason-quick-filter',
        'delivery-conflict-audit-target-quick-filter',
        'delivery-conflict-audit-channel-quick-filter',
        'delivery-toggle-conflict-dead-letter-focus',
        'delivery-hotspot-filter',
        'delivery-hotspot-metric-drilldown',
        'delivery-hotspot-reason-drilldown',
        'delivery-conflict-bucket-toggle',
        'delivery-conflict-bucket-dead-letter-focus'
    ];

    for (const marker of delegatedShopActionMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    const delegatedHandlerMarkers = [
        "case 'analytics-open-destination':",
        "case 'analytics-export-data':",
        "case 'analytics-refresh-data':",
        "case 'delivery-copy-restore-link':",
        "case 'delivery-clear-all-filter-breadcrumbs':",
        "case 'delivery-task-action':",
        "case 'delivery-jump-audit':",
        "case 'delivery-conflict-audit-select':",
        "case 'delivery-conflict-audit-reason-quick-filter':",
        "case 'delivery-conflict-audit-target-quick-filter':",
        "case 'delivery-conflict-audit-channel-quick-filter':",
        "case 'delivery-toggle-conflict-dead-letter-focus':",
        "case 'delivery-hotspot-filter':",
        "case 'delivery-hotspot-metric-drilldown':",
        "case 'delivery-hotspot-reason-drilldown':",
        "case 'delivery-conflict-bucket-toggle':",
        "case 'delivery-conflict-bucket-dead-letter-focus':",
        "case 'delivery-clear-task-query':",
        "case 'delivery-clear-conflict-bucket':",
        "case 'delivery-clear-conflict-audit-selection':",
        "case 'delivery-clear-conflict-dead-letter-focus':",
        "case 'delivery-clear-task-status-filter':",
        "case 'delivery-clear-dead-letter-reason-filter':",
        "case 'delivery-clear-lock-state-filter':",
        "case 'delivery-clear-conflict-audit-reason-filter':",
        "case 'delivery-clear-conflict-audit-target-filter':",
        "case 'delivery-clear-conflict-audit-channel-filter':"
    ];

    for (const marker of delegatedHandlerMarkers.slice(0, 3)) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    assert.equal(
        adminStudioScript.includes("actionEl.dataset.analyticsContext || ''"),
        true,
        'admin-studio.js should forward analytics action context payloads to the destination router'
    );

    for (const marker of delegatedHandlerMarkers.slice(3)) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    assert.equal(shopSource.includes('buildDeliveryDataAttributes: function (attributes = {})'), true, 'js/admin-shop.js should build delivery data attributes for delegated runtime templates');
});

test('analytics calendar and config poster/editor templates route through delegated actions', () => {
    const adminStudioScript = readRepoFile('admin-studio.js');
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminConfigSource = readRepoFile('admin-config.js');

    const removedInlineMarkers = [
        `onclick="viewPromptContext('`,
        `onclick="selectInlineDate(`,
        `onclick="selectRangeDate(`,
        `onclick="changeMonth('start', -1); event.stopPropagation();"`,
        `onclick="resetDateRange(); event.stopPropagation();"`,
        `onclick="applyAndClose(); event.stopPropagation();"`,
        `onclick="deleteChannel(`,
        `onclick="window.selectAffiliatePosterTemplate('`,
        `onchange="window.handleAffiliatePosterUpload('`,
        `onclick="window.resetAffiliatePosterBackground('`,
        `onclick="AdminRichTextEditor.selectColor('`,
        `onclick="AdminRichTextEditor.selectFontSize('`,
        `onclick="AdminRichTextEditor.selectEmoji('`,
        `onclick="AdminRichTextEditor.insertFormat('`,
        `onclick="AdminRichTextEditor.toggleAlignPicker('`,
        `onclick="AdminRichTextEditor.applyTextAlign('`,
        `onclick="AdminRichTextEditor.insertLink('`,
        `onclick="AdminRichTextEditor.toggleEmojiPicker('`,
        `onclick="AdminRichTextEditor.toggleDropdown('`
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(
            analyticsSource.includes(marker) || adminConfigSource.includes(marker),
            false,
            `analytics/config templates should not contain ${marker}`
        );
    }

    const analyticsMarkers = [
        'data-admin-action="analytics-view-context"',
        'data-admin-action="analytics-inline-select-date"'
    ];

    for (const marker of analyticsMarkers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics runtime should contain ${marker}`);
    }

    const configMarkers = [
        'data-admin-action="settings-delete-channel"',
        'data-admin-action="settings-select-affiliate-poster-template"',
        'data-admin-change-action="settings-affiliate-poster-upload"',
        'data-admin-action="settings-reset-affiliate-poster-background"',
        'data-admin-action="settings-rich-text-format"',
        'data-admin-action="settings-rich-text-toggle-align-picker"',
        'data-admin-action="settings-rich-text-apply-align"',
        'data-admin-action="settings-rich-text-insert-link"',
        'data-admin-action="settings-rich-text-toggle-emoji-picker"',
        'data-admin-action="settings-rich-text-select-emoji"',
        'data-admin-action="settings-rich-text-toggle-dropdown"',
        'data-admin-action="settings-rich-text-select-color"',
        'data-admin-action="settings-rich-text-select-font-size"'
    ];

    for (const marker of configMarkers) {
        assert.equal(adminConfigSource.includes(marker), true, `admin-config.js should contain ${marker}`);
    }

    const adminScriptMarkers = [
        "case 'settings-delete-channel':",
        "case 'settings-select-affiliate-poster-template':",
        "case 'settings-reset-affiliate-poster-background':",
        "case 'settings-rich-text-format':",
        "case 'settings-rich-text-toggle-align-picker':",
        "case 'settings-rich-text-apply-align':",
        "case 'settings-rich-text-insert-link':",
        "case 'settings-rich-text-toggle-emoji-picker':",
        "case 'settings-rich-text-select-emoji':",
        "case 'settings-rich-text-toggle-dropdown':",
        "case 'settings-rich-text-select-color':",
        "case 'settings-rich-text-select-font-size':",
        "case 'analytics-view-context':",
        "case 'analytics-inline-select-date':",
        "case 'settings-affiliate-poster-upload':"
    ];

    for (const marker of adminScriptMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const removedLegacyRangeMarkers = [
        'data-admin-action="analytics-range-select-date"',
        'data-admin-action="analytics-range-change-month"',
        'data-admin-action="analytics-range-reset"',
        'data-admin-action="analytics-range-apply"',
        "case 'analytics-range-select-date':",
        "case 'analytics-range-change-month':",
        "case 'analytics-range-reset':",
        "case 'analytics-range-apply':"
    ];

    for (const marker of removedLegacyRangeMarkers) {
        assert.equal(
            analyticsSource.includes(marker) || adminStudioScript.includes(marker),
            false,
            `legacy analytics range-picker routing should no longer contain ${marker}`
        );
    }
});

test('analytics runtime renderers externalize heatmap, cohort, flow, and panel visibility styles', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminStudioStyles = readRepoFile('admin-studio.css');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const removedMarkers = [
        "indicator.style.left = activeTab.offsetLeft + 'px';",
        '<div class="heatmap-cell" style="background: ${cellColor}"',
        'class="cohort-cell" style="--intensity:',
        'fa-arrow-right" style="color:#22c55e"',
        'fa-arrow-left" style="color:#ef4444"',
        "chartContainer.style.display = 'block';",
        "chartContainer.style.display = 'none';",
        "area.style.display = 'none';",
        "area.style.display = 'block';"
    ];

    for (const marker of removedMarkers) {
        assert.equal(analyticsSource.includes(marker), false, `admin-analytics.js should not contain ${marker}`);
    }

    const analyticsMarkers = [
        'window.updateAdminTabIndicator(activeTab);',
        'function getHeatmapToneClass(count, intensity)',
        'heatmap-cell--level-${getAnalyticsToneLevel',
        'function getCohortToneClass(percent)',
        'cohort-cell--level-${getAnalyticsToneLevel',
        'flow-section-icon flow-section-icon--inflow',
        'flow-section-icon flow-section-icon--outflow',
        'function setAnalyticsVisibility(element, hidden) {',
        'setAnalyticsVisibility(area, true);',
        'setAnalyticsVisibility(area, false);',
        'function collectAnalyticsActionRecommendations(data = null)',
        'function getAnalyticsAISourceData(data = null)',
        'function buildOperationsHealthSnapshotFromPayloads({',
        'function getAnalyticsProductBundleSegmentPayload(bundle = null, key = \'\') {',
        'function buildAnalyticsProductOverviewInsight(data = null) {',
        'function buildAnalyticsContentUserValueOverviewInsight(data = null) {',
        'function buildAnalyticsUserValueOverviewInsight(data = null) {',
        'function buildAnalyticsOpsOverviewInsight(data = null) {',
        'const overviewState = buildAnalyticsUserValueOverviewState({',
        'function buildAnalyticsBusinessCenterCloseoutState(cards = []) {',
        'function renderAnalyticsBusinessCenterCloseoutCard(state = null) {',
        'function buildAnalyticsBusinessAnomalyCardsData(data = null, limit = 4)',
        'function buildAnalyticsAIPulseSummaryData(data = null)',
        'function buildAnalyticsAIActionCardsData(data = null, limit = 6)',
        'function buildAnalyticsEventDrivenRecommendations(data = null) {',
        'function buildAnalyticsOpsDestinationContext(entityType = \'\', entityName = \'\', extra = {}) {',
        'function getAnalyticsResolutionFeedbackEntriesForOps(options = {}) {',
        'function buildAnalyticsOpsFeedbackEntityRows(entries = [], entityStates = {}) {',
        'function buildAnalyticsOpsFeedbackReviewRows(entries = [], entityStates = {}) {',
        'function buildAnalyticsOpsFeedbackVerificationStatus(row = {}) {',
        'function buildAnalyticsOpsFeedbackEvidence(row = {}, verificationState = null) {',
        'function buildAnalyticsOpsFeedbackTimeline(row = {}, verificationState = null) {',
        'function buildAnalyticsOpsConclusionRecords(entries = [], entityStates = {}, options = {}) {',
        'function renderAnalyticsOpsConclusionRecords(entries = [], entityStates = {}, options = {}) {',
        'function buildAnalyticsOpsFeedbackOverviewState(entries = [], entityStates = {}) {',
        'function buildAnalyticsOpsEntityFeedbackDigest(entries = [], entityType = \'\', state = {}) {',
        'function renderAnalyticsOpsFeedbackSummary(feedback = {}) {',
        'function renderAnalyticsOpsEntityFeedbackDigest(digest = null) {',
        'function isAnalyticsOpsTabActive() {',
        'void loadOperationsCockpit();',
        "label: '商品经营'",
        "label: '内容→用户'",
        "label: '用户价值'",
        "value: stateLabel,",
        '商品退款风险仍未完全收口',
        '内容已带来成交，但用户价值层已有退款风险',
        '内容带货已经开始沉淀用户价值',
        '内容已带来成交，但用户价值仍停在首单层',
        '内容已带来商品意图，尚未继续转成用户价值',
        '内容已带来详情触达，用户价值仍停在前段',
        '用户价值层已有退款风险仍待收口',
        '用户已经形成首单成交，但复购层仍偏薄',
        '商品影响用户层已起量，用户价值层仍停在前段',
        '用户价值层已开始形成复购承接',
        '商品履约风险仍在影响经营承接',
        '高曝光低转化商品需要继续复查',
        '商品链路已经起量，但成交尚未形成',
        '运营保障当前仍有关键问题未收口',
        '运营保障当前仍需要继续复查',
        '当前仍有异常需要优先处理',
        '当前重点在线索复查',
        '已收口',
        '放量中',
        '仍异常',
        '待复查',
        'async function getAnalyticsSiteComparisonData(options = {}) {',
        'function buildAnalyticsTopCategorySnapshot(rows = []) {',
        'function buildAnalyticsSiteSnapshot(site = \'\', summaryWindow = {}) {',
        'function buildAnalyticsSiteComparisonPayload(snapshots = []) {',
        'function renderAnalyticsAISiteComparison(comparisonData = null) {',
        'function applyAnalyticsDestinationSiteContext(context = {}) {',
        'window.renderVerifyMonitorWorkbenchContext?.(normalizedContext);',
        'window.AdminPayments?.showWorkbenchContext?.(normalizedContext);',
        'window.AdminTickets?.showWorkbenchContext?.(normalizedContext);',
        'function getAnalyticsPercentRate(numerator, denominator, digits = 2) {',
        'function buildCommerceEventFunnelViewData(summaryWindow = {}) {',
        'function buildVerifyEventFunnelViewData(summaryWindow = {}) {',
        'function buildGrowthEventFunnelViewData(summaryWindow = {}) {',
        'async function loadOverviewOperatingNavigator() {',
        'const shellHasRenderedWorkspace = Boolean(',
        'const focusHasRenderedWorkspace = Boolean(',
        'function buildAnalyticsOverviewNavigatorCards(source = {}) {',
        'function buildAnalyticsOverviewNavigatorMeta(cards = []) {',
        'function buildAnalyticsBusinessCenterShellState(cards = null) {',
        'function buildAnalyticsBusinessCenterCloseoutState(cards = []) {',
        'function renderAnalyticsBusinessCenterCloseoutCard(state = null) {',
        'function renderAnalyticsBusinessCenterShell(cards = null) {',
        'function renderAnalyticsSectionNavigator(cards = []) {',
        'function buildAnalyticsSectionNavigatorCards(source = {}) {',
        'function buildAnalyticsOperatingHubItems(cards = []) {',
        'function renderAnalyticsOperatingHub(items = []) {',
        'function buildAnalyticsSectionNavigatorEntryItems(card = null) {',
        'function getAnalyticsRouteState() {',
        'function syncAnalyticsRouteState(nextState = {}, options = {}) {',
        'window.getAnalyticsRouteState = getAnalyticsRouteState;',
        'window.syncAnalyticsRouteState = syncAnalyticsRouteState;',
        'window.restoreAnalyticsRouteState = restoreAnalyticsRouteState;',
        'window.renderAnalyticsBusinessCenterShell = renderAnalyticsBusinessCenterShell;',
        'function refreshAnalyticsOperatingFocusSectionActiveState() {',
        'function scheduleAnalyticsOperatingFocusSectionRefresh() {',
        'function renderAnalyticsOperatingFocusWorkspace(cards = null) {',
        'window.refreshAnalyticsSectionNavigatorActiveState = refreshAnalyticsSectionNavigatorActiveState;',
        'window.refreshAnalyticsOperatingFocusSectionActiveState = refreshAnalyticsOperatingFocusSectionActiveState;',
        'window.scheduleAnalyticsOperatingFocusSectionRefresh = scheduleAnalyticsOperatingFocusSectionRefresh;',
        'window.renderAnalyticsBusinessCenterShell?.();',
        'window.renderAnalyticsOperatingFocusWorkspace = renderAnalyticsOperatingFocusWorkspace;',
        'window.refreshAnalyticsSectionNavigatorActiveState?.();',
        'window.scheduleAnalyticsOperatingFocusSectionRefresh?.();',
        'window.renderAnalyticsOperatingFocusWorkspace?.();',
        '经营分析中心',
        '当前状态',
        '经营分层导航',
        '当前经营视角',
        '视角内分区',
        '当前经营入口',
        '继续关注',
        '最近查看',
        '主入口',
        '当前分区',
        '下一分区',
        '用户增长',
        '提示词内容',
        '运营承接',
        '运营保障',
        "const rawSite = hasOptionSite ? options.site : getAnalyticsSiteParam();",
        "const site = String(rawSite || '').trim().toLowerCase() === 'all'",
        'async function loadEventFunnelPanels() {',
        'function getAnalyticsActionGroupMeta(level = \'\')',
        'function renderAnalyticsBusinessAnomalyCards(items = [])',
        'function renderAnalyticsAIPulseSummary(items = [])',
        'function renderAnalyticsAIActionCards(actionData = {})',
        'function renderAIInsightMarkup(reportText, options = {})',
        'function serializeAnalyticsActionContext(context = null)',
        'function parseAnalyticsActionContext(context = null)',
        'function focusAnalyticsDestinationTarget(targetOrId, options = {})',
        'function scheduleAnalyticsWorkbenchOpen(workspaceKey = \'\', context = {}, delay = 120)',
        'async function openAnalyticsPaymentsContext(mode = \'overview\', context = {})',
        'async function openAnalyticsTicketsContext(mode = \'pending\', context = {})',
        'async function getOperationsHealthSnapshotData(options = {})',
        'function formatAnalyticsVerificationSample(row = {})',
        'function formatAnalyticsPaymentAlertSample(item = {})',
        'function formatAnalyticsTicketFocusSample(item = {})',
        'function formatAnalyticsGuestbookMessageSample(row = {})',
        'syncRoute: false',
        '经营主线摘要：',
        '交易事件转化：',
        '验证事件转化：',
        '增长动作：',
        '站点对比：',
        '运营健康快照：',
        '=== 验证事件转化 ===',
        '=== 增长动作 ===',
        '=== 交易事件转化 ===',
        '=== 经营异常 ===',
        '=== 建议动作 ===',
        "const rpcSite = String(rawSite || '').trim().toLowerCase() === 'all'",
        "await getAnalyticsSupabaseClient().rpc('get_points_health', { p_site: rpcSite })"
    ];

    for (const marker of analyticsMarkers) {
        assert.equal(analyticsSource.includes(marker), true, `admin-analytics.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.heatmap-cell--level-4',
        '[data-theme="dark"] .heatmap-cell--level-4',
        '.cohort-cell--level-4',
        '.flow-section-icon--inflow',
        '.flow-section-icon--outflow',
        '.ai-pulse-grid',
        '.analytics-dashboard {',
        'overflow-anchor: none;',
        '.analytics-business-center-shell__body {',
        '.analytics-operating-focus__body {',
        '.ai-pulse-card__value',
        '.ai-site-board',
        '.ai-site-grid',
        '.ai-site-card--focus',
        '.ai-site-board__insight-pill',
        '.ai-anomaly-grid',
        '.ai-anomaly-card--danger',
        '.ai-anomaly-card__metric',
        '.ai-anomaly-card__sample-pill',
        '.ai-anomaly-card__cta',
        '.ai-action-group--urgent',
        '.ai-action-card-grid',
        '.ai-action-card__sample-pill',
        '.ai-action-card__cta',
        '.analytics-nav-focus-target--active',
        '.admin-workbench-context-note',
        '.admin-workbench-context-note__chips',
        '.analytics-section-navigator {',
        '.analytics-section-navigator__grid {',
        '.analytics-section-navigator-card--active {',
        '.analytics-section-navigator-card__entry {',
        '.analytics-section-navigator-card__entry-badge {',
        '.analytics-section-navigator-card__entry-chip {',
        '.analytics-section-navigator-card__actions {',
        '.analytics-operating-hub {',
        '.analytics-operating-hub__grid {',
        '.analytics-operating-hub__item--active {',
        '.analytics-operating-hub__primary {',
        '.analytics-operating-focus {',
        '.analytics-operating-focus__sections {',
        '.analytics-operating-focus__section-summary {',
        '.analytics-operating-focus__section--wide {',
        '.analytics-operating-focus__action-grid--sections {',
        '.analytics-operating-focus__action-card {',
        '.analytics-operating-focus__action-card--active {',
        '.analytics-overview-navigator__grid',
        '.analytics-overview-navigator-card__actions',
        '#overviewOperatingNavigator.chart-body',
        '.analytics-business-center-shell__grid {',
        'grid-template-columns: minmax(0, 1fr);',
        '.analytics-business-center-shell__lead-grid {',
        'grid-template-columns: repeat(2, minmax(0, 1fr));',
        'min-height: 320px;',
        'align-items: start;',
        '.analytics-business-center-shell__card {',
        'overflow: hidden;',
        'isolation: isolate;',
        '.analytics-business-center-shell__card--watch {',
        'grid-column: 1 / -1;',
        'min-height: 430px;',
        'grid-auto-flow: column;',
        'align-items: stretch;',
        'grid-auto-columns: minmax(220px, 1fr);',
        'min-height: 270px;',
        'overflow-x: auto;',
        'padding-bottom: 12px;',
        'scroll-snap-type: x proximity;',
        'min-height: 240px;',
        '.analytics-business-center-shell__watch-action {',
        'margin-top: auto;',
        '.analytics-growth-insight-grid {',
        '.analytics-user-trend-support-grid {',
        'grid-template-columns: minmax(0, 1fr);',
        '.analytics-growth-card--full {',
        '#userGrowthCommerceImpact,',
        '#userValueCockpit {',
        '.analytics-user-commerce-impact__chips {',
        'flex-wrap: nowrap;',
        'scrollbar-width: none;',
        '.analytics-user-commerce-impact__chip {',
        'flex: 0 0 auto;',
        'white-space: nowrap;',
        'overflow-y: visible;',
        '.analytics-user-value-cockpit__stats {',
        'grid-auto-columns: minmax(190px, 1fr);',
        '.analytics-user-value-cockpit__grid {',
        'display: flex;',
        'flex: 1 1 calc((100% - 44px) / 3);',
        'min-width: 280px;',
        '--analytics-content-rail-max: 1040px;',
        'width: min(100%, var(--analytics-content-rail-max));',
        '.analytics-user-value-cockpit__grid + .analytics-product-detail-card--wide {',
        '.analytics-user-value-cockpit .analytics-writeback-priority__list,',
        'max-height: none;',
        '.analytics-business-center-shell__card--closeout {',
        '.analytics-business-center-shell__closeout-list {',
        '.analytics-business-center-shell__closeout-item {',
        '.analytics-overview-navigator__grid {',
        'grid-auto-rows: minmax(0, 1fr);',
        '.analytics-overview-navigator-card {',
        'min-height: 232px;',
        '.analytics-ops-cockpit {',
        '.analytics-ops-cockpit__overview-top,',
        '.analytics-ops-cockpit__stats {',
        '.analytics-ops-cockpit__actions {',
        '.analytics-ops-cockpit__feedback-digest {',
        '.analytics-ops-cockpit__feedback-status {',
        '#opsCockpitOverview.chart-body',
        '#analyticsTabsNav.analytics-center-tabs {',
        'justify-content: center;',
        '#analyticsTabsNav .analytics-tab-group__label {',
        'display: none;',
        '#analyticsWorkspaceRoot,',
        '#analyticsWorkspaceHostGrowthCenter,',
        'width: 100%;',
        '.analytics-product-chart-pane {',
        'height: 240px;',
        'max-height: 240px;',
        '.analytics-product-chart-pane--compact {',
        'height: 210px;',
        '.analytics-product-panel--trend .analytics-product-chart-pane {',
        'height: 260px;',
        '#analyticsTabsNav .analytics-tab-group__label::after,',
        '#analyticsTabsNav .analytics-tab-group__label.active::after,'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStudioStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    const htmlMarkers = [
        '<div class="anomaly-alerts-area" id="anomalyAlertsArea" hidden>',
        'js/admin-analytics-metric-context.js?v=20260405_ANALYTICS_METRIC_CONTEXT_HELPERS_6',
        'admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8',
        'js/admin-analytics-derived-bundles.js?v=20260405_ANALYTICS_DERIVED_BUNDLES_5',
        'js/admin-analytics-runtime-controls.js?v=20260405_ANALYTICS_RUNTIME_CONTROLS_1',
        'js/admin-analytics-panel-loaders.js?v=20260407_ANALYTICS_PANEL_LOADERS_70',
        'js/admin-analytics-lifecycle.js?v=20260407_ANALYTICS_LIFECYCLE_16',
        'js/admin-analytics-workbench.js?v=20260407_ANALYTICS_WORKBENCH_BUNDLE_13',
        'js/admin-analytics-insight-cards.js?v=20260407_ANALYTICS_INSIGHT_CARDS_HELPERS_5',
        'js/admin-analytics-ai-state.js?v=20260405_ANALYTICS_AI_STATE_1',
        'js/admin-analytics-ai-dom.js?v=20260405_ANALYTICS_AI_DOM_1',
        'js/admin-analytics-ai-helpers.js?v=20260405_ANALYTICS_AI_HELPERS_1',
        'js/admin-analytics-ai-prompt-builders.js?v=20260405_ANALYTICS_AI_PROMPT_BUILDERS_1',
        'js/admin-analytics-ai-controller.js?v=20260405_ANALYTICS_AI_CONTROLLER_1',
        'js/admin-analytics-export-builders.js?v=20260405_ANALYTICS_EXPORT_BUILDERS_1',
        'js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9',
        'js/admin-studio-bootstrap.js?v=20260407_ANALYTICS_CENTER_BOOTSTRAP_8',
        'admin-studio.css?v=20260407_ANALYTICS_CENTER_SHELL_83',
        'class="charts-grid analytics-growth-insight-grid"',
        'class="chart-card glass-panel analytics-growth-card analytics-growth-card--full"',
        'admin-points.js?v=20260404_ADMIN_POINTS_ANALYTICS_CONTEXT_1',
        'admin-config.js?v=20260405_GENERAL_RUNTIME_REMOVAL_1',
        'js/admin-payments.js?v=20260406_ADMIN_PAYMENTS_WORKBENCH_CONTEXT_11',
        'js/admin-workbench.js?v=20260405_ADMIN_WORKBENCH_SIGNAL_CONTEXT_1',
        'js/admin-tickets.js?v=20260406_ADMIN_TICKETS_WORKBENCH_CONTEXT_11',
        'js/admin-shop.js?v=20260406_ADMIN_SHOP_ANALYTICS_CONTEXT_12',
        'data-tab="product"',
        'data-tab="ops"',
        'class="admin-tabs analytics-center-tabs"',
        'class="analytics-tab-group analytics-tab-group--primary"',
        'class="analytics-tab-group analytics-tab-group--support"',
        'data-analytics-tab-group-trigger="primary"',
        'data-analytics-tab-group-trigger="support"',
        'data-module="growth-center"',
        'data-module="commerce-center"',
        'id="module-business-overview"',
        'id="module-growth-center"',
        'id="module-commerce-center"',
        'id="analyticsWorkspaceRoot"',
        'id="analyticsWorkspaceHostBusinessOverview"',
        'id="analyticsWorkspaceHostGrowthCenter"',
        'id="analyticsWorkspaceHostCommerceCenter"',
        '<span>增长经营</span>',
        '<span>商品经营</span>',
        '经营主线',
        '经营支撑',
        '内容带货',
        '交易承接',
        '验证承接',
        '用户增长',
        'id="analytics-tab-product"',
        'id="analytics-tab-ops"',
        'id="productOverview"',
        'id="productRankings"',
        'id="productFunnel"',
        'id="productHealth"',
        'id="productDetailPanel"',
        'id="opsCockpitOverview"',
        'id="opsPaymentsPanel"',
        'id="opsTicketsPanel"',
        'id="opsFulfillmentPanel"',
        'id="opsVerifyPanel"',
        'id="opsAlertsPanel"',
        'id="opsCockpitOverviewMeta"',
        'id="opsPaymentsMeta"',
        'id="opsTicketsMeta"',
        'id="opsFulfillmentMeta"',
        'id="opsVerifyMeta"',
        'id="opsAlertsMeta"',
        'id="productOverviewMeta"',
        'id="productRankingsMeta"',
        'id="productFunnelMeta"',
        'id="productHealthMeta"',
        'id="productDetailMeta"',
        'id="analyticsBusinessCenterShell"',
        'id="analyticsBusinessCenterShellMeta"',
        '经营分析中心',
        'id="analyticsOperatingFocusWorkspace"',
        'id="analyticsOperatingFocusMeta"',
        'id="overviewDutyBoard"',
        'id="overviewOperatingNavigator"',
        'id="channelBreakdownList"',
        'id="overviewDutyBoardMeta"',
        'id="overviewOperatingNavigatorMeta"',
        'id="channelBreakdownMeta"',
        'id="overviewBusinessMixMeta"',
        'id="topContentMeta"',
        'id="contentCommerceDetailSection"',
        'id="contentCommerceDetailPanel"',
        'id="contentCommerceDetailMeta"',
        'id="activityHeatmapMeta"',
        'id="conversionFunnelMeta"',
        'id="retentionCohortMeta"',
        'id="commerceEventFunnelMeta"',
        'id="verifyEventFunnelMeta"',
        'id="growthEventFunnelMeta"',
        'id="verifyMonitorFocusContext"',
        'id="paymentsWorkbenchContext"',
        'id="paymentsIssueSummary"',
        'id="paymentsPrioritySummary"',
        'id="ticketsWorkbenchContext"',
        'id="ticketsIssueSummary"',
        'id="ticketsPrioritySummary"',
        'id="commerceEventFunnel"',
        'id="verifyEventFunnel"',
        'id="growthEventFunnel"',
        'data-analytics-destination="payments-queue"',
        'data-analytics-destination="tickets-pending"'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminStudioHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(adminStudioHtml.includes('id="analyticsOperatingHub"'), false, 'admin-studio.html should no longer render the redundant operating hub section');
    assert.equal(adminStudioHtml.includes('id="analyticsSectionNavigator"'), false, 'admin-studio.html should no longer render the redundant section navigator section');
    assert.equal(adminStudioHtml.includes('商品经营会独立承接站点与时间范围'), true, 'admin-studio.html should render the product engineering explanation note');
    assert.equal(adminStudioHtml.includes('运营保障驾驶舱会把支付、售后、履约、验证和站外告警收成同一层'), true, 'admin-studio.html should render the operations engineering explanation note');
    assert.equal(adminStudioHtml.includes('经营中心入口层'), false, 'admin-studio.html should no longer render the operating hub heading');
    assert.equal(adminStudioHtml.includes('经营分层导航'), false, 'admin-studio.html should no longer render the section navigator heading');

    assert.equal(
        adminStudioHtml.indexOf('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8') < adminStudioHtml.indexOf('js/admin-analytics-derived-bundles.js?v=20260405_ANALYTICS_DERIVED_BUNDLES_5'),
        true,
        'admin-studio.html should load the analytics derived-bundle helper after the main analytics runtime'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-derived-bundles.js?v=20260405_ANALYTICS_DERIVED_BUNDLES_5') < adminStudioHtml.indexOf('js/admin-analytics-runtime-controls.js?v=20260405_ANALYTICS_RUNTIME_CONTROLS_1'),
        true,
        'admin-studio.html should load the analytics runtime-controls helper after the derived bundle helper'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-runtime-controls.js?v=20260405_ANALYTICS_RUNTIME_CONTROLS_1') < adminStudioHtml.indexOf('js/admin-analytics-panel-loaders.js?v=20260407_ANALYTICS_PANEL_LOADERS_70'),
        true,
        'admin-studio.html should load the analytics panel-loader helper after the main analytics runtime'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-panel-loaders.js?v=20260407_ANALYTICS_PANEL_LOADERS_70') < adminStudioHtml.indexOf('js/admin-analytics-lifecycle.js?v=20260407_ANALYTICS_LIFECYCLE_16'),
        true,
        'admin-studio.html should load the analytics lifecycle helper after the panel-loader helper'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-lifecycle.js?v=20260407_ANALYTICS_LIFECYCLE_16') < adminStudioHtml.indexOf('js/admin-analytics-workbench.js?v=20260407_ANALYTICS_WORKBENCH_BUNDLE_13'),
        true,
        'admin-studio.html should load the analytics workbench helper after the lifecycle helper'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-workbench.js?v=20260407_ANALYTICS_WORKBENCH_BUNDLE_13') < adminStudioHtml.indexOf('js/admin-analytics-insight-cards.js?v=20260407_ANALYTICS_INSIGHT_CARDS_HELPERS_5'),
        true,
        'admin-studio.html should load the analytics insight-card helper after the workbench helper'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-insight-cards.js?v=20260407_ANALYTICS_INSIGHT_CARDS_HELPERS_5') < adminStudioHtml.indexOf('js/admin-analytics-ai-helpers.js?v=20260405_ANALYTICS_AI_HELPERS_1'),
        true,
        'admin-studio.html should load the analytics ai-helper layer after the insight-card helper'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-insight-cards.js?v=20260407_ANALYTICS_INSIGHT_CARDS_HELPERS_5') < adminStudioHtml.indexOf('js/admin-analytics-ai-state.js?v=20260405_ANALYTICS_AI_STATE_1'),
        true,
        'admin-studio.html should load the analytics ai-state layer after the insight-card helper'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-state.js?v=20260405_ANALYTICS_AI_STATE_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-dom.js?v=20260405_ANALYTICS_AI_DOM_1'),
        true,
        'admin-studio.html should load the analytics ai-dom layer after the ai-state layer'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-dom.js?v=20260405_ANALYTICS_AI_DOM_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-helpers.js?v=20260405_ANALYTICS_AI_HELPERS_1'),
        true,
        'admin-studio.html should load the analytics ai-helper layer after the ai-dom layer'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-helpers.js?v=20260405_ANALYTICS_AI_HELPERS_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-prompt-builders.js?v=20260405_ANALYTICS_AI_PROMPT_BUILDERS_1'),
        true,
        'admin-studio.html should load the analytics ai-prompt builder after the ai-helper layer'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-prompt-builders.js?v=20260405_ANALYTICS_AI_PROMPT_BUILDERS_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-controller.js?v=20260405_ANALYTICS_AI_CONTROLLER_1'),
        true,
        'admin-studio.html should load the analytics ai-controller after the ai-prompt builders'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-controller.js?v=20260405_ANALYTICS_AI_CONTROLLER_1') < adminStudioHtml.indexOf('js/admin-analytics-export-builders.js?v=20260405_ANALYTICS_EXPORT_BUILDERS_1'),
        true,
        'admin-studio.html should load the analytics export-builder helper after the insight-card helper'
    );

    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-export-builders.js?v=20260405_ANALYTICS_EXPORT_BUILDERS_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should load the analytics ai/export helper after the main analytics runtime'
    );

    assert.match(
        adminStudioHtml,
        /admin-studio\.css\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should load the latest admin stylesheet version'
    );
});

test('analytics product tab shell adds a dedicated product analytics surface and route target', () => {
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const adminStudioStyles = readRepoFile('admin-studio.css');
    const analyticsSource = readRepoFile('admin-analytics.js');
    const panelLoaderSource = readRepoFile('js/admin-analytics-panel-loaders.js');
    const workbenchSource = readRepoFile('js/admin-analytics-workbench.js');
    const shopSource = readRepoFile('js/admin-shop.js');

    const htmlMarkers = [
        'data-tab="product"',
        'id="analytics-tab-product"',
        'id="productAlerts"',
        'id="productOverview"',
        'id="productRankings"',
        'id="productFunnel"',
        'id="productHealth"',
        'id="productDetailPanel"',
        'id="productAlertsMeta"',
        'id="productOverviewMeta"',
        'id="productRankingsMeta"',
        'id="productFunnelMeta"',
        'id="productHealthMeta"',
        'id="productDetailMeta"'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminStudioHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const styleMarkers = [
        '.analytics-product-shell-grid {',
        '.analytics-product-shell {',
        '.analytics-product-alert-grid {',
        '.analytics-product-alert-card {',
        '.analytics-product-alert-card__digest {',
        '.analytics-product-window-notice {',
        '.analytics-writeback-note {',
        '.analytics-writeback-summary {',
        '.analytics-writeback-priority {',
        '.analytics-writeback-priority__verification {',
        '.analytics-writeback-priority__evidence {',
        '.analytics-writeback-priority__timeline {',
        '.analytics-writeback-conclusions {',
        '.analytics-writeback-conclusion-card {',
        '.analytics-product-history-summary {',
        '.analytics-product-conclusion-digest {',
        '.analytics-writeback-priority__checklist {',
        '.analytics-product-shell__eyebrow {',
        '.analytics-product-shell__pill-list {',
        '.analytics-product-shell__list {',
        '.analytics-product-funnel-stage-list {',
        '.analytics-product-detail {',
        '.analytics-product-token {',
        '.analytics-product-order-row {',
        '.analytics-product-detail-subsection {',
        '.analytics-product-event-row {',
        '.analytics-product-stage-badge {',
        '.analytics-product-prompt-row {',
        '.analytics-product-structure-layout {',
        '.analytics-product-category-row {',
        '.analytics-product-matrix-summary {',
        '.analytics-product-matrix-chip {',
        '.analytics-product-matrix-row {'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStudioStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    const analyticsMarkers = [
        "productAlertsMeta: { basis: '库存 / 履约 / 转化预警' }",
        "productOverviewMeta: { basis: '成交 / 浏览 / 站点对比' }",
        "productRankingsMeta: { basis: '销量 / 收入 / 转化 / 风险榜' }",
        "productFunnelMeta: { basis: '详情到支付 / 发货漏斗' }",
        "productHealthMeta: { basis: '库存 / 售后 / 履约风险' }",
        "productDetailMeta: { basis: '点击商品打开单品详情' }",
        'function getOverviewProductBundleSegmentPayload(bundle = null, key = \'\') {',
        'function buildOverviewBusinessMixProductSignals({',
        'function enrichOverviewBusinessMixSummaryWithProductSignals(summary = {}, productSignals = null) {',
        'getAnalyticsProductSummaryBundle({',
        'getAnalyticsProductRankBundle({',
        'getAnalyticsProductHealthBundle({',
        'title: \'商品经营\'',
        '商品售后风险已进入经营总览',
        '商品履约异常已经影响经营承接',
        '商品高曝光低转化信号已进入总览'
    ];

    for (const marker of analyticsMarkers) {
        assert.equal(analyticsSource.includes(marker), true, `admin-analytics.js should contain ${marker}`);
    }

    const shopMarkers = [
        'buildUserCommerceReturnContext: function (context = this.orderSearchContext) {',
        'buildUserCommerceReturnAttrs: function (context = this.orderSearchContext) {',
        '回用户承接链'
    ];

    for (const marker of shopMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    const productPanelMarkers = [
        'function buildAnalyticsProductDestinationAttrs(destination = \'\', context = null) {',
        'function getAnalyticsResolutionFeedbackEntriesForProduct(options = {}) {',
        'function buildAnalyticsResolutionFeedbackStatusSummary(entries = []) {',
        'function buildAnalyticsResolutionPriorityProducts(entries = [], alertItems = []) {',
        'function buildAnalyticsResolutionPriorityReason(row = {}, alertItem = {}, latestEntry = {}) {',
        'function buildAnalyticsResolutionPriorityRecommendation(row = {}, alertItem = {}, latestEntry = {}) {',
        'function buildAnalyticsResolutionPriorityVerification(row = {}, alertItem = {}, latestEntry = {}) {',
        'function buildAnalyticsResolutionPriorityVerificationStatus(row = {}, alertItem = {}, latestEntry = {}) {',
        'function buildAnalyticsResolutionPriorityEvidence(row = {}, alertItem = {}, latestEntry = {}, verificationState = {}) {',
        'function buildAnalyticsResolutionPriorityTimeline(row = {}, alertItem = {}, latestEntry = {}, verificationState = {}) {',
        'function buildAnalyticsResolutionConclusionRecords(entries = [], alertItems = [], options = {}) {',
        'function renderAnalyticsResolutionConclusionRecords(entries = [], alertItems = [], options = {}) {',
        'function renderAnalyticsProductConclusionHistory(options = {}) {',
        'function buildAnalyticsProductConclusionDigest(entries = [], summary = {}) {',
        'function renderAnalyticsProductConclusionDigest(entries = [], summary = {}) {',
        'function buildAnalyticsProductAlertDigest(item = {}, summary = {}) {',
        'function renderAnalyticsResolutionPriorityProducts(entries = [], alertItems = []) {',
        'function renderAnalyticsResolutionFeedbackNote(options = {}) {',
        'function renderAnalyticsProductNameButton(name = \'\', productId = \'\', options = {}) {',
        'function buildAnalyticsProductAlertItems({ summary = {}, productMatrix = {}, healthPayloads = {}, rankPayloads = {} } = {}) {',
        'function renderAnalyticsProductAlerts(alertItems = [], summary = {}) {',
        'function getAnalyticsProductOverviewChartState() {',
        'function renderAnalyticsProductCategoryBreakdown(payload = {}) {',
        'function renderAnalyticsProductMatrix(payload = {}) {',
        'function renderAnalyticsProductOverview(summary = {}, trendRows = [], comparison = {}, categoryBreakdown = {}, productMatrix = {}) {',
        'function renderAnalyticsProductCategoryBreakdownChart(payload = {}) {',
        'function renderAnalyticsProductOperatingMatrixChart(payload = {}) {',
        'function buildAnalyticsProductRankMetaItems(row = {}, metaFormatter = null) {',
        'function getAnalyticsProductDetailFocusConfig(detailFocus = \'\', summary = {}) {',
        'function renderAnalyticsProductDetailFocusBanner(detailFocus = \'\', summary = {}) {',
        'function getAnalyticsProductStatusBreakdownActions(kind = \'refund\', item = {}, summary = {}) {',
        'function renderAnalyticsProductStatusBreakdownRow(item = {}, options = {}) {',
        'function renderAnalyticsProductRankings(payloads = {}) {',
        'function renderAnalyticsProductHealth(payloads = {}) {',
        'function renderAnalyticsProductFunnel(payload = {}) {',
        'function renderAnalyticsProductStaticToken(item = {}) {',
        'function renderAnalyticsProductPromptSourceChip(source = {}) {',
        'function renderAnalyticsProductPromptAttributionRow(source = {}) {',
        'function renderAnalyticsProductEventStageRow(stage = {}) {',
        'function renderAnalyticsProductDestinationActions(row = {}, options = {}) {',
        'function renderAnalyticsProductDestinationRow(row = {}, options = {}) {',
        'function renderAnalyticsProductDetailPanel(payload = {}, options = {}) {',
        'function isAnalyticsProductTabActive() {',
        'analytics-resolution-feedback-updated',
        "'退款率 Top'",
        "'履约异常率 Top'",
        "'内容带货 Top'",
        'productRiskBreakdownSection',
        'productContentBreakdownSection',
        '<strong>来源归因</strong>',
        '<strong>售后与履约拆解</strong>',
        '<strong>内容带货拆解</strong>',
        '<strong>类目贡献</strong>',
        '<strong>商品经营矩阵</strong>',
        '<strong>购买用户分层</strong>',
        '<strong>用户去向</strong>',
        '最近处理回写',
        '支付 / 售后 / 履约处理结果会回传到运营保障驾驶舱',
        '最该复查的问题',
        '沉淀最近一轮运营保障复查结论',
        '最近一次验证依据',
        '处理时间线',
        '下次复查建议',
        '已处理',
        '待复查',
        '仍异常',
        '最该复查的商品',
        'showPriorityProducts: true',
        '排前原因',
        '建议先做',
        '验证方式',
        '验证已通过',
        '仍待验证',
        '最近一次验证依据',
        '处理时间线',
        '最近处理',
        '当前验证',
        '下一步复查',
        '复查结论记录',
        '本轮复查已通过',
        '本轮仍待复查',
        '结论依据',
        '下次复查建议',
        '历史复查结论',
        '最近 ${escapeHtml(formatNumber(rows.length))} 条回写',
        '按时间倒序保留该商品最近一轮处理与复查结论',
        'productConclusionHistorySection',
        '本轮经营结论',
        '已基本收口',
        'analytics-product-conclusion-digest',
        'analytics-product-alert-card__digest',
        '本轮经营判断',
        'function buildAnalyticsProductAlertGuidance(item = {}, summary = {}) {',
        'analytics-product-alert-card__guidance',
        '就地经营建议',
        '为什么重要',
        'function buildAnalyticsProductListGuidance(item = {}, options = {}) {',
        'analytics-product-inline-guidance',
        '经营建议',
        'function buildAnalyticsProductCategoryGuidance(row = {}, index = 0, payload = {}) {',
        '核心类目',
        '低转化类目',
        '首单入口分布',
        '跨商品复购去向',
        '后续复购商品',
        'referenceLabel = mode === \'post-purchase\' ? \'后续复购商品\' : \'跨商品复购\'',
        '<i class="fas fa-receipt"></i> 看订单',
        '<i class="fas fa-truck-fast"></i> 去履约',
        'async function loadProductAlerts() {',
        '商品预警中心加载中...',
        '当前窗口暂无商品预警信号',
        '<i class="fas fa-headset"></i> 去售后',
        "label: '看支付异常'",
        "destination: 'payments-ops'",
        "label: '看支付对账'",
        "destination: 'payments-overview'",
        'productCategoryBreakdownChartCanvas',
        'productOperatingMatrixChartCanvas',
        '<strong>来源 Prompt 归因明细</strong>',
        '<strong>事件采集状态</strong>',
        'first_purchase_destinations',
        'cross_sell_destinations',
        'post_purchase_destinations',
        'shop-orders',
        'shop-fulfillment',
        '去售后',
        '去履约',
        'async function loadProductFunnel() {',
        'async function loadProductDetailPanel(options = {}) {',
        'function openAnalyticsProductDetail(productId = \'\', options = {}) {'
    ];

    for (const marker of productPanelMarkers) {
        assert.equal(panelLoaderSource.includes(marker), true, `js/admin-analytics-panel-loaders.js should contain ${marker}`);
    }

    assert.equal(workbenchSource.includes("case 'analytics-product':"), true, 'analytics workbench routing should accept analytics-product destinations');
    assert.equal(workbenchSource.includes("case 'analytics-ops':"), true, 'analytics workbench routing should accept analytics-ops destinations');
    assert.equal(workbenchSource.includes('function resolveAnalyticsResolutionFeedbackStatus(entry = {}) {'), true, 'analytics workbench helper should normalize resolution feedback into product-alert status tiers');
    assert.equal(workbenchSource.includes('const feedbackScope = String(options?.feedbackScope || \'\').trim().toLowerCase();'), true, 'analytics workbench helper should support scoped analytics resolution feedback reads');
    assert.equal(workbenchSource.includes('window.recordAnalyticsResolutionFeedback = recordAnalyticsResolutionFeedback;'), true, 'analytics workbench helper should expose analytics resolution feedback recording for downstream modules');
    assert.equal(workbenchSource.includes('window.getAnalyticsResolutionFeedbackEntries = getAnalyticsResolutionFeedbackEntries;'), true, 'analytics workbench helper should expose analytics resolution feedback reads for the analytics product panels');
    assert.equal(workbenchSource.includes("case 'analytics-product-detail':"), true, 'analytics workbench routing should accept analytics-product-detail destinations');
    assert.equal(workbenchSource.includes("case 'analytics-content':"), true, 'analytics workbench routing should accept analytics-content destinations');
    assert.equal(workbenchSource.includes('window.openAnalyticsContentCommerceDetail(contentPromptId,'), true, 'analytics workbench routing should reopen analytics-side content-commerce detail drill-downs');
    assert.equal(workbenchSource.includes("case 'shop-products':"), true, 'analytics workbench routing should accept shop-products destinations from product analytics');
    assert.equal(workbenchSource.includes("case 'shop-orders':"), true, 'analytics workbench routing should accept shop-orders destinations from product analytics');
    assert.equal(workbenchSource.includes("case 'shop-inventory':"), true, 'analytics workbench routing should accept shop-inventory destinations from product analytics');
    assert.equal(workbenchSource.includes("case 'shop-fulfillment':"), true, 'analytics workbench routing should accept shop-fulfillment destinations from product analytics');
    assert.equal(workbenchSource.includes("case 'ops-alerts-health':"), true, 'analytics workbench routing should accept ops-alert health destinations from analytics');
    assert.equal(workbenchSource.includes('window.switchOpsAlertsView?.(targetView);'), true, 'analytics workbench routing should reuse ops-alerts view switching for the ops cockpit');
    assert.equal(workbenchSource.includes('window.ShopAdmin?.switchTab?.(requestedTab);'), true, 'analytics workbench routing should reuse ShopAdmin tab switching for product drill-down');
    assert.equal(workbenchSource.includes('window.ShopAdmin.editProduct(normalizedContext.productId)'), true, 'analytics workbench routing should open shop product details from product analytics');
    assert.equal(workbenchSource.includes('window.ShopAdmin?.setOrderSearchContext?.(shopDrilldownContext);'), true, 'analytics workbench routing should push analytics context into shop order searches');
    assert.equal(workbenchSource.includes('context: shopDrilldownContext'), true, 'analytics workbench routing should preserve analytics context when opening exact shop orders');
    assert.equal(workbenchSource.includes('window.ShopAdmin?.setDeliveryWorkbenchContext?.('), true, 'analytics workbench routing should push analytics context into fulfillment drill-downs');
    assert.equal(workbenchSource.includes('window.ShopAdmin.searchOrders(1, {'), true, 'analytics workbench routing should support product-driven order searches from analytics');
    assert.equal(workbenchSource.includes('window.ShopAdmin.loadDeliveryTasks(1)'), true, 'analytics workbench routing should support fulfillment queue drill-downs from analytics');
    assert.equal(workbenchSource.includes('window.ShopAdmin.showInventoryDetail(normalizedContext.inventoryId)'), true, 'analytics workbench routing should open inventory details from product analytics');
    assert.equal(workbenchSource.includes('window.openAnalyticsProductDetail?.(normalizedContext.productId,'), true, 'analytics workbench routing should reopen analytics-side product detail drill-downs');
    assert.equal(workbenchSource.includes("detailFocus: normalizedContext.detailFocus || ''"), true, 'analytics workbench routing should preserve product detail focus context');
    assert.equal(workbenchSource.includes("focusTargetId: normalizedContext.focusTargetId || ''"), true, 'analytics workbench routing should preserve product detail focus targets');
    assert.equal(shopSource.includes('setOrderSearchContext: function (context = null) {'), true, 'shop admin should accept analytics-driven order context');
    assert.equal(shopSource.includes('hasUserCommerceOrderContext: function (context = this.orderSearchContext) {'), true, 'shop admin should detect user-driven commerce order contexts');
    assert.equal(shopSource.includes('applyOrderUserFlowFocus: function (rawKind, rawValue) {'), true, 'shop admin should expose a quick-switch handler for user-commerce order issue focus');
    assert.equal(shopSource.includes('buildOrderUserFlowDestinationContext: function (destination = \'\', item = {}) {'), true, 'shop admin should build payment and ticket destination context from user-commerce order flow state');
    assert.equal(shopSource.includes('openOrderUserFlowDestination: function (destination = \'\', rawKind = \'\', rawValue = \'\') {'), true, 'shop admin should open downstream payment and ticket views from user-commerce order flow priorities');
    assert.equal(shopSource.includes('renderOrderUserFlowSummary: function (rows = [], options = {}) {'), true, 'shop admin should render a user-level order commerce summary when analytics opens orders from user drill-downs');
    assert.equal(shopSource.includes('renderOrderIssueSummary: function (rows = [], options = {}) {'), true, 'shop admin should render an order issue summary when analytics applies issue filters');
    assert.equal(shopSource.includes('buildOrderIssueGuidanceState: function ({ refundStatus = \'all\', deliveryStatus = \'all\', totalCount = 0 } = {}) {'), true, 'shop admin should build recommendation and verification guidance for focused order issue views');
    assert.equal(shopSource.includes('recordOrderResolutionFeedback: function (orderId = \'\', options = {}) {'), true, 'shop admin should record analytics writeback after order-side handling');
    assert.equal(shopSource.includes('setDeliveryWorkbenchContext: function (context = null) {'), true, 'shop admin should accept analytics-driven fulfillment context');
    assert.equal(shopSource.includes('当前订单列表来自商品分析下钻'), true, 'shop admin should render an analytics drill-down note for orders');
    assert.equal(shopSource.includes('当前订单列表来自商品经营影响用户'), true, 'shop admin should render a dedicated user-commerce note for user-driven order drill-downs');
    assert.equal(shopSource.includes('订单承接链'), true, 'shop admin should label user-driven order drill-down summaries explicitly');
    assert.equal(shopSource.includes('退款相关订单'), true, 'shop admin should prioritize refund-related order issues inside the user commerce order flow');
    assert.equal(shopSource.includes('履约死信订单'), true, 'shop admin should prioritize dead-letter fulfillment orders inside the user commerce order flow');
    assert.equal(shopSource.includes('为什么优先'), true, 'shop admin should explain why an order issue is prioritized');
    assert.equal(shopSource.includes('验证方式'), true, 'shop admin should surface how to verify an order issue has been resolved');
    assert.equal(shopSource.includes("case 'order-user-flow-focus':"), true, 'shop admin should route order user-flow focus actions through delegated actions');
    assert.equal(shopSource.includes("case 'order-user-flow-open-destination':"), true, 'shop admin should route user-commerce priority actions to downstream payment and ticket destinations');
    assert.equal(shopSource.includes('看支付问题'), true, 'shop admin should provide a payment follow-up action from user-commerce order flow priorities');
    assert.equal(shopSource.includes('看售后工单'), true, 'shop admin should provide a ticket follow-up action from user-commerce order flow priorities');
    assert.equal(shopSource.includes('订单问题列表'), true, 'shop admin should label analytics-driven order issue views explicitly');
    assert.equal(shopSource.includes('当前履约页来自商品分析下钻'), true, 'shop admin should render an analytics drill-down note for fulfillment');
    assert.equal(shopSource.includes('renderDeliveryIssueSummary: function (summary = {}) {'), true, 'shop admin should render a fulfillment issue summary when analytics applies issue filters');
    assert.equal(shopSource.includes('履约问题列表'), true, 'shop admin should label analytics-driven fulfillment issue views explicitly');
    assert.equal(shopSource.includes('applyDeliveryIssueSummaryFocus: function (focusKind, rawValue) {'), true, 'shop admin should expose a quick-switch handler for fulfillment issue summary chips');
    assert.equal(shopSource.includes("case 'delivery-issue-summary-focus':"), true, 'shop admin should route fulfillment issue summary chips through delegated actions');
    assert.equal(shopSource.includes('建议先处理'), true, 'shop admin should surface prioritized next actions inside the fulfillment issue summary');
    assert.equal(shopSource.includes('applyDeliveryPriorityAction: function (rawKey) {'), true, 'shop admin should expose direct priority actions for fulfillment issue recommendations');
    assert.equal(shopSource.includes("case 'delivery-priority-action':"), true, 'shop admin should route fulfillment priority actions through delegated actions');
    assert.equal(shopSource.includes('revealPendingDeliverySection: function () {'), true, 'shop admin should reveal the target fulfillment section after a priority action runs');
    assert.equal(shopSource.includes('refundStatus: this.normalizeOrderRefundStatusFilter(this.orderRefundStatusFilter)'), true, 'shop admin should forward analytics refund issue focus to the orders API');
    assert.equal(shopSource.includes('deliveryStatus: this.normalizeOrderDeliveryStatusFilter(this.orderDeliveryStatusFilter)'), true, 'shop admin should forward analytics delivery issue focus to the orders API');
    assert.equal(adminStudioHtml.includes('id="shopOrdersContextHint"'), true, 'admin-studio.html should provide an orders drill-down context mount for shop analytics');
    assert.equal(adminStudioHtml.includes('id="shopOrdersUserFlowSummary"'), true, 'admin-studio.html should provide a user-order flow summary mount for analytics-driven shop drill-downs');
    assert.equal(adminStudioHtml.includes('id="shopOrdersIssueSummary"'), true, 'admin-studio.html should provide an order issue summary mount for analytics-driven shop drill-downs');
    assert.equal(adminStudioHtml.includes('id="deliveryIssueSummary"'), true, 'admin-studio.html should provide a fulfillment issue summary mount for analytics-driven shop drill-downs');
    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics product-shell runtime version'
    );
    assert.equal(
        analyticsSource.includes("const pathname = '/api/admin';"),
        true,
        'admin-analytics.js should route analytics admin fetches through the canonical /api/admin endpoint'
    );
    assert.equal(
        analyticsSource.includes("const pathname = normalizedRoute\n        ? `/api/admin/${normalizedRoute}`\n        : '/api/admin';"),
        false,
        'admin-analytics.js should no longer depend on nested admin analytics paths for bundle fetches'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-workbench.js?v=20260407_ANALYTICS_WORKBENCH_BUNDLE_13'),
        true,
        'admin-studio.html should reference the latest analytics workbench runtime version for product routing'
    );
});

test('analytics panel loaders externalize dashboard fetch-and-render layers out of the main shell', () => {
    const mainAnalyticsSource = readRepoFile('admin-analytics.js');
    const panelLoaderSource = readRepoFile('js/admin-analytics-panel-loaders.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const adminStudioStyles = readRepoFile('admin-studio.css');

    const helperMarkers = [
        'async function resolveAnalyticsBundleFirstData(options = {}) {',
        'async function fetchUserTrendData(days = getAnalyticsRangeDays(30)) {',
        'function buildAnalyticsUserCommerceImpactSummary(productSummary = {}, userTrendRows = []) {',
        'function renderAnalyticsUserCommerceImpactSample(sample = {}, item = {}, summary = {}) {',
        'function renderAnalyticsUserCommerceImpactSummary(summary = {}) {',
        'function buildAnalyticsUserValueCockpitSummary(productSummary = {}, userTrendRows = []) {',
        'function renderAnalyticsUserValueCockpitBuyerSample(sample = {}, summary = {}, segment = {}) {',
        'function renderAnalyticsUserValueCockpitProductRow(row = {}, label = \'\') {',
        'function getAnalyticsResolutionFeedbackEntriesForUser(options = {}) {',
        'function buildAnalyticsUserValueFeedbackVerificationStatus(entries = [], summary = {}) {',
        'function buildAnalyticsUserValueConclusionDigest(entries = [], summary = {}) {',
        'function buildAnalyticsUserValuePriorityDestinationContext(summary = {}, options = {}) {',
        'function buildAnalyticsUserValuePriorityReviewItems(summary = {}, entries = []) {',
        'function buildAnalyticsUserValuePrioritySummary(summary = {}, entries = []) {',
        'function buildAnalyticsUserValueOverviewState({ summaryWindow = {}, productSummary = {} } = {}) {',
        'function renderAnalyticsUserValuePriorityReview(summary = {}, entries = []) {',
        'function renderAnalyticsUserValueConclusionDigest(entries = [], summary = {}) {',
        'function renderAnalyticsUserValueFeedbackNote(summary = {}) {',
        'function renderAnalyticsUserValueConclusionHistory(summary = {}) {',
        'function renderAnalyticsUserValueCockpitSummary(summary = {}) {',
        '用户价值驾驶舱',
        '最该复查的用户承接',
        '退款风险用户仍待收口',
        '首单已形成，复购层仍偏薄',
        '购买意图已出现，但还没转成成交用户',
        '用户价值还停在浏览或详情前段',
        '本轮用户价值结论',
        '用户侧订单 / 支付 / 售后结果已回传到用户价值驾驶舱',
        '首购商品去向',
        '后续复购去向',
        'function enrichAnalyticsGrowthSummaryWithProductSignals(summary = {}, productSummary = {}) {',
        'function buildAnalyticsContentCommerceSummary(rows = []) {',
        'function renderAnalyticsContentCommerceSummary(summary = {}) {',
        'function buildAnalyticsContentCommerceOrderContext(row = {}, product = null) {',
        'function buildAnalyticsContentCommerceGuidance(detail = {}) {',
        'function renderAnalyticsTopContentCommerceProducts(row = {}) {',
        'function renderAnalyticsTopContentCommerceActions(row = {}) {',
        'function renderAnalyticsTopContentCommerceNote(row = {}) {',
        'function buildAnalyticsContentCommerceUserDetailContext(detail = {}, signalLabel = \'\', signalValue = \'\') {',
        'function renderAnalyticsContentCommerceUserSample(userId = \'\', detail = {}, options = {}) {',
        'function renderAnalyticsContentCommerceOrderSample(order = {}, detail = {}) {',
        'function renderAnalyticsContentCommerceDetailPanel(detail = null) {',
        'function openAnalyticsContentCommerceDetail(promptId = \'\', options = {}) {',
        'async function loadOverviewStats() {',
        'async function loadPointsStats(days = getAnalyticsRangeDays()) {',
        'async function loadActivityHeatmap(days = getAnalyticsRangeDays(30)) {',
        'async function loadGeoDistribution() {',
        'async function loadEventFunnelPanels() {',
        'async function loadProductOverview() {',
        'async function loadProductRankings() {',
        'async function loadProductFunnel() {',
        'async function loadProductHealth() {',
        'async function loadProductDetailPanel(options = {}) {',
        'function renderAnalyticsProductOverview(summary = {}, trendRows = [], comparison = {}, categoryBreakdown = {}, productMatrix = {}) {',
        'function renderAnalyticsProductRankings(payloads = {}) {',
        'function renderAnalyticsProductFunnel(payload = {}) {',
        'function renderAnalyticsProductHealth(payloads = {}) {',
        'function renderAnalyticsProductDetailPanel(payload = {}, options = {}) {',
        'function openAnalyticsProductDetail(productId = \'\', options = {}) {',
        'function renderAnalyticsProductTrendChart(rows = []) {',
        'async function getAnalyticsOpsAlertHealthData(options = {}) {',
        'async function loadOperationsCockpit() {',
        'function renderAnalyticsOpsCockpitGuidance(guidance = null) {',
        'function buildAnalyticsOpsPriorityIssues({',
        'function renderAnalyticsOpsCockpitOverview(state = {}) {',
        'function buildAnalyticsOpsCockpitOverviewState({',
        'function buildAnalyticsOpsAlertsState(opsAlertHealth = {}) {',
        'getAnalyticsProductSummaryBundle().catch(() => null)',
        'getAnalyticsProductSummaryBundle({ days }).catch(() => null)',
        'getAnalyticsProductRankBundle({ days }).catch(() => null)',
        "getAnalyticsProductBundlePayloadOrThrow(productRankBundle, 'contentDrivenTop', 'Product content-driven rank unavailable')",
        'analytics-user-commerce-impact',
        'analytics-user-commerce-impact__sample',
        'analytics-content-commerce-summary',
        'analytics-content-detail',
        'analytics-ops-cockpit__overview',
        'analytics-ops-cockpit__actions',
        'analytics-ops-cockpit__guidance',
        'analytics-ops-cockpit__issue-grid',
        '为什么优先',
        '建议先做',
        '验证方式',
        "destination: 'analytics-ops'",
        "destination: 'ops-alerts-health'",
        'buildAnalyticsContentCommerceIssueCards(detail = {})',
        'buildAnalyticsContentCommercePaymentsContext(detail = {}, issue = {})',
        'buildAnalyticsContentCommerceTicketsContext(detail = {}, issue = {})',
        'function getAnalyticsResolutionFeedbackEntriesForContent(options = {}) {',
        "feedbackScope: 'content'",
        "feedbackEntityType: 'prompt'",
        'function buildAnalyticsContentCommerceFeedbackVerificationStatus(entries = [], detail = {}) {',
        'function buildAnalyticsContentCommerceConclusionDigest(entries = [], detail = {}) {',
        'function renderAnalyticsContentCommerceConclusionDigest(entries = [], detail = {}) {',
        'function buildAnalyticsContentCommerceConclusionRecord(entries = [], detail = {}) {',
        'function renderAnalyticsContentCommerceFeedbackNote(detail = {}) {',
        'function renderAnalyticsContentCommerceConclusionHistory(detail = {}) {',
        'function buildAnalyticsContentUserValueLinkGuidance(detail = {}) {',
        'function renderAnalyticsContentUserValueLink(detail = {}) {',
        'analytics-content-detail-issue-grid',
        'analytics-content-detail-sample-grid',
        'top-content-item__commerce',
        '看商品经营',
        '看商品漏斗',
        '看带货详情',
        '看带货商品',
        '看订单链',
        '内容 -> 用户价值',
        '看用户价值',
        '本轮内容经营结论',
        '带货问题摘要',
        '复查结论记录',
        '历史复查结论',
        '看支付问题',
        '看售后工单'
    ];

    for (const marker of helperMarkers) {
        assert.equal(panelLoaderSource.includes(marker), true, `js/admin-analytics-panel-loaders.js should contain ${marker}`);
    }

    assert.equal(adminStudioHtml.includes('id="userTrendPanel"'), true, 'admin-studio.html should expose a user trend panel mount');
    assert.equal(adminStudioHtml.includes('id="userGrowthCommerceImpact"'), true, 'admin-studio.html should expose a user commerce impact mount');
    assert.equal(adminStudioHtml.includes('id="userValueCockpit"'), true, 'admin-studio.html should expose a user value cockpit mount');
    assert.equal(adminStudioStyles.includes('.analytics-user-commerce-impact {'), true, 'admin-studio.css should style the user commerce impact summary');
    assert.equal(adminStudioStyles.includes('.analytics-user-commerce-impact__sample {'), true, 'admin-studio.css should style the user commerce impact sample buttons');
    assert.equal(adminStudioStyles.includes('.analytics-user-value-cockpit {'), true, 'admin-studio.css should style the user value cockpit shell');
    assert.equal(adminStudioStyles.includes('.analytics-user-value-cockpit__sample {'), true, 'admin-studio.css should style the user value cockpit buyer samples');
    assert.equal(adminStudioStyles.includes('.top-content-item__commerce-actions {'), true, 'admin-studio.css should style content-commerce action rows');
    assert.equal(adminStudioStyles.includes('.top-content-item__commerce-more {'), true, 'admin-studio.css should style the extra product count badge');
    assert.equal(adminStudioStyles.includes('.analytics-content-detail {'), true, 'admin-studio.css should style the content-commerce detail shell');
    assert.equal(adminStudioStyles.includes('.analytics-content-detail__actions {'), true, 'admin-studio.css should style the content-commerce detail action row');
    assert.equal(adminStudioStyles.includes('.analytics-content-detail-issue-grid {'), true, 'admin-studio.css should style content-commerce issue grids');
    assert.equal(adminStudioStyles.includes('.analytics-content-detail-issue-card {'), true, 'admin-studio.css should style content-commerce issue cards');
    assert.equal(adminStudioStyles.includes('.analytics-content-detail-sample-grid {'), true, 'admin-studio.css should style content-commerce sample grids');
    assert.equal(adminStudioStyles.includes('.analytics-content-detail-sample-card {'), true, 'admin-studio.css should style content-commerce sample cards');
    assert.equal(adminStudioStyles.includes('.analytics-content-detail-product-row {'), true, 'admin-studio.css should style content-commerce detail product rows');
    assert.equal(adminStudioStyles.includes('.analytics-ops-cockpit {'), true, 'admin-studio.css should style the ops cockpit shell');
    assert.equal(adminStudioStyles.includes('.analytics-ops-cockpit__stats {'), true, 'admin-studio.css should style the ops cockpit stat grid');
    assert.equal(adminStudioStyles.includes('.analytics-ops-cockpit__actions {'), true, 'admin-studio.css should style the ops cockpit action row');
    assert.equal(adminStudioStyles.includes('.analytics-ops-cockpit__guidance {'), true, 'admin-studio.css should style card-level ops guidance blocks');
    assert.equal(adminStudioStyles.includes('.analytics-ops-cockpit__issue-grid {'), true, 'admin-studio.css should style overview-level ops priority issue grids');

    const removedFromMainMarkers = [
        'async function resolveAnalyticsBundleFirstData(options = {}) {',
        'async function loadOverviewStats() {',
        'async function loadPointsStats(days = getAnalyticsRangeDays()) {',
        'async function loadActivityHeatmap(days = getAnalyticsRangeDays(30)) {',
        'async function loadGeoDistribution() {',
        'async function loadProductOverview() {',
        'async function loadProductRankings() {',
        'async function loadProductFunnel() {',
        'async function loadProductHealth() {',
        'async function loadProductDetailPanel(options = {}) {'
    ];

    for (const marker of removedFromMainMarkers) {
        assert.equal(mainAnalyticsSource.includes(marker), false, `admin-analytics.js should no longer contain ${marker}`);
    }

    assert.equal(
        mainAnalyticsSource.includes('// Bundle-first panel fetchers are externalized in js/admin-analytics-panel-loaders.js.'),
        true,
        'admin-analytics.js should leave a shell note for externalized panel fetchers'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-panel-loaders.js?v=20260407_ANALYTICS_PANEL_LOADERS_70'),
        true,
        'admin-studio.html should load the analytics panel-loader helper'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-runtime-controls.js?v=20260405_ANALYTICS_RUNTIME_CONTROLS_1') < adminStudioHtml.indexOf('js/admin-analytics-panel-loaders.js?v=20260407_ANALYTICS_PANEL_LOADERS_70'),
        true,
        'admin-studio.html should load the panel-loader helper after the runtime-controls shell'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-panel-loaders.js?v=20260407_ANALYTICS_PANEL_LOADERS_70') < adminStudioHtml.indexOf('js/admin-analytics-workbench.js?v=20260407_ANALYTICS_WORKBENCH_BUNDLE_13'),
        true,
        'admin-studio.html should load the panel-loader helper before downstream analytics helpers'
    );
});

test('analytics derived bundles externalize cache state and admin bundle wrappers out of the main shell', () => {
    const mainAnalyticsSource = readRepoFile('admin-analytics.js');
    const derivedBundleSource = readRepoFile('js/admin-analytics-derived-bundles.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const helperMarkers = [
        'const analyticsDerivedState = {',
        'function ensureAnalyticsDerivedContext(contextKey = getAnalyticsAIContextKey()) {',
        'function getAnalyticsAISourceData(data = null) {',
        'function buildAnalyticsSummaryWindowBundleQuery(options = {}) {',
        'async function getAnalyticsAdminSnapshotBundle(options = {}) {',
        'async function getAnalyticsSummaryRowsBundle(options = {}) {',
        'async function getAnalyticsPanelSupportBundle(options = {}) {',
        'async function getAnalyticsVisualPanelBundle(options = {}) {',
        'async function getAnalyticsTrendSeriesBundle(options = {}) {',
        'async function getAnalyticsProductSummaryBundle(options = {}) {',
        'async function getAnalyticsProductRankBundle(options = {}) {',
        'async function getAnalyticsProductHealthBundle(options = {}) {',
        'async function getAnalyticsProductFunnelBundle(options = {}) {',
        'async function getAnalyticsProductDetailBundle(options = {}) {',
        'function getAnalyticsProductBundleSegment(bundle = null, key = \'\') {',
        'async function getAnalyticsCommentsSummaryData(options = {}) {',
        'async function getAnalyticsVerifyMonitorSnapshotData(options = {}) {'
    ];

    for (const marker of helperMarkers) {
        assert.equal(derivedBundleSource.includes(marker), true, `js/admin-analytics-derived-bundles.js should contain ${marker}`);
    }

    const removedFromMainMarkers = [
        'const analyticsDerivedState = {',
        'function ensureAnalyticsDerivedContext(contextKey = getAnalyticsAIContextKey()) {',
        'function getAnalyticsAISourceData(data = null) {',
        'function buildAnalyticsSummaryWindowBundleQuery(options = {}) {',
        'async function getAnalyticsAdminSnapshotBundle(options = {}) {',
        'async function getAnalyticsSummaryRowsBundle(options = {}) {',
        'async function getAnalyticsPanelSupportBundle(options = {}) {',
        'async function getAnalyticsVisualPanelBundle(options = {}) {',
        'async function getAnalyticsTrendSeriesBundle(options = {}) {',
        'async function getAnalyticsProductSummaryBundle(options = {}) {',
        'async function getAnalyticsProductRankBundle(options = {}) {',
        'async function getAnalyticsProductHealthBundle(options = {}) {',
        'async function getAnalyticsProductFunnelBundle(options = {}) {',
        'async function getAnalyticsProductDetailBundle(options = {}) {',
        'function getAnalyticsProductBundleSegment(bundle = null, key = \'\') {',
        'async function getAnalyticsCommentsSummaryData(options = {}) {',
        'async function getAnalyticsVerifyMonitorSnapshotData(options = {}) {'
    ];

    for (const marker of removedFromMainMarkers) {
        assert.equal(mainAnalyticsSource.includes(marker), false, `admin-analytics.js should no longer contain ${marker}`);
    }

    assert.equal(
        mainAnalyticsSource.includes('// Derived bundle cache, summary-window/site-comparison accessors, and admin bundle wrappers'),
        true,
        'admin-analytics.js should leave a shell note for externalized derived bundles'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-derived-bundles.js?v=20260405_ANALYTICS_DERIVED_BUNDLES_5'),
        true,
        'admin-studio.html should load the analytics derived-bundle helper'
    );
    assert.equal(
        adminStudioHtml.indexOf('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8') < adminStudioHtml.indexOf('js/admin-analytics-derived-bundles.js?v=20260405_ANALYTICS_DERIVED_BUNDLES_5'),
        true,
        'admin-studio.html should load the derived-bundle helper after the main analytics shell'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-derived-bundles.js?v=20260405_ANALYTICS_DERIVED_BUNDLES_5') < adminStudioHtml.indexOf('js/admin-analytics-runtime-controls.js?v=20260405_ANALYTICS_RUNTIME_CONTROLS_1'),
        true,
        'admin-studio.html should load the derived-bundle helper before the runtime-controls helper'
    );
});

test('analytics runtime controls externalize date-range, refresh, and realtime toolbar orchestration out of the main shell', () => {
    const mainAnalyticsSource = readRepoFile('admin-analytics.js');
    const runtimeControlsSource = readRepoFile('js/admin-analytics-runtime-controls.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const helperMarkers = [
        'let autoRefreshInterval = null;',
        'function initDateRangeControls() {',
        'function toggleDateRangeDropdown() {',
        'function initInlineCalendar() {',
        'function renderInlineCalendar() {',
        'async function refreshChartsWithDateRange(days) {',
        'function ensureAnalyticsAutoRefreshState() {',
        'function initRealtimeFeatures() {',
        'async function refreshAllAnalytics(options = {}) {',
        'async function updateOnlineUsers() {',
        'function updateLastUpdateTime() {'
    ];

    for (const marker of helperMarkers) {
        assert.equal(runtimeControlsSource.includes(marker), true, `js/admin-analytics-runtime-controls.js should contain ${marker}`);
    }

    const removedFromMainMarkers = [
        'let autoRefreshInterval = null;',
        'function initDateRangeControls() {',
        'function toggleDateRangeDropdown() {',
        'function initInlineCalendar() {',
        'async function refreshChartsWithDateRange(days) {',
        'function ensureAnalyticsAutoRefreshState() {',
        'function initRealtimeFeatures() {',
        'async function refreshAllAnalytics(options = {}) {',
        'async function updateOnlineUsers() {',
        'function updateLastUpdateTime() {'
    ];

    for (const marker of removedFromMainMarkers) {
        assert.equal(mainAnalyticsSource.includes(marker), false, `admin-analytics.js should no longer contain ${marker}`);
    }

    assert.equal(
        mainAnalyticsSource.includes('// Date-range controls, refresh orchestration, online-user probes, and realtime toolbar helpers'),
        true,
        'admin-analytics.js should leave a shell note for externalized runtime controls'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-runtime-controls.js?v=20260405_ANALYTICS_RUNTIME_CONTROLS_1'),
        true,
        'admin-studio.html should load the analytics runtime-controls helper'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-derived-bundles.js?v=20260405_ANALYTICS_DERIVED_BUNDLES_5') < adminStudioHtml.indexOf('js/admin-analytics-runtime-controls.js?v=20260405_ANALYTICS_RUNTIME_CONTROLS_1'),
        true,
        'admin-studio.html should load the runtime-controls helper after the derived-bundle helper'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-runtime-controls.js?v=20260405_ANALYTICS_RUNTIME_CONTROLS_1') < adminStudioHtml.indexOf('js/admin-analytics-panel-loaders.js?v=20260407_ANALYTICS_PANEL_LOADERS_70'),
        true,
        'admin-studio.html should load the runtime-controls helper before downstream panel loaders'
    );
});

test('analytics lifecycle helper externalizes init, tab routing, tracking, and anomaly hooks out of the main shell', () => {
    const mainAnalyticsSource = readRepoFile('admin-analytics.js');
    const lifecycleSource = readRepoFile('js/admin-analytics-lifecycle.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const helperMarkers = [
        'async function initAnalyticsModule() {',
        'function setupRealtimeSubscriptions() {',
        'function teardownRealtimeSubscriptions() {',
        'function animateKPIIncrement(elementId) {',
        'function setupAnalyticsEvents() {',
        'function switchAnalyticsTab(tabId, options = {}) {',
        'await window.restoreAnalyticsRouteState?.({ focus: true });',
        'function initAnalyticsTabIndicator() {',
        'function destroyAnalyticsCharts() {',
        'async function reloadAnalyticsDashboard() {',
        'function teardownAnalyticsModule() {',
        'const TrackingSDK = {',
        'async function checkForAnomalies() {',
        'function dismissAllAlerts() {',
        'const originalAnalyticsRefresh = refreshAllAnalytics;',
        'productTrendChart,',
        'productTrendChart = null;',
        'loadProductOverview(),',
        'loadProductRankings(),',
        'loadProductHealth(),'
    ];

    for (const marker of helperMarkers) {
        assert.equal(lifecycleSource.includes(marker), true, `js/admin-analytics-lifecycle.js should contain ${marker}`);
    }

    const removedFromMainMarkers = [
        'async function initAnalyticsModule() {',
        'function setupRealtimeSubscriptions() {',
        'function teardownRealtimeSubscriptions() {',
        'function animateKPIIncrement(elementId) {',
        'function setupAnalyticsEvents() {',
        'function switchAnalyticsTab(tabId, options = {}) {',
        'function initAnalyticsTabIndicator() {',
        'function destroyAnalyticsCharts() {',
        'async function reloadAnalyticsDashboard() {',
        'function teardownAnalyticsModule() {',
        'const TrackingSDK = {',
        'async function checkForAnomalies() {',
        'function dismissAllAlerts() {'
    ];

    for (const marker of removedFromMainMarkers) {
        assert.equal(mainAnalyticsSource.includes(marker), false, `admin-analytics.js should no longer contain ${marker}`);
    }

    assert.equal(
        mainAnalyticsSource.includes('// Lifecycle orchestration, tab routing, chart teardown, tracking sdk,'),
        true,
        'admin-analytics.js should leave a shell note for externalized lifecycle orchestration'
    );
    assert.equal(
        lifecycleSource.includes('bindAnalyticsAdvancedWorkspaceToggle();'),
        true,
        'analytics lifecycle helper should bind the advanced workspace toggle during init'
    );
    assert.equal(
        lifecycleSource.includes('loadProductFunnel(),'),
        true,
        'analytics lifecycle helper should refresh the product funnel panel during dashboard reload'
    );
    assert.equal(
        lifecycleSource.includes('loadProductDetailPanel(),'),
        true,
        'analytics lifecycle helper should refresh the product detail panel during dashboard reload'
    );
    assert.equal(
        lifecycleSource.includes("nav.querySelectorAll('.analytics-tab-group__label[data-analytics-tab-group-trigger]').forEach((button) => {"),
        true,
        'analytics lifecycle helper should sync clickable analytics tab-group labels with the active tab'
    );
    assert.equal(
        lifecycleSource.includes("function getAnalyticsScopeConfigForTab(tabId = '', options = {}) {"),
        true,
        'analytics lifecycle helper should define split sidebar scope config for analytics tabs'
    );
    assert.equal(
        lifecycleSource.includes('function getActiveAnalyticsSidebarModuleId() {'),
        true,
        'analytics lifecycle helper should detect the active analytics sidebar scope before resolving tab visibility'
    );
    assert.equal(
        lifecycleSource.includes("function syncAnalyticsTabScope(tabId = '', options = {}) {"),
        true,
        'analytics lifecycle helper should keep analytics tab visibility aligned with the active sidebar scope'
    );
    assert.equal(
        lifecycleSource.includes("button.hidden = !allowedTabs.has(buttonTabId);"),
        true,
        'analytics lifecycle helper should hide tab buttons that do not belong to the active analytics sidebar scope'
    );
    assert.equal(
        lifecycleSource.includes("primaryLabel: '增长经营'") && lifecycleSource.includes("primaryLabel: '商品经营'"),
        true,
        'analytics lifecycle helper should map the growth and commerce scopes to the active analytics tab labels after removing the standalone overview sidebar'
    );
    assert.equal(
        lifecycleSource.includes("primaryTabs: ['overview', 'growth', 'content']"),
        true,
        'analytics lifecycle helper should place overview inside the growth center alongside user growth and content commerce'
    );
    assert.equal(
        lifecycleSource.includes('nav.hidden = allowedTabs.size <= 1;'),
        true,
        'analytics lifecycle helper should hide the top analytics tab rail when the current sidebar only has one page'
    );
    assert.equal(
        lifecycleSource.includes("button.setAttribute('aria-pressed', isActive ? 'true' : 'false');"),
        true,
        'analytics lifecycle helper should keep analytics tab-group label accessibility state in sync'
    );
    assert.equal(
        mainAnalyticsSource.includes('function bindAnalyticsAdvancedWorkspaceToggle() {'),
        true,
        'admin-analytics.js should expose a direct advanced workspace toggle binder'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-lifecycle.js?v=20260407_ANALYTICS_LIFECYCLE_16'),
        true,
        'admin-studio.html should load the analytics lifecycle helper'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-panel-loaders.js?v=20260407_ANALYTICS_PANEL_LOADERS_70') < adminStudioHtml.indexOf('js/admin-analytics-lifecycle.js?v=20260407_ANALYTICS_LIFECYCLE_16'),
        true,
        'admin-studio.html should load the lifecycle helper after the panel-loaders helper'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-lifecycle.js?v=20260407_ANALYTICS_LIFECYCLE_16') < adminStudioHtml.indexOf('js/admin-analytics-workbench.js?v=20260407_ANALYTICS_WORKBENCH_BUNDLE_13'),
        true,
        'admin-studio.html should load the lifecycle helper before downstream workbench helpers'
    );
});

test('admin config runtime renderers externalize poster preview, toggle pulse, save indicator, and verify quota styling', () => {
    const adminConfigSource = readRepoFile('admin-config.js');
    const adminStudioStyles = readRepoFile('admin-studio.css');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const removedRuntimeMarkers = [
        'style="background:${previewBackground};"',
        "toggleEl.style.transform = 'scale(1.1)'",
        "setTimeout(() => toggleEl.style.transform = '', 150);",
        "indicator.style.opacity = '1';",
        "setTimeout(() => indicator.style.opacity = '0', 2000);",
        "badgeEl.style.display = accountsWithEmail.length > 0 ? 'inline-flex' : 'none';",
        "unlockAllBtn.style.display = accountsWithEmail.length > 0 ? 'flex' : 'none';",
        "if (emptyMsg) emptyMsg.style.display = 'flex';",
        "if (emptyMsg) emptyMsg.style.display = 'none';",
        'instance.colorPreview.style.background = color;',
        '<span class="color-swatch" style="background:${value}"></span>',
        'style="background:#6b9ece"',
        "instance.hiddenInput.style.display = 'none';",
        '`<i class=\"fas fa-gem\" style=\"color: ${color};\"></i> <strong style=\"color: ${color};\">${display}</strong>`',
        '`<i class=\"fas fa-exclamation-triangle\" style=\"color: #e74c3c;\"></i> ${data.message || \'查询失败\'}\'',
        '\'<i class="fas fa-exclamation-triangle" style="color: #e74c3c;"></i> 网络错误\''
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(adminConfigSource.includes(marker), false, `admin-config.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        'function pulseAdminConfigToggle(toggleEl)',
        "toggleEl.classList.add(ADMIN_CONFIG_TOGGLE_PULSE_CLASS);",
        'function showAdminConfigSaveIndicator(indicator, text = \'✓ 已保存\', durationMs = 1500)',
        'function getAdminConfigRichTextColorClass(color)',
        'function renderVerifyQuotaState(quotaEl, tone, iconClass, message, options = {})',
        'function getDefaultVerifyMonitorState()',
        'function focusAffiliateSettingsContext(context = {})',
        'instance.hiddenInput.hidden = true;',
        'setAdminConfigHiddenState(badgeEl, accountsWithEmail.length === 0);',
        'class="affiliate-poster-preview ${getAffiliatePosterPreviewClass(preset.id)}"',
        'class="color-swatch ${getAdminConfigRichTextColorClass(value)}"',
        "renderVerifyQuotaState(quotaEl, 'neutral', 'fas fa-spinner fa-spin', '查询中...');",
        "new URL('/api/admin/settings/verify-monitor', window.location.origin)",
        'window.loadVerifyMonitor = loadVerifyMonitor;',
        'window.refreshVerifyMonitor = refreshVerifyMonitor;'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(adminConfigSource.includes(marker), true, `admin-config.js should contain ${marker}`);
    }

    const styleMarkers = [
        '#unlockAllBtn[hidden]',
        '.verify-quota-badge--success',
        '.verify-monitor-grid',
        '.verify-monitor-status-badge--danger',
        '.affiliate-poster-preview--midnight',
        '.affiliate-poster-preview-media',
        '.status-toggle.status-toggle--pulse',
        '.color-swatch--blue'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStudioStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    assert.match(
        adminStudioHtml,
        /admin-studio\.css\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should reference the updated admin stylesheet version'
    );
    assert.match(
        adminStudioHtml,
        /admin-config\.js\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should reference the updated admin config runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('id="lockedCountBadge" hidden'),
        true,
        'admin-studio.html should hide the locked-account badge until runtime data arrives'
    );
    assert.equal(
        adminStudioHtml.includes('id="unlockAllBtn" hidden'),
        true,
        'admin-studio.html should hide the unlock-all action until runtime data arrives'
    );
});

test('prompts gallery UI state renderers externalize toast, banner, nav, and comment visibility styling', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsStyles = readRepoFile('prompts-poetry.css');
    const promptsHtml = readRepoFile('prompts.html');

    const removedRuntimeMarkers = [
        'style="color: ${color.icon}; font-size: 1.2rem;"',
        'Object.assign(toast.style',
        "toast.style.opacity = '1'",
        "loginBtn.style.display = 'none'",
        "unifiedModal.style.setProperty('z-index', '12060', 'important')",
        "banner.style.display = 'flex'",
        'msg.style.cssText =',
        'style="--delay: ${i * 0.03}s"',
        'style="color:#fca5a5;"',
        'style="display:none;"',
        "icon.style.color = '#e74c3c'",
        "icon.style.color = ''",
        "leftArrow.style.display = 'flex'",
        "modal.style.display = 'flex'",
        "if (modal) modal.style.display = 'none'",
        "title.style.cursor = 'pointer'",
        "comment.style.display = 'none'",
        "card.style.transition = 'transform 0.3s ease, opacity 0.3s ease'",
        "card.style.display = 'none'",
        'card.style.animationDelay =',
        'shield.style.cssText =',
        'shield.style.height = expanded',
        "shield.style.visibility = 'visible'",
        "shield.style.opacity = '1'",
        "probe.style.position = 'fixed'",
        "el.style.width = '4px'",
        "el.style.fontSize = '8px'",
        "el.style.backgroundColor = CONFIG.color",
        "modalInner.style.setProperty('--prompt-modal-scale', '1')",
        "modalInner.style.setProperty('--prompt-modal-translate-y', '-24px')",
        "backdrop.style.setProperty('height',",
        "modal.style.setProperty('height',",
        "sheet.style.setProperty('height',",
        "overlay.style.setProperty('--composer-keyboard-offset',",
        "sheet.style.removeProperty('max-height')",
        "document.documentElement.style.overflow = 'hidden'",
        "document.body.style.overflow = 'hidden'",
        'style="${svgStyle}"',
        'style="overflow:visible;"',
        'style="stop-color:#ffe6ea;stop-opacity:1"',
        'style="left:${left}%; top:${top}%; width:${size}px; height:${size}px;',
        'style="left:${left}%;animation-delay:${delay.toFixed(2)}s;',
        "container.style.setProperty('--cursor-x'",
        "card.style.setProperty('--breathe-delay'",
        "textarea.style.height = 'auto'"
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(promptsSource.includes(marker), false, `prompts-poetry.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        'gallery-toast--visible',
        "setPromptsDisplayState(loginBtn, false, 'prompts-display-flex')",
        'buildPromptsStaggerClass(i)',
        "const { format = 'avif' } = options;",
        "url.includes('supabase.co/storage/v1/object/public/prompt-images/')",
        "'/storage/v1/render/image/public/'",
        "optimizedUrl.searchParams.set('width', '360');",
        "optimizedUrl.searchParams.set('height', '270');",
        "optimizedUrl.searchParams.set('quality', '80');",
        "optimizedUrl.searchParams.set('format', format);",
        "optimizedUrl.searchParams.delete('format');",
        'const PROMPT_GALLERY_SKELETON_COUNT = 8;',
        'const PROMPT_NAV_SKELETON_COUNT = 8;',
        'const PROMPT_GALLERY_EAGER_IMAGE_COUNT = 4;',
        'function buildPromptCardSkeletonMarkup(index = 0) {',
        'function buildPromptNavSkeletonMarkup(count = PROMPT_NAV_SKELETON_COUNT) {',
        'function renderPromptNavSkeletons(count = PROMPT_NAV_SKELETON_COUNT) {',
        'function renderPromptGallerySkeletons(count = PROMPT_GALLERY_SKELETON_COUNT) {',
        'function warmPromptGalleryLeadImages(items = []) {',
        'function setPromptCardImageSource(cardImage, originalUrl) {',
        "const primaryUrl = getOptimizedImageUrl(originalUrl);",
        "const transformFallbackUrl = getOptimizedImageUrl(originalUrl, { format: '' });",
        "cardImage.dataset.transformFallbackSrc = transformFallbackUrl !== primaryUrl ? transformFallbackUrl : '';",
        "if (optimizedUrl.includes('supabase.co/storage/v1/render/image/public/')) return;",
        'const commentRequestCache = new Map();',
        'function invalidatePromptCommentsCache(promptId, site = getPromptInteractionSite()) {',
        'async function loadPromptCommentsData(promptId, forceRefresh = false) {',
        'function prefetchComments(promptId, forceRefresh = false) {',
        'const promptCommentCountCache = new Map();',
        'function getCachedPromptCommentCount(promptId, site = getPromptInteractionSite()) {',
        'function applyPromptCommentCount(promptId, count = null) {',
        'async function preloadPromptCommentCounts(forceRefresh = false) {',
        'renderPromptNavSkeletons();',
        "navContainer.classList.add('nav-items--hydrated');",
        'warmPromptGalleryLeadImages(itemsToLoad);',
        "card.className = 'prompt-card card-enter prompt-card--loading';",
        'const shouldLoadImageEagerly = index < PROMPT_GALLERY_EAGER_IMAGE_COUNT;',
        "card.classList.add('prompt-card--loaded');",
        "cardImage.fetchPriority = shouldLoadImageEagerly ? 'high' : 'auto';",
        'setPromptCardImageSource(cardImage, item.images[0]);',
        "cardImage.dataset.fallbackStage = 'transform';",
        "cardImage.dataset.fallbackStage = 'original';",
        'void preloadPromptCommentCounts();',
        'void prefetchComments(currentPromptId);',
        'featured-banner--revealed',
        'search-cooldown-msg',
        'comment-empty-subtitle comment-empty-subtitle--error',
        "button.classList.add('liked')",
        "leftArrow.classList.add('is-visible')",
        "modal.classList.add('poetry-modal--visible')",
        "comment.classList.toggle('hidden-collapsed', shouldHide)",
        'class="prompts-comment-image-upload-hidden"',
        'hidePromptCard(card, true)',
        'showPromptCard(card, visibleIndex)',
        'setPromptCardStaggerClass(card, index)',
        "shield.classList.add('prompt-status-bar-shield--active')",
        "probe.className = 'prompt-comment-composer-viewport-probe'",
        "applyPromptsThemeParticleClasses(el, 'prompts-theme-particle--spark'",
        "applyPromptsThemeParticleClasses(el, 'prompts-theme-particle--rain'",
        "applyPromptsThemeParticleClasses(el, ['prompts-theme-particle--decor', 'prompts-theme-particle--decor-svg']",
        'setPromptsCssVars(modalInner, {',
        'setPromptsCssVars(backdrop, {',
        'setPromptsCssVars(modal, {',
        'setPromptsCssVars(overlay, {',
        'setPromptsCssVars(sheet, {',
        'getPromptsPageOverflowState()',
        "setPromptsPageOverflow('hidden')",
        'setPromptsPercentPosition(heart, initialPos.x, initialPos.y)',
        'applyPromptsTextareaAutoHeight(textarea, maxHeight)',
        'resetPromptsTextareaAutoHeight(input)',
        'hydrateDecorationParticleStyles(root)',
        'data-left="${left.toFixed(2)}"',
        "setPromptsCssVars(container, {",
        "setPromptsCssVars(card, {"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.gallery-toast',
        '.gallery-toast--visible',
        '@keyframes promptSkeletonShimmer',
        '.prompts-display-flex',
        '.prompts-nav-transition',
        '.nav-items.nav-items--skeleton',
        '.nav-items.nav-items--hydrated',
        '.nav-item.nav-item--skeleton',
        '.nav-item-skeleton--title-wide',
        '.featured-banner--revealed',
        '.prompts-pagination-nav',
        '.search-cooldown-msg',
        '.comment-header-title--expandable',
        '.comment-empty-subtitle--error',
        '.modal-img-nav.is-visible',
        '.poetry-modal.poetry-modal--visible',
        '.comment-count.comment-count--hidden',
        '.prompt-card--skeleton',
        '.prompt-card-media-skeleton',
        '.prompt-card--loaded .prompt-card-media-skeleton',
        '.prompt-card-skeleton-title--wide',
        '.prompt-card-skeleton-dot',
        '.prompt-card.prompt-card-exiting',
        '.prompt-card.card-visible.prompt-card-stagger-11',
        '.prompt-status-bar-shield',
        '.prompt-status-bar-shield.prompt-status-bar-shield--visible',
        '.prompt-comment-composer-viewport-probe',
        '.prompts-theme-particle--spark',
        '.prompts-theme-particle--rain',
        '.prompts-theme-particle--snow',
        '.prompts-theme-particle--decor',
        '.decoration-svg',
        '.decoration-svg--overflow-visible'
    ];

    for (const marker of styleMarkers) {
        assert.equal(promptsStyles.includes(marker), true, `prompts-poetry.css should contain ${marker}`);
    }

    assert.equal(
        promptsHtml.includes('prompts-poetry.css?v=20260402_PROMPTS_NAV_STABILITY_1'),
        true,
        'prompts.html should load the latest prompts gallery stylesheet version'
    );
    assert.equal(
        promptsHtml.includes('./js/user-event-tracker.js?v=20260405_USER_EVENT_TRACKER_2'),
        true,
        'prompts.html should load the shared user event tracker'
    );
    assert.equal(
        promptsHtml.includes('prompts-poetry.js?v=20260405_PROMPTS_RUNTIME_TRACKING_1'),
        true,
        'prompts.html should load the latest prompts gallery runtime version'
    );
});

test('shared user event tracker wires prompt, verify, and wallet conversion events', () => {
    const trackerSource = readRepoFile('js/user-event-tracker.js');
    const promptsSource = readRepoFile('prompts-poetry.js');
    const verifyWidgetSource = readRepoFile('verify-widget.js');
    const walletSource = readRepoFile('js/components/WalletModal.js');
    const shopClientSource = readRepoFile('js/shop-client.js');
    const guestbookSupabaseSource = readRepoFile('supabase-guestbook-functions.js');
    const injectAuthSource = readRepoFile('inject-auth.js');
    const indexSource = readRepoFile('index.html');
    const archivedIndexSource = readRepoFile('index_old.html');
    const guestbookSource = readRepoFile('guestbook.html');
    const shopSource = readRepoFile('shop.html');
    const verifyPageSource = readRepoFile('verify.html');

    const trackerMarkers = [
        'window.UserEventTracker = trackerApi;',
        "async track(eventName, payload = {}, options = {})",
        "async pageView(payload = {})",
        "async heartbeat(payload = {})",
        ".from('user_events').insert(payload)",
        "rpc('track_event'"
    ];

    for (const marker of trackerMarkers) {
        assert.equal(trackerSource.includes(marker), true, `js/user-event-tracker.js should contain ${marker}`);
    }

    const promptsMarkers = [
        "trackPromptAnalyticsEvent('prompt_view'",
        "trackPromptAnalyticsEvent('unlock_click'",
        "trackPromptAnalyticsEvent('unlock_success'",
        "WalletModal.open('recharge', {"
    ];

    for (const marker of promptsMarkers) {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should contain ${marker}`);
    }

    const verifyMarkers = [
        "trackVerifyAnalyticsEvent('verify_submit'",
        "trackVerifyAnalyticsEvent('verify_success'",
        "trackVerifyAnalyticsEvent('verify_fail'",
        "window.WalletModal?.open?.('balance', {"
    ];

    for (const marker of verifyMarkers) {
        assert.equal(verifyWidgetSource.includes(marker), true, `verify-widget.js should contain ${marker}`);
    }

    const walletMarkers = [
        "trackWalletAnalyticsEvent('wallet_open'",
        "trackWalletAnalyticsEvent('recharge_click'",
        "trackWalletAnalyticsEvent('recharge_success'",
        "trackWalletAnalyticsEvent('affiliate_invite_click'",
        "trackWalletAnalyticsEvent('checkin_success'",
        'lastOpenContext: null,'
    ];

    for (const marker of walletMarkers) {
        assert.equal(walletSource.includes(marker), true, `js/components/WalletModal.js should contain ${marker}`);
    }

    const shopMarkers = [
        "trackShopAnalyticsEvent('product_card_click'",
        "trackShopAnalyticsEvent('shop_view'",
        "trackShopAnalyticsEvent('product_detail_view'",
        "trackShopAnalyticsEvent('product_purchase_click'",
        "trackShopAnalyticsEvent('shop_purchase'",
        "trackShopAnalyticsEvent('product_purchase_success'",
        'metadata.source_page = normalizedSourcePage;',
        'metadata.source_channel = normalizedSourceChannel;',
        'metadata.source_prompt_id = normalizedSourcePromptId;',
        'buyButton.dataset.productCategory = String(p.category || \'\');'
    ];

    for (const marker of shopMarkers) {
        assert.equal(shopClientSource.includes(marker), true, `js/shop-client.js should contain ${marker}`);
    }

    const removedMarkers = [
        'getExperimentAssignment',
        'setTrafficRuntimeEnabled',
        'refreshTrafficRuntimeDefault',
        '__ZAOYOE_TRAFFIC_RUNTIME_DEFAULT_ENABLED__',
        '__ZAOYOE_EXPERIMENT_RUNTIME_DEFAULT_ENABLED__',
        'applyPromptUnlockExperiment(',
        'getPromptUnlockExperimentTrackingPayload(',
        'applyVerifySubmitExperiment(',
        'getVerifySubmitExperimentTrackingPayload(',
        'applyCustomRechargeExperiment(',
        'getCustomRechargeExperimentTrackingPayload(',
        'applyPurchaseModalExperiment(',
        'getPurchaseExperimentTrackingPayload('
    ];

    for (const marker of removedMarkers) {
        assert.equal(
            trackerSource.includes(marker)
            || promptsSource.includes(marker)
            || verifyWidgetSource.includes(marker)
            || walletSource.includes(marker)
            || shopClientSource.includes(marker),
            false,
            `tracker and consumer runtime code should no longer contain ${marker}`
        );
    }

    const guestbookMarkers = [
        "trackGuestbookAnalyticsEvent('guestbook_post'",
        "entry: (window.location.pathname === '/' || window.location.pathname === '/index.html')"
    ];

    for (const marker of guestbookMarkers) {
        assert.equal(guestbookSupabaseSource.includes(marker), true, `supabase-guestbook-functions.js should contain ${marker}`);
    }

    assert.equal(injectAuthSource.includes("entry: 'nav_wallet'"), true, 'inject-auth.js should tag wallet opens from the auth dropdown');
    assert.equal(indexSource.includes('./js/user-event-tracker.js?v=20260405_USER_EVENT_TRACKER_2'), true, 'index.html should load the shared user event tracker');
    assert.equal(guestbookSource.includes('js/user-event-tracker.js?v=20260405_USER_EVENT_TRACKER_2'), true, 'guestbook.html should load the shared user event tracker');
    assert.equal(shopSource.includes('js/user-event-tracker.js?v=20260405_USER_EVENT_TRACKER_2'), true, 'shop.html should load the shared user event tracker');
    assert.equal(indexSource.includes('./supabase-guestbook-functions.js?v=20260404_GUESTBOOK_PHASE3_EVENTS_1'), true, 'index.html should load the phase 3 guestbook runtime');
    assert.equal(guestbookSource.includes('./supabase-guestbook-functions.js?v=20260404_GUESTBOOK_PHASE3_EVENTS_1'), true, 'guestbook.html should load the phase 3 guestbook runtime');
    assert.equal(archivedIndexSource.includes('./supabase-guestbook-functions.js?v=20260404_GUESTBOOK_PHASE3_EVENTS_1'), true, 'index_old.html should load the phase 3 guestbook runtime');
    assert.equal(shopSource.includes('js/shop-client.js?v=20260405_SHOP_RUNTIME_TRACKING_2'), true, 'shop.html should load the latest tracking-aware shop runtime');
    assert.equal(archivedIndexSource.includes('./js/shop-client.js?v=20260405_SHOP_RUNTIME_TRACKING_2'), true, 'index_old.html should load the latest tracking-aware shop runtime');
    assert.equal(verifyPageSource.includes('js/components/WalletModal.js?v=20260405_WALLET_RUNTIME_TRACKING_1'), true, 'verify.html should load the latest tracking-aware wallet modal runtime');
});

test('analytics phase 3 prefers real event rpc v2 for ai summary and conversion funnel', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const panelSupportBundleSource = readRepoFile('server/api-handlers/admin/analytics/panel-support-bundle.js');
    const visualPanelBundleSource = readRepoFile('server/api-handlers/admin/analytics/visual-panel-bundle.js');
    const analyticsSummarySql = readRepoFile('supabase/analytics_site_filter.sql');
    const analyticsAdvancedSql = readRepoFile('supabase/analytics_advanced_site_filter.sql');
    const migrationSource = readRepoFile('supabase/migrations/20260404_admin_analytics_phase3_event_rpc_v2.sql');
    const drilldownMigrationSource = readRepoFile('supabase/migrations/20260404_admin_analytics_phase3_drilldown_v2.sql');

    const analyticsMarkers = [
        "callAnalyticsRpcWithFallback('get_ai_summary_data_v2'",
        "callAnalyticsRpcWithFallback('get_points_flow_v2'",
        'buildAnalyticsEventDrivenRecommendations(data = null)',
        'getAnalyticsSummaryContextBundle({',
        'site_comparison:',
        'applyAnalyticsDestinationSiteContext(normalizedContext);',
        'buildCommerceEventFunnelViewData(summaryWindow)',
        'buildVerifyEventFunnelViewData(summaryWindow)',
        'buildGrowthEventFunnelViewData(summaryWindow)',
        'function getAnalyticsSummaryWindowEventOverview(summaryWindow = {}) {',
        'function enrichVerifyServiceSummaryWithEvents(summary = {}, summaryWindow = {}) {',
        'function enrichGrowthSummaryWithEvents(summary = {}, summaryWindow = {}) {',
        '真实行为摘要：',
        '真实行为漏斗：'
    ];

    for (const marker of analyticsMarkers) {
        assert.equal(analyticsSource.includes(marker), true, `admin-analytics.js should contain ${marker}`);
    }

    const bundleMarkers = [
        "callRpcWithFallback(supabase, 'get_conversion_funnel_v2'",
        "callRpcWithFallback(supabase, 'get_channel_breakdown_v2'",
        "callRpcWithFallback(supabase, 'get_content_top_v2'"
    ];

    for (const marker of bundleMarkers) {
        assert.equal(
            visualPanelBundleSource.includes(marker) || panelSupportBundleSource.includes(marker),
            true,
            `analytics bundle handlers should contain ${marker}`
        );
    }

    assert.equal(
        visualPanelBundleSource.includes("callRpcWithFallback(supabase, 'get_conversion_funnel'"),
        false,
        'analytics visual panel bundle should no longer call the legacy proxy conversion funnel rpc'
    );

    const sqlMarkers = [
        'CREATE OR REPLACE FUNCTION get_ai_summary_data_v2',
        'CREATE OR REPLACE FUNCTION get_conversion_funnel_v2',
        'CREATE OR REPLACE FUNCTION get_channel_breakdown_v2',
        'CREATE OR REPLACE FUNCTION get_content_top_v2',
        'CREATE OR REPLACE FUNCTION get_points_flow_v2',
        "'event_overview'",
        "'event_funnels'",
        "'Prompt 浏览'::TEXT"
    ];

    for (const marker of sqlMarkers) {
        assert.equal(
            analyticsSummarySql.includes(marker)
            || analyticsAdvancedSql.includes(marker)
            || migrationSource.includes(marker)
            || drilldownMigrationSource.includes(marker),
            true,
            `phase 3 analytics sql should contain ${marker}`
        );
    }
});

test('analytics date range alignment keeps inclusive day math and explicit start/end rpc params', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const analyticsSummarySql = readRepoFile('supabase/analytics_site_filter.sql');
    const analyticsAdvancedSql = readRepoFile('supabase/analytics_advanced_site_filter.sql');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const frontendMarkers = [
        'const ANALYTICS_DAY_MS = 24 * 60 * 60 * 1000;',
        'function getAnalyticsRangeDayDiff(startDate, endDate) {',
        'function buildAnalyticsPresetRange(days = DEFAULT_ANALYTICS_DAYS, anchorDate = new Date()) {',
        'params.p_start_date = normalizedStartDate;',
        'params.p_end_date = normalizedEndDate;',
        "query = applyAnalyticsTimeRange(query, 'created_at');",
        "query.set('startDate', startIso);",
        "query.set('endDate', endIso);",
        'async function fetchUserTrendData(days = getAnalyticsRangeDays(30)) {',
        "segmentKey: 'userTrend',",
        "segmentKey: 'contentTrend',",
        "segmentKey: 'revenueTrend',",
        "segmentKey: 'activityHeatmap',",
        "segmentKey: 'communityStats',",
        "segmentKey: 'redemptionFunnel',"
    ];

    for (const marker of frontendMarkers) {
        assert.equal(analyticsSource.includes(marker), true, `admin-analytics.js should contain ${marker}`);
    }

    const sqlMarkers = [
        'p_start_date DATE DEFAULT NULL',
        'p_end_date DATE DEFAULT NULL',
        'BETWEEN v_start_date AND v_end_date',
        'GRANT EXECUTE ON FUNCTION get_user_trend(INTEGER, VARCHAR, DATE, DATE) TO authenticated;',
        'GRANT EXECUTE ON FUNCTION get_conversion_funnel_v2(INTEGER, VARCHAR, DATE, DATE) TO authenticated;'
    ];

    for (const marker of sqlMarkers) {
        assert.equal(
            analyticsSummarySql.includes(marker) || analyticsAdvancedSql.includes(marker),
            true,
            `analytics range alignment sql should contain ${marker}`
        );
    }

    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics range alignment runtime version'
    );
});

test('analytics rpc date params keep local calendar days instead of utc-splitting them', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();

    const markers = [
        'function formatAnalyticsLocalDate(date) {',
        "const year = date.getFullYear();",
        "const month = String(date.getMonth() + 1).padStart(2, '0');",
        "const day = String(date.getDate()).padStart(2, '0');",
        'return `${year}-${month}-${day}`;',
        'return formatAnalyticsLocalDate(date);'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `admin-analytics.js should contain ${marker}`);
    }

    assert.equal(
        analyticsSource.includes("return date ? date.toISOString().split('T')[0] : null;"),
        false,
        'admin-analytics.js should no longer derive rpc date params by utc-splitting ISO strings'
    );
});

test('analytics site attribution alignment keeps new-user and retention semantics consistent per site', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const analyticsSummarySql = readRepoFile('supabase/analytics_site_filter.sql');
    const analyticsAdvancedSql = readRepoFile('supabase/analytics_advanced_site_filter.sql');
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const migrationSource = readRepoFile('supabase/migrations/20260405_admin_analytics_site_attribution_alignment.sql');

    const frontendMarkers = [
        'function getAnalyticsNewUsersLabels(site = getAnalyticsSiteParam()) {',
        'function getAnalyticsNewUsersTooltip(overview = {}, site = getAnalyticsSiteParam()) {',
        'function syncAnalyticsNewUsersContext(overview = {}) {',
        "label: getAnalyticsNewUsersLabels().seriesLabel",
        "const newUsersLabel = getAnalyticsNewUsersLabels().weekLabel;",
        'site_attributed_new_users_today',
        'unattributed_new_users_week'
    ];

    for (const marker of frontendMarkers) {
        assert.equal(analyticsSource.includes(marker), true, `admin-analytics.js should contain ${marker}`);
    }

    const sqlMarkers = [
        "'site_attribution_model', 'first_site_activity'",
        'COUNT(*) FILTER (WHERE attributed_site = p_site)::INTEGER',
        'WHERE p_site IS NULL OR ac.attributed_site = p_site'
    ];

    for (const marker of sqlMarkers) {
        assert.equal(
            analyticsSummarySql.includes(marker)
            || analyticsAdvancedSql.includes(marker)
            || migrationSource.includes(marker),
            true,
            `analytics site attribution sql should contain ${marker}`
        );
    }

    assert.equal(adminStudioHtml.includes('id="kpiNewUsersLabel"'), true, 'admin-studio.html should expose a dedicated new-users label hook');
    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics site attribution runtime version'
    );
});

test('analytics active user semantics prefer business events while preserving login references', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const analyticsSummarySql = readRepoFile('supabase/analytics_site_filter.sql');
    const migrationSource = readRepoFile('supabase/migrations/20260405_admin_analytics_business_active_alignment.sql');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const frontendMarkers = [
        'function getAnalyticsActiveUserLabels() {',
        'function getAnalyticsActiveUsersTooltip(overview = {}) {',
        'function syncAnalyticsActiveUsersContext(overview = {}) {',
        'label: activeUserLabels.seriesLabel',
        "return `登录活跃参考: ${formatNumber(loginActiveUsers)}`;",
        '业务日活 (DAU)',
        '登录日活参考'
    ];

    for (const marker of frontendMarkers) {
        assert.equal(analyticsSource.includes(marker) || adminStudioHtml.includes(marker), true, `active user semantics should contain ${marker}`);
    }

    const sqlMarkers = [
        "'active_users_scope', 'business_event'",
        "'active_users_model', 'effective_business_event'",
        'login_active_users INTEGER',
        'COUNT(DISTINCT user_id) FILTER (WHERE event_name <> \'page_view\') AS business_active_users',
        "'login_dau_growth'"
    ];

    for (const marker of sqlMarkers) {
        assert.equal(
            analyticsSummarySql.includes(marker) || migrationSource.includes(marker),
            true,
            `analytics active-user sql should contain ${marker}`
        );
    }

    assert.equal(adminStudioHtml.includes('id="kpiDauLabel"'), true, 'admin-studio.html should expose a dedicated DAU label hook');
    assert.equal(adminStudioHtml.includes('id="userTrendMeta"'), true, 'admin-studio.html should expose a dedicated user trend note hook');
    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics active-user runtime version'
    );
});

test('analytics proxy metric annotations label real-vs-proxy reference panels explicitly', () => {
    const analyticsSource = readAdminAnalyticsMetricContextSource();
    const analyticsSummarySql = readRepoFile('supabase/analytics_site_filter.sql');
    const analyticsAdvancedSql = readRepoFile('supabase/analytics_advanced_site_filter.sql');
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const adminStudioStyles = readRepoFile('admin-studio.css');
    const migrationSource = readRepoFile('supabase/migrations/20260405_admin_analytics_proxy_metric_annotations.sql');
    const heatmapMigrationSource = readRepoFile('supabase/migrations/20260405_admin_analytics_heatmap_business_event_alignment.sql');
    const retentionMigrationSource = readRepoFile('supabase/migrations/20260405_admin_analytics_retention_business_activity_alignment.sql');
    const retentionCleanupMigrationSource = readRepoFile('supabase/migrations/20260405_admin_analytics_retention_remove_login_fallback.sql');

    const frontendMarkers = [
        'function getAnalyticsMetricMeta(source, fallback = {}) {',
        'function renderAnalyticsMetricHint(source, options = {}) {',
        '真实业务事件热度',
        '当前数据库仍在返回旧登录热力图，请执行最新 heatmap migration 后切到真实业务事件热度。',
        '当前热力图按真实业务事件绘制，适合观察浏览、解锁、验证、充值等行为高峰。',
        '当前漏斗按 Prompt 浏览、解锁点击、内容解锁三段真实事件计算。',
        '首站点归因 cohort + 真实业务回访',
        '当前留存按首站点归因 cohort + 真实业务事件回访计算，更接近真实复访质量。',
        '当前数据库仍在返回旧登录留存，请执行最新 retention migration 后切到真实业务回访留存。',
        'id="activityHeatmapMeta"',
        'id="conversionFunnelMeta"',
        'id="retentionCohortMeta"'
    ];

    for (const marker of frontendMarkers) {
        assert.equal(
            analyticsSource.includes(marker) || adminStudioHtml.includes(marker),
            true,
            `analytics proxy metric annotations should contain ${marker}`
        );
    }

    const cssMarkers = [
        '.analytics-proxy-hint {',
        '.analytics-proxy-hint--real {'
    ];

    for (const marker of cssMarkers) {
        assert.equal(adminStudioStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    const sqlMarkers = [
        'is_proxy_metric BOOLEAN',
        'metric_basis TEXT',
        'metric_label TEXT',
        'effective_business_event_heatmap',
        '真实业务事件热度',
        'login_history',
        '登录活跃代理口径',
        'site_attributed_cohort_effective_business_activity',
        '首站点归因 cohort + 真实业务回访',
        'site_attributed_cohort_login_activity',
        '首站点归因 cohort + 登录回访代理口径'
    ];

    for (const marker of sqlMarkers) {
        assert.equal(
            analyticsSummarySql.includes(marker)
            || analyticsAdvancedSql.includes(marker)
            || migrationSource.includes(marker)
            || heatmapMigrationSource.includes(marker)
            || retentionMigrationSource.includes(marker),
            true,
            `analytics proxy metric sql should contain ${marker}`
        );
    }

    assert.equal(
        retentionCleanupMigrationSource.includes('site_attributed_cohort_login_activity'),
        false,
        'retention cleanup migration should remove the login-based retention fallback basis'
    );

    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-metric-context.js?v=20260405_ANALYTICS_METRIC_CONTEXT_HELPERS_6'),
        true,
        'admin-studio.html should reference the latest analytics metric-context helper runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics metric-context runtime version'
    );
});

test('analytics metric context reaches exports and ai prompt guardrails', () => {
    const analyticsSource = readAdminAnalyticsMetricContextSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'async function fetchAnalyticsPanelMetricContext(days = getAnalyticsRangeDays(30), weeks = getAnalyticsCohortWeeks(days)) {',
        'function buildAnalyticsMetricContextRows({ overview = {}, panelMetricContext = {} } = {}) {',
        "panel_metric_context: supportBundle.panelMetricContext || {}",
        '指标口径说明（请严格区分真实事件和代理参考',
        'const metricContextRows = buildAnalyticsMetricContextRows({',
        'metricContextRows,',
        "csv += '=== 指标口径 ===\\n';",
        "csv += '板块,指标口径,类型,依据,说明\\n';",
        "XLSX.utils.book_append_sheet(wb, metricContextSheet, '指标口径');",
        "'板块': panel || '未分类'",
        "'类型': type || '混合口径'"
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics export and ai metric context should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics export/ai metric context runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-export-builders.js?v=20260405_ANALYTICS_EXPORT_BUILDERS_1'),
        true,
        'admin-studio.html should reference the latest analytics export-builder runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-state.js?v=20260405_ANALYTICS_AI_STATE_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-state runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-helpers.js?v=20260405_ANALYTICS_AI_HELPERS_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-helper runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-prompt-builders.js?v=20260405_ANALYTICS_AI_PROMPT_BUILDERS_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-prompt-builder runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-controller.js?v=20260405_ANALYTICS_AI_CONTROLLER_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-controller runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should reference the latest analytics ai/export helper runtime version'
    );
});

test('analytics metric context also constrains local insights and action cards', () => {
    const analyticsSource = readAdminAnalyticsMetricContextSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'function getAnalyticsMetricContextRowsFromData(data = null) {',
        'function getAnalyticsProxyMetricContextRows(data = null) {',
        'function buildAnalyticsMetricContextObserveItem(data = null) {',
        'function renderAnalyticsMetricContextNotice(data = null) {',
        '代理参考面板需要结合真实事件复核',
        '部分分析面板仍是代理参考口径',
        '口径提醒：',
        '需要做严格结论时，先看真实交易、验证和增长事件面板',
        'Metric Context',
        '当前窗口存在代理参考指标',
        '回看代理面板'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics local insight metric-context guardrails should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics local-insight metric-context runtime version'
    );
});

test('analytics summary context bundle reuses panel metric and comparison fetches across ai and export', () => {
    const analyticsSource = readAdminAnalyticsMetricContextSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'summaryWindowBundle: null,',
        'panelMetricContext: null,',
        'summaryContextBundle: null,',
        'analyticsDerivedState.summaryWindowBundle = null;',
        'analyticsDerivedState.panelMetricContext = null;',
        'analyticsDerivedState.summaryContextBundle = null;',
        'function buildAnalyticsSummaryWindowBundleQuery(options = {}) {',
        'async function getAnalyticsSummaryWindowBundle(options = {}) {',
        "'analytics/summary-window-bundle'",
        'function getAnalyticsSummaryWindowBundleSegment(bundle = null, key = \'\') {',
        'function normalizeAnalyticsSummaryWindowSiteKey(site = null) {',
        'function getAnalyticsSummaryWindowBundleSegmentSummary(bundle = null, key = \'\') {',
        "function createAnalyticsSummaryWindowBundleSegmentError(segment = null, fallbackMessage = 'Analytics summary window bundle segment failed') {",
        'async function loadAnalyticsSummaryWindowBundleForSelection(options = {}) {',
        'async function resolveAnalyticsSummaryWindowSiteSummary(site = null, options = {}) {',
        "panelMetricContext: getAnalyticsDerivedStateValue('panelMetricContext'),",
        "summaryContextBundle: getAnalyticsDerivedStateValue('summaryContextBundle')",
        'async function getAnalyticsPanelMetricContextData(options = {}) {',
        'async function getAnalyticsSummaryContextBundle(options = {}) {',
        'async function getAnalyticsSummaryWindowData(options = {}) {',
        'async function getAnalyticsSiteComparisonData(options = {}) {',
        "return runAnalyticsDerivedRequest(",
        "'summaryWindowBundle',",
        "'summaryContextBundle',",
        'const summaryContextBundle = summaryContextBundleResult.status === \'fulfilled\' && summaryContextBundleResult.value',
        'const selectedSiteKey = normalizeAnalyticsSummaryWindowSiteKey(getAnalyticsSiteParam());',
        'const bundle = await loadAnalyticsSummaryWindowBundleForSelection({',
        'return resolveAnalyticsSummaryWindowSiteSummary(selectedSiteKey, {',
        "const summaryWindowBundle = await loadAnalyticsSummaryWindowBundleForSelection({",
        "resolveAnalyticsSummaryWindowSiteSummary('cn', {",
        "resolveAnalyticsSummaryWindowSiteSummary('intl', {",
        'getAnalyticsSummaryContextBundle({',
        'const summaryContextBundle = supportBundle.summaryContextBundle || {};',
        'panelMetricContext,',
        'metricContextRows'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics summary context bundle should contain ${marker}`);
    }

    const removedMarkers = [
        'async function fetchAnalyticsSummaryWindowBundleForSite(site = null, options = {}) {'
    ];

    for (const marker of removedMarkers) {
        assert.equal(analyticsSource.includes(marker), false, `analytics summary context bundle should no longer contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-metric-context.js?v=20260405_ANALYTICS_METRIC_CONTEXT_HELPERS_6'),
        true,
        'admin-studio.html should reference the latest analytics helper runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics summary-context-bundle runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-workbench.js?v=20260407_ANALYTICS_WORKBENCH_BUNDLE_13'),
        true,
        'admin-studio.html should reference the latest analytics workbench helper runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-export-builders.js?v=20260405_ANALYTICS_EXPORT_BUILDERS_1'),
        true,
        'admin-studio.html should reference the latest analytics export-builder helper runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-state.js?v=20260405_ANALYTICS_AI_STATE_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-state runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-helpers.js?v=20260405_ANALYTICS_AI_HELPERS_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-helper runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-prompt-builders.js?v=20260405_ANALYTICS_AI_PROMPT_BUILDERS_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-prompt-builder runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-controller.js?v=20260405_ANALYTICS_AI_CONTROLLER_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-controller runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-insight-cards.js?v=20260407_ANALYTICS_INSIGHT_CARDS_HELPERS_5'),
        true,
        'admin-studio.html should reference the latest analytics insight-card helper runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should reference the latest analytics ai/export helper runtime version'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-metric-context.js?v=20260405_ANALYTICS_METRIC_CONTEXT_HELPERS_6') < adminStudioHtml.indexOf('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should load the analytics metric-context helpers before the main analytics runtime'
    );
    assert.equal(
        adminStudioHtml.indexOf('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8') < adminStudioHtml.indexOf('js/admin-analytics-workbench.js?v=20260407_ANALYTICS_WORKBENCH_BUNDLE_13'),
        true,
        'admin-studio.html should load the analytics workbench helper after the main analytics runtime'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-workbench.js?v=20260407_ANALYTICS_WORKBENCH_BUNDLE_13') < adminStudioHtml.indexOf('js/admin-analytics-insight-cards.js?v=20260407_ANALYTICS_INSIGHT_CARDS_HELPERS_5'),
        true,
        'admin-studio.html should load the analytics insight-card helper after the workbench helper'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-insight-cards.js?v=20260407_ANALYTICS_INSIGHT_CARDS_HELPERS_5') < adminStudioHtml.indexOf('js/admin-analytics-ai-state.js?v=20260405_ANALYTICS_AI_STATE_1'),
        true,
        'admin-studio.html should load the analytics ai-state layer after the insight-card helper'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-state.js?v=20260405_ANALYTICS_AI_STATE_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-helpers.js?v=20260405_ANALYTICS_AI_HELPERS_1'),
        true,
        'admin-studio.html should load the analytics ai helpers after the insight-card helper'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-helpers.js?v=20260405_ANALYTICS_AI_HELPERS_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-prompt-builders.js?v=20260405_ANALYTICS_AI_PROMPT_BUILDERS_1'),
        true,
        'admin-studio.html should load the analytics ai-prompt builders after the ai helpers'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-prompt-builders.js?v=20260405_ANALYTICS_AI_PROMPT_BUILDERS_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-controller.js?v=20260405_ANALYTICS_AI_CONTROLLER_1'),
        true,
        'admin-studio.html should load the analytics ai-controller after the ai-prompt builders'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-controller.js?v=20260405_ANALYTICS_AI_CONTROLLER_1') < adminStudioHtml.indexOf('js/admin-analytics-export-builders.js?v=20260405_ANALYTICS_EXPORT_BUILDERS_1'),
        true,
        'admin-studio.html should load the analytics export-builder helper after the ai-controller'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-export-builders.js?v=20260405_ANALYTICS_EXPORT_BUILDERS_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should load the analytics ai/export helpers after the main analytics runtime'
    );
});

test('analytics admin snapshot bundle consolidates admin summary fetches for operations, comments, and verify', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'adminSnapshotBundle: null,',
        'analyticsDerivedState.adminSnapshotBundle = null;',
        'async function getAnalyticsAdminSnapshotBundle(options = {}) {',
        "'adminSnapshotBundle',",
        "'analytics/snapshot-bundle'",
        "const bundleSegment = getAnalyticsSnapshotBundleSegment(bundle, 'comments');",
        "const bundleSegment = getAnalyticsSnapshotBundleSegment(bundle, 'verifyMonitor');",
        "const paymentsSegment = getAnalyticsSnapshotBundleSegment(bundle, 'payments');",
        "const ticketsSegment = getAnalyticsSnapshotBundleSegment(bundle, 'tickets');",
        "view: 'ops'",
        'createAnalyticsSnapshotBundleSegmentError('
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics admin snapshot bundle should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics snapshot-bundle runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-workbench.js?v=20260407_ANALYTICS_WORKBENCH_BUNDLE_13'),
        true,
        'admin-studio.html should reference the latest analytics workbench bundle runtime version'
    );
});

test('analytics summary rows bundle consolidates shared table scans across overview, verify, and growth', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'summaryRowsBundle: null,',
        'analyticsDerivedState.summaryRowsBundle = null;',
        'function buildAnalyticsSummaryRowsBundleQuery(options = {}) {',
        'async function getAnalyticsSummaryRowsBundle(options = {}) {',
        "'summaryRowsBundle',",
        "'analytics/summary-rows-bundle'",
        "const bundledUnlockRows = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'promptUnlocks');",
        "const bundledRows = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'verificationLogs');",
        "const bundledGuestbookMessages = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'guestbookMessages');",
        "const bundledLedgerRows = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'pointsLedger');"
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics summary rows bundle should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics summary-rows-bundle runtime version'
    );
});

test('analytics summary payload bundle lets overview, verify, and growth consume server-built base summaries first', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'summaryPayloadBundle: null,',
        'analyticsDerivedState.summaryPayloadBundle = null;',
        'async function getAnalyticsSummaryPayloadBundle(options = {}) {',
        "'summaryPayloadBundle',",
        "'analytics/summary-payload-bundle'",
        "const payloadSegment = getAnalyticsSummaryPayloadBundleSegment(payloadBundle, 'overviewBusinessMix');",
        "const payloadSegment = getAnalyticsSummaryPayloadBundleSegment(payloadBundle, 'verifyServiceSummary');",
        "const payloadSegment = getAnalyticsSummaryPayloadBundleSegment(payloadBundle, 'growthSummary');",
        'const productSignals = buildOverviewBusinessMixProductSignals({',
        'return enrichOverviewBusinessMixSummaryWithProductSignals(',
        'enrichOverviewBusinessMixSummaryWithEvents(payloadSegment.summary, summaryWindow || {}),',
        'return enrichVerifyServiceSummaryWithEvents(payloadSegment.summary, summaryWindow || {});',
        'return enrichGrowthSummaryWithEvents(payloadSegment.summary, summaryWindow || {});'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics summary payload bundle should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics summary-payload-bundle runtime version'
    );
});

test('analytics panel support bundle consolidates channel, content, community, points, and redemption fetches across panels and export', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'panelSupportBundle: null,',
        'analyticsDerivedState.panelSupportBundle = null;',
        'function buildAnalyticsPanelSupportBundleQuery(options = {}) {',
        "query.set('topContentLimit', String(ANALYTICS_PANEL_SUPPORT_TOP_CONTENT_LIMIT));",
        "query.set('pointsLeaderboardLimit', String(ANALYTICS_PANEL_SUPPORT_POINTS_LEADERBOARD_LIMIT));",
        'async function getAnalyticsPanelSupportBundle(options = {}) {',
        "'panelSupportBundle',",
        "'analytics/panel-support-bundle'",
        'function getAnalyticsPanelSupportBundleSegment(bundle = null, key = \'\') {',
        "function createAnalyticsPanelSupportBundleSegmentError(segment = null, fallbackMessage = 'Analytics panel support bundle segment failed') {",
        'async function resolveAnalyticsBundleFirstData(options = {}) {',
        "segmentKey: 'channelBreakdown',",
        "segmentKey: 'topContent',",
        "segmentKey: 'communityStats',",
        "segmentKey: 'pointsDistribution',",
        "segmentKey: 'pointsLeaderboard',",
        "segmentKey: 'redemptionFunnel',",
        'const [',
        'channelData,',
        'communityData,',
        'topContentData,',
        'pointsDist,',
        'pointsLead,',
        'funnelData,',
        'fetchChannelBreakdownData(days),',
        'fetchPointsLeaderboardData(100),'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics panel support bundle should contain ${marker}`);
    }

    const removedMarkers = [];

    for (const marker of removedMarkers) {
        assert.equal(analyticsSource.includes(marker), false, `analytics panel support bundle should no longer contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics panel-support-bundle runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should reference the latest analytics ai/export runtime version for panel support bundle consumers'
    );
});

test('analytics visual panel bundle consolidates heatmap, conversion, retention, contributors, and geo fetches across panels and metric context', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'visualPanelBundle: null,',
        'analyticsDerivedState.visualPanelBundle = null;',
        'function buildAnalyticsVisualPanelBundleQuery(options = {}) {',
        "query.set('weeks', String(weeks));",
        "query.set('topContributorsLimit', '10');",
        'async function getAnalyticsVisualPanelBundle(options = {}) {',
        "'visualPanelBundle',",
        "'analytics/visual-panel-bundle'",
        'function getAnalyticsVisualPanelBundleSegment(bundle = null, key = \'\') {',
        "function createAnalyticsVisualPanelBundleSegmentError(segment = null, fallbackMessage = 'Analytics visual panel bundle segment failed') {",
        "const activityHeatmapSegment = getAnalyticsVisualPanelBundleSegment(visualBundle, 'activityHeatmap');",
        "const retentionCohortSegment = getAnalyticsVisualPanelBundleSegment(visualBundle, 'retentionCohort');",
        "const conversionFunnelSegment = getAnalyticsVisualPanelBundleSegment(visualBundle, 'conversionFunnel');",
        'const conversionRows = conversionFunnelSegment?.ok && Array.isArray(conversionFunnelSegment.payload)',
        'async function resolveAnalyticsBundleFirstData(options = {}) {',
        'async function fetchActivityHeatmapData(days = getAnalyticsRangeDays(30)) {',
        'async function fetchConversionFunnelData(days = getAnalyticsRangeDays(30)) {',
        'async function fetchRetentionCohortData(weeks = getAnalyticsCohortWeeks(), days = getAnalyticsRangeDays()) {',
        'async function fetchTopContributorsData(limit = 10) {',
        'async function fetchGeoDistributionData() {',
        "segmentKey: 'activityHeatmap',",
        "segmentKey: 'conversionFunnel',",
        "segmentKey: 'retentionCohort',",
        "segmentKey: 'topContributors',",
        "segmentKey: 'geoDistribution',",
        'mapPayload: (payload) => ({'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics visual panel bundle should contain ${marker}`);
    }

    const removedMarkers = [
        "callAnalyticsRpcWithFallback('get_activity_heatmap'",
        "callAnalyticsRpcWithFallback('get_conversion_funnel_v2'",
        "callAnalyticsRpcWithFallback('get_conversion_funnel'",
        "rpc('get_retention_cohort'",
        "rpc('get_top_contributors'",
        "rpc('get_geo_distribution_by_site'"
    ];

    for (const marker of removedMarkers) {
        assert.equal(analyticsSource.includes(marker), false, `analytics visual panel bundle should no longer contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics visual-panel-bundle runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-metric-context.js?v=20260405_ANALYTICS_METRIC_CONTEXT_HELPERS_6'),
        true,
        'admin-studio.html should reference the latest analytics metric-context runtime version for visual bundle consumers'
    );
});

test('analytics trend series bundle consolidates trend fetches across charts, ai prediction, and export', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'trendSeriesBundle: null,',
        'analyticsDerivedState.trendSeriesBundle = null;',
        'function buildAnalyticsTrendSeriesBundleQuery(options = {}) {',
        'async function getAnalyticsTrendSeriesBundle(options = {}) {',
        "'trendSeriesBundle',",
        "'analytics/trend-series-bundle'",
        'function getAnalyticsTrendSeriesBundleSegment(bundle = null, key = \'\') {',
        "function createAnalyticsTrendSeriesBundleSegmentError(segment = null, fallbackMessage = 'Analytics trend series bundle segment failed') {",
        'async function resolveAnalyticsBundleFirstData(options = {}) {',
        'async function fetchUserTrendData(days = getAnalyticsRangeDays(30)) {',
        'async function fetchContentTrendData(days = getAnalyticsRangeDays(30)) {',
        'async function fetchRevenueTrendData(days = getAnalyticsRangeDays(30)) {',
        "segmentKey: 'userTrend',",
        "segmentKey: 'contentTrend',",
        "segmentKey: 'revenueTrend',",
        'const data = await fetchUserTrendData(days);',
        'const data = await fetchContentTrendData(days);',
        'const [',
        'overviewData,',
        'userTrendData,',
        'contentTrendData,',
        'revenueTrendData,',
        'fetchUserTrendData(days),',
        'fetchRevenueTrendData(days),'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics trend series bundle should contain ${marker}`);
    }

    const fallbackMarkers = [
        "directLoader: () => loadAnalyticsTrendSeriesDirect('get_user_trend', days)",
        "directLoader: () => loadAnalyticsTrendSeriesDirect('get_content_trend', days)",
        "directLoader: () => loadAnalyticsTrendSeriesDirect('get_revenue_trend', days)"
    ];

    for (const marker of fallbackMarkers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics trend series bundle should keep resilient direct fallback ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('admin-analytics.js?v=20260407_ANALYTICS_PRODUCT_SHELL_8'),
        true,
        'admin-studio.html should reference the latest analytics trend-series-bundle runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should reference the latest analytics ai/export runtime version for trend bundle consumers'
    );
});

test('analytics ai and export helpers reuse the shared summary payload support bundle', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'async function getAnalyticsAIExportSupportBundle(options = {}) {',
        'const summaryWindowOverride = options.summaryWindowData || null;',
        'const [payloadBundleResult, operationsHealthResult, summaryContextBundleResult] = await Promise.allSettled([',
        "getAnalyticsSummaryPayloadSegmentSummary(payloadBundle, 'overviewBusinessMix')",
        "getAnalyticsSummaryPayloadSegmentSummary(payloadBundle, 'verifyServiceSummary')",
        "getAnalyticsSummaryPayloadSegmentSummary(payloadBundle, 'growthSummary')",
        'const supportBundle = await getAnalyticsAIExportSupportBundle({',
        'overview_business_mix: supportBundle.overviewBusinessMix || null,',
        'const summaryContextBundle = supportBundle.summaryContextBundle || {};',
        'const overviewBusinessMix = supportBundle.overviewBusinessMix || null;'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics ai/export support bundle should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should reference the latest analytics ai/export shared-support runtime version'
    );
});

test('analytics ai prompt builders isolate summary enrichment and prompt assembly from the ai shell', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'function buildAnalyticsAISummaryData(data = null, supportBundle = {}) {',
        'function buildAnalyticsAIPromptContext(aiSummaryData = null) {',
        'function buildAnalyticsInsightPrompt(aiSummaryData = null, options = {}) {',
        'function buildAnalyticsPredictionPrompt(trendSeries = [], days = 30) {',
        'window.AdminAnalyticsAIPromptBuilders = Object.assign({}, window.AdminAnalyticsAIPromptBuilders || {}, {',
        'aiSummaryData = buildAnalyticsAISummaryData(data, supportBundle);',
        'const prompt = buildAnalyticsInsightPrompt(aiSummaryData, { rangeLabel });',
        'const prompt = buildAnalyticsPredictionPrompt(trendSeries, days);'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics ai prompt builders should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-prompt-builders.js?v=20260405_ANALYTICS_AI_PROMPT_BUILDERS_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-prompt-builder runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should reference the latest analytics ai shell runtime version'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-prompt-builders.js?v=20260405_ANALYTICS_AI_PROMPT_BUILDERS_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should load the analytics ai-prompt builders before the ai shell runtime'
    );
});

test('analytics ai state isolates cache and debounce globals from the main analytics runtime', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const mainAnalyticsSource = readRepoFile('admin-analytics.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'const analyticsAIState = {',
        'function getAnalyticsAIState() {',
        'function getAnalyticsInsightCacheValue() {',
        'function getAnalyticsInsightCacheTimeValue() {',
        'function getAnalyticsInsightCacheKeyValue() {',
        'function getAnalyticsInsightCacheDuration() {',
        'function setAnalyticsInsightCacheValue(value = null, contextKey = getAnalyticsAIContextKey(), timestamp = Date.now()) {',
        'function isAnalyticsInsightDebouncing() {',
        'function setAnalyticsInsightDebouncing(isActive) {',
        'function resetAnalyticsAICache() {',
        'window.AdminAnalyticsAIState = Object.assign({}, window.AdminAnalyticsAIState || {}, {'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics ai state should contain ${marker}`);
    }

    const removedMainMarkers = [
        'let aiInsightCache = null;',
        'let aiInsightCacheTime = 0;',
        'let aiInsightCacheKey = \'\';',
        'const AI_CACHE_DURATION = 5 * 60 * 1000;',
        'let aiInsightDebounce = false;'
    ];

    for (const marker of removedMainMarkers) {
        assert.equal(mainAnalyticsSource.includes(marker), false, `admin-analytics.js should no longer contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-state.js?v=20260405_ANALYTICS_AI_STATE_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-state runtime version'
    );
});

test('analytics ai dom helpers isolate workspace queries and binding from the ai shell', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const lifecycleSource = readRepoFile('js/admin-analytics-lifecycle.js');
    const aiShellSource = readRepoFile('js/admin-analytics-ai-export.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'const ANALYTICS_AI_INSIGHT_BUTTON_ID = \'generateInsightBtn\';',
        'const ANALYTICS_AI_PREDICTION_CONTENT_ID = \'aiPredictionContent\';',
        'const ANALYTICS_AI_BINDING_FLAG = \'analyticsAiBound\';',
        'function getAnalyticsAIInsightElements() {',
        'function getAnalyticsAIPredictionContainer() {',
        'function bindAnalyticsAIWorkspaceEvents() {',
        "button.dataset[ANALYTICS_AI_BINDING_FLAG] === '1'",
        "button.addEventListener('click', generateAIInsight);",
        'window.AdminAnalyticsAIDom = Object.assign({}, window.AdminAnalyticsAIDom || {}, {',
        'const { button: btn, content } = getAnalyticsAIInsightElements();',
        'const container = getAnalyticsAIPredictionContainer();'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics ai dom helpers should contain ${marker}`);
    }

    const removedShellMarkers = [
        "document.getElementById('generateInsightBtn')",
        "document.getElementById('aiPredictionContent')"
    ];

    for (const marker of removedShellMarkers) {
        assert.equal(aiShellSource.includes(marker), false, `analytics ai shell should no longer contain ${marker}`);
    }

    assert.equal(
        lifecycleSource.includes('bindAnalyticsAIWorkspaceEvents();'),
        true,
        'analytics lifecycle helper should bind the analytics ai workspace via the dom helper'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-dom.js?v=20260405_ANALYTICS_AI_DOM_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-dom runtime version'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-state.js?v=20260405_ANALYTICS_AI_STATE_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-dom.js?v=20260405_ANALYTICS_AI_DOM_1'),
        true,
        'admin-studio.html should load the analytics ai-dom layer after the ai-state layer'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-dom.js?v=20260405_ANALYTICS_AI_DOM_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-helpers.js?v=20260405_ANALYTICS_AI_HELPERS_1'),
        true,
        'admin-studio.html should load the analytics ai-dom layer before the ai-helper layer'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-dom.js?v=20260405_ANALYTICS_AI_DOM_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should load the analytics ai-dom layer before the ai shell runtime'
    );
});

test('analytics ai controller isolates cache, health checks, and loading state from the ai shell', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'function renderAnalyticsInsightDebounceMessage(content) {',
        'function getAnalyticsInsightCacheTtlRemaining(now = Date.now()) {',
        'function syncAnalyticsInsightCacheContext(contextKey = getAnalyticsAIContextKey()) {',
        'function renderAnalyticsCachedInsight(content, contextKey = getAnalyticsAIContextKey(), now = Date.now()) {',
        'async function ensureAnalyticsAIReady(options = {}) {',
        'function beginAnalyticsInsightDebounce(durationMs = 5000) {',
        'function setAnalyticsInsightLoadingState(button, content, isLoading) {',
        'function writeAnalyticsInsightCache(report, summaryData = null, contextKey = getAnalyticsAIContextKey()) {',
        'function renderAnalyticsInsightResult(content, reportText, options = {}) {',
        'function renderAnalyticsInsightError(content, error) {',
        'function setAnalyticsPredictionLoadingState(container, isLoading = true) {',
        'function renderAnalyticsPredictionError(container, error) {',
        'window.AdminAnalyticsAIController = Object.assign({}, window.AdminAnalyticsAIController || {}, {',
        'renderAnalyticsInsightDebounceMessage(content);',
        'syncAnalyticsInsightCacheContext(currentCacheKey);',
        'if (renderAnalyticsCachedInsight(content, currentCacheKey, now)) {',
        'if (!await ensureAnalyticsAIReady({ content })) {',
        'if (!beginAnalyticsInsightDebounce()) {',
        'setAnalyticsInsightLoadingState(btn, content, true);',
        'const cachedInsight = writeAnalyticsInsightCache(',
        'renderAnalyticsInsightResult(content, cachedInsight.report, {',
        'renderAnalyticsInsightError(content, err);',
        'if (!await ensureAnalyticsAIReady({ content: container })) {',
        'setAnalyticsPredictionLoadingState(container, true);',
        'renderAnalyticsPredictionError(container, err);'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics ai controller should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-controller.js?v=20260405_ANALYTICS_AI_CONTROLLER_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-controller runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should reference the latest analytics ai shell runtime version'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-controller.js?v=20260405_ANALYTICS_AI_CONTROLLER_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should load the analytics ai-controller before the ai shell runtime'
    );
});

test('analytics ai helpers isolate fallback insight and prediction rendering from the orchestration shell', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'function hasAdminAI() {',
        'function isGeminiQuotaError(error) {',
        "function buildQuotaFallbackHint(label = '已切换为本地估算') {",
        'function getAnalyticsInsightCacheReport(cacheValue = getAnalyticsInsightCacheValue()) {',
        'function renderAIInsightMarkup(reportText, options = {}) {',
        'function buildLocalAnalyticsInsight(data) {',
        'function buildLocalPrediction(values, horizon = 7) {',
        'function renderPredictionMarkup(predictions, note = \'\') {',
        'function formatAIResponse(text) {',
        'window.AdminAnalyticsAIHelpers = Object.assign({}, window.AdminAnalyticsAIHelpers || {}, {'
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics ai helpers should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-helpers.js?v=20260405_ANALYTICS_AI_HELPERS_1'),
        true,
        'admin-studio.html should reference the latest analytics ai-helper runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should reference the latest analytics ai shell runtime version'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-ai-helpers.js?v=20260405_ANALYTICS_AI_HELPERS_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should load the analytics ai helpers before the ai shell runtime'
    );
});

test('analytics export builders isolate csv and excel assembly from the ai runtime shell', () => {
    const analyticsSource = readAdminAnalyticsRuntimeSource();
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'function exportAsCSV(data) {',
        'function exportAsExcel(data) {',
        'window.exportAsCSV = exportAsCSV;',
        'window.exportAsExcel = exportAsExcel;',
        "if (typeof window.exportAsCSV !== 'function') {",
        "if (typeof window.exportAsExcel !== 'function') {"
    ];

    for (const marker of markers) {
        assert.equal(analyticsSource.includes(marker), true, `analytics export builders should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-export-builders.js?v=20260405_ANALYTICS_EXPORT_BUILDERS_1'),
        true,
        'admin-studio.html should reference the latest analytics export-builder runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should reference the latest analytics ai shell runtime version'
    );
    assert.equal(
        adminStudioHtml.indexOf('js/admin-analytics-export-builders.js?v=20260405_ANALYTICS_EXPORT_BUILDERS_1') < adminStudioHtml.indexOf('js/admin-analytics-ai-export.js?v=20260405_ANALYTICS_AI_EXPORT_9'),
        true,
        'admin-studio.html should load the analytics export builders before the ai shell runtime'
    );
});

test('prompt image delivery optimizes admin previews and cacheable fallback uploads', () => {
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const markers = [
        'function getOptimizedPromptCardImageUrl(url) {',
        "trimmed.includes('cdn.zaoyoe.com/prompts/') && !trimmed.includes('/thumb/')",
        "trimmed.includes('supabase.co/storage/v1/object/public/prompt-images/')",
        "optimizedUrl.searchParams.set('width', '320');",
        "optimizedUrl.searchParams.set('height', '220');",
        "optimizedUrl.searchParams.set('quality', '80');",
        'function sanitizePromptImageUrl(url) {',
        "const imageUrl = sanitizePromptImageUrl(Array.isArray(prompt.images) ? prompt.images[0] : '');",
        'const client = getAdminStudioSupabaseClient();',
        'const originalImagesToUpload = imagesToUpload.filter(({ isThumb }) => !isThumb);',
        "cacheControl: '31536000'",
        'upsert: false'
    ];

    for (const marker of markers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('admin-studio.js?v=20260406_ADMIN_ACCESS_FORCE_REFRESH_3'),
        true,
        'admin-studio.html should reference the latest analytics action routing runtime version'
    );
});

test('analytics ui polish keeps funnel hints visible, top-content and contributor titles drill down, and leaderboard user drill-down actionable', () => {
    const adminStudioStyles = readRepoFile('admin-studio.css');
    const analyticsPanelLoadersSource = readRepoFile('js/admin-analytics-panel-loaders.js');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const styleMarkers = [
        '#conversionFunnel.chart-body {',
        '#conversionFunnel .analytics-funnel-chart-pane {',
        '#pointsLeaderboard .leaderboard-user-link {',
        '.top-content-item__title-btn {',
        '.contributor-name-btn {',
        '.analytics-recommendation-item__actions {',
        '.analytics-compact-item__actions {',
        'justify-content: flex-end;',
        'margin-top: 12px;'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStudioStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    const panelMarkers = [
        'class="top-content-item__title top-content-item__title-btn"',
        'class="contributor-name contributor-name-btn"',
        'data-admin-action="analytics-open-user-detail"',
        'class="leaderboard-user-link"',
        'class="analytics-funnel-chart-pane"',
        'class="analytics-funnel-chart-pane analytics-funnel-chart-pane--empty"'
    ];

    for (const marker of panelMarkers) {
        assert.equal(analyticsPanelLoadersSource.includes(marker), true, `admin-analytics-panel-loaders.js should contain ${marker}`);
    }

    assert.equal(
        analyticsPanelLoadersSource.includes('class="btn-view-context btn-view-context--icon"'),
        false,
        'admin-analytics-panel-loaders.js should no longer render a dedicated top-content context icon button'
    );

    assert.equal(
        analyticsPanelLoadersSource.includes('</i> 看上下文'),
        false,
        'admin-analytics-panel-loaders.js should no longer render the top-content context button copy'
    );

    assert.equal(adminStudioScript.includes("case 'analytics-open-content-commerce-detail':"), true, 'admin-studio.js should delegate content-commerce detail drill-down actions');
    assert.equal(adminStudioScript.includes("case 'analytics-open-user-detail':"), true, 'admin-studio.js should delegate analytics leaderboard user drill-down actions');
    assert.equal(adminStudioScript.includes('window.tryOpenOpsAlertWorkspaceUserModal'), true, 'admin-studio.js should reuse the workbench user-detail opener for analytics drill-down');
    assert.equal(adminStudioHtml.includes('admin-studio.css?v=20260407_ANALYTICS_CENTER_SHELL_83'), true, 'admin-studio.html should reference the latest analytics ui polish stylesheet version');
    assert.equal(adminStudioHtml.includes('js/admin-analytics-panel-loaders.js?v=20260407_ANALYTICS_PANEL_LOADERS_70'), true, 'admin-studio.html should reference the latest analytics panel loader runtime version');
    assert.equal(adminStudioHtml.includes('admin-studio.js?v=20260406_ADMIN_ACCESS_FORCE_REFRESH_3'), true, 'admin-studio.html should reference the latest admin studio action routing version');
});

test('analytics user drill-down carries commerce context into the user detail modal', () => {
    const analyticsPanelLoadersSource = readRepoFile('js/admin-analytics-panel-loaders.js');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminUsersSource = readRepoFile('admin-users.js');
    const adminStudioStyles = readRepoFile('admin-studio.css');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const panelMarkers = [
        'function buildAnalyticsUserDetailContext(context = {}) {',
        'function buildAnalyticsOpenUserDetailAttrs(userId = \'\', context = null) {',
        "sourceLabel: '用户增长 / 商品影响用户层'",
        "sourceLabel: '商品详情 / 购买用户'",
        "sourceLabel: '商品详情 / 最近订单'",
        'data-analytics-context="'
    ];

    for (const marker of panelMarkers) {
        assert.equal(analyticsPanelLoadersSource.includes(marker), true, `admin-analytics-panel-loaders.js should contain ${marker}`);
    }

    const studioMarkers = [
        "case 'analytics-open-user-detail': {",
        "const analyticsContext = typeof parseAnalyticsActionContext === 'function'",
        "case 'users-open-analytics-destination': {",
        'window.openUserModal?.(userId, {',
        'analyticsContext',
        'window.openAnalyticsDestination?.(destination, analyticsContext);'
    ];

    for (const marker of studioMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const userMarkers = [
        'analyticsContext: null,',
        'currentModalData.analyticsContext = normalizeUserAnalyticsContext(options?.analyticsContext || null);',
        'function normalizeUserAnalyticsContext(rawContext = null) {',
        'function buildUserAnalyticsTicketsContext(context = currentModalData?.analyticsContext, user = currentModalUser) {',
        'function buildUserAnalyticsShopOrdersContext(context = currentModalData?.analyticsContext, user = currentModalUser) {',
        "const feedbackScope = String(parsed.feedbackScope || '').trim().toLowerCase();",
        "feedbackScope: normalizedContext.feedbackScope || 'user',",
        'function buildUserAnalyticsTicketsActionAttrs(context = currentModalData?.analyticsContext, user = currentModalUser) {',
        'function buildUserAnalyticsShopOrdersActionAttrs(context = currentModalData?.analyticsContext, user = currentModalUser) {',
        'function buildUserAnalyticsContextBlock(context = currentModalData?.analyticsContext) {',
        'data-admin-action="users-open-analytics-destination"',
        '看商城订单',
        '看售后工单'
    ];

    for (const marker of userMarkers) {
        assert.equal(adminUsersSource.includes(marker), true, `admin-users.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.user-analytics-context {',
        '.user-analytics-context__chip {',
        '.user-analytics-context__actions {',
        'flex-wrap: wrap;',
        'gap: 8px;'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStudioStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    assert.equal(adminStudioHtml.includes('admin-studio.css?v=20260407_ANALYTICS_CENTER_SHELL_83'), true, 'admin-studio.html should reference the latest analytics product stylesheet version');
    assert.equal(adminStudioHtml.includes('admin-users.js?v=20260407_ADMIN_USERS_ANALYTICS_CONTEXT_8'), true, 'admin-studio.html should reference the latest admin users runtime version');
    assert.equal(adminStudioHtml.includes('js/admin-analytics-panel-loaders.js?v=20260407_ANALYTICS_PANEL_LOADERS_70'), true, 'admin-studio.html should reference the latest analytics panel loader runtime version');
    assert.equal(adminStudioHtml.includes('admin-studio.js?v=20260406_ADMIN_ACCESS_FORCE_REFRESH_3'), true, 'admin-studio.html should reference the latest admin studio action routing version');
    assert.equal(adminUsersSource.includes('const feedbackEntries = typeof window.getAnalyticsResolutionFeedbackEntries === \'function\''), true, 'admin-users.js should read analytics resolution feedback entries for commerce trace context');
    assert.equal(adminUsersSource.includes('users-commerce-trace__feedback'), true, 'admin-users.js should render a recent handling feedback block in commerce traces');
});

test('user detail tabs surface product commerce trace when opened from analytics commerce drill-down', () => {
    const adminUsersSource = readRepoFile('admin-users.js');
    const adminStudioStyles = readRepoFile('admin-studio.css');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const userMarkers = [
        'function buildUserAnalyticsCommerceTrace(tabName = \'\', rawData = []) {',
        "title = '商品承接链 / 支付记录';",
        "title = '商品承接链 / 积分流水';",
        "${buildUserAnalyticsCommerceTrace('ledger', data)}",
        "${buildUserAnalyticsCommerceTrace('payments', data)}",
        "${buildUserAnalyticsCommerceTrace('activity', data)}",
        'isAdminPaymentSettled(item)',
        'isAdminShopLedgerReason(item?.reason, item?.referenceId)',
        "title = '商品承接链 / 活动记录';",
        'function buildUserAnalyticsTicketsContext(context = currentModalData?.analyticsContext, user = currentModalUser) {',
        'function buildUserAnalyticsShopOrdersContext(context = currentModalData?.analyticsContext, user = currentModalUser) {',
        "feedbackScope: normalizedContext.feedbackScope || 'user',",
        "feedbackEntityType: normalizedContext.feedbackEntityType || 'user',",
        '看商城订单',
        '看售后工单'
    ];

    for (const marker of userMarkers) {
        assert.equal(adminUsersSource.includes(marker), true, `admin-users.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.users-commerce-trace {',
        '.users-commerce-trace__chip {',
        '.users-commerce-trace__actions {',
        'flex-wrap: wrap;',
        'gap: 8px;'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStudioStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    assert.equal(adminStudioHtml.includes('admin-studio.css?v=20260407_ANALYTICS_CENTER_SHELL_83'), true, 'admin-studio.html should reference the latest analytics product stylesheet version');
    assert.equal(adminStudioHtml.includes('admin-users.js?v=20260407_ADMIN_USERS_ANALYTICS_CONTEXT_8'), true, 'admin-studio.html should reference the latest admin users runtime version');
});

test('payments runtime controls, site filter, and admin chat menu route through delegated actions', () => {
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminPaymentsSource = readRepoFile('js/admin-payments.js');
    const siteFilterSource = readRepoFile('js/admin-site-filter.js');
    const adminChatSource = readRepoFile('js/admin-chat.js');

    const removedInlineMarkers = [
        `onclick="AdminPayments.handleAnomalyAction('`,
        `onclick="AdminPayments.goToPage('`,
        `onclick="AdminPayments.setExceptionTopicFilter('`,
        `onclick="AdminSiteFilter.toggleDropdown()"`,
        `onclick="AdminSiteFilter.select('`,
        `onclick="toggleMobileSidebar()"`
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(
            adminPaymentsSource.includes(marker) || siteFilterSource.includes(marker) || adminChatSource.includes(marker),
            false,
            `payments/site-filter/chat templates should not contain ${marker}`
        );
    }

    const runtimeMarkers = [
        'data-admin-action="payments-handle-anomaly-action"',
        'data-admin-action="payments-go-to-page"',
        'data-admin-action="payments-set-exception-topic-filter"',
        'data-admin-action="site-filter-toggle-dropdown"',
        'data-admin-action="site-filter-select"',
        'data-admin-action="toggle-mobile-sidebar"'
    ];

    for (const marker of runtimeMarkers.slice(0, 3)) {
        assert.equal(adminPaymentsSource.includes(marker), true, `js/admin-payments.js should contain ${marker}`);
    }

    for (const marker of runtimeMarkers.slice(3, 5)) {
        assert.equal(siteFilterSource.includes(marker), true, `js/admin-site-filter.js should contain ${marker}`);
    }

    assert.equal(adminChatSource.includes(runtimeMarkers[5]), true, 'js/admin-chat.js should contain data-admin-action="toggle-mobile-sidebar"');

    const adminScriptMarkers = [
        "case 'payments-handle-anomaly-action':",
        "case 'payments-go-to-page':",
        "case 'payments-set-exception-topic-filter':",
        "case 'payments-priority-focus-order':",
        "case 'payments-priority-focus-topic':",
        "case 'payments-priority-focus-ops':",
        "case 'tickets-priority-open':",
        "case 'tickets-priority-resolve':",
        "case 'tickets-priority-reject':",
        "case 'site-filter-toggle-dropdown':",
        "case 'site-filter-select':"
    ];

    for (const marker of adminScriptMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    assert.equal(siteFilterSource.includes("includeExperiments: true"), false, 'js/admin-site-filter.js should not auto-load analytics experiments on site change');
});

test('payments runtime renderers externalize tooltip, tab, and trend styling', () => {
    const adminPaymentsSource = readRepoFile('js/admin-payments.js');
    const adminStudioStyles = readRepoFile('admin-studio.css');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const removedMarkers = [
        'tooltip.style.left = `${left}px`;',
        'tooltip.style.top = `${top}px`;',
        "tooltip.style.setProperty('--payments-tooltip-arrow-left', `${arrowLeft}px`);",
        "tooltip.style.removeProperty('--payments-tooltip-arrow-left');",
        "module.style.display !== 'none'",
        'indicator.style.left = `${activeButton.offsetLeft}px`;',
        'indicator.style.width = `${activeButton.offsetWidth}px`;',
        "indicator.style.opacity = '1';",
        '<div class="payments-trend-bar-total" style="height:${totalHeight}%"></div>',
        '<div class="payments-trend-bar-anomaly" style="height:${anomalyHeight}%"></div>',
        "data-payments-tooltip="
    ];

    for (const marker of removedMarkers) {
        assert.equal(adminPaymentsSource.includes(marker), false, `js/admin-payments.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        'class="payments-info-tooltip" role="tooltip"',
        "window.getComputedStyle(module).display !== 'none'",
        'class="payments-trend-bar-visual" aria-hidden="true"',
        'class="payments-trend-bar-svg"',
        'paymentsTrendTotalGradient-',
        'paymentsTrendAnomalyGradient-',
        'function renderLoadingSkeletonForTab(tabId = state.activeTab) {',
        'function hasRenderedContentForTab(tabId = state.activeTab) {',
        'class="payments-table payments-table-skeleton" aria-hidden="true"',
        'function buildAnalyticsIssueSummaryState(data = {}, context = state.workbenchContext) {',
        'function buildAnalyticsPrioritySummaryState(data = state.summary, focus = resolveAnalyticsPriorityFocusKind(data), context = state.workbenchContext) {',
        'function buildShopOrdersReturnContext(context = state.workbenchContext) {',
        'function buildShopOrdersReturnAttrs(context = state.workbenchContext, options = {}) {',
        'function buildUserCommerceReturnAttrs(context = state.workbenchContext) {',
        'function buildContentCommerceReturnContext(context = state.workbenchContext) {',
        'function renderAnalyticsIssueSummary(data = state.summary, context = state.workbenchContext) {',
        'function renderAnalyticsPrioritySummary(data = state.summary, context = state.workbenchContext) {',
        'async function focusAnalyticsIssueSummary(kind = \'\') {',
        'async function focusAnalyticsPrioritySummary(type = \'\', targetId = \'\') {',
        'data-admin-action="payments-issue-summary-focus"',
        'data-admin-action="payments-priority-focus-order"',
        'data-admin-action="analytics-open-destination"',
        '回订单承接链',
        '回用户承接链',
        '回内容带货详情',
        'class="admin-workbench-priority-item__recommendation"',
        'data-admin-action="payments-handle-anomaly-action"'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(adminPaymentsSource.includes(marker), true, `js/admin-payments.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.payments-info-tooltip {',
        '.payments-info-chip:hover .payments-info-tooltip',
        '.payments-trend-bar-visual {',
        '.payments-trend-bar-svg {',
        '.payments-refund-alerts {',
        '.payments-refund-topic-card {',
        '.payments-trend-skeleton {',
        '.payments-kpi-card-skeleton .payments-kpi-main {',
        '.payments-cleanup-note--skeleton {',
        '.admin-workbench-context-note__chip--action {',
        '.admin-workbench-priority-list {',
        '.admin-workbench-priority-item__btn {',
        '.admin-workbench-priority-item__rank {',
        '.admin-workbench-priority-item__recommendation {'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStudioStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    assert.match(
        adminStudioHtml,
        /admin-studio\.css\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should reference the updated admin stylesheet version'
    );
    assert.match(
        adminStudioHtml,
        /js\/admin-payments\.js\?v=[A-Za-z0-9_]+/,
        'admin-studio.html should reference the updated admin payments runtime version'
    );
    assert.equal(
        adminStudioHtml.includes('id="paymentsRefundAlertsPanel"'),
        true,
        'admin-studio.html should expose the payments refund alerts panel mount'
    );
});

test('admin chat runtime renderers externalize avatar, loading, and panel visibility styling', () => {
    const adminChatSource = readRepoFile('js/admin-chat.js');
    const adminChatStyles = readRepoFile('css/admin-chat.css');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    const removedMarkers = [
        "img.style.cssText = style;",
        "avatar.style.overflow = 'hidden';",
        "avatar.style.background = 'transparent';",
        'id="chatInterface" style="display: none; height: 100%; flex-direction: column;"',
        'id="adminImageInput" accept="image/*" style="display: none;"',
        'id="adminEmojiPicker" style="display: none;"',
        "emojiPicker.style.display = 'none';",
        "emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'grid' : 'none';",
        "subEl.style.fontSize = '12px';",
        "subEl.style.color = '#94a3b8';",
        "subEl.style.marginBottom = '2px';",
        "document.getElementById('chatEmptyState').style.display = 'none';",
        "interfaceEl.style.display = 'flex';",
        '<div style="text-align:center; padding:20px; color:#64748b;">'
    ];

    for (const marker of removedMarkers) {
        assert.equal(adminChatSource.includes(marker), false, `js/admin-chat.js should not contain ${marker}`);
    }

    const runtimeMarkers = [
        'setElementHidden(element, hidden)',
        "className: 'session-avatar-image'",
        "avatar.classList.add('session-avatar--media');",
        "this.opsAlertSessionId = '__admin_ops_todo__';",
        ".from('ops_alert_jobs')",
        "'站内代办'",
        'id="chatInterface" class="chat-interface" hidden',
        'id="adminImageInput" class="admin-chat-file-input" accept="image/*" hidden',
        'id="adminEmojiPicker" hidden',
        "this.setElementHidden(emojiPicker, !emojiPicker.hidden);",
        "subEl.className = 'session-preview session-preview-subtext';",
        "this.setElementHidden(document.getElementById('chatEmptyState'), true);",
        "this.setElementHidden(interfaceEl, false);",
        'buildMessageAreaLoadingSkeleton()',
        'chat-loading-state chat-loading-state--skeleton',
        'getSessionQueueDutyAdvice(snapshot = null)',
        'data-session-snapshot-action="apply-recommended-mode"',
        'getWorkbenchLauncher() {',
        'async openWorkbenchEntry(workspaceKey, context = {}) {',
        'buildUserContextWorkbenchEntry(kind = \'\', payload = {}) {',
        "return window.getAdminWorkbenchOpsAlertCaseStatusTone(status, { variant: 'chat' });",
        "return window.getAdminWorkbenchOpsAlertCaseStatusLabel(status);",
        "return window.getOpsAlertCaseEventActionLabel(action);",
        'return window.getAdminWorkbenchOpsAlertCaseRecentEventText(event, {',
        'return window.getAdminWorkbenchOpsAlertCaseSummaryText(alert, {',
        "return window.resolveOpsAlertEntryWorkspace(entryPath, baseContext);",
        "return window.resolveShopRiskWorkspace(baseContext, payload);",
        "return window.resolveOpsAlertWorkspace(alertType, payload, baseContext, entryPath);",
        "return this.openWorkbenchEntry('chat-session', context);",
        "return this.openWorkbenchEntry('shop-risk-orders', {",
        "return this.openWorkbenchEntry('payments-overview', context);"
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(adminChatSource.includes(marker), true, `js/admin-chat.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.session-avatar--media',
        '.session-avatar--ops',
        '.session-avatar-image',
        '.session-preview-subtext',
        '.chat-readonly-notice',
        '.admin-alert-card',
        '.admin-alert-action-btn',
        '.chat-interface[hidden]',
        '.admin-emoji-picker:not([hidden])',
        '.chat-loading-state',
        '.chat-loading-state--skeleton',
        '.chat-skeleton-bubble',
        '.session-queue-snapshot__suggestions',
        '.session-queue-suggestion',
        '.session-queue-suggestion__action'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminChatStyles.includes(marker), true, `css/admin-chat.css should contain ${marker}`);
    }

    const htmlMarkers = [
        'css/admin-chat.css?v=20260402_ADMIN_CHAT_INPUT_UI_13',
        'js/admin-chat.js?v=20260402_ADMIN_CHAT_INPUT_UI_13'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminStudioHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }
});

test('section visibility runtime externalizes element hiding and blocked overlay styling', () => {
    const sectionVisibilitySource = readRepoFile('js/section-visibility.js');
    const sectionVisibilityStyles = readRepoFile('css/section-visibility.css');
    const pageSources = [
        readRepoFile('index.html'),
        readRepoFile('guestbook.html'),
        readRepoFile('verify.html'),
        readRepoFile('prompts.html'),
        readRepoFile('shop.html')
    ];

    const removedMarkers = [
        "el.style.display = visible ? '' : 'none';",
        "navEls.forEach(el => el.style.display = visible ? '' : 'none');",
        "menuItem.style.display = visible ? '' : 'none';",
        "el.style.display = 'none';",
        'overlay.style.cssText = `',
        '<div style="',
        'onmouseenter="this.style.background=',
        'onmouseleave="this.style.background='
    ];

    for (const marker of removedMarkers) {
        assert.equal(sectionVisibilitySource.includes(marker), false, `js/section-visibility.js should not contain ${marker}`);
    }

    const runtimeMarkers = [
        'function setDomVisibility(element, visible)',
        'element.hidden = !visible;',
        'element.classList.toggle(HIDDEN_CLASS, !visible);',
        'setDomVisibility(el, visible);',
        'setDomVisibility(menuItem, visible);',
        "overlay.className = 'section-blocked-overlay';",
        'class="section-blocked-overlay__icon-shell"',
        'class="section-blocked-overlay__home-link"',
        "document.body.classList.add('section-visibility-page-blocked');",
        'setDomVisibility(el, false);'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(sectionVisibilitySource.includes(marker), true, `js/section-visibility.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.section-visibility-hidden',
        'body.section-visibility-page-blocked',
        '.section-blocked-overlay',
        '.section-blocked-overlay__icon-shell',
        '.section-blocked-overlay__home-link:hover'
    ];

    for (const marker of cssMarkers) {
        assert.equal(sectionVisibilityStyles.includes(marker), true, `css/section-visibility.css should contain ${marker}`);
    }

    const sharedMarkers = [
        'css/section-visibility.css?v=20260324_SECTION_VISIBILITY_RUNTIME_STYLE_1',
        'js/section-visibility.js?v=20260331_SECTION_VISIBILITY_HOMEPAGE_CONFIG_1'
    ];

    for (const pageSource of pageSources) {
        for (const marker of sharedMarkers) {
            assert.equal(pageSource.includes(marker), true, `public section pages should contain ${marker}`);
    }
}

test('ops alert health runtime renders per-channel configuration detail cards for email delivery', () => {
    const configSource = readRepoFile('admin-config.js');
    const workbenchSource = readRepoFile('js/admin-workbench.js');
    assert.match(workbenchSource, /buildAdminWorkbenchOpsAlertHealthCardState/);
    assert.match(configSource, /ops-alert-health-card__config/);
    assert.match(configSource, /buildOpsAlertHealthCardMarkupFromState/);
    assert.match(workbenchSource, /发件地址/);
    assert.match(workbenchSource, /主题前缀/);
    assert.match(workbenchSource, /recipient_preview/);

    const html = readRepoFile('admin-studio.html');
    assert.match(html, /admin-studio\.css\?v=[A-Za-z0-9_]+/);
});
});

test('final frontend runtime remnants route through delegated or bound listeners instead of inline attributes', () => {
    const notificationSource = readRepoFile('notification-client.js');
    const announcementSource = readRepoFile('announcement-loader.js');
    const guestbookSource = readRepoFile('supabase-guestbook-functions.js');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const shopSource = readRepoFile('js/admin-shop.js');
    const notificationStyles = readRepoFile('css/notification-client.css');
    const indexSource = readRepoFile('index.html');
    const guestbookHtml = readRepoFile('guestbook.html');
    const verifySource = readRepoFile('verify.html');
    const promptsSource = readRepoFile('prompts.html');
    const shopHtml = readRepoFile('shop.html');
    const legacyIndexSource = readRepoFile('index_old.html');

    const removedInlineMarkers = [
        'onclick="clearAllNotifications(event)"',
        `onclick="this.parentElement.remove(); localStorage.setItem('`,
        `onclick="toggleLike('message', '`,
        'onclick="removeFile(',
        `onclick="filter('gemini', this)"`,
        `onclick="filter(this.value)"`
    ];

    for (const marker of removedInlineMarkers) {
        assert.equal(
            notificationSource.includes(marker)
                || announcementSource.includes(marker)
                || guestbookSource.includes(marker)
                || adminStudioScript.includes(marker)
                || shopSource.includes(marker),
            false,
            `final runtime remnants should not contain ${marker}`
        );
    }

    const delegatedMarkers = [
        'data-notif-action="clear-all"',
        'data-notif-action="mark-all-read"',
        'data-notif-action="filter-read"',
        'data-notif-action="toggle-pin"',
        'function handleDrawerClick(e)',
        'data-notif-action="filter-category"',
        'data-announcement-action="acknowledge"',
        "querySelector('[data-announcement-action=\"acknowledge\"]')?.addEventListener('click'",
        'data-guestbook-action="toggle-like"',
        `querySelectorAll('[data-guestbook-action="toggle-like"]')`,
        'data-admin-action="ai-remove-preview"',
        "case 'ai-remove-preview':"
    ];

    assert.equal(notificationSource.includes(delegatedMarkers[0]), true, 'notification-client.js should render a delegated clear-all control');
    assert.equal(notificationSource.includes(delegatedMarkers[1]), true, 'notification-client.js should render a delegated mark-all-read control');
    assert.equal(notificationSource.includes(delegatedMarkers[2]), true, 'notification-client.js should render delegated read filters');
    assert.equal(notificationSource.includes(delegatedMarkers[3]), true, 'notification-client.js should render delegated pin controls');
    assert.equal(notificationSource.includes(delegatedMarkers[4]), true, 'notification-client.js should handle delegated drawer actions');
    assert.equal(notificationSource.includes(delegatedMarkers[5]), true, 'notification-client.js should render delegated admin notification filters');
    assert.equal(announcementSource.includes(delegatedMarkers[6]), true, 'announcement-loader.js should render a bound acknowledge action');
    assert.equal(announcementSource.includes(delegatedMarkers[7]), true, 'announcement-loader.js should bind the acknowledge button');
    assert.equal(guestbookSource.includes(delegatedMarkers[8]), true, 'supabase-guestbook-functions.js should render delegated like actions');
    assert.equal(guestbookSource.includes(delegatedMarkers[9]), true, 'supabase-guestbook-functions.js should bind fallback like actions');
    assert.equal(adminStudioScript.includes(delegatedMarkers[10]), true, 'admin-studio.js should render delegated preview removal controls');
    assert.equal(adminStudioScript.includes(delegatedMarkers[11]), true, 'admin-studio.js should handle delegated preview removal controls');

    const notificationRuntimeMarkers = [
        'wrapper.hidden = true;',
        'wrapper.hidden = false;',
        'badge.hidden = unreadCount <= 0;',
        'class="notif-expand-wrapper"',
        "const PERSONAL_MESSAGE_TITLE = '个人消息';",
        "const EMPTY_PERSONAL_MESSAGE_TEXT = '暂无个人消息';",
        "const EMPTY_ADMIN_PERSONAL_MESSAGE_TEXT = '暂无个人提醒';",
        'ADMIN_PERSONAL_CATEGORY_META',
        'ADMIN_PERSONAL_FILTER_ORDER',
        'NOTIFICATION_READ_FILTER_ORDER',
        'NOTIFICATION_PINNED_STORAGE_KEY',
        'NOTIFICATION_FILTER_STORAGE_KEY',
        'ADMIN_OPS_NOTIFICATION_BLOCK_TITLE_PATTERNS',
        'ADMIN_PERSONAL_NOTIFICATION_ALLOW_TITLE_PATTERNS',
        "if (scope === 'admin_personal') {",
        "if (scope === 'user_personal') {",
        "function normalizeNotificationScope(value) {",
        "function normalizeNotificationCategory(value) {",
        'function loadPinnedNotificationIds() {',
        'function loadNotificationFilterState() {',
        'function persistNotificationFilterState() {',
        'function syncNotificationFilterStateForViewer() {',
        'function getSortedNotifications(sourceNotifications = notifications) {',
        'function buildNotificationReadFilterStrip(sourceNotifications = notifications) {',
        'function getFilteredNotifications(sourceNotifications = notifications) {',
        'class="notif-filter-chip${currentAdminNotificationFilter === filterKey ? \' is-active\' : \'\'}"',
        'class="notif-filter-chip${currentNotificationReadFilter === filterKey ? \' is-active\' : \'\'}"',
        'class="notif-card-pin${n.is_pinned ? \' is-active\' : \'\'}"',
        'await resolveNotificationViewer();',
        'notifications = syncNotificationPinnedState((data || []).filter((row) => shouldIncludeNotification(row)));',
        'data-notif-category="${escapeHtml(visualMeta.categoryMeta?.key || normalizeNotificationCategory(n.category) || \'\')}"',
        'notif-card-tag',
        'window.toggleNotificationPin = function (id) {',
        'window.markAllNotificationsRead = async function () {',
        "document.documentElement.classList.add('notif-scroll-locked');",
        "document.body.classList.add('notif-scroll-locked');"
    ];

    for (const marker of notificationRuntimeMarkers) {
        assert.equal(notificationSource.includes(marker), true, `notification-client.js should contain ${marker}`);
    }

    const removedNotificationRuntimeMarkers = [
        "const style = document.createElement('style');",
        "wrapper.style.display = 'none';",
        "wrapper.style.display = 'block';",
        "badge.style.display = unreadCount > 0 ? 'block' : 'none';",
        'style="text-align: center; padding: 8px 0;"'
    ];

    for (const marker of removedNotificationRuntimeMarkers) {
        assert.equal(notificationSource.includes(marker), false, `notification-client.js should not retain ${marker}`);
    }

    const notificationStyleMarkers = [
        '.notif-drawer-actions',
        '.notif-mark-read',
        '.notif-filter-strip',
        '.notif-filter-strip--status',
        '.notif-filter-chip',
        '.notif-expand-wrapper',
        '#navNotifWrapper[hidden]',
        '.notif-drawer',
        '.notif-card.exit',
        '.notif-card.is-pinned',
        '.notif-card-pin',
        '.notif-card-tag',
        '.notif-scroll-locked'
    ];

    for (const marker of notificationStyleMarkers) {
        assert.equal(notificationStyles.includes(marker), true, `css/notification-client.css should contain ${marker}`);
    }

    const notificationAssetMarkers = [
        'css/notification-client.css?v=20260331_NOTIFICATION_FILTER_MEMORY_1',
        'notification-client.js?v=20260331_NOTIFICATION_FILTER_MEMORY_1'
    ];

    for (const marker of notificationAssetMarkers) {
        assert.equal(indexSource.includes(marker), true, `index.html should contain ${marker}`);
        assert.equal(guestbookHtml.includes(marker), true, `guestbook.html should contain ${marker}`);
        assert.equal(verifySource.includes(marker), true, `verify.html should contain ${marker}`);
        assert.equal(promptsSource.includes(marker), true, `prompts.html should contain ${marker}`);
        assert.equal(shopHtml.includes(marker), true, `shop.html should contain ${marker}`);
        assert.equal(legacyIndexSource.includes(marker), true, `index_old.html should contain ${marker}`);
    }
});

test('local smoke fixtures expose admin and notification regression harnesses', () => {
    const smokeFixtureSource = readRepoFile('js/local-smoke-fixtures.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const smokeNotificationHtml = readRepoFile('smoke-notifications.html');

    const fixtureMarkers = [
        "const smokeEnabled = searchParams.get('smoke') === '1';",
        'function installSupabaseStub() {',
        'function installFetchStub() {',
        'async function runAdminStudioSmoke() {',
        'async function runAdminAnalyticsSmoke() {',
        'async function runAdminPointsSmoke() {',
        'async function runAdminShopSmoke() {',
        'async function runAdminGallerySmoke() {',
        'async function runHomepageAdminSmoke() {',
        'async function runAdminTicketsSmoke() {',
        'async function runUserModalSmoke() {',
        'async function runAdminCommentsSmoke() {',
        'async function runAdminChatSmoke() {',
        'async function runNotificationSmoke() {',
        'function shouldRunMobileLayoutChecks() {',
        'function recordSelectorsNoHorizontalOverflow(label, selectors = [], tolerance = 6) {',
        "document.documentElement.setAttribute('data-local-smoke-status', status);",
        "const smokeRunId = String(searchParams.get('smokeRunId') || '').trim();",
        "await globalScope.fetch('/__local-smoke-result', {",
        "recordResult('启用模板切换不再跳页'",
        '交班报表可切到“我的接班”视角',
        '客服工作台队列总览已渲染',
        '快捷回复点击后会回填插值正文',
        '用户详情弹窗支持点击外部关闭',
        '首页模块会按站点加载配置',
        '页脚显隐也通过 homepage_config 保存',
        '切换站点后首页配置不会串站',
        'Analytics 概览 KPI 已渲染',
        'Analytics 日期切换会把窗口参数传给关键 RPC',
        'Analytics 切站点只会 reload 不会重复订阅',
        'Analytics 离开模块会 teardown realtime 订阅',
        'Gallery 管理列表会渲染全局 Prompt 资产',
        'Gallery 管理卡片会标记全局资产和双语覆盖状态',
        'Gallery 编辑态会回填主字段和显式双语字段',
        'Gallery 编辑保存会显式写回双语字段',
        '切换站点后 Gallery 编辑态双语字段不会串站',
        '套餐目录会渲染编辑工作台',
        '套餐编辑保存会通过 points packages handler 写回',
        '套餐新建会在 Points 模块里创建全局资产',
        '兑换码生成会通过 points manage handler 写回批次和兑换码',
        '批次列表会通过 points batches handler 加载当前站点批次',
        '批次详情会通过 points batches handler 加载兑换码',
        'tickets.manage',
        "ops_alert_job_attempts: 'opsAlertJobAttempts'",
        '售后工单概览已产出汇总追踪样本',
        '售后工单横栏切换不跳页',
        '售后工单提醒活动闭环没有横向溢出',
        '售后工单提醒活动闭环区块不会相互覆盖',
        '汇总历史 fallback 文案不暴露底层路由错误',
        '连续两次都在的工单超过 2 条后会在列内滚动',
        'shop.manage',
        "const adminRoute = url.pathname === '/api/admin'",
        "if ((url.pathname === '/api/admin/shop/products' || adminRoute === 'shop/products') && method === 'GET') {",
        "if ((url.pathname === '/api/admin/shop/categories' || adminRoute === 'shop/categories') && method === 'GET') {",
        "if ((url.pathname === '/api/admin/shop/inventory' || adminRoute === 'shop/inventory') && method === 'GET') {",
        "if ((url.pathname === '/api/admin/shop/mutate' || adminRoute === 'shop/mutate') && method === 'POST') {",
        '商城模块会通过 shop products handler 渲染商品工作台',
        '商城导入树会通过 shop categories 和 products handler 渲染分类与商品',
        '商城拖拽排序会通过 shop mutate handler 持久化 sort_order',
        '商城分类创建与重命名会通过 shop mutate handler 写回分类树',
        '商城跨分类移动与删分类回退会保持工作台闭环',
        '库存列表会通过 shop inventory handler 渲染统计和表格',
        '库存导入会通过 shop mutate handler 写入批次',
        '批量释放储备库存会通过 shop mutate handler 回收为在售库存',
        '评论模块会按站点加载含回复的统计口径',
        '删除留言回复会通过 comments handler 清理回复树',
        '画廊置顶会通过 comments handler 切换当前站点状态',
        '评论封禁会通过 comments blocks handler 写入封禁状态',
        '评论解封会通过 comments blocks handler 清理封禁状态',
        '客服工作台窄屏下值班建议与会话区没有横向溢出',
        '通知中心窄屏下长文案会自然换行',
        "recordResult('通知置顶会立即影响排序'"
    ];

    for (const marker of fixtureMarkers) {
        assert.equal(smokeFixtureSource.includes(marker), true, `js/local-smoke-fixtures.js should contain ${marker}`);
    }

    assert.equal(
        adminStudioHtml.includes('js/local-smoke-fixtures.js?v=20260404_LOCAL_SMOKE_FIXTURES_34'),
        true,
        'admin-studio.html should load the local smoke fixtures entry'
    );
    assert.equal(
        smokeNotificationHtml.includes('css/smoke-notifications.css?v=20260401_LOCAL_SMOKE_FIXTURES_11'),
        true,
        'smoke-notifications.html should load the dedicated smoke harness stylesheet'
    );
    assert.equal(
        smokeNotificationHtml.includes('js/local-smoke-fixtures.js?v=20260404_LOCAL_SMOKE_FIXTURES_34'),
        true,
        'smoke-notifications.html should load the local smoke fixtures entry'
    );
    assert.equal(
        smokeNotificationHtml.includes('notification-client.js?v=20260331_NOTIFICATION_FILTER_MEMORY_1'),
        true,
        'smoke-notifications.html should load the current notification runtime'
    );
    assert.equal(
        smokeNotificationHtml.includes('id="navNotifWrapper" hidden'),
        true,
        'smoke-notifications.html should provide the notification wrapper expected by notification-client.js'
    );
});

test('shop init keeps product skeleton rendering on the fast path', () => {
    const shopSource = readRepoFile('js/admin-shop.js');

    assert.equal(
        shopSource.includes("await this.renderProductCategoryFilters();\n        await this.loadProducts();"),
        false,
        'js/admin-shop.js init should not block product skeleton rendering behind category loading'
    );
    assert.match(
        shopSource,
        /this\.switchTab\(restoredShopState\?\.tabName \|\| 'products'\);/,
        'js/admin-shop.js should hand initial shop loading to switchTab so products can paint immediately'
    );
    assert.match(
        shopSource,
        /void this\.ensureShopTabReady\(normalizedTab, \{ force: options\.force === true \}\)/,
        'js/admin-shop.js should route tab activation through the shared shop tab warm-loader'
    );
});

test('shop tabs prefetch sibling views and invalidate warm state on context changes', () => {
    const shopSource = readRepoFile('js/admin-shop.js');
    const siteFilterSource = readRepoFile('js/admin-site-filter.js');

    assert.match(
        shopSource,
        /scheduleShopTabPrefetch: function \(activeTab = this\.currentTab\) \{/,
        'js/admin-shop.js should define a shared sibling-tab prefetch scheduler'
    );
    assert.match(
        shopSource,
        /const queue = this\.getShopTabPrefetchQueue\(activeTab\);/,
        'js/admin-shop.js should build a prefetch queue from sibling tabs'
    );
    assert.match(
        shopSource,
        /await this\.ensureShopTabReady\(tabName, \{ background: true \}\);/,
        'js/admin-shop.js should warm hidden sibling tabs through the same readiness pipeline'
    );
    assert.match(
        shopSource,
        /handleSiteChange: function \(\) \{\s*const requestId = \+\+this\.shopSiteChangeRequestId;\s*this\.invalidateShopTabCache\(\);/s,
        'js/admin-shop.js should invalidate warm tab state when the admin site context changes'
    );
    assert.equal(
        siteFilterSource.includes("if (typeof window.ShopAdmin.handleSiteChange === 'function') {"),
        true,
        'js/admin-site-filter.js should delegate shop site changes to the shared ShopAdmin context handler'
    );
});

test('admin studio modal scrollers auto-hide after scroll activity settles', () => {
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const adminStudioStyles = readRepoFile('admin-studio.css');

    const scriptMarkers = [
        'const ADMIN_SCROLLBAR_AUTO_HIDE_SELECTOR = [',
        'function markAdminScrollbarActive(target) {',
        'target.classList.add(ADMIN_SCROLLBAR_AUTO_HIDE_CLASS);',
        "target.addEventListener('mouseenter', () => markAdminScrollbarActive(target), { passive: true });",
        "target.addEventListener('scroll', () => markAdminScrollbarActive(target), { passive: true });",
        'function observeAdminScrollbarAutoHide() {',
        '.verify-monitor-list--compact',
        '.admin-audit-monitor-panel__body--compact',
        '.config-textarea',
        '.select-options',
        '#discountGenerateModal > div',
        '#ticketReplyModal > div',
        '.admin-ticket-reply-modal__context-column',
        '.admin-ticket-reply-modal__description'
    ];

    for (const marker of scriptMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.admin-scrollbar-auto-hide {',
        'scrollbar-color: transparent transparent !important;',
        '.admin-scrollbar-auto-hide.admin-scrollbar-auto-hide--visible::-webkit-scrollbar-thumb',
        '.admin-scrollbar-auto-hide:focus-within::-webkit-scrollbar-thumb:hover',
        '.admin-ticket-reply-modal__layout {',
        '.admin-ticket-reply-modal__quick-actions {'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStudioStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    assert.match(
        adminStudioHtml,
        /admin-studio\.css\?v=20\d{6}_[A-Z0-9_]+/,
        'admin-studio.html should reference a cache-busted admin-studio.css asset'
    );
    assert.match(
        adminStudioHtml,
        /admin-studio\.js\?v=20\d{6}_[A-Z0-9_]+/,
        'admin-studio.html should reference a cache-busted admin-studio.js asset'
    );
});

test('announcement runtime renderers externalize decoration particles and physics style state', () => {
    const announcementSource = readRepoFile('announcement-loader.js');
    const verifySource = readRepoFile('verify.html');
    const shopSource = readRepoFile('shop.html');
    const legacyIndexSource = readRepoFile('index_old.html');

    const removedRuntimeMarkers = [
        'style="left:${left}%; top:${top}%; width:${size}px; height:${size}px;',
        'style="width:100%;height:100%;display:block;"',
        'style="left:${left}%;animation-delay:${delay.toFixed(2)}s;',
        'style="position:relative;z-index:10;"',
        "container.style.position = 'absolute'",
        "el.style.width = '4px'",
        'p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`',
        "p.el.style.opacity = p.opacity",
        "toast.querySelector('.announcement-ack-btn').onclick = () => {"
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(
            announcementSource.includes(marker),
            false,
            `announcement-loader.js should not retain ${marker}`
        );
    }

    const runtimeMarkers = [
        'function setAnnouncementStyleState(target, styles = {})',
        'data-announcement-dust="1"',
        'data-announcement-particle="1"',
        'hydrateDecorationParticleStyles(root)',
        "bindAnnouncementActions(overlay, ackKey, { dismissOnBackdrop: true });",
        "container.classList.add('announcement-particle-host');",
        "setAnnouncementTransformState(p.el, p.x, p.y);",
        '.announcement-banner-icon',
        '.announcement-particle-layer--rain-streak',
        '.announcement-particle-svg'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(
            announcementSource.includes(marker),
            true,
            `announcement-loader.js should contain ${marker}`
        );
    }

    for (const source of [verifySource, shopSource, legacyIndexSource]) {
        assert.equal(
            source.includes('announcement-loader.js?v=20260324_ANNOUNCEMENT_RUNTIME_STYLE_HELPERS_2'),
            true,
            'announcement entry pages should load the latest announcement runtime version'
        );
    }
});

test('announcement settings panels keep the preview vertically centered and match editor height', () => {
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const adminStudioStyles = readRepoFile('admin-studio.css');

    assert.match(
        adminStudioHtml,
        /admin-studio\.css\?v=20\d{6}_[A-Z0-9_]+/,
        'admin-studio.html should keep the announcement settings stylesheet cache-busted'
    );
    assert.match(
        adminStudioStyles,
        /#settings-view-notifications \.announcement-full-layout\s*\{[\s\S]*align-items:\s*stretch;/,
        'admin-studio.css should stretch the announcement preview and editor columns to the same height'
    );
    assert.match(
        adminStudioStyles,
        /#settings-view-notifications \.announcement-preview-stage\s*\{[\s\S]*align-items:\s*center;[\s\S]*height:\s*100%;/,
        'admin-studio.css should vertically center the station announcement preview card inside its stage'
    );
    assert.match(
        adminStudioStyles,
        /#settings-view-notifications \.announcement-editor-side\s*\{[\s\S]*height:\s*100%;/,
        'admin-studio.css should let the announcement editor card stretch to match the preview column height'
    );
});

test('analytics admin fetch warms the admin cookie session before product bundle requests', () => {
    const analyticsSource = readRepoFile('admin-analytics.js');
    const lifecycleSource = readRepoFile('js/admin-analytics-lifecycle.js');

    const analyticsMarkers = [
        'async function ensureAnalyticsAdminCookieSession(options = {}) {',
        'await ensureAnalyticsAdminCookieSession();',
        "credentials: 'same-origin'",
        "window.adminStudioSessionGranted = Boolean(sessionResult?.ok);",
        "...(!hasAdminCookieSession ? (await getAnalyticsAdminAuthHeaders()) : { 'Content-Type': 'application/json' })",
        'forceRefresh: true',
        'window.AdminAccess?.clearCachedAdminStudioSession?.();',
        'const shouldRetryAuth = (Number(response.status || 0) === 401 || Number(response.status || 0) === 403)'
    ];

    for (const marker of analyticsMarkers) {
        assert.equal(
            analyticsSource.includes(marker) || lifecycleSource.includes(marker),
            true,
            `analytics admin bundle auth flow should contain ${marker}`
        );
    }
});
