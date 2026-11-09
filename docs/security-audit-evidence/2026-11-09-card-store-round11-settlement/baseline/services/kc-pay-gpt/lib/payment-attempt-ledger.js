'use strict';

// Foundation only: deliberately NOT imported by any live payment/server path.
// No driver, environment, bootstrap DDL, provider client or automatic retries.
const { randomBytes } = require('node:crypto');
const MAX_MINOR = 1_000_000_000_000;
const MAX_VERSION = 2147483647;
const STATES = Object.freeze(['prepared', 'armed', 'unknown', 'paid', 'no_charge',
    'settled_paid', 'settled_no_charge', 'cancelled']);
class LedgerError extends Error {
    constructor(code) { super(code); this.code = code; }
}
const check = (condition, code) => { if (!condition) throw new LedgerError(code); };
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const job = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const money = value => positive(value) && value <= MAX_MINOR;
const currency = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
function shape(value, keys) {
    check(value && Object.getPrototypeOf(value) === Object.prototype
        && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)), 'ATTEMPT_INPUT_INVALID');
}
function validateIntent(value) {
    shape(value, ['jobKey', 'cardId', 'amountMinor', 'currency', 'platform', 'planType', 'checkoutHash']);
    check(job(value.jobKey) && positive(value.cardId) && money(value.amountMinor) && currency(value.currency)
        && ['chatgpt', 'claude', 'grok'].includes(value.platform)
        && typeof value.planType === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value.planType)
        && hex(value.checkoutHash, 64), 'ATTEMPT_INPUT_INVALID');
    return Object.freeze({ ...value });
}
function validateIdentity(value) {
    shape(value, ['attemptId', 'jobKey', 'cardId', 'version']);
    check(hex(value.attemptId, 32) && job(value.jobKey) && positive(value.cardId)
        && Number.isInteger(value.version) && value.version >= 0 && value.version <= MAX_VERSION, 'ATTEMPT_INPUT_INVALID');
    return Object.freeze({ ...value });
}
function validateOutcome(value) {
    const keys = value?.kind === 'unknown' ? ['kind']
        : ['kind', 'amountMinor', 'currency', 'checkoutHash', 'providerReferenceHash', 'evidenceHash'];
    shape(value, keys);
    check(['unknown', 'paid', 'no_charge'].includes(value.kind), 'ATTEMPT_INPUT_INVALID');
    if (value.kind !== 'unknown') check(money(value.amountMinor) && currency(value.currency)
        && hex(value.checkoutHash, 64) && hex(value.providerReferenceHash, 64)
        && hex(value.evidenceHash, 64), 'ATTEMPT_INPUT_INVALID');
    return Object.freeze({ ...value });
}

