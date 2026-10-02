# 生产发布清单（PR → main → 三条生产链路）

所有发布都必须完成本清单的准备与核验步骤。涉及游客下单、支付、履约、worker 或后台游客订单的改动，另须遵守 **§1.1** 和 `AGENTS.md` Guest Shop Deployment Rules。

这份清单用于当前仓库的标准发布流程。发布对象是经过核验的完整 Git 提交；
所有生产链路必须跟随同一个最新 `main` SHA，避免遗漏本地成果、误用旧快照或只发布部分服务。
同时控制 Vercel Preview 的额度消耗，并保留可读回的发布前备份。

`AGENTS.md` 的 Release Integrity and Recovery Rules 是强制规则；下面的操作清单落实这些规则。
文件中的带日期迁移记录是历史证据，不替代现行生产核验。当前生产核验使用
`https://www.fatherkey.com`、`https://verify-api.fatherkey.com` 和 `https://new.fatherkey.com`。

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
- `recovery-readiness-sweep` 已从 Vercel Cron 迁到 KVM4 systemd timer：
  - timer: `zaoyoe-recovery-readiness-sweep.timer`
  - service: `zaoyoe-recovery-readiness-sweep.service`
  - schedule: daily around `00:08 UTC`
  - target: `http://127.0.0.1:3001/api/ops/recovery-readiness-sweep`
- `CRON_SECRET` 必须存在于 KVM4 `/opt/zaoyoe-verify-server/.env`。Vercel Production 中的同名变量可保留作回滚备用，但 Vercel 不再负责触发该 cron。
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

## 1.1 游客购买专用分支（强制，防止发错生产）

游客现金直付相关改动 **不得** 继续堆在 `bot`、已合并的布局/UI 分支、或其他功能分支上。

- 工作分支：`codex/guest-shop-cash-purchase`，或后续从已声明远端的最新 `main` 派生的专用 `codex/guest-shop-*` 分支
- 唯一合法发布路径：专用分支 → PR → 最新 `main` → Vercel Git 集成创建 Production
- **禁止**从 `codex/*`、`bot` 或其他功能分支执行 `npx vercel deploy --prod`
- **禁止**把 Preview、功能分支部署、或 “Promote Preview to Production” 当成游客购买的生产发布
- **发布不等于启用游客商品**。部署过程不得打开 `shop_products.allow_guest_purchase` / `shop_product_skus.allow_guest_purchase`，也不得执行 SQL
- 生产拓扑：Vercel 只托管前端；`/api/shop/:path*` 反代到 `https://verify-api.fatherkey.com/api/shop/:path*`。游客 API、webhook、worker 跑在 KVM4 Verify Server
- 游客购买相关发布必须同时验证四条链路：Vercel production、KVM4 Verify Server、KVM4 Sub2API、KVM4 guest-shop worker。worker 只能在 verify 的 `.current-release` 已经等于最新 `main` 之后安装或启动
- 改 KVM4 `/opt/zaoyoe-verify-server/.env` 的 `GUEST_SHOP_*` 后，必须 `docker compose up -d --no-deps --force-recreate --no-build verify-server` 重载 compose `env_file`。`docker restart` 不会重读 `.env`。禁止打印 secret，禁止复用 `CRON_SECRET`
- 回滚游客购买：关闭该商品/SKU 的游客开关。不是数据库 rollback，也不是 Vercel-only rollback
- 规范正文：`AGENTS.md`、`docs/kvm4-verify-server-deploy.md`、`docs/guest-shop-payment-fulfillment-runbook.md`、`docs/guest-purchase-task-2.0.md`（当前任务 2.1 内容版本）

## 1.2 发布准备与恢复备份（所有发布强制）

1. 声明唯一发布远端，核对 URL 并 fetch 该远端的 `main`。本地可以使用 `https-origin`
   或 `origin`，但必须记录选择，不能混用它们的旧引用。新 release 从该远端的最新 `main` 整理。
2. 盘点 staged、unstaged 和 untracked 文件，按用户批准的功能范围归入候选提交或单独保存。
   未跟踪的源码、测试、文档、迁移和资源不能被忽略，也不能为了清空工作区随意删除。
