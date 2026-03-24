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
    assert.equal(resetPasswordSource.includes('./js/reset-password-page.js'), true, 'reset-password.html should load the reset password bootstrap file');
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
        ['reset-password.html', 'css/reset-password-page.css?v=20260324_RESET_PASSWORD_STYLES_1'],
        ['privacy.html', 'css/privacy-page.css?v=20260324_PRIVACY_STYLES_1'],
        ['profile_mobile_tab_preview.html', './css/profile-mobile-tab-preview.css?v=20260324_PROFILE_PREVIEW_STYLES_1'],
        ['index.html', './css/index-page.css?v=20260324_INDEX_STYLE_ATTRS_1'],
        ['shop.html', 'css/shop-page.css?v=20260324_INLINE_STYLE_ATTRS_BATCH_1'],
        ['admin-studio.html', 'css/admin-studio-page.css?v=20260324_ADMIN_STUDIO_SHOP_RUNTIME_STYLE_ZERO_1'],
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
        ['shop.html', 'css/shop-page.css?v=20260324_INLINE_STYLE_ATTRS_BATCH_1'],
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

    assert.equal(
        source.includes('css/admin-studio-page.css?v=20260324_ADMIN_STUDIO_SHOP_RUNTIME_STYLE_ZERO_1'),
        true,
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

    assert.equal(
        adminStudioSource.includes('js/admin-studio-bootstrap.js?v=20260324_ADMIN_STUDIO_BOOTSTRAP_1'),
        true,
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
    assert.equal(previewSource.includes('data-demo-id="grid"'), true, 'preview-hero-effects.html should expose delegated demo buttons');
    assert.equal(previewSource.includes('./js/preview-hero-effects-page.js'), true, 'preview-hero-effects.html should load the shared hero preview bootstrap');
    assert.equal(previewHeroScript.includes('function bindDemoNavigation()'), true, 'js/preview-hero-effects-page.js should bind demo navigation centrally');
    assert.equal(profilePreviewSource.includes('./js/profile-mobile-tab-preview.js'), true, 'profile_mobile_tab_preview.html should load the shared profile preview bootstrap');
    assert.equal(langSource.includes('./js/test-lang-toggle-page.js'), true, 'test-lang-toggle.html should load the language toggle bootstrap');
    assert.equal(langScript.includes("document.getElementById('langToggleTest')?.addEventListener('click'"), true, 'js/test-lang-toggle-page.js should bind the language toggle');
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
        'data-admin-action="analytics-export-data"',
        'data-admin-action="analytics-refresh-data"',
        'data-admin-change-action="homepage-handle-screenshot-upload"',
        'data-admin-change-action="payments-change-active-provider"',
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
        'data-admin-action="settings-add-package-row"',
        'data-admin-action="settings-toggle-custom-recharge-entry"',
        'data-admin-action="settings-toggle-mock-payment"'
    ];

    for (const marker of delegatedHtmlMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const delegatedRuntimeMarkers = [
        'data-admin-change-action="settings-update-package-field"',
        'data-admin-action="settings-toggle-package-status"',
        'data-admin-action="settings-delete-package"'
    ];

    for (const marker of delegatedRuntimeMarkers) {
        assert.equal(adminConfigSource.includes(marker), true, `admin-config.js should render ${marker}`);
    }

    const delegatedHandlerMarkers = [
        "case 'settings-add-package-row':",
        "case 'settings-toggle-custom-recharge-entry':",
        "case 'settings-toggle-mock-payment':",
        "case 'settings-toggle-package-status':",
        "case 'settings-delete-package':",
        "case 'settings-update-package-field':"
    ];

    for (const marker of delegatedHandlerMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    assert.equal(
        adminConfigSource.includes('function normalizePackageFieldValue(field, value, fallback)'),
        true,
        'admin-config.js should normalize delegated package field updates'
    );
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
        'data-admin-action="homepage-switch-section"',
        'data-admin-action="payments-switch-tab"',
        'data-admin-action="analytics-switch-tab"',
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
        'data-admin-action="users-close-modal"',
        'data-admin-action="users-switch-tab"'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(adminStudioScript.includes('points-switch-view'), true, 'admin-studio.js should handle points tab delegation');
    assert.equal(adminStudioScript.includes('users-switch-tab'), true, 'admin-studio.js should handle user modal tab delegation');
    assert.equal(adminStudioScript.includes('[data-admin-keydown-action]'), true, 'admin-studio.js should delegate keydown-based admin controls');
    assert.equal(adminStudioScript.includes("form.id === 'generateCodesForm'"), true, 'admin-studio.js should delegate points generate form submission');
});

test('admin user runtime renderers route list, modal, toolbar, and notification controls through delegated actions', () => {
    const adminUsersSource = readRepoFile('admin-users.js');
    const adminStudioScript = readRepoFile('admin-studio.js');

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
        `onclick="closeClearContentModal()"`
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
        'data-admin-action="users-close-ledger-detail"',
        'data-admin-action="users-open-user-modal"',
        'data-admin-action="users-reload-affiliate"',
        'data-users-note-input="1"',
        'data-admin-action="users-submit-note"',
        'data-admin-action="users-close-notification-modal"',
        'data-admin-action="users-select-notification-type"',
        'data-admin-action="users-send-notification"',
        'data-batch-tag-value="',
        'data-batch-tag-close="1"',
        'data-batch-tag-submit="1"',
        'data-users-ban-action="close"',
        'data-users-ban-action="select"',
        'data-users-ban-action="details"',
        'data-users-ban-action="confirm"',
        'data-users-points-action="close"',
        'data-users-clear-action="close"',
        'document.documentElement.dataset.adminUsersRuntimeDelegatesBound',
        "target.matches('[data-users-tag-input=\"1\"]')",
        'function bindBanUserModalInteractions(overlay)',
        'function bindPointsModalInteractions(overlay)',
        'function bindClearContentModalInteractions(overlay)'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminUsersSource.includes(marker), true, `admin-users.js should contain ${marker}`);
    }

    const delegatedHandlerMarkers = [
        "case 'users-open-drawer':",
        "case 'users-stop-propagation':",
        "case 'users-copy-meta':",
        "case 'users-show-tag-input':",
        "case 'users-remove-tag':",
        "case 'users-save-modal-admin-permissions':",
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
        "case 'users-reload-affiliate':",
        "case 'users-submit-note':",
        "case 'users-close-notification-modal':",
        "case 'users-select-notification-type':",
        "case 'users-send-notification':",
        "case 'users-toggle-select-all-page':",
        "case 'users-toggle-selection':",
        "case 'users-toggle-modal-admin':"
    ];

    for (const marker of delegatedHandlerMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }
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
        'data-points-action="navigate-user"',
        'data-points-action="set-code-expiry"',
        'data-points-action="disable-code"',
        'data-points-action="revoke-code"',
        'data-points-action="enable-code"',
        'data-points-overlay-close="batch-edit"',
        'data-points-action="close-batch-edit"',
        'data-points-submit="save-batch-edit"',
        'data-points-action="navigate-batch"',
        'function bindAdminPointsRuntimeDelegates()',
        "document.documentElement.dataset.adminPointsRuntimeDelegatesBound === '1'",
        "case 'execute-delete-option':",
        "case 'navigate-user':",
        "case 'save-batch-edit':"
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminPointsSource.includes(marker), true, `admin-points.js should contain ${marker}`);
    }
});

