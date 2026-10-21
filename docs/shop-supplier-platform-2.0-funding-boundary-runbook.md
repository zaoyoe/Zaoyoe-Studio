# 商城供应商 2.0：P2A 资金事务边界与验收记录

记录日期：2026-10-19。本轮承接用户「已执行 sql，继续下一步」，实现 P2 的第一个内部切片。上一轮 SQL 的执行是用户反馈，未提供实际输出；本轮两份 SQL 尚待用户执行。Codex 没有连接数据库、执行任何 SQL、读取商户密钥或发起真实采购。

## 1. 交付与范围

本切片准备原生订单、资金凭据、采购意图、风险预算占用、阻断 outbox 和事务事件之间的数据库契约。绑定 hook 不创建原生订单、不扣积分、不访问上游；只有原生购买/支付事务按下述顺序调用它，资金边界才能生效。**目前尚未修改原生调用方，因此不能称为商城采购交易闭环已接通。**

| 已实现的内部契约 | 明确保留的限制 |
| --- | --- |
| CN、单件、固定默认/race 规格，绑定真实本地产品/SKU、原订单和订单项 | 国际站、多件、复杂表单、混合购物车/现金合并支付批次未接入 |
| 稳定 operation_id、请求摘要、重复调用返回原单元、异参冲突 | 不能把前端重试生成的新 ID 当作同次处理 |
| 积分来源流水、购买者/站点/金额、付费与奖励积分拆分核验 | 原生钱包扣款、积分 lot 归因仍须由原生购买事务完成；hook 不另扣一次 |
| 已核验现金支付单和事件，重复确认不重复产生采购意图 | 不是允许客户端声明已支付的新接口 |
| 共享账号预算锁及版本更新，单笔/总额/未结数量约束 | 风险占用不会随超时自动释放；解除风险与售后操作尚未实现 |
| 每个单元一份采购意图、一份 blocked 任务、一份 funding_captured 事件 | 全部采购意图只能是 not_submitted；没有 worker、claim、提交或重试入口 |
| 销售积分、销售 CNY、采购 CNY 上限分别记录 | 实际采购成本始终为 NULL；预留成本不能计作已发生费用 |
| 私有表 RLS、service_role 只读，写入仅限受保护函数 | 尚无新的对外代理路由、后台采购运营入口或启用开关 UI |

既有本地库存、旧 API webhook 履约、游客购买、TG、KC、NewAPI 和 8000 预览均未接入或改写本 hook。对没有供应商绑定的既有现金订单，新增确认触发器仅查找绑定后返回，不生成采购记录。

## 2. 来源、文件和恢复

- 分支：codex/shop-supplier-platform-2。
- 唯一远端：https://github.com/zaoyoe/Zaoyoe-Studio.git。
- 开发基线 HEAD / origin/main：e9db00863fddaaab782c00aef14bb1bd21040314；本轮编辑前 fetch，HEAD..origin/main 为 0。
- 上一轮恢复引用：refs/codex-backups/supplier-platform-2-p1-20261019-final，提交 9195373d37296fe41b7ec103e73998ecc9dd962b；不包含本轮 P2A。
- 本轮恢复引用预留为 refs/codex-backups/supplier-platform-2-p2a-20261019-final。只有完成全部文件读回核验后才在收尾记录中将其标记为已核验；它是恢复快照，不是发布候选。
- 当前变更尚未提交、推送、创建 PR 或部署。将来发布必须重新核对最新 main、干净候选、完整发布清单和生产链路，不能直接发布本工作目录。

本轮在上一轮完整清单之上新增/追加：

| 文件 | 用途 |
| --- | --- |
| supabase/migrations/20261019_shop_supplier_platform_v2_funding_boundary.sql | 五个私有表、绑定函数、内部资金捕获、两个延迟约束触发器及权限 |
| supabase/migrations/20261019_verify_shop_supplier_platform_v2_funding_boundary.sql | 只读检查权限、关联、唯一约束、触发器、预算串行化和数据一致性 |
| tests/shop-supplier-v2-funding-boundary-contract.test.js | 19 项 SQL/源代码边界契约；不连接数据库 |
| docs/shop-supplier-platform-2.0-funding-boundary-runbook.md | 本文，调用顺序、失败语义、数据库验收与证据边界 |
| docs/shop-supplier-platform-2.0-readonly-runbook.md | 追加用户反馈已执行 SQL 的记录；保留原 NOT RUN |
| docs/shop-supplier-platform-2.0-plan.md | 追加 P2A 实施进度；不将 P2 整阶段改记完成 |

