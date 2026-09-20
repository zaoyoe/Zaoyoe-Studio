# 游客促销共用（优惠码 / 阶梯价 / 闪购）安全加固方案

> 工作目录：`/Volumes/chao/AI/xianyu_profit_calculator-guest-promo`
> 分支：`codex/guest-shop-promo-hardening`（基线 `2424dcc14` = 最新 `main`）
> 关联：`docs/guest-purchase-task-2.0.md`（当前任务 2.1 内容版本）、`docs/guest-shop-payment-fulfillment-runbook.md`、`AGENTS.md`
> 前置已完成任务：`codex/guest-shop-entry-merge`（`7cf0cb405`，未部署）

## 0. 文档定位

本文件是**设计合同**，不是实现完成证明。

- 所有 SQL 只写成迁移文件交给用户，**Codex 绝不执行 SQL**。
- 所有游客促销能力**默认全关**。发布代码 ≠ 启用促销 ≠ 启用游客商品。
- 回滚 = 关开关，**不是** DB 回滚，也不是 Vercel 单独回滚。
- 在用户于本文第 16 节确认数值旋钮、并在第 14 节签署灰度许可之前，游客促销保持关闭。

---

## 1. 诉求与安全底线的冲突点

**用户诉求**：游客与登录用户共用同一套促销引擎（优惠码、阶梯价、闪购），积分与现金等值（1 积分 = 1 元），登录用户能享受的优惠游客也能参与结算。

**用户底线（原话）**：安全第一，不希望被刷完、不希望零元购、不希望掏鸟蛋，需要绝对安全。

**冲突点只有一个**：促销引擎的所有限额都建立在「有账号身份」这一前提上，而游客没有账号身份。

- `fn_validate_discount_code_core` 强制要求非空 `user_id`（`supabase/migrations/20260523_add_shop_product_skus.sql:1094-1097`）。
- 每用户券用量 `fn_shop_discount_user_net_use_count` 只统计 `shop_orders`（`supabase/migrations/20260617_harden_discount_settlement_and_refunds.sql:19-41`）。游客单在 `guest_shop_orders`，**永远不会被计入**。
- 结论：把游客直接接进现有券引擎 = 「每用户限用 1 次」对游客变成「无限次」，`max_uses_per_user` 形同虚设，营销预算会在几分钟内被刷光。

**因此本方案的核心不是「打通促销」，而是先给游客造一个可计数、可封顶、可熔断的服务端身份，并把促销花费从「软限制」升级为「DB 层原子硬预算」。** 促销打通是这两件事做完之后的副产品。

---

## 2. 现状事实（已逐条核对代码，行号可复查）

| # | 事实 | 位置 | 对方案的影响 |
|---|---|---|---|
| F1 | 1 credit = 1 CNY，CN / INTL 都以 CNY 结算；USDT 只是下游服务商换算 | `api/_lib/guest-shop/pricing.js:3-6`；`supabase/migrations/20260915_guest_shop_credit_pricing.sql:38-49` | 积分↔现金完全等值，`fixed` / `percent` 券可 1:1 平移，**不需要任何汇率设计** |
| F2 | 闪购价对游客**已经生效** | `pricing.js:120-122`；SQL `20260915_...:126-131` | 闪购不需新开发，只需纳入游客上限与审计 |
| F3 | 阶梯价对游客是**死代码**，三道闸同时挡住 | JS `pricing.js:93-94` `if (quantity !== GUEST_QUANTITY) return null`；SQL `20260915_...:87` `IF p_quantity IS DISTINCT FROM 1 THEN RETURN NULL`；`fn_guest_shop_create_order` 无 quantity 参数，INSERT 硬编码 `1` | 开放阶梯价必须**三处同步改**，漏一处即产生展示价与权威价分裂（见 T7） |
| F4 | 优惠码对游客**完全排除**（设计意图明确写在注释里） | `pricing.js:5-6`「Agent markup and discount codes are intentionally excluded」；`fn_guest_shop_create_order` 无 discount 参数 | 这是一次**有意为之的安全收口被打开**，必须按「新增受控能力」而非「解除限制」来做 |
| F5 | 游客订单金额已有 DB CHECK：`unit_amount > 0 AND total_amount > 0 AND total_amount = unit_amount * quantity` | `supabase/migrations/20260913_add_guest_shop_cash_purchase.sql:154-155` | 零元购目前已被 DB 挡住。**一旦引入 `discount_amount` 列，这条约束必须同步改写**，否则要么插不进、要么被迫绕过约束（绝对禁止绕过） |
| F6 | 登录侧券校验要求非空 user_id，全部限额按账号计 | `20260523_add_shop_product_skus.sql:1081-1097` | 游客不能复用该函数的 user 路径，需要独立的游客分支 |
| F7 | 每用户券净用量只数 `shop_orders` | `20260617_harden_discount_settlement_and_refunds.sql:19-41` | **最高危事实**：直接复用即等于游客无限用券 |
| F8 | 券表是全局码表，字段齐备：`max_uses` / `used_count` / `max_uses_per_user` / `discount_value INT` / `allow_zero_total` / `max_discount_quantity` / `is_exclusive` / `stack_priority` / `pricing_apply_stage ∈ {catalog_price, order_discount, balance_offset}` / `distribution_mode ∈ {general_code, public_claim, user_assigned}` / `audience_segment` / `scope_type ∈ {all, category, product}` / `scope_product_sku_id` / `applicable_site ∈ {all, cn, intl}` / `lifecycle_status` / `starts_at` / `claim_*` | `2.2_discount_codes.sql:2-21`；`20260327_add_discount_scope_controls.sql`；`20260409_discount_v2_p1/p2_*.sql` | `balance_offset` 对游客无意义（无余额）、`user_assigned` / `public_claim` 需要账号资产、`audience_segment` 游客不可验证 → 这三类必须对游客**显式拒绝**，不能默认放行 |
| F9 | 下单链路：POST orders → `normalizeGuestOrderInput`（`quantityMax: 1`，且禁止客户端传 `amount/price/currency/inventoryId/...`）→ `loadGuestSkuPricing` → `buildGuestRequestFingerprint` → `fn_guest_shop_create_order` → handler 用 `resolveGuestPayablePricing` 加 1% 通道费并写回 `expected_amount` | `server/api-handlers/public/guest-shop.js:1403-1443`、`1253-1282`；`api/_lib/guest-shop/security.js:166-240`、`536-591` | fingerprint 当前**不含优惠码与折扣额**，加券后必须扩展，否则同一幂等键可换券重放（T8） |
| F10 | preview 是 **GET + query string** | `server/api-handlers/public/guest-shop.js:1365-1386`；`js/guest-shop-client.js:502` | 优惠码**绝不能**走 preview（会进 URL、进日志、进浏览器历史、进 Referer）→ 必须新增 POST 报价端点 |
| F11 | 限流是持久化 DB 存储，生产环境 fail-closed（`requirePersistent: isProductionLikeRuntime(env)`），限流不可用直接 503 | `server/api-handlers/public/guest-shop.js:703-745` | 促销限流可直接复用同一机制，无需新建基础设施 |
| F12 | 已有三个身份列 `buyer_contact_hash` / `request_ip_hash` / `request_device_hash`，但**目前不参与任何配额判断** | `20260913_add_guest_shop_cash_purchase.sql:130-132`；写入点 `guest-shop.js:1430-1437` | 配额体系有现成落点，不需要新增采集逻辑，只需新增计数逻辑 |
| F13 | webhook 严格校验签名 / 金额 / 币种 / 终态，`fn_guest_shop_confirm_payment` 要求四个 `*_verified` 全真 | `guest-shop.js:2309-2336`；`20260913_guest_shop_atomic_rpcs.sql:518-543` | **本方案不降低 webhook 任何严格度**。折扣只改变 `expected_amount` 的来源，不改变校验逻辑 |
| F14 | 预占用 `FOR UPDATE SKIP LOCKED` 选一行 `available` 库存置 `reserve`，TTL 默认 1800s，有独立释放 RPC | `20260915_guest_shop_credit_pricing.sql`（candidate CTE）；`fn_guest_shop_release_reservation` | 掏鸟蛋的载体就是这个预占 + TTL，控制点明确 |
| F15 | readiness 门禁存在，`--fail-on-not-ready` 退出码 3 是预期 fail-closed，退出码 2 是配置非法 | `scripts/guest-shop-readiness.js:41-49` | 促销配置检查直接挂进同一门禁，不新建脚本 |

---

## 3. 威胁模型

| ID | 威胁 | 具体攻击手法 | 影响 | 主控制 |
|---|---|---|---|---|
| T1 | **零元购** | 100% percent 券；`allow_zero_total=true` 的券；`fixed` 券面额 ≥ 单价；多券叠加；直接改请求里的 amount | 免费拿走卡密，直接现金损失 | §8.2 DB CHECK、§9.1 步骤 7、§6-C1~C5 |
| T2 | **预算被刷完** | 同一码被无限次使用（F7）；分布式 IP 打光全局 `max_uses`；一次性耗尽营销预算 | 营销预算归零、真实买家无券可用 | §8.1 券级硬预算、§9.3 原子扣减、§12 日预算+熔断 |
| T3 | **掏鸟蛋** | 批量创建不付款订单占满库存（TTL 1800s）；`quantity>1` + 阶梯价一次锁走大量库存；并发预占把 `available` 打到 0 | 真实买家买不到、商品显示售罄、运营被迫手工解锁 | §10.1~10.6 |
| T4 | **身份漂移** | 清 cookie / 换 UA / 换 IP / 换邮箱，绕过 per-identity 上限 | 单个体获得**预算内**的配额（非无限，见 §7.5） | §7.2 四因子并集计数（抬价）+ §8.1 硬预算（封顶）+ §20-A/B（提高伪造成本） |
| T5 | **登出套利** | 注册账号用完 per-user 券后登出，用游客通道把同一张券再用一次；**或换一个未注册邮箱继续** | 每用户限 1 次变成限 2 次（已注册邮箱）/ 限 N 次（换邮箱，仅受预算封顶） | §7.3 注册邮箱碰撞即拒绝 + §20-B 邮箱 OTP 把「换邮箱」变成需要真实信箱 |
| T6 | **券码枚举 / 撞库** | GET 带码探测有效性（响应差异 = oracle）；批量试码；用错误信息推断券规则 | 内部券码泄露、定向券被公开使用 | §11 统一错误码 + POST-only + 锁定 + 限流 |
| T7 | **价格权威分裂** | JS 展示价与 SQL 权威价不一致 | webhook `amount_mismatch` → **已付款不发货**（最严重事故，赔付 + 口碑） | §9.1 单一 SQL 权威、§9.4 不一致即 409 重报价、§9.5 黄金向量 parity 测试 |
| T8 | **幂等键重放改价** | 同一 `idempotency_key` 换券 / 换数量重放 | fingerprint 冲突检测失效，金额被换 | §9.7 fingerprint 纳入 code/qty/discount |
| T9 | **报价令牌伪造 / 跨会话搬运** | 伪造 quote；把 A 会话的 quote 用到 B 会话 | 绕过身份配额 | §9.6 quote 无金额权威 + 绑定 session_hash + 短 TTL + create 时全量重算 |
| T10 | **定向券外泄** | 游客使用 `audience_segment=vip/new_user`、`distribution_mode=user_assigned/public_claim`、`pricing_apply_stage=balance_offset` 的券 | 定向营销资源被公开套利 | §8.1 CHECK 约束（DB 层禁止这种组合存在） |
| T11 | **取整 / 手续费套利** | 折扣把 base 压到极小，1% 通道费 ceil 后比例失真；或企图「只付手续费拿货」 | 单笔亏损、或零元购变种 | §9.6 手续费基于折后 base 且不参与折扣；`total_amount > 0` 是 DB CHECK，「只付手续费」在数学上不可达 |
| T12 | **退款套现 / 反向 DoS** | 用券下单→退款→预算未回收被反复刷；**同一单反复触发归还**把预算刷回无限；或退款后计数不减导致正常买家被挡 | 预算泄漏（等价于无限券），或营销资源被恶意锁死 | §8.2 `discount_usage_restored` 幂等标志 + C-D6 同事务归还 + 审计 |
| T13 | **熔断缺失** | 异常发生时只能靠人工发现 | 损失随时间线性扩大 | §12 自动跳闸 + 人工恢复 |
| T14 | **运营误配** | 勾错开关；把 `guest_max_uses=0` 误解为「无限」 | 静默全开 | §8.1 显式定义 **0 = 关闭**（不是无限）+ CHECK + §12.4 readiness 脏配置扫描 |
| T15 | **前端契约破损** | 券码被写进 URL / localStorage / sessionStorage；游客脚本引入 supabase 或 token | 券码泄露、游客通道被登录态污染 | §15 契约测试扩展（沿用现有隔离断言） |

---

## 4. 安全原则（不可协商）

- **P1 服务端权威**：客户端只提交 `{site, productId, skuId, quantity, discountCode}`。金额一律服务端重算，客户端传入的任何金额字段直接 400（沿用 `normalizeGuestOrderInput` 的 `forbiddenFields` 机制）。
- **P2 默认全关 + 白名单逐层开**：任何一层缺失即视为关闭。
- **P3 fail-closed**：配置缺失 / 非法 / 依赖不可用 → 拒绝促销（但允许原价购买），**绝不降级放行**。
- **P4 硬预算**：促销花费由 DB 层原子计数封顶，不依赖应用层自律。
- **P5 金额不变量写在 DB CHECK 里**，不写在 JS 里。JS 只是展示。
- **P6 单一权威定价函数**：游客应付金额只由一个 SQL 函数产出。
- **P7 可计数身份（不是可证明身份）**：游客必须有服务端签发的会话身份，配额按多因子并集计。身份层只负责抬价，**安全性不依赖身份强度**；损失上限由 P4/P5 决定。能力边界见 §7.5。
- **P8 可熔断、可回滚**：回滚 = 关开关。
- **P9 不打印密钥、不执行 SQL、不在部署中启用商品或促销。**
- **P10 促销故障不影响原价成交**：任何促销异常 → 回退原价或明确拒绝，绝不让正常买家吃 500。

---

## 5. 总体架构

```
浏览器
  │
  ├─ GET  /api/shop/guest/preview      （现有，不带券码；只回原价 + 通道）
  │
  ├─ POST /api/shop/guest/quote        （新增：券码只走这里）
  │      ├─ 会话身份（httpOnly cookie，服务端签发）
  │      ├─ 限流 + 无效码锁定
  │      ├─ SQL 试算（不扣预算，只读 + FOR UPDATE 短事务）
  │      └─ 返回 signed quote（短 TTL，无金额权威）+ 展示明细
  │
  ├─ POST /api/shop/guest/orders       （改造）
  │      └─ SQL fn_guest_shop_create_order（单事务内串行完成）
  │           1 advisory lock（幂等键）
  │           2 锁 product / sku / source sku（FOR UPDATE）
  │           3 开关与策略双闸校验（env + DB policy 表）
  │           4 数量上限校验
  │           5 单价解析（闪购 > 阶梯 > 基础价）
  │           6 券校验 + 折扣计算 + 折后下限校验
  │           7 原子扣减：券计数 / 券预算 / 日预算（任一失败 → 整事务回滚）
  │           8 库存占比上限 + 并发未付款单上限
  │           9 预占一行库存（SKIP LOCKED）
  │          10 写订单（含 discount 列 + 新 CHECK）
  │          11 写审计事件
  │      └─ handler 加 1% 通道费 → 写回 expected_amount / payment_pricing
  │
  ├─ 支付服务商 → webhook（严格度不变）→ fn_guest_shop_confirm_payment（不变）→ worker 履约（不变）
  │
  └─ 过期 / 取消 / 退款
         └─ 同一事务：释放预占 + 归还券计数 + 归还券预算 + 归还日预算 + 写审计
```

关键性质：**扣预算发生在写订单的同一个事务里**，因此不存在「预算扣了但订单没写」或「订单写了但预算没扣」的中间态。

---

## 6. 控制矩阵（威胁 → 控制 → 落点）

### A. 身份与配额

