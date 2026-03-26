# 第一阶段上线前最终核查清单

这份清单用于当前“支付安全 + 退款售后 + 站外告警 + 主动巡检 + 运维面板”第一阶段正式收官前的最终核查。

如果你正在执行一次完整上线，建议按下面顺序走：

1. 先核对代码与数据库
2. 再核对 Vercel / Railway 环境变量
3. 然后合并 `bot -> main`
4. 最后做线上验收与回滚准备

补充文档：

- [vercel-release-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/vercel-release-checklist.md)
- [payment-ops-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/payment-ops-checklist.md)
- [ops-alert-notification-matrix.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/ops-alert-notification-matrix.md)
- [admin-studio-safe-rebuild-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-safe-rebuild-plan.md)

## 1. 代码准备

1. 确认待发布范围：
   - `git log --oneline main..bot`
2. 至少运行：
   - `npm run test:security`
3. 如果本次改动触及支付、生产配置或环境变量，再运行：
   - `npm run check:prod-env -- --allow-non-production`
4. 确认 GitHub 上 `bot` 已包含本轮所有修复与面板收口改动。

## 2. 数据库核查

当前数据库不能依赖 `supabase_migrations.schema_migrations` 作为真相源，因此要用“对象存在性”核对 migration 是否落库。

### 必须确认的核心 migration

- [20260322_harden_payment_creation_entrypoints.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_harden_payment_creation_entrypoints.sql)
- [20260322_constrain_payment_sites.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_constrain_payment_sites.sql)
- [20260322_retire_legacy_redemption_overloads.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260322_retire_legacy_redemption_overloads.sql)
- [20260324_add_persistent_rate_limits.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260324_add_persistent_rate_limits.sql)
- [20260324_add_admin_refund_reclaim_rpc.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260324_add_admin_refund_reclaim_rpc.sql)
- [20260324_add_ops_alert_queue.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260324_add_ops_alert_queue.sql)

### 上线前最少 SQL 自检

```sql
select proname, oidvectortypes(proargtypes) as args
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'fn_create_payment_checkout_session',
    'fn_update_payment_checkout_session',
    'fn_create_pending_payment_order_for_checkout_session',
    'fn_deduct_points_admin_site_with_breakdown',
    'fn_redeem_code',
    'fn_get_user_balance',
    'take_rate_limit_token',
    'prune_rate_limit_buckets'
  )
order by proname, args;
```

```sql
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where connamespace = 'public'::regnamespace
  and conname in (
    'payment_checkout_sessions_site_check',
    'payment_orders_site_check'
  )
order by conname;
```

```sql
select to_regclass('public.rate_limit_buckets') as rate_limit_buckets,
       to_regclass('public.ops_alert_jobs') as ops_alert_jobs,
       to_regclass('public.ops_alert_job_attempts') as ops_alert_job_attempts;
```

通过标准：

- 支付创建 3 个 RPC 存在
- `fn_deduct_points_admin_site_with_breakdown` 存在
- `fn_get_user_balance` 保留 `uuid, character varying` 版本
- `payment_*_site_check` 两条约束存在并限制 `cn / intl`
- `rate_limit_buckets`
- `ops_alert_jobs`
- `ops_alert_job_attempts`
  三张关键对象都存在

## 3. 环境变量核查

### Vercel

至少确认这些变量存在且值正确：

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_CONFIG_ENCRYPTION_KEY`
- `PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET`
- `ADMIN_STUDIO_ACCESS_SECRET`

### Railway / verify server

至少确认这些变量存在且值正确：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_CONFIG_ENCRYPTION_KEY`
- `PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET`
- `ADMIN_STUDIO_ACCESS_SECRET`
- `APP_BASE_URL`
- `ALLOWED_ORIGINS`

### 关键规则

1. `Vercel` 和 `Railway` 的 `ADMIN_CONFIG_ENCRYPTION_KEY` 必须完全一致。
2. 所有密钥、URL、token 型变量都不要带引号。
3. `SUPABASE_SERVICE_ROLE_KEY` 必须是真正的 `sb_secret_...` 服务端密钥，不能是公钥。
4. 如果要启用站外告警，还要确认：
   - Telegram Bot Token 已配置
   - Telegram Chat ID 已填写
   - 或飞书 Webhook 已配置

## 4. 发布动作

1. 发起 `bot -> main` PR
2. 在 PR 描述里注明：
   - 已跑测试
   - 本次是否包含 SQL migration
   - 线上验收重点
3. 合并到 `main`
4. 等待 Vercel `Production Deployment` 完成
5. 如果 Railway 依赖本次代码或环境变量更新，同时重新部署 Railway

## 5. 线上验收

### 基础验收

1. 首页可打开
2. 管理后台可登录
3. 关键 API 不返回 `404 / 500`

### 支付与退款

1. `支付对账 -> 支付总览` 正常
2. `支付对账 -> 异常运维` 正常
3. `/api/payments/config` 正常返回
4. 退款异常专题、退款售后告警、站外告警队列正常显示

### 验证服务

1. `后台设置 -> 验证服务配置 -> 验证服务运维面板` 可打开
2. 当前额度、接口状态、队列状态、最近任务、最近失败正常显示

### 管理安全

1. `后台设置 -> 管理员访问 / Admin Audit Logs` 可打开
2. 最近后台访问、异常登录信号、支付配置审计正常显示

### 站外告警

至少点一遍这些示例按钮中的代表项：

- `发送测试站外告警`
- `发送退款详情示例消息`
- `发送支付通道异常示例消息`
- `发送验证额度告警示例消息`
- `发送工单超时示例消息`
- `发送库存预警示例消息`
- `发送履约失败示例消息`
- `发送支付配置异常升级示例消息`

通过标准：

- Telegram 能收到高危即时提醒
- 飞书能收到协作型提醒
- 恢复类消息默认只走飞书 + 站内通知

## 6. 运维面板收口验收

1. `集中告警处理面板` 可正常加载
2. `范围 / 级别 / 模块` 三组筛选可用
3. 快捷入口跳转正常
4. `复制当前筛选清单` 可用
5. `导出当前筛选 CSV` 可用

## 7. 回滚准备

上线前先确认：

1. 你知道当前线上 `Production` 对应的 commit
2. Vercel 可执行 `Instant Rollback`
3. 如果问题涉及数据库对象，不把“代码回滚”误当成“数据库回滚”

## 8. 收官标准

满足下面条件，就可以把第一阶段视为正式收官：

1. 核心 migration 已落库
2. `bot` 的本轮改动已合并并部署到 `main`
3. `npm run test:security` 全绿
4. 线上基础路径、支付路径、验证路径、后台路径都已验通
5. Telegram / 飞书 / 站内通知三层告警链路至少做过一次真实或示例验收
6. 集中告警处理面板与真实后台入口已经对齐
