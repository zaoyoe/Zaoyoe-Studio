# ChatGPT 登录状态与用户错误提示修正

## 证据与原因

任务 `ysubqdxj` 在输出 Session 登录成功后，官方 Checkout 接口随即返回 HTTP 401、`token_expired`。录像及截图同时出现 `Your session has expired`。这是明确的凭证失效证据，不是信用卡拒付，也不能依据这次日志归因于代理连接失败。任务没有提交支付。

旧实现为页面注入本地 Session，并模拟 `/api/auth/session` 的响应；`New chat`、输入框等残留界面元素就足以被当作登录成功。真实 Cookie 预检、页面显示账号和官方接受 AccessToken 是不同证据。普通 API 失败回退还错误地包含鉴权失败，默认 auto 模式也没有完整执行停止回退的判断，导致继续等待定价弹窗约 60 秒。

## 修正

- 注入前检查 JWT 和原始 Session 的已知到期时间，不再为缺失到期时间虚构未来七天。未到期本身不证明凭证有效。
- 登录成功前，经同一浏览器请求真实、只读的 `/backend-api/me`，要求 HTTP 200 和账号 ID。账号邮箱不一致时停止；401 或明确的鉴权失效返回停止。网络错误、403 风控或无法识别的响应仅归为鉴权未确认，不冒称 Session 过期，也不报告登录成功。
- 检测可见的会话过期提示，优先于残留聊天界面，并在定价等待中持续检查。用户聊天消息中引用该提示不算失效弹窗。
- API、auto、hybrid 均遵守同一回退决定；HTTP 401 / `token_expired` 不回退定价、不进入填卡。普通可恢复的 API 错误仍允许既有定价流程。
- WebSocket 实时消息、历史任务恢复快照和前端使用同一个允许文案集合。内部浏览器、定位器、数据库及上游诊断保留后台，用户仅看到“充值失败，请联系客服处理”等明确文案。Session 失效提示重新获取 Session；保留原有拒卡文案。
- 支付已开始或结果未确认的任务优先提示人工核实，不声称卡密未使用或已回滚，也不因鉴权失败而自动重试。
- 账号信息预览接口仅做输入检查，明确 `verification: input_only`，不把解析邮箱当作官方在线鉴权。

## 验证

12 个测试文件、269 项检查全部通过，包含离线 Chromium 页面、模拟官方接口拒绝、Session 注入响应不能证明鉴权、过期弹窗、定价等待、API 回退、实时 WebSocket 与恢复快照、支付状态保护及现有信用卡付款方式回归。所有浏览器请求均由本地 fixtures 提供，任务状态由 mock store 提供；没有使用真实支付卡、发起真实支付或变更订阅。

验证命令：

```sh
node --env-file=.env ./node_modules/.bin/vitest --run \
  test/chatgpt-auth-state.test.js test/public-task-messages.test.js \
  test/chatgpt-billing.test.js test/checkout-diagnostics.test.js \
  test/task-safety.test.js test/session-security.test.js \
  test/pricing-flow.test.js test/pricing-checkout.test.js \
  test/task-diagnostics.test.js test/openai-payment-method.test.js \
  test/payment-retry-safety.test.js test/grok-auth.test.js
```

实际官方网页若改变账号接口结构，流程会停止并保留后台诊断，而不是继续假定登录成功。本次没有用真实账号进行端到端充值验证。
