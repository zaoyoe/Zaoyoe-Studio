# 游客订单访问 2.0：邮箱 + 查询密码（取代「订单号 + 取货口令」）

> 分支：`codex/guest-shop-promo-hardening`
> 关联：`docs/guest-shop-promo-hardening-plan.md` §21（Dujiao-Next 先例对照）、§7（身份层）、
> §22（本文对促销方案身份层的反哺修订，**冲突时以该节为准**）
> 状态：设计合同，待你确认旋钮后开工。**本文不含任何已执行的 SQL；迁移文件只写盘。**

---

## 0. 文档定位

本文是「游客订单找回方式」的 2.0 设计合同。它做三件事：

1. 把游客订单的访问凭证从 **订单号 + 取货口令（高熵 capability token）** 换成
   **邮箱 + 自设查询密码（用户可记忆凭证）**，对齐 Dujiao-Next 的用户体验。
2. 给游客订单一个**独立的查询页面与布局**（登录用户仍走「我的钱包 → 订单记录」，完全不动）。
3. 说明这次改动如何**反哺**促销加固方案的身份层——这是本次升级最大的意外收益。

---

## 1. 你的诉求（原话拆解）

| # | 诉求 | 本文落点 |
|---|---|---|
| R1 | 放弃「订单号 + 取货口令」找回订单 | §4、§13（旧订单保留双模式，新订单不再展示口令） |
| R2 | 改用「邮箱 + 自设查询密码」，下单必填 | §5、§6、§12 |
| R3 | 查订单和取卡密都要 email + password | §11、§12 |
| R4 | 登录用户照常弹「我的钱包 → 订单记录」 | §11.1（**零改动**，明确列为不可回归项） |
| R5 | 游客订单的 UI 页面与布局采用独角的逻辑与设计 | §11.2（逐个区块对照独角 `GuestOrders.vue`） |
| R6 | 以用户角度更容易接受、方便查询 | §3 权衡表 + §11.3 文案 |

---

## 2. 现状（已逐条核对代码）

| 事实 | 位置 |
|---|---|
| 取货口令是**确定性派生**的高熵串：由 idempotency key 派生，正则 `^[A-Za-z0-9_-]{40,200}$` | `server/api-handlers/public/guest-shop.js:1424`、`:1104` |
| 口令只存哈希 `claim_secret_hash`（`char_length >= 32` 的 CHECK），另有 `claim_secret_version` | `supabase/migrations/20260913_add_guest_shop_cash_purchase.sql:127-129,164-165` |
| 口令通过 httpOnly 之外的**加密 cookie** `guest_claim_proof` 携带（多订单 proofs 列表 + 过期裁剪） | `guest-shop.js:20,256-347` |
| 取货鉴权：header `x-guest-claim-secret` 或 cookie，二者皆无则 403 | `guest-shop.js:1649-1760 authorizeClaim` |
| 失败计数 `claim_attempt_count` 用**乐观 CAS 循环**递增（避免读改写丢增量），上限 `MAX_CLAIM_FAILURE_ATTEMPTS` | `guest-shop.js:recordClaimFailure` |
| 订单号不存在与口令错误返回**同一个错误**（防订单 oracle） | `guest-shop.js:1653-1654` 注释明写 |
| 邮箱只存**哈希** `buyer_contact_hash`，明文不落库；今天邮箱还是选填 | `guest-shop.js:832-837 hashContact`、`:1410 allowOptionalContact: true` |
| 找回 UI：弹窗内「订单号 + 取货口令」两个输入框 + 找回按钮 | `shop.html:766-772` |
| 口令一次性展示面板 | `shop.html:757-764` |
| 前端契约测试禁止 guest 脚本出现 `supabase / access_token / Authorization:`、`localStorage`、`claim_secret` | `tests/guest-shop-frontend-contract.test.js:50-58` |
| 管理端已有游客订单页 | `server/api-handlers/admin/shop/guest-orders.js` |

**结论**：现有体系是「不可猜测但不可记忆」。2.0 要换成「可记忆但可猜测」，
这不是等价替换，必须补一整套防爆破控制（§8）。

---

## 3. 必须先承认的事：这是一次**凭证熵的降级**

| 维度 | 现状（取货口令） | 2.0（邮箱 + 查询密码） | 方向 |
|---|---|---|---|
| 凭证熵 | 40 字符 base64url ≈ **240 bit** | 8 字符混合 ≈ **45 bit**；6 位纯数字 ≈ **20 bit** | **大幅下降** |
| 可枚举性 | 不可枚举 | **邮箱可枚举 + 密码可撞库** | **变差** |
| 用户负担 | 必须保存一串乱码，丢了就找不回 | 记得住，换设备可用 | **大幅变好** |
| 换设备体验 | 靠 cookie，换设备即失效 | 天然可用 | **大幅变好** |
| 客服工单量 | 高（口令丢失是主要来源） | 低 | **变好** |
| 凭证泄露面 | 一次性展示 + 加密 cookie | sessionStorage + 每次请求 header | 略变差（可控，§7） |
| 撞库/密码复用风险 | 无 | **有**（用户会复用真实密码） | **新增风险** |
| 身份稳定性（用于配额） | 清 cookie 即重置 | **用户主动复用同一邮箱** | **大幅变好** |

**净判断：值得做，但不能照抄独角的强度。** 独角的 `guestPasswordMinLength = 6`
且**无任何复杂度要求**（`order_service.go:796-808`），在「游客还能用优惠码」的前提下太弱。
2.0 必须在密码策略、哈希算法、防爆破三处**强于独角**（§6、§8）。

独角做对、我们直接继承的三件事：

1. **凭证只走 header，绝不走 query**——`ginutil/guest_auth.go:16` 注释明写
   「不再接受 URL 查询参数，避免进入代理访问日志、浏览器历史和 Referer」，
   并且**有测试断言 query 形式的凭证被拒绝**（`guest_auth_test.go:25-28`）。
2. **前端只存 sessionStorage**，且做一次性 `localStorage → sessionStorage` 迁移后立即删除长期存储
   （`utils/guestOrderAuth.ts:loadGuestOrderAuth` 注释：「不回退到 localStorage，
   避免把游客订单凭据重新变成长生命周期数据」）。存储被禁用时降级到内存变量。
3. **密钥缺失即 panic，禁止退化为明文**（`gormstore/order_store.go:34-40`），
   并提供历史明文凭证的 backfill（`BackfillGuestCredentialHashes`）。

独角做得不够、我们必须补强的四件事（详见对应章节）：

| # | 独角的做法 | 问题 | 2.0 的做法 |
|---|---|---|---|
| W1 | `HMAC-SHA256(secret, email‖password)`，**确定性** | ① 快哈希，pepper 一旦泄露可 GPU 秒破；② **相同密码产生相同哈希**，拿到库就能按密码给用户分组 | §6：**scrypt + per-row 随机盐**（Node 内置，无新依赖），先按 `contact_hash` 索引定位单行再校验 |
| W2 | 只有按 IP 的限流（`guestReadRule`，`KeyByIP`），**没有按邮箱的失败锁定** | 分布式撞库可绕开单 IP 限流 | §8：按 buyer + 按 IP **双维度**指数退避锁定 + 失败 N 次后强制验证码 |
| W3 | SQL 字符串等值比较 | 非常数时间 | §8.4：`crypto.timingSafeEqual` |
| W4 | 邮箱不存在时直接返回 | **响应时间差可枚举邮箱**（不跑哈希 vs 跑哈希） | §9.2：邮箱不存在时执行一次**等价开销的 dummy scrypt**，抹平时间差 |

