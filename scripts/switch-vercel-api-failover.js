#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERCEL_CONFIG_PATH = path.resolve(__dirname, '../vercel.json');
const KVM4_REWRITES = Object.freeze([
    {
        source: '/api/admin',
        destination: 'https://verify-api.fatherkey.com/api/admin'
    },
    {
        source: '/api/admin/:path*',
        destination: 'https://verify-api.fatherkey.com/api/admin/:path*'
    },
    {
        source: '/api/payments/:path*',
        destination: 'https://verify-api.fatherkey.com/api/payments/:path*'
    },
    {
        source: '/api/shop/:path*',
        destination: 'https://verify-api.fatherkey.com/api/shop/:path*'
    },
    {
        source: '/api/wallet/:path*',
        destination: 'https://verify-api.fatherkey.com/api/wallet/:path*'
    },
    {
        source: '/api/tg/:path*',
        destination: 'https://verify-api.fatherkey.com/api/tg/:path*'
    },
    {
        source: '/api/ops/:path*',
        destination: 'https://verify-api.fatherkey.com/api/ops/:path*'
    },
    {
        source: '/api/marketplace/:path*',
        destination: 'https://verify-api.fatherkey.com/api/marketplace/:path*'
    }
]);

function isKvm4ProxyRewrite(entry) {
    return typeof entry?.destination === 'string'
        && entry.destination.startsWith('https://verify-api.fatherkey.com/api/');
}

function computeFailoverRewrites(currentRewrites = [], mode = 'status') {
    const normalizedMode = String(mode || 'status').trim().toLowerCase();
    const withoutKvm4 = (Array.isArray(currentRewrites) ? currentRewrites : []).filter(
        (entry) => !isKvm4ProxyRewrite(entry)
    );

    if (normalizedMode === 'vercel-serverless') {
        const hasDirectAdminRoot = withoutKvm4.some(
            (entry) => entry?.source === '/api/admin' && entry?.destination === '/api/admin'
        );
        return hasDirectAdminRoot
            ? withoutKvm4
            : [{ source: '/api/admin', destination: '/api/admin' }, ...withoutKvm4];
    }

    if (normalizedMode === 'kvm4') {
        const cleaned = withoutKvm4.filter(
            (entry) => !(entry?.source === '/api/admin' && entry?.destination === '/api/admin')
        );
        return [...KVM4_REWRITES, ...cleaned];
    }

    throw new Error(`Unsupported failover mode: ${mode}`);
}

function getFailoverStatus(config = {}) {
    const rewrites = Array.isArray(config?.rewrites) ? config.rewrites : [];
    const activeKvm4Count = rewrites.filter(isKvm4ProxyRewrite).length;
    return {
        mode: activeKvm4Count > 0 ? 'kvm4' : 'vercel-serverless',
        activeKvm4ProxyRoutes: activeKvm4Count
    };
}

function runCli(argv = process.argv.slice(2)) {
    let mode = 'status';
    let write = false;
    let configPath = VERCEL_CONFIG_PATH;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--status') {
            mode = 'status';
        } else if (arg === '--mode' && argv[index + 1]) {
            mode = argv[index + 1];
            index += 1;
        } else if (arg === '--write') {
            write = true;
        } else if (arg === '--config' && argv[index + 1]) {
            configPath = path.resolve(argv[index + 1]);
            index += 1;
        }
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (mode === 'status') {
        const status = getFailoverStatus(config);
        console.log(JSON.stringify({ ok: true, ...status }));
        return status;
    }

    const updatedRewrites = computeFailoverRewrites(config.rewrites, mode);
    const nextConfig = {
        ...config,
        rewrites: updatedRewrites
    };

    if (write) {
        fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 4)}\n`, 'utf8');
    }

    const status = getFailoverStatus(nextConfig);
    console.log(JSON.stringify({ ok: true, written: write, ...status }));
    return status;
}

if (require.main === module) {
    runCli();
}

module.exports = {
    KVM4_REWRITES,
    computeFailoverRewrites,
    getFailoverStatus,
    isKvm4ProxyRewrite,
    runCli
};
