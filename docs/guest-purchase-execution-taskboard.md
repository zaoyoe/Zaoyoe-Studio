# 游客现金直付购买：任务 1.0 看板（已冻结）

> 目标：在不破坏现有登录用户积分购买链路的前提下，为商城增加“游客下单 -> 现金支付 -> 异步回调 -> 自动发货 -> 安全取货”的独立通道。
>
> 适用范围：本项目 `/Volumes/chao/AI/xianyu_profit_calculator`。
> **2026-09-14 起执行合同改为** [`docs/guest-purchase-task-2.0.md`](./guest-purchase-task-2.0.md)。本文件只保留 1.0 证据，不再作为后续执行源。

## 0. 进度口径与完成定义

- 任务 1.0 冻结进度：**82%**（数据库闸门已闭环；代码/契约测试完成；真实支付、设备视觉、运营演练仍是阻断项）
- 后续执行与百分比以任务 2.0 为准；2.0 当前总进度 **30%**（A/B/C 完成，20260914 SQL 5/5 PASS，D 因代码未发布和沙箱账号 blocked）。本文件冻结进度仍为 **82%**，不回写 2.0 百分比，不改下方 1.0 checkbox。
- 当前阶段指针：`任务 2.0 / C SQL 已通过 → D 真实支付沙箱矩阵 blocked`
- 进度计算：按阶段完成度加权，不按文件数量计算；数据库、支付、履约和安全验收未完成时不得标记 100%。
- 阶段状态：`[P0-1 数据库闸门完成 / 等待真实运行验收]`（前向迁移、汇总校验、只读 preflight、原子迁移及修正版 postflight 已由用户执行成功；postflight 10/10 均为 `PASS`；游客商品仍未启用；Codex 未连接目标 Supabase）
- SQL 策略：只生成迁移脚本和回滚说明，不由 Codex 执行。1.0 的 20260913 迁移及验证已由用户执行通过，不要重跑。2.0 的 20260914 SQL 已由用户执行，verify 5/5 PASS；详见 [`docs/guest-purchase-task-2.0.md`](./guest-purchase-task-2.0.md) 第 15 节。

### 最终完成标准（满足全部条件后才可标记 100%）

1. 游客入口、服务端价格计算、订单创建、库存预占、支付创建、回调验签、异步履约、取货和异常补偿均已实现。
2. 登录用户原有积分购买、折扣、后台订单和库存流程回归通过。
3. 所有 P0 安全不变量有自动化测试和人工验收证据：未验证最终支付不发货；同一库存不重复发货；前端参数不能改变商品、价格、站点或支付归属；已付款未履约可追踪、可退款、可补偿。
4. CN/INTL 站点、币种、支付渠道和回调路由严格隔离；生产环境不存在 mock 支付履约路径。
5. 后台可观测支付成功未履约、预占超时、回调失败、金额不匹配、退款失败和死信任务，并有处理说明。
6. 真实支付沙箱和低价值灰度商品验证通过，回滚只需关闭游客购买开关，不需要回滚数据库。
7. SQL 迁移已由用户在目标环境执行并回传结果，或明确确认当前阶段不需要 SQL。
8. 最终验收记录、风险清单、运行手册和上线/回滚步骤已归档。

## 1. 任务总览

| 阶段 | 内容 | 权重 | 状态 | 退出条件 |
| --- | --- | ---: | --- | --- |
| P0-0 | 方案冻结与实现契约 | 10% | 已完成 | 现有 schema、RPC、路由、UI、测试边界已确认 |
| P0-1 | 数据模型与迁移脚本 | 15% | 已完成 | atomic preflight 无 BLOCK；原子迁移成功；postflight 全部 PASS |
| P0-2 | 服务端订单、预占和风控 | 20% | 95%（代码/契约测试完成） | 真实数据库并发与限流持久化验收 |
| P0-3 | 支付创建与回调事件 | 20% | 95%（代码/契约测试完成） | 支付沙箱和回调丢失对账验收 |
| P0-4 | 异步履约、取货和退款补偿 | 15% | 90%（代码/契约测试完成） | 真实库存、退款和死信演练 |
| P0-5 | 前端游客购买 UI 与交互 | 8% | 已完成（自动化/静态验收） | 风格一致、移动端可用、回跳不发货 |
| P0-6 | 后台可观测性与运营规则 | 5% | 70%（只读异常列表已完成） | 运行手册、告警阈值、人工审计验收 |
| P0-7 | 测试、灰度、上线验收 | 7% | 35%（自动化完成） | 沙箱、截图、故障演练、低价值灰度和回滚 |
| **合计** |  | **100%** |  |  |

## 2. P0-0 方案冻结与实现契约（1.0 历史阶段，已冻结）

### 2.1 已完成基线

- [x] 梳理商城购买入口、登录限制和 `fn_purchase_shop_item` 积分购买链路。
- [x] 梳理支付创建、支付查询、充值回调和现有支付状态逻辑。
- [x] 梳理库存 `available/reserve/sold` 语义及现有订单字段，确认不直接新增冲突的 `reserved` 状态。
- [x] 梳理商城 UI、购买弹窗、SKU 选择、成功发货展示和移动端适配点。
- [x] 参考独角数卡游客订单、预占、Guest Authorization 和异步履约思路；不复制 GPL-3.0 源代码。
- [x] 形成安全边界：独立现金订单、服务端重算金额、回调后履约、取货凭证隔离、P0 不开放复杂支付/优惠能力。

### 2.2 本阶段已核对证据

