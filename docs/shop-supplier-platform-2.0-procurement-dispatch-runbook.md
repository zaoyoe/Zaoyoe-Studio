# 商城供应商 2.0：P2C 采购提交与未知结果核对

记录日期：2026-10-19。承接用户「继续下一步」，本轮只实现持久采购协议、可注入的服务端协调模块和资金操作保护。未连接数据库或执行 SQL、未使用真实商户凭据、未发起采购、未推送、未部署、未调整 8000 预览。P0/P1/P2A 的执行沿用此前用户报告；**尚未收到 P2B 新迁移和 verify 的执行确认**，不推断数据库已应用。

## 1. 本轮交付与未完成范围

新增每采购意图唯一的 attempt、冻结原请求/账号/规格/人民币成本上限、准备与提交租约、原请求查询租约、脱敏事件及私有 RPC。JS runner 按 prepare → 检查适配器 → begin 明确确认 → 一次 create → record 调用；恢复模式只有 query，没有再次 create 的分支。

当前两个适配器都不满足这份采购契约。虾仁仍是目录/规格/库存/询价只读；16688 的原采购能力也不代表具备 V2 原请求恢复和成本上限保证。没有给任何账号写入验证证明，没有把 runner 接入 registry、公开路由、服务启动、worker 或定时器。仅应用迁移或配置开关不会开始采购。

**P2 尚未完整闭环。** 采购 accepted 只代表上游受理；本轮没有客户交付、实际成本入账、退款/补偿结案执行器、公共完结说明、采购运营界面或交付后营销结算。积分单买/购物车未知结果跨刷新恢复仍未完成。上述能力及真实商户验证完成前，外采销售应继续关闭。

## 2. 准入契约和暂停边界

两项环境开关默认 false，必须分别控制：

- SHOP_SUPPLIER_DISPATCH_V2_ENABLED：允许协调模块申请新提交。
- SHOP_SUPPLIER_RECONCILE_V2_ENABLED：允许协调模块核对原请求。未来接线时可在停止新销售/新提交后继续核对；本轮没有运行入口。

数据库新策略 dispatch_enabled 也默认 false，必须同时通过已有 intake_enabled、checkout_enabled、资金占用、单件 CN、未退款/未交付、冻结映射版本及成本预算检查。提交前重新核对原生订单买家、SKU、商品价及手续费分离后的实付；资金事实不符不能发请求。

验证证明绑定具体账号、provider、credential_ref、契约摘要、证据摘要、验证者、验证时间与期限。准入须独立证明：原请求 ID 查单、唯一不可变请求键、明确拒绝后该键不可能再受理、原子人民币成本上限。运行适配器必须精确实现以下全部字段，额外/缺失语义均不授权：

```json
{"version":"shop-supplier-dispatch-v1","requestLookup":"original_request_id","requestKey":"unique_immutable","rejection":"request_key_final","costCeiling":"atomic_cny_max","currency":"CNY","responses":"identity_bound_nonsecret"}
```

契约 SHA256：4b6dbbf3491c950baeb4860d85128dcd2493ff4a1d61490a0c02892864fb9cae。

原请求记录冻结账号 ID/provider/credential_ref。后续 resolver 必须据此解析原账号；不能因为当前映射、销售开关或证明过期而换账号/换源查询。密钥轮换应使用新的 credential_ref，并保留未决请求所需旧引用；不得覆盖引用后假装仍使用原凭据。本轮没有更改任何凭据或轮换流程。

商户仍需核验请求字段、币种、原请求恢复、拒绝终局性、成本控制与交付证据。虾仁资料中的 request_no/tradeNo、status=1 或 secret 字段均不足以自动证明这些条件；不得把 paid、等待发货文本或查无结果当成功交付/明确未受理。本轮没有获得新的官方商户证据。

## 3. 状态、租约和结果语义

