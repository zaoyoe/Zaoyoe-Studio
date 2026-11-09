-- Statement 1; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 2; parameters intentionally omitted
SELECT @@server_uuid AS server_uuid, @@version AS version, CURRENT_USER() AS `current_user`, DATABASE() AS db, @@partial_revokes AS partial_revokes, CURRENT_ROLE() AS `current_role`;

-- Statement 3; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 4; parameters intentionally omitted
SHOW GRANTS;

-- Statement 5; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 6; parameters intentionally omitted
SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?;

-- Statement 7; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 8; parameters intentionally omitted
SELECT run_id, purpose FROM lab_identity;

-- Statement 9; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 10; parameters intentionally omitted
SELECT COUNT(*) AS count FROM card_assets;

-- Statement 11; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 12; parameters intentionally omitted
SELECT COUNT(*) AS count FROM phone_assets;

-- Statement 13; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 14; parameters intentionally omitted
SELECT COUNT(*) AS count FROM pool_emails;

-- Statement 15; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 16; parameters intentionally omitted
SELECT COUNT(*) AS count FROM task_logs;

-- Statement 17; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 18; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 19; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 20; parameters intentionally omitted
DELETE FROM phone_assets;

-- Statement 21; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 22; parameters intentionally omitted
DELETE FROM pool_emails;

-- Statement 23; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 24; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 25; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 26; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 27; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 28; parameters intentionally omitted
START TRANSACTION;

-- Statement 29; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 30; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 31; parameters intentionally omitted
COMMIT;

-- Statement 32; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 33; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 34; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 35; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE id = ? AND is_active = 1 AND in_use = 1
           AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 36; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 37; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 38; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 39; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE id = ? AND is_active = 1 AND in_use = 1
           AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 40; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 41; parameters intentionally omitted
UPDATE card_assets SET locked_by = ? WHERE id = ?;

-- Statement 42; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 43; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 44; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 45; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE id = ? AND is_active = 1 AND in_use = 1
           AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 46; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 47; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 48; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 49; parameters intentionally omitted
UPDATE card_assets SET locked_by = ? WHERE id = ?;

-- Statement 50; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 51; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 52; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 53; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 54; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 55; parameters intentionally omitted
UPDATE card_assets SET status = '正常', in_use = 0, locked_at = NULL, locked_by = NULL
         WHERE id = ? AND is_active = 1 AND status = '支付处理中' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 56; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 57; parameters intentionally omitted
UPDATE card_assets SET status = '正常', in_use = 0, locked_at = NULL, locked_by = NULL
         WHERE id = ? AND is_active = 1 AND status = '支付处理中' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 58; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 59; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 60; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 61; parameters intentionally omitted
UPDATE card_assets SET status = '正常', in_use = 0, locked_at = NULL, locked_by = NULL
         WHERE id = ? AND is_active = 1 AND status = '支付处理中' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 62; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 63; parameters intentionally omitted
UPDATE card_assets SET status = '正常', in_use = 0, locked_at = NULL, locked_by = NULL
         WHERE id = ? AND is_active = 1 AND status = '支付处理中' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 64; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 65; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 66; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 67; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 68; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 69; parameters intentionally omitted
DELETE FROM phone_assets;

-- Statement 70; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 71; parameters intentionally omitted
DELETE FROM pool_emails;

-- Statement 72; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 73; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 74; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 75; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 76; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 77; parameters intentionally omitted
START TRANSACTION;

-- Statement 78; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 79; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 80; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 81; parameters intentionally omitted
START TRANSACTION;

-- Statement 82; parameters intentionally omitted
COMMIT;

-- Statement 83; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 84; parameters intentionally omitted
COMMIT;

-- Statement 85; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 86; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 87; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 88; parameters intentionally omitted
DELETE FROM phone_assets;

-- Statement 89; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 90; parameters intentionally omitted
DELETE FROM pool_emails;

-- Statement 91; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 92; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 93; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 94; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 95; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 96; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 97; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 98; parameters intentionally omitted
START TRANSACTION;

-- Statement 99; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 100; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 101; parameters intentionally omitted
COMMIT;

-- Statement 102; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 103; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 104; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 105; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 106; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 107; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 108; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 109; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 110; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 111; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 112; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 113; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 114; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 115; parameters intentionally omitted
UPDATE phone_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1;