test('admin comments runtime renderers route list items, filters, and block menus through delegated actions', () => {
    const adminCommentsSource = readRepoFile('admin-comments.js');
    const inlineHandlerPattern = /\bon(?:click|change|submit|input|keydown|blur|error)\s*=\s*["']/i;

    assert.equal(
        inlineHandlerPattern.test(adminCommentsSource),
        false,
        'admin-comments.js should not emit inline event handler attributes'
    );

    const delegatedMarkers = [
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
        'function renderBlockDropdownMenu(userId',
        'function bindAdminCommentsRuntimeDelegates()',
        "document.documentElement.dataset.adminCommentsRuntimeDelegatesBound === '1'",
        "case 'remove-filter':",
        "case 'toggle-pin':",
        "case 'toggle-block-dropdown':",
        "case 'block-user':",
        "case 'selection':"
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminCommentsSource.includes(marker), true, `admin-comments.js should contain ${marker}`);
    }
});

test('wallet modal runtime renderers route wallet shell, lists, filters, and order dialogs through delegated actions', () => {
    const walletModalSource = readRepoFile('js/components/WalletModal.js');
    const inlineHandlerPattern = /\bon(?:click|change|submit|input|keydown|keyup|mouseover|mouseout|error|load)\s*=\s*["']/i;

    assert.equal(
        inlineHandlerPattern.test(walletModalSource),
        false,
        'js/components/WalletModal.js should not emit inline event handler attributes'
    );

    const delegatedMarkers = [
        'bindDelegatedHandlers(overlay = this.modalEl)',
        'handleOpenOrderDetailAction(actionEl)',
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
        'js-wallet-copy-content',
        'wallet-copy-card',
        'bindOverlayCloseButtons(detailOverlay);'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(walletModalSource.includes(marker), true, `js/components/WalletModal.js should contain ${marker}`);
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

test('homepage admin runtime renderers route retry and section visibility controls through bound listeners', () => {
    const homepageAdminSource = readRepoFile('admin-homepage.js');
    const inlineHandlerPattern = /\bon(?:click|change|submit|input|keydown|keyup|mouseover|mouseout|error|load)\s*=\s*["']/i;

    assert.equal(
        inlineHandlerPattern.test(homepageAdminSource),
        false,
        'admin-homepage.js should not emit inline event handler attributes'
    );

    const delegatedMarkers = [
        'data-homepage-retry="1"',
        'js-homepage-retry-btn',
        'data-homepage-visibility="${visSection}"',
        'data-homepage-visibility="footer"',
        'function bindSectionVisibilityToggle(input, section)',
        "input.dataset.homepageVisibilityBound === '1'",
        "input.addEventListener('change', () => {",
        "loading.querySelector('[data-homepage-retry=\"1\"]')?.addEventListener('click'"
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(homepageAdminSource.includes(marker), true, `admin-homepage.js should contain ${marker}`);
    }
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
        'data-admin-overlay-close="discount-generate-modal"',
        'data-admin-action="discounts-toggle-type-dropdown"',
        'data-admin-action="discounts-select-type"',
        'data-admin-input-action="discounts-format-expiry-date"',
        'data-admin-input-action="discounts-format-expiry-time"',
        'data-admin-action="discounts-close-generate-modal"',
        'data-admin-action="discounts-submit-generate"',
        'data-admin-input-action="tickets-search"',
        'data-admin-action="tickets-filter"',
        'data-admin-overlay-close="ticket-reply-modal"',
        'data-admin-action="tickets-close-reply-modal"',
        'data-admin-action="tickets-submit-reply"'
    ];

    for (const marker of delegatedMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(adminStudioScript.includes('settings-select-decoration'), true, 'admin-studio.js should delegate settings decoration controls');
    assert.equal(adminStudioScript.includes('discounts-open-generate-modal'), true, 'admin-studio.js should delegate discount modal controls');
    assert.equal(adminStudioScript.includes('tickets-submit-reply'), true, 'admin-studio.js should delegate ticket reply submission');
    assert.equal(adminStudioScript.includes('[data-admin-input-action]'), true, 'admin-studio.js should delegate input-based admin controls');
    assert.equal(adminStudioScript.includes('[data-admin-overlay-close]'), true, 'admin-studio.js should delegate overlay dismissal');
    assert.equal(adminStudioScript.includes("form.id === 'discountGenerateForm'"), true, 'admin-studio.js should delegate discount generate form submission');
    assert.equal(adminStudioScript.includes("form.id === 'ticketReplyForm'"), true, 'admin-studio.js should delegate ticket reply form submission');

    const discountHelpers = [
        'closeGenerateModal: function',
        'toggleTypeDropdown: function',
        'selectDiscountType: function',
        'formatExpiryDateInput: function',
        'formatExpiryTimeInput: function'
    ];
    for (const marker of discountHelpers) {
        assert.equal(discountsSource.includes(marker), true, `admin-discounts.js should contain ${marker}`);
    }

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
        'data-admin-change-action="tickets-pagination-go"'
    ];

    for (const marker of delegatedTicketMarkers) {
        assert.equal(ticketsSource.includes(marker), true, `js/admin-tickets.js should contain ${marker}`);
    }

    const adminDelegationMarkers = [
        'discounts-copy-code',
        'discounts-toggle-status',
        'discounts-delete-code',
        'discounts-pagination-go',
        'tickets-pagination-go'
    ];

    for (const marker of adminDelegationMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should delegate ${marker}`);
    }
});

test('admin studio security, verify, affiliate, and experiment controls route through delegated actions', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminStudioScript = readRepoFile('admin-studio.js');
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
        'data-admin-focus-action="settings-verify-api-key-unlock"',
        'data-admin-blur-action="settings-verify-api-key-lock"',
        'data-admin-change-action="affiliate-save-setting"',
        'data-admin-change-action="affiliate-save-poster-field"',
        'data-admin-action="settings-add-api-key"',
        'data-admin-action="analytics-load-ai-prediction"',
        'data-admin-action="analytics-open-experiment-modal"',
        'data-admin-action="analytics-load-experiments-list"',
        'data-admin-action="analytics-close-ab-results-chart"',
        'data-admin-action="analytics-close-experiment-modal"',
        'data-admin-action="analytics-add-variant-row"'
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
        'settings-save-verify-config',
        'affiliate-save-setting',
        'affiliate-save-poster-field',
        'analytics-load-ai-prediction',
        'analytics-show-ab-results',
        '[data-admin-focus-action]',
        '[data-admin-blur-action]',
        "form.id === 'experimentForm'"
    ];

    for (const marker of adminScriptMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

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
    assert.equal(analyticsSource.includes('data-admin-action="analytics-show-ab-results"'), true, 'admin-analytics.js should render delegated experiment result buttons');
    assert.equal(analyticsSource.includes('data-admin-action="analytics-remove-variant-row"'), true, 'admin-analytics.js should render delegated variant removal buttons');
    assert.equal(analyticsSource.includes('window.loadAIPrediction = loadAIPrediction;'), true, 'admin-analytics.js should expose loadAIPrediction for delegated use');
    assert.equal(analyticsSource.includes('window.loadExperimentsList = loadExperimentsList;'), true, 'admin-analytics.js should expose loadExperimentsList for delegated use');
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
        'class="shop-order-row"',
        'shop-order-user-avatar',
        'shop-order-content-overlay',
        'shop-order-content-box',
        'data-shop-action="order-close-content"',
        'shop-refund-modal-overlay',
        'shop-refund-status-grid',
        'shop-refund-modal-textarea refund-modal-input',
        'shop-order-action-btn shop-order-action-btn--refund'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.shop-order-row',
        '.shop-order-content-overlay',
        '.shop-order-content-box',
        '.shop-refund-modal-overlay',
        '.shop-refund-status-grid',
        '.shop-refund-modal-textarea',
        '.shop-order-action-btn--refund'
    ];

    for (const marker of styleMarkers) {
        assert.equal(shopStyles.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }
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
        'shop-inventory-loading-cell',
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

    const styleMarkers = [
        '.shop-inventory-empty-cell',
        '.shop-inventory-loading-cell',
        '.shop-inventory-content-chip',
        '.shop-inventory-status-badge',
        '.shop-inventory-fault-overlay',
        '.shop-inventory-detail-overlay',
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

    assert.equal(
        adminStudioSource.includes('css/admin-studio-page.css?v=20260324_ADMIN_STUDIO_SHOP_RUNTIME_STYLE_ZERO_1'),
        true,
        'admin-studio.html should load the latest import/runtime stylesheet version'
    );
    assert.equal(
        adminStudioSource.includes('js/admin-shop.js?v=20260324_SHOP_RUNTIME_STYLE_ZERO_1'),
        true,
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
        'data-admin-action="analytics-export-data"',
        'data-admin-action="analytics-refresh-data"'
    ];

    for (const marker of delegatedHtmlMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

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

    for (const marker of delegatedHandlerMarkers.slice(0, 2)) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    for (const marker of delegatedHandlerMarkers.slice(2)) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    assert.equal(shopSource.includes('buildDeliveryDataAttributes: function (attributes = {})'), true, 'js/admin-shop.js should build delivery data attributes for delegated runtime templates');
});

test('analytics calendar and config poster/editor templates route through delegated actions', () => {
    const adminStudioScript = readRepoFile('admin-studio.js');
    const analyticsSource = readRepoFile('admin-analytics.js');
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
        'data-admin-action="analytics-inline-select-date"',
        'data-admin-action="analytics-range-select-date"',
        'data-admin-action="analytics-range-change-month"',
        'data-admin-action="analytics-range-reset"',
        'data-admin-action="analytics-range-apply"'
    ];

    for (const marker of analyticsMarkers) {
        assert.equal(analyticsSource.includes(marker), true, `admin-analytics.js should contain ${marker}`);
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
        "case 'analytics-range-select-date':",
        "case 'analytics-range-change-month':",
        "case 'analytics-range-reset':",
        "case 'analytics-range-apply':",
        "case 'settings-affiliate-poster-upload':"
    ];

    for (const marker of adminScriptMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }
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
        "sheet.style.removeProperty('max-height')"
    ];

    for (const marker of removedRuntimeMarkers) {
        assert.equal(promptsSource.includes(marker), false, `prompts-poetry.js should not retain ${marker}`);
    }

    const runtimeMarkers = [
        'gallery-toast--visible',
        "setPromptsDisplayState(loginBtn, false, 'prompts-display-flex')",
        'buildPromptsStaggerClass(i)',
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
        'setPromptsCssVars(sheet, {'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.gallery-toast',
        '.gallery-toast--visible',
        '.prompts-display-flex',
        '.prompts-nav-transition',
        '.featured-banner--revealed',
        '.prompts-pagination-nav',
        '.search-cooldown-msg',
        '.comment-header-title--expandable',
        '.comment-empty-subtitle--error',
        '.modal-img-nav.is-visible',
        '.poetry-modal.poetry-modal--visible',
        '.prompt-card.prompt-card-exiting',
        '.prompt-card.card-visible.prompt-card-stagger-11',
        '.prompt-status-bar-shield',
        '.prompt-status-bar-shield.prompt-status-bar-shield--visible',
        '.prompt-comment-composer-viewport-probe',
        '.prompts-theme-particle--spark',
        '.prompts-theme-particle--rain',
        '.prompts-theme-particle--snow',
        '.prompts-theme-particle--decor'
    ];

    for (const marker of styleMarkers) {
        assert.equal(promptsStyles.includes(marker), true, `prompts-poetry.css should contain ${marker}`);
    }

    assert.equal(
        promptsHtml.includes('prompts-poetry.css?v=20260324_PROMPTS_UI_STATE_STYLES_2'),
        true,
        'prompts.html should load the latest prompts gallery stylesheet version'
    );
    assert.equal(
        promptsHtml.includes('prompts-poetry.js?v=20260324_PROMPTS_UI_STATE_STYLES_3'),
        true,
        'prompts.html should load the latest prompts gallery runtime version'
    );
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
        "case 'site-filter-toggle-dropdown':",
        "case 'site-filter-select':"
    ];

    for (const marker of adminScriptMarkers) {
        assert.equal(adminStudioScript.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }
});

test('final frontend runtime remnants route through delegated or bound listeners instead of inline attributes', () => {
    const notificationSource = readRepoFile('notification-client.js');
    const announcementSource = readRepoFile('announcement-loader.js');
    const guestbookSource = readRepoFile('supabase-guestbook-functions.js');
    const adminStudioScript = readRepoFile('admin-studio.js');
    const shopSource = readRepoFile('js/admin-shop.js');

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
        'function handleDrawerClick(e)',
        'data-announcement-action="acknowledge"',
        "querySelector('[data-announcement-action=\"acknowledge\"]')?.addEventListener('click'",
        'data-guestbook-action="toggle-like"',
        `querySelectorAll('[data-guestbook-action="toggle-like"]')`,
        'data-admin-action="ai-remove-preview"',
        "case 'ai-remove-preview':"
    ];

    assert.equal(notificationSource.includes(delegatedMarkers[0]), true, 'notification-client.js should render a delegated clear-all control');
    assert.equal(notificationSource.includes(delegatedMarkers[1]), true, 'notification-client.js should handle delegated drawer actions');
    assert.equal(announcementSource.includes(delegatedMarkers[2]), true, 'announcement-loader.js should render a bound acknowledge action');
    assert.equal(announcementSource.includes(delegatedMarkers[3]), true, 'announcement-loader.js should bind the acknowledge button');
    assert.equal(guestbookSource.includes(delegatedMarkers[4]), true, 'supabase-guestbook-functions.js should render delegated like actions');
    assert.equal(guestbookSource.includes(delegatedMarkers[5]), true, 'supabase-guestbook-functions.js should bind fallback like actions');
    assert.equal(adminStudioScript.includes(delegatedMarkers[6]), true, 'admin-studio.js should render delegated preview removal controls');
    assert.equal(adminStudioScript.includes(delegatedMarkers[7]), true, 'admin-studio.js should handle delegated preview removal controls');
});