---

## 4. 2.0 设计总览

```
┌──────────────────────── 登录用户（完全不动）────────────────────────┐
│ 我的钱包 → 订单记录 → 订单详情 → 卡密                              │
└────────────────────────────────────────────────────────────────────┘

┌──────────────────────── 游客（2.0 新链路）─────────────────────────┐
│ 商品详情弹窗「兑换」→ 游客现金下单表单                              │
│   必填：邮箱 + 查询密码（新）                                       │
│        ↓                                                            │
│   POST /api/shop/guest/orders                                       │
│     · contact_hash = HMAC(pepper, lower(email))   ← 已有列，复用     │
│     · buyer_id     = upsert guest_shop_buyers     ← 新表            │
│     · password_hash = scrypt(salt, password)      ← 新列            │
│        ↓                                                            │
│   下单成功 → 直接进支付/状态轮询（本设备已持有凭证，无需再登录）    │
│                                                                     │
│ 独立页面 /guest-orders.html                                         │
│   [邮箱] [查询密码] [订单号(可选)] [查询]                           │
│        ↓ Authorization 替代 header：X-Guest-Order-Credential        │
│   GET  /api/shop/guest/orders        → 订单列表 + 分页              │
│   GET  /api/shop/guest/orders/:no    → 订单详情                     │
│   GET  /api/shop/guest/orders/:no/delivery → 卡密（受同一凭证保护） │
│   折叠区：旧订单用「订单号 + 取货口令」找回（§13）                  │
└────────────────────────────────────────────────────────────────────┘
```

四条不可协商的设计选择：

- **D1 凭证归一化到「买家」而不是「订单」。** 独角把密码存在每张订单上（`orders.guest_password`），
  导致同一邮箱的不同订单可以有不同密码、改密要全表更新。2.0 建 `guest_shop_buyers`，
  一个 `(site, contact_hash)` 一行，订单用 `buyer_id` 外键关联。
- **D2 邮箱仍是哈希存储，明文不落库。** 复用现有 `hashContact`（确定性 HMAC，已建索引），
  作为查表键。**绝不新增明文邮箱列**，这是现有隐私基线，不能退。
- **D3 密码不可逆、加盐、慢哈希。** scrypt，per-row 32 字节随机盐，格式
  `scrypt$N$r$p$salt_b64$hash_b64`，DB CHECK 约束前缀。
- **D4 旧订单不迁移、不失效。** `claim_secret_hash` 与 `/api/shop/guest/recover` **保留**，
  新页面提供折叠的「旧订单找回」入口。新订单不再向用户展示口令（但列继续写，作为客服 break-glass，见 §13.3）。

---

## 5. 数据模型（DDL 草案；最终写入迁移文件，**不执行**）

### 5.1 新表 `guest_shop_buyers`

```sql
CREATE TABLE IF NOT EXISTS public.guest_shop_buyers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site                  VARCHAR(10)  NOT NULL,
    contact_hash          TEXT         NOT NULL,   -- HMAC(GUEST_SHOP_CONTACT_HASH_PEPPER, lower(trim(email)))
    password_hash         TEXT         NOT NULL,   -- scrypt$N$r$p$salt$hash
    password_version      SMALLINT     NOT NULL DEFAULT 1,
    password_updated_at   TIMESTAMPTZ,
    email_verified_at     TIMESTAMPTZ,             -- 仅 OTP 通过后回填（§10.3 / 促销方案 §20-B）
    registered_user_match BOOLEAN      NOT NULL DEFAULT false,
    failed_login_count    INTEGER      NOT NULL DEFAULT 0,
    login_lock_stage      SMALLINT     NOT NULL DEFAULT 0,   -- 0/1/2/3 → 15min/30min/24h/永久待人工
    locked_until          TIMESTAMPTZ,
    last_login_at         TIMESTAMPTZ,
    last_login_ip_hash    TEXT,
    order_count           INTEGER      NOT NULL DEFAULT 0,
    merged_into_user_id   UUID,                    -- 并入注册账号后回填（§10.4）
    merged_at             TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT guest_shop_buyers_site_check   CHECK (site IN ('cn','intl')),
    CONSTRAINT guest_shop_buyers_hash_check   CHECK (contact_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT guest_shop_buyers_pwd_format   CHECK (password_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$'),
    CONSTRAINT guest_shop_buyers_attempts     CHECK (failed_login_count >= 0 AND failed_login_count <= 1000),
    CONSTRAINT guest_shop_buyers_stage        CHECK (login_lock_stage BETWEEN 0 AND 3),
    CONSTRAINT guest_shop_buyers_orders_count CHECK (order_count >= 0),
    credential_group_no   SMALLINT     NOT NULL DEFAULT 1,   -- 同邮箱的第几套查询密码（§6.4）
    CONSTRAINT guest_shop_buyers_group_range  CHECK (credential_group_no BETWEEN 1 AND 3),
    -- 注意：不是 UNIQUE(site, contact_hash)。同一邮箱允许存在多套互不可见的凭证分组，
    -- 见 §6.4「凭证分组模型」。UNIQUE 落在 (site, contact_hash, credential_group_no)。
    CONSTRAINT guest_shop_buyers_site_contact_group_uniq
        UNIQUE (site, contact_hash, credential_group_no)
);
CREATE INDEX IF NOT EXISTS guest_shop_buyers_locked_idx ON public.guest_shop_buyers (locked_until)
    WHERE locked_until IS NOT NULL;
-- 登录查找：按邮箱哈希取出该邮箱下的全部分组（≤3 行），逐行 scrypt 校验，命中即停
CREATE INDEX IF NOT EXISTS guest_shop_buyers_contact_idx
    ON public.guest_shop_buyers (site, contact_hash);
-- 配额计数走 guest_shop_orders.buyer_contact_hash（已存在的列），不需要 join 本表
```

### 5.2 `guest_shop_orders` 增列

```sql
ALTER TABLE public.guest_shop_orders
    ADD COLUMN IF NOT EXISTS buyer_id UUID REFERENCES public.guest_shop_buyers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS guest_shop_orders_buyer_idx
    ON public.guest_shop_orders (buyer_id, created_at DESC);
-- 邮箱从「选填」变「必填」：新订单必须能定位到买家
-- 注意：不能对历史行加 NOT NULL，用部分索引 + 应用层校验
CREATE UNIQUE INDEX IF NOT EXISTS guest_shop_orders_buyer_order_uniq
    ON public.guest_shop_orders (buyer_id, order_no);
```

### 5.3 登录尝试审计（防爆破取证，复用促销方案 §8.5 审计表）

```sql
CREATE TABLE IF NOT EXISTS public.guest_shop_access_attempts (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site         VARCHAR(10) NOT NULL,
    contact_hash TEXT,                 -- 命中或尝试的邮箱哈希
    buyer_id     UUID,
    request_ip_hash   TEXT NOT NULL,
    request_device_hash TEXT,
    outcome      VARCHAR(24) NOT NULL, -- success / bad_password / unknown_email / locked / captcha_required / rate_limited / credential_conflict
    created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT guest_shop_access_attempts_outcome_check CHECK (outcome IN
        ('success','bad_password','unknown_email','locked','captcha_required','rate_limited',
         'credential_conflict'))
);
CREATE INDEX IF NOT EXISTS guest_shop_access_attempts_ip_idx
    ON public.guest_shop_access_attempts (request_ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_shop_access_attempts_contact_idx
    ON public.guest_shop_access_attempts (contact_hash, created_at DESC);
-- 只留 30 天，避免变成无限增长表
```