3. 任何可能丢失工作的 reset、rebase、branch switch、restore 或清理之前，先创建可恢复的
   backup commit / stash，记录完整 SHA，并验证关键文件能从备份读回。stash 必须覆盖未跟踪文件；
   干净工作区可以用备份分支固定当前 HEAD。需要保留的 ignored 文件另行保存，秘密不得写进 Git。
4. 比较最新 `main`、当前成果和待发布提交。特别检查未合并的 revert/rollback PR，以及会删除
   最新功能的提交。完整保留用户已批准的商城 UI、游客异常、订单详情、游客购物车批量结算等成果；
   更改已批准范围需用户确认，不能用旧快照覆盖当前版本来解决冲突或测试失败。
5. 创建或更新生产 PR 前，`git status --porcelain` 必须为空，HEAD 不能 detached。
   记录分支、远端 URL、BASE 和候选 HEAD 完整 SHA。备份保持独立，不用 `stash pop` 全量覆盖 release。
6. 核对候选提交的提交列表和文件清单。同一功能的前端、API、worker、测试、文档、迁移必须来自
   同一个候选提交；明确保留在备份中的非发布工作，并写明理由。
7. 将改动的 runtime 文件与 `.vercelignore`、Vercel 构建规则、KVM4 部署脚本的打包路径、
   Docker 构建输入逐项对照。允许各服务只打包其运行所需内容，但新增页面、API、依赖和资源必须
   进入对应生产产物。必要文件未被包含就停止发布，不靠单独上传本地文件补齐线上。

只读核对示例（先将 `RELEASE_REMOTE` 设为本次实际选定的远端）：

```bash
RELEASE_REMOTE=https-origin
git remote get-url "$RELEASE_REMOTE"
git fetch "$RELEASE_REMOTE" main
RELEASE_BASE="$(git rev-parse "$RELEASE_REMOTE/main")"
RELEASE_HEAD="$(git rev-parse HEAD)"
git branch --show-current
git status --porcelain=v1 --untracked-files=all
git log --oneline "$RELEASE_BASE..$RELEASE_HEAD"
git diff --name-status "$RELEASE_BASE...$RELEASE_HEAD"
```

以上用于核对信息，不会备份或清理工作文件。若 BASE 不是 HEAD 的祖先，需要先在备份保护下
整理与最新 `main` 的关系，重新固定 BASE、HEAD 和清单，不能直接按旧范围发布。

### PR 发布清单模板

创建 PR 后补上 PR 号；新增提交、重新整理分支或 `main` 前进后，更新清单并重跑受影响检查。
PR 中必须包含实际的 `BASE..HEAD` 提交列表和 changed-file manifest，不能仅写“更新商城”。

```text
PR: #<number>
Release branch: <branch>
Declared remote / URL: <remote> / <url>
BASE (latest remote main before review): <full SHA>
Candidate HEAD: <full SHA>
Recoverable backup: <ref/stash full SHA + verified readback files>
Approved release scope / intentionally excluded work: <features and reasons>
Commits BASE..HEAD: <actual git log output>
Changed files BASE...HEAD: <actual git diff --name-status output>
Runtime surfaces: <frontend / API / worker / admin / NewAPI>
Artifact coverage: <changed runtime files mapped to build/package inputs>
Tests: <exact commands; pass / fail / skipped counts; evidence location>
Migrations: <absolute file paths; user-applied / pending / unrelated; evidence>
Previews: <source SHA; clean candidate or explicitly local-only>
Merged main: <full SHA; fill after merge>
Production chains: <per-chain PASS / FAIL / PENDING / NOT RUN, SHA and evidence>
```

## 2. 标准发布流程

### A. 开发阶段

1. 普通改动进入 `bot` 或独立 `codex/*` 分支；游客购买改动进入 §1.1 的专用分支
2. 相关改动有序提交，准备发布时按 §1.2 固定完整候选提交
3. 一批相关改动收齐后再上线，不要为每个小修补都单独发正式版

### B. 合并前检查

