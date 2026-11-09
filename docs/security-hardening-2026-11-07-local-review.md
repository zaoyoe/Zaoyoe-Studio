# 2026-11-07 本地安全加固实施记录

状态：本地实施完成；安全专项检查通过；全量检查仍有失败；生产验证 NOT RUN。

本记录不是发布完成证明。用户明确要求允许前不得提交部署。本轮未执行 commit、push、PR、合并、部署、SQL、数据库迁移、真实订单、游客购买开关或维护定时器启用操作。

## 1. 基线、原有工作与恢复证据

- 仓库：`/Volumes/chao/AI/xianyu_profit_calculator`
- 分支：`main`
- HEAD 与本轮最后一次 fetch 后的 `origin/main`：`75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`
- `git rev-list --count HEAD..origin/main`：`0`。
- 唯一 remote：`origin`，地址为 `https://github.com/zaoyoe/Zaoyoe-Studio.git`。
- 开始时工作区已有 172 个修改或未跟踪文件。期间仍有其他 UI、供应商、销量等并行修改。本记录只列出安全修复涉及的文件，整个 `git diff` 不属于本轮成果。
- 原始工作区备份：`/Volumes/chao/AI/.security-backups/xianyu-20261107-194103`。包含 `working-files.tar.gz`、`staged.patch`、`unstaged.patch`、`index`、`status.txt` 和带 SHA256 的 `manifest.json`，前序已验证可读回；目录权限 0700、文件权限 0600。
- 安装器最终加固前副本另存于该备份的 `installer-before-final-hardening/`。
- 本轮测试日志与实施文件摘要归档于该备份的 `evidence-final/`，以 `evidence-sha256.json` 校验。文件摘要用于辨认本轮结束时的版本，不意味着整个并行工作区冻结，也不代替后续发布清单。

## 2. 购买身份确认与扣款边界

已落实：

- 大数量和可疑会话购买必须由服务端真实校验当前账号密码，客户端布尔值或 header 不能代替验密。门禁置于供应商与本地库存分流之前。
- 验密使用独立 publishable-key 客户端，无请求 Bearer、无持久会话/自动刷新，核对返回账号 ID，传递 CAPTCHA，限制密码长度并保留密码中的空格；临时会话只调用 local sign-out，不向客户端或日志返回凭据。
- 验密最多每 60 秒 5 次；要求持久化限流的路径在数据库不可用、返回畸形或缺配置时拒绝请求。批量限流返回畸形时仍走本地配额 fallback，不伪造持久化成功。
- 前端仅对服务端明确返回 `requiresConfirmation:true`、`purchaseNotStarted:true` 的指定 403 打开密码框；最多重试一次，保留幂等键，核对账号和站点。网络未知结果不自动再次购买。
- 财务 RPC 仅使用可信 admin 客户端。缺客户端、错误或畸形返回不降级为用户客户端，不以换客户端再次扣款处理未知结果；`success` 必须为 boolean。
- 明确启用的 IP 黑名单/CSRF 检查在检查失败时拒绝。
- 修正内存会话基线在容量满时过早逐出、TTL 边界和活动顺序处理。

仍需验证：

- 前端通过 VM/mock DOM 和契约测试，尚未真实浏览器验收。
- MFA、OAuth-only 账号、Supabase 单会话模式与临时密码登录之间的兼容性未在真实 Auth 项目验证。当前方案要求可用密码，不能把 OAuth-only 账号视为已完成购买验密。
- 会话位置/UA 基线仍为单实例启发式：首次请求建立基线，跨实例不共享，UA 可伪造；不能宣称消除了凭证盗用。

## 3. 公共工单授权与跨站边界

已落实：