| 状态/动作 | 本轮代码行为 | 后续允许动作 |
| --- | --- | --- |
| not_submitted → prepared | 同事务锁原生订单、资金单元、账号策略、意图和 attempt；冻结请求并持久准备租约 | 明确 begin 确认后才可发出请求 |
| prepared 租约到期 | 未 begin 的准备可以重领；沿用同一 attempt 和原请求 ID | 不换账号/规格/请求键 |
| prepared 超过总期限 | 转 review，撤销准备令牌，request_started_at 仍为空 | 后续专门结案；不伪造提交或自动释放预算 |
| begin → dispatching | 写入提交状态和时间后才返回明确 applied=true；相同 begin 不再返回提交授权 | 单次 create；响应丢失则查原请求 |
| begin ACK 丢失/截断/报错 | runner 不发送 HTTP；即使数据库可能已经提交也不重新 begin 后补发 | 等租约结束后 query；可能牺牲自动进展 |
| outcome_unknown / not_found / timeout | 保留资金风险占用，只申请原请求 query | 有限核对或人工复核；不重新采购/切源 |
| accepted | 身份、订单号及证据摘要符合才记受理，outbox 为 awaiting_delivery | 后续独立交付核验；不发卡、不记实际成本 |
| rejected | 原请求和账号身份匹配，必须是已验证契约下的最终明确未受理证明 | 后续专门结案；本轮仍不自动退款/释放预算 |
| review | 查询耗尽、期限到达、上游订单号冲突等需人工核对 | 本轮没有强制退款/重发/完结入口 |

准备租约 30 秒、提交租约 120 秒、查询租约 60 秒。最多领取 12 次查询，从首次 prepare 起 24 小时总期限；查询间隔按 30 秒指数退避，上限 1 小时。租约是数据库领取边界，不是 HTTP 取消保证；暂停的旧进程仍可能稍后返回，必须由原请求契约和结果令牌共同约束。当前没有后台任务自动推进这些时间。

record 必须使用当前令牌，旧/过期令牌不能覆盖结果。同令牌同内容摘要重放返回已记录结果；不同内容冲突。accepted 在同账号内不能复用另一意图的上游订单号。持久记录只包含白名单结果与摘要，不保存原始响应、错误详情、凭据或卡密；未知结果不计算真实成本。

## 4. 资金保护及管理端提示

所有 dispatch RPC 先锁原生订单，再锁资金单元、策略、意图和 attempt；prepare/begin 同事务增加原生 supplier_dispatch_version。该设计用于与退款写入串行化，并让过期 REPEATABLE READ 退款快照失败；**实际数据库事务/并发尚未运行验证**。

已有任何 attempt 后，普通原生退款/关闭和关键金额、数量、买家、支付/交付状态变更被 guard 拒绝。包括仅准备过和已明确 rejected 的任务：本轮不提供预算释放/退款闭环，必须留给后续独立结案事务，避免绕过证据、资金与售后校验。

积分退款和游客后台写操作将 supplier_dispatch_resolution_required 映射成 HTTP 409 与明确中文说明，告知不能直接退款/关闭、当前版本尚未开放采购结案入口、查无结果或超时不等于未受理。拒绝后不写成功审计、成功通知或利润回写。该提示不表示已经存在采购处理工作台。

关闭新提交不应关闭未来的原请求核对。已受理、未知、拒绝和人工复核记录均保留风险占用，实际成本保持 NULL；本轮没有自动扣成本、发放权益、发卡或退钱的路径。

## 5. SQL 前置条件与用户手动顺序

只审核/应用目标环境尚未应用的新阶段，不能为省事重放整套旧迁移。P2B 未确认时先核对这两份文件的执行记录：

1. /Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/migrations/20261019_shop_supplier_platform_v2_native_checkout.sql
2. /Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/migrations/20261019_verify_shop_supplier_platform_v2_native_checkout.sql

P2B 结构确认后，再由用户审核并顺序执行本轮新文件：

1. /Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/migrations/20261019_shop_supplier_platform_v2_procurement_dispatch.sql
2. /Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/migrations/20261019_verify_shop_supplier_platform_v2_procurement_dispatch.sql

迁移包含 BEGIN/COMMIT、原生列/前置函数检查、私有表、RLS、不可变字段和原生订单保护触发器、RPC 授权及 PostgREST schema reload。字段或前置结构不符会失败回滚；不要删检查或覆盖旧函数来绕过。没有写商户证明或启用开关。

verify 在只读事务内检查结构、权限、默认值、唯一约束、启用触发器、协议锚点及已有数据的一致性；若已有启用策略/证明，会拒绝把活跃环境当默认关闭切片通过。预期成功结果：