- [x] `shop_schema.sql:6-57,131-283` 证明基础 `shop_orders`/`fn_purchase_shop_item` 是积分扣款并立即售卡；后续 `20260523_add_shop_product_skus.sql`、`20260321_add_shop_delivery_pipeline.sql`、`20260612_add_shop_reusable_inventory.sql` 延续 `delivery_status`、`shop_order_items`、`shop_webhook_tasks` 与 `reserve` 状态语义。
- [x] `supabase/migrations/20260321_add_payment_checkout_sessions.sql:1-72` 证明 `payment_checkout_sessions` 绑定积分套餐/用户/RLS，明确排除游客商城；`20260322_harden_payment_creation_entrypoints.sql:266-420` 强制登录创建；`20260322_add_payment_ops_hardening.sql:22-65,487-572` 与 `payment_events` 可借鉴事件审计，但充值 RPC 必须排除 `shop_direct`。
- [x] `api/public.js:58-181,279-300` 确认 scope/route 动态注册；商城路由在 `server/api-handlers/public/shop.js:145-182`，支付路由在 `server/api-handlers/public/payments.js:114-190`。
- [x] `server/api-handlers/public/shop.js:4396-4678` 确认现有 `/api/shop/purchase` 强制 `requireAuthenticatedUser`，使用积分 RPC、登录用户限流和立即返回卡密；`server/api-handlers/public/payments.js:338-494` 确认支付创建/状态/mock 均强制登录。
- [x] `supabase/migrations/20260321_add_shop_delivery_pipeline.sql:6-79,361-408` 确认已有任务锁、重试、死信和 claim RPC，可复用于游客“支付后履约任务”，但不等同于库存预占。
- [x] `shop.html:497-710`、`js/shop-client.js:8042-8140,8614-9070`、`css/shop-page.css` 购买弹窗、SKU、成功展示和移动端样式可复用；游客只增加独立支付/确认状态分支。
- [x] 测试入口为 `npm run test:security`（`node --test --test-force-exit tests/*.test.js`），并已有大量 SQL hardening、支付和商城契约测试可扩展。
- [x] 冻结字段、状态机、接口、错误码、日志脱敏规则和指标命名的实现边界，进入 P0-1。

### 2.3 本阶段退出结论

- [x] 关键表、RPC、路由和 UI 入口均有实际文件/行号依据。
- [x] 游客请求不会进入 `fn_purchase_shop_item` 或折扣积分 RPC。
- [x] 最终采用独立 `guest_shop_orders`，避免 `shop_orders.price_paid/total_price` 积分语义、RLS、退款、返佣和后台统计被现金单污染；后台通过 `guest_order_id`/商户单号只读关联。
- [x] 采用独立 `guest_shop_inventory_reservations`，库存沿用既有 `reserve` 语义，不新增 `reserved` 状态。
- [x] 采用独立 `guest_shop_payment_orders`/`guest_shop_payment_events`；不复用充值 `payment_checkout_sessions`，也不把游客支付混入会自动积分入账/兑换码逻辑的 `payment_orders`。
- [x] 已明确 SQL 迁移边界；在 P0-0 方案冻结阶段没有执行任何 SQL（后续 P0-1 前向迁移及验证已由用户执行并通过）。

### 2.4 本阶段风险与修正

| 风险 | 修正 |
| --- | --- |
| 现有 `user_id` 非空或 RPC 假设已登录 | 先核查所有外键/查询；必要时用独立游客订单表，不强改历史约束 |
| 库存统计将非 `available` 都视为售出 | 沿用现有 `reserve` 语义并核对触发器、统计和释放逻辑，避免新状态词污染 |
| 现金价误用积分价 | 增加独立现金价格快照，服务端按站点/币种计算 |
| UI 改动破坏既有购买路径 | 复用现有弹窗、SKU、成功展示和 CSS token，游客入口只增加状态分支 |
| 参考开源实现引入许可证风险 | 只记录行为和安全原则，不复制代码或 GPL 实现 |

### 2.5 本阶段 SQL

- P0-0：**不需要用户执行 SQL**。
- P0-1：已生成并静态审查以下脚本。下列脚本是交付物；其中前向迁移、基础汇总校验、atomic preflight、atomic 迁移和修正版 postflight 已由用户在目标库执行并通过，回滚脚本仍不执行：
  - `supabase/migrations/20260913_add_guest_shop_cash_purchase.sql`
  - `supabase/migrations/20260913_verify_guest_shop_cash_purchase.sql`
  - `supabase/migrations/20260913_verify_guest_shop_cash_purchase_summary.sql`（只读单结果汇总，适用于 SQL 编辑器只显示最后一个结果面板的情况）
  - `supabase/migrations/20260913_verify_guest_shop_atomic_rpcs_preflight.sql`（只读原子 RPC 前置校验，已由用户执行并通过）
  - `supabase/migrations/20260913_verify_guest_shop_atomic_rpcs.sql`（只读原子 RPC 后置校验，已由用户执行并通过）
  - `supabase/migrations/20260913_rollback_guest_shop_cash_purchase.sql`（仅在没有游客订单时使用）
- 执行顺序：前向迁移 -> 基础汇总校验 -> atomic preflight -> 原子 RPC 迁移 -> atomic postflight。回滚脚本不作为正常上线步骤；只有确认没有游客订单且用户明确要求回滚时才考虑。
- 当前状态：用户已回传基础汇总校验、atomic preflight（8/8 `PASS`）和修正版 atomic postflight（10/10 `PASS`），并反馈原子 RPC 迁移成功；`tables`、`validation_functions`、约束/权限/RLS 均通过，`guest_orders=0`、`non_pending_orders=0`、`enabled_guest_products=0`，`invalid_guest_order_site_currency=0`、`invalid_guest_payment_snapshots=0`、`invalid_guest_reservations=0`、`orphan_payment_events=0` 均为预期值。`REVIEW` 是结构/信息项的人工复核标记，不是失败；当前没有待执行 SQL。
- 当前退出阻断条件：原子 RPC 迁移与修正版 postflight 已由用户执行并通过；后续不得在未完成真实支付沙箱、worker 调度、库存/退款/死信演练、视觉验收和运营审计接线前启用游客商品。若未来执行回滚，必须先确认没有游客订单并由用户操作；正常上线不执行回滚 SQL。

