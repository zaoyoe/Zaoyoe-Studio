# 归档：2026-09 即时发货 / 智能轮询草稿（**禁止按此执行**）

Archived drafts: 2026-09 instant-fulfillment / smart-polling notes. **Do not follow
the commands in these files.**

这些文档是 2026-09-17 提交 `2a0ce1963`（"实现即时发货优化"）随代码一起进入 `main` 的
一次性草稿，保留在此仅供追溯设计思路。它们与仓库现行部署规则冲突，内容包括：

- `git push origin main`、从功能分支手动部署 —— 违反 `AGENTS.md`（必须 PR → `main` → 自动部署）；
- `pm2 restart all` / `pm2 logs` —— 生产 verify-server 是 Docker Compose 容器，**没有 PM2**；
- `tail -f /tmp/worker-kick.log` —— 该调试脚手架已从 `server/guest-shop-worker.js` 移除；
- `psql ... -c "SELECT ..."` 直连生产库 —— Codex 从不执行 SQL；
- `systemctl restart zaoyoe-verify-server` —— 不存在该 unit；密钥重载只能用
  `docker compose up -d --no-deps --force-recreate --no-build verify-server`；
- 用浏览器轮询响应体推算发货延迟 —— 公开快照不含 `paid_at` / `fulfilled_at`，结论无效。

同批被删除的 `deploy.sh`（`git add -A && git commit && git push origin <当前分支>` +
`pm2 restart all`）已从仓库移除；如需查阅历史版本：`git show 2a0ce1963:deploy.sh`。

## 现行权威文档

- `AGENTS.md` → Guest Shop Deployment Rules（硬规则与禁令）
- `KVM4_DEPLOYMENT_SPEC.md` → 部署顺序、只读审计脚本、验收与回滚
- `docs/kvm4-verify-server-deploy.md` → Guest Shop Worker 安装 / 密钥重载 / 验证
- `docs/guest-shop-payment-fulfillment-runbook.md` → 发布≠启用、退款/补发/解锁
- `docs/guest-purchase-task-2.0.md` → 游客购买启用条件
- `docs/vercel-release-checklist.md` → 发布检查清单

冲突时一律以 `AGENTS.md` 和上述现行文档为准。