> 审计表**不存密码、不存密码哈希、不存明文邮箱、不存明文 IP**，只存已有的 HMAC 派生值。

---

## 6. 密码策略与存储

### 6.1 强度（**严于独角的 6 位无复杂度**）

- 最小长度 **8**（独角 6）；最大 **128**（防 DoS：scrypt 成本随长度线性上升）。
- 至少包含 **字母与数字**两类；不允许纯数字、纯字母。
- 拒绝**与邮箱本地部分相同或包含**（`abc@x.com` + `abc12345` 这种最常见）。
- 拒绝 Top-1000 弱口令黑名单（内置静态列表，不联网）。
- 拒绝与 `order_no`、站点域名相同。
- **前端即时校验 + 服务端权威校验**，服务端错误码 `guest_password_weak`，
  响应里带**具体不满足哪一条**（这是少数可以详细回应的场景，因为下单时用户就在现场）。

### 6.2 哈希

- 算法 **scrypt**（`crypto.scryptSync`，Node 内置，**不引入新依赖**）。
- 参数默认 `N=32768, r=8, p=1, keylen=32`，salt 32 字节 `crypto.randomBytes`。
- 存储格式 `scrypt$32768$8$1$<salt_b64>$<hash_b64>`，参数写进字符串本身 → **未来可平滑升参**
  （登录成功时若发现参数低于当前策略，透明 rehash 并更新 `password_version`）。
- 校验：解析格式 → `scryptSync` → `crypto.timingSafeEqual`。
- **为什么不用独角的确定性 HMAC**：见 §3 W1。确定性哈希让我们能在 SQL 里做等值查询，
  但代价是「相同密码 ⇒ 相同哈希」的分组泄露，以及 pepper 泄露即全线失守。
  我们的查询路径是 `WHERE site=? AND contact_hash=?`（已有索引，命中 ≤1 行）后再在应用层校验，
  **完全不需要密码哈希可预测**，所以没有理由接受这个代价。

### 6.3 密钥管理

- 复用现有 `GUEST_SHOP_CONTACT_HASH_PEPPER`（邮箱哈希），**新增独立**
  `GUEST_SHOP_BUYER_PASSWORD_PEPPER`？→ **不需要**：scrypt 的盐已经提供抗彩虹表能力，
  额外 pepper 只会增加「pepper 丢失 = 所有游客订单永久无法访问」的运维风险。
  **决定：不加 pepper，只加盐。**（这一条与独角不同，是有意的取舍。）
- `GUEST_SHOP_CONTACT_HASH_PEPPER` 缺失 → **fail-closed**：拒绝创建游客订单、拒绝查询，
  返回 503 `guest_shop_misconfigured`，**绝不降级为明文或无哈希**（对齐独角的 panic 语义）。
- readiness 脚本新增检查项（§15）。

---

### 6.4 同邮箱重复下单：凭证分组模型（**防抢占 / 防卡密串号，2.0 的第二个承重墙**）

这是 2.0 最容易写错、且错了会**直接丢卡密**的一处。必须显式定义语义。

#### 6.4.1 两个必须同时成立的诉求

| # | 诉求 | 天真实现的后果 |
|---|---|---|
| N1 | 用户忘了查询密码，**仍然必须能下新单**（不能因为记不住密码就买不了东西） | 「密码不匹配就拒单」会在 OTP（A4）上线前形成**硬性购买墙**，直接损失成交 |
| N2 | 后下单的人**绝不能读到先下单的人的订单和卡密** | 「同邮箱就 upsert 覆盖 `password_hash`」会让攻击者用受害者邮箱下一次单，**接管受害者全部历史订单与卡密** |

> **N2 是真实的资损路径**，不是理论风险：卡密 = 货。覆盖密码 = 把货交给别人。
> 独角因为把密码存在**每张订单**上（`orders.guest_password`），天然不存在跨订单串号，
> 但代价是改密要全表更新、同邮箱不同订单可以有不同密码。我们在 D1 选择了归一化，
> 就必须自己把 N2 补回来。

#### 6.4.2 解法：一个邮箱可以有 ≤3 套互不可见的「凭证分组」

```
guest_shop_buyers
  ├─ (site, contact_hash=H(alice@x), group=1)  password_hash=scrypt(P_a)   ← Alice 第一次设的密码
  └─ (site, contact_hash=H(alice@x), group=2)  password_hash=scrypt(P_b)   ← Alice 忘了 P_a，新设的

guest_shop_orders
  ├─ 订单 #1001  buyer_id → group=1   （只能用 P_a 查）
  ├─ 订单 #1002  buyer_id → group=1   （只能用 P_a 查）
  └─ 订单 #1003  buyer_id → group=2   （只能用 P_b 查）
```

**下单时的 upsert 语义（A1 必须严格照此实现）：**

1. 按 `(site, contact_hash)` 取出该邮箱的全部分组（≤3 行）。
2. **无分组** → 建 `group=1`，写入 scrypt 哈希，订单挂到它。
3. **有分组，且提交的密码能验证通过其中某一行** → 视为**同一人复购**，订单挂到该 `buyer_id`。
   （这是常态路径：同设备下单时前端会从 sessionStorage 预填密码，用户无感。）
4. **有分组，但没有任何一行验证通过** → **绝不覆盖任何现有行**；新建 `group = max+1`，
   订单挂到新分组。旧订单仍然只有旧密码能查。
5. **分组数已达 3** → 拒绝下单，文案见 §6.4.4，引导走「忘记查询密码」/ 客服。
   这一步同时是**抢占攻击的成本上限**：攻击者最多给一个邮箱制造 3 个无用分组。

**登录（查询）时的语义：**

1. 按 `(site, contact_hash)` 取全部分组；若该邮箱处于锁定期（§8.1）→ 直接拒，**不跑 scrypt**。
2. 逐行 `crypto.timingSafeEqual` 校验，**命中即停**；全部不中 → 记一次失败。
3. 命中后，返回的订单集合**只包含 `buyer_id = 命中分组` 的订单**。跨分组不可见，
   即使它们来自同一个邮箱。这条要有专门的越权测试（§16.1）。

#### 6.4.3 为什么这样同时满足 N1 和 N2

| | 结果 |
|---|---|
| N1 忘密码仍能买 | 满足：走第 4 步新建分组，**不需要 OTP、不需要客服、不阻断成交** |
| N2 不串号 | 满足：永不覆盖，攻击者用受害者邮箱下单只会得到**一个只含他自己订单的新分组** |
| 抢占攻击 | 失效：攻击者既读不到受害者订单，也无法让受害者读不到自己的订单 |
| 卡密资损 | 无新增路径 |
| 代价 | 登录最坏情况跑 ≤3 次 scrypt（≈150~300ms）；`order_count` 等统计需按 `contact_hash` 聚合而非按行 |

#### 6.4.4 文案定稿

- 分组已满（第 5 步）：
  `该邮箱已设置过 3 套查询密码，为保护订单安全无法再新增。请用原查询密码登录，或点击「忘记查询密码」。`
- 下单页密码框下方常驻提示（与 §11.3 合并展示，不额外占行）：
  `再次购买时请填写上次设置的查询密码；如果忘记了，直接设置一个新密码即可，原订单仍用原密码查询。`