- 匿名工单历史与回复改为依赖服务端签名的 HttpOnly Cookie；邮箱、订单号、工单 ID 不再单独充当读取/回复凭证。
- 使用独立 `SUPPORT_TICKET_ACCESS_SECRET`，至少 32 字节；HMAC-SHA256、用途前缀、恒时比较，拒绝篡改、重复 Cookie、超长和过期载荷。
- Cookie 为 `__Host-zaoyoe_support`，`Path=/; HttpOnly; Secure; SameSite=Strict`，最长 30 天；最多保存 12 条，每条独立过期，新工单不延长旧工单授权。
- 访客按 Cookie 内工单 ID、site 和 `user_id IS NULL` 限定；会员按 owner 与 site 限定。回复使用 ID/site/owner 和版本条件，正文限制 24000 字符。
- 会员 UUID 订单关联校验真实订单 owner/site；非 UUID 订单号仅保留为待核验文字。
- 删除缺失 site 列时回退到无 site 查询的路径；Auth 故障或坏 Bearer 不降级为游客，只有无 Authorization 且明确未登录时允许匿名。
- 拒绝外站 Origin 与 cross-site Fetch Metadata，响应设置 `private,no-store`，按 Cookie/Authorization 分离缓存；缺独立 secret 时在插入前返回 503。
- `.env.local.example` 仅增加空值说明，没有写入或生成生产 secret。

兼容限制：旧游客工单没有新 Cookie 凭证，不能继续凭邮箱读取历史。换浏览器、丢失 Cookie、过期、secret 轮换或超过 12 条上限时，需人工核验恢复。Cookie 不提供同浏览器中任意单条凭证的即时服务端撤销能力；线上 RLS 仍未验证。

`js/components/ChatWidget.js` 的同源请求携带 Cookie 逻辑已在原工作区中，本轮核对并测试，未将其计为新增改动。

## 4. 后台退款、补发与并发处理

已落实：

- 处理工单需 `tickets.manage`；退款/补发额外要求 `shop.manage`，财务操作仅使用可信 admin。
- 删除吞退款异常、只将订单标成 refunded 冒充退款、忽略 RPC error 和移除 site 限定的兼容回退。
- 游客按 GS 订单号和有效 site 查询真实订单；会员按 ID、user_id、site 校验。
- 游客退款 RPC 只接受正确订单的 `refund_status=pending`，不接受历史 failed；补发只接受正确订单的 `fulfillment_status=delivered`。空、多行、错订单、错状态及 RPC 错误不能推进工单成功。
- 退款请求成功仅表示排队，通知、审计和前端明确区分排队与到账；未知结果要求核验，不自动重试。
- 已处理工单不能因携带回复而重复退款/补发；显式纯回复允许。退款与补发互斥，补发渠道需互斥且必须为 RESOLVED。
- 会员库存自动补发原路径未实际补发却可能报告成功，现拒绝并引导订单管理。
- 工单写入核对原 status/updated_at/site 并要求恰一行返回；财务已成功而工单并发更新失败时返回 409，提示先核验，避免盲重试。
- 补发审计不记录卡密，保留旧 notes。
- 修复 verify-monitor-quota 的 catch 路径引用块内 `directState` 导致二次异常。
- 另核对批量工单：只执行普通状态/回复操作，显式 `doRefund:false`，无需财务客户端。

财务 RPC 与工单写入仍不是单一数据库事务。CAS 只保护工单并发，不提供跨 RPC 原子性；底层退款资格、锁、幂等和真实渠道到账均未在生产验证。文本中的订单号不是所有权凭证，管理员仍须核验申诉人资格。

## 5. 数据库迁移草稿：均未执行

| 文件 | 本地调整 | 生效条件与边界 |
| --- | --- | --- |
| `supabase/migrations/20261107114915_purchase_security_boundary.sql` | 所有 overload 的购买 RPC 撤销 PUBLIC/anon/authenticated 执行权，仅允许 service_role；增加 service-only 购买权限审计 RPC | 必须与可信服务端调用方配套发布；当前线上权限未改 |
| `supabase/migrations/20261107_core_security_hardening.sql` | 负余额先报错要求对账，之后加 CHECK；约束核验包含 conrelid；兑换限流异常/NULL 拒绝；保留账本 RETURNING 与 wallet lot 处理；有界 CDK 清理及 SKIP LOCKED | 先核验现有余额/约束/ledger/函数契约，禁止静默把负余额清零 |
| `supabase/migrations/20261107_security_rls_audit_and_hardening.sql` | RLS 审计函数仅 service_role 可调用 | 保留原五列接口；不代表全面验证视图、列权限及 policy 语义 |

