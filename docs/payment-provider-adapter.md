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
- `mock` 会直接走共享完成逻辑
- `afdian` / `hupijiao` 返回统一的 checkout context，由前端拉起支付页

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

### hupijiao

当前状态：
- 已能通过 `/api/payments/create` 走统一入口并返回 checkout context 骨架
- 尚未实现真实下单、验签、回调、自动入账

## 后续接虎皮椒时要补的点

1. 在 `provider-adapters.js` 里补 `hupijiao.createCheckoutContext`
2. 补 `hupijiao.verifyWebhook`
3. 补 `hupijiao.queryOrder`
4. 补 webhook 落 `payment_events`
5. 补成功订单写入 / 更新 `payment_orders`
6. 补自动积分入账

## 约束

后续新通道都尽量复用已有底座：
- `payment_orders`
- `payment_events`
- 后台 `payment_channels`
- 后台 `支付对账`

不要再为单一通道新建一套独立的订单表和对账逻辑。
