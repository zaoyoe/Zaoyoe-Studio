# 商城供应商 2.0：P2E 运行协调交接手册

记录日期：2026-10-19。本文只覆盖 P2E 持久运行协调，不代表供应商采购、交付、真实商户或生产已启用。Codex 本轮未执行 SQL、未启动 worker、未启用商品、未创建真实订单、未推送、未部署，也未修改 8000 本地预览。

## 1. 本轮交付

P2E 增加三类私有运行记录：

- `shop_supplier_runtime_accounts`：按供应商账号串行化租约、下次请求时间、连续失败次数和断路器窗口。
- `shop_supplier_runtime_jobs`：按采购意图记录阶段、尝试次数、租约、启动 ACK 时间、退避和人工复核状态。
- `shop_supplier_runtime_resumes`：管理员恢复操作的不可变操作回执；同一操作 ID 重放只返回原结果，不覆盖原记录。

`fn_shop_supplier_runtime_v2` 只允许 `service_role`，动作是 `scan / claim / start / finish / resume`。它只读权威采购状态并写运行协调表，不写原生订单、资金、营销、商户证据或交付物。

## 2. 关键栅栏

1. `claim` 必须同时拿到账号租约和 job 租约；同一账号一次只允许一个运行请求。
2. `start` 和 `finish` 共享 token、账号归属与租约有效期校验，但共享校验不读取 `request_started_at`。`start` 只有在租约仍有足够剩余时间、阶段与原计划一致、状态为 `running` 且没有已记录的请求启动时间时才返回 `applied=true`，随后写入启动标记。worker 只有收到明确匹配的 ACK 才能访问上游。
3. `finish` 的专属栅栏位于 `start` 分支之后、结果校验之前；它要求 `state = 'running'` 与 `request_started_at IS NOT NULL`。因此“只 claim、没有 start ACK”的调用不能伪造完成，而正常的 `claim -> start` 不会被提前拒绝。
4. `finish` 完成后清空 `request_started_at`。`pending / unknown / timeout / unavailable` 等结果可以按退避重新进入同一阶段，不会因旧的启动标记永久阻塞下一次 `start`。
5. 超时、ACK 丢失、查无结果都不能触发新的采购请求；恢复只查询原请求或进入人工复核。
6. `resume` 只重置运行协调状态，不改变原采购 deadline、账号 circuit、商户证明、dispatch policy、资金状态或 request identity。

## 3. 文件与执行顺序

用户在确认 P2D-2 已应用后，按以下顺序在目标数据库执行；Codex 不代执行：

1. `supabase/migrations/20261019_shop_supplier_platform_v2_runtime.sql`
2. `supabase/migrations/20261019_verify_shop_supplier_platform_v2_runtime.sql`

两份文件必须来自同一个候选提交。verify 文件是只读结构检查，预期只返回类似：

```text
Supplier P2E runtime structural checks passed; concurrent/business acceptance remains NOT RUN
```

如果第一份 migration 失败，不要继续执行第二份，也不要手工拆分 SQL。保留数据库客户端完整错误、执行时间、目标环境和事务是否回滚状态，先核对 P2D-2 前置 migration 是否已应用。

## 4. 默认关闭边界

以下开关必须保持关闭，直到真实商户、数据库并发和业务验收分别通过：

- `SHOP_SUPPLIER_RUNTIME_V2_ENABLED`
- `SHOP_SUPPLIER_DISPATCH_V2_ENABLED`
- `SHOP_SUPPLIER_RECONCILE_V2_ENABLED`
- `SHOP_SUPPLIER_DELIVERY_V2_ENABLED`

本轮没有安装定时器或 worker 调度。即使 migration 和 verify 成功，也不表示虾仁、16688 或任何账号具备 V2 自动采购准入；供应商 adapter 的 runtime contract、原请求恢复、拒绝终局性、成本上限和交付证据仍需单独核验。

## 5. 运行与恢复前置检查

只有在专门授权的测试环境，且所有开关仍按测试方案逐级打开时，才允许运行一次 worker。检查顺序：

1. 账号仍是原采购意图冻结的 `supplier_account_id / provider_id / credential_ref`。
2. 任务当前不是 `review`、`completed` 或已过期的采购 deadline。
3. 上游调用具备原请求 ID 查询能力；未知结果只允许 query，不允许生成新 request ID 或切换供应商。
4. worker 输出只能是聚合数量和安全错误码，不打印密钥、租约 token、claim token、请求参数摘要或交付内容。
5. `finish` 返回 `applied=false` 或 ACK 丢失时，将该次结果记为 confirmation pending，等待租约过期后核对，不重复 create。