-- Statement 116; parameters intentionally omitted
UPDATE card_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1 AND status = '正常' AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    )) AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 117; parameters intentionally omitted
UPDATE pool_emails SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE registered = 0 AND in_use = 1;

-- Statement 118; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 119; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE in_use = 1 AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY)
           AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ));

-- Statement 120; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 121; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE id = ? AND is_active = 1 AND in_use = 1
           AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 122; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 123; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 124; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 125; parameters intentionally omitted
START TRANSACTION;

-- Statement 126; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 127; parameters intentionally omitted
COMMIT;

-- Statement 128; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 129; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 130; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 131; parameters intentionally omitted
DELETE FROM phone_assets;

-- Statement 132; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 133; parameters intentionally omitted
DELETE FROM pool_emails;

-- Statement 134; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 135; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 136; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 137; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 138; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 139; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 140; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 141; parameters intentionally omitted
UPDATE card_assets SET in_use = 1, locked_by = ?, locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 142; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 143; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 144; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 145; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 146; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 147; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 148; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 149; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 150; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 151; parameters intentionally omitted
UPDATE phone_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1;

-- Statement 152; parameters intentionally omitted
UPDATE card_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1 AND status = '正常' AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    )) AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 153; parameters intentionally omitted
UPDATE pool_emails SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE registered = 0 AND in_use = 1;

-- Statement 154; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 155; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE in_use = 1 AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY)
           AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ));

-- Statement 156; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 157; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 158; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 159; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 160; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 161; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 162; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 163; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 164; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 165; parameters intentionally omitted
UPDATE card_assets SET in_use = 1, locked_by = ?, locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 166; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 167; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 168; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 169; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 170; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 171; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 172; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 173; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 174; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 175; parameters intentionally omitted
UPDATE phone_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1;

-- Statement 176; parameters intentionally omitted
UPDATE card_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1 AND status = '正常' AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    )) AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 177; parameters intentionally omitted
UPDATE pool_emails SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE registered = 0 AND in_use = 1;

-- Statement 178; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 179; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE in_use = 1 AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY)
           AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ));

-- Statement 180; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 181; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 182; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 183; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 184; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 185; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 186; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 187; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 188; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 189; parameters intentionally omitted
UPDATE card_assets SET in_use = 1, locked_by = ?, locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 190; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 191; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 192; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 193; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 194; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 195; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 196; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 197; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 198; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 199; parameters intentionally omitted
UPDATE phone_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1;

-- Statement 200; parameters intentionally omitted
UPDATE card_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1 AND status = '正常' AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    )) AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 201; parameters intentionally omitted
UPDATE pool_emails SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE registered = 0 AND in_use = 1;

-- Statement 202; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 203; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE in_use = 1 AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY)
           AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ));

-- Statement 204; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 205; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 206; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 207; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 208; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 209; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 210; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 211; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 212; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 213; parameters intentionally omitted
UPDATE card_assets SET in_use = 1, locked_by = ?, locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 214; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 215; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 216; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 217; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 218; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 219; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 220; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 221; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 222; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 223; parameters intentionally omitted
UPDATE phone_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1;

-- Statement 224; parameters intentionally omitted
UPDATE card_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1 AND status = '正常' AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    )) AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 225; parameters intentionally omitted
UPDATE pool_emails SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE registered = 0 AND in_use = 1;

-- Statement 226; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 227; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE in_use = 1 AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY)
           AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ));

-- Statement 228; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 229; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 230; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 231; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 232; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 233; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 234; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 235; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 236; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 237; parameters intentionally omitted
UPDATE card_assets SET in_use = 1, locked_by = ?, locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 238; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 239; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 240; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 241; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 242; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 243; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 244; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 245; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 246; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 247; parameters intentionally omitted
UPDATE phone_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1;

-- Statement 248; parameters intentionally omitted
UPDATE card_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1 AND status = '正常' AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    )) AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 249; parameters intentionally omitted
UPDATE pool_emails SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE registered = 0 AND in_use = 1;

-- Statement 250; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 251; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE in_use = 1 AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY)
           AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ));

