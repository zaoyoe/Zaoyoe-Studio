import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const storePath = new URL('../mysql-store.js', import.meta.url);
const clone = value => JSON.parse(JSON.stringify(value));
const binding = { attemptId: 'attempt-1', clientRef: 'ref-1', idempotencyKey: 'idem-1',
    endpoint: 'https://provider.example', apiKeyFingerprint: 'abc123', planType: 'plus', planKey: 'plus',
    planName: 'chatgptplusplan', country: 'US', currency: 'USD', dispatchStarted: false, recoveryRequired: false };

// This stateful client is entirely offline. Evaluate the actual CommonJS store
// to exercise transactions, immutable bindings and resource ownership guards.
function harness({ envelope = null, newOwner = false, cardOwner = 'gptapi_job-1', dailyCount = 0,
    configRows = [{ config_key: 'gpt_api_plan_key', config_value: 'plus' }] } = {}) {
    const state = {
        task: { id: 10, job_key: 'job-1', cdk_code: 'CDK-1', execution_mode: 'third_party_api', status: 'running',
            progress: 20, payment_state: 'not_started', recovery_required: 0, gpt_api_raw: envelope ? JSON.stringify(envelope) : null },
        cdk: { cdk_code: 'CDK-1', used_at: '2026-10-01T00:00:00Z' },
        card: { id: 7, card_number: '4242424242424242', card_expiry: '12/30', card_cvc: '123',
            card_holder: 'Test', usage_count: 0, daily_usage_count: dailyCount,
            daily_usage_reset_at: new Date().toISOString(), in_use: envelope?.attempt?.cardAssetId ? 1 : 0, locked_by: cardOwner },
        usageWrites: 0, releases: 0
    };
    let snapshot;
    const query = vi.fn(async (sql, params = []) => {
        if (/SELECT \* FROM task_logs WHERE job_key/.test(sql)) return [[clone(state.task)]];
        if (/SELECT (?:\*|cdk_code, used_at) FROM cdk_codes/.test(sql)) return [[clone(state.cdk)]];
        if (/SELECT job_key FROM task_logs/.test(sql)) return [[{ job_key: newOwner ? 'job-2' : 'job-1' }]];
        if (/SELECT \* FROM card_assets WHERE id/.test(sql)) {
            if (sql.includes('locked_by = ?') && state.card.locked_by !== params[1]) return [[]];
            return [[clone(state.card)]];
        }
        if (/SELECT id, card_number/.test(sql)) return [state.card.in_use ? [] : [clone(state.card)]];
        if (/UPDATE card_assets SET in_use = 1/.test(sql)) {
            state.card.in_use = 1; state.card.locked_by = params[0]; return [{ affectedRows: 1 }];
        }
        if (/UPDATE task_logs SET gpt_api_raw/.test(sql)) {
            state.task.gpt_api_raw = params[0]; state.task.gpt_api_order_id = params[1];
            state.task.gpt_api_task_id = params[2]; state.task.card_last4 = params[3]; state.task.recovery_required = params[4];
            return [{ affectedRows: 1 }];
        }
        if (/UPDATE cdk_codes SET used_at = NULL/.test(sql)) { state.cdk.used_at = null; return [{ affectedRows: 1 }]; }
        if (/UPDATE cdk_codes SET used_at = COALESCE/.test(sql)) { state.cdk.used_at ||= 'now'; return [{ affectedRows: 1 }]; }
        if (/UPDATE card_assets SET daily_usage_count/.test(sql)) {
            state.usageWrites++; state.card.daily_usage_count = params[0]; state.card.usage_count++; return [{ affectedRows: 1 }];
        }
        if (/UPDATE card_assets SET in_use = 0/.test(sql)) {
            expect(sql).toContain('AND locked_by = ?');
            expect(params[1]).toBe('gptapi_job-1'); state.releases++; state.card.in_use = 0; return [{ affectedRows: 1 }];
        }
        if (/UPDATE task_logs SET status/.test(sql)) {
            state.task.status = params[0]; state.task.message = params[1]; state.task.payment_state = params[3];
            state.task.recovery_required = params[4]; return [{ affectedRows: 1 }];
        }
        if (/SELECT config_key/.test(sql)) return [clone(configRows)];
        if (/SELECT raw_output, failure_screenshots, execution_mode/.test(sql)) return [[clone(state.task)]];
        if (/SELECT COUNT\(\*\) AS total/.test(sql)) return [[{ total: 1 }]];
        if (/SELECT job_key, cdk_code/.test(sql)) return [[clone(state.task)]];
        if (/SELECT.*FROM task_logs/s.test(sql)) return [[]];
        throw new Error(`Unexpected offline query: ${sql}`);
    });
    const connection = {
        query,
        beginTransaction: vi.fn(async () => { snapshot = clone(state); }),
        commit: vi.fn(async () => {}),
        rollback: vi.fn(async () => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, snapshot); }),
        release: vi.fn()
    };
    const execute = vi.fn(async () => [{ affectedRows: 1 }]);
    const pool = { query, execute, getConnection: vi.fn(async () => connection) };
    const createPool = vi.fn(() => pool);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(storePath, 'utf8'), {
        module, exports: module.exports, __dirname: path.dirname(storePath.pathname), URL,
        process: { env: {} }, Buffer, console,
        require: key => key === 'mysql2/promise' ? { createPool }
            : require(key.startsWith('.') ? new URL(`../${key}`, import.meta.url).pathname : key)
    });
    return { store: module.exports, query, execute, connection, createPool, state };
}