管理员恢复必须使用新的 UUID 操作 ID，并绑定当前管理员、原意图和原账号范围。操作回执一旦写入不可更新或删除；重复点击同一恢复动作只能重放同一回执。

## 6. 本轮证据与未运行项目

首轮窄范围证据仍保留，供历史追溯：P2E 供应商专项为 `358 PASS`，本轮在发现共享租约校验顺序问题前生成；不能作为当前 SQL 的最终证据。

修正共享租约/start/finish 栅栏后，当前候选工作区的本地证据包括：

- P2E runtime 源码契约：4 PASS。
- 扩大范围的供应商/采购/交付/Admin 相关专项回归：484 PASS、0 FAIL、0 SKIPPED、0 CANCELLED、0 TODO。
- 全量 Node 回归：5472 PASS、0 FAIL、0 SKIPPED、0 CANCELLED、0 TODO。
- 当前工作区改动/未跟踪文件共 97 个；其中运行源码、SQL、测试与脚本清单覆盖 89 个文件，69 个 JavaScript 通过语法检查；`git diff --check` 通过。清单报告排除文档，避免报告哈希与手册相互引用。
- 两份当前 P2E SQL 离线解析通过：runtime migration 24 个 SQL 语句/4 个 PL/pgSQL 块，verify 6 个 SQL 语句/1 个 PL/pgSQL 块；未连接数据库或执行 SQL。
- `finish` 状态/启动 ACK 栅栏、request marker 清空、service-role 权限、默认关闭和 resume 不变更业务证据均有源码断言。
- 当前专项日志：`/tmp/supplier-v2-p2e-focused-20261019-r2.log`，SHA256 `dbbbecc132707e81325b49b4d5316f12d9b047706c92ec6eae86a3eb4052a658`；全量日志：`/tmp/supplier-v2-p2e-full-regression-20261019-r2.log`，SHA256 `ed4314d39b89df3f6e1d4cce69ff700ad280ae72dd2c72275c88937907b19cad`。历史首轮日志仍保留在无 `-r2` 后缀的路径。
- 当前 SQL 离线解析报告：`/tmp/supplier-v2-p2e-sql-parse-20261019-r2.json`，SHA256 `31bf00867fd4f363bebf3f8da7c68647b6259f2498682087e4a8f8e8cd69df89`；源码清单：`/tmp/supplier-v2-p2e-source-checks-20261019-r2.json`，SHA256 `9ed9cf3fc66718540804b8566a31fb6b65309c6d1e72993ba32f46b08e9c5372`。

当前两份 P2E SQL SHA256：

| 文件 | SHA256 |
| --- | --- |
| `supabase/migrations/20261019_shop_supplier_platform_v2_runtime.sql` | `6727c17bf8d141e058c04a0d79f70dd70d1759b456a5ee307ac3fd4ce9c7c7b8` |
| `supabase/migrations/20261019_verify_shop_supplier_platform_v2_runtime.sql` | `b289294a3829e288f1e26bd6872eb1eb9e7d90851a2d2db958de9f123b16f3a8` |

当前工作区仍以 `e9db00863fddaaab782c00aef14bb1bd21040314` 为 `HEAD`，与 `origin/main` 一致；本轮修正仍未形成候选提交，不能把该 SHA 或本地测试结果当作发布 SHA/生产证据。测试结果不能替代数据库输出。

以下项目保持 `NOT RUN`，不得写成 PASS：

- 目标数据库 migration 实际应用和 verify 输出。
- 事务锁竞争、并发 worker、租约过期和真实故障恢复。
- 真实虾仁/16688 商户请求、余额、拒绝终局性、交付与成本验收。
- 浏览器端 Admin Studio / 用户订单业务验收。
- worker 安装、定时器启动、生产发布和 8000 预览更新。

## 7. 失败处理

- verify 报 runtime table/function/privilege/fencing 缺失：停止启用，不修改历史结果，不通过改文案规避。
- 数据库出现 `lock timeout`、函数签名冲突或前置函数缺失：保留完整错误，核对 migration 顺序和目标环境；不要重复执行不确定的部分。
- worker 出现 `confirmation_pending`：不重放 create；先等待租约窗口，再执行原请求 query 或转人工复核。
- 发现数据库、代码、worker 的 SHA 不一致：停止运行和配置变更，先恢复到同一候选提交并重新核对清单。

