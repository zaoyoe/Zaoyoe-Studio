-- Separate the upstream provider cost ratio from the customer-facing channel price.
-- Existing rows remain NULL (manual/legacy pricing) and keep their historical
-- behavior until an upstream pricing sync rewrites them with this metadata.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

ALTER TABLE channel_model_pricing
    ADD COLUMN IF NOT EXISTS upstream_cost_multiplier NUMERIC(20,10),
    ADD COLUMN IF NOT EXISTS upstream_pricing_group VARCHAR(120),
    ADD COLUMN IF NOT EXISTS upstream_pricing_version VARCHAR(120);

COMMENT ON COLUMN channel_model_pricing.upstream_cost_multiplier IS
    '上游成本倍率；不作用于用户价格，仅用于账号成本统计。NULL 表示手工或旧版定价。';
COMMENT ON COLUMN channel_model_pricing.upstream_pricing_group IS
    '写入该定价时选择的上游计费分组。';
COMMENT ON COLUMN channel_model_pricing.upstream_pricing_version IS
    '写入该定价时上游模型广场的价格版本。';