## 3. 用户执行顺序

先核对上一轮的迁移和只读 verify 已在目标环境执行；不要重放整套历史迁移。用户本轮反馈已执行，但未附输出，所以先前 P0/P1 的结构结果仍未独立观察。

本轮由用户审核并顺序执行：

1. /Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/migrations/20261019_shop_supplier_platform_v2_funding_boundary.sql
2. /Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/migrations/20261019_verify_shop_supplier_platform_v2_funding_boundary.sql

首份包含 BEGIN/COMMIT，添加新结构及触发器，不插入或启用任何交易策略/预算，不修改既有商品的发布状态。默认 intake_enabled=false，预算均为零。若已有同名但不同结构的表，保留失败输出并核对实际结构，不通过删表或清空数据修复。

第二份是只读结构核验，不造单、不扣款、不启用策略、不请求商户。预期结果是：

> Supplier P2A funding boundary structural checks passed; database transaction/concurrency/merchant acceptance remains NOT RUN

这只表示脚本覆盖的结构通过。数据库事务、并发竞争、原生结算接线、上游商户和整条业务验收仍须分别提供证据。第一份仅返回 success、第二份返回上述结构结果，属于正常的脚本输出；尚未观察到用户实际运行本轮脚本的结果。

## 4. 原生调用方契约：尚未接线

### 4.1 积分购买

未来受保护的原生购买 RPC 必须在同一数据库事务中完成：

1. 按原有逻辑锁定用户/站点钱包，执行服务端商品、报价、优惠和余额核验，确定实扣积分以及付费/奖励拆分。
2. 创建待交付原订单及唯一订单项；本地库存、普通 webhook 和供应商采购只能选择一种履约来源。
3. 调用 fn_bind_shop_supplier_funding_v2，传服务端确定的原订单/订单项/用户、映射及精确 revision、采购成本上限和稳定 operation_id。绑定必须在 SHOP_ORDER_<原订单UUID> 流水写入之前。
4. 完成原生余额扣除、同业务引用的唯一扣款流水和钱包 lot 归因。记录 paid_points_spent 与 bonus_points_spent，二者非负且合计等于实扣积分。保留原有优惠、积分溯源和退款语义。
5. 到事务提交时，延迟约束触发器核验完成后的资金事实；通过后原子写入采购意图、风险占用、blocked outbox、资金凭据关联和事件。

原生 RPC 的返回必须在事务成功提交后才被服务端当作成功。缺少流水、金额/购买者/站点不匹配、竞争导致预算不足、outbox 或事件写入失败，都应使整个调用事务回滚。不能先用现有 RPC 扣款成功，再另发一次 HTTP/RPC 绑定供应商；绑定会拒绝已存在原生扣款流水的订单。

**当前 fn_purchase_shop_item_core 等原生购买函数尚未调用该 hook。** 现有本地 KEY 购买分配库存，API 购买生成 webhook 任务，本 hook 会拒绝这两类已选择其他履约来源的订单，不能靠手动补录把旧订单转成外采。

### 4.2 游客现金

未来原生外采创建分支必须在支付渠道请求之前创建 pending 原订单并绑定，且不创建本地库存占用。对外支付仍使用既有支付隔离、签名/金额/币种/终态核验和支付事件事实，不新增客户端 paid 标志捷径。

原生支付确认事务更新支付单后，还会更新订单和事件；新增 AFTER UPDATE 约束触发器延迟到事务末尾读取完整事实。只有支付单与事件的商户单号、渠道、上游支付单号、站点、币种、金额、用途和最终成功状态一致，才能捕获资金。重复通知和同事务两次触发会读取 funded 单元后返回，不再创建意图。