## 8. 收尾记录格式

记录 P2E 时至少保留：候选提交 SHA、两个 SQL 文件 SHA256、migration 输出、verify 输出、专项测试精确数量、数据库环境标识（不含密钥）、worker 是否运行、真实商户/并发/浏览器验收状态。没有外部输出时，统一写 `NOT RUN`，不以本地源码 PASS 代替。

## 9. 2026-10-19 用户执行回执补记

用户报告两份 P2E SQL 已执行完毕，并提供第二段 verify 的完整结果：

```text
Supplier P2E runtime structural checks passed; concurrent/business acceptance remains NOT RUN
```

据此，P2E 数据库**结构校验**可记录为 `PASS`。该结果仅证明 runtime 表、函数、权限与结构栅栏符合 verify 契约；数据库事务锁竞争、并发 worker、租约过期恢复、真实供应商请求、浏览器业务和生产运行仍为 `NOT RUN`。

第一段 migration 的原始输出、目标数据库环境标识和执行时间尚未提供，因此不把“用户报告已执行完毕”替代为完整 migration 证据；后续归档时仍需补齐这些元数据。worker、定时器、V2 开关、商品外采资格继续保持关闭。

## 10. 2026-10-19 本地 8000 预览刷新回执

按用户明确指令刷新本地预览前，已执行 `git fetch origin main`；当前候选分支相对 `origin/main` 为 `behind=0、ahead=0`，双方 SHA 均为 `e9db00863fddaaab782c00aef14bb1bd21040314`。已停止旧的 8000 预览进程，并从同一工作区重新启动 `npm run preview:local`。

当前健康检查确认：

- `http://127.0.0.1:8000/healthz` 返回 HTTP 200；`sourceRoot` 与 `serverSourceRoot` 均为本工作区。
- `sourceCommit` 与 `serverSourceCommit` 均为 `e9db00863fddaaab782c00aef14bb1bd21040314`。
- `shop.html`、`admin-studio.html`、`tg`、`tg-admin.html` 均返回 HTTP 200。
- `workingTreeDirty=true`，因此脚本按设计报告 `sourceMatchesStartup=false`、`restartRequired=true`；这表示当前预览来自未提交工作区，不表示仍在使用旧进程或旧快照。
- `productionEvidence=false`；本次只更新本地预览，未推送、未部署、未启动 worker、未打开供应商采购。

## 11. 2026-10-20 P2E 手动验收入口

在结构校验已通过、且目标数据库允许使用明确安全夹具时，下一步可由用户手动执行以下只读边界验收脚本：

`/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/acceptance/20261019_supplier_runtime_p2e_acceptance.sql`

该脚本必须在隔离测试数据库或经过批准的维护窗口中执行。它只接受同时满足以下条件的已关闭夹具：账号明确标记为 `test`、`fixture` 或 `sandbox`，账号 `is_enabled = false`，采购意图为 `not_submitted`，履约单资金状态为 `funded`，且运行计划仍在有效时间窗口内。没有这样的夹具时，除 `runtime_structural_prerequisites` 外各项保持 `NOT RUN` 是正常结果；不得把真实生产账号、真实订单或“只是未启用”的普通账号改造成夹具。

脚本执行顺序与证据边界：

1. 只执行上述 acceptance SQL，不重放 migration/verify，不手工拆分脚本，不执行任何 worker 或供应商请求。
2. 保存结果表、执行时间、目标环境标识和客户端是否回滚；不要保存或粘贴 token、数据库错误详情、供应商凭据或请求参数。
3. `runtime_structural_prerequisites = PASS` 只代表 runtime 表和函数存在；单会话的租约拒绝、恢复和 projection 检查也不能替代两个数据库会话的并发验收。
4. `same_account_concurrent_claim`、`same_job_concurrent_claim`、`worker_output_redaction`、`real_supplier_business_acceptance` 等项目仍需要独立的隔离流程；脚本明确保持它们为 `NOT RUN`，不伪造业务 PASS。
5. 脚本在最后执行 `ROLLBACK`，不保留运行协调行、resume 回执或测试夹具状态。发现 `FAIL` 或 SQL 错误时停止，不重试未知事务，不打开任何 V2 开关。

