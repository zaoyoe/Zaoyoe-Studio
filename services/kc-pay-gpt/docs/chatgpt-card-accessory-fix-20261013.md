# ChatGPT Card 入口漏扫修复（2026-10-13）

## 本次证据与上一版遗漏

任务 `tne3mfhy` 的两次尝试均成功登录、创建收银台、选择 Pro More usage，
并确认 USD 200。用户录像与失败截图仍显示 PayPal 被选中。日志没有
“正在单次选择 ChatGPT 的 Card 付款方式”，而是两次各等待卡字段约 45 秒。
均记录 `PAYMENT_STATE:not_started`，未提交付款。

上一版 Card 核验存在可复现的组件识别缺口：

- 付款方式扫描和卡字段扫描都排除全部 `elements-inner-accessory*` iframe。
  新版 Stripe Payment Element 可以使用 `accessory-target` 并明确标记
  `componentName=payment`；这种付款 iframe 也被错误排除。
- 只按完整 accessible name 匹配 Card，图标标题或描述增加名字时会漏掉控件。
- PayPal selected 文案要求整段完全匹配，与后续说明位于同一段时无法识别。
- 完全看不到付款方式和卡字段时，最终付款方式断言仍能通过，随后返回泛化
  的卡字段缺失错误。服务又因为截图文件名含 `card_fields_not_found`，
  把错误归为代理阻断并重建任务；这个归因没有网络证据。

本次实际页面没有保存 DOM/iframe 清单。只读打开该 Checkout 时页面加载失败，
因此没有核实真实 iframe 的具体 URL；上述结构缺口通过离线浏览器复现验证，
不能把模拟结果当作本次真实页面结构已被确认。

## 修改

`stripe-payment-frame.js` 统一识别可信 Stripe frame 和 Payment accessory：

- 必须是 HTTPS Stripe 域名，无凭据及非默认端口。
- accessory 必须来自 `js.stripe.com` 的 `/v3/elements-inner-accessory-target-*.html`，
  且 hash 中唯一的 componentName 为 payment、唯一 elementId 为 payment-*。
- 地址、钱包、CAPTCHA、无标记或冲突标记的 accessory 不进入付款方式或卡字段扫描。
- accessory 仅使用有语义的卡字段；无名旧版表单的按位置兼容仍排除 accessory。

`openai-payment-method.js` 允许从精确的 Card 可见文字定位最近的
button/label/tab/radio，支持带图标和较长 accessible name 的控制器。
不会使用宽泛祖先容器作为点击目标；多入口继续停止。
支持 aria-expanded 状态，以及与说明合并的其他付款方式选中文案。

每次填卡尝试最多原生点击 Card 一次，只有三项实际字段都可用且没有其他方式
被选中才填写。未识别到可用入口或卡表单时，返回明确的付款方式错误。
填写和提交前仍核验选择状态及字段实际值。

新增脱敏日志 `[Stripe/Card-method]`，只记录扫描上下文数量、payment accessory
数量、Card 入口数量及其他方式是否选中；点击和卡表单确认分别有日志。
不记录 URL、会话 token 或卡值。

OpenAI 卡字段未就绪和写入不完整使用独立 `OPENAI_CARD_FIELDS_*` 错误码，
服务与卡池将其归为未提交的人工处理问题，不因截图文件名切代理、换卡或冷却。
未提交卡片释放；已提交但结果未知的资金保护保持不变。
其他未分类表单失败仍可以安全重试，但文案不再擅自归因为代理网络阻断。

## 验证

运行 10 个关联文件、254 项用例：付款方式、字段发现、Claude 付款、
卡池资金保护、任务分类、ChatGPT 账单、Grok 原生付款、Grok 流程、代理预检、
Claude 导航。最后一次并行运行中，前 9 个相关文件的 218 项通过；
Claude 导航有一项既有的 HTTP200 日志时序断言未命中，单独复跑该文件
36 项全部通过。没有修改 Claude 导航逻辑或其断言。

```sh
node --env-file=.env ./node_modules/.bin/vitest --run \
  test/openai-payment-method.test.js test/card-field-discovery.test.js \
  test/claude-payment-flow.test.js test/payment-retry-safety.test.js \
  test/task-safety.test.js test/chatgpt-billing.test.js \
  test/grok-native-flow.test.js test/grok-flow.test.js \
  test/proxy-preflight.test.js test/claude-navigation.test.js

node --env-file=.env ./node_modules/.bin/vitest --run test/claude-navigation.test.js
```

新增覆盖 payment accessory 中 PayPal→Card、图标/说明改变名字、长选中文案、
延迟字段、地址/钱包/错误标记排除、伪造 host/端口、HTTP/凭据 URL 排除、
首次及换卡单次提交、付款前切回 PayPal、截图文件名与错误分类优先级。

浏览器 fixtures 拦截全部请求并禁止外网解析，卡与账单均为合成数据。
9 个修改的 JavaScript 文件通过语法检查，diff 与新增文件空白检查通过。
没有执行真实充值、填入真实银行卡、提交真实订单、SQL 或生产部署。

## 本地服务生效

重启前确认 3100 唯一监听进程属于本项目、活动充值任务为 0，且没有项目
自动化子进程。旧服务正常 SIGTERM 退出，PID 21780 → 43419。
重启后 `/`、`/admin`、`/api/public/runtime`、`/grok-plan-catalog.js` 均返回 200，
活动任务为 0。独立启动日志权限为 0600。

离线验证不代表真实充值成功，后续真实任务仍需以新增诊断及官方付款结果核对。
