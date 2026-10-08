-- KC-PAY-GPT P0-P2 task lifecycle and Session protection.
-- This file is intentionally not executed by Codex. Apply it to the KC database
-- during a planned maintenance window if schema auto-migration is disabled.
ALTER TABLE task_logs
    ADD COLUMN session_payload_encrypted MEDIUMTEXT NULL AFTER session_payload,
    ADD COLUMN session_fingerprint CHAR(64) NULL AFTER session_payload_encrypted,
    ADD COLUMN execution_mode VARCHAR(32) NOT NULL DEFAULT 'legacy_unknown' AFTER session_fingerprint,
    ADD COLUMN auto_renew_status VARCHAR(32) NOT NULL DEFAULT 'not_applicable' AFTER raw_output,
    ADD COLUMN auto_renew_message VARCHAR(255) NULL AFTER auto_renew_status,
    ADD COLUMN payment_state VARCHAR(32) NOT NULL DEFAULT 'not_started' AFTER auto_renew_message,
    ADD COLUMN recovery_required TINYINT(1) NOT NULL DEFAULT 0 AFTER payment_state,
    ADD COLUMN started_at TIMESTAMP NULL DEFAULT NULL AFTER recovery_required,
    ADD COLUMN finished_at TIMESTAMP NULL DEFAULT NULL AFTER started_at,
    ADD COLUMN last_heartbeat_at TIMESTAMP NULL DEFAULT NULL AFTER finished_at;

-- Existing plaintext rows are historical evidence. Do not copy them into the
-- encrypted column without using the application encryption key. New writes are
-- encrypted by mysql-store.js. After reviewing old rows, clear session_payload
-- through the application or a controlled migration process.
