import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const start = server.indexOf('let outsourceRecoveryRunning = false;');
const end = server.indexOf('function spawnActivationWorker(', start);
const recoverySnippet = `${server.slice(start, end)}\nthis.recoverGptOutsourcingAttempts = recoverGptOutsourcingAttempts;`;

function harness({ rows = [], busy = [], recheck } = {}) {
    const recheckFn = recheck || vi.fn(async () => {});
    const store = {
        getGptApiPendingAttempts: vi.fn(async () => rows),
        updateTaskLog: vi.fn(async () => {}),
        markCdkUnused: vi.fn(async () => {})
    };
    const gptOutsourcing = {
        isBusy: vi.fn(jobKey => busy.includes(jobKey)),
        recheck: recheckFn,
        submitPay: vi.fn()
    };
    const context = {
        store, gptOutsourcing, logTask: vi.fn(),
        console: { log() {}, warn() {}, error() {} }
    };
    vm.runInNewContext(recoverySnippet, context);
    return { ...context, recover: context.recoverGptOutsourcingAttempts, recheckFn };
}

describe('GPT outsourcing startup recovery scanner', () => {
    it('scans old and manual records returned by the store without applying a stale-age cutoff', async () => {
        const rows = [
            { job_key: 'old-running', status: 'running', updated_at: '2023-01-01T00:00:00.000Z', attempt: { version: 1 } },
            { job_key: 'old-manual', status: 'manual', updated_at: '2023-01-02T00:00:00.000Z', attempt: { version: 1 } }
        ];
        const h = harness({ rows });
        await h.recover();
        expect(h.store.getGptApiPendingAttempts).toHaveBeenCalledOnce();
        expect(h.recheckFn.mock.calls.map(([jobKey]) => jobKey)).toEqual(['old-running', 'old-manual']);
        expect(h.store.updateTaskLog).not.toHaveBeenCalled();
    });

    it('skips a task already being handled by the live worker', async () => {
        const h = harness({ rows: [
            { job_key: 'busy-job', status: 'running', attempt: { version: 1 } },
            { job_key: 'free-job', status: 'manual', attempt: { version: 1 } }
        ], busy: ['busy-job'] });
        await h.recover();
        expect(h.recheckFn).toHaveBeenCalledOnce();
        expect(h.recheckFn).toHaveBeenCalledWith('free-job');
    });

    it('converts legacy running rows to manual review and never releases their CDK', async () => {
        const h = harness({ rows: [{ job_key: 'legacy-job', status: 'running', cdk_code: 'CDK-LEGACY', attempt: { version: 0 } }] });
        await h.recover();
        expect(h.store.updateTaskLog).toHaveBeenCalledWith('legacy-job', {
            status: 'manual',
            message: '历史外包订单缺少绑定信息，结果待确认，请人工核对',
            paymentState: 'unknown', recoveryRequired: true
        });
        expect(h.store.markCdkUnused).not.toHaveBeenCalled();
        expect(h.recheckFn).not.toHaveBeenCalled();
    });

    it('only rechecks a versioned original order and never submits or supplies credentials', async () => {
        const h = harness({ rows: [{ job_key: 'versioned-job', status: 'manual', attempt: { version: 1, orderId: 'order-1' } }] });
        await h.recover();
        expect(h.recheckFn).toHaveBeenCalledOnce();
        expect(h.gptOutsourcing.submitPay).not.toHaveBeenCalled();
        expect(h.gptOutsourcing.supplementCredentials).toBeUndefined();
    });

    it('uses single-flight recovery and rotates at most ten records per scan', async () => {
        let release;
        const waitForRecheck = new Promise(resolve => { release = resolve; });
        const rows = Array.from({ length: 12 }, (_, index) => ({
            job_key: `job-${index}`, status: 'manual', attempt: { version: 1 }
        }));
        const h = harness({ rows, recheck: vi.fn(async () => waitForRecheck) });
        const first = h.recover();
        await vi.waitFor(() => expect(h.recheckFn).toHaveBeenCalledOnce());
        await h.recover();
        expect(h.store.getGptApiPendingAttempts).toHaveBeenCalledOnce();
        release();
        await first;
        expect(h.recheckFn).toHaveBeenCalledTimes(10);

        h.recheckFn.mockResolvedValue(undefined);
        await h.recover();
        expect(h.store.getGptApiPendingAttempts).toHaveBeenCalledTimes(2);
        expect(h.recheckFn.mock.calls.slice(10).map(([jobKey]) => jobKey)).toEqual([
            'job-10', 'job-11', 'job-0', 'job-1', 'job-2', 'job-3', 'job-4', 'job-5', 'job-6', 'job-7'
        ]);
    });

    it('keeps startup stale-task cleanup delegated to this scanner for upstream orders', () => {
        const startup = server.slice(server.indexOf('async function start()'));
        const skip = startup.indexOf("if (staleTask.execution_mode === 'third_party_api' || staleTask.gpt_api_order_id || staleTask.gpt_api_task_id) continue;");
        const reset = startup.indexOf('await store.resetAllAssetLocks();');
        expect(skip).toBeGreaterThanOrEqual(0);
        expect(reset).toBeGreaterThan(skip);
        expect(startup).toContain('setTimeout(() => { void recoverGptOutsourcingAttempts(); }, 0).unref();');
    });
});
