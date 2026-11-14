import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const storePath = new URL('../mysql-store.js', import.meta.url);
const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const adminHtml = fs.readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const { formatTaskErrorMessage } = require('../public/task-messages.js');

function storeHarness({ taskRow = null, cdkRows = [], runningRows = [], usageRows = [] } = {}) {
    const executed = [];
    const query = vi.fn(async (sql, params = []) => {
        const text = String(sql);
        if (text.includes('SELECT * FROM cdk_codes WHERE cdk_code')) {
            return [[{ cdk_code: 'KC-TEST-1', is_active: 1, used_at: '2026-11-14 20:07:25', type: '自助', platform: 'chatgpt', plan_type: 'plus' }]];
        }
        if (text.includes('SELECT job_key FROM task_logs WHERE cdk_code')) {
            return [[{ job_key: taskRow?.job_key || 'job-decline-1' }]];
        }
        if (text.includes('SELECT * FROM task_logs WHERE job_key')) {
            return [taskRow ? [{ ...taskRow }] : []];
        }
        if (text.includes('FROM task_logs provider_task')) return [[]];
        if (text.includes('FROM cdk_codes c')) return [cdkRows];
        if (text.includes('GROUP BY cdk_code')) return [runningRows];
        if (text.includes('INNER JOIN cdk_codes c ON l.cdk_code = c.cdk_code')) return [usageRows];
        if (text.includes('FROM task_logs') && text.includes('WHERE cdk_code = ?')) return [usageRows];
        return [[]];
    });
    const execute = vi.fn(async (sql, params = []) => {
        executed.push({ sql: String(sql), params });
        return [{ affectedRows: 1 }];
    });
    const connection = {
        query,
        execute,
        beginTransaction: vi.fn(async () => {}),
        commit: vi.fn(async () => {}),
        rollback: vi.fn(async () => {}),
        release: vi.fn()
    };
    const pool = { execute, query, getConnection: vi.fn(async () => connection) };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(storePath, 'utf8'), {
        module,
        exports: module.exports,
        __dirname: path.dirname(storePath.pathname),
        process: { env: {} },
        Buffer,
        console,
        require: key => key === 'mysql2/promise'
            ? { createPool: () => pool }
            : require(key.startsWith('.') ? new URL(`../${key}`, import.meta.url).pathname : key)
    });
    return { store: module.exports, executed, query, execute };
}

