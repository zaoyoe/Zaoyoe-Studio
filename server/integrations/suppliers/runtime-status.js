'use strict';

// This projection contains no lease tokens, credential references or goods.
const PHASES = new Set(['dispatch', 'query', 'delivery', 'review', 'completed']);
const STATES = new Set(['untracked', 'paused', 'waiting', 'running', 'review', 'completed']);
const CODES = new Set(['idle', 'running', 'ok', 'pending', 'unknown', 'blocked', 'disabled',
    'contract_unverified', 'timeout', 'rate_limited', 'unavailable', 'quarantined']);
const ALERTS = new Set(['outcome_unknown', 'procurement_review', 'delivery_quarantined',
    'customer_closed_upstream_pending', 'adapter_unverified', 'runtime_exhausted',
    'upstream_timeout', 'upstream_rate_limited', 'upstream_unavailable', 'account_circuit_open',
    'runtime_lease_expired', 'dispatch_blocked']);
function normalizeRuntime(value) {
    const timestamp = value => value === null || (typeof value === 'string' && value.length <= 80
        && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)));
    if (!value || !PHASES.has(value.phase) || !STATES.has(value.state) || !CODES.has(value.lastCode)
        || (value.alertCode !== null && !ALERTS.has(value.alertCode))
        || !Number.isInteger(value.attempts) || value.attempts < 0 || value.attempts > 48
        || !timestamp(value.nextRunAt) || !timestamp(value.lastAttemptAt)) {
        throw Object.assign(new Error('运行记录暂不可用'), { code: 'supplier_runtime_projection_invalid' });
    }
    return { phase: value.phase, state: value.state, lastCode: value.lastCode, alertCode: value.alertCode,
        attempts: value.attempts, nextRunAt: value.nextRunAt, lastAttemptAt: value.lastAttemptAt };
}
module.exports = { normalizeRuntime };
