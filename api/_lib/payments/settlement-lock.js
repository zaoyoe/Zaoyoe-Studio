const activeOrderLocks = new Map();

/**
 * Serialize async settlement work for the same logical payment order within a
 * single Node process so overlapping webhooks and status polls cannot race
 * through gateway verification and RPC crediting concurrently.
 *
 * @template T
 * @param {string} lockKey
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
async function runWithPaymentOrderLock(lockKey, task) {
    const normalizedKey = String(lockKey || '').trim();
    if (!normalizedKey) {
        return task();
    }

    const previous = activeOrderLocks.get(normalizedKey) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => task());
    const tail = run.catch(() => {});
    activeOrderLocks.set(normalizedKey, tail);

    try {
        return await run;
    } finally {
        if (activeOrderLocks.get(normalizedKey) === tail) {
            activeOrderLocks.delete(normalizedKey);
        }
    }
}

module.exports = {
    runWithPaymentOrderLock
};
