#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');

const { buildSupabaseRuntimeScript } = require('../api/_lib/public-runtime-config');
const adminApiHandler = require('../api/admin');

function getDefaultEnvFiles(repoRoot) {
    return [
        path.join(repoRoot, 'server/.env.staging'),
        path.join(repoRoot, 'server/.env'),
        path.join(repoRoot, '.env'),
        path.join(repoRoot, '.env.local')
    ];
}

function loadPreviewEnv(envFiles, baseEnv = process.env) {
    const merged = {};

    envFiles.forEach((filePath) => {
        if (!fs.existsSync(filePath)) {
            return;
        }

        const parsed = dotenv.parse(fs.readFileSync(filePath, 'utf8'));
        Object.assign(merged, parsed);
    });

    return {
        ...merged,
        ...baseEnv
    };
}

function resolveLocalPreviewRuntimeScript(envFiles, baseEnv = process.env) {
    try {
        return buildSupabaseRuntimeScript(loadPreviewEnv(envFiles, baseEnv));
    } catch (error) {
        const message = JSON.stringify(error.message || 'Failed to resolve local preview runtime config');
        return [
            '(function (global) {',
            `  console.error('Local preview runtime config error:', ${message});`,
            '  global.__ZAOYOE_SUPABASE_CONFIG__ = null;',
            '}(typeof window !== "undefined" ? window : globalThis));'
        ].join('\n');
    }
}

function buildLocalPreviewAdminHandlerUrl(rawUrl = '/api/admin') {
    const incomingUrl = new URL(String(rawUrl || '/api/admin'), 'http://127.0.0.1:8000');
    const routePath = incomingUrl.pathname
        .replace(/^\/api\/admin\/?/, '')
        .replace(/^\/+|\/+$/g, '');
    const handlerUrl = new URL('/api/admin', incomingUrl.origin);

    if (routePath) {
        handlerUrl.searchParams.set('route', routePath);
    }

    incomingUrl.searchParams.forEach((value, key) => {
        if (key === 'route') {
            return;
        }
        handlerUrl.searchParams.append(key, value);
    });

    return `${handlerUrl.pathname}${handlerUrl.search}`;
}

function applyPreviewEnvToProcess(envValues = {}) {
    Object.entries(envValues).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            return;
        }

        if (!process.env[key]) {
            process.env[key] = String(value);
        }
    });
}

function createLocalPreviewApp(options = {}) {
    const app = express();
    const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, '..'));
    const port = Math.max(1, Number(options.port || process.env.PORT || 8000));
    const envFiles = options.envFiles || getDefaultEnvFiles(repoRoot);
    const baseEnv = options.baseEnv || process.env;
    const previewEnv = loadPreviewEnv(envFiles, baseEnv);

    applyPreviewEnvToProcess(previewEnv);

    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));

    app.get('/healthz', (req, res) => {
        res.json({
            status: 'ok',
            service: 'local-preview-server',
            port
        });
    });

    app.get('/api/runtime/supabase-config', (req, res) => {
        const script = resolveLocalPreviewRuntimeScript(envFiles, baseEnv);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send(script);
    });

    app.all('/api/admin', async (req, res) => {
        req.url = buildLocalPreviewAdminHandlerUrl(req.originalUrl || req.url);
        return adminApiHandler(req, res);
    });

    app.all('/api/admin/*', async (req, res) => {
        req.url = buildLocalPreviewAdminHandlerUrl(req.originalUrl || req.url);
        return adminApiHandler(req, res);
    });

    app.use(express.static(repoRoot, {
        extensions: ['html']
    }));

    app.get('/', (req, res) => {
        res.sendFile(path.join(repoRoot, 'index.html'));
    });

    return {
        app,
        port
    };
}

if (require.main === module) {
    const { app, port } = createLocalPreviewApp();
    app.listen(port, '127.0.0.1', () => {
        console.log(`[local-preview] http://127.0.0.1:${port}`);
    });
}

module.exports = {
    applyPreviewEnvToProcess,
    buildLocalPreviewAdminHandlerUrl,
    createLocalPreviewApp,
    getDefaultEnvFiles,
    loadPreviewEnv,
    resolveLocalPreviewRuntimeScript
};