- 现金已核验到账后预算不足：保留原确认事实，创建 not_reserved 意图和 risk_budget_unavailable 阻断任务。后续由运营处理退款/结案，不能通过抛弃到账记录掩盖收款。
- 支付已过期、原生退款/占库/履约状态不适合采购：保留资金事实，进入 customer_resolution_required；不自动采购或重新占库。
- 绑定后账号或新接单策略停用：已验证收款仍须登记；不因关闭新增交易而丢弃旧订单支付。
- 支付单或核验事件不匹配：事务拒绝；保留原支付事件供原生对账与重试流程处理，不能绕过核验。

**当前游客创建和确认函数尚未增加外采来源分支。** 原有流程需要本地库存；没有预留库存的确认可能进入 paid_unfulfillable/退款路径，不能只加一个 hook 就宣称可用。现金合并支付批次是另一套原生表，未纳入本切片。

### 4.3 operation_id、预算与重试

operation_id 对应同一次内部绑定，参数摘要包括资金类型、原订单/订单项/用户、映射/版本和 CNY 成本上限。同 ID 同参数返回原 unit_id；同 ID 异参冲突；同原订单换 ID 也不能增加第二份绑定。采购意图首次创建时产生 original_request_id 并持久保存，后续适配器必须复用原请求身份，不在重试时生成第二笔采购。

所有预算判断先锁同账号策略行，再更新 budget_version，然后汇总 held 暴露。版本更新使并发写入需要串行处理；REPEATABLE READ/SERIALIZABLE 下若发生序列化失败，必须重试整个原生数据库事务，复用外层业务幂等身份，不能只重发资金捕获或上游请求。该设计尚未在真实双会话中验收。

预留成本用于风险占用，不是上游已扣款或利润事实。未知费用保持 NULL。没有 TTL 清除占用，也没有采购放行/补发/释放动作；后续每项动作都需要受保护的状态机与原操作关联。

## 5. 隔离数据库验收矩阵：NOT RUN

以下由用户在审核过的隔离环境执行，归档环境、脚本版本/摘要、会话、事务提交结果、相关 ID、行数及失败 SQLSTATE。不得把静态测试或结构结果填入本表。不要使用真实用户订单试造扣款，也不要以本表作为生产启用授权。

| 场景 | 必须观察的结果 |
| --- | --- |
| 积分：同事务新订单/订单项、绑定、真实原生扣款及 lot 归因 | 提交后恰好一份 funded 单元/原扣款/意图/blocked 任务/资金事件；钱包与 lot 一致 |
| 积分：只绑定未写扣款流水 | COMMIT 失败，原订单/绑定/余额/意图/outbox/事件均无半写入 |
| 积分：错误用户/站点/金额、拆分不符、重复扣款引用 | 提交拒绝；不能捕获另一笔资金 |
| 已扣款积分订单再绑定 | supplier_binding_must_precede_points_debit；既有订单和钱包不变 |
| 其他订单的订单项、其他产品的 SKU、非 CN、多件 | 拒绝；复合外键和函数校验共同生效 |
| 本地库存已分配或已有 API webhook 任务 | 拒绝供应商绑定，不产生第二份履约 |
| 同 operation_id 同参/异参；同订单换 operation_id | 同参复用原单元；异参冲突；同订单没有第二份绑定 |
| 与映射修改/停用并发，过期 revision，复杂 variant | 只允许精确匹配；不得静默换账号、货号或规格 |
| 两个积分订单争抢最后一个数量/金额预算 | 最多一个成功；失败方整笔回滚，包括原扣款与优惠消费 |
| 两会话 READ COMMITTED 及 REPEATABLE READ 争抢预算 | 不超量/超额；记录序列化冲突并证明整笔重试后仍唯一；不能只看行锁存在 |
| 原生扣款、lot、outbox、资金事件任一步故障 | 整笔回滚；真实注入数据库错误，不能用模拟返回值代替 |
| 游客绑定 pending 后未付款 | 可提交 awaiting_payment；不产生采购意图或预算占用 |
| 游客真实验证确认及重复/并发通知 | 保留原生付款事实；一份资金凭据/意图/outbox；无重复扣费/交付 |
| 游客核验事件的支付单/商户单号/站点/金额/币种/用途/终态任一不匹配 | 不捕获供应商资金，不将客户端标记当证据 |
| 游客付款前预算被其他交易占满 | 到账仍 confirmed；not_reserved + risk_budget_unavailable；无已执行任务 |
| 绑定后停用账号/新增接单策略再到账 | 已核验收款不丢失；任务仍 blocked；不触发上游请求 |
| 过期后到账、退款待处理、已有库存占用或不适合交付的状态 | customer_resolution_required；不能再采购或回退付款事实 |
| 原单没有供应商绑定 | 现有本地/游客路径结果保持一致，不写五个新表 |
| anon/authenticated 调用，service_role 直接改私有表/调用内部捕获 | 权限拒绝；只能通过受保护绑定和原生触发器写入 |
| 所有通过/失败场景 | actual_cost_cny 为 NULL、供应商单号为空、not_submitted + blocked；无真实商户请求 |

