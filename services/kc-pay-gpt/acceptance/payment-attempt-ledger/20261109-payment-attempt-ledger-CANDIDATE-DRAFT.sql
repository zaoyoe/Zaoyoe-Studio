-- CANDIDATE DRAFT / REVIEW ONLY / NOT EXECUTED.
-- Target validated read-only: KC MySQL 8.0.46, database plus_papay.
-- This file is a design candidate after the 2026-11-09 preflight; it is not
-- an authorization to run. Do not execute during deployment.
--
-- Preconditions:
--   1. A recoverable backup has been created and read back.
--   2. The matching preflight evidence confirms the target and absence of
--      kc_local_payment_attempts, payment_attempt_id and the named new indexes.
--   3. No existing local attempt is backfilled from legacy task_logs, cards or
--      billing_records. Existing manual/unknown tasks remain legacy review work.
--   4. Execute each checkpoint separately and record success. MySQL DDL has
--      implicit commits; a later failure is not an automatic rollback.
--   5. Stop on any duplicate-object, constraint, engine or collation error.
--
-- The candidate deliberately uses one FK direction only:
-- kc_local_payment_attempts.settlement_billing_id -> billing_records.id.
-- billing_records.local_payment_attempt_id remains uniquely indexed and is
-- checked by the settlement adapter, avoiding a circular FK relationship.

SET NAMES utf8mb4;

-- CHECKPOINT L1: attempt ledger table. Run only when the table is absent.
CREATE TABLE kc_local_payment_attempts (
    attempt_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    job_key VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    card_id BIGINT UNSIGNED NOT NULL,
    attempt_no INT UNSIGNED NOT NULL,
    amount_minor BIGINT UNSIGNED NOT NULL,
    currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    platform VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    plan_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    checkout_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    idempotency_key CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 0,
    provider_reference_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    evidence_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    active_job VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS
        (CASE WHEN state IN ('settled_no_charge', 'cancelled') THEN NULL ELSE job_key END) STORED,
    active_card BIGINT UNSIGNED GENERATED ALWAYS AS
        (CASE WHEN state IN ('settled_paid', 'settled_no_charge', 'cancelled') THEN NULL ELSE card_id END) STORED,
    active_checkout CHAR(64) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS
        (CASE WHEN state IN ('settled_no_charge', 'cancelled') THEN NULL ELSE checkout_hash END) STORED,
    paid_reference CHAR(64) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS
        (CASE WHEN state IN ('paid', 'settled_paid') THEN provider_reference_hash ELSE NULL END) STORED,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_kc_attempt_job_sequence (job_key, attempt_no),
    UNIQUE KEY uq_kc_attempt_provider_key (idempotency_key),
    UNIQUE KEY uq_kc_attempt_active_job (active_job),
    UNIQUE KEY uq_kc_attempt_active_card (active_card),
    UNIQUE KEY uq_kc_attempt_active_checkout (active_checkout),
    UNIQUE KEY uq_kc_attempt_paid_reference (paid_reference),
    CONSTRAINT ck_kc_attempt_state CHECK (state IN
        ('prepared', 'armed', 'unknown', 'paid', 'no_charge', 'settled_paid', 'settled_no_charge', 'cancelled')),
    CONSTRAINT ck_kc_attempt_amount CHECK (amount_minor > 0 AND amount_minor <= 1000000000000),
    CONSTRAINT ck_kc_attempt_sequence CHECK (attempt_no > 0 AND attempt_no <= 2147483647),
    CONSTRAINT ck_kc_attempt_version CHECK (version <= 2147483647),
    CONSTRAINT ck_kc_attempt_provider_key CHECK (idempotency_key = CONCAT('kcpa_v1_', attempt_id)),
    CONSTRAINT ck_kc_attempt_evidence CHECK (
        (state IN ('paid', 'no_charge', 'settled_paid', 'settled_no_charge')
            AND provider_reference_hash IS NOT NULL AND evidence_hash IS NOT NULL)
        OR (state IN ('prepared', 'armed', 'unknown', 'cancelled')
            AND provider_reference_hash IS NULL AND evidence_hash IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CHECKPOINT L2: card fence. Run only when the column and index are absent.
ALTER TABLE card_assets
    ADD COLUMN payment_attempt_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD UNIQUE KEY uq_card_payment_attempt (payment_attempt_id);

-- CHECKPOINT S1: unique billing correlation. Run only when the column/index
-- are absent. Existing legacy rows remain NULL and require no backfill.
ALTER TABLE billing_records
    ADD COLUMN local_payment_attempt_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD UNIQUE KEY uq_billing_local_payment_attempt (local_payment_attempt_id);

-- CHECKPOINT S2: terminal settlement receipt and one-way FK. Run only when
-- these columns/index/constraints are absent.
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

-- After all checkpoints, rerun the read-only preflight and archive the result.
-- Keep KC_PAYMENT_ATTEMPT_ASSET_GUARD=off and live ledger callers disabled
-- until the application rollout and real InnoDB acceptance are separately done.