1. 完成 §1.2，在干净候选提交上核对 `BASE..HEAD`、文件清单和用户批准范围。
2. 执行 `git diff --check` 和 `npm run test:security`，记录确切的通过、失败、跳过数量。
   游客购买改动还须覆盖完整 guest-shop、admin guest-order、readiness、功能相关 migration/verify
   契约。CI 检查必须对应清单中的候选 HEAD，不能用旧提交的成功结果。
3. 文档契约测试是阻塞项。缺失章节、归档标记、外部证据，或 `NOT RUN` / `PARTIAL` / `REVIEW`
   不能通过改成 `PASS`、删断言或只展示绿色子集来掩盖。历史记录只追加可追溯的更正。
   A5–G3 操作手册与两个 promo 文件中的 18 项历史归档契约分别记录，不能相互替代。
4. 如果改动触及支付 / 风控 / 生产配置，再执行
   `npm run check:prod-env -- --allow-non-production`，并记录结果。
5. 新 SQL migration 逐个列出文件路径、依赖关系和用户执行证据。需要先落库的代码在用户完成前
   暂停发布；默认关闭且不依赖该迁移的能力写明边界。Codex 不执行 SQL。
6. 合并前重新 fetch 已声明远端并检查 PR head。若 `main` 或候选 HEAD 改变，先重新整理、更新清单、
   重跑受影响检查，再合并。不能用未经核对的旧候选覆盖最新 `main`。

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

本地 preview 启动输出及非敏感诊断面必须显示 source commit SHA。报告为候选版本前，核对该 SHA
与候选 HEAD、被审查文件一致。存在未提交改动的 preview 只能作为本地调试证据；旧 preview
或工作区截图不能作为生产上线证据。

只有在下面这些情况，才值得手动触发 preview：

- 有明显 UI 变更，需要人工点验
- 有支付配置改动，需要确认前端返回面
- 有高风险流程改动，需要先看线上构建结果

注意：

- `Preview -> Promote to Production` 会再创建一次新的 production deployment
- 免费额度紧张时，优先选择“检查完成后直接 merge 到 `main`”

### D. 正式发布

1. 从当前已固定且干净的发布分支 push，创建或更新到 `main` 的 PR；游客购买必须走专用分支。
2. 补齐 §1.2 的发布清单，检查和范围审查通过后用 `gh pr merge` 合并。
3. 从已声明远端读取合并后的最新 `main` 完整 SHA，作为所有生产链路的目标；候选 SHA 与合并 SHA
   分别记录，不能假定二者相同。
4. 让 Vercel Git 集成和两条 KVM4 Actions 从 `main` 自动部署。不得从功能分支执行
   `npx vercel deploy --prod`，也不得手动挑选本地文件替换某个服务。
5. 按 §3 完成三链路核验；包含游客购买时额外核对 worker 和 readiness。
   发布成功不等于可以打开游客商品。

## 3. 合并后检查

### A. 确认线上版本

先重新 fetch 已声明远端，记录最新 `main` SHA，再逐条核对；不能仅看首页能打开或某个部署变绿。

| 链路 | 完成条件 | 必须保存的证据 |
| --- | --- | --- |
| Vercel production | `npx vercel inspect https://www.fatherkey.com` 显示 Production alias 为 Ready，source 为 main，实际部署 commit 等于目标 SHA | deployment ID / URL、source SHA、Ready 结果 |
| KVM4 Verify Server | `Deploy KVM4 Verify Server` 对应目标 SHA 的运行成功；SSH 核对 `/opt/zaoyoe-verify-server/.current-release` 等于该 SHA，容器 `/app/server/.release-commit` 一致，公开 `/healthz` 正常 | Actions run ID、两个 release marker、健康检查 |
| KVM4 Sub2API（NewAPI） | `Deploy KVM4 Sub2API` 对应目标 SHA 的运行成功；SSH 核对 `/opt/sub2api/.current-release` 一致，`https://new.fatherkey.com/health` 正常；NewAPI、PostgreSQL、Redis healthy，`sub2api-legacy` 未运行 | Actions run ID、release marker、health 与容器状态 |
| KVM4 guest-shop worker（游客发布额外项） | verify 已在该 SHA 后，核对宿主 worker 文件与该提交一致；按已批准的运行状态检查 timer/service 及近期 journal，运行适用的 readiness | 文件来源、timer/service 状态、脱敏 journal、readiness 结果 |

