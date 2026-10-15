# ChatGPT 收银台 Card 付款方式修复

## 已确认的根因

任务 `20sbu4ex` 已完成登录、创建 Checkout、选择 Pro 的 More usage 档位并确认 USD 200。截图显示 `PayPal selected.`，Card 未选中。旧流程却在 OpenAI 原生收银台跳过付款方式选择，直接探测信用卡字段，两次分别等待约 45 秒后退出。

这次失败由付款方式选择缺失引起，现有证据不支持将其归为代理阻断 Stripe。此次没有提交付款。

## 修复行为

- 仅对 OpenAI 原生 Checkout 增加 Card 付款方式核验；支持可见的按钮、tab、radio 和 label，以及可信 Stripe iframe 中的选择器。
- 在首次填卡和换卡重试时，每次填卡尝试最多点击 Card 一次。已明确选择 Card 时保留现有表单；有多个 Card 入口或无法切换时安全停止。
- 方法切换、字段发现和填写共用原有总超时预算；切换确认最多等待 5 秒。每次轮询重新扫描，三个字段均可见且可用后才开始填写。
- 提交付款前再次核对付款方式以及卡号、有效期和 CVC 的实际值；页面重绘或切回 PayPal 时停止提交。
- 使用 `OPENAI_CARD_METHOD_*` 和 `OPENAI_CARD_FIELDS_CHANGED` 错误码，避免被通用的代理或拒卡规则误归类。未提交的故障释放卡片并保留失败审计记录，不冷却、不换卡、不创建待扣款记录；已提交但结果未知的付款继续保留资产供人工复核。

旧版仅有卡表单、没有付款方式控件的 Checkout 仍以完整且可用的卡字段作为兼容依据。无法确认的方法或字段不会通过删除安全检查来兜底。

## 验证

执行以下离线测试，8 个文件、159 项全部通过：

```sh
node ./node_modules/vitest/vitest.mjs run \
  test/openai-payment-method.test.js \
  test/card-field-discovery.test.js \
  test/claude-payment-flow.test.js \
  test/payment-retry-safety.test.js \
  test/task-safety.test.js \
  test/chatgpt-billing.test.js \
  test/grok-native-flow.test.js \
  test/grok-flow.test.js
```

浏览器用例通过路由拦截构造离线收银台，并禁止域名解析；使用测试卡和虚拟账单资料。覆盖 PayPal→Card、延迟字段、iframe、多入口、禁用入口、切换无效、首次／换卡单次提交、条款阶段切回 PayPal，以及提交前 CVC 被清空。

未发起真实付款；线上收银台的下一次真实任务仍需确认实际组件兼容性。