### 2.6 最新验证回传（2026-09-14）

- [x] 用户回传 `20260913_verify_guest_shop_cash_purchase_summary.sql` 的完整 13 行结果。
- [x] 四张游客表、三项基础校验函数均存在；管理员只读 RLS、基础约束/触发器/索引已核对。
- [x] 游客订单、预占、支付记录均为空，`enabled_guest_products=0`；四项数据完整性计数均为 0。
- [x] 明确 `REVIEW` 仅表示需要人工查看结构或信息性计数，不代表失败；基础迁移验收通过。
- [x] 该汇总结果不包含 atomic 新字段、原子 RPC、来源 SKU 依赖检查；后续已由独立 atomic preflight 补齐并通过。

### 2.7 单结果汇总校验补充（2026-09-14）

- [x] 针对 Supabase SQL Editor 批量执行只展示最后一个结果面板的问题，新增只读汇总脚本 `supabase/migrations/20260913_verify_guest_shop_cash_purchase_summary.sql`。
- [x] 汇总脚本将 13 项检查压缩为一个结果集，并对四项数据异常计数自动给出 `PASS/FAIL`；不会写入、更新或删除任何数据。
- [x] 用户已回传完整汇总结果：四项数据异常计数（包括 `orphan_payment_events`）均为 `0`，四张游客表和基础校验函数均存在。
- [x] `REVIEW` 结构项已人工核对为预期状态，不是失败；当前游客订单、预占、支付记录和启用商品均为 `0`。
- [x] 修正汇总脚本中说明字段误用裸文本 `::JSONB` 导致的 `22P02 invalid input syntax for type json`；改为 `to_jsonb(...::TEXT)`，未涉及任何业务表或数据变更。

### 2.7 支付与匿名入口静态审计补充（2026-09-13）

- [x] 确认现有 `server/api-handlers/public/payments.js` 的 create/status/mock 入口均要求登录；`api/_lib/payments/orders.js` 绑定积分套餐、`payment_checkout_sessions`、旧 `payment_orders` 和 `rechargePointsForPayment`，游客不得复用。
- [x] 确认 ZPay、虎皮椒、NOWPayments 现有 adapter/webhook 带有登录用户、checkout session、积分充值 metadata，成功分支会充值积分；游客必须使用独立 `shop_direct` adapter/webhook/event/履约分支。
- [x] 确认现有登录商城购买会调用 `fn_purchase_shop_item` 并直接返回库存内容；游客不能进入该 handler、RPC、返佣或积分奖励 follow-up。
- [x] 确认生产 mock provider 及 `autoCredit` 路径必须对游客硬拒绝；回跳只能显示确认中，不能作为已支付或发货依据。
- [x] 确认 `resolveClientIp` 可复用但游客限流不能依赖无持久化时的内存 fallback；生产需持久限流可用，否则下单/取货应 fail-closed 或升级风控。
- [x] 确认匿名 handler 不能直接复用无请求体上限的 `parseJsonBody`；需增加 16-32 KiB bounded JSON reader、plain-object 校验和 413/400 错误。
- [x] 确认站点必须由受信 host/runtime 推导，显式非法 site 应报错而不是静默回退 CN；金额最终核验使用整数分，不能使用现有浮点 epsilon 比较。
- [x] 游客 handler、RPC 迁移和支付 adapter 已实现并通过静态/契约测试；仍需真实支付沙箱与目标环境运行验收。

### 2.7.1 原子 RPC 前置闸门（2026-09-14）

- [x] 新增只读 `supabase/migrations/20260913_verify_guest_shop_atomic_rpcs_preflight.sql`，只返回一个结果集，不创建持久对象、不写入业务数据。
- [x] 前置校验覆盖：四张基础游客表、站点级来源 SKU resolver、商品/SKU 发货与来源字段、游客表空数据、现有游客现金价合法性、旧版含金额参数的 create-order overload 依赖、`gen_random_uuid`/`hashtextextended` 扩展函数。
- [x] 新增只读 `supabase/migrations/20260913_verify_guest_shop_atomic_rpcs.sql` 作为原子迁移后的 postflight，覆盖新增列、来源 SKU 双 `ON DELETE RESTRICT` 外键、强化约束、函数安全属性、service-role-only 执行权、RLS 和数据不变量。
- [x] 原子迁移静态契约测试：`node --test tests/guest-shop-atomic-rpcs-contract.test.js`，`15 passed, 0 failed`；`git diff --check` 通过。
- [x] 用户执行 preflight 并回传结果；8/8 项均为 `PASS` 后才放行原子迁移。

### 2.7.2 最新 SQL 回传判定（2026-09-14）

- [x] 用户再次回传了一份 13 行结果；结果项为 `tables`、`guest_columns`、`guest_constraints`、`validation_functions`、`guest_triggers`、`rls_policies`、`guest_indexes`、`guest_order_counts`、`enabled_guest_products` 及四项数据完整性计数。
- [x] 当时判定该结果仍来自 `20260913_verify_guest_shop_cash_purchase_summary.sql`（基础迁移汇总校验），不是 `20260913_verify_guest_shop_atomic_rpcs_preflight.sql`；该历史判定已由后续正确的 atomic preflight 结果（见 2.7.3/2.7.4）取代，不能再视为当前状态。
- [x] 该结果本身没有新增失败：四张基础游客表存在，游客订单/预占/支付记录和启用商品仍为 0，站点/币种、支付快照、预占和孤儿支付事件计数均为 0；`REVIEW` 仍是结构人工复核标记。
- [x] 已执行只读文件 `supabase/migrations/20260913_verify_guest_shop_atomic_rpcs_preflight.sql`，并回传包含 8 项检查的完整结果。
- [x] preflight 无 `BLOCK` 后才执行 `20260913_guest_shop_atomic_rpcs.sql`；游客商品仍保持关闭，未执行回滚 SQL。