Ready 必须是生产 alias 当前指向的 deployment。Actions 成功必须对应目标 SHA；已有旧运行成功
不算本次证据。worker 不是独立发布来源，timer 显示 active 也不能证明文件已更新。

如果核验时 `main` 再次前进，先记录新旧 SHA 并核对新的提交范围，等待全部链路对齐新的最新
`main` 后再报告完成，不能拼接不同发布的绿色结果。

游客发布的 `--fail-on-invalid` 返回 0 只证明配置未发现无效项，不能写成启用验收 PASS。
`--fail-on-not-ready` 返回 3 是证据未齐时的预期关闭结果，按功能边界记录，不以 `|| true` 绕过。

### B. 常规回归

至少确认：

- 首页可打开
- 管理后台可登录
- 关键 API 没有 404 / 500

### C. 支付相关改动额外检查

如果本次发布触及支付链路，再补：

1. 管理后台 `支付对账` 可正常打开
2. `https://www.fatherkey.com/api/payments/config` 返回正常
3. `auth-check` 接口在线
4. 需要时执行：
   - `npm run smoke:payment -- --env-file server/.env.production --config-only`
   - `npm run verify:payment-rollout -- --env-file server/.env.production --fail-on-finding`

更细的支付收尾步骤见：

- [payment-ops-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/payment-ops-checklist.md)
- [supabase-payment-hardening-rollout.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/supabase-payment-hardening-rollout.md)

### D. 异常停止与最终报告

出现下列任一情况，停止推进并保留证据：备份无法读回、工作区不干净、候选范围不明确、
完整相关测试失败、缺少必需的用户 SQL 执行证据，或生产链路的 SHA 不一致。
合并前停止合并；合并后明确报告发布尚未完成。排查来源、构建、Actions 和运行时，不能用
reset、force-push、删除备份、切旧快照、打开游客开关或修改数据库来制造成功状态。

最终用中文逐条报告目标 `main` SHA、PR 号、Vercel、Verify、Sub2API 的状态和证据。
游客相关发布增加 worker；未完成项保留 FAIL / PENDING / NOT RUN 和原因，不能总括为“部署成功”。

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

游客购买后台写路径还要记住：

- [20260914_guest_shop_admin_ops.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_guest_shop_admin_ops.sql)
- [20260914_verify_guest_shop_admin_ops.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_verify_guest_shop_admin_ops.sql)
  - 未执行时，后台退款/补发/解锁必须 503 fail-closed，不得当成可运营
  - 部署过程不得代执行这两条 SQL，也不得重跑已通过的 20260913 迁移

## 5. 配额控制建议

为了尽量省 Vercel 免费额度，默认执行这些约束：

1. `bot` 上的小步提交允许继续 push，但不默认预览
2. 一批相关改动合并成一次正式发布
3. 不把每次 preview 都 promote 到 production
4. 正式发版以 `main` 自动部署为准
5. 遇到额度告急时，先暂停手动 preview，等一批改动收齐后再发

## 6. 回滚规则

如果 `main` 发布后发现问题：

1. 正常修复优先基于最新 `main` 做最小改动，经 PR、检查和三链路验证重新发布。
2. 紧急 Vercel `Instant Rollback` 仍可用，但必须明确记录原因、目标 deployment 和 commit；
   它只改变前端链路，不能当成整站已回滚或重新对齐。按 `AGENTS.md` 分别检查 KVM4 服务和兼容性。
3. 不得为了恢复单个功能而把整个仓库、工作区或整站发布切回旧快照。需要扩大已批准的回滚范围时
   先让用户确认；保留当前成果和备份，再制定具体恢复方案。
4. 如果问题涉及数据库 migration，不要直接假设应用回滚就能恢复数据库状态。

数据库相关问题要单独处理，不要把“代码回滚”和“SQL 回滚”混成一步。

游客购买的标准回滚是关闭商品/SKU 的 `allow_guest_purchase`。不要把 Vercel Instant Rollback 当成游客购买回滚；也不要在仍有游客订单时执行 20260913/20260914 rollback。
