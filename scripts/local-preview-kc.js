#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const express = require('express');

const repoRoot = path.resolve(__dirname, '..');
const kcRoot = path.join(repoRoot, 'services', 'kc-pay-gpt');
const kcPublic = path.join(kcRoot, 'public');

function resolveLocalPreviewSourceState(root) {
    try {
        const git = (args) => execFileSync('git', ['-C', path.resolve(root), ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();

        const status = git(['status', '--porcelain', '--untracked-files=normal']);
        return {
            service: 'kc-pay-gpt',
            sourceCommit: git(['rev-parse', 'HEAD']),
            sourceBranch: git(['branch', '--show-current']) || 'detached',
            sourceMode: 'working-tree',
            workingTreeDirty: Boolean(status),
            changedFileCount: status ? status.split('\n').filter(Boolean).length : 0,
            backend: 'preview-mock',
            payments: 'mock-only'
        };
    } catch (_) {
        return {
            service: 'kc-pay-gpt',
            sourceCommit: 'unknown',
            sourceBranch: 'unknown',
            sourceMode: 'working-tree',
            workingTreeDirty: null,
            changedFileCount: null,
            backend: 'preview-mock',
            payments: 'mock-only'
        };
    }
}

function createKcPreviewApp(options = {}) {
    const app = express();
    const port = Number(options.port || process.env.PORT || 3100);
    const sourceState = resolveLocalPreviewSourceState(repoRoot);

    app.disable('x-powered-by');

    // Prevent caching in local preview
    app.use((_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('X-Local-Preview-Service', 'kc-pay-gpt');
        res.setHeader('X-Local-Preview-Source-Commit', sourceState.sourceCommit);
        next();
    });

    app.use(express.json({ limit: '15mb' }));
    app.use(express.urlencoded({ extended: false, limit: '15mb' }));

    // Preview diagnostics endpoint (Rule 6 compliant)
    app.get('/__preview', (_req, res) => {
        const current = resolveLocalPreviewSourceState(repoRoot);
        res.json(current);
    });

    app.get('/healthz', (_req, res) => {
        res.json({
            status: 'ok',
            service: 'kc-preview-server',
            port,
            ...resolveLocalPreviewSourceState(repoRoot)
        });
    });

    // In-memory mock data stores for admin interactions
    let globalCardMaxUsageLimit = 10;
    const mockCards = [
        {
            id: 1,
            card_number: '4859********1234',
            card_expiry: '12/28',
            card_cvc: '***',
            card_holder: 'JOHN DOE',
            usage_count: 8,
            max_usage_limit: 10,
            status: '正常',
            is_active: 1,
            in_use: 0,
            daily_usage_count: 2,
            created_at: '2026-11-01 10:00:00'
        },
        {
            id: 2,
            card_number: '5520********5678',
            card_expiry: '06/29',
            card_cvc: '***',
            card_holder: 'ALICE SMITH',
            usage_count: 15,
            max_usage_limit: 15,
            status: '已达上限',
            is_active: 0,
            in_use: 0,
            daily_usage_count: 0,
            created_at: '2026-11-02 12:30:00'
        },
        {
            id: 3,
            card_number: '4000********9876',
            card_expiry: '09/27',
            card_cvc: '***',
            card_holder: 'BOB WILSON',
            usage_count: 3,
            max_usage_limit: 0,
            status: '正常',
            is_active: 1,
            in_use: 0,
            daily_usage_count: 1,
            created_at: '2026-11-05 16:45:00'
        }
    ];

    const mockUnconfirmedAutoRenewTasks = [
        {
            job_key: 'task-preview-renewal-warn-001',
            platform: 'chatgpt',
            email: 'user-warn@fatherkey.com',
            card_last4: '1234',
            auto_renew_status: 'unconfirmed',
            auto_renew_message: '自动续费取消结果未确认，需人工在 OpenAI 账单核查',
            updated_at: '2026-11-10 09:15:00'
        }
    ];

    const mockCdks = [
        {
            id: 1,
            cdk_code: 'KC-PLUS-DEMO-001',
            plan_type: 'chatgpt_plus',
            status: 'used',
            card_last4: '1234',
            auto_renew_status: 'cancelled',
            auto_renew_message: '自动续费已成功取消',
            used_at: '2026-11-10 08:30:00',
            created_at: '2026-11-09 14:00:00'
        },
        {
            id: 2,
            cdk_code: 'KC-TEAM-DEMO-002',
            plan_type: 'chatgpt_team',
            status: 'used',
            card_last4: '5678',
            auto_renew_status: 'unconfirmed',
            auto_renew_message: '自动续费状态未确认',
            used_at: '2026-11-10 09:15:00',
            created_at: '2026-11-09 15:00:00'
        },
        {
            id: 3,
            cdk_code: 'KC-CLAUDE-DEMO-003',
            plan_type: 'claude_pro',
            status: 'unused',
            card_last4: null,
            auto_renew_status: null,
            auto_renew_message: null,
            used_at: null,
            created_at: '2026-11-10 10:00:00'
        },
        {
            id: 4,
            cdk_code: 'KC-GROK-DEMO-004',
            plan_type: 'grok_bundle_super_annual',
            status: 'unused',
            card_last4: null,
            auto_renew_status: null,
            auto_renew_message: null,
            used_at: null,
            created_at: '2026-11-10 10:05:00'
        }
    ];

    // ==========================================
    // Public / Client API Routes
    // ==========================================
    app.get('/api/public/admin-paths', (_req, res) => {
        res.json({
            success: true,
            loginPath: '/admin-login',
            panelPath: '/admin',
            loginUrl: '/admin-login',
            panelUrl: '/admin'
        });
    });

    app.post('/api/cdk/query', (req, res) => {
        const cdk = String(req.body?.cdk || '').trim();
        const matched = mockCdks.find(c => c.cdk_code === cdk);
        res.json({
            success: true,
            valid: true,
            cdk: cdk || 'KC-PLUS-DEMO-001',
            plan_type: matched ? matched.plan_type : 'chatgpt_plus',
            status: matched ? matched.status : 'unused',
            platform: 'chatgpt'
        });
    });

    app.post('/api/verify-cdk', (req, res) => {
        const cdk = String(req.body?.cdk || '').trim();
        const matched = mockCdks.find(c => c.cdk_code === cdk);
        res.json({
            success: true,
            valid: true,
            planType: matched ? matched.plan_type : 'chatgpt_plus'
        });
    });

    app.post('/api/public/probe-account', (req, res) => {
        res.json({
            success: true,
            email: 'preview-user@fatherkey.com',
            eligible: true,
            accountStatus: 'ready'
        });
    });

    app.post('/api/run-process', (req, res) => {
        res.json({
            success: true,
            jobKey: `preview-job-${Date.now()}`,
            taskAccessToken: 'preview-task-access-token',
            status: 'running',
            progress: 10,
            message: '本地预览模式：任务模拟启动成功'
        });
    });

    app.all('/api/public/task/:jobKey/*', (req, res) => {
        res.json({ success: true, handled: true });
    });

    // ==========================================
    // Admin Auth API Routes
    // ==========================================
    app.post('/api/admin/login', (req, res) => {
        res.json({
            success: true,
            token: 'kc-preview-admin-token-2026',
            requires2fa: false,
            message: '本地预览环境：登录成功'
        });
    });

    app.get('/api/admin/session', (_req, res) => {
        res.json({
            ok: true,
            success: true,
            user: { email: 'admin@fatherkey.com', role: 'admin' },
            expiresAt: Date.now() + 86400000,
            refreshed: false
        });
    });

    app.post('/api/admin/secondary/challenge', (_req, res) => {
        res.json({ success: true, challengeId: 'preview-challenge', method: 'totp' });
    });

    app.post('/api/admin/verify-secondary', (_req, res) => {
        res.json({ success: true, secondaryToken: 'preview-secondary-token' });
    });

    // ==========================================
    // Admin Management API Routes
    // ==========================================
    app.get('/api/admin/data', (_req, res) => {
        res.json({
            success: true,
            runtime: {
                system: {
                    cpu: { percent: 18, text: '实时 CPU 使用率: 18%' },
                    memory: { percent: 42, text: '4.2G/16.0G' },
                    disk: { percent: 38, usedText: '38G', totalText: '100G', drive: '/' },
                    uptime: { seconds: 7200 }
                },
                active_foreground_jobs: 0,
                max_foreground_jobs: 4,
                browser_pool: { enabled: true, size: 2, idle: 2, waiting: 0 }
            },
            stats: {
                total: 128,
                success: 118,
                failed: 10,
                cdk_total: mockCdks.length,
                cdk_used: mockCdks.filter(c => c.status === 'used').length,
                cdk_unused: mockCdks.filter(c => c.status !== 'used').length,
                billing_revenue: 2360.00,
                billing_currency: 'USD',
                billing_paid_count: 118
            },
            config: {
                card_pool: mockCards,
                max_concurrent_activations: 4,
                maintenance_mode: false,
                max_usage_limit: globalCardMaxUsageLimit
            },
            telegram: { enabled: false },
            hcaptcha: { enabled: true }
        });
    });

    // Cards API (PR #704 features)
    app.get('/api/admin/cards', (_req, res) => {
        res.json({
            success: true,
            cards: mockCards,
            config: {
                max_usage_limit: globalCardMaxUsageLimit
            },
            unconfirmed_auto_renew: {
                count: mockUnconfirmedAutoRenewTasks.length,
                tasks: mockUnconfirmedAutoRenewTasks
            }
        });
    });

    app.put('/api/admin/cards/max-usage-limit', (req, res) => {
        const limit = Number(req.body?.max_usage_limit);
        globalCardMaxUsageLimit = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 0;
        res.json({
            success: true,
            max_usage_limit: globalCardMaxUsageLimit,
            message: `全局单卡上限已更新为 ${globalCardMaxUsageLimit || '无限制'}`
        });
    });

    app.get('/api/admin/cards/:id/secret', (req, res) => {
        const card = mockCards.find(c => String(c.id) === String(req.params.id)) || mockCards[0];
        res.json({
            success: true,
            card: {
                card_number: '4859 1234 5678 9012',
                card_expiry: card.card_expiry,
                card_cvc: '123'
            }
        });
    });

    // CDKs API (PR #704 features)
    app.get('/api/admin/cdks', (_req, res) => {
        res.json({
            success: true,
            cdks: mockCdks
        });
    });

    // Renewal statuses API (PR #704 features)
    app.get('/api/admin/subscription/batch-renewal-status', (_req, res) => {
        const statuses = {};
        mockUnconfirmedAutoRenewTasks.forEach(task => {
            statuses[task.job_key] = {
                status: task.auto_renew_status,
                message: task.auto_renew_message
            };
        });
        res.json({
            success: true,
            statuses
        });
    });

    // Additional admin panels
    app.get('/api/admin/config', (_req, res) => {
        res.json({
            success: true,
            config: {
                max_concurrent_activations: 4,
                maintenance_mode: false,
                region: 'US',
                billing_country: 'US'
            }
        });
    });

    app.get('/api/admin/region', (_req, res) => {
        res.json({
            success: true,
            region: 'US',
            label: '美国 (Oregon 免税州)',
            currency: 'USD'
        });
    });

    app.put('/api/admin/region', (req, res) => {
        const region = String(req.body?.region || 'US');
        res.json({
            success: true,
            region,
            label: region === 'PH' ? '菲律宾' : '美国',
            currency: region === 'PH' ? 'PHP' : 'USD'
        });
    });

    app.get('/api/admin/proxies', (_req, res) => {
        res.json({
            success: true,
            proxies: [
                { id: 1, proxy_url: 'socks5://127.0.0.1:1080', region: 'US', status: '正常', latency_ms: 120 }
            ]
        });
    });

    app.get('/api/admin/browser-pool', (_req, res) => {
        res.json({
            success: true,
            enabled: true,
            size: 2,
            maxSize: 24,
            basePort: 19222,
            slots: [
                { index: 0, port: 19222, status: 'idle', task: null },
                { index: 1, port: 19223, status: 'idle', task: null }
            ]
        });
    });

    app.get('/api/admin/task-logs', (_req, res) => {
        res.json({
            success: true,
            tasks: [],
            total: 0
        });
    });

    app.get('/api/admin/runtime-logs', (_req, res) => {
        res.json({
            success: true,
            entries: [
                { id: 1, time: new Date().toISOString(), level: 'system', source: 'server', text: '[kc-preview] 本地预览环境运行就绪' }
            ],
            nextAfter: 1
        });
    });

    app.get('/api/admin/security/status', (_req, res) => {
        res.json({
            success: true,
            twoFaEnabled: false,
            methods: ['totp']
        });
    });

    app.get('/api/admin/billing/failed', (_req, res) => {
        res.json({
            success: true,
            records: []
        });
    });

    app.get('/api/admin/gpt-api', (_req, res) => {
        res.json({ success: true, config: { enabled: false } });
    });

    app.get('/api/admin/gpt-api/status', (_req, res) => {
        res.json({ success: true, status: 'idle' });
    });

    app.get('/api/admin/gpt-api/orders', (_req, res) => {
        res.json({ success: true, orders: [], total: 0 });
    });

    app.get('/api/admin/checkout/plans', (_req, res) => {
        res.json({
            success: true,
            platforms: [
                { id: 'chatgpt', name: 'ChatGPT', plans: [{ id: 'plus', label: 'Plus' }, { id: 'team', label: 'Team' }] },
                { id: 'claude', name: 'Claude', plans: [{ id: 'claude_pro', label: 'Claude Pro' }] },
                { id: 'grok', name: 'Grok', plans: [{ id: 'grok_super', label: 'SuperGrok' }] }
            ]
        });
    });

    app.get('/api/admin/checkout/history', (_req, res) => {
        res.json({ success: true, reports: [], total: 0 });
    });

    // ==========================================
    // Page Routing
    // ==========================================
    app.get('/', (_req, res) => {
        res.sendFile(path.join(kcPublic, 'index.html'));
    });

    app.get(['/admin', '/admin.html'], (_req, res) => {
        res.sendFile(path.join(kcPublic, 'admin.html'));
    });

    app.get(['/admin-login', '/admin-login.html'], (_req, res) => {
        res.sendFile(path.join(kcPublic, 'admin-login.html'));
    });

    app.get(['/subscription', '/subscription.html'], (_req, res) => {
        res.sendFile(path.join(kcPublic, 'subscription.html'));
    });

    // Static assets inside services/kc-pay-gpt/public
    app.use(express.static(kcPublic, {
        extensions: ['html'],
        etag: false,
        lastModified: false,
        cacheControl: false
    }));

    return {
        app,
        port,
        sourceState
    };
}

function startKcPreviewServer(options = {}) {
    const port = Number(options.port || process.env.PORT || 3100);
    const { app, sourceState } = createKcPreviewApp({ port });
    const server = http.createServer(app);

    // Attach mock WebSocket server for status monitoring & live updates
    try {
        let WebSocketServer;
        try {
            WebSocketServer = require('ws').Server;
        } catch (_) {
            const wsPath = path.join(kcRoot, 'node_modules', 'ws');
            WebSocketServer = require(wsPath).Server;
        }

        if (WebSocketServer) {
            const wss = new WebSocketServer({ server });
            wss.on('connection', (ws) => {
                ws.send(JSON.stringify({ type: 'connected', time: Date.now() }));
                ws.on('message', (raw) => {
                    try {
                        const data = JSON.parse(String(raw));
                        if (data.type === 'ping') {
                            ws.send(JSON.stringify({ type: 'pong' }));
                        } else if (data.type === 'subscribe') {
                            ws.send(JSON.stringify({
                                type: 'snapshot',
                                jobKey: data.jobKey,
                                status: 'running',
                                progress: 50,
                                message: '任务状态监控正常（预览模式）'
                            }));
                        }
                    } catch (_) {}
                });
            });
        }
    } catch (err) {
        console.warn(`[kc-preview] WebSocket initialization skipped: ${err.message}`);
    }

    server.listen(port, '0.0.0.0', () => {
        console.log(`[kc-preview] source-commit=${sourceState.sourceCommit}`);
        console.log(`[kc-preview] source-mode=${sourceState.sourceMode} branch=${sourceState.sourceBranch} dirty=${sourceState.workingTreeDirty} changed-files=${sourceState.changedFileCount}`);
        console.log(`[kc-preview] KC 用户前台兑换页:   http://localhost:${port}/`);
        console.log(`[kc-preview] KC 控制台管理后台:   http://localhost:${port}/admin`);
        console.log(`[kc-preview] KC 后台登录页面:     http://localhost:${port}/admin-login`);
        console.log(`[kc-preview] KC 订阅查询页面:     http://localhost:${port}/subscription`);
        console.log(`[kc-preview] 预览诊断接口:         http://localhost:${port}/__preview`);
    });

    return { server, port, sourceState };
}

if (require.main === module) {
    startKcPreviewServer();
}

module.exports = {
    createKcPreviewApp,
    startKcPreviewServer,
    resolveLocalPreviewSourceState
};