### 2.7.3 原子 preflight 误报修正（2026-09-14）

- [x] 用户回传了正确的 8 项 preflight 结果：除 `site_scoped_source_resolver` 外其余 7 项均为 `PASS`；订单、预占、支付记录仍为空，游客商品仍未启用。
- [x] 复核发现该 `BLOCK` 不能直接证明目标库缺少 resolver：原 preflight 将 `pg_get_function_identity_arguments()`（PostgreSQL 会返回带参数名的 `p_sku_id uuid, p_site text`）与裸类型字符串 `uuid, text` 比较，导致已存在的 `(uuid,text)` 函数也会被误判。
- [x] 修正 preflight 使用 `to_regprocedure('public.fn_resolve_shop_sku_inventory_sources(uuid,text)')` 按真实类型签名检查，并同时输出安全属性；修正 postflight 的函数/权限匹配逻辑，避免同类误报。
- [x] 新增 verifier 契约测试；`node --test tests/guest-shop-atomic-rpcs-contract.test.js`：`15 passed, 0 failed`；`git diff --check` 和 JS 语法检查通过。
- [x] 用户重新执行修正后的只读 preflight 并回传完整 8 项结果；8/8 均为 `PASS`。`site_scoped_source_resolver` 的精确签名、安全定义和固定 `search_path` 均通过；目标库同时存在单参数兼容 overload，未发现依赖。
- [x] 修正后的 preflight 未再出现 `BLOCK`，无需补做 resolver 修复，也未绕过闸门执行原子迁移。

### 2.7.4 目标库 atomic preflight 已通过（2026-09-14）

- [x] 用户回传当前修正版 `20260913_verify_guest_shop_atomic_rpcs_preflight.sql` 的完整 8 项结果，全部为 `PASS`。
- [x] 关键观测：`exact_signature_exists=true`、`security_definer=true`、`search_path_pinned=true`；游客订单、预占、支付记录和启用游客商品均为 `0`；旧版含金额参数 overload 不存在且依赖数为 `0`。
- [x] 用户执行 `20260913_guest_shop_atomic_rpcs.sql`（单独一批）并反馈成功；未启用游客商品。
- [x] 当时执行原版 atomic postflight 并回传完整结果，发现唯一失败为校验规则误报；后续修正版只读 postflight 已由用户重跑并通过（见 2.7.5），游客商品继续关闭。

### 2.7.5 atomic postflight 规则误报修正（2026-09-14）

- [x] 用户回传 atomic postflight 10 项结果：9 项 `PASS`，唯一 `FAIL` 为 `atomic_functions`。
- [x] 根因确认：`guest_shop_normalize_site(text)` 与 `guest_shop_payment_is_final_success(text)` 是无副作用、`IMMUTABLE`、固定 `search_path` 的纯 SQL helper，迁移明确保持 `SECURITY INVOKER`；postflight 却错误要求它们 `SECURITY DEFINER`。
- [x] 已修正 postflight：两 helper 的 `requires_definer=false`，保留 `search_path=public, pg_temp` 和 service-role-only EXECUTE；未修改数据库迁移、未扩大权限面。
- [x] 新增回归契约测试；atomic RPC + 游客全套契约测试 `77 passed, 0 failed`，`git diff --check` 通过。
- [x] 用户已重新执行修正版只读 postflight，10/10 项全部 `PASS`；无需重跑原子迁移，不执行回滚 SQL。游客商品仍保持关闭，等待运行验收。

### 2.8 P0-2 提前完成的纯安全基础（不依赖数据库）

- [x] 新增 `api/_lib/guest-shop/security.js`：严格站点/UUID/数量/幂等键校验、服务端可绑定订单输入、禁止客户端控制字段。
- [x] 新增有上限的原始请求体/JSON 读取：16 KiB 普通游客请求、256 KiB webhook 默认上限、Content-Type/plain-object/UTF-8 校验。
- [x] 新增整数分金额解析、格式化、乘法和精确比较；拒绝浮点指数、三位小数、负数和超安全整数。
- [x] 新增幂等哈希/请求指纹和冲突检测，站点、SKU、数量、币种、价格快照均纳入指纹。
- [x] 新增高熵取货口令生成、独立 pepper HMAC 哈希、版本化存储和常量时间校验。
- [x] 新增 raw-body SHA-256 + 时间戳/nonce/version HMAC 验签，以及支付用途/订单/金额/币种/最终状态绑定校验。
- [x] 新增支付 payload/日志递归脱敏，循环、深度、长度和敏感键/敏感值均有保护。
- [x] 新增 `tests/guest-shop-security.test.js`，8 个测试场景全部通过；该纯安全测试未连接数据库、未执行 SQL，也未改登录积分链路（不影响 P0-1 迁移已由用户执行通过的事实）。

### 2.9 本步风险与修正

| 风险 | 修正 |
| --- | --- |
| 仅有纯函数不能保证库存竞态安全 | 已生成并由用户执行独立 `SECURITY DEFINER` 原子 RPC，且 atomic preflight/postflight 通过；handler 仍禁止直接 update 库存，真实并发验收仍待完成 |
| webhook 若先解析 JSON 会签名失效 | handler 必须先 `readRawBodyWithLimit()`，对原始字节验签后再 JSON.parse |
| 缺少 pepper 时可能误放行取货 | `getGuestClaimPepper` 在生产配置缺失时 fail-closed（503），不回退 service role |
| 现有请求体解析器无大小限制 | 游客路由只允许新 bounded reader，不复用 `admin.parseJsonBody` |