> 第二条提示很重要：它把「分组」这个内部概念翻译成了用户能理解的因果，
> 否则用户第二次下单换了密码、回头查不到第一单，会当成 bug 报客服。

#### 6.4.5 与配额的关系（**关键，修订 §14**）

分组模型让「换密码重置配额」成为可能——攻击者可以不停新建分组来刷新身份。
因此**促销配额的计数口径必须是 `contact_hash`（跨该邮箱全部分组求并集），而不是 `buyer_id`**：

- **访问控制**用 `buyer_id`（单分组，严格隔离，防串号）。
- **配额计数**用 `guest_shop_orders.buyer_contact_hash`（跨分组并集，防轮换刷额度）。

两者职责分离，缺一不可。`guest_shop_orders.buyer_contact_hash` 是已存在的列
（`supabase/migrations/20260913_add_guest_shop_cash_purchase.sql:130`），计数**不需要 join** `guest_shop_buyers`。

---

## 7. 传输与前端存储

### 7.1 传输：新增专用 header，**不用 `Authorization`**

独角用 `Authorization: Guest <base64url(email\npassword)>`。我们不能照抄，因为
`tests/guest-shop-frontend-contract.test.js:57` 明确断言 guest 脚本
`doesNotMatch(/supabase|access_token|Authorization\s*:/i)` —— 这条断言的意图是
「游客通道绝不接触任何登录态凭证」，是有价值的资产，不该为了形似而削弱。

**2.0 决定**：使用专用 header

```
X-Guest-Order-Credential: <base64url(email_lower_trimmed + "\n" + password)>
```

- 安全属性与独角完全等价（不进 URL、不进日志、不进 Referer），但**契约测试零改动即可保持**。
- 服务端解析：长度上限（email ≤320、password ≤128）、base64url 严格解码、
  `split("\n", 2)`、trim、email 转小写。任何不合规 → `400 guest_credential_malformed`。
- **同时硬性拒绝** query 中的 `email` / `order_password` / `password` 参数：
  出现即 `400`，并写审计 `outcome=rate_limited`。要**写成测试**（对齐独角 `guest_auth_test.go:25`）。
- 新增契约测试断言：guest 脚本必须出现 `X-Guest-Order-Credential`，
  且必须 `doesNotMatch(/Authorization\s*:|\?email=|order_password=/)`。

### 7.2 前端存储：sessionStorage-only

直接采用独角 `guestOrderAuth.ts` 的三层设计：

1. 内存变量优先（`volatileGuestOrderAuth`）；
2. `sessionStorage['guest_order_auth']`；
3. 一次性 `localStorage → sessionStorage` 迁移，**迁移后立即 `removeItem`**，且**永不回写 localStorage**。

存储被禁用（隐私模式）时静默降级到内存，不报错、不阻断查询。
页面提供**「清除本机查询凭证」**按钮（对应独角 `clearSaved`）。

> 注意：现有契约测试 `doesNotMatch(client, /localStorage/)` 是针对
> `js/guest-shop-client.js` 的。新页面用**独立脚本** `js/guest-orders-client.js`，
> 但为了保持同一隐私基线，新脚本同样**禁止出现 `localStorage` 写入**——
> 迁移读取用 `window.localStorage.getItem/removeItem` 的**动态属性访问**形式实现，
> 并在契约测试里显式允许 `removeItem`、禁止 `setItem`。这条要写进测试注释说明原因。

---

## 8. 防爆破（补独角的洞，2.0 的承重墙）

### 8.1 双维度锁定

| 维度 | 键 | 阈值 | 动作 |
|---|---|---|---|
| 买家 | `buyer_id`（命中邮箱） | 10 分钟内 **5** 次 `bad_password` | `login_lock_stage` 递进：1→锁 15min，2→锁 30min，3→锁 24h，第 4 次→ `stage=3` 且需管理台解锁 |
| IP | `request_ip_hash` | 10 分钟内 **20** 次失败（跨所有邮箱） | 该 IP 的游客订单查询全部 `429`，退避 30min |
| IP（粗限流） | 复用现有 `limit(req,res,'guest-orders',{limit:N})` | 读 30/min、写 10/min | `429` |

- 计数写入用**乐观 CAS 循环**，直接复用 `recordClaimFailure` 已验证的写法
  （`guest-shop.js:recordClaimFailure`：读 → 条件 `eq('failed_login_count', current)` 更新 → 失败重读重试），
  避免并发丢增量。**不要**写成 `SET x = x + 1` 而无阶段判定。
- 锁定期间**不执行 scrypt**（直接 `423 guest_order_locked`），既省 CPU 又不给时间侧信道。

### 8.2 验证码升级（复用促销方案 §20-A 的场景化设施）

- 新增场景 `guest_order_login`。
- 触发条件（任一）：同一 buyer 连续失败 **3** 次；同一 IP 连续失败 **8** 次。
- 触发后必须携带有效验证码 token 才继续校验密码；服务端 siteverify。
- **未触发时不加码**，保证正常用户零摩擦。

### 8.3 撞库与密码复用的产品级缓解

- 下单表单密码框下方固定文案（§11.3）：**「请设置一个只用于查询本站订单的密码，不要使用你在其他网站常用的密码。」**
- 该密码**只用于游客订单查询**，与本站账号体系完全隔离：
  - 不参与登录、不复用到 `auth.users`、不写入任何用户表；
  - 服务端**不得**用它做任何其他鉴权（写成契约测试断言）。
- 管理台可见「该邮箱是否存在注册账号」（`registered_user_match`），但**不可见密码哈希**。

### 8.4 常数时间与时间侧信道

- 密码比对 `crypto.timingSafeEqual`。
- **邮箱不存在时也跑一次 scrypt**（用固定 dummy salt/hash），使
  `unknown_email` 与 `bad_password` 的响应时间不可区分（§3 W4）。
- 两种情况返回**完全相同**的错误码与文案（§9）。

---

## 9. 错误语义与防枚举

### 9.1 统一错误码

| 场景 | HTTP | code | 用户文案 |
|---|---|---|---|
| 邮箱不存在 / 密码错误 / 该邮箱无游客订单 | 403 | `guest_order_credentials_invalid` | 邮箱或查询密码不正确 |
| 凭证格式非法 | 400 | `guest_credential_malformed` | 请输入邮箱和查询密码 |
| 锁定中 | 423 | `guest_order_locked` | 尝试次数过多，请稍后再试 |
| 需要验证码 | 428 | `guest_captcha_required` | 请完成人机验证 |
| 限流 | 429 | `guest_rate_limited` | 操作过于频繁，请稍后再试 |
| 订单不属于该凭证 | 404 | `guest_order_not_found` | 未找到该订单 |
| 配置缺失 | 503 | `guest_shop_misconfigured` | 服务暂不可用，请联系客服 |
| 下单时该邮箱凭证分组已满（§6.4.2 第 5 步） | 409 | `guest_buyer_credential_conflict` | 该邮箱已设置过 3 套查询密码，为保护订单安全无法再新增 |

**关键**：`guest_order_credentials_invalid` 覆盖三种不同内部原因，
内部原因只写审计表（`outcome` 字段区分），**绝不出现在响应体、响应头、日志里**。
这一点现有 `loadOrderByNo` 已经做对了（`guest-shop.js:1653` 注释），2.0 沿用。