> Supplier P2C dispatch structural/default-off checks passed; database transaction/concurrency/business/merchant acceptance remains NOT RUN

该结果不等于采购、交付、退款、数据库并发或商户验收通过。Codex 没有执行迁移、只读 verify 或 SQL 测试 fixture。

## 6. 实际数据库与业务验收：NOT RUN

下表需要另行授权和独立证据；mock、源码锚点及纯解析不能替代：

| 验收 | 预期 |
| --- | --- |
| 无证明、关闭策略、错账号/映射版本/资金归属或成本超限 | 不授权 begin、不发 HTTP、不改变真实资金事实 |
| 多执行进程竞争 prepare/begin、事务回滚与提交 ACK 丢失 | 同意图最多一次有效发送授权；ACK 未明确收到时不发送 |
| 提交前崩溃、提交后崩溃、HTTP 迟到/丢失与租约过期 | 已提交状态仅核对原请求，不重复 create；旧令牌不能覆盖 |
| 仅准备未提交且持续失联 | 到总期限后 review，无伪造提交、退款或预算释放 |
| 当前销售/账号/映射关闭或证明过期 | 停止新提交，仍可用冻结原账号查询未决任务 |
| 查无结果、超时、错误币种/金额、paid/等待文本 | 不推断未受理或交付，不释放风险预算 |
| 明确受理/拒绝、重复/冲突结果、上游单号复用 | 证据和身份匹配，幂等不重单；冲突进入复核 |
| 退款/关闭与 prepare/begin 并发，包括 REPEATABLE READ | 不出现已授权采购又普通退款；异常事务完整回滚 |
| 日志、事件、管理员错误、跨账号查询 | 无凭据、卡密、原始响应泄漏或串单 |
| 交付、退款、成本、奖励与公共说明 | 尚无执行器，不能作为本轮通过项；留待 P2D |

## 7. 本地验证与来源记录

本轮本地回归为 **119 个文件 / 1,285 项测试，1,285 PASS、0 FAIL、0 SKIPPED、0 CANCELLED、0 TODO**。包含供应商协调模块与静态 SQL 契约、管理员积分/游客订单退款保护、既有游客购买、购物车、钱包和历史 promo archive 契约。38 个已改动或新增 JS 文件语法检查通过，已跟踪及 29 个未跟踪源文件的空白检查通过。完整工作区清单为 54 个文件，包含前序各阶段尚未提交的工作。

离线纯解析通过 8 份供应商迁移/verify 和 7 个按源码重建的原生函数；23 个原生补丁锚点逐项匹配。P2C migration 为 41 个 SQL 语句 / 4 个 PL/pgSQL 块，verify 为 5 个语句 / 1 个块。解析器没有连接数据库或执行 SQL，不能证明数据库列、锁行为、事务回滚或商户语义实际可用。

首轮回归为 1,284 PASS / 1 FAIL：本轮新增 guard 契约仍要求积分单存在 status 字段，与已核对的真实原生表不符；只移除了该错误字段要求，保留实际 refund_status / delivery_status 及独立的禁止引用不存在字段断言。首轮日志和报告另存，既有历史 archive 测试未删除或放宽。新增未跟踪文件空白检查的首轮工具报告也保留；其误把 git diff --no-index 的普通差异退出码 1 当错误，已用干净/尾随空格临时文件确认退出码及诊断规则后修正工具，未改动前序源文件来迁就检查。

**数据库实际应用/事务/并发、完整业务、真实商户、浏览器联调、生产部署及销售启用均为 NOT RUN。**

本轮增量文件：procurement.js、P2C migration/verify、两份 procurement 测试、本手册；扩展 .env.example、order-status.js、积分退款 helper、游客后台错误映射及两份既有 handler 测试。计划第 20 节已追加本轮状态，保留 P0/P1/P2A/P2B 历史记录。完整当前工作区清单包含此前全部阶段，详见收尾源码与恢复清单。

