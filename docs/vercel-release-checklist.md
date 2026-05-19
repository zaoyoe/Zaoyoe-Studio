# Vercel 发布清单（bot -> main）

这份清单用于当前仓库的标准发布流程，目标是同时控制两件事：

1. 减少 Vercel 免费额度被 `Preview` 自动部署吃满
2. 保证 `main` 上线前后的安全检查不会漏掉

如果这次是“第一阶段正式收官”发布，先配合看：

- [stage-one-launch-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/stage-one-launch-checklist.md)
- [admin-studio-safe-rebuild-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-safe-rebuild-plan.md)

如果你接下来要从稳定快照重新逐步引回后台能力，再配合看上面的 `Admin Studio` 重建顺序表。

## 2026-05-11 生产部署重触发

- 本次文档变更用于通过 PR 合并生成新的 `main` 提交，触发 Vercel Git 集成重新创建 `Production Deployment`。
- 合并后确认 Vercel `Production` 的 commit 已跟随最新 `main`。

## 2026-05-19 KVM4 动态 API 迁移记录

- `www.zaoyoe.com` 继续由 Vercel 承载静态页面和 CDN。
- 以下高并发 / 长耗时动态 API 已通过 `vercel.json` rewrite 转发到 KVM4 的 `https://verify-api.zaoyoe.com`：
  - `/api/admin/*`
  - `/api/payments/*`
  - `/api/shop/*`
  - `/api/wallet/*`
  - `/api/ops/*`
- KVM4 上的 `verify-server` 镜像必须包含这些目录：
  - `api/`
  - `server/`
  - `js/`
  - `scripts/`
  - `docs/`
  - `supabase/`
