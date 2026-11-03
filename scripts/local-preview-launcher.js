#!/usr/bin/env node

'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const {
    getDefaultEnvFiles,
    loadPreviewEnv,
    resolveLocalPreviewSupabaseProxy
} = require('./local-preview-server');

const repoRoot = path.resolve(__dirname, '..');
const previewEnv = loadPreviewEnv(getDefaultEnvFiles(repoRoot), process.env);
const supabaseProxy = resolveLocalPreviewSupabaseProxy(previewEnv);
const childEnv = { ...process.env };

if (supabaseProxy) {
    childEnv.HTTPS_PROXY = supabaseProxy;
    childEnv.LOCAL_PREVIEW_SUPABASE_PROXY = supabaseProxy;
}

const noProxyEntries = [previewEnv.NO_PROXY, previewEnv.no_proxy, 'localhost', '127.0.0.1', '::1', '.localhost']
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
childEnv.NO_PROXY = [...new Set(noProxyEntries)].join(',');
childEnv.no_proxy = childEnv.NO_PROXY;

const nodeArgs = [];
if (supabaseProxy && process.allowedNodeEnvironmentFlags.has('--use-env-proxy')) {
    nodeArgs.push('--use-env-proxy');
} else if (supabaseProxy) {
    console.warn('[local-preview-launcher] this Node version does not support --use-env-proxy; Supabase requests may not use the system proxy');
}
nodeArgs.push(path.join(__dirname, 'local-preview-server.js'), ...process.argv.slice(2));

const preview = spawn(process.execPath, nodeArgs, {
    cwd: repoRoot,
    env: childEnv,
    stdio: 'inherit'
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        stopping = true;
        preview.kill(signal);
    });
}

preview.once('error', (error) => {
    console.error(`[local-preview-launcher] failed to start preview: ${error.message}`);
    process.exitCode = 1;
});

preview.once('exit', (code, signal) => {
    if (signal && !stopping) {
        console.error(`[local-preview-launcher] preview exited on ${signal}`);
    }
    process.exitCode = Number.isInteger(code) ? code : (signal ? 1 : 0);
});
