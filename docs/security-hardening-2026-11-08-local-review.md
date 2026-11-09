# 2026-11-08 主站、KC、TG 本地安全加固记录

本轮完成本地代码、SQL 迁移文件及测试加固。所有变更仍在工作区，未经提交、推送、合并或部署；数据库迁移未执行，线上安全状态不能据此宣称已经改变。虎皮椒与爱发电按用户要求排除。

## 范围、基线与恢复证据

- 工作区：`/Volumes/chao/AI/xianyu_profit_calculator`。
- 分支：`main`；HEAD 与本轮最后一次 fetch 后的 origin/main 均为 `75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`；`git rev-list --count HEAD..origin/main` 为 0。
- 唯一 origin：`https://github.com/zaoyoe/Zaoyoe-Studio.git`。
- 原工作区存在其他任务的已跟踪和未跟踪改动。本轮保留原有工作，未 reset、restore、切换分支、rebase 或创建提交。
- 开始本轮前的可恢复备份：`/Users/wangyongchao/.codex/backups/security-20261108-091130`。归档 `worktree.tar.gz` 为 827,504,917 bytes；manifest 记录 5,137 个文件 SHA256，已在前序检查中核验。备份保留 staged/unstaged patch、状态及源文件，不包含 ignored 的真实 .env。
- 本轮最终证据目录：`/Users/wangyongchao/.codex/backups/security-20261108-091130/verification-20261108-local`，目录权限 0700，证据文件 0600。保留最初失败、最终通过的日志、本轮 23 个文件的源文件快照及 SHA256。`verification-manifest.json` 以备份 manifest 为基准区分本轮新增/修改，不把其他任务全部归为本轮修改。
- 原始备份为本轮开始前的工作区恢复证据；本轮最终快照独立保存，二者没有相互覆盖。快照是本地验证证据，尚不是可发布的干净候选提交。

## 修复内容与适用系统

| 系统/边界 | 本轮处理的缺口 | 本地实现结果 |
| --- | --- | --- |
| TG ZPay 购买 | 仅凭签名通知推进付款确认，订单、商户、通道、含手续费金额与真实交易号的绑定不足 | 验签后先读取保存订单并核对绑定，再用服务器端网关主动查单；通知与查询的关键字段完全一致、proof 为 authenticated_query 且 reconciliation readiness 通过后才调用确认 RPC。保留 checkout 临时交易别名到真实交易号的受控转换。 |
| TG 数据库确认函数 | 应用层收紧后，数据库确认函数仍需约束 ZPay proof，避免其他内部调用继续接受旧证明 | 新增迁移收紧 ZPay proof，同时保留 NOWPayments 独立路径、行锁、空值与别名保护、关闭订单/人工复核、幂等及现有 8 参数 service_role 权限。迁移状态：NOT APPLIED。 |
| 主站 NOWPayments | 仅凭回调推进 paid、无效通知占用合法幂等事件、错误 payment ID 触达订单，以及金额/大整数精度问题 | paid 前使用本地保存的 payment ID 主动查询并核对精确金额、币种、地址、memo、报价与实付。显式回调 ID 与本地 ID 不符返回 409。无效签名使用独立 invalid 事件键，事件所有权检查避免错误处理改写其他请求的事件。保留现有原生 USDT/市场报价、TON atomic 校验。 |
| 游客单单与批量购买 | 支付通知与查单、本地保存交易身份或完整金额未形成闭合校验；查询失败可能提前占正常事件 | 正常事件插入前主动查单。ZPay 校验商户、订单、通道、真实交易号、回调交易号及完整金额；NOWPayments 校验保存 ID、回调 ID、原始查询 ID/order/finished、精确 requested/实际付款、币种、网络、报价、地址与 memo。查询缺 ID 不回填；原始 JSON 中大整数 ID 保真。失败返回 503、不创建正常事件，修复查询结果后同一通知可重试。 |
| KC 自动充值任务查询/控制 | 仅知道任务 ID 就能查询、订阅或干预任务；响应暴露敏感字段；异步订阅可能复活过期权限 | 新增按任务绑定、用途隔离 HMAC、24 小时有效期的访问 capability；24 随机字节生成 job key；验证 CDK 后签发。HTTP 与 WS 的任务/验证码操作验证凭证，并在异步等待前后与推送时持续复验。subscribe/close 撤销旧授权，subscriptionVersion 阻止异步旧结果恢复权限；WS maxPayload 为 64KB。 |
| KC 凭证与数据泄露面 | GET 查询把 CDK 带入 URL；任务快照和广播可泄露 CDK、卡密、电话、上游原文等 | CDK query 改 POST JSON，GET 返回 405；相关接口 no-store；快照与推送使用字段白名单，前端同步适配。保留 CDK 原子消费，移除重复且缺授权的 click 路由。下载端点当前固定返回 410。 |
| 主站共享请求来源判断 | 信任任意转发链或伪造 Vercel 头会影响限速、会话风控与来源判断 | 使用 node:net.isIP 验证 IP literal；XFF 任一项无效即拒绝整链，最多 64 hop；从右向左跳过可信代理，在最近不可信节点停止。仅服务端确认 Vercel production/preview runtime 才信任平台专用 IP 头；伪造 x-vercel-id 不能建立信任。 |

这轮没有把虎皮椒、爱发电纳入支付接通范围，也没有启用游客商品或修改支付开关。

## 核验结果与历史记录