async function reserved(h = harness()) {
    await h.store.saveGptApiAttempt('job-1', binding);
    await h.store.reserveGptApiCard('job-1', {});
    await h.store.saveGptApiAttempt('job-1', { dispatchStarted: true, requestFingerprint: 'request-sha', recoveryRequired: true });
    return h;
}

describe('durable outsourced GPT order storage', () => {
    it('loads without connecting and atomically associates the exact card before dispatch', async () => {
        const h = harness();
        expect(h.createPool).not.toHaveBeenCalled();
        await h.store.saveGptApiAttempt('job-1', binding);
        const result = await h.store.reserveGptApiCard('job-1', {});
        expect(result.card.card_number).toBe('4242424242424242');
        expect(result.attempt.cardAssetId).toBe(7);
        expect(result.attempt.cardLast4).toBe('4242');
        expect(h.state.card.locked_by).toBe('gptapi_job-1');
        expect(JSON.parse(h.state.task.gpt_api_raw).attempt.cardAssetId).toBe(7);
        expect(h.state.task.gpt_api_raw).not.toMatch(/4242424242424242|card_cvc|"cvc"|session|access_token/);
        expect(h.connection.commit).toHaveBeenCalledTimes(2);
        const select = h.query.mock.calls.find(([sql]) => sql.includes('FOR UPDATE SKIP LOCKED'))[0];
        expect(select).toContain("status = '正常'");
        expect(select).toContain('cooldown_until < NOW()');
        expect(select).toContain('ORDER BY usage_count ASC');
    });

    it('rolls back card reservation when durable association cannot be saved', async () => {
        const h = harness();
        await h.store.saveGptApiAttempt('job-1', binding);
        const original = h.query.getMockImplementation();
        h.query.mockImplementation(async (sql, params) => {
            if (sql.includes('UPDATE task_logs SET gpt_api_raw')) throw new Error('disk/database unavailable');
            return original(sql, params);
        });
        await expect(h.store.reserveGptApiCard('job-1', {})).rejects.toThrow('database unavailable');
        expect(h.state.card.in_use).toBe(0);
        expect(JSON.parse(h.state.task.gpt_api_raw).attempt.cardAssetId).toBeUndefined();
        expect(h.connection.rollback).toHaveBeenCalledOnce();
    });

    it.each(['endpoint', 'apiKeyFingerprint', 'planKey', 'planName', 'cardAssetId', 'clientRef', 'requestFingerprint'])
    ('rejects changed immutable %s without touching the owned resources', async key => {
        const h = await reserved();
        await expect(h.store.saveGptApiAttempt('job-1', { [key]: key === 'cardAssetId' ? 8 : key === 'endpoint' ? 'https://other.example' : 'different' }))
            .rejects.toMatchObject({ code: 'GPT_API_BINDING_CONFLICT' });
        expect(h.state.card.in_use).toBe(1);
        expect(h.state.cdk.used_at).not.toBeNull();
    });

    it('cannot undo dispatch or take another card after dispatch', async () => {
        const h = await reserved();
        await expect(h.store.saveGptApiAttempt('job-1', { dispatchStarted: false })).rejects.toMatchObject({ code: 'GPT_API_BINDING_CONFLICT' });
        await expect(h.store.reserveGptApiCard('job-1', {})).rejects.toMatchObject({ code: 'GPT_API_ALREADY_DISPATCHED' });
    });

    it('preserves long numeric order IDs exactly so recovery queries reach the original order', async () => {
        const h = await reserved();
        await h.store.saveGptApiAttempt('job-1', { orderId: '12345678901234567890', taskId: '98765432109876543210' });
        const restored = await h.store.getGptApiAttempt('job-1');
        expect(restored.orderId).toBe('12345678901234567890');
        expect(restored.taskId).toBe('98765432109876543210');
        await expect(h.store.saveGptApiAttempt('job-1', { orderId: 'different-order' })).rejects.toMatchObject({ code: 'GPT_API_BINDING_CONFLICT' });
        await expect(h.store.saveGptApiAttempt('job-1', { taskId: 'different-task' })).rejects.toMatchObject({ code: 'GPT_API_BINDING_CONFLICT' });
    });

    it.each(['new_owner', 'cdk_unlocked'])('refuses to reserve a card without current CDK ownership: %s', async conflict => {
        const h = harness({ newOwner: conflict === 'new_owner' });
        await h.store.saveGptApiAttempt('job-1', binding);
        if (conflict === 'cdk_unlocked') h.state.cdk.used_at = null;
        await expect(h.store.reserveGptApiCard('job-1', {})).rejects.toMatchObject({ code: 'GPT_API_CDK_OWNER_MISMATCH' });
        expect(h.state.card.in_use).toBe(0);
        expect(JSON.parse(h.state.task.gpt_api_raw).attempt.cardAssetId).toBeUndefined();
        expect(h.query.mock.calls.some(([sql]) => sql.includes('FOR UPDATE SKIP LOCKED'))).toBe(false);
    });

    it('holds unknown results and credentials while preserving both assets', async () => {
        const h = await reserved();
        const result = await h.store.finalizeGptApiAttempt('job-1', { outcome: 'hold', record: { state: 'awaiting_credentials' }, message: '待核查' });
        expect(result.assetsHeld).toBe(true);
        expect(result.attempt.state).toBe('awaiting_credentials');
        expect(h.state.task.status).toBe('manual');
        expect(h.state.task.recovery_required).toBe(1);
        expect(h.state.card.in_use).toBe(1);
        expect(h.state.cdk.used_at).not.toBeNull();
        expect(h.state.usageWrites).toBe(0);
        expect(h.state.releases).toBe(0);
    });

    it('success settles once, records daily usage once and releases only its own card', async () => {
        const h = await reserved(harness({ dailyCount: 2 }));
        const first = await h.store.finalizeGptApiAttempt('job-1', { outcome: 'success', record: { state: 'finished' }, message: '成功' });
        expect(first.applied).toBe(true);
        expect(first.attempt.state).toBe('finished');
        expect(first.cardUsage).toEqual({ dailyUsageCount: 3, cooledDown: true });
        expect(h.state.card.in_use).toBe(0);
        expect(h.state.cdk.used_at).not.toBeNull();
        const second = await h.store.finalizeGptApiAttempt('job-1', { outcome: 'success' });
        expect(second.alreadySettled).toBe(true);
        expect(h.state.usageWrites).toBe(1);
        expect(h.state.releases).toBe(1);
        await expect(h.store.finalizeGptApiAttempt('job-1', { outcome: 'no_charge' })).rejects.toMatchObject({ code: 'GPT_API_SETTLEMENT_CONFLICT' });
        await expect(h.store.saveGptApiAttempt('job-1', { state: 'polling', recoveryRequired: true })).rejects.toMatchObject({ code: 'GPT_API_SETTLEMENT_CONFLICT' });
        const finishingQuery = h.query.mock.calls.find(([sql]) => sql.includes('session_payload_encrypted = CASE'))[0];
        expect(finishingQuery).toContain('THEN NULL ELSE session_payload_encrypted');
    });

    it('confirmed no charge returns only the correlated CDK and card', async () => {
        const h = await reserved();
        const result = await h.store.finalizeGptApiAttempt('job-1', { outcome: 'no_charge', message: '确认未扣款' });
        expect(result.applied).toBe(true);
        expect(h.state.cdk.used_at).toBeNull();
        expect(h.state.card.in_use).toBe(0);
        expect(h.state.usageWrites).toBe(0);
        expect(h.state.task.status).toBe('failed');
        expect(h.state.task.recovery_required).toBe(0);
    });

    it.each(['new_cdk_owner', 'new_card_owner'])('late result cannot release another owner: %s', async conflict => {
        const h = await reserved();
        if (conflict === 'new_cdk_owner') {
            const original = h.query.getMockImplementation();
            h.query.mockImplementation(async (sql, params) => sql.includes('SELECT job_key FROM task_logs')
                ? [[{ job_key: 'job-2' }]] : original(sql, params));
        }
        if (conflict === 'new_card_owner') h.state.card.locked_by = 'payment_job-2';
        const result = await h.store.finalizeGptApiAttempt('job-1', { outcome: 'no_charge' });
        expect(result.applied).toBe(false);
        expect(result.assetsHeld).toBe(true);
        expect(result.guardCode).toMatch(/OWNER_MISMATCH/);
        expect(h.state.cdk.used_at).not.toBeNull();
        expect(h.state.card.in_use).toBe(1);
        expect(h.state.releases).toBe(0);
    });

    it('holds a supplier-reused order even if its current remote status is success', async () => {
        const h = await reserved();
        await h.store.saveGptApiAttempt('job-1', { existingOrderReused: true });
        await expect(h.store.saveGptApiAttempt('job-1', { existingOrderReused: false })).rejects.toMatchObject({ code: 'GPT_API_BINDING_CONFLICT' });
        const result = await h.store.finalizeGptApiAttempt('job-1', { outcome: 'success' });
        expect(result.guardCode).toBe('GPT_API_REUSED_ORDER_UNCONFIRMED');
        expect(result.assetsHeld).toBe(true);
        expect(h.state.usageWrites).toBe(0);
        expect(h.state.releases).toBe(0);
        expect(h.state.cdk.used_at).not.toBeNull();
    });

    it('does not persist arbitrary upstream request payloads or card/session secrets', async () => {
        const h = harness();
        await h.store.saveGptApiAttempt('job-1', { ...binding, session: { access_token: 'secret' }, card_cvc: '123',
            lastResponse: { status: 'pending', session: { access_token: 'secret' }, card: '4242424242424242',
                api_key: 'gptk_secret', error: 'access_token=secret cvc=123' } });
        expect(h.state.task.gpt_api_raw).not.toContain('"session"');
        expect(h.state.task.gpt_api_raw).not.toContain('4242424242424242');
        expect(h.state.task.gpt_api_raw).not.toContain('gptk_secret');
        expect(h.state.task.gpt_api_raw).not.toContain('cvc=123');
    });

    it('recovery is independent of stale age and history includes orders missing supplier IDs', async () => {
        const h = await reserved();
        await h.store.getGptApiPendingAttempts();
        const pendingSql = h.query.mock.calls.at(-1)[0];
        expect(pendingSql).toContain("provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1");
        expect(pendingSql).not.toMatch(/DATE_SUB|INTERVAL|LIMIT/);
        const history = await h.store.listGptApiAttempts({ limit: 200, offset: -1 });
        expect(history.limit).toBe(100);
        expect(history.offset).toBe(0);
        expect(history.total).toBe(1);
        const historySql = h.query.mock.calls.find(([sql]) => sql.includes('ORDER BY id DESC LIMIT ? OFFSET ?'))[0];
        expect(historySql).toContain("execution_mode = 'third_party_api' OR gpt_api_order_id IS NOT NULL");
    });

    it('lock cleanup protects correlated provider orders, including legacy owned locks', async () => {
        const h = harness();
        await h.store.releaseStaleAssetLocks();
        await h.store.resetAllAssetLocks();
        for (const [sql] of h.execute.mock.calls.filter(([sql]) => sql.includes('UPDATE card_assets'))) {
            expect(sql).toContain('NOT EXISTS');
            expect(sql).toContain("CONCAT('gptapi_', provider_task.job_key)");
            expect(sql).toContain('provider_task.recovery_required = 1');
            expect(sql).toContain('provider_task.gpt_api_order_id IS NOT NULL');
            expect(sql).toContain("provider_task.payment_state IN ('started', 'unknown')");
            expect(sql).toContain("NOT IN ('success', 'no_charge')");
            expect(sql).not.toContain("provider_task.status <> 'cancelled'");
        }
        const phoneSql = h.execute.mock.calls.find(([sql]) => sql.includes('UPDATE phone_assets'))[0];
        expect(phoneSql).not.toContain('card_assets.locked_by');
    });

    it('protects unresolved local cancelled provider orders from lock release and record deletion', async () => {
        const h = await reserved();
        h.state.task.status = 'cancelled';
        h.state.task.payment_state = 'unknown';
        await expect(h.store.deleteTaskLogByJobKey('job-1')).rejects.toMatchObject({ code: 'GPT_API_ORDER_UNRESOLVED' });
        await h.store.markCdkUnused('CDK-1');
        const rollbackSql = h.execute.mock.calls.at(-1)[0];
        expect(rollbackSql).toContain("NOT IN ('success', 'no_charge')");
        expect(rollbackSql).not.toContain("provider_task.status <> 'cancelled'");
        expect(h.state.task.gpt_api_raw).toContain('"dispatchStarted":true');
        expect(h.state.releases).toBe(0);
    });

    it('keeps unconfigured endpoints empty instead of installing an implicit supplier', async () => {
        const h = harness();
        expect((await h.store.getGptApiConfig()).base_url).toBe('');
        await h.store.saveGptApiConfig({ enabled: false, base_url: '' });
        const params = h.execute.mock.calls.at(-1)[1];
        expect(params[params.indexOf('gpt_api_base_url') + 1]).toBe('');
        expect(fs.readFileSync(storePath, 'utf8')).not.toContain('https://kc.vpss.eu.cc/');
    });

    it('reads an existing saved endpoint unchanged and allows an explicit blank while disabled', async () => {
        const h = harness({ configRows: [{ config_key: 'gpt_api_base_url', config_value: 'https://legacy-provider.example/' }] });
        expect((await h.store.getGptApiConfig()).base_url).toBe('https://legacy-provider.example/');
        await h.store.saveGptApiConfig({ enabled: false });
        let params = h.execute.mock.calls.at(-1)[1];
        expect(params[params.indexOf('gpt_api_base_url') + 1]).toBe('https://legacy-provider.example');
        await h.store.saveGptApiConfig({ enabled: false, base_url: '' });
        params = h.execute.mock.calls.at(-1)[1];
        expect(params[params.indexOf('gpt_api_base_url') + 1]).toBe('');
    });

    it('upgrades mapping in the existing config key without a new schema column', async () => {
        const h = harness();
        expect((await h.store.getGptApiConfig()).plan_mapping).toEqual({ plus: 'plus' });
        await h.store.saveGptApiConfig({ plan_mapping: { plus: 'official-plus', pro_100: 'official-pro100' } });
        const [sql, params] = h.execute.mock.calls.at(-1);
        expect(sql).not.toMatch(/CREATE|ALTER/);
        const saved = JSON.parse(params[params.indexOf('gpt_api_plan_key') + 1]);
        expect(saved.plan_mapping).toEqual({ plus: 'official-plus', pro_100: 'official-pro100' });
        expect(params).not.toContain('gpt_api_plan_mapping');
    });
});
