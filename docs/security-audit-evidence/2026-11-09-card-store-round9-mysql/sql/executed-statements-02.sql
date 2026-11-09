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