-- Statement 252; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 253; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 254; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 255; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 256; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 257; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 258; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 259; parameters intentionally omitted
UPDATE card_assets SET in_use = 1, locked_by = ?, locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 260; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 261; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 262; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 263; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 264; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 265; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 266; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 267; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 268; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 269; parameters intentionally omitted
UPDATE phone_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1;

-- Statement 270; parameters intentionally omitted
UPDATE card_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1 AND status = '正常' AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    )) AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 271; parameters intentionally omitted
UPDATE pool_emails SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE registered = 0 AND in_use = 1;

-- Statement 272; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 273; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE in_use = 1 AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY)
           AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ));

-- Statement 274; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 275; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 276; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 277; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 278; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 279; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 280; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 281; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 282; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 283; parameters intentionally omitted
UPDATE card_assets SET in_use = 1, locked_by = ?, locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 284; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 285; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 286; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 287; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 288; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 289; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 290; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 291; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 292; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 293; parameters intentionally omitted
UPDATE phone_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1;

-- Statement 294; parameters intentionally omitted
UPDATE card_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1 AND status = '正常' AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    )) AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 295; parameters intentionally omitted
UPDATE pool_emails SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE registered = 0 AND in_use = 1;

-- Statement 296; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 297; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE in_use = 1 AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY)
           AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ));

-- Statement 298; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 299; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 300; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 301; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 302; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 303; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 304; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 305; parameters intentionally omitted
DELETE FROM phone_assets;

-- Statement 306; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 307; parameters intentionally omitted
DELETE FROM pool_emails;

-- Statement 308; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 309; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 310; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 311; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 312; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 313; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 314; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 315; parameters intentionally omitted
UPDATE card_assets SET is_active = 0 WHERE id <> ?;

-- Statement 316; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 317; parameters intentionally omitted
START TRANSACTION;

-- Statement 318; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 319; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 320; parameters intentionally omitted
COMMIT;

-- Statement 321; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 322; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 323; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 324; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 325; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 326; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 327; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 328; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 329; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 330; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 331; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 332; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 333; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 334; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 335; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 336; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 337; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 338; parameters intentionally omitted
UPDATE card_assets SET is_active = 0 WHERE id <> ?;

-- Statement 339; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 340; parameters intentionally omitted
START TRANSACTION;

-- Statement 341; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 342; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 343; parameters intentionally omitted
COMMIT;

-- Statement 344; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 345; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 346; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 347; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 348; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 349; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 350; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 351; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 352; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 353; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 354; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 355; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 356; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 357; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 358; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 359; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 360; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 361; parameters intentionally omitted
UPDATE card_assets SET is_active = 0 WHERE id <> ?;

-- Statement 362; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 363; parameters intentionally omitted
START TRANSACTION;

-- Statement 364; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 365; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 366; parameters intentionally omitted
COMMIT;

-- Statement 367; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 368; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 369; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 370; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 371; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 372; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 373; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 374; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 375; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 376; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 377; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 378; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 379; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 380; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 381; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 382; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 383; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 384; parameters intentionally omitted
UPDATE card_assets SET is_active = 0 WHERE id <> ?;

-- Statement 385; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 386; parameters intentionally omitted
START TRANSACTION;

-- Statement 387; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 388; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 389; parameters intentionally omitted
COMMIT;

-- Statement 390; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 391; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 392; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 393; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 394; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 395; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 396; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 397; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 398; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 399; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 400; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 401; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 402; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 403; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 404; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 405; parameters intentionally omitted
DELETE FROM phone_assets;

-- Statement 406; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 407; parameters intentionally omitted
DELETE FROM pool_emails;

-- Statement 408; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 409; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 410; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 411; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 412; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 413; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 414; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 415; parameters intentionally omitted
START TRANSACTION;

-- Statement 416; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 417; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 418; parameters intentionally omitted
COMMIT;

-- Statement 419; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 420; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 421; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 422; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 423; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 424; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 425; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 426; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 427; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 428; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 429; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 430; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 431; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 432; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 433; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 434; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 435; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 436; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 437; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 438; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 439; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 440; parameters intentionally omitted
START TRANSACTION;

-- Statement 441; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 442; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 443; parameters intentionally omitted
COMMIT;

