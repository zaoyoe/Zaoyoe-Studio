-- DRAFT / REVIEW ONLY / NOT EXECUTED. Not included in mysql-schema.sql.
-- Do not apply or enable until every legacy card mutation/cleanup and all
-- payment/settlement callers honor the attempt fence. No automatic bootstrap.
-- MySQL 8.4 design; real DDL/index/locking/rollback acceptance NOT RUN.
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
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_kc_attempt_job_sequence (job_key, attempt_no),
    UNIQUE KEY uq_kc_attempt_provider_key (idempotency_key),
    UNIQUE KEY uq_kc_attempt_active_job (active_job),
    UNIQUE KEY uq_kc_attempt_active_card (active_card),
    UNIQUE KEY uq_kc_attempt_active_checkout (active_checkout),
    CONSTRAINT ck_kc_attempt_state CHECK (state IN
        ('prepared', 'armed', 'unknown', 'paid', 'no_charge', 'settled_paid', 'settled_no_charge', 'cancelled')),
    CONSTRAINT ck_kc_attempt_amount CHECK (amount_minor > 0 AND amount_minor <= 1000000000000),
    CONSTRAINT ck_kc_attempt_sequence CHECK (attempt_no > 0 AND attempt_no <= 2147483647),
    CONSTRAINT ck_kc_attempt_version CHECK (version <= 2147483647),
    CONSTRAINT ck_kc_attempt_provider_key CHECK (idempotency_key = CONCAT('kcpa_v1_', attempt_id))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE card_assets
    ADD COLUMN payment_attempt_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD UNIQUE KEY uq_card_payment_attempt (payment_attempt_id);

-- No settlement implementation or migration/backfill of existing holds here.
-- No DROP/TRUNCATE, no activation flag, no privilege grants, no real data.