| 控制 | 说明 | 落点 | 覆盖威胁 |
|---|---|---|---|
| C-A1 | 服务端签发游客会话，httpOnly + Secure + SameSite=Strict + `__Host-` 前缀，值加密，独立 pepper | 新表 `guest_shop_sessions`；`guest-shop.js` 新 `issueGuestSession()`；env `GUEST_SHOP_SESSION_PEPPER` | T4 T9 T15 |
| C-A2 | 配额按 **四因子并集** 计数：`guest_session_hash` ∪ `request_ip_hash` ∪ `request_device_hash` ∪ `buyer_contact_hash`，任一命中即计入 | SQL 计数子查询（带索引） | T4 |
| C-A3 | 每因子独立阈值，IP 因子最宽松（避免 NAT / 校园网误伤真实买家），contact 与 session 最严格 | env 旋钮 §16 | T4 + 可用性 |
| C-A4 | 游客用券时 contact 由「可选」变「**必填**」，格式校验 + 独立限流 | `normalizeGuestOrderInput` 新增 `requireContactWhenDiscount` | T4 T5 T6 |
| C-A5 | contact 命中已注册账号 → **仅记录 `registered_user_match`，绝不影响价格、折扣与券可用性**（§7.3，原「拒绝促销」设计已废弃，见 §22.5 反杀熟） | handler 用 service_role 查 `auth.users`，**不把 pepper 写进 SQL**；`registered_user_match` 不得进入定价 resolver 入参（H2） | T5 |
| C-A6 | 无效码尝试计数 + 指数退避锁定，会话表与限流桶双写 | `guest_shop_sessions.invalid_code_attempts` / `locked_until` | T6 |

### B. 金额与零元购

| 控制 | 说明 | 落点 | 覆盖威胁 |
|---|---|---|---|
| C-B1 | DB CHECK：`total_amount > 0` 且 `total_amount >= 0.01` | `guest_shop_orders` 约束改写 | T1 |
| C-B2 | DB CHECK：`discount_amount < unit_amount * quantity`（折扣不得吞掉全部金额） | 同上 | T1 T11 |
| C-B3 | DB CHECK：`total_amount = unit_amount * quantity - discount_amount`（替换 F5 的旧等式） | 同上 | T1 T7 |
| C-B4 | DB CHECK：`discount_code IS NULL OR discount_amount > 0`（挂码必须真折，防「挂码不折」绕过计数） | 同上 | T2 |
| C-B5 | 券级 CHECK：`NOT (allow_guest AND allow_zero_total)` | `discount_codes` 约束 | T1 T10 |
| C-B6 | 券级 CHECK：`allow_guest ⇒ guest_max_uses > 0 AND guest_max_total_discount > 0`（**0 = 关闭，不是无限**） | 同上 | T2 T14 |
| C-B7 | 券级 CHECK：`allow_guest ⇒ distribution_mode='general_code' AND pricing_apply_stage='order_discount' AND (audience_segment IS NULL OR audience_segment='all_users')` | 同上 | T10 |
| C-B8 | 单笔折扣率上限 `guest_max_discount_percent`（券级，默认 50） | resolver 步骤 7 | T1 T2 |
| C-B9 | 折后最低应付下限（env `GUEST_SHOP_PROMO_MIN_PAYABLE_CNY`，默认 1.00），在 quote、create、写回 `expected_amount` 三处都校验 | resolver + handler + readiness | T1 T11 |
| C-B10 | 客户端不传金额；quote 令牌不携带金额权威；create 时 SQL 全量重算 | 沿用 `forbiddenFields` + §9.6 | T1 T7 T9 |
| C-B11 | webhook 严格度**不变**：签名 / 金额 / 币种 / 终态四项全真才 confirm | 不改 `fn_guest_shop_confirm_payment` | T1 T7 |

### C. 预算与防刷

| 控制 | 说明 | 落点 | 覆盖威胁 |
|---|---|---|---|
| C-C1 | 券级游客预算双维度：次数 `guest_max_uses` + 金额 `guest_max_total_discount`，原子 `UPDATE ... WHERE 余量足够 RETURNING`，无返回行即拒绝 | resolver / create-order 同事务 | T2 |
| C-C2 | 站点级日预算 `guest_shop_promo_budget_daily`，原子扣减，打满即停止促销（原价仍可买） | 新表 + create-order 同事务 | T2 T13 |
| C-C3 | 每身份每码上限 `guest_max_uses_per_identity`（默认 1），按四因子并集计，只数**未退款**单 | SQL 计数 | T2 T4 |
| C-C4 | 每身份每 SKU 上限（默认 1），防同一人反复占同一 SKU | SQL 计数 | T3 |
| C-C5 | 退款 / 过期 / 取消在**同一事务**归还券计数、券预算、日预算 | 扩展 `fn_guest_shop_release_reservation` + 退款 RPC | T12 |
| C-C6 | 促销请求独立限流桶（ip / session / global 三级），复用持久化 fail-closed 限流 | `limit(req,res,'quote',...)` | T2 T6 |
| C-C7 | 自动熔断：无效码率、`amount_mismatch` 计数、单码增速、日预算使用率 | 新表 `guest_shop_promo_breaker` + resolver 读闸 | T13 |

### D. 库存（掏鸟蛋）

| 控制 | 说明 | 落点 | 覆盖威胁 |
|---|---|---|---|
| C-D1 | 游客数量上限 = `min(env GUEST_SHOP_MAX_QUANTITY, sku.guest_max_quantity, product.max_purchase_quantity)`，默认全为 1 | resolver 步骤 4 | T3 |
| C-D2 | 阶梯价对游客只在运营显式把 `guest_max_quantity` 提到 ≥ 阶梯 qty 时才生效；受独立开关 `GUEST_SHOP_PROMO_TIERED_PRICING_ENABLED` 控制 | env + SKU 列 | T3 T14 |
| C-D3 | 游客持有量占比上限：该 SKU（含 source chain）当前 `held` 游客预占件数 / 可用件数 ≥ `GUEST_SHOP_MAX_STOCK_HOLD_PERCENT`（默认 20%）→ 拒绝。**登录用户不受影响** | create-order 内统计 | T3 |
| C-D4 | 每身份并发未付款单上限 `GUEST_SHOP_MAX_OPEN_ORDERS`（默认 2） | create-order 内统计 | T3 |
| C-D5 | 促销单 TTL 缩短为 `GUEST_SHOP_PROMO_ORDER_TTL_SECONDS`（默认 600s；原价单保持 1800s） | `guestOrderTtlSeconds` 分支 | T3 |
| C-D6 | 释放 worker 保持现有节奏，但释放时必须同事务归还预算（C-C5） | worker + RPC | T3 T12 |

### E. 一致性与可观测

| 控制 | 说明 | 落点 | 覆盖威胁 |
|---|---|---|---|
| C-E1 | 单一 SQL 权威定价函数；JS 仅展示 | `fn_guest_shop_resolve_payable` | T7 |
| C-E2 | 展示价与权威价不一致 → 409 `guest_quote_stale`，前端自动重报价一次，仍不一致则提示「价格已更新」 | handler + `guest-shop-client.js` | T7 |
| C-E3 | 黄金向量 parity 测试：固定 fixture（阶梯 / 闪购 / percent / fixed / 边界 / 非法）断言 JS 与 SQL 输出逐项一致 | `tests/guest-shop-pricing-parity.test.js` + verify SQL | T7 |
| C-E4 | fingerprint 纳入 `discountCode` / `quantity` / `discountAmountMinor` / `pricingVersion` | `buildGuestRequestFingerprint` | T8 |
| C-E5 | 全量审计表 `guest_shop_promo_events`，不含明文联系方式 | 新表 | T6 T13 |
| C-E6 | 统一错误码：所有券不可用原因收敛为单一 `guest_discount_unavailable` + 单一文案 | resolver + handler | T6 |
| C-E7 | readiness 新增 `promo` 检查组，含脏配置扫描（`allow_guest=true AND allow_zero_total=true` 直接退出码 2） | `scripts/guest-shop-readiness.js` | T14 |
| C-E8 | 前端契约测试扩展：券码不得出现在 URL / localStorage / sessionStorage；quote 必须 POST；游客脚本仍不得出现 `supabase` / `access_token` / `Authorization` | `tests/guest-shop-frontend-contract.test.js` | T15 |

---

## 7. 身份层设计

### 7.1 游客会话（C-A1）

新表 `guest_shop_sessions`：

```sql
CREATE TABLE IF NOT EXISTS public.guest_shop_sessions (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token_hash     TEXT NOT NULL UNIQUE,          -- HMAC(pepper, token)，不存明文
    site                   VARCHAR(10) NOT NULL,
    first_ip_hash          TEXT,
    last_ip_hash           TEXT,
    device_hash            TEXT,
    contact_hash           TEXT,                          -- 用券时回填
    registered_user_match  BOOLEAN NOT NULL DEFAULT false,-- C-A5 命中注册账号
    invalid_code_attempts  INTEGER NOT NULL DEFAULT 0,
    locked_until           TIMESTAMPTZ,
    promo_disabled_reason  TEXT,                          -- 该会话被拒绝促销的原因码
    quote_count            INTEGER NOT NULL DEFAULT 0,
    order_count            INTEGER NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at             TIMESTAMPTZ NOT NULL,
    revoked_at             TIMESTAMPTZ,
    CONSTRAINT guest_shop_sessions_site_check CHECK (site IN ('cn','intl')),
    CONSTRAINT guest_shop_sessions_hash_check CHECK (session_token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT guest_shop_sessions_attempts_check CHECK (invalid_code_attempts >= 0)
);
CREATE INDEX IF NOT EXISTS guest_shop_sessions_ip_idx      ON public.guest_shop_sessions (last_ip_hash);
CREATE INDEX IF NOT EXISTS guest_shop_sessions_device_idx  ON public.guest_shop_sessions (device_hash);
CREATE INDEX IF NOT EXISTS guest_shop_sessions_contact_idx ON public.guest_shop_sessions (contact_hash);
```

Cookie 规范：

- 名称 `__Host-gs_sess`（强制 Secure + 无 Domain + Path=/），`Path=/api/shop/guest`，`HttpOnly`，`SameSite=Strict`，`Max-Age` 默认 7 天（可配）。
- 值为 AES-256-GCM 加密块，复用现有 `encryptClaimCookie` / `decryptClaimCookie` 的实现范式（`server/api-handlers/public/guest-shop.js:267-315`），但使用**独立 pepper** `GUEST_SHOP_SESSION_PEPPER`。
- 严禁写入 URL、query、localStorage、sessionStorage、provider metadata、日志。
- 会话不是权限凭证，只是**计数锚点**：丢失会话只会让配额收紧（重新计数），不会放松。这一点必须写进测试。

### 7.2 四因子并集配额（C-A2 / C-A3）

> **修订（2026-09-18）**：`docs/guest-shop-order-access-2.0.md` 落地后，本节的四因子并集
> 收敛为「`buyer_id` 主判据 + `guest_session_hash` / `request_ip_hash` 两个兜底」，
> `request_device_hash` 从判据中移除。详见 §22.1，冲突时以 §22 为准。

计数谓词（示意，实际写在 resolver 内）：

```sql
SELECT COUNT(*) INTO v_identity_uses
FROM public.guest_shop_orders o
WHERE o.discount_code IS NOT NULL
  -- guest_shop_orders 的状态词汇与 shop_orders 不同，必须按游客侧 CHECK 约束取值：
  -- payment_status ∈ {pending,created,confirmed,partial,overpaid,amount_mismatch,expired,refunded,chargeback,review,failed}
  -- refund_status  ∈ {none,pending,succeeded,failed,manual_review}
  AND COALESCE(o.refund_status,'none') NOT IN ('succeeded')
  AND o.payment_status NOT IN ('expired','failed','amount_mismatch','chargeback','refunded')
  AND (
        (p_session_hash IS NOT NULL AND o.guest_session_hash = p_session_hash)
     OR (p_ip_hash      IS NOT NULL AND o.request_ip_hash    = p_ip_hash)
     OR (p_device_hash  IS NOT NULL AND o.request_device_hash = p_device_hash)
     OR (p_contact_hash IS NOT NULL AND o.buyer_contact_hash = p_contact_hash)
  );
```

分因子阈值（避免「并集」把 NAT 后的无辜买家一起封掉）：

| 因子 | 稳定性 | 默认每码上限 | 默认每日上限 | 说明 |
|---|---|---|---|---|
| `guest_session_hash` | 中（清 cookie 即失效） | 1 | 3 | 主锚点 |
| `buyer_contact_hash` | **未验证前＝可伪造**（仅 HMAC，无 OTP） | 1 | 3 | 用券必填；价值在可追溯与跨会话归并，不在防伪造 |
| `request_device_hash` | 低（仅 UA） | 1 | 5 | UA 相同会误伤，阈值放宽但保留 |
| `request_ip_hash` | 低（NAT / 移动网络） | 3 | 20 | 只做粗粒度防洪，不做主判据 |

判定规则：**任一因子达到其自身上限即拒绝**（`guest_identity_limit`），收敛为统一对外错误码。

### 7.3 注册账号碰撞（C-A5，**修订：只记录，绝不影响价格**）

> **修订记录（2026-09-18，用户否决原设计）**：本节原设计为「邮箱命中注册账号 ⇒ 拒绝该会话
> 使用任何优惠码」。该设计构成**大数据杀熟**——老用户用真实邮箱下单反而比陌生人贵，
> 且在中国有明确合规风险（详见 §22.5）。**已废弃，改为只记录不定价。**

- handler 在 quote / create 前，用 service_role 客户端按邮箱精确查 `auth.users`（`ilike` 归一化小写），命中则：
  - `guest_shop_sessions.registered_user_match = true`（**仅作记录**）
  - 写审计事件 `identity_registered_match`
  - **价格、折扣、券可用性、库存配额一律不受影响**——与任何新游客完全同价同权
- `registered_user_match` 的**唯一合法用途**是订单访问 2.0 的 §10.4「邮箱 OTP 后并入注册账号」
  与运营分析。**任何把它接入定价路径的代码都应在 code review 中被拒绝。**
- **不在 SQL 里做这个判断**：pepper 与邮箱明文都不应进入数据库函数，避免把服务端密钥固化进迁移文件。

#### 7.3.1 原「防登出套利」担心的到底是什么，以及为什么它不成立

原设计的动机是「注册用户登出来薅游客券」。逐条核对后，这个担心站不住：

| 担心 | 核对结果 |
|---|---|
| 游客单会不会既拿折扣又发积分（双重福利） | **不会**。游客购买是隔离的现金域：`supabase/migrations/20260913_add_guest_shop_cash_purchase.sql:4,323` 明写「Never enters points purchase/refund RPCs」。积分与现金是两条互不相通的钱 |
| 券被多用会不会亏钱 | **不会亏本金，但可能少赚毛利**——取决于领用者是增量客户还是存量客户/套利者，券本身分不出来（完整推导见 §22.5.3）。`保底有利润` 只锁住前者。真正要防的是下面三条**结构性上限**，而它们**与邮箱是否注册无关** |
| ① 营销预算被单点吃掉 | 真实成本（机会成本，非亏损）：¥2000/日预算本意拉 200 个新客，被一个脚本全吃了 → 钱花了新客没来。由 `guest_max_uses_per_identity`（C-C3）+ `daily_budget_cny` 解决 |
| ② 库存被 pending 单占住 | **真实成交损失**：脚本大量建单不付款 → 真买家买不到。由 `max_stock_hold_percent`（K11）+ `max_pending_quantity_per_ip_product`（K24）+ `promo_order_ttl_seconds`（K13）解决 |
| ③ 折后金额被算错/篡改 | **真实资损**：折扣 > 原价。由 DB CHECK 零元购（C-B5）+ `guest_min_payable_cny`（K5）+ `guest_max_discount_percent ≤ 90`（C-B8）+ 金额权威 resolver（L3）解决 |

**结论：结构性上限（①②③）才是承重墙，「邮箱是否注册」从来不是有效的风控信号，
它唯一能做到的就是让老用户买得更贵。移除。**

