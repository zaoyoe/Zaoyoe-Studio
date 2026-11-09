'use strict';

// Internal adapter only. No driver, environment, network, DDL or live caller.
// Payment evidence and fulfillment evidence must come from trusted verifiers;
// a syntactically valid hash does not authenticate either fact.
const ATTEMPT_FIELDS = 'attempt_id, job_key, card_id, attempt_no, amount_minor, currency, platform, plan_type, checkout_hash, idempotency_key, state, version, provider_reference_hash, evidence_hash';
const CARD_BOUND = "id = ? AND is_active = 1 AND in_use = 1 AND status = '支付处理中' AND CAST(locked_by AS BINARY) = CAST(? AS BINARY) AND payment_attempt_id = ?";
const SQL = Object.freeze({
    hint: 'SELECT job_key, cdk_code FROM task_logs WHERE job_key = ? LIMIT 1',
    cdk: 'SELECT cdk_code, is_active, type, used_at, platform, plan_type FROM cdk_codes WHERE cdk_code = ? LIMIT 1 FOR UPDATE',
    task: 'SELECT job_key, cdk_code, execution_mode, status, payment_state, recovery_required, finished_at, gpt_api_order_id, gpt_api_task_id, gpt_api_raw FROM task_logs WHERE job_key = ? LIMIT 1 FOR UPDATE',
    owner: 'SELECT job_key FROM task_logs WHERE cdk_code = ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
    // Preserve the same blocker rules as local activation admission. Malformed
    // provider envelopes never prove a safe terminal outcome.
    blockers: `SELECT provider_task.job_key FROM task_logs provider_task
        WHERE provider_task.cdk_code = ? AND provider_task.job_key <> ?
          AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
            OR COALESCE(provider_task.payment_state, 'unknown') NOT IN ('not_started', 'declined', 'succeeded')
            OR ((provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
              AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
                THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
              AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
                OR provider_task.payment_state IN ('started', 'unknown') OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
                OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw) THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')))
        ORDER BY provider_task.id DESC LIMIT 1 FOR UPDATE`,
    attempt: `SELECT ${ATTEMPT_FIELDS}, settlement_billing_id, settlement_daily_count, settlement_cooled_down, fulfillment_evidence_hash FROM kc_local_payment_attempts WHERE attempt_id = ? LIMIT 1 FOR UPDATE`,
    card: `SELECT id, is_active, in_use, status, locked_by, payment_attempt_id,
        RIGHT(card_number, 4) AS card_last4, usage_count, daily_usage_count,
        (daily_usage_reset_at IS NULL OR daily_usage_reset_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS reset_daily
        FROM card_assets WHERE id = ? LIMIT 1 FOR UPDATE`,
    billing: 'SELECT id, local_payment_attempt_id, amount, currency, platform, plan_type, status FROM billing_records WHERE local_payment_attempt_id = ? LIMIT 1 FOR UPDATE',
    insertBilling: `INSERT INTO billing_records
        (local_payment_attempt_id, card_last4, amount, currency, platform, plan_type, status)
        VALUES (?, ?, ?, ?, ?, ?, 'success')`,
    paidCard: `UPDATE card_assets SET usage_count = usage_count + 1,
        daily_usage_count = ?, daily_usage_reset_at = CASE WHEN ? THEN NOW() ELSE daily_usage_reset_at END,
        last_used_at = NOW(), cooldown_until = CASE WHEN ? THEN GREATEST(COALESCE(cooldown_until, NOW()), DATE_ADD(NOW(), INTERVAL 24 HOUR)) ELSE cooldown_until END,
        status = '正常', in_use = 0, locked_at = NULL, locked_by = NULL, payment_attempt_id = NULL
        WHERE ${CARD_BOUND}`,
    noChargeCard: `UPDATE card_assets SET cooldown_until = GREATEST(COALESCE(cooldown_until, NOW()), DATE_ADD(NOW(), INTERVAL 30 MINUTE)),
        status = '正常', in_use = 0, locked_at = NULL, locked_by = NULL, payment_attempt_id = NULL
        WHERE ${CARD_BOUND}`,
    paidCdk: 'UPDATE cdk_codes SET fail_count = 0, cooldown_until = NULL WHERE cdk_code = ? AND is_active = 1 AND used_at IS NOT NULL',
    noChargeCdk: 'UPDATE cdk_codes SET used_at = NULL WHERE cdk_code = ? AND is_active = 1 AND used_at IS NOT NULL',
    terminalTask: `UPDATE task_logs SET status = ?, payment_state = ?, recovery_required = 0,
        progress = ?, message = ?, finished_at = CURRENT_TIMESTAMP,
        session_payload = NULL, session_payload_encrypted = NULL
        WHERE job_key = ? AND cdk_code = ? AND execution_mode = 'local_card_pool'
          AND status IN ('running', 'manual') AND finished_at IS NULL
          AND payment_state IN ('started', 'unknown')
          AND gpt_api_order_id IS NULL AND gpt_api_task_id IS NULL AND gpt_api_raw IS NULL`,
    terminalAttempt: `UPDATE kc_local_payment_attempts SET state = ?, version = version + 1,
        settlement_billing_id = ?, settlement_daily_count = ?, settlement_cooled_down = ?, fulfillment_evidence_hash = ?
        WHERE attempt_id = ? AND version = ? AND state = ?`
});
const SCALES = Object.freeze({ USD: 2, PHP: 2, EGP: 2, SGD: 2, MYR: 2, CLP: 0 });