## 3. P0-1 数据模型与迁移脚本（已完成）

- [x] 已决定新增 `guest_shop_orders`，不改造积分订单主状态；后台增加只读关联视图/查询。
- [x] 设计 `guest_shop_orders` 字段、状态约束、站点隔离、幂等键、取货凭证哈希和订单过期语义。
- [x] 设计 `guest_shop_inventory_reservations` 字段、唯一约束、`available -> reserve -> sold` 及超时释放条件。
- [x] 设计 `guest_shop_payment_orders`/`guest_shop_payment_events` 字段、用途、金额币种、provider 单号、事件幂等和回调原文脱敏存储。
- [x] 增加/确认商品游客开关、独立现金价、支付渠道白名单、最大数量和发货类型约束。
- [x] 增加后台只读关联视图/索引，不让游客表进入现有积分退款/返佣 RPC。
- [x] 增加支付事件原文存储、签名验证结果、处理状态、重试次数、死信信息和脱敏策略。
- [x] 生成前向迁移、回滚迁移、数据校验 SQL，并完成静态约束/权限审查；前向迁移及验证脚本已由用户执行并通过，回滚脚本仍不执行。
- [x] 用户已执行前向迁移并反馈成功；未执行回滚。
- [x] 原子 RPC 迁移完成第二轮 fail-closed 加固：来源 SKU 必须存在、同商品且 active；resolver 结果不得静默丢失配置来源；默认库存行保留实际逻辑来源 SKU；reservation 来源快照增加 `ON DELETE RESTRICT` 外键；现金 NUMERIC 拒绝 NaN/Infinity、超范围和非两位小数；provider/channel/fingerprint/order reference 有格式和长度边界。
- [x] 原子下单 RPC 的游客支付渠道白名单改为 fail-closed：空/非数组/空数组拒绝；每项必须是合法字符串 token，拒绝 `mock`/`test`/`fake`；仅允许 provider、channel 或 `provider:channel` 精确匹配。
- [x] 新增/扩展静态契约测试覆盖上述来源、默认库存、外键、金额、支付标识和渠道白名单边界；原子 RPC + 支付适配器契约测试当前 22/22 通过。
- [x] 已完成游客支付适配器与 webhook 精确金额边界测试：NOWPayments `actually_paid` 拒绝指数、负数、NaN/Infinity、少付和非法精度；等价金额与尾随零通过。
- [x] 用户已执行修正版基础汇总验证 SQL，并回传完整结果；结构人工复核和数据异常计数均通过。
- [x] 用户执行只读 atomic preflight，并回传完整 8 项结果；8/8 均为 `PASS`。
- [x] 用户已单独执行 `20260913_guest_shop_atomic_rpcs.sql` 并反馈成功。
- [x] 用户执行修正版 atomic postflight 并回传完整结果；10/10 均为 `PASS`，游客商品尚未启用。
- [x] 运行时配置与共享入口最终收口：严格拒绝非法数值/secret/body limit；共享 Express 路由在专用 worker secret 校验前跳过全局 JSON/urlencoded parser，避免未认证大请求造成内存 DoS。
- [x] KVM4 worker 调度器交付：新增 loopback、无请求体的 systemd service/timer、最小权限属性、默认不启动的安装脚本及 scheduler contract tests；真实 KVM4 安装/启动仍属于 P0-7 环境验收。
- [x] 修正 scheduler installer 根目录契约：`--root`/非 canonical `KVM4_ROOT` 现在 fail-closed；安装前校验 unit 的 `ConditionPathExists`/`EnvironmentFile` 均指向 `/opt/zaoyoe-verify-server`，并补充拒绝覆盖参数的契约测试和运行手册说明。
- [x] 静态检查通过：目标 JS 文件 `node --check` 全部通过，`git diff --check` 通过。
- [x] 回归证据：`node --test tests/guest-shop-*.test.js tests/request-security.test.js tests/admin-shop-guest-orders-handler.test.js tests/admin-shop-guest-orders-ui.test.js`，`135 passed, 0 failed`；共享路由/raw-body/worker 子集 `20 passed, 0 failed`。

### 2.10 本步审计结论与实现门（2026-09-13）

- [x] 完成对游客草案的独立 P0 安全审计，确认以下问题在修复前不得上线：支付适配器未注入、回调签名协议错误、原始 body 不可恢复、重复事件 500、客户端可指定取货口令、空渠道白名单放行、第三方下单未知结果无补偿、确认后没有履约 worker、领取接口缺少持久化风控。
- [ ] 在所有阻断项有代码和测试证据前，P0-2/P0-3 不得标记完成；本阶段允许先写不依赖数据库连接的适配层和契约测试。
- [x] 原子 RPC 的来源集合、默认库存快照和前置条件已完成静态审计；新增 preflight/postflight 文件。
- [x] 原子迁移已在目标数据库执行成功；修正版 postflight 的约束、函数、权限、RLS 和数据不变量 10/10 均通过。

### 2.11 本步执行记录（2026-09-13）

- [x] 修复 webhook 无效签名/金额/订单绑定失败时占用正常业务 `event_key` 的问题：拒绝事件改用 `provider:invalid-body:<sha256>` 命名空间；合法回调仍使用业务键并可确认支付。
- [x] 新增 `tests/guest-shop-webhook.test.js`：覆盖伪造回调先到、合法回调后到，以及伪造重复回调幂等；游客相关 49 项契约/安全测试全部通过。
- [x] 支付创建与早到回调的 metadata/provider reference 合并竞态已加固：持久化创建 lease、provider 引用绑定、未知外部结果转 review 对账，禁止盲目重试造成重复扣款；并发重试契约测试通过。