> **唯一一处刻意的信息泄露**：`guest_buyer_credential_conflict` 会让攻击者得知
> 「该邮箱在本站下过单且已用满 3 套密码」。这是 §6.4 在「防卡密串号」与「防枚举」之间
> 的显式取舍——前者是资损，后者只是情报，**资损优先**。
> 缓解：该错误只在**下单**路径出现（已要求填完整订单表单 + 通过商品级风控），
> 且计入 §8.1 的 IP 限流；查询路径**永不**返回它。
> `guest_shop_access_attempts.outcome` 需相应增加 `credential_conflict` 取值（§5.3 CHECK 同步）。

### 9.2 订单详情/卡密的越权

- 查详情必须同时满足：`order_no` 存在 **AND** `buyer_id` 匹配 **AND** 未被并入其他账号。
- 不满足统一 `404 guest_order_not_found`（**不是 403**，避免泄露订单号是否存在）。
- 卡密接口额外要求：`payment_status='confirmed'` 且发货已完成，否则 `409 guest_order_not_ready`。

---

## 10. 与注册账号的关系（独角完全没做，我们必须做）

### 10.1 下单时邮箱命中注册账号

沿用促销方案 §7.3（C-A5）的判定，2.0 扩展为：

| 场景 | 行为 |
|---|---|
| 邮箱已注册 + 游客**不使用优惠码** | **允许下单**（不影响正常游客），`registered_user_match=true` 记录在案 |
| 邮箱已注册 + 游客**要用优惠码** | 拒绝促销，返回 `guest_discount_unavailable`，文案给「登录后在钱包使用积分兑换」的入口 |
| 下单表单旁提示 | 「该邮箱已注册？登录后订单会自动出现在『我的钱包 → 订单记录』」+ 登录按钮 |

### 10.2 同一邮箱的游客订单 vs 账号订单

**默认不合并、不互见。** 游客订单只在 `/guest-orders.html` 用邮箱+密码查；
账号订单只在「我的钱包」用登录态查。理由：合并需要「证明邮箱所有权」，
在未验证邮箱前合并会造成**跨账号信息泄露**（A 用 B 的邮箱下过游客单，B 注册后就能看到）。

### 10.3 邮箱验证（OTP）后解锁的三件事

`email_verified_at` 一旦回填（走促销方案 §20-B 的 OTP 设施）：

1. **自助忘记密码**：发 OTP → 验证 → 重设查询密码（`password_version+1`，旧凭证立即失效）。
   在 OTP 上线前，忘记密码**只能走客服**（§10.5）。
2. **游客订单并入账号**（§10.4）。
3. `contact_hash` 升级为**已验证身份因子**，促销配额阈值可放宽（促销方案 §7.2、§20-B）。

### 10.4 并入注册账号（一次性、需验证邮箱）

- 入口：已登录用户在「我的钱包 → 订单记录」看到
  「有 N 笔游客订单？验证邮箱后并入」的横幅（仅当存在 `contact_hash` 相同且
  `merged_into_user_id IS NULL` 的 `guest_shop_buyers` 行时显示）。
- 动作：发 OTP 到该邮箱 → 验证 → `UPDATE guest_shop_buyers SET merged_into_user_id=?, merged_at=NOW()`
  → 把这些订单的 `user_id` 回填（**写在迁移文件里的 SQL 函数，带幂等条件**）。
- 并入后：游客凭证**继续有效**（不强制失效，避免用户突然查不到），
  但 `/guest-orders.html` 对已并入的买家显示「这些订单已并入你的账号，请登录查看」并停止返回卡密。
- 全过程写审计。**并入是不可逆的**，管理台可解并（需二次确认 + 审计）。

### 10.5 OTP 上线前的忘记密码路径

- 页面文案：「忘记查询密码？请联系客服，提供订单号与下单支付方式以便核实。」
- 管理台新增操作（`server/api-handlers/admin/shop/guest-orders.js` 扩展）：
  - `解锁登录锁定`（清 `failed_login_count` / `locked_until` / `login_lock_stage`）
  - `重置查询密码`（管理员设置临时密码，**一次性**，首次登录强制改密）
  - `生成一次性找回链接`（**复用现有 `claim_secret_hash` 通道**，15 分钟有效，用后即焚）
  - 全部操作写审计，且**不得在日志/聊天中打印**临时密码或链接（对齐 `AGENTS.md` 禁令）。

---

## 11. UI

### 11.1 登录用户：零改动（不可回归项）

「我的钱包 → 订单记录」的弹窗、列表、详情、卡密展示**一行都不动**。
写进回归测试清单（§15.3），并在 PR 描述里显式声明「未触碰登录态订单 UI」。

### 11.2 游客：新页面 `/guest-orders.html`，布局对照独角

逐区块对齐 `frontend/user/src/views/GuestOrders.vue`：

| 独角区块 | 独角实现 | 2.0 落地（本站为服务端渲染 HTML + 原生 JS，非 Vue） |
|---|---|---|
| 页头 | `ClipboardList` 图标 + `guestOrders.title` + `subtitle` | 同构：图标 + 「游客订单查询」+ 「用下单时填写的邮箱和查询密码查看订单与卡密」 |
| 已保存凭证提示条 | `hasSavedAuth` 时显示 `savedHint{email}` + 「清除」链接 | 同构，显示 `已保存 xxx@xx 的查询凭证` + `清除本机凭证` |
| 查询表单 | **4 列网格**：邮箱 / 查询密码 / 订单号(可选) / 查询按钮，`h-11` | 同构（移动端降为单列，沿用 `css/shop-page.css` 的 `@media (max-width:600px)` 约定） |
| 提示文案 | `guestOrders.tip` | 「订单号可留空，留空则列出该邮箱下全部订单。」 |
| 错误提示 | `Alert variant="destructive"` | 同构，复用现有 `.shop-alert--error` 类 |
| 空状态 | `EmptyState icon="order"` | 同构 |
| 订单卡 | 订单号（小字 uppercase）→ 金额（`text-lg font-bold`）→ **优惠明细**（券折扣/活动折扣，`rose-600`）→ 创建时间 → 状态 Badge → 「查看详情」→ 待支付时「立即支付」 | 同构。**优惠明细两行是促销方案的前置 UI**，2.0 先把容器做出来，L1/L2 上线后自然填充 |
| 分页 | `PaginationNav` | 同构 |
| 详情页 | `/guest/orders/:order_no` → `GuestOrderDetail.vue` | `guest-orders.html?order_no=xxx`（同一页面内的详情态，避免多一个路由）或独立 `guest-order-detail.html`，**推荐前者** |
| 卡密下载 | `GET /guest/orders/:no/fulfillment/download`（blob） | `GET /api/shop/guest/orders/:no/delivery` + 「复制发货内容」按钮（沿用现有 `guestCashCopyDeliveryBtn` 交互） |

新增文件：

- `guest-orders.html`
- `js/guest-orders-client.js`（带 `?v=` 版本号，遵循仓库既有 cache-busting 约定）
- `css/guest-orders.css`（或并入 `css/shop-page.css`，**推荐独立文件**以免污染商城页回归面）

入口：