- 分支：codex/shop-supplier-platform-2。
- 唯一远端：https://github.com/zaoyoe/Zaoyoe-Studio.git。
- 本轮编辑前 fetch，HEAD / origin/main 均为 e9db00863fddaaab782c00aef14bb1bd21040314，HEAD..origin/main 为 0。
- P2B 恢复提交 07fb63dcfea57a34469899038d120b37fc2370ce（refs/codex-backups/supplier-platform-2-p2b-20261019-final）继续保留；不覆盖或删除此前恢复引用。
- P2C 恢复引用：refs/codex-backups/supplier-platform-2-p2c-20261019-final；实际提交身份、逐文件读回结果及真实索引/HEAD/工作区不变证据见 /tmp/supplier-v2-p2c-recovery-20261019.json，以该清单 readback_verified=true 为核验依据。临时索引快照不是发布提交。

本地证据路径：

- /tmp/supplier-v2-p2c-regression-20261019.json 与 .log：最终完整回归；日志 SHA256 为 6f7ab481aa556b1a7c54cddc868b9f47ee6db5484ff8e93a9df487bede1587dd。
- /tmp/supplier-v2-p2c-regression-20261019-initial.json 与 .log：原始失败证据，日志 SHA256 为 3481b5c73ab3ca21b4bc2598aaef53c121d81b2d0aa92492275df57cd3a421d9。
- /tmp/supplier-v2-p2c-sql-parse-20261019.json 与 /tmp/supplier-p2c-patch-replay.json：纯解析和原生源码锚点回放。
- /tmp/supplier-v2-p2c-source-checks-20261019.json：54 个源文件及哈希、38 个 JS 语法结果、已跟踪和未跟踪文件空白检查；初版检查工具记录另存同名 -initial.json。
- /tmp/supplier-v2-p2c-recovery-20261019.json：恢复提交、完整文件清单和读取校验。历史 P2B 的测试、失败记录与恢复引用继续保留。

待用户执行的新 SQL 内容摘要：

| 文件 | SHA256 |
| --- | --- |
| 20261019_shop_supplier_platform_v2_procurement_dispatch.sql | b7ee6e16281f18d387526cd37dd6ed337b5194d17b7022c1371c08ba1ecb15e6 |
| 20261019_verify_shop_supplier_platform_v2_procurement_dispatch.sql | 8072de9d74b09ccfd2ae8b1b3298bab32cc156d5142252b25a1e02da7d8d30d4 |

上述证据仅对应本地工作树；推送或发布前仍须按 AGENTS.md 重新同步最新 main、形成干净且完整的候选提交、审查发布清单并归档证据。

## 8. 后续 P2D

补独立交付凭据、持久加密卡密及归属、真实成本、退款/人工结案和风险释放事务、公共完结说明与 Admin Studio 采购处理入口；核验后才发放原生权益。先补积分未知结果跨刷新恢复，再做两种购买路径端到端与故障验收。

真实上游采购仍待商户准入证据与适配器实现。自动 worker、代理 API、第二渠道自动切换均未开放，不以本轮结构结果、测试数量或部署结果替代启用审批。

## 9. 2026-10-21 真实采购探针证据（虾仁 CNY）

用户授权以尽量小额商品做一次真实付款测试，并确认虾仁报价以人民币为单位、账户余额已充值 10 元。探针脚本为 `scripts/probe-xiareng-purchase.js`（默认 dry-run，`--execute` 才真实下单，硬上限 ¥5 / 5 件，不打印密钥、签名或卡密）。

实际执行（一次真实扣款，¥0.16）：

```
node scripts/probe-xiareng-purchase.js --goods 2E4ED4E08F9B9210 --qty 1 --max-cny 1.00 --execute --replay \
  --out /tmp/xiareng-probe-evidence.json
```

商品：`2E4ED4E08F9B9210`（Outlook 斯洛伐克号，报价 ¥0.16，最小量 1，库存 16382）。

| 观察项 | 结果 | 结论 |
| --- | --- | --- |
| `/shared/commodity/trade` 首次调用 | `code=200`，`tradeNo=778217796203351836`，`amount="0.16"`，`secret` 516 字节且不像等待发货占位文本 | 下单成功并即时交付 |
| 同 `request_no` 重放 | `code=0`，`msg="The request ID already exists"`，不返回原单、不二次扣款 | 请求键不可变、可防重，但**不能找回原单** |
| `/shared/commodity/valuation` 语义 | `num=1→0.16`、`num=2→0.32`、`num=3→0.48` | `price` 是**总价**，不是单价 |
| `amount` 与报价 | 完全一致（0.16 = 0.16） | 币种为 CNY（与用户确认一致） |
| `/shared/commodity/query` | `code=200`，`status=1`，返回 `secret/widget/status` | 只按 `tradeNo` 查单，返回内容不含金额 |
| 库存 | `trade` 响应回 16382，但随后 `/shared/commodity/item` 详情变为 16381 | 库存确实随单减 1；`trade` 响应里的 `stock` 字段是下单前快照，不能当交付判据 |