#### 7.3.2 唯一真实存在的绕过：`per_account_purchase_limit`

`supabase/migrations/20260326_add_shop_cumulative_purchase_limits_and_unlimited_purchase_entitlements.sql:13`
存在**账号级限购**。注册用户登出后以游客身份继续买，确实能绕过它。但：

- 这是**限购**问题，不是**优惠**问题，两者的解法不能混。用「拒绝优惠码」治「绕过限购」是错的药。
- 游客侧已有对等闸门：`GUEST_SHOP_MAX_QUANTITY`（K3，默认 **1**）、SKU 级 `guest_max_quantity`（K4）、
  `max_open_orders`（K12）、`max_pending_quantity_per_ip_product`（K24）。
- 补一条 **readiness 警告**（非阻断）：若某 SKU 同时 `allow_guest_purchase=true` 且
  `per_account_purchase_limit` 非空，且 `guest_max_quantity > per_account_purchase_limit`，
  则提示运营收紧游客件数上限。默认配置（K3=1）下不会触发。
- 真需要强约束时，未来可加 SKU 级开关 `enforce_account_limit_for_guest`（默认 false），
  **本轮不做**，避免为一个边界场景引入按身份差异化的行为。

### 7.4 锁定与退避（C-A6）

- 10 分钟窗口内 5 次无效码 → 锁 15 分钟；再犯 → 30 分钟；第三次 → 24 小时。
- 锁定期间 quote 直接 429，**不进 DB 校验、不消耗券查询**。
- 同一 IP 的锁定会独立计入限流桶，防止换会话绕过。

### 7.5 身份层能力边界（诚实声明，必读）

**结论先行：游客身份问题只能被「抬价」，不能被「解决」。** 这是定义层面的，不是工程懒惰：
游客侧所有信号——cookie、UA、IP、邮箱——的产生权都在攻击者手里。一个未登录、未验证的
访客，在密码学意义上没有任何可证明的身份。任何声称「能唯一识别游客」的方案都是错的。

所以本方案**不把安全性押在身份上**。身份层只负责提高攻击成本；损失上限由
DB CHECK 约束与硬预算负责，与身份强度无关。

| 威胁 | 控制层 | 是否结构性消灭 | 说明 |
|---|---|---|---|
| 零元购 | DB CHECK（`total_amount>0`、`discount_amount < unit_amount*quantity`、券级 `NOT(allow_guest AND allow_zero_total)`） | **是，数学上不可表达** | 即使身份被完全伪造，也写不进一条 0 元促销单 |
| 促销花费被刷爆 | 券级 `guest_max_uses` / `guest_max_total_discount` + 站点 `daily_budget_cny`，同一事务内原子条件扣减 | **是，上限＝你填的数字** | 0 表示关闭，永不表示「不限」 |
| 折后单价被前端篡改 | 单一 SQL resolver `fn_guest_shop_resolve_payable` + quote/commit 双跑 + 黄金向量 parity | **是** | JS 侧无金额决定权 |
| 掏鸟蛋（锁库存） | 游客占比 ≤ `max_stock_hold_percent`(20%) + 每身份 ≤2 张未付单 + TTL 600s | **是，占比有顶** | 最多占住 20%，且到期自动释放 |
| 同一身份反复用券 | 四因子并集配额 | **否，只是抬价** | 清 cookie + 换 IP + 换 UA + 换邮箱 = 重置；靠预算兜底 |
| 批量注册「游客」 | 会话签发 + `contact_hash` 配额主判据（§22.1） | **否，只是抬价** | 邮箱无需验证即可换新，但每换一个邮箱都要新设一个四类齐全的查询密码（订单访问 2.0 §6.1），批量薅羊毛从「改一个字符串」变成「逐个管理邮箱+密码对」的簿记负担；C-A5 已不再承担任何拦截职责 |
| 优惠码枚举 | 锁定退避 + 限流 + 熔断 | **否，只是抬价** | 撞库速度被压到分钟级，但不为零 |

**`contact_hash` 的真实价值，以及我在早期草稿里说错的地方：**
现状 `hashContact`（`server/api-handlers/public/guest-shop.js:832-837`）只做 HMAC，
邮箱**不验证、不发 OTP**，且今天联系方式是选填（`security.js` `allowOptionalContact: true`）。
因此 `contact_hash` 的可伪造性与其他三个因子同级，**不是「最可信因子」**。它仍然有用，
但用途是：(a) 售后与订单通知的真实通道；(b) 跨会话归并同一买家（用户换设备时配额仍连续）；
(c) C-A5 注册账号碰撞的查表键（**仅记录用途**，不参与定价，§7.3）。它**不提供防伪造能力**，
除非叠加订单访问 2.0 的查询密码（同邮箱复用需知道密码）或 §20-B 的邮箱 OTP。

**因此，威胁模型必须重新表述：** 攻击者要拿到货，必须真的付钱（DB CHECK 保证）。
所以真实风险不是「资不抵债」，而是「营销预算被薅羊毛者吃掉、没花在目标客户身上」——
即**预算错配**，其上限就是 K8 / K10 里你亲手填的数字。真正的资损（零元购）已被结构性消灭。
身份加固（§20）的收益是「让这笔预算更难被脚本吃掉」，不是「防止亏钱」。

---

## 8. 数据模型（DDL 草案，最终写入迁移文件，不执行）

### 8.1 `discount_codes` 新增列与约束

```sql
ALTER TABLE public.discount_codes
    ADD COLUMN IF NOT EXISTS allow_guest                  BOOLEAN        NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS guest_max_uses               INTEGER        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS guest_used_count             INTEGER        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS guest_max_uses_per_identity  INTEGER        NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS guest_max_discount_percent   INTEGER        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS guest_max_total_discount     NUMERIC(14,2)  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS guest_discount_used_amount   NUMERIC(14,2)  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS guest_disabled_reason        TEXT;

-- 语义：0 = 关闭。不存在「0 = 无限」。
ALTER TABLE public.discount_codes
    DROP CONSTRAINT IF EXISTS discount_codes_guest_budget_check,
    ADD CONSTRAINT discount_codes_guest_budget_check CHECK (
        guest_used_count >= 0
        AND guest_discount_used_amount >= 0
        AND guest_max_uses >= 0
        AND guest_max_uses_per_identity >= 0
        AND guest_max_discount_percent BETWEEN 0 AND 100
        AND guest_max_total_discount >= 0
    );
-- 故意**不**写 `guest_used_count <= guest_max_uses` 这类约束：
-- 事故处置时运营需要把 guest_max_uses / guest_max_total_discount **调小甚至归零**来紧急止血，
-- 如果加了这条 CHECK，`SET guest_max_uses = 0` 本身会因已用量超过新上限而失败，
-- 等于把紧急停机路径锁死。超发防护完全由 §9.3 的原子条件 UPDATE 负责。

ALTER TABLE public.discount_codes
    DROP CONSTRAINT IF EXISTS discount_codes_guest_safety_check,
    ADD CONSTRAINT discount_codes_guest_safety_check CHECK (
        NOT allow_guest
        OR (
                guest_max_uses > 0
            AND guest_max_total_discount > 0
            AND guest_max_discount_percent > 0
            AND guest_max_discount_percent <= 90      -- 永不允许 100% 券对游客开放
            AND allow_zero_total IS NOT TRUE          -- T1 / T10
            AND discount_type IN ('fixed','percent')
            AND distribution_mode = 'general_code'    -- 拒绝 user_assigned / public_claim
            AND pricing_apply_stage = 'order_discount'-- 拒绝 catalog_price / balance_offset
            AND (NULLIF(BTRIM(COALESCE(audience_segment,'')),'') IS NULL
                 OR BTRIM(audience_segment) = 'all_users')
        )
    );
-- 注意：is_active 故意不写进 CHECK。写了会导致「停用一张正在跑的券」这个动作本身
-- 违反约束而无法执行。券是否生效由 resolver 在运行时判断（§9.1 步骤 7）。
```

> `guest_max_discount_percent <= 90` 是 DB 层硬上限，即使运营误填 100 也写不进去。这是 T1 的最后一道闸。

### 8.2 `guest_shop_orders` 新增列与约束改写

```sql
ALTER TABLE public.guest_shop_orders
    ADD COLUMN IF NOT EXISTS discount_code       TEXT,
    ADD COLUMN IF NOT EXISTS discount_id         UUID,
    ADD COLUMN IF NOT EXISTS discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_snapshot   JSONB         NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS guest_session_hash  TEXT,
    ADD COLUMN IF NOT EXISTS pricing_version     TEXT          NOT NULL DEFAULT 'guest-credit-v1',
    -- 幂等归还标志：登录侧靠 shop_orders.discount_usage_restored 防止退款重复归还
    -- （20260409_discount_v2_p0_lifecycle_snapshot_refund.sql:1262-1272）。
    -- 游客侧必须有等价列，否则「反复申请退款」可以把券预算刷回无限。
    ADD COLUMN IF NOT EXISTS discount_usage_restored BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.guest_shop_orders
    DROP CONSTRAINT IF EXISTS guest_shop_orders_amount_check,
    ADD CONSTRAINT guest_shop_orders_amount_check CHECK (
        unit_amount > 0
        AND total_amount = unit_amount * quantity - discount_amount
        AND total_amount > 0
        AND total_amount >= 0.01
        AND discount_amount >= 0
        AND discount_amount < unit_amount * quantity
        AND (discount_code IS NULL OR discount_amount > 0)
        AND (guest_session_hash IS NULL OR guest_session_hash ~ '^[0-9a-f]{64}$')
    );
```

> 这条 CHECK 是整个方案里**最重要的一行**：它让「零元购」在数据库层不可表达，即使应用层全部被绕过也写不进订单。

### 8.3 商品 / SKU 游客数量上限

```sql
ALTER TABLE public.shop_product_skus
    ADD COLUMN IF NOT EXISTS guest_max_quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.shop_products
    ADD COLUMN IF NOT EXISTS guest_max_quantity INTEGER NOT NULL DEFAULT 1;
-- CHECK: guest_max_quantity BETWEEN 1 AND 99
```

### 8.4 预算与熔断表

```sql
CREATE TABLE IF NOT EXISTS public.guest_shop_promo_budget_daily (
    bucket_day     DATE        NOT NULL,
    site           VARCHAR(10) NOT NULL,
    discount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
    order_count    INTEGER     NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (bucket_day, site),
    CONSTRAINT guest_promo_budget_non_negative CHECK (discount_total >= 0 AND order_count >= 0)
);

CREATE TABLE IF NOT EXISTS public.guest_shop_promo_breaker (
    id             TEXT PRIMARY KEY,            -- 'global:cn' / 'code:<discount_id>'
    state          TEXT NOT NULL DEFAULT 'closed',
    reason         TEXT,
    tripped_at     TIMESTAMPTZ,
    reset_by       TEXT,
    reset_at       TIMESTAMPTZ,
    window_started_at TIMESTAMPTZ,
    invalid_code_count  INTEGER NOT NULL DEFAULT 0,
    quote_count         INTEGER NOT NULL DEFAULT 0,
    amount_mismatch_count INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT guest_promo_breaker_state_check CHECK (state IN ('closed','open')),
    CONSTRAINT guest_promo_breaker_non_negative CHECK (
        invalid_code_count >= 0 AND quote_count >= 0 AND amount_mismatch_count >= 0)
);

CREATE TABLE IF NOT EXISTS public.guest_shop_promo_policy (
    id                       BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),  -- 单行表
    enabled                  BOOLEAN NOT NULL DEFAULT false,
    tiered_pricing_enabled   BOOLEAN NOT NULL DEFAULT false,
    daily_budget_cny         NUMERIC(14,2) NOT NULL DEFAULT 0,             -- 0 = 不允许任何促销
    min_payable_cny          NUMERIC(14,2) NOT NULL DEFAULT 1.00,
    max_quantity             INTEGER NOT NULL DEFAULT 1,
    max_stock_hold_percent   INTEGER NOT NULL DEFAULT 20,
    max_open_orders          INTEGER NOT NULL DEFAULT 2,
    promo_order_ttl_seconds  INTEGER NOT NULL DEFAULT 600,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

`guest_shop_promo_policy` 与 env 构成**双闸**：任一为关即关。DB 闸的价值是「不改环境变量、不重启容器也能紧急停机」，env 闸的价值是「DB 被误改也开不起来」。

### 8.5 审计表

```sql
CREATE TABLE IF NOT EXISTS public.guest_shop_promo_events (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    site             VARCHAR(10) NOT NULL,
    event_type       TEXT NOT NULL,      -- quote_issued / quote_invalid_code / identity_capped /
                                         -- budget_exhausted / daily_budget_exhausted / breaker_tripped /
                                         -- order_discount_applied / discount_released /
                                         -- identity_registered_match / quote_stale / stock_hold_limit
    outcome          TEXT NOT NULL,      -- allowed / denied / error
    error_code       TEXT,
    discount_id      UUID,
    discount_code    TEXT,               -- 营销码非机密，可存明文便于运营排查
    order_id         UUID,
    product_id       UUID,
    sku_id           UUID,
    quantity         INTEGER,
    subtotal_amount  NUMERIC(14,2),
    discount_amount  NUMERIC(14,2),
    total_amount     NUMERIC(14,2),
    guest_session_hash TEXT,
    request_ip_hash    TEXT,
    request_device_hash TEXT,
    buyer_contact_hash TEXT,
    metadata         JSONB NOT NULL DEFAULT '{}'::JSONB
);
-- 索引：(created_at)、(event_type, created_at)、(discount_id, created_at)、(guest_session_hash)
-- RLS：仅 service_role 可写；后台只读视图走现有 admin RBAC
-- 严禁写入明文邮箱 / 手机号 / IP / UA / 恢复码 / claim secret
```

---

## 9. 定价权威链路（最关键的一节）

### 9.1 单一 SQL 权威函数

新增 `public.fn_guest_shop_resolve_payable(...)`，`SECURITY DEFINER`、`SET search_path = public, pg_temp`、仅 `service_role` 可执行（`REVOKE FROM PUBLIC, anon, authenticated`），返回单行记录：

```
unit_amount, quantity, subtotal, discount_amount, total_amount,
discount_id, discount_code, discount_snapshot, pricing_version, reject_code
```

内部严格执行顺序（任一步失败立即返回 `reject_code`，不抛异常给买家看细节）：

1. **双闸校验**：`guest_shop_promo_policy.enabled` 必须为 true，且调用方传入的 `p_promo_enabled_from_env` 必须为 true。任一为假 → 有券即拒（`guest_promo_disabled`），无券走原价。
2. **熔断校验**：`guest_shop_promo_breaker` 中 `global:<site>` 与该券 `code:<discount_id>` 必须都是 `closed`。
3. **商品 / SKU 校验**：`is_active`、`allow_guest_purchase`（SKU 优先，回落 product）、`delivery_type='KEY'`、非人工发货、支付通道白名单非空且合法（全部沿用现有 `fn_guest_shop_create_order` 逻辑，不重写）。
4. **数量校验**：`1 <= quantity <= min(policy.max_quantity, env cap, sku.guest_max_quantity, product.guest_max_quantity, product.max_purchase_quantity)`。阶梯价开关关闭时强制 `quantity = 1`。
5. **单价解析**：扩展 `guest_shop_resolve_credit_unit_amount`，去掉 `p_quantity IS DISTINCT FROM 1 → NULL` 的硬闸，改为按 quantity 命中阶梯规则；闪购优先于阶梯（保持现有语义：闪购生效时不叠加阶梯）。
6. **小计**：`subtotal = round(unit_amount * quantity, 2)`。
7. **券校验与折扣计算**（仅当传入了 code）：
   - 归一化 `UPPER(BTRIM(code))`，格式 `^[A-Z0-9]{4,32}$`，不合法直接 `guest_discount_unavailable`。
   - `SELECT ... FROM discount_codes WHERE code = v_code FOR UPDATE`（行锁，防并发超发）。
   - 依次校验：`is_active` / `lifecycle_status` / `starts_at` / `expires_at` / `applicable_site` / `scope_type` + `scope_product_sku_id` / `allow_guest` / `distribution_mode` / `pricing_apply_stage` / `audience_segment` / `allow_zero_total IS NOT TRUE`。
   - **所有拒绝原因收敛为同一个 `guest_discount_unavailable`**（C-E6），只有内部审计事件区分具体原因。
   - 全局额度：`max_uses = 0 OR used_count < max_uses`。
   - 游客额度：`guest_used_count < guest_max_uses`。
   - 折扣计算：
     - `percent`：`v_discount = round(subtotal * least(discount_value, guest_max_discount_percent) / 100, 2)`
     - `fixed`：`v_discount = least(discount_value, subtotal)`（`discount_value` 是积分，1:1 当 CNY 用，F1）
     - 再受 `guest_max_total_discount - guest_discount_used_amount` 剩余额度截断；截断后若为 0 → 拒绝。
     - `max_discount_quantity > 0` 时按件数比例限制参与折扣的件数（沿用登录侧语义）。
   - **折后校验**：`total = subtotal - v_discount`，必须满足 `total >= greatest(policy.min_payable_cny, env floor, 0.01)` 且 `v_discount < subtotal`。否则拒绝（不是「改成不打折」，而是明确拒绝，避免买家看到与展示不符的价格）。
8. **日预算校验**：`daily_budget_cny > 0` 且 `已用 + v_discount <= daily_budget_cny`。
9. 返回结果与 `discount_snapshot`（含 code、type、value、cap、subtotal、discount、total、pricing_version、resolver 版本号、policy 版本号）。

> quote 阶段调用同一个函数，但传 `p_mode='quote'`：**只读，不扣减**。create 阶段传 `p_mode='commit'`，在同一事务里先扣减再写单。用同一个函数保证「报价」与「成交」不可能逻辑分叉。

### 9.2 create-order 改造

`fn_guest_shop_create_order` 新增参数：`p_quantity`、`p_discount_code`、`p_guest_session_hash`、`p_promo_enabled_from_env`、`p_expected_total_amount`（可选，用于 C-E2 的一致性判定）。

事务内顺序（在现有 advisory lock 与行锁之后）：

1. 调 `fn_guest_shop_resolve_payable(p_mode => 'commit')`
2. 原子扣减券预算（§9.3）
3. 原子扣减日预算（§9.3）
4. 身份配额校验（§7.2）+ 并发未付款单校验（C-D4）
5. 库存占比校验（C-D3）
6. 预占一行库存（现有 `FOR UPDATE SKIP LOCKED` 逻辑不变）
7. 写订单（含 discount 列，受 §8.2 新 CHECK 约束）
8. 写 `guest_shop_promo_events`
9. 若传入 `p_expected_total_amount` 且与重算值不等 → `RAISE EXCEPTION 'guest_quote_stale'`（整事务回滚，预算自动归还）

### 9.3 原子扣减（防超发）

```sql
-- 券级：次数 + 金额双维度，余量不足则一行都不更新
UPDATE public.discount_codes d
   SET guest_used_count           = d.guest_used_count + 1,
       guest_discount_used_amount = d.guest_discount_used_amount + v_discount,
       used_count                 = d.used_count + 1
 WHERE d.id = v_discount_id
   AND d.is_active
   AND d.allow_guest
   AND (COALESCE(d.max_uses,0) = 0 OR d.used_count < d.max_uses)
   AND d.guest_used_count < d.guest_max_uses
   AND d.guest_discount_used_amount + v_discount <= d.guest_max_total_discount