describe('confirmed decline rollback & CDK usage records contract', () => {
    it('rolls back local CDK and clears recovery_required when started converges to declined', async () => {
        const h = storeHarness({
            taskRow: {
                id: 1,
                job_key: 'job-decline-1',
                cdk_code: 'KC-TEST-1',
                status: 'running',
                payment_state: 'started',
                recovery_required: 1,
                execution_mode: 'local_card_pool',
                finished_at: null
            }
        });
        const res = await h.store.updateLocalActivationTask('job-decline-1', {
            status: 'failed',
            message: '1 张卡均被拒 (...8043): Your card number is incorrect. [incorrect_number]',
            cdkCode: 'KC-TEST-1',
            paymentState: 'declined',
            recoveryRequired: false
        }, { finalize: true });

        expect(res).toMatchObject({
            applied: true,
            released: true,
            status: 'failed',
            paymentState: 'declined',
            recoveryRequired: false
        });
        expect(h.executed.some(item => item.sql.includes('UPDATE cdk_codes SET used_at = NULL'))).toBe(true);
    });

    it('keeps CDK retained when prior state was unknown even if declined arrives at finalize', async () => {
        const h = storeHarness({
            taskRow: {
                id: 2,
                job_key: 'job-unknown-1',
                cdk_code: 'KC-TEST-1',
                status: 'running',
                payment_state: 'unknown',
                recovery_required: 1,
                execution_mode: 'local_card_pool',
                finished_at: null
            }
        });
        const res = await h.store.updateLocalActivationTask('job-unknown-1', {
            status: 'failed',
            message: 'Your card was declined',
            cdkCode: 'KC-TEST-1',
            paymentState: 'declined',
            recoveryRequired: false
        }, { finalize: true });

        expect(res).toMatchObject({
            applied: true,
            released: false,
            status: 'manual',
            paymentState: 'unknown',
            recoveryRequired: true
        });
        expect(h.executed.some(item => item.sql.includes('UPDATE cdk_codes SET used_at = NULL'))).toBe(false);
    });

    it('attaches usage_count and latest usage summary to listCdks and fetches full CDK records', async () => {
        const createdAt = new Date('2026-11-14T12:07:25Z');
        const h = storeHarness({
            cdkRows: [{
                cdk_code: 'KC-TEST-1',
                type: '自助',
                plan_type: 'plus',
                platform: 'chatgpt',
                payment_region: 'PH',
                shipped_at: null,
                used_at: null,
                created_at: createdAt,
                session_preview: 'buyer@example.com',
                session_job_key: 'job-2',
                card_last4: '8043',
                card_number: null,
                auto_renew_status: null,
                auto_renew_message: null
            }],
            usageRows: [
                {
                    job_key: 'job-2',
                    cdk_code: 'KC-TEST-1',
                    token_preview: 'buyer@example.com',
                    platform: 'chatgpt',
                    plan_type: 'plus',
                    status: 'failed',
                    message: '1 张卡均被拒 (...8043): Your card number is incorrect. [incorrect_number]',
                    payment_state: 'declined',
                    recovery_required: 0,
                    card_last4: '8043',
                    execution_mode: 'local_card_pool',
                    auto_renew_status: 'not_applicable',
                    created_at: createdAt,
                    finished_at: createdAt,
                    updated_at: createdAt
                },
                {
                    job_key: 'job-1',
                    cdk_code: 'KC-TEST-1',
                    token_preview: 'first@example.com',
                    platform: 'chatgpt',
                    plan_type: 'plus',
                    status: 'failed',
                    message: 'Session 已过期 [token_expired]',
                    payment_state: 'not_started',
                    recovery_required: 0,
                    card_last4: null,
                    execution_mode: 'local_card_pool',
                    auto_renew_status: 'not_applicable',
                    created_at: new Date('2026-11-14T11:00:00Z'),
                    finished_at: new Date('2026-11-14T11:01:00Z'),
                    updated_at: new Date('2026-11-14T11:01:00Z')
                }
            ]
        });

        const cdks = await h.store.listCdks();
        expect(cdks[0]).toMatchObject({
            code: 'KC-TEST-1',
            status: 'unused',
            usage_count: 2,
            last_task_status: 'failed',
            last_account: 'buyer@example.com',
            last_payment_state: 'declined'
        });

        const records = await h.store.getCdkUsageRecords('KC-TEST-1');
        expect(records).toHaveLength(2);
        expect(records[0]).toMatchObject({
            job_key: 'job-2',
            account: 'buyer@example.com',
            platform: 'chatgpt',
            plan_type: 'plus',
            status: 'failed',
            payment_state: 'declined',
            card_last4: '8043'
        });
    });

    it('returns sanitized usage records from /api/cdk/query and full admin records from /api/admin/cdks/:cdk/records', async () => {
        const routes = {};
        const app = {
            get(p, ...h) { routes[`GET ${p}`] = h.at(-1); },
            post(p, ...h) { routes[`POST ${p}`] = h.at(-1); }
        };
        const sliceStart = serverSource.indexOf("app.get('/api/admin/cdks'");
        const sliceEnd = serverSource.indexOf("app.post('/api/admin/cdks/generate'");
        const queryStart = serverSource.indexOf("app.post('/api/cdk/query'");
        const queryEnd = serverSource.indexOf("app.get('/api/cdk/download'");

        const store = {
            listCdks: vi.fn(async () => []),
            verifyCdkDetails: vi.fn(async () => ({
                cdk_code: 'KC-TEST-1',
                type: '自助',
                platform: 'chatgpt',
                plan_type: 'plus',
                used_at: null,
                created_at: '2026-11-14T12:00:00Z'
            })),
            getRunningTaskByCdk: vi.fn(async () => null),
            getCdkUsageRecords: vi.fn(async () => [{
                job_key: 'job-2',
                cdk_code: 'KC-TEST-1',
                account: 'buyer@example.com',
                platform: 'chatgpt',
                plan_type: 'plus',
                status: 'failed',
                message: '1 张卡均被拒 (...8043): Your card number is incorrect. [incorrect_number]',
                payment_state: 'declined',
                recovery_required: false,
                card_last4: '8043',
                created_at: '2026-11-14 20:07:25',
                finished_at: '2026-11-14 20:08:55',
                updated_at: '2026-11-14 20:08:55'
            }])
        };

        const context = {
            app,
            store,
            ensureStoreReady: async () => {},
            requireSecondaryAuth: (_req, _res, next) => next(),
            getPlatformForPlan: () => 'chatgpt',
            getPlanTypeLabel: () => 'ChatGPT Plus',
            formatTaskErrorMessage,
            issueTaskAccessToken: () => 'tok'
        };
        vm.runInNewContext(
            `${serverSource.slice(sliceStart, sliceEnd)}\n${serverSource.slice(queryStart, queryEnd)}`,
            context
        );

        const queryRes = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; } };
        await routes['POST /api/cdk/query']({ body: { cdk: 'KC-TEST-1' } }, queryRes);
        expect(queryRes.body.success).toBe(true);
        expect(queryRes.body.data).toMatchObject({
            status: '未使用',
            platform: 'chatgpt',
            plan_type: 'plus',
            plan_label: 'ChatGPT Plus'
        });
        expect(queryRes.body.data.records).toHaveLength(1);
        expect(queryRes.body.data.records[0].account).toBe('buyer@example.com');
        expect(queryRes.body.data.records[0].reason).toBe('支付卡被官方系统拒付：卡号无效或不正确（卡密未使用）');
        expect(queryRes.body.data.records[0].reason).not.toContain('incorrect_number');
        expect(queryRes.body.data.records[0].reason).not.toContain('8043');

        const adminRes = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; } };
        await routes['GET /api/admin/cdks/:cdk/records']({ params: { cdk: 'KC-TEST-1' } }, adminRes);
        expect(adminRes.body.success).toBe(true);
        expect(adminRes.body.records[0]).toMatchObject({
            account: 'buyer@example.com',
            plan_label: 'ChatGPT Plus',
            card_last4: '8043'
        });

        expect(adminHtml).toContain('cdk_records_modal_overlay');
        expect(adminHtml).toContain('/api/admin/cdks/${encodeURIComponent(cdk)}/records');
        expect(adminHtml).toContain('openCdkRecordsModal');
    });

    it('exposes POST /api/admin/cdks/:cdk/reset with secondary auth and handles non-JSON errors safely in admin UI', async () => {
        const routes = {};
        const middlewares = {};
        const app = {
            post(p, ...h) { routes[`POST ${p}`] = h.at(-1); middlewares[`POST ${p}`] = h.slice(0, -1); },
            delete() {}
        };
        const resetStart = serverSource.indexOf("app.post('/api/admin/cdks/:cdk/ship'");
        const resetEnd = serverSource.indexOf('// ─── Billing Records API');
        const store = {
            markCdkShipped: vi.fn(),
            deleteCdk: vi.fn(),
            resetCdkToUnused: vi.fn()
                .mockResolvedValueOnce({ ok: true, status: 200, message: 'CDK 已重置为未使用状态' })
                .mockResolvedValueOnce({ ok: false, status: 409, message: '该 CDK 当前有任务正在运行，无法重置' })
        };
        const requireSecondaryAuth = vi.fn((_req, _res, next) => next());

        vm.runInNewContext(serverSource.slice(resetStart, resetEnd), {
            app,
            store,
            ensureStoreReady: async () => {},
            requireSecondaryAuth
        });

        expect(middlewares['POST /api/admin/cdks/:cdk/reset']).toContain(requireSecondaryAuth);

        const okRes = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; } };
        await routes['POST /api/admin/cdks/:cdk/reset']({ params: { cdk: 'KC-CKA9QVANBWE4U2X' } }, okRes);
        expect(okRes.statusCode).toBe(200);
        expect(okRes.body).toEqual({ success: true, message: 'CDK 已重置为未使用状态' });

        const conflictRes = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; } };
        await routes['POST /api/admin/cdks/:cdk/reset']({ params: { cdk: 'KC-RUNNING-1' } }, conflictRes);
        expect(conflictRes.statusCode).toBe(409);
        expect(conflictRes.body).toEqual({ success: false, message: '该 CDK 当前有任务正在运行，无法重置' });

        expect(adminHtml).toContain('/api/admin/cdks/${encodeURIComponent(cdk)}/reset');
        expect(adminHtml).toContain('res.json().catch(() => ({}))');
    });
});