- `shop.html` 游客弹窗里现有的「找回订单」按钮 → 改为跳转 `/guest-orders.html`；
  **删除**弹窗内 `guestCashRecoveryPanel`（`shop.html:767`，订单号 + 取货口令）与
  `guestCashRecoveryCodePanel`（`shop.html:758`，口令一次性展示）两个 section，
  并清理 `js/guest-shop-client.js` 的 `showRecoveryCode` / `resetOrderUi({preserveRecovery})` /
  `guestCashRecoveryOrderNo` / `guestCashRecoveryCodeInput` 相关分支（`:979-1008`、`:1118-1139`）。
- **必须同步修改契约测试**：`tests/guest-shop-frontend-contract.test.js:59-60` 现在
  **断言这两个 panel id 必须存在**，删除 UI 会让这两条断言失败。改为断言新入口
  （`guest-orders.html` 链接存在、两个 panel id 不再出现）。
- 命名注意：现有前端用的是 `recovery_code`（不是 `claim_secret`）；契约测试第 58 行禁止
  guest 脚本出现 `X-Guest-Claim-Secret|claimSecret|claim_secret`，第 57 行禁止
  `Authorization\s*:`（大小写不敏感）。新文件 `js/guest-orders-client.js` 必须同样满足这两条，
  这是 §7.1 选用 `X-Guest-Order-Credential` 而非 `Authorization: Guest` 的直接原因。
- 页脚/帮助区加「游客订单查询」链接。

### 11.3 下单表单新增字段（文案定稿）

```
邮箱            [________________________]  必填，用于查询订单与接收通知
查询密码        [________________________]  必填，8 位以上，含字母和数字
                                            ↳ 请设置一个只用于查询本站订单的密码，
                                              不要使用你在其他网站常用的密码。
☐ 我已阅读并同意《用户协议》《隐私政策》      （沿用现有勾选，不新增）
```

- `autocomplete="username"` / `autocomplete="new-password"`（**不是** `current-password`，
  避免浏览器提示复用已存密码——这正是我们要防的）。
- 提供「显示密码」眼睛按钮（独角没有，但对首次设置密码很有用）。
- 二次确认框：**不做**（增加摩擦，且密码强度校验已足够）。

---

## 12. API 契约

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/shop/guest/preview` | 无 | **不变**（GET+query 现状保持；促销方案会另加 POST quote） |
| POST | `/api/shop/guest/orders` | 无（body 内带 email + password） | **变更**：`email` 由选填改必填，新增 `orderPassword`；沿用 `normalizeGuestOrderInput` 的 `forbiddenFields` 机制拦截客户端传金额 |
| GET | `/api/shop/guest/status` | 无（现有机制不变） | **不变**，支付轮询仍用现有 status 通道，避免把凭证塞进高频轮询 |
| GET | `/api/shop/guest/orders` | `X-Guest-Order-Credential` | **新增**：列表 + 分页，可选 `order_no` 精确过滤 |
| GET | `/api/shop/guest/orders/:orderNo` | `X-Guest-Order-Credential` | **新增**：详情 |
| GET | `/api/shop/guest/orders/:orderNo/delivery` | `X-Guest-Order-Credential` | **新增**：卡密（仅 `confirmed` + 已发货） |
| POST | `/api/shop/guest/access/login` | 无 | **新增**：显式校验凭证，成功返回一个**短时会话 cookie**（见下），失败走 §8 锁定 |
| POST | `/api/shop/guest/recover` | 无（body: orderNo + recoveryCode） | **保留**，仅服务历史订单 |
| GET | `/api/shop/guest/claim` | 现有 claim 通道 | **保留** |

**关于「每次请求都带密码」vs「登录后发会话」**：
独角是前者（每个请求都重发 email+password）。2.0 采用**混合**：

- `POST /access/login` 校验通过后签发 `__Host-gs-acc`（httpOnly、Secure、SameSite=Strict、
  Path=/api/shop/guest、Max-Age 30 分钟滑动），值为 AES-256-GCM 加密的
  `{buyer_id, contact_hash, exp}`，复用现有 `encryptClaimCookie` 范式
  （`guest-shop.js:267-315`）与**促销方案 §7.1 的同一套会话基础设施**。
- 列表/详情/卡密接口**同时接受**会话 cookie 或 `X-Guest-Order-Credential`（cookie 优先）。
- 好处：① 密码不必在每次请求里重复传输，缩小暴露面；② 卡密下载走浏览器原生导航
  （无法自定义 header）时可用会话 cookie；③ **与促销方案的服务端会话合流成同一套设施**，
  不重复造轮子。
- 会话丢失只是回到「重新输入邮箱密码」，**不会放松任何配额**（促销方案 §7.1 已确立的原则）。
- **cookie 载荷里的 `buyer_id` 就是命中的那个凭证分组**，因此会话通道天然继承 §6.4.2 的分组隔离：
  持有 group=2 会话的客户端**无法**读取 group=1 的订单或卡密。
  实现时严禁把 cookie 载荷退化成 `contact_hash`（那会跨分组放行，等于把 §6.4 的防串号打穿）。

---

## 13. 迁移与兼容

### 13.1 历史订单

- 历史行 `buyer_id IS NULL`，仍只能用「订单号 + 取货口令」找回。
- 新页面底部折叠区：`使用订单号 + 取货口令找回（适用于 2026-09 之前的订单）`，
  提交到现有 `/api/shop/guest/recover`，**零改动**。

### 13.2 历史订单升级为密码访问（可选，用户自助）

- 折叠区内加「为这笔订单设置查询密码」：验证订单号 + 取货口令成功后，
  要求输入邮箱 + 新查询密码 → 创建/关联 `guest_shop_buyers` → 回填 `buyer_id`。
- 幂等：同一订单重复设置返回同一结果；`buyer_id` 已存在且不同 → `409`，需客服处理。

### 13.3 新订单是否还生成取货口令

**生成，但不展示。** 理由：

- `claim_secret_hash` 是现有 webhook / claim 链路的既有依赖，删列风险大、收益小；
- 它是**唯一的客服 break-glass 通道**（§10.5 的一次性找回链接依赖它）；
- 不展示给用户 ⇒ 用户视角上「订单号 + 口令」这条路已经消失，符合 R1。

对应改动：删除 `guestCashRecoveryCodePanel` 的展示逻辑与 `showRecoveryCode` 调用，
但保留服务端 `deriveClaimSecretFromIdempotencyKey` / `hashClaimSecret` / `setClaimProofCookie`。
契约测试里 `doesNotMatch(client, /claimSecret|claim_secret/)` 的断言**保持不变**
（因为客户端本来就不该出现），只需删掉对 `guestCashRecoveryCodePanel` 的 `match` 断言。

### 13.4 灰度期共存

- 开关 `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED`：
  - `false`：下单表单不显示查询密码字段，`email` 仍选填，新页面返回 404 → **完全等于现状**；
  - `true`：新链路生效，旧链路（recover/claim）继续可用。
- 开关默认 `false`，**部署不等于启用**（对齐 `AGENTS.md`）。

---

## 14. 对促销加固方案的反哺（本次升级最大的收益）

促销方案 §7.5 承认：`contact_hash` 因为不验证、不抗伪造，**不是可信身份因子**。
2.0 把邮箱变成**有密码保护的凭证**后，情况发生质变：

| 因子 | 促销方案 §7.2 原评级 | 2.0 之后的评级 | 原因 |
|---|---|---|---|
| `buyer_contact_hash` | ~~高（真实身份）~~ → 可伪造 | **高（主判据）** | 2.0 之后邮箱是**下单必填**且有密码保护；配额按 `contact_hash` **跨该邮箱全部凭证分组求并集**（§6.4.5），所以「换密码 / 新建分组」**无法重置配额** |
| `guest_session_hash` | 中（清 cookie 即失效） | 中（兜底） | 不变；覆盖未走凭证链路的降级下单 |
| `request_ip_hash` | 低（NAT） | 低（粗防洪兜底） | 不变 |
| `request_device_hash` | 低（仅 UA） | **移除** | 仅由 UA 派生，误伤 NAT / 同型号用户的代价高于防薅收益；独角的游客风控键同样只有 IP（促销方案 §21.2） |

> **注意 `buyer_id` 不是配额因子。** 它只用于**访问控制**（§6.4.2：命中哪个分组就只能看哪个分组的订单）。
> 若误用 `buyer_id` 计数，攻击者新建一个凭证分组即可刷新额度——这是 §6.4.5 专门防的坑。

**更重要的结构性变化**：`guest_shop_buyers.id` 是一个**跨会话、跨设备、用户主动维护**的稳定主键。
促销配额可以直接按 `buyer_id` 计数，不再依赖四因子并集的模糊匹配：

```sql
-- 促销配额计数谓词（2.0 修订版，取代促销方案 §7.2 的四因子 OR）
-- 三个因子各自独立设阈值，不做单一全局阈值，避免 NAT 误伤（详见促销方案 §7.2 阈值表）
SELECT COUNT(*) FROM guest_shop_orders o
WHERE o.discount_code IS NOT NULL
  AND o.payment_status NOT IN ('expired','failed','amount_mismatch','chargeback','refunded')
  AND COALESCE(o.refund_status,'none') <> 'succeeded'
  AND (
        -- 主判据：跨该邮箱全部凭证分组，已有列，无需 join guest_shop_buyers
        (p_contact_hash IS NOT NULL AND o.buyer_contact_hash = p_contact_hash)
        -- 兜底：未走凭证链路的降级下单
     OR (p_session_hash IS NOT NULL AND o.guest_session_hash = p_session_hash)
        -- 粗防洪：阈值最宽
     OR (p_ip_hash IS NOT NULL AND o.request_ip_hash = p_ip_hash)
  );