### 2.12 领取失败审计与并发修正（2026-09-13）

- [x] `recordClaimFailure` 改为有界乐观并发递增：以 `id + claim_attempt_count + last_error_*` 条件更新，最多重试 4 次；并发错误凭证不会静默丢失审计计数。
- [x] 失败计数封顶 20；达到上限后不再写数据库，避免攻击者制造无界写放大；封顶不影响有效凭证领取。
- [x] 领取失败不会保存提交的 secret；已有支付/履约错误码和消息不会被 `guest_claim_invalid` 覆盖，保证运营异常可追踪。
- [x] 新增 `tests/guest-shop-claim-failure.test.js`，覆盖并发递增、错误保留、封顶和有效领取；相关 73 项游客/请求安全测试全部通过。
- [x] 本步没有新增 SQL；复用现有 `claim_attempt_count`、`last_error_code`、`last_error_message` 字段。

### 2.13 本步风险与修正

| 风险 | 影响 | 修正 |
| --- | --- | --- |
| 伪造回调抢占业务事件键 | 合法回调被误判重复，订单无法确认 | 拒绝事件使用独立 raw-body hash 键；合法事件保留业务键 |
| 同一恶意 body 重复投递造成审计膨胀 | 数据量和告警噪声增加 | 无效命名空间按 body hash 幂等；后续增加保留期/限流 |
| provider 回调早于创建接口回写 | 订单已确认但支付 metadata 缺失 | 已实现持久化创建 lease、provider 引用安全合并回写和状态单调保护，并有并发重试契约测试；真实 provider 沙箱仍待验收 |

### 2.14 前端 SKU 切换与完整测试记录（2026-09-13）

- [x] `hydrateCheckout()` 恢复并生成订单上下文 `contextKey`，切换商品或 SKU 时停止旧订单轮询并清理内存订单状态。
- [x] 切换商品/SKU 不删除 `sessionStorage` 中的恢复信息，刷新后仍可恢复原订单；新商品不会复用旧订单。
- [x] 游客凭证仅由服务端 `HttpOnly; Secure; SameSite=Lax` Cookie 管理，浏览器存储仅保留订单号/恢复信息。
- [x] 完整游客契约、安全、支付适配器、Webhook、Worker 测试：`55 passed, 0 failed`。
- [x] 修复轮询代际竞态：商品/SKU 切换或订单重置后，旧轮询不会调用领取接口；前端回跳显式保持订单号不匹配时 fail-closed。
- [x] 最新游客与请求安全回归：`79 passed, 0 failed`；相关 JS 语法检查与 `git diff --check` 通过。
- [x] `node --check js/guest-shop-client.js` 与 `git diff --check` 通过。
- [ ] 当前环境的 IAB 子代理不支持可见浏览器，桌面/移动端截图验收需在主线程可见浏览器或真实设备完成；不影响自动化契约结论。

### 2.15 游客状态恢复授权行为验证（2026-09-13）

- [x] 新增 `tests/guest-shop-status-recovery.test.js`，直接调用真实 `createGuestShopHandlers().status`，不只做源码正则检查。
- [x] 已验证合法取货凭证可在订单仍未终态时，从服务端绑定的支付记录重建 allowlist checkout；响应不包含 claim secret、原始 provider metadata 或其他敏感字段。
- [x] 已验证错误/缺失取货凭证在支付记录查询之前返回 `403 guest_claim_invalid`，不返回订单摘要、支付 URL 或 checkout；测试桩确认未发生支付查询。
- [x] 已验证已确认终态订单不会再次重建旧支付页；即使支付记录仍存在，也不会返回 checkout。
- [x] 已验证服务端保存的非 HTTPS checkout URL fail-closed，不进入游客响应。
- [x] 游客与请求安全回归结果：`node --test tests/guest-shop-*.test.js tests/request-security.test.js`，共 `83 passed, 0 failed`。
- [ ] 仍需真实数据库/支付沙箱验证 HttpOnly claim cookie、支付回跳、回调后 worker 履约和跨设备恢复；本步骤未新增 SQL。

#### 本步风险与修正

| 风险 | 修正 |
| --- | --- |
| 只测到内存 stub，实际 PostgREST 查询绑定可能漂移 | 测试覆盖真实 handler 的授权顺序和字段 allowlist；上线前仍需目标环境沙箱/数据库验收 |
| 合法支付记录被篡改为外链或脚本协议 | `buildStoredCheckout` 只接受 allowlist 字段，并对 checkout/二维码链接做 HTTPS 校验；不合格记录不返回 checkout |
| 订单号被枚举后直接恢复支付页 | status 必须先通过 claim header 或 HttpOnly proof cookie，未授权请求不触发支付表查询 |

### 完成标准

- 新旧订单、支付、库存查询均能区分游客/会员且不改变历史语义。
- 唯一约束可以抵御重复点击、重复 webhook、重复退款和同一库存重复消费。
- 迁移可回滚且不删除历史订单/卡密；用户执行验证结果后才算阶段完成。

### 风险与修正

- 大表加列/索引锁表：采用可分步迁移、低峰执行、先 nullable 后约束。
- RLS/anon 越权：游客端不直连表，只走最小权限后端/RPC，并增加拒绝测试。
- 回滚破坏已产生游客订单：只允许关闭功能和保留数据，禁止删除已支付业务记录。

### SQL 交付规则

