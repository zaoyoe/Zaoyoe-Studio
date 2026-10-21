import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const storePath = new URL('../mysql-store.js', import.meta.url);

// Evaluate the full store and its real exports against an offline MySQL client.
// Loading the module and these calls never connect to or mutate a real database.
function harness() {
    const execute = vi.fn(async () => [{ affectedRows: 1 }]);
    const createPool = vi.fn(() => ({ execute }));
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(storePath, 'utf8'), {
        module, exports: module.exports, __dirname: path.dirname(storePath.pathname),
        process: { env: {} }, Buffer, console,
        require: key => key === 'mysql2/promise' ? { createPool }
            : require(key.startsWith('.') ? new URL(`../${key}`, import.meta.url).pathname : key)
    });
    return { store: module.exports, execute, createPool };
}

describe('real card store decline cooldown contract', () => {
    it('exports the function used by the payment driver and atomically cools down while releasing its lock', async () => {
        const { store, execute, createPool } = harness();
        expect(store.cooldownCard).toBeTypeOf('function');
        expect(createPool).not.toHaveBeenCalled();
        await store.cooldownCard(55, 30, 'Stripe拒付');
        expect(execute).toHaveBeenCalledOnce();
        const [sql, params] = execute.mock.calls[0];
        expect(params).toEqual([30, 55]);
        expect(sql).toContain('GREATEST'); // Never shorten an existing daily usage cooldown.
        expect(sql).toContain('INTERVAL ? MINUTE');
        expect(sql).toContain('in_use = 0');
        expect(sql).toContain('locked_at = NULL');
        expect(sql).toContain('locked_by = NULL');
        expect(sql).toContain("WHERE id = ? AND is_active = 1 AND status = '正常'");
        expect(sql.split('WHERE')[0]).not.toMatch(/status\s*=|is_active\s*=/); // Never reactivate manual-review assets.
    });
    it('defaults to 30 minutes and normalizes numeric input through bound parameters', async () => {
        const { store, execute } = harness();
        await store.cooldownCard('55');
        expect(execute.mock.calls[0][1]).toEqual([30, 55]);
    });
    it.each([0, -1, 1.5, 1441, NaN, Infinity, '30); DROP TABLE card_assets; --'])('rejects unsafe duration %s before persistence', async minutes => {
        const { store, execute, createPool } = harness();
        await expect(store.cooldownCard(55, minutes)).rejects.toThrow('冷却时长无效');
        expect(execute).not.toHaveBeenCalled();
        expect(createPool).not.toHaveBeenCalled();
    });
    it.each([null, 0, -1, 1.5, NaN, Infinity, '55 OR 1=1'])('does not mutate cards for invalid ID %s', async cardId => {
        const { store, execute } = harness();
        await store.cooldownCard(cardId);
        expect(execute).not.toHaveBeenCalled();
    });
});

describe('Session checkout cooldown store contract', () => {
    it('persists a bounded cooldown using bound SQL parameters and never shortens an existing cooldown', async () => {
        const { store, execute, createPool } = harness();
        const scopeKey = 'a'.repeat(64);
        expect(createPool).not.toHaveBeenCalled();

        await store.setActivationAttemptCooldown('chatgpt_ua', scopeKey, 10);

        expect(execute).toHaveBeenCalledOnce();
        const [sql, params] = execute.mock.calls[0];
        expect(params).toEqual(['chatgpt_ua', scopeKey, 10, 10]);
        expect(sql).toContain('ON DUPLICATE KEY UPDATE');
        expect(sql).toContain('GREATEST(COALESCE(cooldown_until, CURRENT_TIMESTAMP)');
        expect(sql).toContain('INTERVAL ? MINUTE');
        expect(sql).not.toContain(scopeKey);
    });

    it.each([
        ['', 'valid-key', 10, '激活冷却范围无效'],
        ['scope-type-that-is-too-long', 'valid-key', 10, '激活冷却范围无效'],
        ['chatgpt_ua', '', 10, '激活冷却范围无效'],
        ['chatgpt_ua', 'x'.repeat(129), 10, '激活冷却范围无效'],
        ['chatgpt_ua', 'valid-key', 0, '激活冷却时长无效'],
        ['chatgpt_ua', 'valid-key', -1, '激活冷却时长无效'],
        ['chatgpt_ua', 'valid-key', 1.5, '激活冷却时长无效'],
        ['chatgpt_ua', 'valid-key', 1441, '激活冷却时长无效'],
        ['chatgpt_ua', 'valid-key', NaN, '激活冷却时长无效'],
        ['chatgpt_ua', 'valid-key', Infinity, '激活冷却时长无效'],
        ['chatgpt_ua', 'valid-key', '10); DROP TABLE activation_attempt_limits; --', '激活冷却时长无效']
    ])('rejects invalid cooldown input before persistence', async (scopeType, scopeKey, minutes, message) => {
        const { store, execute, createPool } = harness();

        await expect(store.setActivationAttemptCooldown(scopeType, scopeKey, minutes)).rejects.toThrow(message);

        expect(execute).not.toHaveBeenCalled();
        expect(createPool).not.toHaveBeenCalled();
    });
});
