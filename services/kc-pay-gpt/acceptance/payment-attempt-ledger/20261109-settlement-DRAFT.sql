-- DRAFT ONLY / NOT EXECUTED. Follow the separate round10 ledger draft.
-- Review against an isolated MySQL 8.4 target and real schema before approval.
-- Do not put into bootstrap mysql-schema.sql or execute during deployment.
-- No backfill of legacy bills or holds: ambiguous records need human review.

ALTER TABLE billing_records
    ADD COLUMN local_payment_attempt_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD UNIQUE KEY uq_billing_local_payment_attempt (local_payment_attempt_id),
    ADD CONSTRAINT fk_billing_local_payment_attempt FOREIGN KEY (local_payment_attempt_id)
        REFERENCES kc_local_payment_attempts(attempt_id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE kc_local_payment_attempts
    ADD COLUMN settlement_billing_id BIGINT UNSIGNED NULL,
    ADD COLUMN settlement_daily_count INT UNSIGNED NULL,
    ADD COLUMN settlement_cooled_down TINYINT UNSIGNED NULL,
    ADD COLUMN fulfillment_evidence_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD UNIQUE KEY uq_kc_attempt_settlement_bill (settlement_billing_id),
    ADD CONSTRAINT fk_kc_attempt_settlement_bill FOREIGN KEY (settlement_billing_id)
        REFERENCES billing_records(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT ck_kc_attempt_settlement_receipt CHECK (
        (state = 'settled_paid' AND settlement_billing_id IS NOT NULL
            AND settlement_daily_count BETWEEN 1 AND 2147483647
            AND settlement_daily_count IS NOT NULL AND settlement_cooled_down IS NOT NULL
            AND settlement_cooled_down = IF(settlement_daily_count >= 3, 1, 0)
            AND fulfillment_evidence_hash IS NOT NULL)
        OR (state <> 'settled_paid' AND settlement_billing_id IS NULL
            AND settlement_daily_count IS NULL AND settlement_cooled_down IS NULL
            AND fulfillment_evidence_hash IS NULL));

-- Billing remains DECIMAL(10,2). Adapter rejects out-of-range/unsupported
-- amounts; USD/PHP/EGP/SGD/MYR use 2 minor digits, CLP uses 0. No float math.
-- SQL/DDL atomicity, generated indexes, FK behavior, concurrency and restart
-- are NOT established by the offline transaction model.
