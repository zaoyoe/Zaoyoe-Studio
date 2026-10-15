import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

function poolHarness() {
    const module = { exports: {} };
    const chromium = { use() {} };
    vm.runInNewContext(fs.readFileSync(new URL('../browser-pool.js', import.meta.url), 'utf8') +
        '\nslots = [{slotId:0,port:1,cdpUrl:"offline",inUse:false,uses:0}]; initialized=true;', {
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
});