-- Statement 444; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 445; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 446; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 447; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 448; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 449; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 450; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 451; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 452; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 453; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 454; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 455; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 456; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 457; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 458; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 459; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 460; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 461; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 462; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 463; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 464; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 465; parameters intentionally omitted
START TRANSACTION;

-- Statement 466; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 467; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 468; parameters intentionally omitted
COMMIT;

-- Statement 469; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 470; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 471; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 472; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 473; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 474; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 475; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 476; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 477; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 478; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 479; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 480; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 481; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 482; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 483; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 484; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 485; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 486; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 487; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 488; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 489; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 490; parameters intentionally omitted
START TRANSACTION;

-- Statement 491; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 492; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 493; parameters intentionally omitted
COMMIT;

-- Statement 494; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 495; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 496; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 497; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 498; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 499; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 500; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 501; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 502; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 503; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 504; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 505; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 506; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 507; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 508; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 509; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 510; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 511; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 512; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 513; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 514; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 515; parameters intentionally omitted
START TRANSACTION;

-- Statement 516; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 517; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 518; parameters intentionally omitted
COMMIT;

-- Statement 519; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 520; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 521; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 522; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 523; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 524; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 525; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 526; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 527; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 528; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 529; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 530; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 531; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 532; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 533; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 534; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 535; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 536; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 537; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 538; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 539; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 540; parameters intentionally omitted
START TRANSACTION;

-- Statement 541; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 542; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 543; parameters intentionally omitted
COMMIT;

-- Statement 544; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 545; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 546; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 547; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 548; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 549; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 550; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 551; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 552; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 553; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 554; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 555; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 556; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 557; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 558; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 559; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 560; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 561; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 562; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 563; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 564; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 565; parameters intentionally omitted
START TRANSACTION;

-- Statement 566; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 567; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 568; parameters intentionally omitted
COMMIT;

-- Statement 569; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 570; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 571; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 572; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 573; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 574; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 575; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 576; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 577; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 578; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 579; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 580; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 581; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 582; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 583; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 584; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 585; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 586; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 587; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 588; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 589; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 590; parameters intentionally omitted
START TRANSACTION;

-- Statement 591; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 592; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 593; parameters intentionally omitted
COMMIT;

-- Statement 594; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 595; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 596; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 597; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 598; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 599; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 600; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 601; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 602; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 603; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 604; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 605; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 606; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 607; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 608; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 609; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 610; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 611; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 612; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 613; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 614; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 615; parameters intentionally omitted
START TRANSACTION;

-- Statement 616; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 617; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 618; parameters intentionally omitted
COMMIT;

-- Statement 619; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 620; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 621; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 622; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 623; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 624; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 625; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 626; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 627; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 628; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 629; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 630; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 631; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 632; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 633; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 634; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 635; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 636; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 637; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 638; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 639; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 640; parameters intentionally omitted
START TRANSACTION;

-- Statement 641; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 642; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 643; parameters intentionally omitted
COMMIT;

-- Statement 644; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 645; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 646; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 647; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 648; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 649; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 650; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 651; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 652; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 653; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 654; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 655; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 656; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 657; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 658; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 659; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 660; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 661; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 662; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 663; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 664; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 665; parameters intentionally omitted
START TRANSACTION;

-- Statement 666; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 667; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 668; parameters intentionally omitted
COMMIT;

-- Statement 669; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 670; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 671; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 672; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 673; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 674; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 675; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 676; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 677; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 678; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 679; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 680; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 681; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 682; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 683; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 684; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 685; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 686; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 687; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 688; parameters intentionally omitted
INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB');

-- Statement 689; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 690; parameters intentionally omitted
START TRANSACTION;

-- Statement 691; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 692; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 693; parameters intentionally omitted
COMMIT;

-- Statement 694; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 695; parameters intentionally omitted
UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?;

-- Statement 696; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 697; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 698; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 699; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 700; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 701; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 702; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 703; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 704; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 705; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 706; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 707; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 708; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 709; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 710; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 711; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 712; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 713; parameters intentionally omitted
DELETE FROM phone_assets;

-- Statement 714; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 715; parameters intentionally omitted
DELETE FROM pool_emails;

-- Statement 716; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 717; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 718; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 719; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 720; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 721; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 722; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 723; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 724; parameters intentionally omitted
START TRANSACTION;

