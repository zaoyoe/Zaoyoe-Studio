'use strict';

const { performance } = require('node:perf_hooks');
const { createProcurementRunner } = require('./procurement');
const { createDeliveryRunner } = require('./delivery');
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const PHASES = ['query', 'delivery', 'dispatch'];
const RESULT_CODES = new Set(['ok', 'pending', 'unknown', 'blocked', 'disabled', 'contract_unverified',
    'timeout', 'rate_limited', 'unavailable', 'quarantined']);
const CONTRACT = Object.freeze({ version: 'shop-supplier-runtime-v1',
    deadline: 'abort_signal_and_absolute_deadline', retries: 'none',
    concurrency: 'one_request_per_invocation' });
const REQUEST_TIMEOUT_MS = 15000;
function safeError(code = 'supplier_runtime_unavailable') {
    return Object.assign(new Error(code), { code });
}
function enabled(value) { return value === 'true'; }
function phasesFor(env) {
    return PHASES.filter(phase => enabled(env[{
        dispatch: 'SHOP_SUPPLIER_DISPATCH_V2_ENABLED', query: 'SHOP_SUPPLIER_RECONCILE_V2_ENABLED',
        delivery: 'SHOP_SUPPLIER_DELIVERY_V2_ENABLED'
    }[phase]]));
}
function assertRuntimeContract(adapter) {
    if (!adapter?.runtimeContract || Object.keys(adapter.runtimeContract).length !== Object.keys(CONTRACT).length
        || Object.entries(CONTRACT).some(([key, value]) => adapter.runtimeContract[key] !== value)) {
        throw safeError('supplier_runtime_contract_unverified');
    }
}
function createSupplierRuntime({ db, resolveAdapter, env = process.env, requestTimeoutMs = REQUEST_TIMEOUT_MS, now = () => performance.now() } = {}) {
    if (typeof db?.rpc !== 'function' || typeof resolveAdapter !== 'function'
        || typeof now !== 'function' || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > REQUEST_TIMEOUT_MS) throw safeError();
    async function rpc(action, args = {}) {
        let response;
        try { response = await db.rpc('fn_shop_supplier_runtime_v2', { p_action: action, ...args }); }
        catch { throw safeError(); }
        if (response?.error || !response?.data || typeof response.data !== 'object' || Array.isArray(response.data)) throw safeError();
        return response.data;
    }
    async function runJob(job, allowedPhases) {
        if (!UUID.test(job?.intentId || '') || !PHASES.includes(job.phase)) throw safeError('supplier_runtime_invalid_candidates');
        const claimed = await rpc('claim', { p_intent_id: job.intentId, p_phase: job.phase, p_phases: allowedPhases });
        if (claimed.acquired !== true) return { processed: false, code: 'not_acquired' };
        if (!UUID.test(claimed.token || '') || claimed.intentId !== job.intentId || claimed.phase !== job.phase
            || !allowedPhases.includes(claimed.phase) || !UUID.test(claimed.accountId || '')) throw safeError('supplier_runtime_invalid_claim');
        let code = 'pending';
        let callCode = null;
        let sent = false;
        const resolve = async account => {
            if (account?.id !== claimed.accountId) throw safeError('supplier_runtime_account_conflict');
            let adapter;
            try { adapter = await resolveAdapter(account); assertRuntimeContract(adapter); }
            catch { callCode = 'contract_unverified'; throw safeError('supplier_runtime_contract_unverified'); }
            const method = { dispatch: 'createPurchase', query: 'queryPurchase', delivery: 'queryDelivery' }[job.phase];
            if (typeof adapter[method] !== 'function') { callCode = 'contract_unverified'; throw safeError('supplier_runtime_contract_unverified'); }
            // Original runners still enforce their exact procurement/delivery contracts.
            // Wrapping only the claimed method cannot add a new purchase capability.
            // A fresh wrapper supports frozen adapters and preserves their own
            // receiver. No method outside the claimed phase may issue HTTP.
            const wrapper = { providerId: adapter.providerId, capabilities: adapter.capabilities,
                procurementContract: adapter.procurementContract, deliveryContract: adapter.deliveryContract };
            for (const name of ['createPurchase', 'queryPurchase', 'queryDelivery']) {
                if (typeof adapter[name] === 'function') wrapper[name] = async () => { throw safeError('supplier_runtime_phase_conflict'); };
            }
            wrapper[method] = async input => {
                if (sent) throw safeError('supplier_runtime_request_already_started');
                sent = true;
                let started;
                const startClock = now();
                try { started = await rpc('start', { p_intent_id: job.intentId, p_token: claimed.token, p_phase: job.phase }); }
                catch { callCode = 'unavailable'; throw safeError(); }
                // A lost, mismatched or delayed ACK never grants permission to send.
                const stale = () => { const elapsed = now() - startClock; return !Number.isFinite(elapsed) || elapsed > 5000 || elapsed < 0; };
                if (started.applied !== true || started.intentId !== job.intentId || started.accountId !== claimed.accountId
                    || started.phase !== job.phase || started.token !== claimed.token || stale()) {
                    callCode = 'blocked'; throw safeError();
                }
                const controller = new AbortController();
                let timer;
                let requestClock;
                try {
                    const deadline = new Promise((_, reject) => {
                        timer = setTimeout(() => { controller.abort(); reject(safeError('supplier_runtime_timeout')); }, requestTimeoutMs);
                    });
                    const deadlineAt = Date.now() + requestTimeoutMs;
                    // The admitted adapter honors both bounds and never retries.
                    const result = await Promise.race([deadline, Promise.resolve().then(() => {
                        if (stale()) { callCode = 'blocked'; throw safeError(); }
                        requestClock = now();
                        return adapter[method](structuredClone(input), { signal: controller.signal, deadlineAt });
                    })]);
                    // Event-loop stalls must not accept an answer after the bound.
                    if (now() - requestClock > requestTimeoutMs || Date.now() > deadlineAt) {
                        controller.abort(); throw safeError('supplier_runtime_timeout');
                    }
                    return result;
                } catch (error) {
                    callCode = callCode || (error?.code === 'supplier_runtime_timeout' || controller.signal.aborted ? 'timeout'
                        : error?.code === 'supplier_rate_limited' ? 'rate_limited' : 'unavailable');
                    throw safeError();
                } finally { clearTimeout(timer); }
            };
            return Object.freeze(wrapper);
        };
        try {
            const procurement = createProcurementRunner({ db, resolveAdapter: resolve, env });
            const delivery = createDeliveryRunner({ db, resolveAdapter: resolve, env });
            const result = job.phase === 'dispatch' ? await procurement.dispatch(job.intentId)
                : job.phase === 'query' ? await procurement.reconcile(job.intentId) : await delivery.reconcile(job.intentId);
            if (callCode) code = callCode;
            else if (result.reason === 'supplier_dispatch_contract_unverified') code = 'contract_unverified';
            else if (result.status === 'quarantined') code = 'quarantined';
            else if (['delivered', 'accepted', 'rejected'].includes(result.status)) code = 'ok';
            else if (['outcome_unknown', 'dispatching'].includes(result.status)) code = 'unknown';
            else if (['blocked', 'review'].includes(result.status)) code = 'blocked';
            else if (result.status === 'disabled') code = 'disabled';
        } catch (error) {
            code = callCode || (/contract_unverified$/.test(error?.code || '') ? 'contract_unverified' : 'unavailable');
        }
        if (!RESULT_CODES.has(code)) code = 'unavailable';
        try {
            const finished = await rpc('finish', { p_intent_id: job.intentId, p_token: claimed.token, p_outcome: code });
            if (finished.applied !== true || finished.intentId !== job.intentId || finished.token !== claimed.token) return { processed: true, code: 'confirmation_pending' };
        } catch { return { processed: true, code: 'confirmation_pending' }; }
        return { processed: true, code };
    }
    return Object.freeze({
        async runOnce({ limit = 5 } = {}) {
            if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw safeError('supplier_runtime_invalid_limit');
            if (!enabled(env.SHOP_SUPPLIER_RUNTIME_V2_ENABLED)) return { success: true, disabled: true, processed: 0 };
            const phases = phasesFor(env);
            if (!phases.length) return { success: true, disabled: true, processed: 0 };
            const result = await rpc('scan', { p_limit: limit, p_phases: phases });
            if (!Array.isArray(result.jobs) || result.jobs.length > limit
                || result.jobs.some(job => !UUID.test(job?.intentId || '') || !phases.includes(job.phase))
                || new Set(result.jobs.map(job => job.intentId)).size !== result.jobs.length) throw safeError('supplier_runtime_invalid_candidates');
            const counts = {};
            let processed = 0;
            for (const job of result.jobs) {
                // Independent jobs are isolated. Database failures leave leases to
                // expire; no local memory flag can turn an unknown result into a send.
                let result;
                try { result = await runJob(job, phases); }
                catch { result = { processed: false, code: 'confirmation_pending' }; }
                processed += Number(result.processed);
                counts[result.code] = (counts[result.code] || 0) + 1;
            }
            return { success: !counts.confirmation_pending, disabled: false, processed, counts };
        }
    });
}
module.exports = { CONTRACT, REQUEST_TIMEOUT_MS, createSupplierRuntime, assertRuntimeContract, phasesFor };
