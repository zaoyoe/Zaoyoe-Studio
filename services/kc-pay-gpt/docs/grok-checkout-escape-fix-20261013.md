# Grok 地址填写导致结账弹窗退出的修复（2026-10-13）

## 本次证据

任务 `9r92we32` 已正确选择俄勒冈地址，Plus 月付 USD 8 的官方购物车
也已通过核验。19:38:02 完成卡字段填写，19:38:32 返回未提交的表单失败。
本次 `PAYMENT_STATE:not_started`；日志确认银行卡释放、CDK 回滚。

失败截图显示 Grok 首页，结账弹窗已经消失。录像约第 9 秒仍能看到
Configure your plan 弹窗，第 10 秒弹窗消失，第 11 秒显示首页。
这与原账单逻辑在街道填写后执行 `street.press('Escape')` 的行为一致。
随后对已消失字段执行操作，等待 Playwright 默认 30 秒超时；付款驱动
又把没有业务错误码的异常替换为“新版官方表单未就绪”，隐藏了失败步骤。

只读核对缓存的官方组件：

- `/tmp/kc-grok-assets/27l-4x7xe0rsm.js` 的 BillingAddressFields 在街道
  onBlur 中提交当前输入，并对非空街道展开详细地址字段。
- `/tmp/kc-grok-assets/0jhkk-kcf2f6e.js` 的 AddressTypeahead 对弹出建议
  内部的焦点移动跳过提交，失焦到建议区域外才调用账单 onBlur。
- `/tmp/kc-grok-assets/282m3vs06_g1_.js` 的 DismissableLayer 捕获 Escape，
  事件未被阻止时调用 onDismiss。

新增离线场景模拟 Escape 关闭 Checkout 并回到首页。修复前运行两个
针对性用例，关闭行为复现通过，正常填写并付款的回归用例失败。
原有离线 Checkout fixture 没有模拟 Escape 关闭行为，因此此前遗漏。
录像本身没有键盘事件记录，定位依据是页面变化、代码和离线复现的结合。

## 修复

- 移除地址填写中的 Escape，使用输入框原生 blur 提交并展开手动地址。
  不依赖 Tab 的下一焦点，也不自动猜选地址建议。
- 填写和失焦后再次确认可信 `/plans` 页面与唯一可见 Checkout 弹窗；
  离开页面或弹窗消失时停止后续操作，不重开购物车或重复付款。
- 账单填写、失焦和读值使用明确的 3 秒操作超时，动态字段仍保留原有
  5 秒就绪等待。Stripe 卡字段的 Tab 操作也使用明确的 4 秒超时。
- 为账单异常标记 country、line1、city、zip、state 等具体阶段。
  未知 Playwright 异常转换为安全的业务错误，避免输出原始 call log。
- 新增 `[Grok/native]` 诊断，只记录固定步骤、错误码、原因分类、
  plans/home/other/closed 页面分类及 submitted 布尔值。
  不输出原始异常、URL 查询参数、卡值或会话标识。
- 付款前金额、周期、购物车归属、税费、账单读回与单次提交保护保留；
  提交活动开始后的未知结果继续转人工复核，不允许自动重试或释放资产。

## 验证

最终运行 7 个回归文件、299 项用例全部通过：

```sh
node --env-file=.env ./node_modules/.bin/vitest --run \
  test/grok-native-flow.test.js test/grok-commerce.test.js \
  test/payment-retry-safety.test.js test/task-safety.test.js \
  test/grok-flow.test.js test/claude-payment-flow.test.js \
  test/openai-payment-method.test.js
```

新增覆盖 Escape 关闭复现、正常手动地址输入、建议弹层内焦点、街道失焦时
弹窗退出、禁用字段的短超时、原始异常信息保护及提交活动后离开页面。
当前套餐成功场景都使用支持 Escape 退出的弹窗，避免回归到旧模拟盲区。
4 个修改的 JavaScript 文件通过语法及空白检查。

所有浏览器 fixtures 均拦截外网请求，卡片、账号、地址和 RPC 使用
合成数据；没有执行 SQL、真实填卡付款、订阅变更或生产部署。

## 本地服务生效

确认本项目是 3100 唯一监听服务、活动充值任务为 0、没有项目自动化
子进程后，旧服务通过 SIGTERM 正常退出，PID 49091 → 53272。
没有强制中断正在执行的订单。

重启后 `/`、`/admin`、`/api/public/runtime`、`/grok-plan-catalog.js`
均返回 200，活动任务为 0；独立日志权限为 0600。
实际充值仍需后续真实任务与官方订单结果确认。
