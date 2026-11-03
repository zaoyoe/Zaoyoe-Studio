import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

function poolHarness(initialSlots = [{ slotId: 0, port: 1, cdpUrl: 'offline', inUse: false, uses: 0 }]) {
    const module = { exports: {} };
    const chromium = { use() {} };
    vm.runInNewContext(fs.readFileSync(new URL('../browser-pool.js', import.meta.url), 'utf8') +
        `\nslots = ${JSON.stringify(initialSlots)}; initialized=true;`, {
        module, process: { env: {} }, __dirname: '/offline', setTimeout, clearTimeout, console,
        require: id => id === 'playwright-extra' ? { chromium } : id === 'puppeteer-extra-plugin-stealth' ? () => ({}) : {}
    });
    return module.exports;
}
describe('cancelled diagnostics do not occupy browser queue entries', () => {
    it('removes a queued cancelled task and gives the next slot to a live task', async () => {
        const pool = poolHarness();
        await pool.acquireSlot('busy');
        const controller = new AbortController();
        const cancelledCallback = vi.fn();
        const cancelled = pool.withBrowserSlot('cancelled', cancelledCallback, controller.signal);
        const rejected = expect(cancelled).rejects.toMatchObject({ code: 'DIAGNOSTIC_CANCELLED' });
        await Promise.resolve();
        expect(pool.getStats().waiting).toBe(1);
        controller.abort();
        await rejected;
        expect(pool.getStats().waiting).toBe(0);
        expect(cancelledCallback).not.toHaveBeenCalled();
        const next = pool.acquireSlot('live');
        pool.releaseSlot(0);
        expect(await next).toMatchObject({ slotId: 0 });
        expect(pool.getStats().slots[0].jobKey).toBe('live');
        pool.releaseSlot(0);
    });
    it('stops an already-cancelled task and cancellation between allocation and callback', async () => {
        const pool = poolHarness();
        const controller = new AbortController();
        controller.abort();
        const fn = vi.fn();
        await expect(pool.withBrowserSlot('cancelled', fn, controller.signal)).rejects.toMatchObject({ code: 'DIAGNOSTIC_CANCELLED' });
        expect(pool.getStats().busy).toBe(0);
        const late = new AbortController();
        const task = pool.withBrowserSlot('late', fn, late.signal);
        late.abort();
        await expect(task).rejects.toMatchObject({ code: 'DIAGNOSTIC_CANCELLED' });
        expect(fn).not.toHaveBeenCalled();
        expect(pool.getStats().busy).toBe(0);
    });

    it('rejects queued work immediately when its only slot is invalidated', async () => {
        const pool = poolHarness();
        const active = await pool.acquireSlot('active');
        const queued = pool.acquireSlot('queued');
        await Promise.resolve();
        expect(pool.getStats().waiting).toBe(1);

        expect(pool.invalidateSlot(active.slotId, 'cleanup timeout/browser context')).toBe(true);
        await expect(queued).rejects.toMatchObject({ code: 'BROWSER_POOL_NO_HEALTHY_SLOTS' });
        expect(pool.getStats()).toMatchObject({ healthy: 0, invalidated: 1, waiting: 0, busy: 1, idle: 0 });
        expect(pool.getStats().slots[0]).toMatchObject({ healthy: false, invalidated: true,
            invalidationReason: 'cleanup_timeout_browser_context' });

        pool.releaseSlot(active.slotId);
        await expect(pool.acquireSlot('new')).rejects.toMatchObject({ code: 'BROWSER_POOL_NO_HEALTHY_SLOTS' });
    });

    it('does not reuse an invalidated slot when another healthy slot can serve queued work', async () => {
        const pool = poolHarness([
            { slotId: 0, port: 1, cdpUrl: 'offline-0', inUse: false, uses: 0 },
            { slotId: 1, port: 2, cdpUrl: 'offline-1', inUse: false, uses: 0 }
        ]);
        const active = await pool.acquireSlot('active');
        const healthyBusy = await pool.acquireSlot('healthy-busy');
        const queued = pool.acquireSlot('queued');
        await Promise.resolve();
        expect(pool.getStats().waiting).toBe(1);

        pool.invalidateSlot(active.slotId, 'worker exception');
        pool.releaseSlot(healthyBusy.slotId);
        await expect(queued).resolves.toMatchObject({ slotId: 1 });
        expect(pool.getStats()).toMatchObject({ healthy: 1, invalidated: 1, waiting: 0, busy: 2 });
        expect(pool.getStats().slots[0]).toMatchObject({ healthy: false, invalidated: true });

        pool.releaseSlot(active.slotId);
        pool.releaseSlot(healthyBusy.slotId);
        expect(pool.getStats().idle).toBe(1);
    });
});