RETURNING d.id;
-- NOT FOUND → RAISE EXCEPTION 'guest_discount_budget_exhausted'

-- 站点日预算：先 upsert 再条件更新，同样靠 WHERE 余量保证不超发
INSERT INTO public.guest_shop_promo_budget_daily AS b (bucket_day, site, discount_total, order_count)
VALUES (date_trunc('day', v_now)::DATE, v_site, v_discount, 1)
ON CONFLICT (bucket_day, site) DO UPDATE
   SET discount_total = b.discount_total + EXCLUDED.discount_total,
       order_count    = b.order_count + 1,
       updated_at     = clock_timestamp()
 WHERE b.discount_total + EXCLUDED.discount_total <= v_daily_budget;
-- 受影响行数 = 0 → RAISE EXCEPTION 'guest_daily_budget_exhausted'
```

两条语句都在 create-order 事务内，配合 §8.1 / §8.2 的 CHECK 约束，**超发在数学上不可达**：即使 1000 个并发请求同时进来，行锁 + 条件更新保证总额不会越界。

两个必须注意的实现细节（已核对现有代码）：

- **不要动 `version_no`，也不要写 `updated_at`。** `discount_codes` 表**没有 `updated_at` 列**；`version_no` 有 `NOT NULL DEFAULT 1` + `CHECK (version_no >= 1)`，语义是「规则版本」，被订单快照 `discount_version` 引用（`supabase/migrations/20260409_discount_v2_p0_lifecycle_snapshot_refund.sql:98-117`）。每次核销都 +1 会污染快照语义。
- **不要照抄登录侧的无守卫自增。** 登录侧是 `UPDATE discount_codes SET used_count = used_count + 1 WHERE code = v_code`（同文件 `:969-973`），**没有任何余量条件**，理论上并发可超出 `max_uses`。游客侧必须用上面这种带 `WHERE 余量足够` + `RETURNING` + `NOT FOUND 即抛错` 的写法，把「不超发」变成事务性质而不是应用自觉。

### 9.4 JS 侧只做展示

- `api/_lib/guest-shop/pricing.js` 新增 `resolveGuestQuoteDisplay({ unitAmount, quantity, discount })`，仅供前端渲染与 handler 计算通道费；**不得**作为金额来源。
- handler 拿到 SQL 返回的 `total_amount` 后，才调 `resolveGuestPayablePricing(total_amount, provider, summaries)` 加 1% 通道费，写回 `expected_amount` / `payment_pricing`（沿用 `guest-shop.js:1253-1282` 的现有路径）。
- 不一致处理（C-E2）：409 `guest_quote_stale` → 前端自动重新 quote 一次 → 仍不一致则展示「价格已更新，请重新确认」，**绝不自动用新价格创建支付**。

### 9.5 黄金向量 parity 测试（C-E3）

`tests/guest-shop-pricing-parity.test.js`：

- 定义一组固定 fixture（≥ 40 例），覆盖：基础价、闪购生效 / 过期、阶梯命中 / 未命中、quantity 1~5、percent 券 1/5/10/50/90/100、fixed 券 小于/等于/大于 subtotal、券过期、券非游客、预算耗尽、折后低于下限、折后为 0、非法 code 格式、INTL 站点回落 CN 价。
- 每例断言：JS 展示结果 == 期望值；并输出一份 `supabase/migrations/2026MMDD_verify_guest_shop_promo_parity.sql`（用户执行），用同一组 fixture 在 DB 侧 `SELECT` 出结果做人工/脚本比对。
- CI 里 JS 侧必须全绿；SQL 侧作为交付物，**不由 Codex 执行**。

> **已交付（2026-09-19，C-E3 完成）**：`tests/guest-shop-pricing-parity.test.js`（9 例 / **74 条黄金向量** A32·B10·C20·D12，`node --test` 9 pass / 0 fail）+ 配套只读 SQL `supabase/migrations/20260923_verify_guest_shop_promo_parity.sql`（单条 `WITH…SELECT`、32 条 group-A fixture、由测试源码生成与 JS fixture 逐字一致；**Codex 不执行**，留用户在 SQL Editor 以 service_role 跑）。权威边界、防漂移与回归读数见 `docs/guest-shop-promo-evidence.md` **§2.11** 与 `docs/guest-purchase-task-2.0.md` **§60.8.3**。readiness `promo-parity-evidence` 的「≥40 条黄金向量」一半已满足；另一半「§15.4 沙箱实机证据」仍 **0/9**，故 `ready` 仍为 **false**，不得据此宣称完成或可启用。

### 9.6 报价令牌（quote token，C-B10 / T9）

- 结构：`base64url(payload) + '.' + HMAC-SHA256(pepper, payload)`，pepper 复用 `GUEST_SHOP_SESSION_PEPPER`。
- payload：`{site, productId, skuId, quantity, discountCode, unitAmountMinor, discountAmountMinor, totalAmountMinor, sessionHash, pricingVersion, issuedAt, expiresAt}`。
- TTL 默认 300s。
- **令牌不是价格权威**：create-order 时 SQL 全量重算，令牌只用于（a）证明该 code 是在这个 session 里报价通过的、（b）触发 C-E2 的一致性比对。篡改令牌 → HMAC 失败 → 400；令牌过期 → 409 重报价。
- 令牌绑定 `sessionHash`，跨会话搬运直接失效（T9）。

### 9.7 fingerprint 扩展（C-E4 / T8）

`buildGuestRequestFingerprint` 的 canonical 对象新增：

```js
discountCode: normalizeBindingToken(input.discountCode, 'discountCode'),  // 大写归一，空串表示无券
discountAmountMinor: <int>,
pricingVersion: 'guest-promo-v1'   // 版本升级，旧 fingerprint 天然不冲突
```

效果：同一幂等键换券 / 换数量 / 换折扣额重放 → 现有 `guest_idempotency_conflict` 机制直接拒绝（`20260915_guest_shop_credit_pricing.sql` 的 `v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint` 分支）。

---

## 10. 防掏鸟蛋（库存）细则

| 控制 | 实现要点 |
|---|---|
| C-D1 数量上限 | 四处取最小值：env `GUEST_SHOP_MAX_QUANTITY`（默认 1）、`policy.max_quantity`（默认 1）、`sku.guest_max_quantity`（默认 1）、`product.max_purchase_quantity`。任一缺失按 1 处理（fail-closed）。 |
| C-D2 阶梯独立闸 | `GUEST_SHOP_PROMO_TIERED_PRICING_ENABLED=false` 时强制 `quantity=1`，此时阶梯价对游客不生效（与今天行为一致）。开启后仍受 C-D1 与 C-D3 约束。 |
| C-D3 库存占比 | create-order 内统计：`held = 该 SKU（含 source chain）当前 status='reserve' 且来源是游客单的件数`；`available = status='available' 件数`。`held / (held + available) >= max_stock_hold_percent%` → `guest_stock_hold_limit`。**登录用户购买路径完全不受影响。** |
| C-D4 并发未付款单 | 四因子并集统计 `payment_status='pending' AND reservation_status='held' AND expires_at > now()` 的单数 ≥ `max_open_orders` → 拒绝。 |
| C-D5 促销单 TTL | 有券单 TTL = `policy.promo_order_ttl_seconds`（默认 600s），原价单保持 `GUEST_SHOP_ORDER_TTL_SECONDS`（默认 1800s）。缩短 TTL 直接压缩「占着不买」的时间窗。 |
| C-D6 释放即归还 | `fn_guest_shop_release_reservation` 与退款 RPC 扩展：释放预占的同一事务内 `UPDATE discount_codes SET guest_used_count = greatest(0, guest_used_count-1), guest_discount_used_amount = greatest(0, ... - discount_amount), used_count = greatest(0, used_count-1)` + 日预算归还 + 写 `discount_released` 审计。**幂等由 `guest_shop_orders.discount_usage_restored` 标志保证**：`UPDATE ... SET discount_usage_restored = true WHERE id = v_order_id AND discount_usage_restored = false`，`NOT FOUND` 即说明已归还过，直接跳过。没有这个标志，反复退款就能把券预算刷回无限（T12）。 |

**为什么 C-D3 是掏鸟蛋的关键**：攻击者即使有 1000 个身份，也无法把某个 SKU 的可用库存全部锁死——游客最多只能占住 20%。剩余 80% 永远留给登录用户和正常游客。这是对「库存被恶意冻结」的结构性防御，不依赖识别攻击者。

---

## 11. 防券码枚举细则

1. **POST-only**（C-E8）：券码只出现在 `POST /api/shop/guest/quote` 与 `POST /api/shop/guest/orders` 的 JSON body。GET preview 收到 `code` / `discountCode` / `coupon` 任一参数 → 400 + 审计事件。
2. **统一错误**（C-E6）：不存在 / 未开游客 / 过期 / 未生效 / 站点不符 / 范围不符 / 预算耗尽 / 身份超限 / 熔断中 / 定向券 —— 全部返回同一个 `guest_discount_unavailable` 与同一句「优惠码不可用」。HTTP 状态码也统一（400），不给攻击者任何区分信号。
3. **限流三级桶**（C-C6）：`guest-shop:quote:ip`（默认 10/min）、`guest-shop:quote:session`（默认 5/min）、`guest-shop:quote:global`（默认 300/min）。复用现有持久化 fail-closed 限流（F11），限流不可用 → 503，不放行。
4. **锁定退避**（§7.4）：5 次无效 / 10 分钟 → 锁 15 分钟 → 30 分钟 → 24 小时。锁定期间不查 DB。
5. **格式白名单**：`^[A-Z0-9]{4,32}$`，拒绝 Unicode、空白、超长、含符号输入；归一化大写后再比对，避免大小写 oracle。
6. **审计**：每次无效尝试写 `guest_shop_promo_events(event_type='quote_invalid_code')`，含 session/ip/device hash，不含明文联系方式。运营可据此定位撞库来源。

---

## 12. 熔断与告警

### 12.1 触发条件（滚动 15 分钟窗口）

| 指标 | 阈值（默认，可配） | 动作 |
|---|---|---|
| 无效码率 | > 30% 且样本 ≥ 50 | 全局跳闸（该 site） |
| `amount_mismatch` 事件 | ≥ 3 | **立即全局跳闸**（这是价格权威分裂的信号，最高优先级） |
| 单码使用增速 | 1 小时内 `guest_used_count` 增量 > `guest_max_uses * 50%` | 该码单独跳闸 |
| 日预算使用率 | > 80% | 告警（不停机） |
| 日预算使用率 | ≥ 100% | 促销自动停止，原价购买不受影响 |
| 身份上限拒绝率 | > 50% 且样本 ≥ 30 | 告警 + 全局跳闸（说明正在被规模化刷） |

### 12.2 跳闸与恢复

- 跳闸 = 写 `guest_shop_promo_breaker.state='open'`。resolver 第 2 步读到 open 即拒绝所有促销。
- **不自动半开恢复**。恢复必须人工操作：后台写接口 + RBAC + 二次确认 + 原因 + 审计（沿用 `20260914_guest_shop_admin_ops.sql` 的写操作范式）。
- 紧急停机三条路径（任一即可，互相独立）：env `GUEST_SHOP_PROMO_ENABLED=false`（需重启容器）、`guest_shop_promo_policy.enabled=false`（即时生效）、`allow_guest=false` 单券关闭（即时生效）。

### 12.3 告警

复用 `api/_lib/guest-shop-alerts.js`，新增告警类型：`promo_breaker_tripped`、`promo_daily_budget_80`、`promo_daily_budget_exhausted`、`promo_amount_mismatch`、`promo_code_burst`。告警内容不含密钥、不含明文联系方式。

### 12.4 readiness 扩展（C-E7）

`scripts/guest-shop-readiness.js` 新增 `promo` 检查组：

- env 旋钮存在性与范围合法性（走 `GUEST_SHOP_RUNTIME_SETTINGS` 既有机制）。
- `GUEST_SHOP_SESSION_PEPPER` ≥ 32 字节、非占位值，且**不等于** `GUEST_SHOP_CLAIM_PEPPER` / `GUEST_SHOP_CLAIM_DERIVATION_PEPPER` / `GUEST_SHOP_CONTACT_HASH_PEPPER` / `GUEST_SHOP_REQUEST_HASH_PEPPER` / `GUEST_SHOP_WORKER_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` / `CRON_SECRET`（沿用现有「不得复用」检查范式）。
- 脏配置扫描（操作者检查项，只读）：是否存在 `allow_guest=true AND (allow_zero_total=true OR guest_max_uses=0 OR guest_max_total_discount=0 OR guest_max_discount_percent>=100)` 的券 → **退出码 2（INVALID）**。
- `guest_shop_promo_breaker` 是否有 open 行 → 退出码 3（NOT_READY）。
- `guest_shop_promo_policy` 与 env 是否一致（双闸都为关，或都为开且参数一致）。
- 促销开启但游客商品未开 → 提示（不阻断）。

---

## 13. 开关层级与灰度

```
第 0 层  env  GUEST_SHOP_PROMO_ENABLED               默认 false   主闸（重启生效）
第 0.1 层 env GUEST_SHOP_PROMO_TIERED_PRICING_ENABLED 默认 false   数量/阶梯独立闸
第 1 层  DB   guest_shop_promo_policy.enabled         默认 false   即时闸 + 全部数值旋钮
第 2 层  DB   discount_codes.allow_guest              默认 false   券级白名单
第 2.1 层 DB  discount_codes.guest_max_uses / guest_max_total_discount  默认 0 = 关闭
第 3 层  DB   shop_product_skus.allow_guest_purchase   默认 false   商品级（现有）
第 3.1 层 DB  shop_product_skus.guest_max_quantity     默认 1
第 4 层  DB   guest_shop_promo_breaker.state           默认 closed  熔断闸
```

**任何一层为关即关。** 全部打开才可能对游客生效一次折扣。

灰度顺序（每步都要有观察期与指标达标）：

1. **G0**：代码合并 + 迁移执行 + 全部开关关闭。线上行为零变化。验收：全量测试基线不回退（main 实测 3156 pass / 0 fail），readiness 退出码符合预期。
2. **G1**：只开 `TIERED_PRICING_ENABLED`，`guest_max_quantity=1`（即阶梯实际不生效），验证数量闸与库存占比闸工作正常。
3. **G2**：单个低价值 SKU（¥0.01 沙箱 SKU 或最低价真实 SKU）+ 单张 percent 10% 券，`guest_max_uses=5`、`guest_max_total_discount=¥50`、`daily_budget=¥50`。内部白名单 IP 实测。
4. **G3**：放开该券到 `guest_max_uses=50`，观察 48 小时：无效码率、身份上限拒绝率、`amount_mismatch`=0、库存占比未触顶、预算未异常消耗。
5. **G4**：扩到多 SKU / 多券，仍保留日预算硬上限。
6. **G5**：用户签署本文第 14 节灰度许可后，才算「游客促销已启用」。

**任一阶段出现 `amount_mismatch` ≥ 1 立即回到 G0 并跳闸。**

---

## 14. 分期落地计划

| 期 | 内容 | 可独立合并 | 线上行为变化 | 依赖 |
|---|---|---|---|---|
| **L0** | 迁移文件（新表 / 新列 / CHECK / 单行 policy 表）、env 旋钮骨架、readiness `promo` 组、契约测试、文档 | ✅ | **无**（全部默认关） | 无 |
| **L1** | SQL resolver 支持 quantity + 阶梯；JS 展示；SKU `guest_max_quantity`；库存占比闸（C-D3）；并发单闸（C-D4）；促销 TTL（C-D5） | ✅ | 无（受 `TIERED_PRICING_ENABLED=false` 保护） | L0 |
| **L2** | 游客会话（表 + cookie + pepper）、`POST /api/shop/guest/quote`、券校验分支、预算原子扣减、身份并集配额、注册账号碰撞、锁定退避、审计、熔断 | ⚠️ 必须与 L3 同批 | 无（受 `PROMO_ENABLED=false` 保护） | L0 L1 |
| **L3** | create-order 内重算 + 新 CHECK 生效 + quote 令牌绑定 + fingerprint 扩展 + parity 测试 + 演练脚本 + 运行手册更新 | ⚠️ 必须与 L2 同批 | 无（同上） | L0 L1 |
| **L4** | 后台运营界面：券的 `allow_guest` / 游客预算 / 熔断状态 / 审计查询 / 手动恢复熔断（RBAC + 二次确认 + 原因 + 审计） | ✅ | 无 | L2 L3 |

> **L2 与 L3 拆开发布是禁止的**：只发 L2 会出现「前端能报价、后端不认账」，直接产生 `amount_mismatch`（已付款不发货）。只发 L3 会出现「后端能算、前端拿不到报价」。

每期交付物固定四件套：迁移文件（写盘不执行）+ verify SQL + 自动化测试 + 文档更新（本文 + `docs/guest-shop-payment-fulfillment-runbook.md` + `docs/guest-purchase-task-2.0.md` 的任务 2.1 §61）。

### 灰度许可签署（用户填写）

- [ ] 我已确认第 16 节全部数值旋钮
- [ ] 我已在目标环境执行 L0~L3 迁移文件（Codex 未执行任何 SQL）
- [ ] 我确认 `readiness:guest-shop --fail-on-invalid` 通过
- [ ] 我同意从 G2 开始灰度，且理解「发布 ≠ 启用」
- [ ] 我授权启用灰度 SKU 与灰度券：________________（券码 / SKU）
- 签署时间：__________

---

## 15. 测试计划

### 15.1 单元测试（新增 / 扩展）

| 文件 | 覆盖 |
|---|---|
| `tests/guest-shop-pricing-parity.test.js`（新） | §9.5 黄金向量，JS 展示逻辑与期望值逐项一致（≥ 40 例） |
| `tests/guest-shop-promo-resolver.test.js`（新） | resolver 拒绝矩阵：每种 `reject_code` 都有用例；折扣计算边界；percent/fixed 截断；折后下限；日预算 |
| `tests/guest-shop-promo-budget.test.js`（新） | 预算原子性：并发扣减模拟（同一券 N 个并发请求，断言成功数 == `guest_max_uses`，扣减总额 ≤ `guest_max_total_discount`） |
| `tests/guest-shop-promo-identity.test.js`（新） | 四因子并集计数；分因子阈值；注册账号碰撞拒绝；会话丢失只收紧不放松 |
| `tests/guest-shop-promo-breaker.test.js`（新） | 各阈值跳闸；open 状态拒绝；人工恢复；不自动半开 |
| `tests/guest-shop-security.test.js`（扩展） | fingerprint 含 code/qty/discount；换券重放 → `guest_idempotency_conflict`；quote 令牌篡改 / 过期 / 跨会话 |
| `tests/guest-shop-readiness.test.js`（扩展） | `promo` 检查组；pepper 独立性；脏配置 → 退出码 2；breaker open → 退出码 3 |

### 15.2 契约测试（扩展 `tests/guest-shop-frontend-contract.test.js`）

必须新增断言：

- `js/guest-shop-client.js` 中优惠码**不得**出现在任何 URL / query / `localStorage` / `sessionStorage` 写入。
- quote 端点必须是 POST；GET preview 的参数白名单里**不得**出现 `code` / `discountCode` / `coupon`。
- 会话 cookie 名必须是 `__Host-` 前缀且设置 `HttpOnly` / `Secure` / `SameSite=Strict`。
- 沿用现有隔离断言：`guest-shop-client.js` 不得出现 `supabase` / `access_token` / `Authorization` / `Math.random()`。
- `shop.html` 中 `guest-shop-client.js` 的 `?v=` cache bust 必须升级（现有测试对版本号有硬编码断言）。

### 15.3 回归

- 全量：`node --test --test-force-exit tests/*.test.js`。**main（`2424dcc14`）实测基线：3156 tests / 3156 pass / 0 fail / 58.6s**（已在本工作树复核）。`codex/guest-shop-entry-merge` 因新增 1 个契约测试为 3157。合并本任务后 pass 数只允许增加，fail 必须为 0。
- 登录用户积分购买、折扣码、购物车、后台订单 / 库存流程零回归（这是 `docs/guest-purchase-task-2.0.md` §0.2 第 2 条的既有要求）。

### 15.4 沙箱实机验证（**由用户执行，Codex 不执行 SQL、不启用商品**）

1. ¥0.01 沙箱 SKU + percent 10% 券：应付 = 0.01 - 0.00（round 后为 0.00）→ 必须被 `min_payable` 拒绝（验证 C-B9 生效，而不是产生 0 元单）。
2. 换 ¥10 SKU + percent 10% 券：应付 = 9.00 + 1% 通道费（ceil）= 9.09，实际支付 9.09 → 正常发货。
3. 故意支付 9.00（少付手续费）→ webhook `amount_mismatch`，**不发货**，熔断计数 +1。
4. `guest_max_uses=2` 的券，第 3 次使用 → `guest_discount_unavailable`，且 `guest_used_count` 停在 2（验证 §9.3 原子性）。
5. **反杀熟（H1，断言方向与旧版相反）**：同一张券、同一个 SKU，
   「已注册邮箱的游客会话」与「全新邮箱的游客会话」的折后金额必须**逐分相等**；
   两边都必须能用券，都不得返回 `guest_discount_unavailable`。
   同时断言 `registered_user_match` 在两边取值不同（证明判定确实跑了），
   但**金额相同**（证明判定没有进入定价）。这条测试是 §22.5 的守门员，**不可删除**。
6. **H2 入参白名单**：断言定价 resolver 的入参对象不含 `registered_user_match`、
   `merged_into_user_id`、`buyer_id`、`credential_group_no`、`failed_login_count`、
   `last_login_at`、`email_verified_at` 任一字段（字段清单与
   `docs/guest-shop-order-access-2.0.md` §16.1 保持一致；`guest_shop_buyers` 已无
   `order_count` 列，见该文档 §5.1）。
7. 批量创建不付款单 → 触达 C-D3 / C-D4 后拒绝；TTL 到期后库存与预算同时归还（验证 C-D6 / C-C5）。
8. 手动把 `guest_shop_promo_breaker` 置 open → 促销全停、原价可买；后台恢复 → 促销恢复。
9. 日预算打满 → 促销停止、原价可买、告警发出。

### 15.5 演练与归档

按 `docs/guest-purchase-task-2.0.md` 的证据要求，把 15.4 的结果归档到 `docs/guest-purchase-d-sandbox-evidence.md`（或新建 `docs/guest-shop-promo-evidence.md`）。**没有实机证据不得宣称完成。**

---

## 16. 需要你确认的数值旋钮

| # | 旋钮 | 默认值 | 建议范围 | 影响 | 我的推荐 |
|---|---|---|---|---|---|
| K1 | `GUEST_SHOP_PROMO_ENABLED` | `false` | true/false | 主闸 | 灰度前保持 false |
| K2 | `GUEST_SHOP_PROMO_TIERED_PRICING_ENABLED` | `false` | true/false | 游客能否 quantity>1 并享阶梯价 | **先 false**，L1 单独观察一轮再开 |
| K3 | `GUEST_SHOP_MAX_QUANTITY` | `1` | 1~99 | 游客单笔件数硬上限 | **1**（开阶梯时再提到 3 或 5） |
| K4 | `guest_max_quantity`（SKU 级） | `1` | 1~99 | 单 SKU 游客件数 | 按 SKU 单独设，默认 1 |
| K5 | `GUEST_SHOP_PROMO_MIN_PAYABLE_CNY` | `1.00` | 0.01~50 | 折后最低应付 | **1.00**（低于 1 元的单没有商业意义，且是零元购缓冲带） |
| K6 | `guest_max_discount_percent`（券级） | `0`（=关） | 1~90 | 单券最大折扣率，DB 硬顶 90 | 常用 10~30，**永不开 100** |
| K7 | `guest_max_uses`（券级） | `0`（=关） | 1~100000 | 单券游客总次数 | 先 5（G2），再 50（G3） |
| K8 | `guest_max_total_discount`（券级） | `0`（=关） | 0.01~ | 单券游客总金额预算 | 按营销预算填，G2 用 ¥50 |
| K9 | `guest_max_uses_per_identity` | `1` | 1~5 | 每身份每码次数 | **1** |
| K10 | `daily_budget_cny`（站点级） | `0`（=不允许促销） | 0~ | 每日促销总花费硬顶 | G2 ¥50，G3 ¥500，正式 ¥2000 起 |
| K11 | `max_stock_hold_percent` | `20` | 5~50 | 游客最多占住多少比例库存 | **20** |
| K12 | `max_open_orders`（每身份） | `2` | 1~5 | 并发未付款单 | **2** |
| K13 | `promo_order_ttl_seconds` | `600` | 300~1800 | 促销单支付窗口 | **600** |
| K14 | 会话有效期 | 7 天 | 1 小时~30 天 | 身份锚点寿命 | 7 天（越长配额越难绕） |
| K15 | 无效码锁定 | 5 次 / 10 分钟 → 锁 15 分钟 | — | 撞库成本 | 保持默认 |
| K16 | quote 限流 | ip 10/min、session 5/min、global 300/min | — | 枚举速度 | 保持默认 |
| K17 | 熔断：无效码率 | 30%（样本 ≥ 50） | 10%~50% | 停机灵敏度 | **30%** |
| K18 | 熔断：`amount_mismatch` | ≥ 3 | 1~10 | 价格分裂停机 | **1**（最保守，一次就停） |
| K19 | IP 因子每日上限 | 20 | 5~200 | NAT 误伤风险 vs 防洪强度 | **20** |
| K24 | `max_pending_quantity_per_ip_product` | `2` | 1~50 | 单 IP 对**单个商品**最多能占住多少件未付款库存（吸收自 Dujiao-Next） | **2** |
| K20 | 游客用券是否必填联系方式 | **必填** | 必填 / 选填 | 身份可信度 vs 转化率 | **必填**（这是整个配额体系的地基；选填会让 C-A2 退化） |
| K21 | 带折扣的 quote 是否前置人机校验（§20-A） | **开** | 开 / 关 | 脚本化薅羊毛的入门成本 | **开**；国际站 Cloudflare Turnstile，国内站需评估腾讯防水墙/极验的可用性与合规 |
| K22 | 触发邮箱 OTP 的折扣阈值（§20-B） | 折扣 ≥ ¥20 或折扣率 ≥ 20% | — | 大额优惠的身份可信度 | **开**：小额免验证保转化，大额必须 OTP；OTP 通过后 `contact_hash` 才升级为「已验证因子」并放宽阈值 |
| K23 | 大额折扣是否强制登录 | 折扣 ≥ ¥200 强制登录 | — | 最后一道身份闸 | 建议**开**；这条线之上不再有「游客」概念 |

> K20 是唯一会明显影响转化率的决策。如果选「选填」，则必须接受：无联系方式的游客单只能按 session/ip/device 计数，清 cookie + 换 IP 即可重置配额，防刷强度下降一个量级。我的建议是**必填**，并把文案写成「用于订单通知与售后」，这本来就是真实用途。

---

## 17. 硬性禁止（继承 `AGENTS.md`，本任务额外强调）

1. **Codex 不执行任何 SQL**。迁移文件写盘 + 给绝对路径，由用户执行。
2. **不在部署中启用游客商品、游客 SKU、游客促销开关**。
3. **不从功能分支做 `vercel deploy --prod`**。游客相关改动走专用分支 → PR → 合并 `main` → Git 集成部署。
4. **不打印** `GUEST_SHOP_*` 任何密钥值、claim token、恢复码。
5. **不复用** `CRON_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` 作为 `GUEST_SHOP_SESSION_PEPPER`。
6. **不降低** webhook 与 `fn_guest_shop_confirm_payment` 的任何校验严格度。
7. **不绕过** DB CHECK 约束。若约束阻碍功能，改约束定义（保持 `total_amount > 0` 不变），绝不 `DROP CONSTRAINT` 了事。
8. **不把优惠码放进 URL / query / localStorage / sessionStorage / 日志 / provider metadata**。
9. **不用 `|| true` 绕过 readiness 失败**；退出码 3 是预期 fail-closed。
10. **回滚不用 DB 回滚**，用开关。
11. **L2 与 L3 不得拆开发布。**
12. 没有第 15.4 节实机证据，不得宣称游客促销「完成」或「可启用」。

---

## 18. 交付物清单

### 迁移文件（写盘，不执行）

- `supabase/migrations/2026MMDD_guest_shop_promo_hardening.sql` — §8 全部 DDL + §9.1 resolver + §9.2 create-order 改造 + §9.3 原子扣减 + C-D6 释放归还 + 授权（REVOKE/GRANT）
- `supabase/migrations/2026MMDD_verify_guest_shop_promo_hardening.sql` — 约束存在性、函数定义关键字校验、脏配置扫描、黄金向量 parity 查询
- `supabase/migrations/2026MMDD_rollback_guest_shop_promo_hardening.sql` — 仅用于本地演练；生产回滚是关开关

### 代码

- `api/_lib/guest-shop/pricing.js` — 展示层扩展（非权威）
- `api/_lib/guest-shop/security.js` — 会话签发 / 加解密、quote 令牌、fingerprint 扩展、`normalizeGuestOrderInput` 扩展
- `api/_lib/guest-shop/runtime-config.js` — 新 env 旋钮声明（走既有 `GUEST_SHOP_RUNTIME_SETTINGS` 机制）
- `server/api-handlers/public/guest-shop.js` — `POST quote`、orders 改造、注册账号碰撞、限流桶、审计写入
- `api/shop/guest/quote.js` — 新 Vercel 路由（反代到 verify server，沿用现有 `/api/shop/:path*` 规则）
- `js/guest-shop-client.js` — 报价 UI、错误处理、409 重报价、cache bust 升级
- `shop.html` — `?v=` 版本号升级
- `admin-discounts.js` — 券的游客字段编辑 + 熔断状态 + 审计查询（L4）
- `scripts/guest-shop-readiness.js` — `promo` 检查组

### 测试

见 §15.1 / §15.2 文件清单。

### 文档

- 本文（设计合同）
- `docs/guest-shop-payment-fulfillment-runbook.md` — 增补促销章节：开关层级、紧急停机三路径、熔断恢复、预算归还核对
- `docs/guest-purchase-task-2.0.md` — 任务 2.1 §61 的促销任务条目与完成标准
- `docs/guest-shop-promo-evidence.md`（新）— 实机证据归档

---

## 19. 一句话总结

**先给游客造一个服务端可计数的身份，再把促销花费变成数据库层的原子硬预算，最后才把优惠码、阶梯价、闪购接进去；所有开关默认全关，金额权威只在 SQL 里，零元购在 DB CHECK 层就不可表达，掏鸟蛋被库存占比闸结构性挡住，异常自动熔断且只能人工恢复。** 这样「登录用户能享受的优惠游客也能享受」这个诉求成立的同时，损失上限是一个你亲手填进去的数字，而不是攻击者的想象力。

---

## 20. 身份加固升级选项（A–D，待你选）

前提：§7.5 已说明，这些选项**都不改变损失上限**（上限由预算与 CHECK 决定），
它们改变的是「预算被脚本吃掉的难度」。按 ROI 排序：

### A. 人机校验前置（推荐，ROI 最高）

- 落点：`POST /api/shop/guest/quote`（带 code 的那条）与 `create-order`。
- 不带优惠码的原价报价/下单**不加**验证码，避免伤害正常游客转化。
- 国际站 Cloudflare Turnstile（免费、无感、站点已在 Cloudflare）；国内站 Turnstile
  可达性需实测，备选腾讯防水墙 / 极验。**校验必须在服务端做**（siteverify），
  前端 token 只作为入参。
- 失败语义：`429 guest_human_check_required`，不消耗券查询、不计入无效码锁定。
- 成本：新增一个 env 密钥对 + 一个服务端校验函数 + 前端一处挂载点；约 0.5～1 天。

### B. 风险分级验证（推荐与 A 同做）

- 小额折扣（< K22 阈值）：A 通过即可，不验证邮箱。
- 中额折扣（≥ K22）：邮箱 OTP（复用仓库现有邮件通道；OTP 存哈希、5 分钟有效、
  3 次失败作废、每邮箱每日上限）。
- 大额折扣（≥ K23）：直接要求登录，返回 `login_required_for_discount`。
- 价值：OTP 通过后，`contact_hash` 才真正变成「不可任意伪造」的因子，
  §7.2 表格里它的稳定性评级可以从「可伪造」升为「高」。
- 成本：OTP 表 + 发信 + 校验 + 前端两步 UI；约 1～2 天。

### C. 支付行为信号（可选，L4 之后再做）

- 把退款率 / 拒付率 / `amount_mismatch` 次数作为身份因子的**惩罚项**写进配额：
  同一 `contact_hash` 或 `ip_hash` 历史拒付 ≥ 1 → 直接 `promo_disabled`。
- 价值：伪造这个信号要花真钱（先付款再拒付），是唯一攻击者无法零成本刷的因子。
- 成本：低，但要等真实数据积累；建议 L4 管理台一起做。

### D. 更强的设备指纹（**不推荐**）

- Canvas/WebGL/字体指纹会与 `tests/guest-shop-frontend-contract.test.js` 的隔离约定冲突
  （游客脚本不得触碰登录态相关基础设施），带来隐私合规面，且与专业作弊工具是长期军备竞赛。
- 现 UA-only 指纹保留为「粗粒度洪泛抑制」即可，阈值已按低可信度放宽（§7.2）。

**我的建议：A + B 同做，C 排到 L4，D 放弃。** 这样 §7.2 的四因子里有两个（session、verified contact）
具备真实抗伪造性，配额体系才不是纸面上的。

---

## 21. 先例对照：Dujiao-Next（独角发卡 Go 版）如何处理游客身份

> 来源：`https://github.com/dujiao-next/dujiao-next`（`main`，浅克隆核对，2026-09-17）。
> 下列行号/文件名为核对时的实际路径，便于复查。

### 21.1 核心结论：它没有「解决」游客身份，而是**绕开**了这个问题

独角把促销分成两类，只有一类需要身份：

| 促销类型 | 独角实现 | 是否有状态 | 是否做游客身份限制 |
|---|---|---|---|
| 闪购 / 活动价 | `internal/modules/promotion/domain/promotion.go` — 只有 `ScopeRefID / Type / Value / MinAmount / StartsAt / EndsAt / IsActive`，**没有任何 usage / quota / user 字段** | 无状态价格规则 | **不做**。游客与会员同价，天然共享 |
| 阶梯价（批发价） | `internal/modules/catalog/product/domain/pricing.go:151 ResolveWholesaleUnitPriceForSKU` — 纯按 `MinQuantity` 档位算 | 无状态价格规则 | **不做** |
| 会员折扣 | 依赖 `memberLevelID` | 有状态（绑定账号） | 游客 `memberLevelID=0` → 自动排除 |
| 优惠码 | `internal/modules/coupon/*` | **有状态、可兑换资源** | **放弃 per-user，改用全局总量 + 角色白名单 + IP 风控 + 验证码** |

**关键代码事实**（`internal/modules/coupon/application/service.go:69`）：

```go
if coupon.PerUserLimit > 0 && userID != 0 {   // ← 游客 userID == 0，整段跳过
    count, err := s.usageRepo.CountByUser(coupon.ID, userID)
    ...
}
```

即：**独角的「每人限用 N 次」对游客完全不生效。** 它承认游客身份不可计数，转而只依赖
「这张券总共能被用 N 次」。

### 21.2 它靠什么兜底（与身份无关的四层）

1. **券的全局总量 + 事务内行锁重查**（`internal/modules/order/application/order_service.go:645-678`）：
   下单事务里先取 `lockedCoupon`（行锁），**再查一次** `UsageLimit/UsedCount` 与
   `PerUserLimit`，然后 `Create(CouponUsage)` + `IncrementUsedCount(+1)`。
   `DecrementUsedCount` 带 `WHERE used_count >= delta` 防止减成负数。
2. **券的角色/等级白名单**：`Coupon.PaymentRoles`（`guest` / `member`，留空不限）与
   `Coupon.MemberLevels`。`resolveCouponPaymentRoleError` 还会区分
   `ErrPaymentRoleGuestOnly` / `ErrPaymentRoleMemberOnly` 给出精确文案。
   → 定向券天然不发到游客手里。
3. **零元购**：`order_service_validate.go:339` `if totalAmount.LessThanOrEqual(decimal.Zero) { return nil, ErrInvalidOrderAmount }`。
   券折扣先被 clamp 到 `MaxDiscount`，再 clamp 到 `eligibility.subtotal`，最后由这一行兜底。
   **注意：这是应用层拦截，不是 DB CHECK。**
4. **IP 风控 + 验证码**（`internal/modules/orderrisk/`、`internal/modules/captcha/`）：
   - `NormalizeRiskIP`：IPv4 用完整地址，**IPv6 按 /64 前缀聚合**（`contract/types.go`）。
   - 游客默认值（`settings/schema/security/order_risk_control.go:60-72`）：
     `MaxPendingOrdersPerIP=2`、`MaxQuantityPerProductPerOrder=1`、
     `MaxPendingQuantityPerIPProduct=2`、`PaymentExpireMinutes=10`、
     限流 `60s / 3 次 / 封 120s`。会员侧默认 `MaxPendingOrdersPerUser=5`、`60s/10次`。
   - **总开关 `Enabled: false` 默认关闭**，注释明写「避免静默改变订单行为」。
   - **fail-closed**：策略需要 IP 而 `RiskIP == ""` → `ErrClientIPUnavailable` 直接拒单。
   - **事务内加锁再计数**：`gate.LockRiskKeys([]string{"guest:ip:" + RiskIP})` 后才
     `CountPendingGuestByRiskIP` / `SumPendingGuestQuantityByRiskIP`，注释要求
     「必须在订单事务内、创建父订单和锁库存之前调用」，且「事务内禁止再次读取独立设置仓储」
     （配置快照 `ConfigSnapshot` 从事务外带入）。
   - 限流用 Redis Lua 固定窗口（`infrastructure/redislimiter/limiter.go`），
     键为 `dj:risk:order_rate:guest_ip:<riskIP>`；**Redis 不可用或脚本报错时 `return nil`（放行）**。
   - 验证码：`CaptchaSceneGuestCreateOrder = "guest_create_order"`
     （`internal/constants/constants.go:352`），provider 支持 `image` / `turnstile` / `none`，
     在 `order/transport/http/create_handler.go:139,213` 的下单入口调
     `VerifyGuestCreateOrder(payload, c.ClientIP())`，**服务端校验**，错误分
     `ErrRequired / ErrInvalid / ErrConfigInvalid` 三档。场景化开关（login / register_send_code /
     reset_send_code / guest_create_order / gift_card_redeem）可单独启停。

### 21.3 独角的「游客身份」到底是什么

**邮箱 + 自设查询密码**，且**只用于取货，不用于配额**：

- 下单必填 `GuestEmail`（`ErrGuestEmailRequired`）与 `GuestPassword`
  （`order_service.go:799 validateGuestPassword`，只校验非空 + 最小长度）。
- 查订单 / 下载卡密都要 `email + password`（`order/transport/http/guest_handler.go`，
  `ginutil.GetGuestCredentials`）。
- **邮箱不验证、不发 OTP**。所以它是一个「取货凭证」，不是「身份」。

### 21.4 与本方案的逐条对照

| 维度 | Dujiao-Next | 本方案 | 判断 |
|---|---|---|---|
| 游客配额锚点 | 无（`userID==0` 跳过 per-user） | 服务端会话 + 四因子并集 | 本方案更强，但成本更高；独角证明了「不做也能活」 |
| 券总量 | 全局 `UsageLimit`（**只有次数，没有金额**） | `guest_max_uses` + `guest_max_total_discount` + 站点 `daily_budget_cny` | **本方案更强**：独角的损失上限＝`UsageLimit × MaxDiscount`，运营易算错 |
| 扣减原子性 | 事务内行锁 + 重查 + `used_count+1` | 条件 UPDATE 看受影响行数，同事务 | 两者都正确；条件 UPDATE 对锁顺序更不敏感 |
| 零元购 | 应用层 `total<=0` 拒绝 | **DB CHECK**，数学上不可表达 | **本方案更强**：后台补单 / 数据修复脚本绕不过 CHECK |
| 定向券外泄 | `PaymentRoles` + `MemberLevels` | `audience_segment` / `distribution_mode` / `pricing_apply_stage` 的 DB CHECK 组合禁止 | 思路一致；本方案落在约束层 |
| 掏鸟蛋 | per-IP 未付单 ≤2 + **per-IP-per-商品 pending 数量 ≤2** + 单品单笔 ≤1 + TTL 10min + 事务内锁 | 游客占库存 ≤20% + 每身份 ≤2 单 + TTL 600s | **独角的 per-IP-per-商品维度更细，应吸收**（§21.5-2） |
| 人机校验 | **已落地**（Turnstile / 图片，场景化） | 列为待选项 A（§20-A） | 独角验证了 A 的工程可行性与落点 |
| fail-closed | 拿不到 IP 直接拒；总开关默认关 | P2/P3 默认全关 + fail-closed | 一致 |
| 熔断 | **无** | §12 自动跳闸 + 人工恢复 | **本方案更强** |
| 限流降级 | Redis 故障 → 放行（fail-open） | 促销异常 → 拒绝促销但允许原价（P10） | 语义不同但都经过思考；本方案的限流应显式声明 fail-open/fail-closed |

### 21.5 吸收进本方案的四条改动

1. **L1 可以脱离身份层提前上线。** 阶梯价与闪购是**无状态价格规则**，独角对游客完全开放且
   没有出过配额问题。本方案原先把 L1 排在 L2（会话身份）之后属于过度保守。
   → 修订 §14：L1 只依赖「DB CHECK 零元购 + 单品单笔件数上限 + per-IP pending 上限 + 熔断」，
   **不依赖 `guest_shop_sessions`**。L2/L3（优惠码 + 金额权威）仍必须捆绑。
2. **新增 per-IP-per-商品 的 pending 数量上限**（对应独角 `MaxPendingQuantityPerIPProduct`），
   与「游客占比 ≤20%」并存：占比闸防全局掏空，单品闸防某个热门 SKU 被单点掏空。
   → 新增旋钮 K24（默认 2）。
3. **验证码做成场景化开关**，而不是一个全局布尔：`guest_quote_with_code` /
   `guest_create_order_with_discount` 两个场景独立启停，**原价链路永不加码**。
   → 修订 §20-A 的落点描述。
4. **限流的降级语义必须显式写明**：独角在 Redis 故障时 fail-open。本方案选择
   **促销链路 fail-closed（拒绝促销）、原价链路 fail-open（允许下单）**，
   并要求限流器故障写审计事件 + 计入熔断指标。

### 21.6 不照抄的四条

1. 不照抄「游客跳过 per-user 限制」——我们要的是「游客也能享福利」，不是「游客无限享福利」。
2. 不照抄「零元购只在应用层拦」——必须落 DB CHECK。
3. 不照抄「只有次数预算、没有金额预算」——必须有 `guest_max_total_discount` 与站点日预算。
4. 不照抄「IP 是唯一游客风控键」——保留服务端会话锚点，否则移动网络换 IP 即重置配额。

---

## 22. 与「游客订单访问 2.0」的联动（后续修订，2026-09-18）

> 来源：`docs/guest-shop-order-access-2.0.md`。该文档把游客订单的找回凭证从
> 「订单号 + 取货口令」改为「邮箱 + 自设查询密码」（对齐 Dujiao-Next 的用户体验），
> 并新建归一化买家表 `guest_shop_buyers`。它对本方案的身份层有**实质性反哺**，
> 本节记录需要随之修订的条款；**冲突时以本节为准**。

### 22.1 §7.2 计数谓词修订：主判据换成凭证保护的 `buyer_contact_hash`

2.0 之后邮箱从「选填」变「**下单必填**」，且受查询密码保护。这使 `buyer_contact_hash`
从 §7.2 原来评的「未验证前＝可伪造」升级为**可信主判据**：攻击者要复用同一邮箱刷额度，
必须知道该邮箱的查询密码，批量薅羊毛从「改一个字符串」变成「逐个管理邮箱+密码对」的簿记负担。

| 因子 | 本方案原评级 | 2.0 之后 | 处置 |
|---|---|---|---|
| `buyer_contact_hash` | 可伪造（仅 HMAC，无 OTP） | **高** | **主判据**，阈值最严（每码 1 / 每日 3） |
| `guest_session_hash` | 中 | 中 | **兜底**：覆盖未走凭证链路的降级下单（每码 1 / 每日 3） |
| `request_ip_hash` | 低 | 低 | **粗防洪**兜底，阈值最宽（每码 3 / 每日 20） |
| `request_device_hash` | 低（仅 UA） | 低 | **从判据中移除** |

移除 `request_device_hash` 的理由：它只由 UA 派生，误伤 NAT / 同型号用户的代价高于防薅收益；
独角的游客风控键同样只有 IP（§21.2）。移除后 §7.2 的分因子阈值表少一行，其余阈值不变。

修订后的谓词（取代 §7.2 的四因子 OR）：

```sql
AND (
      (p_contact_hash IS NOT NULL AND o.buyer_contact_hash = p_contact_hash)   -- 主判据
   OR (p_session_hash IS NOT NULL AND o.guest_session_hash = p_session_hash)   -- 兜底
   OR (p_ip_hash      IS NOT NULL AND o.request_ip_hash    = p_ip_hash)        -- 粗防洪
)
```

> 实现注意：**按因子分别设阈值**的机制必须保留（`contact_hash` 最严、`ip_hash` 最宽），
> 不得因为换了主判据就退化成单一全局阈值，否则又会把 NAT 后的无辜买家一起封掉。

#### 22.1.1 ⚠️ `buyer_id` **不是**配额因子（最容易写错的一条）

2.0 的 §6.4 引入了「凭证分组」：同一个邮箱允许存在 ≤3 套互不可见的查询密码
（用于「用户忘了密码仍能下新单」且「后下单者读不到先下单者的卡密」）。
因此 `guest_shop_buyers.id` / `guest_shop_orders.buyer_id` **只用于访问控制**，
**绝不能用作配额计数键**——否则攻击者只要不停新建凭证分组，就能无限刷新促销额度。

| 用途 | 键 | 理由 |
|---|---|---|
| 访问控制（能看哪些订单/卡密） | `buyer_id`（单分组，严格隔离） | 防卡密串号，2.0 §6.4.2 |
| **配额计数**（促销次数/金额） | **`buyer_contact_hash`（跨该邮箱全部分组并集）** | 防「换密码刷额度」，2.0 §6.4.5 |

好消息：`guest_shop_orders.buyer_contact_hash` 是**已存在的列**
（`supabase/migrations/20260913_add_guest_shop_cash_purchase.sql:130`），计数无需 join 新表。

### 22.2 §7.5 诚实声明可以下调一档，但结论不变

§7.5 原文承认「`contact_hash` 不验证、不抗伪造，身份层只能提高成本、不能杜绝」。
2.0 引入查询密码后，攻击者要复用同一邮箱必须**先知道该邮箱的查询密码**，批量薅羊毛从
「零成本改一个字符串」变成「逐个管理邮箱+密码对」的真实簿记负担。

**但 §7.5 的核心结论不变**：结构性上限（DB CHECK 零元购、单品单笔件数上限、per-IP pending
上限、券级 / 站点级金额预算、熔断）仍然是承重墙，身份层仍然只是成本项。
**不得因为 2.0 而放松任何一条硬上限。**

### 22.3 §14 分期修订

2.0 的 A0–A3（订单访问）与本方案的 L0–L1（促销 DDL + 无状态定价）**写集合不相交，可并行**。
A4（邮箱 OTP + 游客订单并入账号）**必须排在 L2 之后**，因为它依赖本方案的 OTP 设施与
§7.2 的因子升级。完整顺序见 2.0 文档 §19。

### 22.4 开关与降级语义

| 开关 | 默认 | 关系 |
|---|---|---|
| `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED` | `false` | 2.0 主闸；关闭时 `buyer_id` 为 NULL，配额自动退回 session + ip 兜底 |
| `GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED` | `false` | 新查询页 `/guest-orders.html` 是否可访问 |
| `GUEST_SHOP_PROMO_ENABLED` | `false` | 本方案 K1，不变 |

**降级语义（必须实现并测试）**：`BUYER_CREDENTIAL_ENABLED=false` 而促销已开启时，
邮箱为选填、`p_contact_hash` 可能为 NULL，配额必须自动退化为 `session + ip` 两因子继续工作，
**绝不能 fail-open 成「没有主判据就不限额」**。这条要进 readiness 检查项与 §15 的测试用例。

> 反过来说：一旦 2.0 上线，邮箱成为下单必填，`p_contact_hash` 恒有值，
> 配额体系第一次拥有了一个**用户主动维护、跨会话跨设备稳定**的主判据。
> 这正是 §7.5 承认的「身份层只能提高成本」被实质性改善的地方——但 §7.5 的结论仍然成立（§22.2）。

### 22.5 ⚠️ 反杀熟硬约束（2026-09-18 由用户提出，已废弃原 §7.3 定价歧视）

原 §7.3 让「邮箱命中注册账号」的游客**用不了优惠码**，等价于：**老用户用真实邮箱下单，
价格比陌生人更高**。这是典型的大数据杀熟，必须废弃。§7.3 已改为「只记录，绝不影响价格」。

#### 22.5.1 四条不可协商的硬约束

| # | 约束 | 验证方式 |
|---|---|---|
| H1 | **同一张券 + 同一个 SKU + 同一个邮箱，折后价格必须逐分一致**，与「该邮箱是否注册」「是否登录过」「历史消费多少」全部无关 | 集成测试：注册邮箱与全新邮箱对同一券同一 SKU 报价，断言金额完全相等 |
| H2 | `registered_user_match`、`merged_into_user_id`、`buyer_id`、`credential_group_no`、`failed_login_count`、`last_login_at` 等**任何身份/历史字段，都不得出现在定价 resolver 的输入里**（`guest_shop_buyers` 已无 `order_count` 列，见 2.0 文档 §5.1） | 代码审查 + resolver 入参白名单测试（断言入参结构体不含这些字段） |
| H3 | 券的受众定向只能是**券级、商家主动勾选、对所有符合条件者一致**的配置，不能是平台按用户身份自动加价 | C-B7 已限制游客券 `audience_segment ∈ (NULL,'all_users')`；如需「仅限新客」活动，须走独立功能评审，**本轮不做** |
| H4 | 错误文案不得泄露「因为你是老用户所以更贵」这类语义 | 文案审查 + 契约测试断言不出现相关字符串 |

#### 22.5.2 合规参考（**最终以法务意见为准，本节不是法律意见**）

「按用户身份实施不合理差别待遇」在中国有明确的成文约束，风险不只是舆论：

- 《个人信息保护法》第二十四条：利用个人信息进行自动化决策，**不得对个人在交易价格等交易条件上实行不合理的差别待遇**。
- 《电子商务法》第十八条：根据消费者兴趣爱好、消费习惯等特征提供搜索结果时，**应当同时提供不针对其个人特征的选项**。
- 《互联网信息服务算法推荐管理规定》（2022）第二十一条：不得根据消费者偏好、交易习惯等特征，利用算法**在交易价格等交易条件上实施不合理的差别待遇**。
- 《明码标价和禁止价格欺诈规定》（2022）：价格标示与结算必须一致、不得欺诈。

> 关键区分：**商家对「某场活动面向哪类人」做主动、公开、一致的配置**（如新客首单券，规则明示）
> 属于正常营销；**平台按用户身份自动给不同价格且不告知**才是杀熟。
> 本方案选择**默认完全不做身份差别定价**，把后者从架构上排除。

#### 22.5.3 经济学：「保底有利润」保证你不亏本金，但不保证你不少赚

> 用户原话：「我设置优惠券时是保底有利润的，券被用越多不就意味着我赚得越多吗？应该不会亏钱吧。」

这句话**对一半**，而错的那一半正是促销最大的隐性成本。必须把两个被混为一谈的概念拆开：

- **不亏本金（现金安全）**：折后价 > 成本价。`保底有利润` 配合 DB CHECK 零元购（C-B5）+ `guest_min_payable_cny`（K5）+ `guest_max_discount_percent ≤ 90`（C-B8）从结构上锁死了这一层。**这一层你永远安全。**
- **不少赚毛利（边际收益）**：折后价 vs「本来就能成交的原价」。`保底有利润`**完全不保证**这一层。

券被用得多到底是赚是亏，取决于**用券的人是谁**，而一张公开可领的券**本身分不出来**：

| 用券者 | 没有券会怎样 | 券的净效果 | 「越多越赚」成立吗 |
|---|---|---|---|
| **增量客户** | 原价不买，因为折扣才买 | 折扣 = 获客成本，换来一笔**本不存在**的成交 | ✅ 成立，这部分越多越好 |
| **存量客户** | 原价本来就会买 | 折扣 = 把一笔**已注定成交**的单子自我降价 | ❌ 不成立，`(原价−折后价)×件数` 是**纯毛利流失** |
| **窜货 / 套利者** | 不会按原价买，专薅折扣转卖或反复套现 | 折扣 = 把营销预算**转移**给一个不创造需求的第三方 | ❌ 不成立，每单仍「保底有利润」，聚合起来却是大额毛利外流 |

**关键洞察：一张公开可领的游客券，会被这三类人无差别领走。** 所以「券被用越多 = 赚越多」只在「领用者全是增量客户」时成立；现实里它必然混入存量客户与套利者，净效果 = 增量带来的新毛利 − 存量自我降价的毛利流失 − 被套走的部分。**这个净值可正可负，而你无法在单笔订单上判断它属于哪一类。**

这恰恰是原「防登出套利」（T5）真正担心的东西——不是「亏本金」，而是「**存量客户自我降价**」：一个本来要按原价买的注册用户，登出来领游客券，把同一件东西买便宜了。你没亏本，但你少赚了他本来会付的那部分毛利。

**但纠正它的办法绝不是「给老用户更贵」（那是本节 §22.5.1 H1 明令禁止的杀熟）。** 办法是给整场促销的总让利**封一个你亲手设定的硬上限**，让最坏情况的毛利流失变成一个你提前知道、且能接受的数字：

1. **总量 / 单点失控** → `guest_max_uses`（券总量）+ `guest_max_total_discount`（券总让利上限）+ `guest_max_uses_per_identity`（C-C3）+ `daily_budget_cny`（站点日预算）。**最坏情况的毛利流失 = 你填进去的那个数字，而不是攻击者或薅羊毛脚本的想象力。**
2. **库存被 pending 单占住（真实成交损失）** → `max_stock_hold_percent`（K11）+ `max_pending_quantity_per_ip_product`（K24）+ `promo_order_ttl_seconds`（K13）
3. **折后金额被算错或篡改（真实资损）** → DB CHECK 零元购 + `guest_min_payable_cny` + `guest_max_discount_percent ≤ 90` + L3 金额权威
4. **异常领用速度（窜货 / 脚本套利的信号）** → §19 单码增速熔断 + 站点级熔断，自动跳闸、只能人工恢复

**所以正确的问题不是「会不会亏钱」，而是「最坏情况我会少赚多少，这个数我接受吗」。** 反杀熟（H1：绝不按身份差别定价）与促销硬预算（总让利封顶）并不矛盾，而是正交的两件事：前者管「不能歧视谁」，后者管「总共能让多少利」。**把风控做在结构上限上，而不是做在用户身份上——这是本节的全部要点。**

---

## 23. L1+L2 合并批次的实现记录与偏差（2026-09-19）

> 本节记录 `codex/guest-shop-promo-l1l2` 分支**实际落地**的内容，以及与前文
> （§8 数据模型 / §9 定价权威链路 / §11 防券码枚举 / §14 分期计划）不一致之处。
> **冲突时以本节为准**（效力约定同 §22）。
>
> 本节**不是启用授权**：所有开关默认关闭，`readiness --fail-on-not-ready` 仍返回 `3`，
> 发布仍按 `AGENTS.md`，启用仍需 §14 的灰度许可签署 + §15.4 的实机证据归档。

### 23.1 本批次实际范围

用户指令是「L1+L2 合并一批」。按 §14 的分期表，这等价于 **L1 + L2 + L3 中的「定价权威」部分**同批交付
（§14 明确禁止 L2/L3 拆开发布，因为拆开就会出现「前端能报价、后端不认账」→ `amount_mismatch` → 已付款不发货）。
**L4（后台运营界面）不在本批。**

| 能力 | 状态 | 落点 |
|---|---|---|
| L1 游客多件 + 阶梯价 + 闪购 | ✅ | `guest_shop_resolve_credit_unit_amount` 放开 `p_quantity`；`fn_guest_shop_create_order` 一条语句预占 N 行 |
| L1 件数四处取小 | ✅ | `min(env GUEST_SHOP_MAX_QUANTITY, sku.guest_max_quantity, product.guest_max_quantity, product.max_purchase_quantity, 5)` |
| L2 游客优惠码（percent / fixed） | ✅ | `fn_guest_shop_evaluate_discount`（只读）+ `fn_guest_shop_reserve_discount`（原子扣减） |
| L2 券级/站点级硬预算 | ✅ | `discount_codes.guest_*` 五列 + `guest_shop_promo_budget` |
| L2 身份配额（跨凭证分组并集） | ✅ | `guest_shop_discount_redemptions` 台账，按 `buyer_contact_hash` 计数 |
| L2 熔断（人工恢复，无半开） | ✅ | `guest_shop_promo_breaker` + `guest_shop_promo_breaker_events` + `fn_guest_shop_promo_set_breaker` |
| L3 create-order 内重算 + 金额 CHECK | ✅ | `guest_shop_orders_amount_check`（含零元购地板 + 50% 硬顶 + 通道费 10% 硬顶） |
| L3 fingerprint 扩展（quantity + code + discount） | ✅ | `api/_lib/guest-shop/security.js` |
| L3 退款/过期归还券预算（幂等） | ✅ | `fn_guest_shop_return_discount_reservation` + 台账 `returned_at` |
| **L2 `POST /api/shop/guest/quote`** | ❌ **延后** | 见 §23.2 |
| **L3 quote 令牌绑定 / `guest_quote_stale`** | ❌ **延后** | 见 §23.2 |
| **C-D3 库存占比闸 / C-D4 并发未付款单闸 / C-D5 促销单 TTL** | ❌ **未实现** | 见 §23.5（**多件启用前必须补**） |
| **L4 后台运营界面** | ❌ 未开工 | 熔断恢复目前只能由运维手工执行 SQL 函数 |
| §7.4 锁定退避（5 次/10 分钟 → 15 分钟 → 30 分钟 → 24 小时） | ❌ 未实现 | 见 §23.7，由 24h 台账配额 + 熔断替代 |

### 23.2 偏差 1：本批**没有** quote 端点（§9.1 `p_mode='quote'`、§9.2 第 9 步、§9.6 quote 令牌全部延后）

**做了什么替代**：折扣在 **create-order 事务内**被权威计算与校验；任何不可用都收敛成
**统一 400 `guest_discount_unavailable`**（C-E6），**且不写任何订单行**（整个事务回滚，预占的券预算与库存一并归还）。
客户端拿到这个错误后**主动撤回折扣 UI**（`js/guest-shop-client.js` 的 `handleCreateOrderError` →
`state.amountBreakdown = null` + `setDiscountInvalid(true)`），因此屏幕上不可能停留一条
「已优惠 ¥X」而实际订单不存在的假折扣行。

**为什么这个替代比 quote 令牌更强**（这是本批最重要的设计判断）：

- quote 令牌解决的是「报价与成交不一致」。但它引入一个**新的信任边界**：令牌本身要签名、要绑定会话、
  要处理过期与重放，`guest_quote_stale` 只是一个**事后**发现不一致的错误。
- 本批的做法是**根本不存在第二份报价**：买家看到的金额只来自 ①preview 的**单价/小计**（服务端算）
  和 ②**已创建订单**的 `amount_breakdown`（数据库算）。折扣金额在订单存在之前**从不下发**，
  所以「前端持有的折扣报价」这个可被篡改/过期的对象**不存在**。
- 撤回发生在**权威错误**上，而不是发生在「与另一份报价比对」上，因此它**不可能与已提交的行不一致**。

**代价（必须写进运营口径）**：买家填了券码点「立即购买」，若券不可用，得到的是
**一次失败的下单**（400 + 「优惠码不可用」），而不是「下单前先告诉你券不能用」。
券码校验的**限流与配额仍然生效**（见 §23.7），所以这不会被变成枚举 oracle，
但**体验上确实比 quote 差一档**。若后续要做「输入券码即时校验」，
再按 §9.6 补 quote 端点 + 令牌绑定；本批的撤回逻辑与之兼容，不需要回退。

**preview 的参数白名单**：`site` / `productId` / `skuId` / `quantity` 四个，**没有** `code`。
券码只出现在 `POST /api/shop/guest/orders` 的 JSON body，
不进 URL、不进 query、不进 `localStorage` / `sessionStorage`、不进缓存键（C-E8 保持）。

### 23.3 偏差 2：开关命名与「策略表」形态

| 前文条目 | 本批实际 | 说明 |
|---|---|---|
| K1 `GUEST_SHOP_PROMO_ENABLED` | **`GUEST_SHOP_DISCOUNT_ENABLED`**（L2 主闸，默认关） | 命名更窄更准确：它只管**优惠码**。L1（多件/阶梯）由 `GUEST_SHOP_MAX_QUANTITY` 单独管，两个闸互不隐含 |
| — | **`GUEST_SHOP_MAX_QUANTITY`**（L1 运营上限，默认 `1`，`min=1`，`max=5`） | `max=5` 与 `guest_shop_orders_quantity_check` 的数据库硬顶**逐字一致**；readiness 有 `quantity-ceiling-consistent` 守门，改宽 env 只会在写入时 CHECK 失败，**必须改迁移** |
| §8.3 `guest_shop_promo_policy` 单行策略表 | **未建**。改为三处分散落点 | ①站点级：`guest_shop_promo_budget`（每站一行，`enabled` + `daily_budget_cny`）②全局：`guest_shop_promo_breaker`（单行，阈值就地可调）③券级：`discount_codes.guest_max_uses` / `guest_max_total_discount` / `allow_guest`。**没有 `max_quantity` / `min_payable_cny` / `promo_order_ttl_seconds` / `max_stock_hold_percent` 这些策略列**，对应旋钮见 §23.5 |

**降级语义（已实现并测试）**：`discount_enabled` 在 preview 里是
`GUEST_SHOP_DISCOUNT_ENABLED && GUEST_SHOP_BUYER_CREDENTIAL_ENABLED` 的**与**。
理由：折扣必须可归属身份，否则数据库直接抛 `guest_discount_identity_required`
（见 §23.4）。所以**订单访问 2.0 的凭证开关是 L2 的硬前置**，
只开 `GUEST_SHOP_DISCOUNT_ENABLED` 不会打开游客优惠码通道，这是有意的 fail-closed。

**关闭时的行为**：`GUEST_SHOP_DISCOUNT_ENABLED` 未开而买家仍提交券码 → **403 `guest_discount_disabled`**，
**不是静默丢弃**。静默丢弃会让买家以为自己拿到了折扣却按原价被扣款。

### 23.4 偏差 3：身份层复用「订单访问 2.0」凭证，不建游客会话表

- **没有** `guest_shop_sessions` 表，**没有** `guest_session_hash` 列，**没有** `__Host-` 会话 cookie
  （§7.1/§7.3 与 §15.2 里那条 cookie 契约断言因此**不适用**，本批未新增该断言）。
- 配额主判据按 §22.1 落地为 **`buyer_contact_hash`**：
  `fn_guest_shop_evaluate_discount` / `fn_guest_shop_reserve_discount` 都要求它是 64-hex，
  否则抛 `guest_discount_identity_required`；台账按它跨**该邮箱的全部凭证分组**并集计数
  （**不用 `buyer_id`**，理由见 §22.1.1：换分组刷额度）。
- 兜底判据 **`request_ip_hash`**。`request_device_hash` 按 §22.1 **不入配额**（只写台账取证）。
- 24h 阈值：`per_contact` 默认 **3**（函数内 `LEAST(10, ...)` 硬夹）、`per_ip` 默认 **10**（`LEAST(50, ...)` 硬夹）。
  两个阈值目前**只由 SQL 默认值提供**，HTTP 层不传参，所以运营改不了 —— 要调必须改迁移，
  这与「env 只能收紧不能放宽」是同一个口径。
- 并发安全：扣减前对 `contact_hash` 与 `ip_hash` 各取一次 `pg_advisory_xact_lock`，
  同一身份/同一网络的并发下单被串行化，配额不可能被竞态突破。

### 23.5 偏差 4：C-D3 / C-D4 / C-D5 未实现（**多件启用前必须补**）

§14 把这三道闸写在 L1 行里，本批**没有**实现它们：

| 控制 | 状态 | 现状与补偿 |
|---|---|---|
| C-D3 库存占比闸（游客最多占住 X%） | ❌ 未实现 | 目前只靠 `GUEST_SHOP_MAX_QUANTITY=1` + 单 SKU `guest_max_quantity` + 下单限流 12/min/IP 约束。**多件（≥2）一旦放开，攻击者可以用大量未付款单把某 SKU 的可用库存全部锁死** |
| C-D4 并发未付款单闸 | ❌ 未实现 | 同上，无 per-identity/per-IP 的 pending 单数上限 |
| C-D5 促销单独立短 TTL | ❌ 未实现 | 促销单与原价单共用 `GUEST_SHOP_ORDER_TTL_SECONDS`（迁移把 `p_ttl_seconds` 夹在 300–7200）。券预算会随 TTL 释放归还，但**占着不买的时间窗没有被压缩** |

**为什么本批仍可安全合并**：三道闸都是「多件 + 大量未付款单」才成立的攻击面。
`GUEST_SHOP_MAX_QUANTITY` 默认 `1`，此时每单只预占一行库存，与 L1 之前的行为**完全一致**；
且 readiness 的 `promo/quantity-inventory-gate` 检查在该值 `>1` 时会**升级为 high 并显式点名这两道闸**，
构成一道人工闸门。

**硬性要求**：把 `GUEST_SHOP_MAX_QUANTITY` 调到 `≥2` **之前**，必须先补 C-D3 + C-D4（并建议一并补 C-D5），
并重新归档 readiness 与实机证据。**只改 env 就放多件是被禁止的。**

### 23.6 偏差 5：券码字符集

§11.5 写的是 `^[A-Z0-9]{4,32}$`；本批实现为 **`^[A-Z0-9][A-Z0-9_-]{0,49}$`（最长 50）**，
与 `discount_codes` 既有券码字符集、`guest_shop_orders_discount_code_check`、
以及进入幂等 fingerprint 的归一化值**三处逐字一致**。

理由：若收窄成 `{4,32}` 且不含 `_-`，运营**已经创建**的合法券会在游客侧被格式闸拒掉，
买家看到的是「优惠码不可用」而运营查不出原因。三处一致意味着
**在 Node 层通过格式闸的值，绝不可能在数据库层因形状被拒**。
枚举防护不依赖长度下限：真正的防线是 C-E6 统一错误 + 限流 + 24h 配额 + 熔断（§23.7）。

### 23.7 偏差 6：限流与锁定退避

- **没有**新增 §11.3 的三级 quote 桶（`quote:ip` / `quote:session` / `quote:global`），因为没有 quote 端点。
- 沿用既有持久化 fail-closed 限流：**preview 60/min/IP**、**orders 12/min/IP**。
  券码校验发生在 orders 路径内，所以「撞券码」的成本被 12/min/IP + 24h 台账配额（3/身份、10/IP）双重压住。
- **没有**实现 §7.4 的阶梯锁定退避。替代：24h 配额命中即 `guest_discount_rate_limited`，
  异常速度由 §12 熔断（`mismatch_trip_threshold=3`、`identity_trip_threshold=20`、`trip_window_seconds=900`）
  在**滚动 15 分钟窗口**内自动跳闸，恢复只能人工。
- 限流不可用仍然 **503 拒绝**，不放行（F11 不变）。

### 23.8 本批已落地的数据库红线（不可协商，改动必须重跑 verify）

`supabase/migrations/20260923_guest_shop_promo_l1l2.sql` 的 `guest_shop_orders_amount_check` 一次性钉住了：

1. `unit_amount > 0 AND total_amount > 0` —— **任何情况下都不存在 0 元单**；
2. `discount_amount < ROUND(list_unit_amount * quantity, 2)` —— **零元购地板**：折扣必须**严格小于**折前总额；
3. `discount_amount <= ROUND(list_unit_amount * quantity * 0.5, 2)` —— **单笔最多折 50%**，这是本批**唯一**的折扣率边界；
4. `payment_fee_amount <= ROUND(unit_amount * quantity * 0.1, 2) + 0.01` —— 通道费硬顶 10%（`+0.01` 是进位余量）；
5. `total_amount = unit_amount * quantity + payment_fee_amount` —— **金额三者必须自洽**，
   其中 `unit_amount` 是**折后**净单价、`payment_fee_amount` 是**按折后净额**计算的通道费。

> ⚠️ 关于第 3 条：**本批不存在折扣率 env 旋钮，`discount_codes` 也没有折扣率列。**
> 早期草稿的注释里提到过 `GUEST_SHOP_DISCOUNT_MAX_PERCENT` 与 `guest_max_discount_percent`，
> 两者**都未实现**，相关注释已修正，readiness 也新增了 `no-phantom-percent-knob` 禁令，
> 防止运维去配一个不存在的开关。**要收紧单券**用 `guest_max_uses` / `guest_max_total_discount`；
> **要收紧整站**用 `guest_shop_promo_budget.daily_budget_cny`；
> **要提高 50% 本身**只能改迁移并重跑 verify。

其余结构性红线：`guest_shop_orders_quantity_check`（1..5）、`guest_shop_orders_discount_code_check`（字符集）、
`discount_codes_guest_caps_check`（`guest_used_count <= guest_max_uses`、`guest_discount_total <= guest_max_total_discount`，
让「超发的游客额度」在数据库层**不可表示**）、熔断状态只有 `closed` / `open` 两值（**无半开**）、
四张新表全部 `ENABLE ROW LEVEL SECURITY` + `REVOKE FROM PUBLIC, anon, authenticated` + 仅 `service_role`、
七个促销函数全部 `SECURITY DEFINER` + `SET search_path` + 非 `IMMUTABLE` + 各自**唯一重载**。

### 23.9 自动化守门员清单（本批新增/扩展）

| 文件 | 断言要点 | 结果 |
|---|---|---|
| `tests/guest-shop-promo-error-contract.test.js`（**新**，9 例） | 迁移里 `RAISE` 的每一个 `guest_*` 码都在 `GUEST_CREATE_ORDER_ERROR_CONTRACT` 有映射（**UNMAPPED 必须为空**）；表里的公开码集合与实际一致；C-E6 归一（`guest_discount_code_rejected` 等细码对外**只**呈现 `guest_discount_unavailable`）；`mapGuestCreateOrderError` 与 `failResponse` 之间**不得泄漏** `SQLSTATE` / 内部细码；跨路径码（`guest_provider_order_conflict`）仍被真实抛出 | 9/9 |
| `tests/guest-shop-frontend-contract.test.js`（扩展，26 例，基线 25） | `guestPromo=20260923_GUEST_PROMO_L1L2_1` cache-bust 标记；数量/优惠码两个区块**默认 hidden**；preview 的 `URLSearchParams` 白名单**只有** `site/productId/skuId/quantity`；`discount_enabled` 单点驱动显隐；切换商品/SKU 时 `resetPromoSelection` 必须清空数量与券码；沿用隔离断言（无 `supabase`/`access_token`/`Authorization`/`Math.random()`） | 26/26 |
| `tests/guest-shop-create-order-signature-compat.test.js`（扩展，**15 例** = 原 8 + 新 §5 的 7） | `fn_guest_shop_create_order` 从 13 参换到 **15 参**：旧 13 参签名被**精确 DROP**、只剩唯一重载、`p_quantity INTEGER DEFAULT 1` 与 `p_discount_code TEXT DEFAULT NULL` 逐位正确、所有 DEFAULT 参数**连续排在末尾**（否则具名调用无法解析）、未升级的调用方仍解析到 15 参函数。**§5（2026-09-23 新增，7 例）**：自动从迁移推导出**每一个历史 create_order 签名**，断言归档 verify 认识当前签名、绝不发明任何迁移没装过的签名、按 `pronamespace+proname` 而非精确签名解析、已退役键名保持退役、arity 的 CASE 覆盖当前时代 | **15/15** |
| `tests/guest-shop-credit-pricing.test.js`（扩展，13 例） | JS 展示镜像与 SQL resolver 在阶梯/闪购上的 parity；多件小计只由服务端算 | 13/13 |
| `tests/guest-shop-security.test.js`（扩展，10 例） | fingerprint 含 quantity + 归一化券码 + 折扣额；换券/换数量重放 → `guest_idempotency_conflict` | 10/10 |
| `tests/guest-shop-orders-idempotency.test.js`（扩展，7 例） / `tests/guest-shop-order-access-endpoints.test.js`（扩展，43 例） | 幂等重放返回**新制度**金额形状；订单列表/详情的 `quantity` 与 `amount_breakdown` 只在行确实由促销 RPC 写入时回显（legacy 行**不得**渲染「已优惠 ¥0.00」） | 7/7、43/43 |
| `scripts/guest-shop-readiness.js` 新增 `promo` 组 | 108 项：迁移 81 present / 17 absent（禁令）+ env 旋钮 + 客户端券码泄漏静态扫描 + 6 项 `manual_review`（schema 已应用、预算已开、熔断 closed、脏券扫描、SKU 件数扫描、parity 证据）。`--fail-on-invalid` 退出 **0**、`findings: none`；`--fail-on-not-ready` 退出 **3**（预期 fail-closed）；`manual_review_count` 14 → **20**。**时代感知探针守门（2026-09-23 新增）**：要求项 `verify-era-aware-signature` / `verify-known-signature-key` / `verify-era-aware-quantity`；禁止项 `verify-no-signature-pinned-cte` / `verify-no-era-pinned-arity` / `verify-retired-13-param-key` / `verify-retired-quantity-key`（A0 探针）与 `verify-a1b-era-aware-rpc` / `verify-a1b-retired-rpc-key`（A1b 探针） | 0 INVALID |
| 全量回归 `node --test --test-force-exit tests/*.test.js` | **3361 tests / 3361 pass / 0 fail**，`EXIT=0`（`main` 基线 3156，**+205**，fail 仍为 0，满足 §15.3「pass 只增不减」）。开发中曾出现一次 **3314** 读数，诊断为 `--test-force-exit` 在高负载下的瞬时少计，随后三次连续运行均稳定 3361，详见证据文档 §2.7 | ✅ |

> **计数勘误（2026-09-23）**：上表初稿记 compat 为 8 例、全量为 3354，那是**探针修复前**的快照。
> 15 参签名让两个归档 verify 探针假 FAIL（D-10 同类事故第二次），修法是把它改成时代感知而非再钉一个新常量，
> 并为此新增 compat §5 的 7 例与 readiness 的 9 条时代感知断言 —— 于是 compat 8→**15**、全量 3354→**3361**。
> **迁移与业务代码未因这次勘误改动一行**；`20260920` / `20260921` 两个 verify 脚本改的是校验器自身。
> 完整事故记录、修法与新键名见 `docs/guest-shop-promo-evidence.md` §1.5 / §1.7 的「探针勘误（2026-09-23）」两段。

### 23.10 后续批次（不在本批）

1. **L4 后台运营界面**：券的 `allow_guest` / 游客预算 / 熔断状态与人工恢复（RBAC + 二次确认 + 原因 + 审计）/ 台账查询。
   在此之前，熔断恢复只能由运维执行 `SELECT public.fn_guest_shop_promo_set_breaker('closed', '<actor>', '<reason>')`。
2. **C-D3 + C-D4（+ C-D5）**：放开 `GUEST_SHOP_MAX_QUANTITY ≥ 2` 的**前置条件**，见 §23.5。
3. **§9.6 quote 端点 + quote 令牌**（可选，体验优化）：仅当运营确认「下单后才知道券不能用」的失败率过高时再做。
4. **§7.4 阶梯锁定退避**（可选）：若 24h 配额 + 熔断仍不足以压住撞库，再补。
5. **A4（邮箱 OTP + 游客订单并入账号）**：按 §22.3 必须排在本批之后。