### 9.1 对现有契约的直接影响（未通过，非结构测试可弥补）

| 契约项 | 现值 | 真实 API | 结果 |
| --- | --- | --- | --- |
| `requestLookup` | `original_request_id` | 无按 `request_no` 查单的接口，重放只回 `already exists` | **无法满足** |
| `costCeiling` | `atomic_cny_max` | `trade` 无金额上限参数 | **无法满足** |
| `delivery.cost` | `final_actual_cny`（由查单取得） | 查单不返回金额，金额只在 `trade` 响应里 | **无法满足** |
| 请求幂等 | `unique_immutable` | `request_no` 唯一且重放被拒 | 满足 |
| 拒绝终局性 | `request_key_final` | `code=0` 业务错误即无单无扣款 | 满足 |

因此 `fn_shop_supplier_dispatch_v2` 的 `request_lookup_verified` 与 `atomic_cny_ceiling_verified` 对虾仁**永远无法置真**：`SHOP_SUPPLIER_DISPATCH_V2_ENABLED=true` 也不会放行，属于设计层面的阻断，而不是开关没打开。

### 9.2 本轮代码状态

- `server/integrations/suppliers/xiareng/client.js`：`quotePrice` 的 `amountBasis` 由 `unverified` 升为 `total_cny`，默认币种为 `CNY`；新增 `createPurchase`/`queryPurchase`（含报价封顶前置校验、金额事后校验、`already exists` 判为 outcome unknown）；`capabilities.procurement` 仍为 `false`，并新增只读 `procurementProfile` 记录已验证事实。
- 测试：`tests/shop-supplier-xiareng-client.test.js` 新增 6 条采购路径用例；`node --test tests/shop-supplier-*.test.js tests/admin-shop-supplier-*.test.js` 为 **467 pass / 0 fail**。

### 9.3 明确未运行

真实 dispatch、delivery、worker、Admin 对账界面、端到端用户下单均 **NOT RUN**。适配器能力标志保持关闭，未因探针成功而启用任何开关。

## 10. 2026-10-21 人工受控采购（方案 B）操作手册

记录日期：2026-10-21。用户明确选择方案 B：**先做人工受控采购**，即由管理员在 Admin Studio 逐笔触发「取实时报价 → 看清人民币金额 → 明确确认 → 单次真实下单 → 封存卡密 → 交付」，**不启用自动 dispatch worker**。

本节与 §1–§9 的关系：§9 的探针结论（虾仁无「按原请求查单」、无「原子金额上限」）使自动 dispatch 的 `request_lookup_verified` / `atomic_cny_ceiling_verified` 永远无法置真，因此自动链路在虾仁上属于设计层面阻断。方案 B 绕开该阻断，改为「人看金额、人确认、单次请求、请求键不可变」，用运营确认替代机器可验证的成本上限。

### 10.1 边界（本轮明确不做）

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| `SHOP_SUPPLIER_DISPATCH_V2_ENABLED` | 保持 false | 自动提交链路不打开 |
| `capabilities.procurement`（虾仁适配器） | 保持 false | 人工路径直接调用适配器方法，不经过 dispatch 闸门 |
| `shop_supplier_transaction_policies.dispatch_enabled` | 保持 false | `fn_shop_supplier_manual_context_v2` / `_confirm_v2` 只检查 `intake_enabled` + `checkout_enabled`，不检查 dispatch |
| 后台 worker / 定时器 | 不安装 | 无自动推进；所有状态推进都由管理员点击驱动 |
| 代理开放 API、第二渠道自动切换 | 不开放 | 见 §8 |

