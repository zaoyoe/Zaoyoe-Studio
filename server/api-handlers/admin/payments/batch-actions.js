const {
    requireAdmin,
    parseJsonBody,
    sendJson
} = require('../../../../api/_lib/admin');
const paymentsActionsHandler = require('./actions');

const VALID_BATCH_ACTIONS = new Set([
    'mark_handled',
    'ignore',
    'archive',
    'request_retry'
]);
const MAX_BATCH_TARGETS = 500;
const DEFAULT_BATCH_CONCURRENCY = 12;
const MAX_BATCH_CONCURRENCY = 20;

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeBatchTarget(target = {}) {
    return {
        targetType: normalizeText(target.targetType).toLowerCase(),
        targetId: normalizeText(target.targetId)
    };
}

function dedupeBatchTargets(targets = []) {
    const uniqueTargets = new Map();

    (Array.isArray(targets) ? targets : []).forEach((target) => {
        const normalizedTarget = normalizeBatchTarget(target);
        if (!normalizedTarget.targetType || !normalizedTarget.targetId) return;
        uniqueTargets.set(`${normalizedTarget.targetType}:${normalizedTarget.targetId}`, normalizedTarget);
    });

    return Array.from(uniqueTargets.values()).slice(0, MAX_BATCH_TARGETS);
}

function resolveBatchConcurrency(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return DEFAULT_BATCH_CONCURRENCY;
    return Math.min(MAX_BATCH_CONCURRENCY, Math.max(1, Math.round(numericValue)));
}

async function mapWithConcurrency(items = [], concurrency = DEFAULT_BATCH_CONCURRENCY, mapper) {
    const results = new Array(items.length);
    let cursor = 0;

    async function worker() {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await mapper(items[index], index);
        }
    }

    const workerCount = Math.min(items.length, Math.max(1, concurrency));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const adminContext = await requireAdmin(req, { permission: 'payments.manage' });
        const body = await parseJsonBody(req);
        const action = normalizeText(body.action).toLowerCase();
        const note = normalizeText(body.note);
        const targets = dedupeBatchTargets(body.targets);
        const concurrency = resolveBatchConcurrency(body.concurrency);

        if (!VALID_BATCH_ACTIONS.has(action)) {
            return sendJson(res, 400, {
                success: false,
                message: 'Invalid batch action'
            });
        }

        if (!targets.length) {
            return sendJson(res, 400, {
                success: false,
                message: 'Missing batch targets'
            });
        }

        const results = await mapWithConcurrency(targets, concurrency, async (target) => {
            try {
                const payload = await paymentsActionsHandler.executePaymentAction({
                    ...adminContext,
                    env: process.env
                }, {
                    ...target,
                    action,
                    note
                });

                return {
                    success: true,
                    target,
                    payload
                };
            } catch (error) {
                const friendlyError = paymentsActionsHandler.resolveFriendlyActionError(error);
                return {
                    success: false,
                    target,
                    statusCode: paymentsActionsHandler.normalizeActionResponseStatus(friendlyError.statusCode),
                    message: friendlyError.message
                };
            }
        });

        const successCount = results.filter((result) => result?.success === true).length;
        const failCount = results.length - successCount;

        return sendJson(res, 200, {
            success: true,
            completed: failCount === 0,
            partial: successCount > 0 && failCount > 0,
            total_count: results.length,
            success_count: successCount,
            fail_count: failCount,
            results
        });
    } catch (error) {
        const friendlyError = paymentsActionsHandler.resolveFriendlyActionError(error);
        return sendJson(res, paymentsActionsHandler.normalizeActionResponseStatus(friendlyError.statusCode), {
            success: false,
            message: friendlyError.message
        });
    }
};