仓库同时存在 8 位和 14 位迁移版本，本轮未读取线上迁移历史。应用前必须核对实际顺序、重名、已应用记录、现有函数定义和可恢复备份，不能按文件日期推断已经执行或可以安全直接执行。

密文覆写是当前数据库行的清理措施，不等于清理备份/WAL/历史副本，也不等于密码学销毁。数据保留期限和清理资格仍需单独确认。

## 6. 巡检、清理和维护安装器

- 数据库巡检区分 `PASS` / `FAIL` / `INCOMPLETE`，退出码为 0/1/2。敏感表、购买 RPC、匿名探测证据不足不能报告 PASS；发现明确暴露优先 FAIL；超时和错误不输出敏感内容。
- CDK 清理校验参数、计数和批次上限；满批到上限为 INCOMPLETE，短批后再只读计数，避免锁跳过导致假 PASS，剩余计数为 0 才 PASS。
- 维护安装器 live 模式要求唯一 canonical origin、非 detached 的干净最新 main、本地 HEAD/origin/main/expected SHA 一致，再核对远端 `.current-release`。
- 上传字节由 `git show SHA:path` 提取，避免上传并行变化的工作区文件。
- 拒绝覆盖正在运行的维护 service/timer 或已启用 timer。安装器只落 wrapper/unit、chmod 和 daemon-reload，绝不 enable/start 定时器。
- dry-run 只验证六个文件存在及两个 wrapper 的 shell 语法，不联网，明确 release/systemd/database/timer readiness 为 NOT CHECKED。
- 测试仅通过临时目录和 mock git/SSH/SCP/systemctl 执行；没有真实远端安装、SSH、systemctl、清理操作。
- 安装器不是远端发布锁；实际安装时仍须防止并行发布，单独核验迁移、保留期限、执行身份和定时器启用资格。

## 7. 测试证据与真实失败

测试使用去密钥环境和 macOS sandbox，禁止外网，只允许 localhost，并禁止读取根目录/server 内五个真实 env 文件。没有连接生产数据库。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 购买、限流、会话、维护安装器，7 文件 | 96 PASS / 0 FAIL / 0 skipped | `security-purchase-maintenance-final-20261107.tap` |
| 公共工单，3 文件 | 34 PASS / 0 FAIL / 0 skipped | `security-support-cookie-contract.tap` |
| 后台工单、订单、quota，5 文件 | 48 PASS / 0 FAIL / 0 skipped | `security-admin-focused-20261107.tap` |
| 全量，587 文件、5898 项，早于最终安装器改动 | 5881 PASS / 17 FAIL / 0 skipped，退出 1 | `security-full-final-20261107.tap` |
| 商品销量契约单独复跑，11 项 | 11 PASS / 0 FAIL | `security-catalog-recheck-20261107.tap` |
| 原工作区失败文件复核，235 项 | 217 PASS / 18 FAIL | `security-baseline-failures.tap` |
| 静态输出过滤/字节核验 | PASS，581 文件 | `security-static-output-evidence-20261107.json` |

前三组互不重复，共 178 PASS。它们不能替代全量结果。重点购买测试存在 mock 中奖励/后续查询告警，未报告为无告警。

全量 17 项失败：

- `tests/frontend-supabase-runtime-config.test.js`：14 项，测试起始行为 2199、2206、2213、3033、3051、3575、3589、3737、10133、10182、10284、10352、10430、12438。
- `tests/prompts-media-tabs.test.js:56`：1 项。
- `tests/wallet-order-detail-performance-contract.test.js:93`：1 项。
- `tests/shop-public-catalog-hot-cache.test.js:1044`：1 项。