| 核验项 | 范围 | 结果 |
| --- | --- | --- |
| 扩展回归 | 104 个测试文件：TG、guest-shop、admin guest、NOWPayments、payment security、request/session/core security、Vercel build output 等相关测试 | **1954 PASS / 0 FAIL / 0 SKIP** |
| KC 集中回归 | task-access-security、public-task-messages、admin-auth-security 共 3 个 Vitest 文件 | **132 PASS / 0 FAIL / 0 SKIP** |
| 本轮不重叠计数 | 上面两组相加 | **2086 PASS** |
| 支付专项 | 7 文件、192 项 | 192 PASS；已包含在扩展回归中，不重复相加 |
| 代理/会话专项 | 41 项 | 41 PASS；已包含在扩展回归中，不重复相加 |
| JS 语法 | 11 个运行时 JS 文件 node --check；KC index.html 的 2 段内联脚本静态解析 | PASS |
| 本轮空白检查 | 本轮 18 个已跟踪文件差异及 5 个未跟踪文件检查 | PASS；清理 core-security 测试文件末尾多余空行，没有改变断言或运行逻辑 |
| 打包输入静态核对 | Vercel ignore/includeFiles、Verify 包路径与 Docker COPY、KC Dockerfile/dockerignore | PASS；仅证明源码输入包含关系，未构建或验证生产产物 |
| 新增 SQL 迁移实际执行 | 数据库目标、权限、事务、数据状态 | **NOT APPLIED / NOT RUN** |
| 真实供应商查询和回调联调 | ZPay、NOWPayments、KC 实际任务 | **NOT RUN** |
| 生产各系统、主机与 worker | Vercel、KVM4 Verify、NewAPI、KC、TG/guest workers、数据库和网络入口 | **NOT RUN** |

扩展回归首次结果为 1953 PASS / 1 FAIL，原始日志保存在 broader-initial-failure.tap。失败项为 core-security-hardening 中 concurrent_ip_mismatch 断言：旧测试只提供 XFF、没有 socket peer，却要求信任转发来源。新规则拒绝未知来源符合预期。测试现补充 loopback socket peer 与显式 TRUSTED_PROXY_IPS，保留不可能旅行、机器人切换、并发 IP 与风险分数原断言；完整重跑后 1954 项全部通过。测试后仅去除了该文件末尾一个多余空行。

历史 promo archive 的两个测试文件共 18 项已包含在这次扩展回归并通过；这只是当前本地文档契约结果，不能替代 stage-5 A5–G3 的生产操作验收，二者仍分别记录。

旧文件 docs/security-hardening-2026-11-07-kc-tg-local-review.md 保留原样。其中 KC 历史全量 1542 PASS / 4 FAIL / 1 SKIP 属于此前结果，不是本轮 KC 集中测试的结论，不能宣称本轮执行或通过了 KC 全量测试。此次未运行会加载真实 .env 的 KC npm test。

日志中的 TAP 顶层计划是 1..1935；由于嵌套子测试，总数以末尾 # tests 1954 为准。

归档文件：

- broader-verified.tap：扩展回归最终结果。
- broader-initial-failure.tap：首次 1 项失败原始结果，未改写。
- broader-files.json：104 文件完整清单。
- kc-focused-verified.log：KC 3 文件、132 项结果。
- payment-focused.tap、ingress-focused.tap：已包含的专项证据。
- static-checks-initial.json：语法检查结果及初次空白检查原始输出。git diff --no-index --check 返回 1 且没有诊断表示文件有差异；该原始记录还保留了随后清理的 EOF 空行提示。
- whitespace-verified.json：后续空白检查全通过记录。
- core-security-before-fixture.js：fixture 修复前文件。
- verification-manifest.json、source-snapshot/：本轮路径、备份对比、最终 SHA256 与受限访问源码快照。

KC 集中测试命令（在 services/kc-pay-gpt 中）：

`./node_modules/.bin/vitest run test/task-access-security.test.js test/public-task-messages.test.js test/admin-auth-security.test.js`

扩展回归可用 Node 测试运行器和归档 broader-files.json 的文件列表复现；该列表是本轮测试范围的依据。本记录没有把源码正则/契约检查等同于真实数据库事务或供应商联调。

## 尚未覆盖的运行与发布边界

1. 新增迁移 supabase/migrations/20261108013826_tg_authenticated_payment_query.sql 尚未应用。TG 数据库 proof 门禁需另行审核并获授权执行 SQL，不能把本地文件存在视作数据库已加固。
2. 本轮未访问生产数据库、主机、容器日志、密钥管理或实时流量；无法据此确认线上是否已泄密、被入侵，或仍运行旧版本。
3. 主动查单依赖供应商 API 可用性和真实字段契约。查询失败时会延后入账/履约，需通过供应商测试环境确认响应兼容、通知重试与对账恢复；本轮测试使用隔离 mock，未创建真实订单或扣款。
4. KC 24 小时 capability 是持有即授权的凭证。任务 ID 泄露不再等于获得权限；完整 token 与任务 ID 同时泄露、浏览器被控制或服务器密钥失窃仍需通过凭证保护、撤销/轮换与主机安全控制处理。本轮没有轮换生产密钥，也未验证真实代理拓扑配置。
5. 本轮 source-snapshot 包含源文件和测试证据，不含真实 .env；不可用它替代服务器数据库、持久化目录或机密配置的恢复备份。
6. 用户此前提供的 X 帖子正文与评论未能可靠取得，不能判断该站真实被盗原因，也不能声称本站与其同因或已完整消除该事件的全部风险。
7. 未提交、推送、创建 PR、合并、部署、执行 SQL、启用游客商品、启动 worker 或操作真实充值。后续发布仍须遵守 AGENTS.md 的完整提交、最新 main、恢复证据与各生产链路一致性规则。