本轮新增的离线契约测试为 **4 PASS、0 FAIL、0 SKIPPED、0 TODO**；`git diff --check` 通过。当前 acceptance SQL SHA256 为 `1ba1bf4bc93723802dca0986f21a5b06941a2f75d7cd53b21dd4022b4f855b47`，契约测试 SHA256 为 `4b5531f7a4e520c09b8a98dd66dee515fce97870ce90c27964a420ccb059e3c5`。这些是本地文件完整性证据，不是数据库或真实业务验收结果。

## 12. 2026-10-20 双会话并发验收入口

结构校验已经通过，但并发结果仍为 `NOT RUN`。为验证同一采购意图和同一供应商账号的数据库租约串行化，新增以下五个 SQL 文件；它们必须来自同一候选工作区：

- `/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/acceptance/20261020_supplier_runtime_p2e_concurrency_session_a_seed.sql`
- `/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/acceptance/20261020_supplier_runtime_p2e_concurrency_session_a_hold.sql`
- `/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/acceptance/20261020_supplier_runtime_p2e_concurrency_session_b_same_job.sql`
- `/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/acceptance/20261020_supplier_runtime_p2e_concurrency_session_b_same_account.sql`
- `/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/acceptance/20261020_supplier_runtime_p2e_concurrency_cleanup.sql`

### 执行前提

1. 只在隔离测试数据库或批准的维护窗口执行；必须使用能保持数据库会话的 SQL 客户端。Session A 的 seed 和 hold 要在同一个连接中执行，不能把临时表跨连接使用。
2. 脚本只接受明确标记为 `test`、`fixture` 或 `sandbox`、且 `is_enabled = false` 的供应商账号；对应意图必须是 `not_submitted`，履约单必须是 `funded`，运行计划必须在有效时间窗口。没有唯一安全夹具时停止，不能修改生产账号来“制造”夹具。
3. 两个 B 脚本必须使用另外两个独立数据库会话；同一个 SQL 编辑器事务或依次执行不能证明并发。脚本只调用私有 runtime claim，不调用虾仁、16688、worker、HTTP、支付或真实订单。

### 严格顺序

1. Session A 执行 `session_a_seed.sql`，结果为 `PASS` 后保持该连接不变。
2. 仍在 Session A 执行 `session_a_hold.sql`。看到 `Session A 已持有 runtime account/job 锁` 后，立即在 hold 的 45 秒等待期间启动以下两个独立会话：
   - Session B1 执行 `session_b_same_job.sql`，对应 `same_job_concurrent_claim`。
   - Session B2 执行 `session_b_same_account.sql`，对应 `same_account_concurrent_claim`；它还要求同一个安全账号存在第二个符合条件的意图，没有第二个意图时结果为 `NOT RUN` 是正常的。
3. 两个 B 会话都返回后，确认结果是 `acquired = false` 且实际等待至少 1 秒；只有脚本返回 `PASS` 才能记录对应并发项目为 `PASS`。锁超时、没有唯一目标或等待不足都必须保持 `NOT RUN`，竞争成功必须记录为 `FAIL`。
4. Session A 的 hold 提交释放锁、两个 B 脚本回滚后，再执行 `cleanup.sql`。清理脚本只允许删除一个明确关闭的安全账号下的 `shop_supplier_runtime_jobs` 和 `shop_supplier_runtime_accounts` 行，不删除意图、资金、商品、供应商账号、凭据或交付证据。

本轮新增并发入口契约测试为 **7 PASS、0 FAIL、0 SKIPPED、0 TODO**；测试覆盖五文件清单、Session A 的账号后 job 锁顺序、两个 B 会话的延迟拒绝条件、B 会话回滚、cleanup 的唯一目标和运行协调表限定。该测试仍是源码契约证据，不是数据库并发结果；在用户提供两个独立会话的结果前，`same_job_concurrent_claim`、`same_account_concurrent_claim`、worker 脱敏和真实商户验收继续保持 `NOT RUN`。

### 12.1 2026-10-20 SQL 别名修正记录

用户执行旧版 Session A seed 时收到 PostgreSQL `42P01: missing FROM-clause entry for table "p"`。修正版将运行计划函数显式命名为 `AS plan`，并同步修正同账号 Session B 的投影字段，避免使用未定义的 `p.*`。请关闭旧 SQL 编辑器标签后重新打开以下文件；不要继续执行旧剪贴板或旧快照内容：

