# 统一支付 Provider Adapter 说明

## 目标

把不同支付通道的能力统一收口到共享目录，避免以后接新通道时继续散落到：

- `server/index.js`
- `api/payments/*`
- `api/admin/settings/*`
- 前端钱包逻辑

## 当前骨架

### 1. 通道配置 / 密钥 / 默认值

文件：
- `/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/payments/providers.js`

负责：
- 默认支付通道配置
- `payment_channels` / `recharge_options` 读取与规范化
- 各支付通道密钥读取
- 环境变量 fallback

### 2. Provider Adapter 注册表

文件：
- `/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/payments/provider-adapters.js`

当前 provider：
- `mock`
- `afdian`
- `hupijiao`

每个 provider 的目标接口：
- `resolveRuntimeContext`
- `buildEventKey`
- `verifyWebhook`
- `resolvePackage`
- `createCheckoutContext`
- `queryOrder`

## 当前已接入情况

### 统一创建入口

已新增：
- `/Volumes/chao/AI/xianyu_profit_calculator/api/payments/create.js`

作用：
- 钱包购买套餐与自定义充值统一从这里进入
- 后端统一判断当前生效通道
- 统一先创建 `payment_checkout_sessions`
- 对已接入真实通道预创建 `payment_orders` 作为最终落单占位
- `mock` 会直接走共享完成逻辑
- `afdian` 返回统一的 checkout context，由前端拉起支付页
- `hupijiao` 当前默认 fail-closed，不允许继续走半成品真实下单

### checkout session / 支付意图层

已新增：
- `payment_checkout_sessions`
- migration: `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260321_add_payment_checkout_sessions.sql`

作用：
- 记录支付前的创建意图
- 统一保存套餐、金额、积分、通道和跳转上下文
- 为未来虎皮椒等真实网关接入预留统一入口
- 避免只在支付成功后才第一次出现订单记录

### mock

已接入：
- `/api/payments/mock/complete`
- `/api/payments/create`

已统一到 adapter：
- 订单号生成
- 事件 key 生成
- provider metadata

已统一到共享 helper：
- 订单创建 / 更新
- 事件写入
- 模拟支付积分入账
- checkout session 创建 / 完成回填

### afdian

已接入：
- `/server/index.js` 的 `/api/afdian/webhook`
- `/api/payments/create`

已统一到 adapter：
- webhook event key
- 签名校验
- 套餐解析
- process error 推导
- 运行时 token 读取
- checkout context 生成

当前状态：
- 创建支付时会先写 `payment_checkout_sessions`
- 创建支付时会预创建一个 `pending` 的 `payment_orders` 占位，并绑定 `checkout_session_id`
- webhook / 查码阶段会优先复用这条占位订单，而不是再新建一条最终订单
- webhook 阶段会优先尝试把 `payment_checkout_sessions` 回填到最终 `payment_orders`
- 如果 webhook 阶段无法安全匹配，用户在钱包查码认领时会再做一次按账号的强关联兜底
- 金额异常 / 待审核现在统一走后台审核 RPC，不再直接散落改订单状态
- 查码失败会落 `payment_query_attempts`，并进入后台支付对账汇总 / 异常专题

### hupijiao

当前状态：
- 配置项和 secret 已接入统一 adapter
- `/api/payments/create` 已能通过官方 API 创建虎皮椒支付，并把真实 `trade_order_id` 写回 `payment_checkout_sessions` / 预创建的 `payment_orders`
- Railway 服务端已新增 `/api/payments/hupijiao/webhook`，会验签、记录 `payment_events`、更新 `payment_orders`、自动为已绑定账号入账，并回填 `payment_checkout_sessions.payment_order_id`
- `hupijiao.queryOrder` 已接入官方查询接口，后续只需要再暴露后台/补单入口即可
- 后台退款流已经接入支付异常页，但当前只允许退款“未入账订单”
- 已入账 / 已发点订单仍然 fail-closed，避免出现“网关已退款但站内积分未扣回”的资金漂移

上线前仍建议完成的收口：

1. 用真实商户号完成一次正式联调，确认 `notify_url` / `return_url` 域名配置无误
2. 决定是否启用 `HUPIJIAO_WEBHOOK_TRUSTED_PROXIES` / `HUPIJIAO_WEBHOOK_ALLOWED_IPS` 做来源链路收口
3. 把虎皮椒查单/补单能力接进后台支付对账页面，而不是只停留在 adapter 层
4. 如果要开放“已入账订单退款”，先补齐原子化扣回 / 售后审计闭环，再放开当前的 fail-closed 限制

## 约束

后续新通道都尽量复用已有底座：
- `payment_orders`
- `payment_events`
- 后台 `payment_channels`
- 后台 `支付对账`

不要再为单一通道新建一套独立的订单表和对账逻辑。