-- Statement 725; parameters intentionally omitted
START TRANSACTION;

-- Statement 726; parameters intentionally omitted
UPDATE card_assets SET usage_count = usage_count + 1 WHERE id = ?;

-- Statement 727; parameters intentionally omitted
UPDATE card_assets SET usage_count = usage_count + 1 WHERE id = ?;

-- Statement 728; parameters intentionally omitted
UPDATE card_assets SET usage_count = usage_count + 1 WHERE id = ?;

-- Statement 729; parameters intentionally omitted
UPDATE card_assets SET usage_count = usage_count + 1 WHERE id = ?;

-- Statement 730; parameters intentionally omitted
ROLLBACK;

-- Statement 731; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 732; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 733; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 734; parameters intentionally omitted
DELETE FROM phone_assets;

-- Statement 735; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 736; parameters intentionally omitted
DELETE FROM pool_emails;

-- Statement 737; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 738; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 739; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 740; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 741; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 742; parameters intentionally omitted
START TRANSACTION;

-- Statement 743; parameters intentionally omitted
UPDATE card_assets SET in_use = 1, locked_by = ? WHERE id = ?;

-- Statement 744; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 745; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 746; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 747; parameters intentionally omitted
START TRANSACTION;

-- Statement 748; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 749; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 750; parameters intentionally omitted
COMMIT;

-- Statement 751; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 752; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 753; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 754; parameters intentionally omitted
DELETE FROM phone_assets;

-- Statement 755; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 756; parameters intentionally omitted
DELETE FROM pool_emails;

-- Statement 757; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 758; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 759; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 760; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 761; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 762; parameters intentionally omitted
START TRANSACTION;

-- Statement 763; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 764; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 765; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 766; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 767; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 768; parameters intentionally omitted
START TRANSACTION;

-- Statement 769; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 770; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 771; parameters intentionally omitted
COMMIT;

-- Statement 772; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 773; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 774; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 775; parameters intentionally omitted
DELETE FROM phone_assets;

-- Statement 776; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 777; parameters intentionally omitted
DELETE FROM pool_emails;

-- Statement 778; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 779; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 780; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 781; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 782; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 783; parameters intentionally omitted
START TRANSACTION;

-- Statement 784; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 785; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 786; parameters intentionally omitted
COMMIT;

-- Statement 787; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 788; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 789; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 790; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 791; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 792; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 793; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 794; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 795; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 796; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 797; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 798; parameters intentionally omitted
UPDATE phone_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1;

-- Statement 799; parameters intentionally omitted
UPDATE card_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1 AND status = '正常' AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    )) AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 800; parameters intentionally omitted
UPDATE pool_emails SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE registered = 0 AND in_use = 1;

-- Statement 801; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 802; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE in_use = 1 AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY)
           AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ));

-- Statement 803; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 804; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 805; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 806; parameters intentionally omitted
START TRANSACTION;

-- Statement 807; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 808; parameters intentionally omitted
COMMIT;

-- Statement 809; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 810; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 811; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 812; parameters intentionally omitted
DELETE FROM phone_assets;

-- Statement 813; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 814; parameters intentionally omitted
DELETE FROM pool_emails;

-- Statement 815; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 816; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 817; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 818; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 819; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 820; parameters intentionally omitted
START TRANSACTION;

-- Statement 821; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 822; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 823; parameters intentionally omitted
COMMIT;

-- Statement 824; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 825; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 826; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 827; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 828; parameters intentionally omitted
UPDATE phone_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status NOT IN ('待人工复核', '支付结果未知') AND (locked_at IS NULL OR locked_at < ?);

-- Statement 829; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE in_use = 1 AND status = '正常' AND (locked_at IS NULL OR locked_at < ?)
               AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ))
               AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 830; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 831; parameters intentionally omitted
UPDATE pool_emails
             SET in_use = 0, locked_at = NULL, locked_by = NULL
             WHERE registered = 0
               AND in_use = 1
               AND (locked_at IS NULL OR locked_at < ?);

-- Statement 832; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 833; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 834; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 835; parameters intentionally omitted
UPDATE phone_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1;

-- Statement 836; parameters intentionally omitted
UPDATE card_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1 AND status = '正常' AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    )) AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 837; parameters intentionally omitted
UPDATE pool_emails SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE registered = 0 AND in_use = 1;

