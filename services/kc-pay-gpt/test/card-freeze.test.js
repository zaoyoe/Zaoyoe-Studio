import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const storePath = new URL('../mysql-store.js', import.meta.url);

function harness() {
    const execute = vi.fn(async () => [{ affectedRows: 1 }]);
    const query = vi.fn(async () => [[]]);
    const connection = {
        query,
        execute,
        beginTransaction: vi.fn(async () => {}),
        commit: vi.fn(async () => {}),
        rollback: vi.fn(async () => {}),
        release: vi.fn(() => {})
    };
    const getConnection = vi.fn(async () => connection);
    const createPool = vi.fn(() => ({ execute, query, getConnection }));
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(storePath, 'utf8'), {
        module, exports: module.exports, __dirname: path.dirname(storePath.pathname),
        process: { env: {} }, Buffer, console,
        require: key => key === 'mysql2/promise' ? { createPool }
            : require(key.startsWith('.') ? new URL(`../${key}`, import.meta.url).pathname : key)
    });
    return { store: module.exports, execute, query, connection };
}

describe('Card Freeze & Unfreeze Contract', () => {
    it('exports setCardFrozen function', () => {
        const { store } = harness();
        expect(store.setCardFrozen).toBeTypeOf('function');
    });

    it('freezing an idle card sets is_active = 0 and status = 已冻结', async () => {
        const { store, execute } = harness();
        const res = await store.setCardFrozen(42, true);
        expect(res.success).toBe(true);
        expect(res.is_frozen).toBe(true);
        expect(res.message).toContain('冻结');

        expect(execute).toHaveBeenCalledOnce();
        const [sql, params] = execute.mock.calls[0];
        expect(params).toEqual([42]);
        expect(sql).toContain('is_active = 0');
        expect(sql).toContain("status = '已冻结'");
        expect(sql).toContain('locked_at = NULL');
        expect(sql).toContain('locked_by = NULL');
        expect(sql).toContain("WHERE id = ? AND in_use = 0 AND status IN ('正常', '已冻结', '已报废')");
    });

    it('unfreezing a card restores is_active = 1, status = 正常, and clears cooldown', async () => {
        const { store, execute } = harness();
        const res = await store.setCardFrozen(42, false);
        expect(res.success).toBe(true);
        expect(res.is_frozen).toBe(false);
        expect(res.message).toContain('解冻');

        expect(execute).toHaveBeenCalledOnce();
        const [sql, params] = execute.mock.calls[0];
        expect(params).toEqual([42]);
        expect(sql).toContain('is_active = 1');
        expect(sql).toContain("status = '正常'");
        expect(sql).toContain('cooldown_until = NULL');
        expect(sql).toContain("WHERE id = ? AND in_use = 0 AND status = '已冻结'");
    });

    it('rejects invalid cardId gracefully', async () => {
        const { store, execute } = harness();
        const res = await store.setCardFrozen('not-a-number', true);
        expect(res.success).toBe(false);
        expect(res.error).toBe('无效的卡片 ID');
        expect(execute).not.toHaveBeenCalled();
    });

    it('returns error when card is not found', async () => {
        const { store, execute } = harness();
        execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
        const res = await store.setCardFrozen(999, true);
        expect(res.success).toBe(false);
        expect(res.error).toBe('卡片不存在或仍被占用/待核账，不能冻结或解冻');
    });

    it('gets and sets global card max usage limit', async () => {
        const { store, query, execute } = harness();
        query.mockResolvedValueOnce([[{ config_value: '5' }]]);
        const limit = await store.getCardMaxUsageLimit();
        expect(limit).toBe(5);

        await store.setCardMaxUsageLimit(10);
        expect(execute).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO app_config'),
            ['10']
        );
    });

    it('auto-freezes card when usage count reaches max limit in recordCardUsage', async () => {
        const { store, query, execute } = harness();
        // 1. SELECT card_assets
        query.mockResolvedValueOnce([[{
            daily_usage_count: 1,
            daily_usage_reset_at: new Date(),
            usage_count: 4, // next will be 5
            max_usage_limit: 5,
            card_number: '5378727146050159'
        }]]);
        // 2. UPDATE daily_usage_count
        query.mockResolvedValueOnce([{ affectedRows: 1 }]);
        // 3. getCardMaxUsageLimit query (fallback)
        query.mockResolvedValueOnce([[{ config_value: '0' }]]);
        // 4. UPDATE freeze
        query.mockResolvedValueOnce([{ affectedRows: 1 }]);

        const result = await store.recordCardUsage(42, 'owner_test_1');
        expect(result.usageCount).toBe(5);
        expect(result.autoFrozen).toBe(true);

        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("status = '已冻结'"),
            [42, 'owner_test_1']
        );
        const freezeCallSql = query.mock.calls.find(([sql]) => sql.includes("status = '已冻结'"))?.[0] || '';
        expect(freezeCallSql).not.toContain('locked_by = NULL');

        execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
        await expect(store.completeCardPayment(42, 'owner_test_1')).resolves.toBe(1);
        expect(execute).toHaveBeenLastCalledWith(
            expect.stringContaining("IF(is_active = 0 OR status = '已冻结', '已冻结', '正常')"),
            [42, 'owner_test_1']
        );
    });

    it('queries unconfirmed auto-renew tasks', async () => {
        const { store, query } = harness();
        query.mockResolvedValueOnce([[
            {
                id: 101,
                job_key: 'test_task_1',
                cdk_code: 'KC-12345678',
                email: 'user@example.com',
                card_last4: '3400',
                card_number: '5378727132363400',
                platform: 'chatgpt',
                plan_type: 'plus',
                auto_renew_status: 'verification_unknown',
                auto_renew_message: 'HTTP 504 Gateway Timeout',
                created_at: new Date('2026-11-09T10:00:00Z'),
                completed_at: new Date('2026-11-09T10:01:00Z')
            }
        ]]);

        const tasks = await store.getUnconfirmedAutoRenewTasks({ limit: 50 });
        expect(tasks).toHaveLength(1);
        expect(tasks[0].job_key).toBe('test_task_1');
        expect(tasks[0].auto_renew_status).toBe('verification_unknown');
        expect(tasks[0].card_last4).toBe('3400');
    });
});