```

建议阈值（比促销方案 §7.2 更严，因为 `contact_hash` 现在是凭证保护的可信因子）：

| 因子 | 每码上限 | 每日上限 |
|---|---|---|
| `buyer_contact_hash`（主判据） | **1** | **3** |
| `guest_session_hash`（兜底） | 1 | 3 |
| `request_ip_hash`（粗防洪） | 3 | 20 |

**降级语义**：`GUEST_SHOP_BUYER_CREDENTIAL_ENABLED=false`（即 `p_contact_hash` 为 NULL）时，
谓词自动退化为 session + ip 两因子，**不得 fail-open 成「没有主判据就不限额」**。
这条必须进 readiness 与 §16.1 测试。

**结论：2.0 让促销方案的身份层从「四个都不可信的因子做 OR」收敛为
「一个凭证保护的主键 + 两个兜底」，配额体系第一次有了真实地基。**
因此建议落地顺序调整（§19）。

> 本节结论已回写进促销方案 `docs/guest-shop-promo-hardening-plan.md` §22（含修订后的计数谓词、
> 因子处置表、分期修订与降级语义）。两份文档冲突时以促销方案 §22 为准。

---

## 15. 开关、readiness 与灰度

### 15.1 开关层级（全部默认关）

```
GUEST_SHOP_BUYER_CREDENTIAL_ENABLED=false      # 2.0 主闸（env）
GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED=false     # 新页面是否可访问（env）
GUEST_SHOP_PROMO_ENABLED=false                 # 促销主闸（促销方案 K1）
  └─ 券级 allow_guest / guest_max_uses / guest_max_total_discount
      └─ 站点 daily_budget_cny
          └─ 熔断器
