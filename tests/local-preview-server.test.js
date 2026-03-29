const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    applyPreviewEnvToProcess,
    buildLocalPreviewAdminHandlerUrl,
    resolveLocalPreviewRuntimeScript
} = require('../scripts/local-preview-server');

test('local preview server serves Supabase runtime config from local env files', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preview-server-'));
    fs.mkdirSync(path.join(tempRoot, 'server'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'server/.env.staging'), [
        'SUPABASE_URL=https://staging.supabase.co',
        'SUPABASE_PUBLISHABLE_KEY=staging-key'
    ].join('\n'));
    fs.writeFileSync(path.join(tempRoot, '.env.local'), [
        'SUPABASE_URL=https://local.supabase.co',
        'SUPABASE_PUBLISHABLE_KEY=local-key'
    ].join('\n'));
    fs.writeFileSync(path.join(tempRoot, 'index.html'), '<!doctype html><title>preview</title>');

    const body = resolveLocalPreviewRuntimeScript([
        path.join(tempRoot, 'server/.env.staging'),
        path.join(tempRoot, '.env.local')
    ], {});

    assert.match(body, /__ZAOYOE_SUPABASE_CONFIG__/);
    assert.match(body, /https:\/\/local\.supabase\.co/);
    assert.match(body, /local-key/);
});

test('local preview server returns executable fallback script when public config is missing', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preview-server-missing-'));
    fs.writeFileSync(path.join(tempRoot, 'index.html'), '<!doctype html><title>preview</title>');

    const body = resolveLocalPreviewRuntimeScript([], {});

    assert.match(body, /Local preview runtime config error/);
    assert.match(body, /__ZAOYOE_SUPABASE_CONFIG__ = null/);
});

test('local preview server rewrites nested admin routes into the shared admin handler format', () => {
    const rewrittenUrl = buildLocalPreviewAdminHandlerUrl('/api/admin/access/session?foo=bar');

    assert.equal(rewrittenUrl, '/api/admin?route=access%2Fsession&foo=bar');
});

test('local preview server seeds process env from loaded preview values without clobbering existing vars', () => {
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    const originalMarker = process.env.LOCAL_PREVIEW_TEST_MARKER;

    process.env.LOCAL_PREVIEW_TEST_MARKER = 'keep-me';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;

    try {
        applyPreviewEnvToProcess({
            SUPABASE_URL: 'https://preview.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'preview-key',
            LOCAL_PREVIEW_TEST_MARKER: 'replace-me'
        });

        assert.equal(process.env.SUPABASE_URL, 'https://preview.supabase.co');
        assert.equal(process.env.SUPABASE_PUBLISHABLE_KEY, 'preview-key');
        assert.equal(process.env.LOCAL_PREVIEW_TEST_MARKER, 'keep-me');
    } finally {
        if (originalUrl === undefined) {
            delete process.env.SUPABASE_URL;
        } else {
            process.env.SUPABASE_URL = originalUrl;
        }

        if (originalKey === undefined) {
            delete process.env.SUPABASE_PUBLISHABLE_KEY;
        } else {
            process.env.SUPABASE_PUBLISHABLE_KEY = originalKey;
        }

        if (originalMarker === undefined) {
            delete process.env.LOCAL_PREVIEW_TEST_MARKER;
        } else {
            process.env.LOCAL_PREVIEW_TEST_MARKER = originalMarker;
        }
    }
});
