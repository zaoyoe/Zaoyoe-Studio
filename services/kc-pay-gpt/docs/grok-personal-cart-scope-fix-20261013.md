# Grok 个人结账会话范围误判修复（2026-10-13）

## 本次失败

15:14 与 15:15 的两次 Plus 月付任务均已登录并选中套餐，随后只因
`cart.teamId` 非空触发 `GROK_MIGRATION_REQUIRED`。两次均未进入填卡、
税费计算或支付提交；日志没有网络故障证据。

原规则把购物车响应的 `teamId` 直接当作团队购买或迁移证据，范围过宽。
响应包含这个字段本身，不能证明正在购买团队订阅或变更已有订阅。

## 官方前端静态证据

只读分析缓存的官方前端资源 `/tmp/kc-grok-assets/10cb12a5u7l9x.js`：

- SHA256：`a7953bd1d72f0747723a54434b86540fdc8d1e2eecb0a2addc5296e08091d632`。
- 字符偏移 66291–69322 的 `ez()` 是普通 GetCart 响应映射器，保留购物车、
  金额、有效期、平台和扣款安排等字段，没有读取响应 `teamId`。
- 字符偏移 114030 附近，创建结账会话显式传入 `teamId:e.teamId`。
- 字符偏移 110558 附近，结账上下文的团队范围来自 `g.teamId`，
  而非购物车响应的 `teamId`。
- 字符偏移 90544 附近，`ea=h?f?.teamId:void 0`；其中 `h` 是
  `onWebviewSurface`，普通网页不会直接继承该会话团队字段。
- 字符偏移 123942 附近，`prepareChangeSkuCart` 使用单独的 crossgrade 请求，
  明确指定已有订阅。

这些证据支持区分“个人创建请求的范围”和“响应的归属元数据”。
没有证实本次真实响应 ID 等于某个个人 team/account ID，也不依赖这种映射。

## 修复规则

`grok-commerce.js` 只有在以下条件全部满足时才接受响应 `teamId`：

1. 当前页面观察到成功的官方 `CreateCheckoutSession` 请求和响应。
2. 创建请求没有指定团队，地区为 US，支持 Stripe。
3. 当前会话、购物车请求及原始创建响应的 token 完全一致。
4. 第一次收到的购物车 `teamId` 被绑定到该 token，后续响应保持一致。

单独的 Get/Adopt 不能建立个人创建来源；同 token 的读取或采用会保留已有来源。
重复或重叠创建返回已见 token 时，保留其首次来源与已绑定的归属，避免重置校验。
不同归属、来源缺失或团队范围变化返回 `GROK_CHECKOUT_SCOPE_UNCONFIRMED`，停止支付。

明确的团队创建请求、migratedFrom、crossgrade、planFamilyConflict、非默认
crossgradeFlavor 仍触发迁移保护。无法解释的 effectiveAt 仍独立停止支付。
SKU、单商品数量、周期、地区、USD 金额、首期优惠、续费金额、税费、DOM 汇总、
付款前再次核验、单次提交和未知支付结果保护均保留。

风险日志只输出允许的字段名称和已知枚举标签，不输出 token、账户/团队/
订阅 ID。来源不明的未提交错误不会被当作拒卡，不触发换卡或冷却；已发生提交
活动的未知结果仍保留资产供人工核对。

## 验证

离线运行以下 6 个文件，227 项测试全部通过：

```sh
node --env-file=.env ./node_modules/.bin/vitest --run \
  test/grok-commerce.test.js test/grok-native-flow.test.js \
  test/grok-auth.test.js test/grok-flow.test.js \
  test/payment-retry-safety.test.js test/task-safety.test.js
```

覆盖 JSON/protobuf 解码、Plus 月付 USD 8 带响应 teamId 的结账、全部当前套餐、
个人来源缺失、明确团队请求、Get/Adopt 关联、重复/重叠创建、归属变化、晚到响应、
提交前再次检查、迁移/冲突、金额/周期/数量错误、未知结果及日志脱敏。
浏览器测试拦截全部请求并禁用外网解析，卡片和 RPC 均为合成测试数据。
未执行真实付款、变更订阅或 SQL，也未部署生产环境。

## 本地服务生效

重启前确认 3100 的唯一监听进程属于本项目、没有运行中的充值任务，
也没有项目自动化子进程。通过 SIGTERM 正常停止旧服务，PID 3977 → 21780。
重启后 `/`、`/admin`、`/api/public/runtime`、`/grok-plan-catalog.js` 均返回 200，
运行中的充值任务为 0。启动日志权限为 0600。

离线验证通过不代表真实订单已完成；实际充值结果仍需由后续官方订单确认。
