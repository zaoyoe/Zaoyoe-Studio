#!/usr/bin/env node
'use strict';

// Tunnel this listener, never the preview server with its admin endpoints.
const http = require('node:http');
const PATHS = new Set(['/api/tg/purchase/webhooks/zpay', '/api/tg/purchase/webhooks/nowpayments']);

function createTgLocalPaymentRelay({ targetPort = 8000 } = {}) {
    return http.createServer(async (req, res) => {
        const reject = (status) => { res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end('error'); };
        let url;
        try { url = new URL(req.url, 'http://relay.local'); } catch (_) { return reject(400); }
        if (url.pathname === '/_tg-payment-health') {
            const challenge = url.searchParams.get('challenge');
            if (req.method !== 'GET') return reject(405);
            if (!/^[a-f0-9]{32}$/.test(challenge || '') || [...url.searchParams.keys()].some(key => key !== 'challenge')) return reject(400);
            try {
                const response = await fetch(`http://127.0.0.1:${targetPort}/healthz`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
                const data = await response.json();
                if (!response.ok || data.status !== 'ok' || data.service !== 'local-preview-server') return reject(503);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
                return res.end(JSON.stringify({ service: 'tg-local-payment-relay', status: 'ok', challenge }));
            } catch (_) { return reject(503); }
        }
        if (!PATHS.has(url.pathname)) return reject(404);
        if (!['GET', 'POST'].includes(req.method) || (url.pathname.endsWith('/nowpayments') && req.method !== 'POST')) return reject(405);
        // The preview router accepts query-based routing too. Prevent tunnelling
        // to any other handler through scope/route/path query overrides.
        if (['scope', 'route', 'path'].some(key => url.searchParams.has(key))) return reject(400);
        try {
            const chunks = []; let size = 0;
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 16384) return reject(413);
                chunks.push(chunk);
            }
            const body = Buffer.concat(chunks);
            const headers = { 'content-length': String(body.length) };
            for (const key of ['content-type', 'x-nowpayments-sig']) if (req.headers[key]) headers[key] = req.headers[key];
            const upstream = http.request({ hostname: '127.0.0.1', port: targetPort, path: url.pathname + url.search, method: req.method, headers }, response => {
                res.writeHead(response.statusCode, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
                response.pipe(res);
            });
            upstream.setTimeout(20000, () => upstream.destroy());
            upstream.on('error', () => { if (!res.headersSent) reject(502); else res.destroy(); });
            res.on('close', () => upstream.destroy());
            upstream.end(body);
        } catch (_) { if (!res.headersSent) reject(400); }
    });
}

if (require.main === module) {
    createTgLocalPaymentRelay().listen(8012, '127.0.0.1', () => {
        console.log('[tg-payment-relay] signed TG payment webhooks only; http://127.0.0.1:8012');
    });
}

module.exports = { createTgLocalPaymentRelay };
