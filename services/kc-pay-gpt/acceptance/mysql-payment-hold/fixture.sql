-- REVIEW ONLY: generated fixture for a new disposable MySQL 8.4 instance.
-- NEVER run on KVM4, a production database, or a forwarded production port.
-- No DROP / TRUNCATE / production schema initialization is performed by the runner.
-- __DATABASE__ and __RUN_ID__ are substituted by the offline plan command.
CREATE DATABASE __DATABASE__ CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE __DATABASE__;
CREATE TABLE lab_identity (
    run_id CHAR(16) NOT NULL PRIMARY KEY,
    purpose VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO lab_identity (run_id, purpose)
VALUES ('__RUN_ID__', 'KC_PAYMENT_HOLD_DISPOSABLE_LAB_V1');
CREATE TABLE card_assets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    card_number VARCHAR(32) NOT NULL,
    card_expiry VARCHAR(16) NOT NULL DEFAULT '',
    card_cvc VARCHAR(16) NOT NULL DEFAULT '',
    card_holder VARCHAR(128) NOT NULL DEFAULT '' COMMENT '持卡人姓名',
    usage_count INT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT '正常',
    in_use TINYINT(1) NOT NULL DEFAULT 0,
    locked_at TIMESTAMP NULL DEFAULT NULL,
    locked_by VARCHAR(64) NULL DEFAULT NULL,
    last_used_at TIMESTAMP NULL DEFAULT NULL COMMENT '最后使用时间',
    daily_usage_count INT NOT NULL DEFAULT 0 COMMENT '24h 内使用次数',
    daily_usage_reset_at TIMESTAMP NULL DEFAULT NULL COMMENT '24h 计数重置时间',
    cooldown_until TIMESTAMP NULL DEFAULT NULL COMMENT '冷却截止时间',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_card_assets_sort (sort_order, id),
    KEY idx_card_assets_pick (is_active, in_use, locked_at, usage_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE phone_assets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(32) NOT NULL,
    sms_api_key VARCHAR(255) NOT NULL DEFAULT '',
    usage_count INT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT '正常',
    in_use TINYINT(1) NOT NULL DEFAULT 0,
    locked_at TIMESTAMP NULL DEFAULT NULL,
    locked_by VARCHAR(64) NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_phone_assets_phone (phone),
    KEY idx_phone_assets_sort (sort_order, id),
    KEY idx_phone_assets_pick (is_active, in_use, locked_at, usage_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pool_emails (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    password VARCHAR(512) NOT NULL DEFAULT '',
    client_id VARCHAR(128) NOT NULL DEFAULT '',
    refresh_token TEXT NULL,
    registered TINYINT(1) NOT NULL DEFAULT 0,
    registered_at TIMESTAMP NULL DEFAULT NULL,
    in_use TINYINT(1) NOT NULL DEFAULT 0,
    locked_at TIMESTAMP NULL DEFAULT NULL,
    locked_by VARCHAR(64) NULL DEFAULT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_pool_emails_email (email),
    KEY idx_pool_emails_pick (registered, is_active, in_use, locked_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE task_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    job_key VARCHAR(64) NOT NULL,
    token_preview VARCHAR(64) NOT NULL,
    session_payload MEDIUMTEXT NULL COMMENT 'Legacy plaintext Session; new rows use encrypted storage',
    session_payload_encrypted MEDIUMTEXT NULL,
    session_fingerprint CHAR(64) NULL,
    execution_mode VARCHAR(32) NOT NULL DEFAULT 'legacy_unknown',
    cdk_code VARCHAR(32) NULL,
    phone VARCHAR(32) NULL,
    card_last4 VARCHAR(4) NULL,
    status VARCHAR(32) NOT NULL,
    message VARCHAR(255) NULL,
    progress INT NOT NULL DEFAULT 0,
    display_time VARCHAR(64) NOT NULL,
    raw_output MEDIUMTEXT NULL,
    auto_renew_status VARCHAR(32) NOT NULL DEFAULT 'not_applicable',
    auto_renew_message VARCHAR(255) NULL,
    payment_state VARCHAR(32) NOT NULL DEFAULT 'not_started',
    recovery_required TINYINT(1) NOT NULL DEFAULT 0,
    started_at TIMESTAMP NULL DEFAULT NULL,
    finished_at TIMESTAMP NULL DEFAULT NULL,
    last_heartbeat_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_task_logs_job_key (job_key),
    KEY idx_task_logs_created (created_at),
    KEY idx_task_logs_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- These runtime columns are normally added by ensureGptApiColumns / ensureLegacyColumns.
ALTER TABLE task_logs
    ADD COLUMN gpt_api_order_id VARCHAR(128) NULL,
    ADD COLUMN gpt_api_task_id VARCHAR(128) NULL,
    ADD COLUMN gpt_api_raw MEDIUMTEXT NULL;
-- Requires partial_revokes=OFF in the disposable instance; escaped database underscores are literal.
-- Public, synthetic lab credential only. Bind the disposable server to loopback.
CREATE USER 'kc_fault_harness'@'%' IDENTIFIED BY 'kc-fault-synthetic-local-only';
GRANT SELECT, INSERT, UPDATE, DELETE ON `__GRANT_DATABASE__`.* TO 'kc_fault_harness'@'%';
-- Populate the target JSON's serverUuid using this isolated instance's value.
SELECT @@server_uuid;