结构验证无法证明余额真的扣过、lot 归因正确或支付签名在真实渠道成立；这些分别依赖原生实现接线与业务验收。商户丢失响应恢复、幂等期限/作用域、币种/报价、交付内容与终态、限价能力、退款/拒单证据也仍为 NOT RUN。

## 6. 本轮验证记录

初次 PL/pgSQL 解析发现绑定函数中 IS DISTINCT FROM 后的 CASE 未加括号，已修正后重解析。新增契约测试初跑为 19 项、18 PASS / 1 FAIL：只读检测把权限字符串内的 TRUNCATE 当作执行语句；检测改为先排除字符串内容，保留原来的禁止写语句断言，最终 19 PASS / 0 FAIL。上述失败不作为数据库运行结果。

收尾验证结果、精确通过数量、日志/来源摘要及恢复快照由下方追加记录保存。数据库应用、结构实际执行、事务/并发、商户、原生调用方闭环与生产部署继续分别为 NOT RUN。

## 7. 下一切片

在核对本轮 SQL 执行输出后，继续准备服务端可信报价快照、原生积分/游客创建与支付确认的外采来源分支，以及订单/任务只读状态联动。采购提交保持阻断，直到原请求恢复与上游交付契约完成核验；接线代码、隔离数据库事务测试、商户测试和实际销售启用是独立证据，不互相替代。

设计依据（仅说明 PostgreSQL 语义，不是本实现运行通过证据）：PostgreSQL 官方 CREATE TRIGGER 文档的延迟约束触发器与 WHEN 时机，Transaction Isolation 文档的行锁/序列化冲突，System Information Functions 文档的权限检查。对应官方地址为 https://www.postgresql.org/docs/current/sql-createtrigger.html、https://www.postgresql.org/docs/current/transaction-iso.html、https://www.postgresql.org/docs/current/functions-info.html。


## 8. 2026-10-19 收尾验证与交接（追加）

本节记录最终工作区检查；不替代第 5 节的数据库验收。上一节的解析/测试初次失败记录保留。

| 证据 | 本轮最终结果 | 范围与限制 |
| --- | --- | --- |
| 商城相关完整自动回归 | **PASS：95 文件 / 990 测试；990 通过，0 失败、0 跳过、0 取消、0 TODO** | admin-shop、guest-shop（含历史 archive）、shop-supplier、shop-cart、shop-auth-login-prompt；不连接业务数据库 |
| 本轮 P2A 契约 | **PASS：19 项** | 已包含在 990 项中，不能重复相加；检查 SQL/源码契约，不能证明事务或并发行为 |
| JS 语法 | **PASS：11 文件** | 上一轮相关实现、测试、浏览器脚本与本轮新增契约测试 |
| SQL 源码解析 | **PASS：迁移 31 条 SQL / 4 个 PL/pgSQL 块；verify 6 条 SQL / 1 个 PL/pgSQL 块** | pglast parse_sql / parse_plpgsql，纯解析；不能验证实际数据库列、权限、约束或事务运行 |
| 工作区差异格式 | **PASS：git diff --check** | 结果无诊断 |
| 数据库应用及 verify 实际输出 | **NOT RUN（本轮 P2A）** | 两份文件交用户顺序执行；上一轮的应用仍只记为用户反馈 |
| 真实数据库事务 / 并发 / 故障注入 | **NOT RUN** | 第 5 节 20 类验收仍未执行 |
| 原生结算接线 / 真实商户 / 自动采购交付 / 生产部署 | **NOT RUN** | 本切片没有接通这些入口；P2 整阶段未完成 |

