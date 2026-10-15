-- KC-PAY-GPT 2026-10-15 多平台套餐（Grok 新版组合订阅 / Claude / ChatGPT）与外包代充渠道结构升级
-- 说明：服务启动时 mysql-store.js 的 ensureReady() / update-mysql-schema.js 会自动幂等执行等价检查；
-- 如需在线上 MySQL 手动预执行，可按需运行以下语句。

-- 1. 扩展 plan_type 长度至 VARCHAR(64)，以支持 grok_bundle_premium_monthly 等长套餐标识
ALTER TABLE `cdk_codes`
    MODIFY COLUMN `plan_type` VARCHAR(64) NOT NULL DEFAULT 'plus' COMMENT '套餐类型代码（支持 ChatGPT / Claude / Grok 套餐）';

ALTER TABLE `billing_records`
    MODIFY COLUMN `plan_type` VARCHAR(64) NOT NULL DEFAULT 'plus' COMMENT '套餐类型代码（支持 ChatGPT / Claude / Grok 套餐）';

ALTER TABLE `task_logs`
    MODIFY COLUMN `plan_type` VARCHAR(64) NOT NULL DEFAULT 'plus' COMMENT '套餐类型代码（支持 ChatGPT / Claude / Grok 套餐）';

-- 2. 如旧库尚未包含 platform / payment_region / 外包代充跟踪字段，可由应用启动自动补齐，或手动执行：
-- ALTER TABLE `cdk_codes` ADD COLUMN `platform` VARCHAR(32) NOT NULL DEFAULT 'chatgpt' COMMENT '所属平台 chatgpt/claude/grok' AFTER `plan_type`;
-- ALTER TABLE `cdk_codes` ADD COLUMN `payment_region` VARCHAR(16) NULL DEFAULT NULL COMMENT '绑定支付地区代码 PH/US/EG/CL' AFTER `platform`;
-- ALTER TABLE `billing_records` ADD COLUMN `platform` VARCHAR(32) NOT NULL DEFAULT 'chatgpt' COMMENT '所属平台 chatgpt/claude/grok' AFTER `plan_type`;
-- ALTER TABLE `task_logs` ADD COLUMN `platform` VARCHAR(32) NOT NULL DEFAULT 'chatgpt' AFTER `last_heartbeat_at`;
-- ALTER TABLE `task_logs` ADD COLUMN `gpt_api_topup_code` VARCHAR(255) NULL DEFAULT NULL AFTER `failure_screenshots`;
-- ALTER TABLE `task_logs` ADD COLUMN `gpt_api_order_id` VARCHAR(128) NULL DEFAULT NULL AFTER `gpt_api_topup_code`;
-- ALTER TABLE `task_logs` ADD COLUMN `gpt_api_task_id` VARCHAR(128) NULL DEFAULT NULL AFTER `gpt_api_order_id`;
-- ALTER TABLE `task_logs` ADD COLUMN `gpt_api_raw` MEDIUMTEXT NULL AFTER `gpt_api_task_id`;
