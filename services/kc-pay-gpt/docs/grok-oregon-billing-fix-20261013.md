# Grok 账单地址策略一致性修复（2026-10-13）

## 失败原因

19:21 的任务 `ol0ut0w0` 已通过登录、Plus 月付与 USD 8 购物车核验，
随后通用美国地址池选中了 Delaware。Grok 新版原生账单只支持已核验的
US/Oregon 流程，因此填卡后触发 `GROK_BILLING_UNCONFIRMED`。

这是本地地址选取策略与账单模块支持范围不一致，日志没有网络故障证据。
本次 `PAYMENT_STATE:not_started`，尚未提交付款；日志确认卡片恢复可用、
CDK 回滚为未使用。

另外，俄勒冈地址池返回完整州名 `Oregon`，原生账单此前只接受 `OR`。
只更换选址函数仍会失败；税费请求关联也必须使用同一个规范化地址。

## 修改

- 当前目录中已登记的 8 个 Grok bundle 套餐在付款前明确使用俄勒冈策略。
  从现有 active、unbound 的 US/Oregon 地址中选取完整记录，保留不连续
  重复规则；池空时沿用现有俄勒冈生成器，不回退到其他州。
- 其他平台、历史 Grok 套餐和原有菲律宾地址策略继续使用默认地区逻辑。
  显式策略不接受未知策略或非 US 地区。
- 新增纯函数 `grok-billing-address.js`，检查 US/USD 支付配置、地址范围、
  必填字段和美国邮编格式。仅将等价的 `OR`/`Oregon` 规范化为 `OR`，
  不把其他州的街道、城市和邮编改写成俄勒冈地址。
- `payment-retry.js` 在预留任何银行卡前完成选址和预检。失败时记录
  `not_started` 并停止；不预留、冷却、换卡或创建待确认扣款记录。
- 原生付款驱动也在填写卡号前检查地址，保护直接调用。账单表单、
  官方税费 observer 和成功后的卡片账单资料使用相同规范化地址。
- 套餐、SKU、数量、周期、首期/续费金额、税费、个人结账归属、迁移、
  提交前再次核验、单次提交和未知付款结果的保护逻辑保留。

## 离线验证

地址池测试改为 mock store，配置读写也只发生在 mock 中。
浏览器 fixtures 拦截所有请求并禁用外网解析，使用合成卡片与账单，
没有进行真实付款或订阅变更。

首批 4 个文件、196 项用例全部通过：

```sh
node --env-file=.env ./node_modules/.bin/vitest --run \
  test/tax-free-oregon.test.js test/payment-retry-safety.test.js \
  test/grok-native-flow.test.js test/grok-commerce.test.js
```

覆盖混合州地址池、池空兜底、地址不重复、完整州名、税费请求关联、
Delaware/其他州/缺失地址在预留与填卡前拦截、全部当前套餐、默认地区
策略、成功后绑定同一地址，以及已有资金保护。

另运行 6 个共享流程回归文件，126 项用例全部通过；合计 10 个文件、
322 项测试通过：

```sh
node --env-file=.env ./node_modules/.bin/vitest --run \
  test/task-safety.test.js test/grok-flow.test.js \
  test/openai-payment-method.test.js test/card-field-discovery.test.js \
  test/claude-payment-flow.test.js test/chatgpt-billing.test.js
```

8 个本次修改的 JavaScript 文件通过语法与空白检查。

## 本地服务生效

重启前确认 3100 唯一监听进程属于本项目，活动充值任务为 0，
没有项目自动化子进程。旧服务通过 SIGTERM 正常退出，未强制终止，
PID 43419 → 49091。

重启后 `/`、`/admin`、`/api/public/runtime`、`/grok-plan-catalog.js`
均返回 200，活动任务为 0；独立启动日志权限为 0600。

本次没有执行 SQL、真实填卡付款、订阅变更或生产部署。
离线验证通过不代表真实充值已成功，实际结果仍以官方订单为准。