```

任意一层缺失或非法 → **fail-closed**（拒绝促销，但**允许原价购买**，对齐促销方案 P10）。

### 15.2 readiness 扩展（`npm run readiness:guest-shop`）

新增检查项，缺失即退出码 `3`（**预期 fail-closed，禁止 `|| true`**）：

1. `GUEST_SHOP_CONTACT_HASH_PEPPER` 存在且长度 ≥ 32（**不打印值**）。
2. `guest_shop_buyers` 表存在，5 条 CHECK 约束与 UNIQUE 约束齐备。
3. `guest_shop_orders.buyer_id` 列与索引存在。
4. scrypt 参数不低于策略下限（解析一条样本行的格式前缀）。
5. `guest_shop_access_attempts` 存在且有 30 天清理任务。
6. 脏配置扫描：`password_hash` 不符合 `^scrypt\$` 前缀的行数 = 0。
7. 若 `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED=true`，则 `/guest-orders.html` 必须可访问，
   且 `/api/shop/guest/orders` 必须**拒绝** query 形式凭证。

### 15.3 灰度

| 阶段 | 内容 | 验收 |
|---|---|---|
| G0 | 迁移文件写盘 + readiness 扩展，开关全关 | 全量测试基线不退化；线上行为**零变化** |
| G1 | 内部开启 `BUYER_CREDENTIAL_ENABLED`，仅自己下单验证 | 下单/查询/详情/卡密全链路截图归档 |
| G2 | 开启新页面，旧弹窗入口并存 | 历史订单仍可用口令找回 |
| G3 | 删除弹窗内口令面板，新页面成为唯一入口 | 客服工单量对比 |
| G4 | 与促销 L2 合并，`buyer_id` 成为配额主判据 | 促销方案 §15.4 实机证据 |

---

## 16. 测试计划

### 16.1 单元 / 集成（新增）

- scrypt 编解码往返、参数升级路径（低参数行登录成功后透明 rehash）。
- 密码策略每条规则的通过/拒绝用例，含「密码包含邮箱本地部分」。
- `X-Guest-Order-Credential` 解析：合法、非法 base64、缺 `\n`、超长 email、超长 password。
- **query 形式凭证必须被拒**（对齐独角 `guest_auth_test.go`）。
- 锁定阶段机：5 次失败 → 15min → 30min → 24h → 人工；锁定期间不跑 scrypt。
- 时间侧信道：`unknown_email` 与 `bad_password` 都执行了一次 scrypt（用 spy 断言调用次数）。
- 错误码统一：三种内部原因返回同一 code，且响应体不含内部原因字符串。
- 越权：A 的凭证查 B 的订单 → 404；已并入账号的订单 → 卡密接口拒绝。
- **凭证分组隔离（§6.4，必须有专测）**：同邮箱 group=1/2 各挂一单，用 P_a 登录只见 group=1 的订单，
  用 P_b 登录只见 group=2 的订单；卡密接口同样隔离。
- **防抢占（§6.4.2 第 4 步）**：受害者先用 V/P_v 下单；攻击者用 V/P_a 下单**不得覆盖** P_v，
  且攻击者用 V/P_a 登录**看不到**受害者订单；受害者用 V/P_v 仍能查到自己的订单。
- **分组上限**：第 4 个分组被拒（K38=3），且拒绝时不跑 scrypt、不泄露已有分组数以外的信息。
- **配额不因换密码重置（§6.4.5）**：同邮箱新建分组后，促销配额计数**不变**（按 contact_hash 并集）。
- **降级**：`BUYER_CREDENTIAL_ENABLED=false` 时配额走 session+ip，且不是「不限额」。
- CAS 计数在并发下不丢增量（复用现有 claim 失败计数的测试范式）。

### 16.2 契约测试（扩展 `tests/guest-shop-frontend-contract.test.js`）

- 新增 `js/guest-orders-client.js` 的隔离断言：
  `doesNotMatch(/supabase|access_token|Authorization\s*:|Bearer/i)`、
  `doesNotMatch(/localStorage\s*\.\s*setItem/)`、
  `match(/X-Guest-Order-Credential/)`、`match(/sessionStorage/)`。
- `shop.html`：删除对 `guestCashRecoveryPanel` / `guestCashRecoveryCodePanel` 的 `match` 断言，
  新增「找回订单按钮指向 `/guest-orders.html`」断言。
- **保持** `doesNotMatch(client, /X-Guest-Claim-Secret|claimSecret|claim_secret/)` 不变。
- 登录态订单 UI 的快照断言（§11.1 不可回归项）。

### 16.3 回归

- 基线：main = **3156 pass / 0 fail**（促销方案已实测）。2.0 完成后必须 **≥3156 pass / 0 fail**。
- 游客原价下单、支付、webhook、claim、worker、管理台游客订单页全链路不退化。

### 16.4 实机（由你执行，Codex 不执行 SQL、不启用商品）

归档到 `docs/guest-shop-promo-evidence.md`：下单截图、查询页截图、详情+卡密截图、
锁定触发截图、历史订单口令找回截图、readiness 退出码 3 的输出。

---

## 17. 需要你确认的旋钮（2.0 新增，接促销方案 K1–K24）

| # | 旋钮 | 默认 | 建议范围 | 我的推荐 |
|---|---|---|---|---|
| K25 | `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED` | `false` | — | G0/G1 保持 false |
| K26 | 查询密码最小长度 | **8** | 6~16 | **8**（独角是 6，太弱） |
| K27 | 复杂度要求 | 字母+数字 | — | 保持 |
| K28 | scrypt 参数 | `N=32768,r=8,p=1` | — | 保持；登录时透明升参 |
| K29 | buyer 失败锁定 | 5 次/10min → 15/30/1440min | — | 保持 |
| K30 | IP 失败锁定 | 20 次/10min → 30min | 5~100 | **20**（NAT 误伤可控） |
| K31 | 验证码触发 | buyer 3 次 / IP 8 次失败 | — | 保持 |
| K32 | 访问会话有效期 | 30 分钟滑动 | 5min~24h | **30min**（卡密下载够用，泄露窗口小） |
| K33 | 邮箱命中注册账号时是否允许游客下单 | **允许**（仅禁促销） | 允许/拒绝 | **允许**，否则伤害正常游客 |
| K34 | 新订单是否仍生成取货口令（不展示） | **是** | 是/否 | **是**，客服 break-glass 需要它 |
| K35 | 历史订单自助升级为密码访问 | **开** | 开/关 | 开 |
| K36 | 审计表保留期 | 30 天 | 7~180 | **30** |
| K37 | 游客订单是否发通知邮件 | **关** | 关/开 | **先关**；开启前必须先做「每邮箱每日发信上限」，否则会变成邮件轰炸工具 |
| K38 | 单邮箱凭证分组上限（§6.4） | **3** | 1~5 | **3**。设 1 等于「忘密码就买不了」，会在 OTP 上线前形成购买墙；设过大则放任抢占 |
| K39 | 重复下单是否要求密码匹配才复用旧分组 | **是** | 是/否 | **是**（§6.4.2 第 3 步）。选「否」则每次都新建分组，很快撞到 K38 上限 |

> K37 是唯一可能把「邮箱不验证」变成实际危害的旋钮。建议 OTP（§10.3）上线前保持关闭。

---

## 18. 硬性禁止（继承 `AGENTS.md` + 促销方案 §17）

1. Codex **不执行任何 SQL**；迁移文件写盘 + 给绝对路径。
2. **不在部署中启用**游客商品、游客 SKU、游客促销、`BUYER_CREDENTIAL_ENABLED`。
3. **不从功能分支** `vercel deploy --prod`；走专用分支 → PR → main → Git 集成部署。
4. **不打印**查询密码、密码哈希、`GUEST_SHOP_*` 任何密钥值、claim token、恢复码、找回链接。
5. **不复用** `CRON_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` 作为 `GUEST_SHOP_CONTACT_HASH_PEPPER`。
6. **不存明文邮箱**、不存明文密码、不把凭证写进 URL / query / localStorage / 日志 / provider metadata。
7. **不降低** webhook 与 `fn_guest_shop_confirm_payment` 的任何校验严格度。
8. **不删除** `claim_secret_hash` 及其通道（历史订单与客服 break-glass 依赖它）。
9. **不改动**登录用户「我的钱包 → 订单记录」的任何 UI 与接口。
10. **不用 `|| true` 绕过 readiness**；退出码 3 是预期 fail-closed。
11. 回滚 = 关开关，**不是** DB 回滚。
12. 没有 §16.4 实机证据，不得宣称 2.0「完成」或「可启用」。

---

## 19. 分期（2.0 修订后的总落地顺序）

```
A0  迁移文件写盘（guest_shop_buyers / buyer_id / access_attempts）+ readiness 扩展
      └─ 零行为变更，开关全关
A1  下单表单收集查询密码 + scrypt 存储 + buyer upsert + 订单关联
A2  /guest-orders.html + js/guest-orders-client.js + 列表/详情/卡密接口
      └─ 含 §8 全部防爆破 + §9 错误语义 + §16.2 契约测试
A3  管理台：解锁 / 重置密码 / 一次性找回链接；历史订单自助升级（§13.2）
─────────────── 以上为 2.0 订单访问，可独立上线 ───────────────
L0  促销 DDL + 策略表 + readiness（促销方案）
L1  游客阶梯价 + 闪购（**无状态价格规则，不依赖身份层**，§21.5-1）
L2  服务端会话 + 优惠码 + 硬预算  ┐ **必须与 L3 同一 PR**
L3  金额权威（单一 SQL resolver） ┘
      └─ 配额主判据切换为 buyer_id（§14）
L4  管理台促销配置 UI + 支付行为信号（§20-C）
A4  邮箱 OTP → 自助改密 + 游客订单并入账号（§10.3/§10.4）
```

**A0–A3 与 L0–L1 可并行**，因为写集合不相交（A 系列动 `guest_shop_buyers`/凭证/新页面，
L 系列动 `discount_codes`/定价 resolver/库存闸）。**A4 必须在 L2 之后**，
因为它依赖促销方案的 OTP 设施与 `contact_hash` 因子升级。

---

## 20. 一句话总结

**把「不可猜测但不可记忆」的取货口令，换成「可记忆但可猜测」的邮箱+查询密码，
代价是凭证熵从 240 bit 掉到 45 bit。2.0 用八件事把代价补回来：scrypt 加盐慢哈希、
双维度指数锁定、失败后场景化验证码、常数时间比较与等价开销的防枚举、专用 header 传输、
sessionStorage-only、凭证分组模型（§6.4，既让用户忘密码仍能下单、又让后下单者读不到先下单者的卡密）、
以及访问控制与配额计数职责分离。最大的意外收益是：促销配额第一次拥有了一个
用户主动维护、跨会话跨设备稳定的可信主判据 `buyer_contact_hash`（§14），
而 `buyer_id` 只负责访问隔离、**绝不参与配额**——这一条写错就会被「换密码刷额度」打穿。**