const COLUMNS = 'attempt_id, job_key, card_id, attempt_no, amount_minor, currency, platform, plan_type, checkout_hash, idempotency_key, state, version, provider_reference_hash, evidence_hash';
const SQL = Object.freeze({
    task: 'SELECT job_key, execution_mode, status, payment_state, recovery_required, finished_at, gpt_api_order_id, gpt_api_task_id, gpt_api_raw FROM task_logs WHERE job_key = ? LIMIT 1 FOR UPDATE',
    latest: `SELECT ${COLUMNS} FROM kc_local_payment_attempts WHERE job_key = ? ORDER BY attempt_no DESC LIMIT 1 FOR UPDATE`,
    attempt: `SELECT ${COLUMNS} FROM kc_local_payment_attempts WHERE attempt_id = ? LIMIT 1 FOR UPDATE`,
    card: 'SELECT id, is_active, in_use, status, locked_by, payment_attempt_id FROM card_assets WHERE id = ? LIMIT 1 FOR UPDATE',
    insert: `INSERT INTO kc_local_payment_attempts (attempt_id, job_key, card_id, attempt_no, amount_minor, currency, platform, plan_type, checkout_hash, idempotency_key, state, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', 0)`,
    bind: "UPDATE card_assets SET payment_attempt_id = ? WHERE id = ? AND is_active = 1 AND in_use = 1 AND status = '正常' AND CAST(locked_by AS BINARY) = CAST(? AS BINARY) AND payment_attempt_id IS NULL",
    hold: "UPDATE card_assets SET status = '支付处理中' WHERE id = ? AND is_active = 1 AND in_use = 1 AND status = '正常' AND CAST(locked_by AS BINARY) = CAST(? AS BINARY) AND payment_attempt_id = ?",
    started: "UPDATE task_logs SET payment_state = 'started' WHERE job_key = ? AND status = 'running' AND recovery_required = 0 AND finished_at IS NULL AND payment_state IN ('not_started', 'declined')",
    transition: 'UPDATE kc_local_payment_attempts SET state = ?, version = version + 1, provider_reference_hash = ?, evidence_hash = ? WHERE attempt_id = ? AND version = ? AND state = ?'
});
function view(row) {
    check(row && hex(row.attempt_id, 32) && job(row.job_key) && positive(Number(row.card_id))
        && positive(Number(row.attempt_no)) && Number(row.attempt_no) <= MAX_VERSION
        && money(Number(row.amount_minor)) && currency(row.currency) && STATES.includes(row.state)
        && Number.isInteger(Number(row.version)) && Number(row.version) >= 0 && Number(row.version) <= MAX_VERSION
        && hex(row.checkout_hash, 64) && row.idempotency_key === `kcpa_v1_${row.attempt_id}`
        && ['chatgpt', 'claude', 'grok'].includes(row.platform)
        && typeof row.plan_type === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(row.plan_type), 'ATTEMPT_ROW_INVALID');
    if (['paid', 'no_charge', 'settled_paid', 'settled_no_charge'].includes(row.state)) {
        check(hex(row.provider_reference_hash, 64) && hex(row.evidence_hash, 64), 'ATTEMPT_ROW_INVALID');
    } else check(row.provider_reference_hash == null && row.evidence_hash == null, 'ATTEMPT_ROW_INVALID');
    return Object.freeze({ attemptId: row.attempt_id, jobKey: row.job_key, cardId: Number(row.card_id),
        attemptNo: Number(row.attempt_no), amountMinor: Number(row.amount_minor), currency: row.currency,
        platform: row.platform, planType: row.plan_type, checkoutHash: row.checkout_hash,
        idempotencyKey: row.idempotency_key, state: row.state, version: Number(row.version),
        providerReferenceHash: row.provider_reference_hash ?? null, evidenceHash: row.evidence_hash ?? null });
}
function bound(row, identity) {
    const current = view(row);
    check(current.attemptId === identity.attemptId && current.jobKey === identity.jobKey
        && current.cardId === identity.cardId, 'ATTEMPT_BINDING_MISMATCH');
    return current;
}
function taskMatches(row, jobKey, runnable) {
    check(row && row.job_key === jobKey && row.execution_mode === 'local_card_pool'
        && row.gpt_api_order_id == null && row.gpt_api_task_id == null && row.gpt_api_raw == null, 'ATTEMPT_TASK_MISMATCH');
    if (runnable) check(row.status === 'running' && !row.finished_at && Number(row.recovery_required) === 0
        && ['not_started', 'declined'].includes(row.payment_state), 'ATTEMPT_TASK_BLOCKED');
}
function cardMatches(row, current, fence) {
    check(row && Number(row.id) === current.cardId && Number(row.is_active) === 1
        && Number(row.in_use) === 1 && row.status === '正常'
        && row.locked_by === `payment_${current.jobKey}`
        && (fence ? row.payment_attempt_id === current.attemptId : row.payment_attempt_id == null), 'ATTEMPT_CARD_OWNERSHIP_LOST');
}
function storageError(error) {
    if (error instanceof LedgerError) return error;
    // Never copy raw driver message, SQL, parameters, or cause into the error.
    return new LedgerError('ATTEMPT_STORAGE_UNCONFIRMED');
}
function createLedger(pool, { timeoutMs = 5000 } = {}) {
    check(pool && typeof pool.getConnection === 'function', 'ATTEMPT_ADAPTER_INVALID');
    check(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 5000, 'ATTEMPT_ADAPTER_INVALID');
    const destroy = c => { try { c.destroy(); } catch (_) { /* no error replacement */ } };
    async function bounded(action, onTimeout) {
        let timer;
        try {
            return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
                timer = setTimeout(() => {
                    onTimeout(); reject(new LedgerError('ATTEMPT_STORAGE_UNCONFIRMED'));
                }, timeoutMs);
            })]);
        } finally { clearTimeout(timer); }
    }
    async function acquire() {
        let expired = false;
        return bounded(() => Promise.resolve(pool.getConnection()).then(c => {
            if (expired) { destroy(c); throw new LedgerError('ATTEMPT_STORAGE_UNCONFIRMED'); }
            return c;
        }), () => { expired = true; });
    }
    const call = (c, method, ...args) => bounded(() => c[method](...args), () => destroy(c));
    async function transaction(body) {
        let c, committed = false;
        try {
            c = await acquire();
            await call(c, 'beginTransaction');
            const result = await body(c);
            await call(c, 'commit');
            committed = true;
            return result; // The caller cannot dispatch until commit ACK.
        } catch (error) {
            if (c) {
                try { await call(c, 'rollback'); } catch (_) { /* original outcome remains unconfirmed */ }
                destroy(c);
            }
            throw storageError(error);
        } finally {
            if (c && committed) {
                try { c.release(); }
                catch (_) { try { c.destroy(); } catch (_) {} throw new LedgerError('ATTEMPT_STORAGE_UNCONFIRMED'); }
            }
        }
    }
    const rows = async (c, sql, params) => (await call(c, 'query', { sql, timeout: timeoutMs }, params))[0];
    const write = async (c, sql, params) => {
        const result = (await call(c, 'execute', { sql, timeout: timeoutMs }, params))[0];
        check(Number(result?.affectedRows) === 1, 'ATTEMPT_CAS_CONFLICT');
    };
    const readTask = async (c, key, runnable) => {
        const result = await rows(c, SQL.task, [key]);
        check(result.length === 1, 'ATTEMPT_TASK_MISMATCH'); taskMatches(result[0], key, runnable);
        return result[0];
    };
    async function prepare(input) {
        const intent = validateIntent(input);
        const attemptId = randomBytes(16).toString('hex');
        return transaction(async c => {
            // Same lock order for all writers: task -> attempt -> card.
            const task = await readTask(c, intent.jobKey, true);
            const previous = await rows(c, SQL.latest, [intent.jobKey]);
            check(previous.length <= 1, 'ATTEMPT_ROW_INVALID');
            let attemptNo = 1;
            if (previous.length) {
                const last = view(previous[0]);
                check(last.jobKey === intent.jobKey && ['settled_no_charge', 'cancelled'].includes(last.state), 'ATTEMPT_PREVIOUS_UNRESOLVED');
                check(last.attemptNo < MAX_VERSION, 'ATTEMPT_VERSION_EXHAUSTED'); attemptNo = last.attemptNo + 1;
            } else check(task.payment_state === 'not_started', 'ATTEMPT_LEGACY_REQUIRES_REVIEW');
            const card = await rows(c, SQL.card, [intent.cardId]);
            cardMatches(card[0], intent, false);
            const row = { attempt_id: attemptId, job_key: intent.jobKey, card_id: intent.cardId,
                attempt_no: attemptNo, amount_minor: intent.amountMinor, currency: intent.currency,
                platform: intent.platform, plan_type: intent.planType, checkout_hash: intent.checkoutHash,
                idempotency_key: `kcpa_v1_${attemptId}`, state: 'prepared', version: 0,
                provider_reference_hash: null, evidence_hash: null };
            await write(c, SQL.insert, [attemptId, intent.jobKey, intent.cardId, attemptNo, intent.amountMinor,
                intent.currency, intent.platform, intent.planType, intent.checkoutHash, row.idempotency_key]);
            await write(c, SQL.bind, [attemptId, intent.cardId, `payment_${intent.jobKey}`]);
            return view(row);
        });
    }
    async function observe(input, rawOutcome) {
        const identity = validateIdentity(input), outcome = validateOutcome(rawOutcome);
        // Trusted server-side verifier only; a proof hash is not authentication.
        return transaction(async c => {
            await readTask(c, identity.jobKey, false);
            const selected = await rows(c, SQL.attempt, [identity.attemptId]);
            const current = bound(selected[0], identity);
            if (outcome.kind !== 'unknown') check(outcome.amountMinor === current.amountMinor
                && outcome.currency === current.currency && outcome.checkoutHash === current.checkoutHash, 'ATTEMPT_EVIDENCE_MISMATCH');
            const provider = outcome.providerReferenceHash ?? null, evidence = outcome.evidenceHash ?? null;
            if (current.state === outcome.kind && current.providerReferenceHash === provider && current.evidenceHash === evidence) return current;
            check(current.version === identity.version, 'ATTEMPT_VERSION_CONFLICT');
            check(current.version < MAX_VERSION, 'ATTEMPT_VERSION_EXHAUSTED');
            check(['armed', 'unknown'].includes(current.state), 'ATTEMPT_TRANSITION_REFUSED');
            await write(c, SQL.transition, [outcome.kind, provider, evidence, identity.attemptId, identity.version, current.state]);
            return Object.freeze({ ...current, state: outcome.kind, version: current.version + 1,
                providerReferenceHash: provider, evidenceHash: evidence });
        });
    }
    async function dispatch(input, submit) {
        const identity = validateIdentity(input);
        check(typeof submit === 'function', 'ATTEMPT_ADAPTER_INVALID');
        const armed = await transaction(async c => {
            await readTask(c, identity.jobKey, true);
            const selected = await rows(c, SQL.attempt, [identity.attemptId]);
            const current = bound(selected[0], identity);
            check(current.version === identity.version, 'ATTEMPT_VERSION_CONFLICT');
            check(current.version < MAX_VERSION, 'ATTEMPT_VERSION_EXHAUSTED');
            check(current.state === 'prepared', 'ATTEMPT_DISPATCH_REFUSED');
            const card = await rows(c, SQL.card, [current.cardId]); cardMatches(card[0], current, true);
            await write(c, SQL.hold, [current.cardId, `payment_${current.jobKey}`, current.attemptId]);
            await write(c, SQL.started, [current.jobKey]);
            await write(c, SQL.transition, ['armed', null, null, current.attemptId, current.version, 'prepared']);
            return Object.freeze({ ...current, state: 'armed', version: current.version + 1 });
        });
        try { return Object.freeze({ attempt: armed, result: await submit(armed) }); }
        catch (_) {
            // No second call, fallback, unlock or reuse after an ambiguous result.
            try { await observe({ attemptId: armed.attemptId, jobKey: armed.jobKey, cardId: armed.cardId,
                version: armed.version }, { kind: 'unknown' }); } catch (_) { /* armed is already durable */ }
            throw new LedgerError('ATTEMPT_RESULT_UNKNOWN');
        }
    }
    return Object.freeze({ prepare, dispatch, observe });
}
module.exports = { createLedger, LedgerError, validateIntent, validateIdentity, validateOutcome, SQL, STATES, MAX_MINOR, MAX_VERSION };