人工采购不是「放松校验」：`_confirm_v2` 仍然逐项核对资金单元 `funding_state='funded'`、原生订单买家/SKU/金额/退款/交付一致性、意图 `status='not_submitted'`、`exposure_status='held'` 且 `reserved_cost_cny = cost_ceiling_cny`、映射版本 `updated_at = mapping_revision`、账号 provider 一致、`cost_ceiling_cny <= per_unit_cost_ceiling_cny`。任何一项不符即 `blocked`，且不会发出请求。

### 10.2 开关与前置

1. 服务端环境变量：`SHOP_SUPPLIER_MANUAL_PURCHASE_ENABLED=true`（默认 false）。未打开时 handler 返回 503 `supplier_manual_disabled`，前端提示「人工采购尚未启用」。
2. 卡密封存依赖：`SHOP_SUPPLIER_DELIVERY_V2_ENABLED=true` + `SHOP_SUPPLIER_DELIVERY_KEYS` + `SHOP_SUPPLIER_DELIVERY_ACTIVE_KEY` + `SHOP_SUPPLIER_DELIVERY_FINGERPRINT_KEY`（各 ≥32 字符、互不相同）。封存失败时采购记 `unknown`（`supplier_delivery_seal_failed`），**不重试下单**。
3. 数据库侧：`shop_supplier_accounts.is_enabled`、映射 `is_enabled/is_primary/contract_version=2`、策略 `intake_enabled` + `checkout_enabled`。三者缺一即 `blocked`。
4. 商品侧：`shop_products.is_active=true` 且有可用 SKU 价格；打开商品属于**独立审批动作**，不随部署发生。

### 10.3 状态机

表：`shop_supplier_manual_purchases`（每意图唯一，`intent_id UNIQUE`），事件表 `shop_supplier_manual_purchase_events`（append-only，带 immutability trigger）。

| state | 含义 | 是否已扣款 | 允许的下一步 |
| --- | --- | --- | --- |
| `quoted` | 已记录实时报价，120 秒内有效 | 否 | `confirm`（金额必须与报价完全一致）；超时自动转 `expired` |
| `confirmed` | 已认领报价并发出单次 trade 请求；可能已带上游单号 | 是（或结果未知） | 自动进入 `accepted`/`unknown`；若进程中断，用 `finalize` 补入账 |
| `accepted` | 上游受理、卡密已封存、交付回执已写 | 是 | 终态；用户端可见交付 |
| `unknown` | 扣款结果不确定、卡密缺失或封存失败 | 可能是 | 人工核对上游；**不得重新采购** |
| `rejected` | 上游明确未受理 | 否 | 终态；仍需独立结案/释放预算 |
| `expired` / `abandoned` | 报价过期 / 人工放弃 | 否 | 重新报价（新 attempt） |

报价窗口固定 120 秒（`quote_expires_at = quoted_at + INTERVAL '120 seconds'`）。`confirm` 使用 CAS（`state='quoted'` → `confirmed'`），双击或并发只有一个调用拿到 `claimed=true`，其余返回 `manual_purchase_not_quoted`。

### 10.4 管理员操作步骤

入口：Admin Studio → 商城 → 供应商运营 → 采购记录行内的「人工采购」按钮。仅当 `procurementState='not_submitted'`、`deliveryState='awaiting_acceptance'` 且存在合法 `intentId` 时渲染。抽屉为侧栏样式，支持点击遮罩关闭。

1. `action=context`：读取该意图的采购上下文。`status='ready'` 才可报价；`blocked` 时按 §10.5 的原因码处理。
2. `action=quote`：服务端向上游取实时报价（`quotePrice`，数量固定 1），校验 `currency=CNY` 且金额格式合法后写入 `quoted`，并回显 `quotedAmountCny`、`costCeilingCny`、`quoteExpiresAt`、`overCeiling`。**此步不动钱**。
3. 管理员在抽屉里看到精确金额与倒计时，点击「确认采购」（必须带 `confirm: true`，否则 400）。
4. `action=confirm`：服务端 CAS 认领 → 用意图的不可变 `original_request_id` 作为 `request_no` 发一次 `createPurchase` → 立即 `stage` 持久化上游单号与实付金额 → 取卡密 → 封存 → `record` 写交付回执。返回 `delivered` 或 `quarantined`。
5. 若上一步返回 `unknown` 或进程中断，抽屉会展示 `canFinalize`，管理员点「完成入账」触发 `action=finalize`：只按已存的上游单号重取卡密并封存，**不会再下单**。