- 每次产生 SQL 后，阶段报告必须列出文件、执行顺序、验证查询和回滚限制。
- Codex 不执行 SQL；新生成脚本由用户执行后回传成功/失败、迁移版本和关键查询结果；已通过的迁移/验证无需重复执行。
- 本阶段静态审查补充：管理员视图使用 `security_invoker = on`，并允许 `service_role` 或管理员读取；视图不包含卡密内容、取货哈希或原始支付请求体。
- 执行记录：前向迁移、修正版基础汇总、atomic preflight、atomic 迁移和修正版 postflight 均已由用户执行成功；期间曾修正 `ORDER BY table_name::text` 的 `42703` 报错，改用结果列序号排序。当前不需要重跑迁移或验证 SQL。

## 4. P0-2 服务端订单、预占和风控（代码已实现，待真实环境验收）

- [x] 实现 `POST /api/shop/guest/preview`：只返回服务端价格、库存可购状态和允许渠道。
- [x] 实现 `POST /api/shop/guest/orders`：校验站点/商品/SKU/数量，重算价格，幂等创建订单并原子预占。
- [x] 明确支付网关外部调用与数据库事务的补偿/outbox 方案。
- [x] 实现预占过期释放，带 `reservation_id + order_id + status` 条件，防止旧任务误释放。
- [x] 实现 IP、设备/UA、活动订单和持久限流边界；生产持久限流不可用时 fail-closed。
- [x] 实现统一错误、订单枚举防护、限速和请求体大小限制。
- [x] 匿名 JSON 请求体限制在 16-32 KiB；拒绝数组/primitive/未知字段和非法 JSON，生产持久限流不可用时 fail-closed。
- [x] 站点从受信 host/runtime 推导，显式非法 site 不得静默回退 CN；金额统一按整数分解析和比较。
- [x] 为 CN/INTL、商品类型、共享库存、人工/API 发货做服务端硬拒绝。

### 完成标准

- 相同幂等键并发只产生一个商城单、支付单和预占。
- 最后一张卡并发购买只能成功一笔。
- 创建失败、支付网关失败、服务重启均有补偿状态且不丢订单。

## 5. P0-3 支付创建与回调事件（代码已实现，待沙箱验收）

- [x] 新增独立 `shop_direct` 支付创建分支，不进入积分充值逻辑。
- [x] 支付创建只接受服务端订单引用；return URL 由服务端白名单生成，不能信任前端。
- [x] 回调保存原始请求体后验签，校验时间戳、nonce、商户号、provider、site、purpose、订单号、provider 单号、金额、币种、网络和最终状态。
- [x] 事件先落库再返回 2xx；重复、乱序、伪造、部分付、超额付、错误币种/网络不发货。
- [x] 支付回跳只显示“确认中”，不能作为发货依据。
- [x] 增加 provider 对账/主动查询补偿，处理回调丢失。

### 完成标准

- 每个已履约订单都有唯一已验证成功支付事件。
- 任何充值回调不能改变游客商品订单，任何游客回调不能增加积分。
- 生产环境 mock provider 无法进入履约状态。

## 6. P0-4 异步履约、取货和退款补偿（代码已实现，待故障演练）

- [x] 实现 `paid -> fulfilling -> delivered` 状态机和唯一 worker 领取。
- [x] 预占库存 `reserve -> sold`；支付后无库存进入 `paid_unfulfillable`，触发退款/人工队列，不静默失败。
- [x] 实现支付成功未履约、worker 崩溃、重试、死信和人工重放边界。
- [x] 实现当前浏览器 `Secure + HttpOnly + SameSite` Cookie 取货凭证。
- [x] 实现跨设备订单号 + 高熵取货口令；数据库只存哈希/HMAC，订单号单独不能查货。
- [x] 实现游客状态和领取接口，统一错误、限速、防枚举。
- [x] 以 `textContent` 渲染卡密；禁止进入 URL、日志、埋点和支付 metadata。
- [x] 明确少付、多付、退款、拒付、争议、卡密已展示后的数字商品规则和审计字段。

### 完成标准

- 同一库存最多被一个非退款订单消费一次。
- 未验证支付、仅回跳、仅订单号或未授权 Cookie 绝不返回卡密。
- 退款和补偿幂等；失败进入可见人工队列并有 SLA。

## 7. P0-5 前端游客购买 UI 与交互（已完成自动化/静态验收）

- [x] 在现有 `shop.html`/`js/shop-client.js` 购买弹窗中增加游客入口，保留登录用户积分购买路径。
- [x] 复用现有按钮、SKU 选择、弹窗、成功发货和移动端 CSS；不引入突兀的新视觉体系。
- [x] 游客预览显示服务端现金价、站点/币种和商品摘要，不显示库存卡密。
- [x] 支付中、支付确认中、支付成功、履约中、已发货、失败/退款、过期状态可恢复。
- [x] 支持支付 App 切回、支付链接、浏览器关闭后订单找回；轮询指数退避并有超时。
- [x] 不把 token 放入 URL；卡密只用安全文本节点展示；提供复制并避免日志泄漏。
- [ ] 桌面与移动端截图级验收仍需主线程可见浏览器/真实设备执行，作为 P0-7 上线验收项。

### 完成标准

- 游客购买不要求登录；登录用户行为和 UI 不回归。
- 回跳延迟、刷新、重复点击和支付窗口被拦截时，页面仍能恢复到正确状态。
- UI 自动化或浏览器验收覆盖主要状态和错误状态。

## 8. P0-6 后台可观测性与运营规则（部分完成）

- [x] 增加支付成功未履约、预占超时、金额不匹配、重复/失败回调、退款失败、死信和库存不一致只读列表与汇总。
- [ ] 记录操作审计：手动发货、补发、退款、解锁必须 RBAC、二次确认、原因和操作者（游客异常列表当前只读，操作审计待运营功能接线）。
- [ ] 定义数字商品退款/争议政策、隐私告知、数据保留和删除范围。
- [ ] 增加指标、告警、对账任务和运行手册（本轮补充运行手册，仍需真实告警接线验收）。

