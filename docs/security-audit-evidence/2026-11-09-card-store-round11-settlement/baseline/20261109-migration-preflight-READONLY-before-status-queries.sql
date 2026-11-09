-- READ ONLY / REVIEW ONLY / NOT EXECUTED.
-- MYSQL 8.0/8.4 ONLY. Do not run in Supabase/PostgreSQL SQL Editor.
-- KC uses the separate MySQL service, not the site's Supabase project.
-- Run only after selecting the intended KC database. This script must not be
-- combined with either DRAFT migration and must not be used as a deployment.
-- It returns metadata and aggregate counts only; it never selects PAN/CVC,
-- tokens, session payloads, emails, keys or other credential values.

SELECT DATABASE() AS selected_database;

SELECT table_name, engine, table_collation, table_rows
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('card_assets', 'billing_records', 'task_logs', 'cdk_codes', 'kc_local_payment_attempts')
ORDER BY table_name;

SELECT table_name, column_name, column_type, is_nullable, column_default, extra
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('card_assets', 'billing_records', 'task_logs', 'cdk_codes', 'kc_local_payment_attempts')
  AND (
      table_name <> 'card_assets'
      OR column_name IN ('id', 'is_active', 'status', 'in_use', 'locked_by', 'payment_attempt_id')
  )
  AND (
      table_name <> 'billing_records'
      OR column_name IN ('id', 'card_last4', 'amount', 'currency', 'plan_type', 'platform', 'status', 'local_payment_attempt_id')
  )
  AND (
      table_name <> 'kc_local_payment_attempts'
      OR column_name IN ('attempt_id', 'job_key', 'card_id', 'state', 'version', 'settlement_billing_id', 'settlement_daily_count', 'settlement_cooled_down', 'fulfillment_evidence_hash')
  )
ORDER BY table_name, ordinal_position;

SELECT table_name, index_name, non_unique, index_type, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS indexed_columns
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name IN ('card_assets', 'billing_records', 'kc_local_payment_attempts')
  AND index_name IN (
      'uq_card_payment_attempt',
      'uq_billing_local_payment_attempt',
      'uq_kc_attempt_settlement_bill'
  )
GROUP BY table_name, index_name, non_unique, index_type
ORDER BY table_name, index_name;

SELECT constraint_name, table_name, constraint_type
FROM information_schema.table_constraints
WHERE constraint_schema = DATABASE()
  AND table_name IN ('card_assets', 'billing_records', 'kc_local_payment_attempts')
  AND (
      constraint_name LIKE 'fk_%'
      OR constraint_name LIKE 'ck_%'
      OR constraint_name IN ('uq_card_payment_attempt', 'uq_billing_local_payment_attempt', 'uq_kc_attempt_settlement_bill')
  )
ORDER BY table_name, constraint_name;

-- Aggregate compatibility checks. No card number or billing identifier is returned.
SELECT COUNT(*) AS card_total,
       SUM(in_use = 1) AS card_in_use,
       SUM(status = '支付处理中') AS card_payment_pending,
       SUM(is_active = 1 AND in_use = 0 AND status = '正常') AS card_idle_normal
FROM card_assets;

SELECT COUNT(*) AS billing_total,
       SUM(status = 'success') AS billing_success,
       SUM(status = 'failed') AS billing_failed,
       COUNT(DISTINCT currency) AS billing_currency_count
FROM billing_records;

SELECT COUNT(*) AS task_total,
       SUM(status IN ('running', 'manual')) AS task_open,
       SUM(payment_state IN ('started', 'unknown')) AS task_payment_uncertain
FROM task_logs;

SELECT COUNT(*) AS cdk_total,
       SUM(used_at IS NOT NULL) AS cdk_used
FROM cdk_codes;