回归使用 `node --test --test-force-exit`，测试文件按以下规则从 tests/ 枚举并排序：以 admin-shop-、guest-shop-、shop-supplier-、shop-cart- 或 shop-auth-login-prompt 开头，并以 .test.js 结尾。完整清单、各测试与变更文件的来源 SHA256、命令和计数记录在 /tmp/supplier-v2-p2a-regression-20261019.json；日志为 /tmp/supplier-v2-p2a-regression-20261019.log，日志 SHA256 为 c249b7700bea1ee2cd5705ee868e4ba6a1e27f371bded3ddf2ec104c9141669a。Node 本机默认 spec reporter 的最终计数以 ℹ 行输出；初次汇总器只识别 TAP 的 # 行，随后从同一份成功日志提取并交叉核对 990 项计数，没有修改或重写测试输出。

源码检查清单：/tmp/supplier-v2-p2a-source-checks-20261019.json。SQL 解析记录：/tmp/supplier-v2-p2a-sql-parse-20261019.json。本次没有修改 UI，因此没有重跑上一轮四场景浏览器模拟；第 6 节以外的旧 UI 证据不能冒充本轮数据库验收。

| SQL 文件 | SHA256 |
| --- | --- |
| 20261019_shop_supplier_platform_v2_funding_boundary.sql | 56c610c36ba0526ee44b0748282eda7442cb90de95c69fe1b14238cdce763e57 |
| 20261019_verify_shop_supplier_platform_v2_funding_boundary.sql | e6a5e8c3d2f5e1c13cca5a8c825bd34b1e6262de08cd04030b1b0749398e2340 |

本轮恢复引用为 refs/codex-backups/supplier-platform-2-p2a-20261019-final。最终恢复提交号、基线、完整变更文件清单、原索引/工作区状态及逐文件读回结果保存在 /tmp/supplier-v2-p2a-recovery-20261019.json；仅当该清单的 readback_verified 为 true 时才表示该快照已经核验。快照使用独立临时 Git 索引，不改变当前分支、HEAD、真实暂存区或工作文件；P0/P1 的恢复引用继续保留。

当前产物仍是未提交的本地实现及恢复快照，未推送或部署。下一步按第 3 节由用户执行并保存两份 SQL 的实际输出，再推进可信报价与原生结算接线。即使结构核验通过，采购创建和自动交付仍需各自的实现与证据，不能据此打开销售。


## 9. 2026-10-19 用户执行反馈与 P2B 接线（追加）

用户本轮再次反馈「已执行 sql，继续下一步」。记录为 P2A SQL 已由用户报告执行，未提供目标环境和原始输出；上文 NOT RUN 保留为 P2A 交付时点记录，不能改写为已独立验证数据库结构或事务。

P2B 已在本地接入可信报价、原生积分/游客创建及到账处理，并隔离库存 worker、延后供货奖励、保持成本利润未知。第 4 节“尚未接线”是 P2A 时点的事实；后续实现与证据追加记录在 [P2B 原生结算衔接手册](shop-supplier-platform-2.0-native-checkout-runbook.md)。P2A 的 990 项是历史结果，当前 P2B 回归为 117 文件 / 1,217 项全部通过，两者不相加、不互相替代。

本轮只交付新增 native_checkout 迁移及只读 verify。没有执行 SQL、启用 checkout 策略或发起采购，outbox 继续 blocked；采购、交付、退款执行器和运营入口仍未完成，数据库事务/并发与商户验收继续为 NOT RUN。