-- Statement 838; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 839; parameters intentionally omitted
UPDATE card_assets
         SET in_use = 0,
             locked_at = NULL,
             locked_by = NULL
         WHERE in_use = 1 AND status = '正常'
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY)
           AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    ));

-- Statement 840; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 841; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 842; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 843; parameters intentionally omitted
START TRANSACTION;

-- Statement 844; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 845; parameters intentionally omitted
COMMIT;

-- Statement 846; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 847; parameters intentionally omitted
DELETE FROM card_assets;

-- Statement 848; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 849; parameters intentionally omitted
DELETE FROM phone_assets;

-- Statement 850; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 851; parameters intentionally omitted
DELETE FROM pool_emails;

-- Statement 852; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 853; parameters intentionally omitted
DELETE FROM task_logs;

-- Statement 854; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 855; parameters intentionally omitted
INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB');

-- Statement 856; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 857; parameters intentionally omitted
START TRANSACTION;

-- Statement 858; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 859; parameters intentionally omitted
UPDATE card_assets
             SET in_use = 1,
                 locked_at = CURRENT_TIMESTAMP,
                 locked_by = ?
             WHERE id = ?;

-- Statement 860; parameters intentionally omitted
COMMIT;

-- Statement 861; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 862; parameters intentionally omitted
UPDATE card_assets SET status = '支付处理中'
         WHERE id = ? AND is_active = 1 AND status = '正常' AND in_use = 1
           AND CAST(locked_by AS BINARY) = CAST(? AS BINARY);

-- Statement 863; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 864; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 865; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 866; parameters intentionally omitted
UPDATE phone_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1;

-- Statement 867; parameters intentionally omitted
UPDATE card_assets SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE in_use = 1 AND status = '正常' AND (LEFT(LOWER(COALESCE(card_assets.locked_by, '')), 8) <> 'payment_'
    OR EXISTS (
        SELECT 1 FROM task_logs local_task
        WHERE CAST(card_assets.locked_by AS BINARY) = CAST(CONCAT('payment_', local_task.job_key) AS BINARY)
          AND local_task.execution_mode = 'local_card_pool'
          AND local_task.status IN ('failed', 'cancelled')
          AND local_task.payment_state IN ('not_started', 'declined')
          AND local_task.recovery_required = 0
    )) AND NOT EXISTS (
    SELECT 1 FROM task_logs provider_task
    WHERE card_assets.locked_by = CONCAT('gptapi_', provider_task.job_key)
      AND (provider_task.execution_mode = 'third_party_api' OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL)
      AND COALESCE(CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
        THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.settlement')) ELSE NULL END, '') NOT IN ('success', 'no_charge')
    AND (provider_task.status IN ('running', 'manual') OR provider_task.recovery_required = 1
        OR provider_task.payment_state IN ('started', 'unknown')
        OR provider_task.gpt_api_order_id IS NOT NULL OR provider_task.gpt_api_task_id IS NOT NULL
        OR CASE WHEN JSON_VALID(provider_task.gpt_api_raw)
            THEN JSON_UNQUOTE(JSON_EXTRACT(provider_task.gpt_api_raw, '$.attempt.dispatchStarted')) ELSE NULL END = 'true')
);

-- Statement 868; parameters intentionally omitted
UPDATE pool_emails SET in_use = 0, locked_at = NULL, locked_by = NULL WHERE registered = 0 AND in_use = 1;

-- Statement 869; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 870; parameters intentionally omitted
SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?;

-- Statement 871; parameters intentionally omitted
SET SESSION innodb_lock_wait_timeout = 2;

-- Statement 872; parameters intentionally omitted
START TRANSACTION;

-- Statement 873; parameters intentionally omitted
SELECT id, card_number, card_expiry, card_cvc, card_holder, usage_count
             FROM card_assets
             WHERE is_active = 1
               AND in_use = 0
               AND status = '正常'
               AND (cooldown_until IS NULL OR cooldown_until < NOW())
             ORDER BY usage_count ASC, COALESCE(last_used_at, '1970-01-01') ASC, id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED;

-- Statement 874; parameters intentionally omitted
COMMIT;