- `/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/acceptance/20261020_supplier_runtime_p2e_concurrency_session_a_seed.sql`
- `/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/acceptance/20261020_supplier_runtime_p2e_concurrency_session_b_same_account.sql`

修正后的并发契约测试为 **7 PASS、0 FAIL、0 SKIPPED、0 TODO**；未执行 SQL，未调用供应商，数据库并发和真实业务结果仍保持 `NOT RUN`。

随后复核发现旧版结果汇总还使用了 PostgreSQL 不支持的 `min(uuid)`。当前 seed 已改为从唯一目标行通过 `array_agg(...)[1]` 读取 UUID；重新执行前应回滚上一次失败事务或新建数据库会话，并重新运行完整 seed。

## 13. 2026-10-20 P2E 隔离 worker 输出脱敏验收

在本地子进程中启动真实 worker CLI 入口，并用 `NODE_OPTIONS` preload 将 Supabase client 和 supplier adapter 替换为内存夹具；`fetch` 被拦截，测试不会连接数据库或任何真实上游。覆盖派发成功、交付查询、runtime RPC 异常和 adapter 异常四条输出路径，并在 stdout/stderr 中检查 service-role、上游密钥、交付密钥、指纹密钥、租约/请求标识、原始上游数据、交付内容及异常消息等哨兵值没有泄漏。输出仅为聚合计数或安全错误码。

复跑命令：

```sh
node --test tests/shop-supplier-v2-runtime.test.js tests/shop-supplier-v2-runtime-worker.test.js tests/shop-supplier-v2-runtime-acceptance-contract.test.js tests/shop-supplier-v2-runtime-concurrency-contract.test.js tests/shop-supplier-v2-runtime-migration-contract.test.js
```

结果为 **40 PASS、0 FAIL、0 CANCELLED、0 SKIPPED、0 TODO**；三个 worker 相关 JavaScript 文件语法检查通过，`git diff --check` 通过。证据对应候选基线 `e9db00863fddaaab782c00aef14bb1bd21040314` 的脏工作区，不是已提交或生产版本。

状态边界：`worker_output_redaction` 的**隔离子进程测试**记为 `PASS`；实际连接本地 Supabase/Postgres 的 worker 日志、生产 worker 日志仍为 `NOT RUN`。本轮没有执行 SQL、启动数据库 worker、调用供应商、启用任何开关、创建订单、部署或推送。此前报告的本地数据库 acceptance `14 PASS / 4 NOT RUN` 未在本轮复跑，也不因本节改变；数据库并发、真实供应商业务和浏览器端验收仍须分别保留各自证据。

下一步不自动触发真实采购。若要做真实上游业务验收，需先明确隔离测试账号、单一 SKU、最大预算及允许调用的供应商；获得该范围的明确授权后，再按计划执行并记录费用与结果。此前 SQL 文件仍由用户在目标数据库执行，Codex 不执行 SQL。

## 14. 2026-10-20 全量回归与本地数据库环境核验

复跑供应商/购物车/游客竞态专项为 **542 PASS、0 FAIL、0 CANCELLED、0 SKIPPED、0 TODO**；仓库全量 `npm run test:security` 为 **5485 PASS、0 FAIL、0 CANCELLED、0 SKIPPED、0 TODO**。这些是当前脏工作区的代码测试结果，不是数据库或生产证据。

本机 `supabase status` 因 Docker daemon 不可用而失败；未发现 Docker Desktop 或仓库 `supabase/config.toml`。本机 PostgreSQL 5432 正在监听且有 `sub2api` 客户端连接，因此没有连接、写入或执行验收 SQL。双会话数据库并发、连接数据库的 worker 日志、真实商户和浏览器业务仍为 `NOT RUN`。继续 DB 验收前，必须先提供独立本地 Supabase/Postgres 环境；不得把共享的 `sub2api` Postgres 当作夹具库。五份并发 acceptance SQL 仍由用户执行，Codex 仅核对脚本和返回结果。

## 15. 2026-10-20 本地 PostgreSQL 双会话并发实测