### 10.5 阻断原因码对照

| reason | 中文提示 | 处理 |
| --- | --- | --- |
| `manual_purchase_accepted` | 这笔采购已由上游受理 | 无需再采购，去看交付状态 |
| `manual_purchase_unknown` | 上次采购结果待核对 | 先核对上游，再决定 finalize 或人工结案 |
| `manual_purchase_in_progress` | 上一次采购正在提交 | 稍后刷新 |
| `intent_not_submitted` | 意图状态不符 | 核对是否已被其他流程处理 |
| `funding_not_ready` | 资金未到位 | 核对支付/退款状态 |
| `exposure_not_held` | 风险占用与成本上限不一致 | 核对 `reserved_cost_cny` |
| `native_not_ready` | 原生订单状态不符（已交付/已退款/数量≠1/金额不符） | 先处理原生订单 |
| `policy_not_ready` | 账号策略或单件成本上限不满足 | 检查 `intake_enabled`/`checkout_enabled`/`per_unit_cost_ceiling_cny` |
| `mapping_not_ready` | 映射已变更或被停用 | 刷新映射，必要时重新导入 |
| `account_not_ready` | 供应商账号未启用或 provider 不符 | 检查账号配置 |
| `scope_unsupported` | 非 CN 站点或数量≠1 | 当前仅支持单件 CN |
| `quote_expired` / `quote_amount_changed` | 报价过期或金额变化 | 重新报价 |
| `cost_ceiling_exceeded` | 报价高于成本上限 | 不允许下单，人工复核定价 |

### 10.6 审计与不可变证据

- `shop_supplier_manual_purchase_events`：`quoted` / `quote_expired` / `confirmed` / `submitted` / `accepted` / `unknown` / `rejected`，`detail` 只存金额、状态、证据摘要（`evidenceHash`，sha256 64 hex），**绝不存卡密、凭据、签名或原始上游响应**。
- 事件表有 immutability trigger，写错无法修改；这是权威审计，前端 `writeAdminAuditLog`（`shop.supplier.manual_purchase`）只是辅助，失败也不影响已提交的采购结果。
- 两个表对 `PUBLIC/anon/authenticated/service_role` 全部 REVOKE，仅 `service_role` 有 SELECT，写只能通过 `SECURITY DEFINER` 函数。

### 10.7 本轮验证结果与 NOT RUN

已运行：

| 项目 | 结果 |
| --- | --- |
| 迁移 `20261021_shop_supplier_platform_v2_manual_purchase.sql` + `..._manual_purchase_stage.sql` | 已在项目 `mmkugdibsaeoevliebzk` 执行（用户授权） |
| 结构验收 `supabase/acceptance/20261021_supplier_manual_purchase_structural_check.sql` | 13 项结构检查 PASS（**仅结构**） |
| `tests/shop-supplier-*.test.js` + `tests/admin-shop-supplier-*.test.js` | 492 pass / 0 fail |
| `tests/admin-shop-supplier-manual-purchase-ui-contract.test.js` | 9 pass |
| `tests/admin-shop-supplier-manual-purchase.test.js` | 14 pass |
| 抽屉亮/暗双主题视觉 harness | 6 个状态渲染正常（骨架/未取价/已报价/已受理/已阻断/错误） |
| `node --check js/admin-shop.js` | OK |

NOT RUN（不得写成 PASS）：

- 真实端到端：用户下单 → 后台人工采购 → 扣款 → 卡密封存 → 用户端可见。**尚未执行**。
- 并发双击 `confirm`、崩溃后 `finalize`、上游超时/未知结果的真实恢复路径。
- 可售商品的打开与定价（`import_shop_supplier_draft_v2` + 映射启用 + `is_active`）尚未执行，需用户单独同意。
- 未推送、未部署、未打开任何开关、未启用任何商品。

### 10.8 与自动 dispatch 的关系

方案 B 不改变 §1–§3 的自动契约，也不替代它。将来若上游补齐「按原请求查单 + 原子金额上限」，可再评估自动 dispatch；在此之前，人工采购是唯一被允许的真实扣款路径，且每次扣款都必须有管理员当次确认。自动 worker、代理 API、第二渠道自动切换仍未开放。
