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
    const createPool = vi.fn(() => ({ execute, query }));
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(storePath, 'utf8'), {
        module, exports: module.exports, __dirname: path.dirname(storePath.pathname),
        process: { env: {} }, Buffer, console,
        require: key => key === 'mysql2/promise' ? { createPool }
            : require(key.startsWith('.') ? new URL(`../${key}`, import.meta.url).pathname : key)
    });
    return { store: module.exports, execute, query };
}

describe('Card Freeze & Unfreeze Contract', () => {
    it('exports setCardFrozen function', () => {
        const { store } = harness();
        expect(store.setCardFrozen).toBeTypeOf('function');
    });

    it('freezing a card sets is_active = 0, status = 已冻结, and releases locks', async () => {
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
        expect(res.error).toBe('卡片不存在');
    });
});