### 完成标准

- 任何异常订单都能定位到本站订单、支付事件、预占记录和处理责任人。
- 关闭游客开关后，历史已付款订单仍可履约/退款，不产生新游客订单。

## 9. P0-7 测试、灰度、上线验收（待执行）

- [x] 单元测试：价格快照、状态机、签名/金额/币种核验、token 哈希和脱敏。
- [x] 并发测试：幂等创建、最后一张卡、预占释放与回调竞态、worker 重试。
- [x] 安全测试：伪造/重放/乱序回调、订单枚举、RLS/anon、XSS、日志扫描、mock 生产禁用（生成目录扫描例外仍待确认）。
- [ ] 业务测试：少付、多付、部分付、退款、拒付、回调丢失、服务重启补偿、CN/INTL 串单隔离。
- [x] 前端测试：现有 UI 契约、回跳恢复、复制、过期、支付拦截和卡密文本渲染；视觉截图仍待人工验收。
- [ ] 沙箱支付测试并记录 provider 订单号、回调事件、履约和退款证据。
- [ ] 先以一个低价值、非共享、自动发货 SKU 灰度；观察成功率、发货延迟、预占占用、`paid_unfulfillable`、退款失败。
- [ ] 出具上线清单、关闭开关回滚演练和最终验收记录。

### 完成标准

- 自动化测试、真实沙箱和人工场景全部通过；失败项有明确阻断结论。
- 灰度指标在预设阈值内，回滚只关闭开关即可停止新单。
- 以上“最终完成标准”全部满足，才能从 99% 进入 100%。

## 10. 每一步的固定汇报格式

每次执行动作后必须同步更新本文件并向用户报告：

1. 已完成什么，以及证据文件/测试结果。
2. 总进度和当前阶段进度。
3. 下一步具体动作。
4. 新发现的风险、影响和修正措施。
5. 待执行清单的变化。
6. 本阶段是否生成 SQL；若有 SQL，明确脚本、执行方和状态：已执行并通过的迁移无需重复执行；新生成但未执行的 SQL 必须明确标出并提供可点击路径；若无新增 SQL，明确写“不需要用户执行 SQL”。

禁止用“基本完成”“接近完成”代替退出条件；没有证据的项目保持未完成。

## 11. 2026-09-14 本轮执行记录

- [x] 用户确认数据库验收结果全部为 `PASS`；atomic postflight 10/10、孤儿支付事件 0、游客订单/支付/预占 0、启用游客商品 0。
- [x] 保持游客商品关闭；未执行回滚 SQL，未执行任何新 SQL，未部署。
- [x] 完成运行时数值 fail-closed 与专用 worker secret 审计；readiness 覆盖公共/worker 数值配置及关系约束。
- [x] 修复共享 Express `/api/shop/guest/worker` 在 secret gate 前经过全局 body parser 的未认证大请求 DoS 风险；worker 入口继续不接受订单或库存 payload。
- [x] 完成语法、差异和游客/请求安全回归；1.0 记录为 135/135 PASS；启动 2.0 后以新回归数字为准，禁止继续使用 135/135 作为当前证据。
- [x] 补充 worker 调度运行手册：先从最新 `main` 发布并通过 readiness，再安装 timer；安装脚本默认不启动，secret 从 verify `.env` 读取且不执行 SQL。
- [x] scheduler/readiness 契约回归 `node --test tests/guest-shop-worker-scheduler-contract.test.js tests/guest-shop-readiness.test.js`：23/23 PASS；覆盖 loopback、无请求体、专用 secret、systemd 最小权限、timer 持久化、安装脚本不执行 SQL及严格 readiness 闸门。
- [x] readiness 增加可选严格闸门 `--fail-on-not-ready`：默认行为保持不变；`--fail-on-invalid` 仍返回退出码 `2`，严格模式在 `operational_ready=false` 时返回退出码 `3`，避免把 `PASS (automated)` 误当成可上线。
- [x] readiness 严格闸门回归：覆盖参数解析、人工/数据库复核导致的 `not ready`、硬错误优先级和通过路径；运行手册已说明当前离线检查器在未接入人工证据时预期 fail-closed。
- [ ] scheduler 目前仅完成代码与契约验收，尚未在真实 KVM4 安装或启动；必须先完成最新 `main` 发布、生产 readiness 和 `.env` 权限核对，再由运维执行安装/启动并留存 `systemctl`/日志证据。

### 本轮风险与修正

| 风险 | 影响 | 修正 |
| --- | --- | --- |
| 共享入口提前解析 worker body | 未认证请求可造成内存/CPU 消耗 | worker/webhook 路由跳过全局 parser，由有界 raw-body/worker handler 处理 |
| readiness 关系项漏报 | 运维可能误以为限流配置完整 | 非法主配置时关系检查保持 blocking finding |
| 自动化全绿被误解为可上线 | 真实支付和库存仍可能有环境差异 | P0-2/P0-3/P0-4/P0-7 继续保持未完成，游客商品保持关闭 |
| readiness 返回 0 被误当成 operational ready | 离线脚本无法证明数据库/provider/KVM4 运行证据 | 默认命令仅作自动化检查；启用前使用 `--fail-on-not-ready`，退出码 3 时不得绕过，继续完成人工/实机验收 |
| 仅完成调度器代码却未在 KVM4 验证 | 可能出现服务端口、权限或 secret 配置错误 | 真实安装前执行 readiness；安装后检查 `systemctl status/list-timers/journalctl`，异常先停 timer |

### SQL 状态

本轮**没有新增 SQL**，不需要用户执行 SQL。已有迁移和验证结果保持有效；禁止执行 rollback，除非后续明确进入无游客订单的回滚场景。
