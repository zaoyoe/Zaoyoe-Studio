SELECT @@server_uuid AS server_uuid, @@datadir AS datadir, DATABASE() AS db;
SELECT COUNT(*) AS total, COALESCE(SUM(status = '支付处理中' AND in_use = 1), 0) AS held, COALESCE(SUM(in_use = 0), 0) AS reusable FROM card_assets;
SELECT COUNT(*) AS count FROM task_logs;
SELECT COUNT(*) AS count FROM phone_assets;
SELECT COUNT(*) AS count FROM pool_emails;
