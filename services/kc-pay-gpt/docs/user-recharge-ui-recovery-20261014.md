# 用户充值端交互恢复（2026-10-14）

用户端 `public/index.html` 被整体重写为约 56 KB 的简化版本；原有 CSS 中的动画规则仍在，但卡片 morph、Tab 过渡、完整验证码控制器和 WebSocket 事件分流均丢失或被空函数代替。

恢复基于 `/tmp/kc-captcha-followup-20261012/public/index.html` 的完整快照，并重放该次 Codex 会话从 10 月 12 日晚到 10 月 13 日晚对用户端的修改记录。新版 Grok 套餐目录、凭证解析、验证码翻译、换题加载态、无限换题、手机端滚动箭头、验证成功胶囊和用户错误文案过滤均保留。删除旧备份的模拟调试工具栏及其控制器，避免出现在实际用户页面。

## 本次修改

- `public/index.html`：恢复圆形验卡勾选、卡片高度过渡、Tab 切换、返回重置、背景视差、按钮进度及完成动画；恢复完整验证码事件分流、点选/提交/刷新/最小化/恢复/成功提示。
- `server.js`：仅恢复用户端需要的验证码状态队列、内部画面和操作接口、公开坐标回传及账号识别接口、WebSocket 验证码事件、用户任务消息过滤；快照携带付款状态与人工复核状态。
- `public/style.css`、`public/admin.html`、`public/admin-login.html`、`public/subscription.html` 均与恢复开始时 SHA-256 一致，控制台 UI 的新改动保留。

## 备份

恢复前的页面、控制台、样式和 server.js，以及恢复后的页面与 server.js 保存于：

`/Users/wangyongchao/.codex/backups/kc-user-ui-recovery-20261014-1545`

该目录也有修改重放记录及使用虚拟卡密、虚拟图片生成的浏览器截图。

## 验证

- `test/recharge-ui.test.js`：5 个真实 Chromium 的离线交互测试，所有 API、WebSocket 和外部内容均由测试替代，不提交真实充值。
- `test/recharge-captcha-bridge.test.js`：1 个验证码画面 → 点选 → 后台取操作 → 验证通过的接口集成测试。
- `test/captcha-interaction.test.js`：23 个检查全部通过。
- `test/public-task-messages.test.js` 的用户消息边界与 WebSocket 消息过滤、重连快照过滤共 23 个检查通过。
- 手机深浅色弹窗尺寸、滚动箭头、桌面页面截图已检查；JavaScript 解析和 diff 空白检查通过。
- 本地服务在无活跃任务时正常重启，当前 PID 80993。真实本地服务的验证码画面推送 → WebSocket 批量点选 → 后台取操作 → 通过状态回传检查成功，使用临时虚拟会话且已清理，没有创建充值任务。

## 同时发现的独立后端回滚

当前 `index.js` 缺少已有的 Claude/Grok 平台分支，也缺少 `shouldFallbackToPricingCheckout` 对认证失败的停止处理。完整 `test/public-task-messages.test.js` 剩余两个后端测试因此仍失败（付款状态分析、认证失败的回退策略），与本次页面恢复无关。本次没有修改充值 worker、真实账号、银行卡或数据库。不能将页面与验证码恢复理解为真实充值流程已完成验证；后端入口回滚需要另行恢复。

后续已恢复请求与 worker 平台入口，并修复这两个后端测试，见 [充值后端平台入口恢复](recharge-backend-route-recovery-20261014.md)。本地服务再次正常重启为 PID 90437；真实扣款验证仍未执行。
