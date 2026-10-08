# KC 发布候选检查记录（2026-10-08）

## 范围

- 独立 KC-PAY-GPT 服务；不修改商城主站、Verify 或 NewAPI。
- 目标运行位置：KVM4 `/opt/kc-pay-gpt`。
- 本记录只描述发布候选，不代表已部署或已启用真实充值。

## 候选状态

- 分支：`codex/kc-local-card-pool-terminology`
- 基线提交：`fa29fd989a34d69e134ac89098a6e40ffe070523`
- 上游远程：KC-CatK/KC-PAY-GPT（第三方上游，不直接推送私有生产配置）
- 工作区在检查开始时为 dirty，包含既有 P0-P2 改动及本轮状态机修复；尚未提交。
- 当前未执行 destructive Git 操作。

## 变更清单

### 运行时

- `server.js`：实时支付状态落库、状态合并、自动续费异常人工复核、超时与敏感信息处理。
- `index.js`：任务级银行卡锁 owner key 和支付状态输出回调。
- `payment-retry.js`：支付状态分类、未知支付保护、卡池重试保护。
- `stripe-payment.js`：提交状态标识及支付结果处理。
- `subscription-check.js`：自动续费状态核验。
- `mysql-store.js`、`mysql-schema.sql`：任务支付/恢复/Session 安全字段。
- `session-security.js`、`task-safety.js`：Session 加密和安全状态规则。
- `docker-compose.yml`、`.env.example`：生产密钥与运行文件配置。
- `public/admin.html`、`chatgpt.js`：配套界面/流程调整。

### 测试与迁移

- `test/session-security.test.js`
- `test/task-safety.test.js`
- `mysql-update-p0-p2.sql`

## 已完成验证

- Node 语法检查：通过。
- `git diff --check`：通过。
- Vitest：3 个测试文件、16 个测试通过。
- `.env` 与本地备份权限已收紧为 `0600`。

## 尚未完成

- 尚未形成干净提交。
- 尚未完成完整集成测试/真实支付验收。
- 尚未在生产执行 SQL。
- 尚未修改 KVM4 Caddy 入口。
- 尚未重启或重建生产 KC。
- 尚未执行真实银行卡扣款。

## 生产保护

- 不提交 `.env`、Session、银行卡、管理员密码或生产 Caddy 敏感配置。
- 不删除 MySQL 数据目录。
- Caddy 只允许后续做最小入口变更：解除 redeem 的充值接口预览阻断，保留 adm 后台及管理敏感接口隔离。