承接第 14 节，本机没有可运行的 Supabase Docker 栈，因此准备了独立 PostgreSQL 18.3 测试集群；它不是 Supabase 完整环境，也不是 5432 上供 `sub2api` 使用的实例。数据库连接固定为 `127.0.0.1:55432/supplier_p2e_acceptance`，数据目录 `/tmp/supplier-p2e-pg/data`，仅监听 loopback。测试期间通过查询确认目标数据库、地址和端口；5432 只检查监听进程，没有连接或写入。

本地 bootstrap 提供最小 `auth`/角色和 P2E runtime 前置 schema；随后原样应用 `supabase/migrations/20261019_shop_supplier_platform_v2_runtime.sql`，并创建一个关闭的 `test-fixture-p2e` 账号、两笔 `not_submitted` 意图和两条 `funded` unit。账号、订单和供应商请求均为本地夹具。因该 bootstrap 是兼容性夹具且缺少完整 Supabase Auth、PostgREST 及全部前序业务 schema，本节只证明本 PostgreSQL 集群中的 P2E runtime 锁协调行为，不能外推为完整 Supabase 集成或生产验收。

按第 12 节五个 SQL 文件执行：Session A seed 与 hold 共用一个 psql 连接；同一 hold 窗口内，两个独立 psql 连接同时执行 same-job 与 same-account SQL。seed、hold 均返回 `PASS`。最终有效一轮结果：

| check | result | evidence |
| --- | --- | --- |
| `same_job_concurrent_claim` | `PASS` | `acquired=false`，等待 **44.855 秒**，Session A 持锁期间拒绝同一 intent 的竞争 claim |
| `same_account_concurrent_claim` | `PASS` | `acquired=false`，等待 **44.857 秒**，Session A 持锁期间拒绝同账号另一 intent 的竞争 claim |
| database lock chain | `PASS` | 独立 backend 观察到 B1 等待 A 的 account/job 锁；B2 等待 B1，形成同一 PostgreSQL 锁等待链。B2 无须直接把 A 列为 blocker |
| `cleanup.sql` | `PASS` | 仅清理安全夹具账号的 runtime jobs/accounts；业务夹具未删除 |

首次编排尝试在 hold 窗口结束后才启动 B，会话脚本分别返回 `NOT RUN`（等待约 0.002 秒和 0.001 秒），没有被计入通过；随后按清理脚本清除协调行，再使用自动编排重跑。另一次监控判定曾错误要求 B1、B2 都直接以 A 为 blocker，因真实队列是 `A → B1 → B2` 而给出监控器 `FAIL`；最终以两个 SQL 的耗时/结果及 `pg_blocking_pids` 观察到的传递锁链复核，两个业务验收项通过。该监控器判定不属于 acceptance SQL 结果，不隐藏为 PASS。

结束后复查 `shop_supplier_runtime_accounts`、`shop_supplier_runtime_jobs`、`shop_supplier_runtime_resumes` 行数均为 **0**；两条本地意图、两条 funded unit 和 disabled fixture account 保留。PostgreSQL 18.3 测试集群继续运行，供后续本地 P2E 验收复用。运行期间 runtime/worker/acceptance/concurrency/migration 契约专项 **40 PASS、0 FAIL、0 CANCELLED、0 SKIPPED、0 TODO**；这是代码契约回归，与上述数据库并发结果分别记录。

验收 SQL 与 runtime migration 均未修改。运行时 SQL SHA256：runtime migration `6727c17bf8d141e058c04a0d79f70dd70d1759b456a5ee307ac3fd4ce9c7c7b8`；Session A seed `0bd4fc54cd3bffa755f8c3ccdd9e32b59764998f5cd024f503ca1c9e46f7c888`；Session A hold `b16596d8bf22b864d48ce76ba3b0032ac65d57d801ffa85057e8ef4354666816`；same-job `b3c291eeb155622337d3879b1973e064c3d1b21e3ceddf5f7ac2cf0f661c5b63`；same-account `0bab55f47a48237a3c7f76c7c03ea8bfa6d2a1f70e5220acaa4d38bfe9c99954`；cleanup `76ed435aabbfa581d3e33b6a49ca3014f1453a2854e10e48fe2805080ca52474`。

本轮没有启动 worker、调用虾仁/16688、访问真实订单、开启任何采购开关、部署或推送。实际数据库 worker 日志、完整 Supabase Auth/PostgREST、真实供应商业务和浏览器业务仍为 `NOT RUN`。本记录对应候选基线 `e9db00863fddaaab782c00aef14bb1bd21040314` 的脏工作区，不是已提交或生产证据。
