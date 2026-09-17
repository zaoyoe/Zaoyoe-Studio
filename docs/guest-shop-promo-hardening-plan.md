# 游客促销共用（优惠码 / 阶梯价 / 闪购）安全加固方案

> 工作目录：`/Volumes/chao/AI/xianyu_profit_calculator-guest-promo`
> 分支：`codex/guest-shop-promo-hardening`（基线 `2424dcc14` = 最新 `main`）
> 关联：`docs/guest-purchase-task-2.0.md`、`docs/guest-shop-payment-fulfillment-runbook.md`、`AGENTS.md`
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
| C-A5 | contact 命中已注册账号 → 拒绝游客促销（可原价购买），统一错误码 | handler 用 service_role 查 `auth.users`，**不把 pepper 写进 SQL** | T5 |
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

### 7.3 注册账号碰撞（C-A5，防登出套利）

- handler 在 quote / create 前，用 service_role 客户端按邮箱精确查 `auth.users`（`ilike` 归一化小写），命中则：
  - `guest_shop_sessions.registered_user_match = true`
  - 拒绝该会话使用任何优惠码，返回统一 `guest_discount_unavailable`
  - 允许原价购买（不影响正常游客）
  - 写审计事件 `identity_registered_match`
- **不在 SQL 里做这个判断**：pepper 与邮箱明文都不应进入数据库函数，避免把服务端密钥固化进迁移文件。

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
| 批量注册「游客」 | 会话签发 + 注册账号碰撞（C-A5） | **否，只是抬价** | 邮箱无需验证即可换新；C-A5 只挡「登出已注册账号来薅」这一条特定路径 |
| 优惠码枚举 | 锁定退避 + 限流 + 熔断 | **否，只是抬价** | 撞库速度被压到分钟级，但不为零 |

**`contact_hash` 的真实价值，以及我在早期草稿里说错的地方：**
现状 `hashContact`（`server/api-handlers/public/guest-shop.js:832-837`）只做 HMAC，
邮箱**不验证、不发 OTP**，且今天联系方式是选填（`security.js` `allowOptionalContact: true`）。
因此 `contact_hash` 的可伪造性与其他三个因子同级，**不是「最可信因子」**。它仍然有用，
但用途是：(a) 售后与订单通知的真实通道；(b) 跨会话归并同一买家（用户换设备时配额仍连续）；
(c) C-A5 注册账号碰撞的查表键。它**不提供防伪造能力**，除非叠加 §20-B 的邮箱 OTP。

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

每期交付物固定四件套：迁移文件（写盘不执行）+ verify SQL + 自动化测试 + 文档更新（本文 + `docs/guest-shop-payment-fulfillment-runbook.md` + `docs/guest-purchase-task-2.0.md`）。

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
5. 同一邮箱注册账号登录后登出，再用游客通道用同一张券 → 拒绝（验证 C-A5）。
6. 批量创建不付款单 → 触达 C-D3 / C-D4 后拒绝；TTL 到期后库存与预算同时归还（验证 C-D6 / C-C5）。
7. 手动把 `guest_shop_promo_breaker` 置 open → 促销全停、原价可买；后台恢复 → 促销恢复。
8. 日预算打满 → 促销停止、原价可买、告警发出。

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
- `docs/guest-purchase-task-2.0.md` — 增补促销任务条目与完成标准
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
