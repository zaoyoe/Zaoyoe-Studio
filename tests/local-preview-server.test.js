const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveLocalPreviewRuntimeScript } = require('../scripts/local-preview-server');

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
