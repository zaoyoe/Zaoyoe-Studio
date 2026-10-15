-- 升级 cdk_codes 表以支持为每个 CDK 独立绑定支付地区
-- 运行环境：MySQL 5.7+ / 8.0+
ALTER TABLE `cdk_codes`
    ADD COLUMN `payment_region` VARCHAR(16) NULL DEFAULT NULL COMMENT '绑定支付地区代码 PH/US/EG/CL' AFTER `plan_type`;
