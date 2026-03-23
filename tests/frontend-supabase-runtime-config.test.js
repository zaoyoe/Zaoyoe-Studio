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
    'js/admin-shop.js',
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

test('public pages wire the chat widget through the shared bootstrap loader', () => {
    const violations = [];

    for (const relativePath of CHAT_WIDGET_PAGES) {
        const source = readRepoFile(relativePath);

        if (!source.includes('css/chat-widget.css')) {
            violations.push(`${relativePath} is missing css/chat-widget.css`);
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

test('vercel CSP restricts inline script elements to hashed runtime pages while isolating legacy event attributes', () => {
    const cspValue = getGlobalCspHeaderValue();
    const directives = parseCspDirectives(cspValue);
    const scriptSrc = directives.get('script-src') || [];
    const scriptSrcElem = directives.get('script-src-elem') || [];
    const scriptSrcAttr = directives.get('script-src-attr') || [];
    const expectedHashes = collectInlineScriptHashes(RUNTIME_PAGES);

    assert.notEqual(scriptSrc.length, 0, 'Missing script-src directive');
    assert.notEqual(scriptSrcElem.length, 0, 'Missing script-src-elem directive');
    assert.deepEqual(scriptSrcAttr, ["'unsafe-inline'"], 'script-src-attr should stay isolated to legacy inline handlers');
    assert.equal(scriptSrc.includes("'unsafe-inline'"), false, 'script-src should no longer broadly allow unsafe-inline');
    assert.equal(scriptSrcElem.includes("'unsafe-inline'"), false, 'script-src-elem should no longer broadly allow unsafe-inline');

    const missingFromScriptSrc = expectedHashes.filter((hash) => !scriptSrc.includes(hash));
    const missingFromScriptSrcElem = expectedHashes.filter((hash) => !scriptSrcElem.includes(hash));

    assert.deepEqual(missingFromScriptSrc, [], `script-src is missing inline script hashes:\n${missingFromScriptSrc.join('\n')}`);
    assert.deepEqual(missingFromScriptSrcElem, [], `script-src-elem is missing inline script hashes:\n${missingFromScriptSrcElem.join('\n')}`);
});

test('shared profile modal template no longer uses inline event handlers', () => {
    const source = readRepoFile('js/profile-modal-template.js');
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
});

test('critical auth pages consume delegated profile modal and form bindings', () => {
    const verifySource = readRepoFile('verify.html');
    const indexSource = readRepoFile('index.html');
    const resetPasswordSource = readRepoFile('reset-password.html');

    assert.equal(verifySource.includes('profile-modal-template.js'), true, 'verify.html should load the shared profile modal template');
    assert.equal(indexSource.includes('profile-modal-template.js'), true, 'index.html should load the shared profile modal template');
    assert.equal(verifySource.includes('id="profileModal"'), false, 'verify.html should not embed a duplicated profile modal');
    assert.equal(indexSource.includes('id="profileModal"'), false, 'index.html should not embed a duplicated profile modal');
    assert.equal(verifySource.includes('onmousedown="closeModal(event)"'), false, 'verify.html should not inline modal close handlers');
    assert.equal(verifySource.includes('onmouseup="closeModal(event)"'), false, 'verify.html should not inline modal close handlers');
    assert.equal(verifySource.includes('onclick="closeModal(event)"'), false, 'verify.html should not inline modal close handlers');
    assert.equal(verifySource.includes('data-modal-dismiss-managed="1"'), true, 'verify.html should use managed modal dismissal for comingSoonModal');

    assert.equal(resetPasswordSource.includes('onsubmit="handleNewPasswordSubmit(event)"'), false, 'reset-password.html should not inline form submission');
    assert.equal(
        resetPasswordSource.includes("addEventListener('submit', handleNewPasswordSubmit)"),
        true,
        'reset-password.html should bind submission via addEventListener'
    );
});

test('prompts, guestbook, and shop entry pages no longer ship inline handler attributes', () => {
    const inlineHandlerPattern = /\bon(?:click|change|submit|mousedown|mouseup|input|keydown|mouseover|mouseout|error|load)\s*=\s*["']/i;
    const files = [
        'index.html',
        'prompts.html',
        'guestbook.html',
        'shop.html'
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

test('homepage entry points expose delegated guestbook triggers instead of inline handlers', () => {
    const indexSource = readRepoFile('index.html');
    const framerHomeSource = readRepoFile('js/framer_home.js');

    assert.equal(indexSource.includes('data-home-open-guestbook="1"'), true, 'index.html should expose delegated guestbook triggers');
    assert.equal(indexSource.includes('data-home-trigger-upload="1"'), true, 'index.html should expose delegated upload triggers');
    assert.equal(framerHomeSource.includes("closest('[data-home-open-guestbook=\"1\"]')"), true, 'js/framer_home.js should delegate homepage guestbook triggers');
    assert.equal(framerHomeSource.includes("closest('[data-home-trigger-upload=\"1\"]')"), true, 'js/framer_home.js should delegate homepage upload triggers');
});

test('admin studio shell tabs and dashboards route core controls through delegated actions', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');

    const removedInlineMarkers = [
        `onclick="switchModule('gallery')"`,
        `onclick="switchView('create')"`,
        `onclick="switchCommentView('guestbook')"`,
        `onclick="switchSettingsView('pricing')"`,
        `onclick="HomepageAdmin.switchSection('hero')"`,
        `onclick="AdminPayments.switchTab('overview')"`,
        `onclick="AdminPayments.toggleRangeMenu(event)"`,
        `onclick="dismissAllAlerts()"`,
        `onclick="switchAnalyticsTab('users')"`,
        `onclick="toggleDateRangeDropdown()"`,
        `onclick="document.getElementById('hp-verify-file-input').click()"`,
        `onchange="HomepageAdmin._handleScreenshotUpload(this)"`,
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
        'data-admin-action="analytics-switch-tab"',
        'data-admin-change-action="homepage-handle-screenshot-upload"',
        'data-admin-change-action="comments-toggle-select-all"'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(adminStudioScript.includes("closest('[data-admin-action]')"), true, 'admin-studio.js should delegate click-based admin controls');
    assert.equal(adminStudioScript.includes("closest('[data-admin-change-action]')"), true, 'admin-studio.js should delegate change-based admin controls');
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

test('shop admin pagination renderer no longer emits inline handler attributes', () => {
    const source = readRepoFile('js/admin-shop.js');
    const start = source.indexOf('renderPagination: function');
    const end = source.indexOf('// Render Product Category Filter Buttons dynamically');
    const snippet = source.slice(start, end);
    const inlineHandlerPattern = /\bon(?:click|change|submit|mousedown|mouseup|input|keydown|mouseover|mouseout|error|load)\s*=\s*["']/i;

    assert.notEqual(start, -1, 'js/admin-shop.js should define renderPagination');
    assert.notEqual(end, -1, 'js/admin-shop.js should keep the pagination block bounded');
    assert.equal(inlineHandlerPattern.test(snippet), false, 'renderPagination should not emit inline event handler attributes');
    assert.equal(snippet.includes('data-shop-pagination-target="${loadFuncStr}"'), true, 'renderPagination should expose delegated pagination targets');
    assert.equal(source.includes('bindDelegatedHandlers: function'), true, 'js/admin-shop.js should bind delegated pagination handlers');
});