function createSettlement({ transaction, rows, write, bound, validateIdentity, check, MAX_VERSION }) {
    const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    function amountForBilling(attempt) {
        check(Object.hasOwn(SCALES, attempt.currency), 'ATTEMPT_CURRENCY_UNSUPPORTED');
        const cents = BigInt(attempt.amountMinor) * (SCALES[attempt.currency] === 0 ? 100n : 1n);
        check(cents <= 9999999999n, 'ATTEMPT_BILLING_AMOUNT_OUT_OF_RANGE');
        return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
    }
    function receipt(current, saved, paid) {
        check(current.state === (paid ? 'settled_paid' : 'settled_no_charge'), 'ATTEMPT_SETTLEMENT_CONFLICT');
        const billingId = saved.settlement_billing_id == null ? null : Number(saved.settlement_billing_id);
        const daily = saved.settlement_daily_count == null ? null : Number(saved.settlement_daily_count);
        const cooled = saved.settlement_cooled_down == null ? null : Number(saved.settlement_cooled_down);
        check(paid ? Number.isSafeInteger(billingId) && billingId > 0 && Number.isInteger(daily) && daily > 0
            && daily <= 2147483647 && [0, 1].includes(cooled) && (cooled === 1) === (daily >= 3)
            && hash(saved.fulfillment_evidence_hash)
            : billingId === null && daily === null && cooled === null && saved.fulfillment_evidence_hash == null,
        'ATTEMPT_RECEIPT_INVALID');
        return Object.freeze({ attemptId: current.attemptId, jobKey: current.jobKey, cardId: current.cardId,
            version: current.version, state: current.state, billingId, dailyUsageCount: daily,
            cooledDown: cooled == null ? null : cooled === 1 });
    }
    function checkBill(bill, current, amount) {
        check(bill && Number.isSafeInteger(Number(bill.id)) && Number(bill.id) > 0
            && bill.local_payment_attempt_id === current.attemptId && typeof bill.amount === 'string' && bill.amount === amount
            && bill.currency === current.currency && bill.platform === current.platform
            && bill.plan_type === current.planType && bill.status === 'success', 'ATTEMPT_BILLING_CONFLICT');
    }
    async function settle(input, fulfillmentEvidenceHash, paid) {
        const identity = validateIdentity(input);
        if (paid) check(hash(fulfillmentEvidenceHash), 'ATTEMPT_FULFILLMENT_UNCONFIRMED');
        return transaction(async c => {
            // Locator only. Re-read after locking CDK; never use the hint as
            // authorization or switch to a second CDK under this transaction.
            const hints = await rows(c, SQL.hint, [identity.jobKey]);
            const hint = hints[0];
            check(hints.length === 1 && hint.job_key === identity.jobKey && typeof hint.cdk_code === 'string'
                && hint.cdk_code.length > 0 && hint.cdk_code.length <= 32, 'ATTEMPT_TASK_MISMATCH');
            const cdks = await rows(c, SQL.cdk, [hint.cdk_code]);
            const tasks = await rows(c, SQL.task, [identity.jobKey]);
            const task = tasks[0];
            check(tasks.length === 1 && task.job_key === identity.jobKey && task.cdk_code === hint.cdk_code
                && task.execution_mode === 'local_card_pool' && task.gpt_api_order_id == null
                && task.gpt_api_task_id == null && task.gpt_api_raw == null, 'ATTEMPT_TASK_MISMATCH');
            const owners = await rows(c, SQL.owner, [hint.cdk_code]);
            const blockers = await rows(c, SQL.blockers, [hint.cdk_code, identity.jobKey]);
            const selected = await rows(c, SQL.attempt, [identity.attemptId]);
            check(selected.length === 1, 'ATTEMPT_BINDING_MISMATCH');
            const saved = selected[0], current = bound(saved, identity);
            const bills = await rows(c, SQL.billing, [current.attemptId]);
            check(bills.length <= 1, 'ATTEMPT_BILLING_CONFLICT');
            const amount = paid ? amountForBilling(current) : null;
            if (['settled_paid', 'settled_no_charge'].includes(current.state)) {
                // Replay is read-only and independent of reused assets/CDKs.
                // Only the original request version or the receipt version is valid.
                check(identity.version === current.version || identity.version === current.version - 1, 'ATTEMPT_VERSION_CONFLICT');
                const result = receipt(current, saved, paid);
                if (paid) {
                    check(saved.fulfillment_evidence_hash === fulfillmentEvidenceHash, 'ATTEMPT_SETTLEMENT_CONFLICT');
                    checkBill(bills[0], current, amount);
                    check(Number(bills[0].id) === result.billingId, 'ATTEMPT_BILLING_CONFLICT');
                } else check(bills.length === 0, 'ATTEMPT_BILLING_CONFLICT');
                return result;
            }
            check(current.version === identity.version, 'ATTEMPT_VERSION_CONFLICT');
            check(current.version < MAX_VERSION, 'ATTEMPT_VERSION_EXHAUSTED');
            check(current.state === (paid ? 'paid' : 'no_charge'), 'ATTEMPT_SETTLEMENT_REFUSED');
            check(bills.length === 0 && saved.settlement_billing_id == null && saved.settlement_daily_count == null
                && saved.settlement_cooled_down == null && saved.fulfillment_evidence_hash == null, 'ATTEMPT_RECEIPT_INVALID');
            const cdk = cdks[0];
            check(cdks.length === 1 && cdk.cdk_code === hint.cdk_code && Number(cdk.is_active) === 1
                && cdk.used_at && cdk.type === '自助' && cdk.platform === current.platform
                && cdk.plan_type === current.planType, 'ATTEMPT_CDK_MISMATCH');
            check(!task.finished_at && ['running', 'manual'].includes(task.status)
                && ['started', 'unknown'].includes(task.payment_state)
                && [0, 1].includes(Number(task.recovery_required)), 'ATTEMPT_TASK_BLOCKED');
            check(owners.length === 1 && owners[0].job_key === identity.jobKey, 'ATTEMPT_CDK_OWNER_MISMATCH');
            check(blockers.length === 0, 'ATTEMPT_OTHER_TASK_BLOCKED');
            const cards = await rows(c, SQL.card, [current.cardId]);
            const card = cards[0];
            check(cards.length === 1 && Number(card.id) === current.cardId && Number(card.is_active) === 1
                && Number(card.in_use) === 1 && card.status === '支付处理中'
                && card.locked_by === `payment_${current.jobKey}` && card.payment_attempt_id === current.attemptId,
            'ATTEMPT_CARD_OWNERSHIP_LOST');
            let billId = null, daily = null, cooled = null;
            if (paid) {
                check(typeof card.card_last4 === 'string' && /^[0-9]{4}$/.test(card.card_last4)
                    && Number.isInteger(Number(card.usage_count)) && Number(card.usage_count) >= 0 && Number(card.usage_count) < 2147483647
                    && Number.isInteger(Number(card.daily_usage_count)) && Number(card.daily_usage_count) >= 0 && Number(card.daily_usage_count) < 2147483647
                    && [0, 1].includes(Number(card.reset_daily)), 'ATTEMPT_CARD_ROW_INVALID');
                daily = Number(card.reset_daily) === 1 ? 1 : Number(card.daily_usage_count) + 1;
                cooled = daily >= 3 ? 1 : 0;
                await write(c, SQL.insertBilling, [current.attemptId, card.card_last4, amount, current.currency, current.platform, current.planType]);
                const inserted = await rows(c, SQL.billing, [current.attemptId]);
                check(inserted.length === 1, 'ATTEMPT_BILLING_CONFLICT'); checkBill(inserted[0], current, amount);
                billId = Number(inserted[0].id);
                await write(c, SQL.paidCard, [daily, Number(card.reset_daily), cooled, current.cardId, `payment_${current.jobKey}`, current.attemptId]);
            } else await write(c, SQL.noChargeCard, [current.cardId, `payment_${current.jobKey}`, current.attemptId]);
            await write(c, paid ? SQL.paidCdk : SQL.noChargeCdk, [hint.cdk_code]);
            await write(c, SQL.terminalTask, [paid ? 'success' : 'failed', paid ? 'succeeded' : 'declined', paid ? 100 : 0,
                paid ? '已核验付款及充值完成' : '已核验未扣款，CDK 已退回', current.jobKey, hint.cdk_code]);
            await write(c, SQL.terminalAttempt, [paid ? 'settled_paid' : 'settled_no_charge', billId, daily, cooled,
                paid ? fulfillmentEvidenceHash : null, current.attemptId, current.version, current.state]);
            return receipt({ ...current, version: current.version + 1, state: paid ? 'settled_paid' : 'settled_no_charge' },
                { settlement_billing_id: billId, settlement_daily_count: daily, settlement_cooled_down: cooled,
                    fulfillment_evidence_hash: paid ? fulfillmentEvidenceHash : null }, paid);
        });
    }
    return Object.freeze({
        settlePaid: (identity, fulfillmentEvidenceHash) => settle(identity, fulfillmentEvidenceHash, true),
        settleNoCharge: identity => settle(identity, null, false)
    });
}
module.exports = { createSettlement, SQL, SCALES };