前 16 项在原工作区备份还原后的失败复核中也存在。本轮修复了另外两个原失败：后台重复处理保护、quota 异常作用域。商品销量失败在并行工作区的全量运行中出现，单跑通过，原因未归属；不能以单跑通过覆盖全量 FAIL，也没有修改无关销量逻辑或删除断言。

原全量记录另为 585 文件、5857 项：5836 PASS / 21 FAIL，保留在 `security-full-offline.tap`；不得与之后不同工作区状态的全量结果混为同一次运行。

stage-5 人工验收与历史 promo archive 合约为不同证据集，本轮结果不替代任一人工验收。NOT RUN / PARTIAL / REVIEW 不改写为 PASS。

## 8. 产物路径核对与未完成的外部验证

静态输出仅调用 buildStaticOutput 到临时目录，未运行会修改资源版本的完整 Vercel build。确认购买 JS/CSS、后台工单 JS 和现有 ChatWidget/Turnstile 文件复制后字节相同；服务端 helper、api/server/scripts、SQL 和 env 未进入静态目录。

配置路径核对显示 Vercel admin/public includeFiles 包含 `api/_lib/*.js` 和 server handlers，独立 support 入口静态引用新 helper；KVM 包及 Docker COPY 包含对应 api/server/js/scripts/supabase 路径。维护 units 通过主机安装器落地。

这些是路径/静态证据，不是真实 Vercel Function bundle、Docker 镜像构建或生产运行证据。以下全部 NOT RUN：

- 三条生产链路的 SHA/Ready/health、KVM4 主机防火墙/SSH/容器/systemd 状态。
- Supabase 线上 RLS、RPC 实际授权、现有迁移版本与 Auth 控制台策略。
- 新 secret 在目标环境的配置及轮换。
- MFA/OAuth/单会话模式与真实浏览器验密、跨域 Cookie 体验。
- 实际退款到账、补发、真实并发订单和生产数据库清理。

## 9. 本轮触及文件清单

下列文件含原工作区内容，本轮只负责安全相关差异。完整文件摘要见 `evidence-final/implementation-files.json`。

运行代码与样式：

- `.env.local.example`
- `api/_lib/admin.js`
- `api/_lib/purchase-step-up.js`
- `api/_lib/request-security.js`
- `api/_lib/session-security.js`
- `api/_lib/support-ticket-access.js`
- `api/support.js`
- `server/api-handlers/public/shop.js`
- `server/api-handlers/admin/tickets/process.js`
- `server/api-handlers/admin/settings/verify-monitor-quota.js`
- `js/shop-client.js`
- `css/shop-page.css`
- `js/admin-tickets.js`
- `scripts/audit-db-security.js`
- `scripts/shred-expired-cdks.js`
- `scripts/install-kvm4-security-maintenance.sh`

迁移草稿：第 5 节三个 SQL 文件，全部未执行。

测试：

- `tests/core-security-hardening.test.js`
- `tests/shop-purchase-endpoint.test.js`
- `tests/security-boundary-regressions.test.js`
- `tests/shop-step-up-client.test.js`
- `tests/request-security.test.js`
- `tests/session-security-boundaries.test.js`
- `tests/security-maintenance-installer.test.js`
- `tests/support-ticket-access.test.js`
- `tests/support-endpoint.test.js`
- `tests/shop-security-hardening.test.js`
- `tests/admin-tickets-process.test.js`

`tests/admin-tickets-guest-order-workflow.test.js`、ChatWidget 与六个既有维护 wrapper/unit 相对原工作区备份没有变化，仅作为依赖与验证范围，不计为本轮新增成果。

本记录为本地实施交付。待用户另行授权后的发布必须重新建立干净候选提交、核对完整并行功能范围、测试与迁移证据，并遵守 AGENTS.md；当前不能宣称生产已生效或具备发布通过状态。