- `CRON_SECRET` 需要同时存在于 Vercel Production 环境和 KVM4 `/opt/zaoyoe-verify-server/.env`，否则 Vercel Cron 转到 KVM4 后会被 `/api/ops/*` 拒绝。
- 合并触发新 Production Deployment 后，至少复核：
  - [https://www.zaoyoe.com/api/payments/config?site=cn](https://www.zaoyoe.com/api/payments/config?site=cn)
  - [https://www.zaoyoe.com/api/shop/catalog?site=cn](https://www.zaoyoe.com/api/shop/catalog?site=cn)
  - [https://www.zaoyoe.com/api/wallet/overview?site=cn](https://www.zaoyoe.com/api/wallet/overview?site=cn) 未登录应返回 `401`
  - [https://www.zaoyoe.com/api/admin/network/request-context](https://www.zaoyoe.com/api/admin/network/request-context) 未登录应返回 `401`
  - 带 `Authorization: Bearer <CRON_SECRET>` 请求 `/api/ops/recovery-readiness-sweep` 应返回 `success: true`

## 1. 当前分支策略

- `main`
  - 正式发布分支
  - 合并到 `main` 后由 Vercel 自动创建 `Production Deployment`
- `bot`
  - 日常开发 / Codex 工作分支
  - 已在 [vercel.json](/Volumes/chao/AI/xianyu_profit_calculator/vercel.json) 关闭自动部署
- `codex/*`
  - 临时工作分支
  - 已在 [vercel.json](/Volumes/chao/AI/xianyu_profit_calculator/vercel.json) 关闭自动部署

这意味着：

- 继续往 `bot` 推代码不会默认触发一串 preview deployment
- 真正上线时，优先走 `merge -> main -> production`
- 不把 `Promote Preview to Production` 当成常规发布路径

## 2. 标准发布流程

### A. 开发阶段

1. 所有改动先进入 `bot`
2. 每次改动继续 `commit + push`
3. 在 `bot` 上把一批相关改动收齐后再准备上线，不要为每个小修补都单独发正式版

### B. 合并前检查

1. 先确认 `bot` 上待发布的提交范围：
   - `git log --oneline main..bot`
2. 至少执行：
   - `npm run test:security`
3. 如果改动触及支付 / 风控 / 生产配置，再额外执行：
   - `npm run check:prod-env -- --allow-non-production`
4. 如果改动包含新 SQL migration，必须先确认：
   - 需要执行哪些文件
   - 是否已在 Supabase 落库
   - 是否需要先落库再发版

建议重点关注这些目录：

- `api/_lib/payments/**`
- `api/payments/**`
- `server/api-handlers/admin/payments/**`
- `server/index.js`
- `supabase/migrations/**`
- `vercel.json`
- `admin-studio.html`
- `js/admin-payments.js`

### C. 需要预览时

默认不为 `bot` 自动生成 preview。

只有在下面这些情况，才值得手动触发 preview：

- 有明显 UI 变更，需要人工点验
- 有支付配置改动，需要确认前端返回面
- 有高风险流程改动，需要先看线上构建结果

注意：

- `Preview -> Promote to Production` 会再创建一次新的 production deployment
- 免费额度紧张时，优先选择“检查完成后直接 merge 到 `main`”

### D. 正式发布

1. 发起 `bot -> main` PR
2. 按 PR 清单补齐：
   - 已跑的测试
   - 是否有 SQL migration
   - 是否需要上线后补验证
3. 合并到 `main`
4. 等待 Vercel 的 `Production Deployment` 完成

## 3. 合并后检查

### A. 确认线上版本

在 Vercel 后台确认：

- `Production` 的 source 是 `main`
- 线上 deployment commit 与最新 `main` 一致

如果 `Preview` 和 `Production` commit 不一致，这是正常的；
只有 `Production` 对应的 commit 才代表 [https://www.zaoyoe.com](https://www.zaoyoe.com) 当前实际运行的版本。

### B. 常规回归

至少确认：

- 首页可打开
- 管理后台可登录
- 关键 API 没有 404 / 500

### C. 支付相关改动额外检查

如果本次发布触及支付链路，再补：

1. 管理后台 `支付对账` 可正常打开
2. [https://www.zaoyoe.com/api/payments/config](https://www.zaoyoe.com/api/payments/config) 返回正常
3. `auth-check` 接口在线
4. 需要时执行：
   - `npm run smoke:payment -- --env-file server/.env.production --config-only`
   - `npm run verify:payment-rollout -- --env-file server/.env.production --fail-on-finding`

更细的支付收尾步骤见：

- [payment-ops-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/payment-ops-checklist.md)
- [supabase-payment-hardening-rollout.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/supabase-payment-hardening-rollout.md)

## 4. SQL 变更处理规则

如果这次发布新增了 `supabase/migrations/*.sql`：

1. 先在 PR 描述里写清 migration 文件名
2. 明确这是：
   - 已执行
   - 待执行
   - 与本次上线无关
3. 如果应用代码依赖该 migration 才能完整工作，必须在发布前落库

当前支付链路里要特别记住的一项：

- [20260418_enable_decimal_refund_reclaim_rpc.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260418_enable_decimal_refund_reclaim_rpc.sql)
  - 未执行时，“已入账订单退款”会继续保持 fail-closed

## 5. 配额控制建议

为了尽量省 Vercel 免费额度，默认执行这些约束：

1. `bot` 上的小步提交允许继续 push，但不默认预览
2. 一批相关改动合并成一次正式发布
3. 不把每次 preview 都 promote 到 production
4. 正式发版以 `main` 自动部署为准
5. 遇到额度告急时，先暂停手动 preview，等一批改动收齐后再发

## 6. 回滚规则

如果 `main` 发布后发现问题：

1. 优先在 Vercel 使用 `Instant Rollback`
2. 同时在 GitHub 记录回滚对应的 commit
3. 如果问题涉及数据库 migration，不要直接假设应用回滚就能恢复数据库状态

数据库相关问题要单独处理，不要把“代码回滚”和“SQL 回滚”混成一步。
