# §15.4 九项沙箱实机验证 · 操作手册（Runbook）

> 对应要求：`docs/guest-shop-promo-hardening-plan.md` **§15.4**（九项）+ **§15.5**（演练与归档）
> 对应登记表：`docs/guest-shop-promo-evidence.md` **§2.6**（当前 **0 / 9**，全部「⬜ 未执行」）
> 执行者：**你本人**（Supabase SQL Editor + 本机 preview + 浏览器）
> Codex 的角色：**只交付脚本与路径，不执行任何 SQL、不启用任何游客商品、不打印任何密钥**
>
> 本手册配套 4 个沙箱产物（均为**未跟踪**文件，位于 `supabase/sandbox/`，不参与测试扫描）：
>
> | # | 绝对路径 | 性质 | 执行者 |
> |---|---|---|---|
> | 1 | `/Volumes/chao/AI/xianyu_profit_calculator/supabase/sandbox/S154_probe_readonly.sql` | **只读**（段 0–段 17） | SQL Editor |
> | 2 | `/Volumes/chao/AI/xianyu_profit_calculator/supabase/sandbox/S154_fixture_setup.sql` | **写库**（4 处，全部可还原） | SQL Editor |
> | 3 | `/Volumes/chao/AI/xianyu_profit_calculator/supabase/sandbox/S154_cleanup.sql` | **写库**（还原 + R1–R6 报告） | SQL Editor |
> | 4 | `/Volumes/chao/AI/xianyu_profit_calculator/supabase/sandbox/s154-guest-promo-toolbox.js` | service_role RPC / HTTP 工具箱 | 本机 `node` |
> | 5 | `/Volumes/chao/AI/xianyu_profit_calculator/docs/guest-shop-promo-sandbox-runbook.md` | 本手册 | — |

---

## §0 先读：红线与「沙箱」到底沙在哪

### 0.1 红线（与 `AGENTS.md` 一致，违反即视为事故）

1. **Codex 永不执行 SQL。** 所有 `.sql` 都由你在 Supabase SQL Editor 里手工整块执行。
2. **发布 ≠ 启用。** 本轮沙箱**不部署**、**不打开**任何生产游客商品开关。
   「哪些商品是游客商品」始终由你在 Admin Studio 里逐个开关决定，脚本一律不碰
   `shop_products` / `shop_product_skus`（fixture 的 **H-3** 护栏会断言而不是修改）。
3. **永不打印密钥**：`GUEST_SHOP_*` pepper、zpay `pid`/`pkey`、worker secret、claim secret、
   卡密内容、`password_hash`、完整 `contact_hash` / `ip_hash`。工具箱输出前统一过 `redact()`。
4. **回滚用开关，不用 DB 回滚。** 出问题先关游客商品/促销开关，不要 `DROP`/`ALTER` 生产表。

### 0.2 「沙箱」的真实构成（**别误解成隔离环境**）

```
沙箱 = 本机未部署的新代码  +  生产数据库  +  真实支付通道
       └─ preview:8000        └─ Supabase     └─ ZPay / NOWPayments
```

三条直接后果，务必先接受：

- **写进库的就是真数据。** 台账（`guest_shop_discount_redemptions`）、订单
  （`guest_shop_orders`）、预算 `spent_cny`、熔断审计行都会真实落库。
  因此夹具只碰 **`SBX` 前缀**的沙箱券，cleanup **保留**台账与订单行作为审计证据（见 §3 的 N-1）。
- **付出去的是真钱。** 第 2 项要真实支付 ¥9.09。第 3 项「少付」**不要真金少付**，
  改用工具箱伪造回调（见 §2 第 3 卡）。
- **24h 限流额度是真额度。** 每联系方式 3 次、每 IP 10 次，本地回环全程共用**同一个** `ip_hash`
  ⇒ 整轮验证共享一份「每 IP 10 次」预算。这是本手册把顺序排成 §2 那样的**唯一原因**。

### 0.3 两个会白白浪费你半小时的机制

**(a) SQL Editor 跑不了促销 RPC。**
促销侧四个关键函数都是 `SECURITY DEFINER`，第一行就是
`PERFORM public.guest_shop_require_service_role()`，判据是 `auth.role() <> 'service_role'` 即 RAISE。
而 `auth.role()` 读的是 PostgREST 从 JWT 注入的 GUC，**SQL Editor 里这些 GUC 全空 ⇒ 回退成 `anon`**，
于是哪怕 `current_user` 是表 owner，调函数也一定报：

```
ERROR:  guest shop RPC requires service_role
```

这**不是**迁移没落库，**不是**权限配错，是「执行身份」≠「函数要求的身份」。分工因此固定为：

| 工具 | 能做什么 | 不能做什么 |
|---|---|---|
| SQL Editor（probe / fixture / cleanup） | 读表、读 `pg_catalog`、改配置（owner 权限足够） | 段 4，以及任何直接调 `fn_guest_shop_*` / `guest_shop_promo_*` 的语句 |
| 工具箱（PostgREST + service_role JWT） | `status` / `gate` / `evaluate` / `breaker` / `record-event` / `sweep` / `simulate-zpay-underpay` | 不执行任何 SQL/DDL，不改券与预算配置，不提供 `reserve` 子命令 |

> 工具箱**故意不提供 `reserve`**：真实抵扣只能由真实下单产生，这样台账里每一行都对应一次真实请求，
> 证据才有分量。`evaluate` 是**只读**函数（不写台账、不占额度），可以随便调 ——
> 它是排查「为什么显示优惠码不可用」的主力，因为它会把 **13 个内部 reject code** 原样吐出来，
> 而公网 HTTP 按 C-E6 统一口径只回一个 `guest_discount_unavailable`。

**(b) 没有 quote 端点（§23.2）。** 折扣**只在 create-order 时计算**。所以「被拒」的可观测形态是：
`HTTP 400` + **不新增订单行** + UI 把优惠码撤回。想提前知道会不会被拒，用工具箱 `evaluate`（只读）。

---

## §1 前置准备（P0 → P6，严格按序）

### P0 · 确认代码状态（**不部署**）

```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
git rev-parse --abbrev-ref HEAD      # 期望：codex/guest-shop-promo-l1l2
git log --oneline -1                 # 期望：cb2f54d57（L1+L2 合并批，未推送/未部署）
git log --oneline -1 main            # 期望：0ac8cf17e
```

沙箱跑的是**工作区里的新代码**，生产上跑的还是 `main`。这正是「本地新代码 + 生产库」的含义。

> ⚠️ 工作区里有若干**未跟踪的诱饵文件**（`DEPLOYMENT_STEPS.md`、`deploy-guest-shop-worker.sh`、
> `kvm4-deployment-guide.md`、`kvm4-env-template.txt`、
> `supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql.keys`）。
> **不要提交它们。** `supabase/sandbox/` 同样是未跟踪目录，可自由编辑。

### P1 · 复核三份迁移**已落库**（用探针，**不要重跑迁移**）

在 SQL Editor 里只执行 `S154_probe_readonly.sql` 的 **段 0** 与 **段 16**：

- **段 0** 期望：`sql_editor_is_service_role = false`（**这是正常结果，不是故障**）、
  `promo_tables_present = true`、`role_guard_fn_present = true`、`verdict` 指向「必须改用工具箱」。
- **段 16** 期望：三份迁移的对象全部在位 ——
  `20260923_guest_shop_promo_l1l2.sql`、`20260923_verify_guest_shop_promo_l1l2.sql`（23 行）、
  `20260923_verify_guest_shop_promo_parity.sql`。

若段 16 有缺失 ⇒ **停**，先补迁移，不要往下走。

### P2 · 在 Admin Studio 建两张沙箱券

| 券码 | 类型 | 「结算比例」填 | 用途 |
|---|---|---|---|
| `SBXPROMO10` | percent | **90** | 主力券，第 1/2/3/5/7/8/9 项 |
| `SBXQUOTA2` | percent | **90** | 第 4 项专用（`guest_max_uses = 2`） |

> 📌 **最容易踩的坑**：`public.fn_resolve_shop_discount_amount` 对 percent 的算法是
> `折后 = ROUND(原价 × discount_value / 100, 2)`，即 `discount_value` 是**结算比例（付多少）**，
> 不是「减多少」。Admin Studio 的字段标签就是「结算比例」，提示文案「80 = 按原价 80% 结算，实际抵扣 20%」。
> ⇒ 想要「10% 券」必须填 **90**。填 10 会变成「抵扣 90%」，被游客通道 **50% 地板**拦成
> `guest_discount_below_floor`，对外只显示「优惠码不可用」，你会误判成功能坏了。

**只需在 Admin Studio 建这两张基础券。** 游客四列（`allow_guest` / `guest_max_uses` /
`guest_max_total_discount` 等）由 fixture SQL 写入 —— 因为 **L4 管理端 UI 本批未建**，
Admin Studio 里根本没有这几个字段可填。

### P3 · 选 SKU 并备足库存

跑 `S154_probe_readonly.sql` **段 1**（游客可购商品 / SKU 盘点），抄下 4 个 UUID：

| 用途 | 单价 | 最少可用卡密 | 建议 |
|---|---|---|---|
| 第 1 项（¥0.01） | `0.01` | **≥ 1** | 第 1 项根本不会建单，1 张够 |
| 第 2/3/4/5/7/8/9 项 | `10.00` | **≥ 10** | 付 1 + 少付 1 + 配额 3 + 反杀熟 2 + TTL 1 + 熔断/预算若干 |

两个 SKU 可以同属一个商品，也可以分属两个商品。**是否游客可购、单价、库存全部由你在 Admin Studio 掌握**，
fixture 只做**断言**（H-3）：单价不等于 `0.01` / `10.00`、或卡密不足，脚本直接 RAISE 并叫你去改，
**绝不偷偷改生产商品**。

### P4 · 备好邮箱 + 启动 preview

**24h 限流：每联系方式（邮箱）3 次、每 IP 10 次。** 本轮需要 **≥ 7 个互不相同的邮箱**：

| 代号 | 用于 | 说明 |
|---|---|---|
| A | 第 4 项（**正好 3 次**） | 打满该邮箱的 per-contact 额度；**不要打第 4 次**（会先撞限流而不是撞配额） |
| B | 第 5 项 | **本站已注册账号的邮箱**（反杀熟对照组） |
| C | 第 5 项 | **全新、从未注册的邮箱** |
| D | 第 2 项 | 真实支付 ¥9.09 |
| E | 第 3 项 | 少付（伪造回调） |
| F | 第 7 项 | 建单后**不付款**，等 TTL |
| H | 第 9 项 | 预算打满 |

启动本地 preview（游客折扣 + 游客凭证两个开关都要开）：

```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
GUEST_SHOP_DISCOUNT_ENABLED=true \
GUEST_SHOP_BUYER_CREDENTIAL_ENABLED=true \
npm run preview:local
```

- 商城页面：<http://127.0.0.1:8000/shop.html>（端口 8000，静态仓库根 + `/api/shop/*`）
- 环境变量走 **5 文件链**：`server/.env.staging` → `server/.env` → `.env` → `.env.local` →
  `.vercel/.env.production.local`（后者覆盖前者，`process.env` 覆盖全部）。
  **仓库里没有任何单一文件同时含 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`（在 `server/.env`）
  与 `GUEST_SHOP_WORKER_SECRET`（在 `.env.local`）**，所以工具箱默认也走同一条链，
  避免「工具箱看到的配置和本地服务看到的不是同一份」这种最难查的偏差。
- 相关开关：`GUEST_SHOP_DISCOUNT_ENABLED`（**依赖** `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED=true`）、
  `GUEST_SHOP_MAX_QUANTITY`（默认 1，**本轮禁止 ≥ 2**，见第 7 卡）、
  `GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED`、`GUEST_SHOP_ORDER_TTL_SECONDS`（默认 1800，min 300 / max 7200）。

### P5 · 执行夹具（`MAIN` 阶段）

打开 `S154_fixture_setup.sql`，**只改 `EDIT HERE` 区**，把 P3 抄到的 4 个 UUID 填进去，
`v_phase` 保持 `'MAIN'`（cn 日预算 20.00，够跑第 1–8 项），然后**整块选中执行**（`DO` 语句必须整体执行）。
执行后读 Messages / 通知面板里的 `RAISE NOTICE` 汇总（会打印按你填的单价算出的**期望抵扣额**）。

夹具只写 4 处，且全部可被 cleanup 还原：
`(1)` cn 预算行（enabled / daily / spent / date）、`(2)` **intl 预算行强制关闭**（防串站）、
`(3)` `discount_codes` 里 **`SBX` 前缀**券的 5 个游客列、`(4)` 不通过就 RAISE 的断言（整块回滚）。

三条硬护栏：**H-1** 只碰 `code LIKE 'SBX%'`；**H-2** 熔断器 open 时**拒绝执行**，不替你悄悄合闸；
**H-3** 不修改商品/SKU。

> 🔁 夹具**幂等**：每次执行都把 SBX 券的游客计数器归零、预算 `spent` 归零。
> ⇒ **重跑会清掉你之前记录的数字**。第 4 项的读数必须在切到 `BUDGET_TIGHT` **之前**抄进归档。

### P6 · 开跑前自检（3 条，全绿才继续）

```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
node supabase/sandbox/s154-guest-promo-toolbox.js status
node supabase/sandbox/s154-guest-promo-toolbox.js gate --site cn --amount 1.00
npm run readiness:guest-shop -- --env-file server/.env.production
```

- `status`：预算 enabled、breaker = `closed`、两张券在位。
- `gate`：`allowed = true`（只读，**不占额度**，可以随便调）。
- readiness：本轮只作**复核**。注意 `--fail-on-not-ready` 返回 `3` 是**预期的 fail-closed 结果**
  （§15.4 实机证据尚未归档），**不要用 `|| true` 绕过**。

SQL Editor 侧再看一眼 **段 5**（券的游客四列 + gate 四要素）、**段 6**（通道附加费，第 2 项算「应付」用）、
**段 9**（24h 限流余量，确认起点是干净的）。

---

## §2 九项操作卡

### 2.0 执行顺序与理由（**不要按 1→9 的顺序跑**）

**推荐顺序：`6 → 1 → 4 → 5 → 2 → 3 → 7 → 8 → 9`**

| 批次 | 项 | 为什么排这里 |
|---|---|---|
| 第一批（零成本） | **6**、**1** | 第 6 项纯读 `pg_catalog`；第 1 项只产生**拒绝**（不建单、不写台账、**不占额度**）。先把不花钱不花额度的做完。 |
| 第二批（吃 IP 额度） | **4 → 5 → 2 → 3** | 这四项都产生**真实抵扣单**，共享「每 IP 24h 10 次」预算。第 4 项的数字必须在第 9 项重跑夹具**之前**记录完。 |
| 第三批（要等时间） | **7** | 建单后**故意不付款**，等 TTL 到期再由 worker 归还。 |
| 第四批（改全局配置） | **8 → 9** | 熔断与预算是**全局**状态，一旦改动会影响前面所有项，必须放最后。第 9 项要把夹具切到 `BUDGET_TIGHT` 重跑（会归零计数器）。 |

**额度账（务必先算清）**：本轮真实抵扣单成功数 ≈ 第4项(2) + 第5项(2) + 第2项(1) + 第3项(1) + 第7项(1) + 第9项(1) = **8 次**，
上限 10 次 ⇒ **只剩 2 次余量**。省额度三招：

1. **所有「拒绝半边」一律用只读 `gate` / `evaluate` 验**（0 写入、0 额度），不要靠真实下单去撞拒绝。
2. 真实抵扣单**控制在 10 单以内**；第 8 项的「恢复后再买一单」是**可选**的，额度紧张就跳过，
   改用 `gate` 证明促销已恢复。
3. 真撞上限了：**换出口 IP**（例如切手机热点重启 preview）或**分两天跑**。撞上限的表现是内部码
   `guest_discount_rate_limited`，对外仍是 `guest_discount_unavailable` —— 归档时必须写清命中的是哪一条。

### 2.1 通用 UI 路径（每一项都走这条）

```
浏览器（登出状态）打开 http://127.0.0.1:8000/shop.html
  → 点商品卡片 → 商品详情弹窗
  → 主按钮：登出 + 游客可购 ⇒ 文案「立即购买」（已登录 ⇒ 「兑换」）
  → 游客结账弹窗：
       优惠码      guestCashDiscountCode      （仅 GUEST_SHOP_DISCOUNT_ENABLED=true 时出现）
       邮箱        guestCashContact           （credential_required 时必填）
       查询密码    guestCashOrderPassword     （旁边有「帮我生成」）
       支付方式    ZPay / USDT
  → 「创建支付订单」guestCashCreateOrderBtn
  → ZPay 二维码 → 自动核销 → 卡密交付
```

> **查询密码策略（K26）**：最短 **8** 位、最长 64；必须同时含**大写 + 小写 + 数字 + 标点**；
> 同一字符连续重复 ≤ 3；不同字符 ≥ 5 种；不得与邮箱 local part 碰撞；不在 denylist 内。
> 不满足 ⇒ `HTTP 400 guest_password_weak`。**懒人做法：直接点「帮我生成」。**
> 长度下限可用 `GUEST_SHOP_BUYER_PASSWORD_MIN_LENGTH` 调（默认 8）。

> **每一张卡跑完，立刻把「记录字段」抄进归档草稿**（§4）。第 4/9 项的数字一旦被夹具重跑就会归零。

---

### 卡 6 · H2 入参白名单（定价 resolver 不得看见身份字段）

| | |
|---|---|
| **目的** | 断言定价 resolver 的入参对象**不含** `registered_user_match`、`merged_into_user_id`、`buyer_id`、`credential_group_no`、`failed_login_count`、`last_login_at`、`email_verified_at` 任一字段（清单与 `docs/guest-shop-order-access-2.0.md` §16.1 一致；`guest_shop_buyers` 已无 `order_count` 列，见该文档 §5.1） |
| **入口** | SQL Editor · `S154_probe_readonly.sql` **段 2**（逐字段明细）+ **段 3**（单行判定） |
| **成本** | 纯读 `pg_catalog`。**0 写入、0 额度、0 花钱** |
| **步骤** | ① 执行段 2，逐行看 `pg_get_function_arguments` 拆出的入参字段；② 执行段 3，抄那一行 `verdict` |
| **期望** | 段 2：2 个函数 × 7 个身份字段 = 14 行，**全部为「未出现」**；段 3：`h2_violation_count = 0` ⇒ `verdict = PASS` |
| **判据** | `h2_violation_count = 0` |
| **记录字段** | 段 3 的**整行原样**贴进归档（段 3 的 verdict 就是第 6 项的结论，可直接归档） |
| **偏差** | 无。此项是 §22.5 反杀熟的守门员，**不可删除** |

> 为什么排第一：它是**唯一一项与运行时状态完全无关**的验证，先拿到一个确定的 PASS，
> 后面出错时能排除「函数签名被改过」这一类干扰。

---

### 卡 1 · ¥0.01 SKU + 10% 券 → 必须被拒，**不得产生 0 元单**　⚠️ **部分通过（PARTIAL）**

| | |
|---|---|
| **目的** | 极小金额下折扣 round 成 0.00 时，系统必须**拒绝**而不是建一张 ¥0.00 的单（零元购红线） |
| **入口** | 浏览器 UI（真实下单）+ 工具箱 `evaluate`（只读，看内部码）+ probe **段 7**（订单数） |
| **成本** | **0 额度**（被拒不写台账）、0 花钱 |
| **步骤** | ① 先只读预演：`node supabase/sandbox/s154-guest-promo-toolbox.js evaluate --site cn --product <¥0.01 product uuid> --sku <¥0.01 sku uuid> --unit 0.01 --code SBXPROMO10`；② 记下 probe **段 7** 的当前订单行数；③ 登出 → `shop.html` → ¥0.01 商品 → **立即购买** → 优惠码填 `SBXPROMO10` → 填邮箱（可用 A/B/C 之外任一，被拒不占额度）+ 查询密码（点「帮我生成」）→ **创建支付订单**；④ 再跑一次 probe **段 7** |
| **期望** | ③ 返回 **HTTP 400**，UI 显示「优惠码不可用」并把优惠码撤回；④ **订单行数不变**（**没有新增订单行**） |
| **判据** | `段7 订单数（后）== 段7 订单数（前）` **且** ① 的内部 reject code = **`guest_discount_no_effect`** |
| **记录字段** | ① 的完整 `evaluate` 输出（内部码）、③ 的 HTTP 状态与 UI 文案、④ 的前后订单行数、probe **段 17** 的 CHECK 约束在位证据 |
| **偏差（必须如实登记）** | 计划书原文写「必须被 **`min_payable`** 拒绝（验证 **C-B9** 生效）」，但代码里**不存在 `min_payable` / K5**（全仓 grep 为空）——**计划文本已过期**。实际拒绝码是 `guest_discount_no_effect`（`0.01 × 90% → 抵扣 round 后 = 0.00`）。零元购的**实际纵深防御**是两道：`guest_discount_below_floor`（游客通道 **50% 地板**，结算比例 < 50 即拒）+ `guest_shop_orders_amount_check`（表级金额 CHECK，见 probe 段 17）。**归档时写「PASS（判据等价，机制名称与计划书不符）」，不要改写成原样通过** |

> 内部码与对外码的关系：`guest_discount_no_effect` 与 `guest_discount_below_floor` 按 **C-E6** 统一口径
> **都塌缩成公网 400 `guest_discount_unavailable`**。所以想知道到底命中哪一条，**只能靠 `evaluate`**，
> 浏览器里看不出来。归档必须写内部码。

---

### 卡 4 · `guest_max_uses = 2` 的券，第 3 次使用 → 拒绝且计数停在 2

| | |
|---|---|
| **目的** | 验证 §9.3 的**原子性**：券级游客配额打满后必须拒绝，且 `guest_used_count` **不会**被并发/失败请求推过上限 |
| **入口** | 浏览器 UI ×3（邮箱 **A**）+ probe **段 8**（台账）、**段 5**（券计数）、**段 9**（限流余量） |
| **成本** | **2 次 IP 额度**（前两次成功）+ 邮箱 A 的 **3 次** per-contact 额度（正好打满） |
| **步骤** | ① probe 段 5 / 段 8 记起点：`SBXQUOTA2` 的 `guest_max_uses = 2`、`guest_used_count = 0`、台账 0 行；② 用邮箱 **A** 在 ¥10 SKU 上填 `SBXQUOTA2` 成功下单并支付 → 第 1 次；③ 同邮箱同券再来一次 → 第 2 次；④ **同邮箱同券第 3 次**（**只到第 3 次，不要第 4 次**）；⑤ probe 段 5 + 段 8 + 段 9 |
| **期望** | ②③ 各成功一次；④ **HTTP 400**「优惠码不可用」；⑤ `guest_used_count` **停在 2**（不是 3），台账 **正好 2 行**，邮箱 A 的 `contact_remaining = 0` |
| **判据** | `guest_used_count == 2` **且** 台账行数 `== 2` **且** ④ 的内部码 = **`guest_discount_code_exhausted`** |
| **记录字段** | ①⑤ 的段 5 / 段 8 / 段 9 三张表原样、②③ 的订单号与金额、④ 的内部码（用 `evaluate` 复现，只读不占额度） |
| **偏差** | 无 |

> ⚠️ **两个致命手滑点**
> 1. **不要打第 4 次。** per-contact 限流检查排在券配额检查**前面**：第 3 次时 `contact_uses = 2 < 3` ⇒ 通过限流 ⇒ 命中配额 ⇒ `guest_discount_code_exhausted`（**这才是第 4 项要的观测**）。打到第 4 次 ⇒ 先撞限流 ⇒ `guest_discount_rate_limited`。两者对外都是 400 `guest_discount_unavailable`，但**证据里必须写清命中的是哪一条**，写错等于没验。
> 2. **本项数字必须在切到 `BUDGET_TIGHT`（卡 9）之前抄进归档** —— 重跑夹具会把 SBX 券计数器与预算 `spent` 归零。
>
> 💡 想省额度：②③ 中只需**一次**真实支付即可完成配额占用验证；但为了让「2 次成功 = 2 行台账」这条判据成立，**建议老老实实付两次**（每次 ¥9.09）。若预算吃紧，可只做 1 次真实单 + 用 `evaluate` 展示配额逻辑，但**必须在归档里标注为「降级执行」**。

---

### 卡 5 · 反杀熟 H1：注册邮箱 vs 全新邮箱，折后金额**逐分相等**　⚠️ 含一处偏差

| | |
|---|---|
| **目的** | §22.5 守门员。同一张券、同一个 SKU，「已注册邮箱的游客会话」与「全新邮箱的游客会话」的折后金额必须**逐分相等**；两边都必须能用券，都不得返回 `guest_discount_unavailable`。**这条测试不可删除** |
| **入口** | 浏览器 UI ×2（邮箱 **B** = 本站已注册账号邮箱、邮箱 **C** = 全新邮箱）+ probe **段 7**（订单金额）、**段 8**（台账）、**段 10**（买家身份行） |
| **成本** | **2 次 IP 额度**（两次都成功） |
| **步骤** | ① 用邮箱 **B**（**必须是你本站真实注册过的账号邮箱**）在 ¥10 SKU 上填 `SBXPROMO10` 下单并支付，记折后金额与应付；② 用邮箱 **C**（全新）在**同一 SKU、同一张券**上重复，记同样两个数；③ probe 段 7 对比两单、段 8 对比两行台账、段 10 看两条买家身份行 |
| **期望** | 两单**折后金额逐分相等**（¥10.00 → 折后 9.00 → 应付 9.09，按段 6 现场算的费率为准）；**两边都成功用券**；**都没有** `guest_discount_unavailable` |
| **判据** | `amount(B) == amount(C)`（**精确到分**）**且** 两单都 `paid` **且** 台账 2 行抵扣额相同 |
| **记录字段** | 段 7 两单原样对照、段 8 两行台账原样、段 10 两条买家行、两单的下单时间 |
| **偏差（必须如实登记）** | 计划书还要求「断言 `registered_user_match` 在两边**取值不同**（证明判定确实跑了），但金额相同（证明判定没有进入定价）」。**公开下单路径把 `registered_user_match` 传 `null` ⇒ 两边都落 `false` ⇒ 取值相同**，因此「取值不同」这半条**在真实下单里无法产生**。这是**设计上的更强保证**（身份判定根本不影响公开定价路径），不是缺陷，但**与计划书字面不符**，必须登记。若你想把 (c) 演示也做出来：**段 10** 给了可选做法 —— 手工把某个 buyer 的 `registered_user_match` 设为 `true`，用**新的 idempotency key** 再下一单，breakdown 应与原来**完全一致**（证明该字段确实没进定价）。**做完必须用 cleanup 的 `v_reset_buyer_ids` 还原**（见 §3 / 段 R6） |

> 🔒 这一项是你之前明确担心的「**杀熟 / 背刺老用户**」的守门员。归档时请把两单金额**并排贴出**，
> 这是唯一能证明「老客户登出来下单不会被多收一分」的实机证据。

---

### 卡 2 · ¥10 SKU + 10% 券 → 应付 = 折后 + 通道费(ceil) → 正常发货

| | |
|---|---|
| **目的** | 打通完整正向链路：服务端定价 → 通道附加费 → 真实支付 → 自动核销 → 卡密交付 |
| **入口** | probe **段 6**（**先算费率**）→ 浏览器 UI（邮箱 **D**）→ probe **段 7** / **段 8** / **段 15** |
| **成本** | **1 次 IP 额度** + **真实支付** |
| **步骤** | ① **先跑 probe 段 6 现场算出本次的应付金额**（`net = 10.00 × 90% = 9.00`，`fee = CEIL(net × rate, 2)`）；② 用邮箱 **D** + `SBXPROMO10` 在 ¥10 SKU 上下单；③ 核对 UI 显示的应付与 ① **一致**；④ **真实扫码支付该金额**；⑤ 等自动核销与卡密交付；⑥ probe 段 7（订单 `paid` + 卡密已发）、段 8（台账 +1）、段 15（预算 `spent_cny` +1.00） |
| **期望** | 订单状态推进到 `paid` 并**正常发货**；台账 +1 行；预算 `spent_cny` 增加**抵扣额**（¥1.00） |
| **判据** | `实付金额 == 段6 算出的应付` **且** 订单 `paid` **且** 卡密交付成功 **且** 段 8 / 段 15 各 +1 |
| **记录字段** | 段 6 输出原样（含 `rate` 与 `fee`）、订单号、实付金额、支付时间、核销时间、段 7/8/15 三张表 |
| **偏差** | 无 |

> ⚠️ **绝对不要硬记「9.09」。** `9.09` 只在 zpay / nowpayments 的 `rate = 0.01` 时成立；
> 若你的通道 `rate = 0`，应付就是 **9.00**。**每次都以 probe 段 6 现场算出的数为准**，
> 并把段 6 的输出一起归档 —— 否则一旦你换通道，这条证据就会变成错的。

---

### 卡 3 · 少付手续费 → `amount_mismatch`、**不发货**、熔断计数 +1　⚠️ **部分通过（PARTIAL）**

| | |
|---|---|
| **目的** | 金额不一致必须被 webhook 拒绝，**绝不发货**，并计入熔断 |
| **入口** | 工具箱 `simulate-zpay-underpay`（**伪造回调，不要真金少付**）+ probe **段 12**（支付事件）、**段 11**（库存预占）、**段 13/14**（熔断） |
| **成本** | **1 次 IP 额度**（建单时用了券）+ **0 元真实支付** |
| **步骤** | ① 用邮箱 **E** + `SBXPROMO10` 在 ¥10 SKU 上建单，**记下 `merchant_order_no` 与应付金额**（**订单号必须含 `SBX`**，工具箱只接受 SBX 订单）；② **不要付款**；③ 伪造少付回调：`node supabase/sandbox/s154-guest-promo-toolbox.js simulate-zpay-underpay --merchant-order-no <上一步的单号> --money 9.00 --yes`（`--money` 必须**小于**应付；工具会拒绝 `money >= expected`）；④ probe 段 12（支付事件）、段 11（库存预占是否释放）、段 7（**卡密未发出**） |
| **期望** | ③ 写入一条 **`rejected`** 支付事件且 `amount_verified = false`；**不发货**；预占库存回到 `available` |
| **判据** | `段12 出现 rejected + amount_verified=false` **且** `卡密未交付` **且** `库存已释放` |
| **记录字段** | 订单号、应付、伪造的 `--money`、段 12 原样、段 11 前后对照、工具箱退出码 |
| **偏差（必须如实登记）** | 计划书要求「**熔断计数 +1**」，但**自动跳闸链路在 Node 侧未接线**：`api/` 与 `scripts/` 里 `record_event` 的**调用点为 0**（只有 readiness 的正则在扫它）。因此「少付自动使熔断计数 +1」**本轮无法观测**。可验证的是 **DB 侧自动跳闸机制本身**：用 `record-event --kind amount_mismatch --yes` 手工写事件，观察阈值（**mismatch 3 / identity 20 / 窗口 900s**）达到后 breaker 是否自动 open。**归档写「PARTIAL：金额拒绝与不发货 PASS；自动熔断接线缺失，DB 侧机制已单独验证」** |

> 🔒 工具箱的三重护栏：`--money >= expected` **直接拒绝**（防止你把「少付」做成「多付」）、
> **只接受 `SBX` 前缀订单**（防止误伤真实订单）、**只支持 zpay**、且**只允许打本机回环地址**
> （非回环需额外 `--allow-remote-host`）。写动作一律需要显式 `--yes`。
> `record-event` 禁止 `manual_open` / `manual_close` / `auto_open`（那是 `breaker` 子命令与 DB 自动逻辑的专属种类）。

---

### 卡 7 · TTL 到期后库存与预算**同时**归还　⚠️ **部分通过（PARTIAL）**

| | |
|---|---|
| **目的** | 计划书原文：「批量创建不付款单 → 触达 **C-D3 / C-D4** 后拒绝；TTL 到期后库存与预算同时归还（验证 C-D6 / C-C5）」 |
| **入口** | 浏览器 UI（邮箱 **F**，建单后**不付款**）→ 工具箱 `sweep` → probe **段 11**（库存预占）、**段 8**（台账 `returned_at`）、**段 15**（预算 `spent_cny`） |
| **成本** | **1 次 IP 额度** + **等待 TTL** |
| **省时技巧** | **跑本项前用 `GUEST_SHOP_ORDER_TTL_SECONDS=300` 重启 preview**（默认 1800s = 30 分钟；下限 300 / 上限 7200）。5 分钟就能验完，不用干等半小时 |
| **步骤** | ① 用邮箱 **F** + `SBXPROMO10` 在 ¥10 SKU 上建单，**故意不付款**；② probe 段 11 / 段 8 / 段 15 记「归还前」：库存被预占、台账 `returned_at` 为空、预算 `spent_cny` 含这 ¥1.00；③ 等 TTL 到期；④ `node supabase/sandbox/s154-guest-promo-toolbox.js sweep --yes`（`POST /api/shop/guest/worker`）；⑤ 再跑 probe 段 11 / 段 8 / 段 15 |
| **期望（TTL 归还半项）** | ④ 触发 `fn_guest_shop_release_expired_reservations` → `fn_guest_shop_return_discount_reservation`：券的 `used_count` / `guest_used_count` / `guest_discount_total` **递减**、预算 `spent_cny` **归还**、台账行 `returned_at` **落时间**、预占库存回到 `available`。**三者必须同时发生** |
| **判据** | `段8 returned_at 非空` **且** `段11 预占释放` **且** `段15 spent_cny 回落` **且** `券计数 -1` |
| **记录字段** | 订单号、TTL 设置值、建单时间、sweep 时间、段 11/8/15 的**归还前后对照** |
| **偏差（必须如实登记）** | **「批量创建不付款单 → 触达 C-D3 / C-D4 后拒绝」这半项不可能通过：C-D3 / C-D4 本批未实现（§23.5）。** 这正是 `GUEST_SHOP_MAX_QUANTITY ≥ 2` **本轮禁止开启**的原因 —— 没有「批量不付款单」的上限，多件模式会被拿来免费锁库存。**归档写「PARTIAL：TTL 归还 PASS；C-D3/C-D4 未实现，拒绝半项 N/A」，并重申 `GUEST_SHOP_MAX_QUANTITY` 保持 1** |

> 注意与卡 3 的区别：卡 3 是**付了但金额不对** → `rejected`；卡 7 是**根本不付** → TTL 过期归还。
> 两条路径都必须把**库存与预算一起还回去**，少还任何一个都是泄漏。

---

### 卡 8 · 手动置熔断 open → 促销全停、**原价仍可买** → 恢复

| | |
|---|---|
| **目的** | 验证熔断是「**只停促销、不停营业**」：breaker open 时优惠全拒，但原价购买链路完好；后台合闸后促销恢复 |
| **入口** | 工具箱 `breaker` + `gate` + probe **段 4**（促销全局状态）、**段 13**（熔断事件审计链）、**段 14**（breaker 单行原始状态） |
| **成本** | **0 额度**（用只读 `gate` 验拒绝半边）；「恢复后原价/促销各买一单」是**可选**的，额度紧张就跳过 |
| **步骤** | ① probe 段 4 / 段 14 记起点（`state = closed`）；② `node supabase/sandbox/s154-guest-promo-toolbox.js breaker open --actor <你的名字> --reason "S154 第8项" --yes`；③ `... gate --site cn --amount 1.00`（只读）→ 期望 `allowed = false`、code = **`guest_promo_halted`**；④ 浏览器：**不填优惠码**原价下单 ¥10 SKU → **必须成功**（证明只是促销停了，营业没停）；⑤ `... breaker closed --actor <你的名字> --reason "S154 第8项恢复" --yes`；⑥ 再跑 `gate` → `allowed = true`；⑦ probe 段 13（`manual_open` / `manual_close` **各 +1**）、段 14（单行 state 与 CHECK 约束逐字段核对） |
| **期望** | open 期间：促销全停（`guest_promo_halted`）+ **原价可买**；closed 后：促销恢复 |
| **判据** | `③ allowed=false & code=guest_promo_halted` **且** `④ 原价单成功` **且** `⑥ allowed=true` **且** `段13 manual_open/manual_close 各 +1` |
| **记录字段** | ②⑤ 的 `--actor` / `--reason` / 时间戳、③⑥ 的 `gate` 输出、④ 的订单号、段 13 / 段 14 原样 |
| **偏差** | 无 |

> ⚠️ **别忘了合闸。** ⑤ 必须执行，否则后续所有项都会被 `guest_promo_halted` 拦住。
> 而且夹具的 **H-2** 护栏在 breaker open 时**拒绝执行**，**不会替你悄悄合闸** ——
> 合闸只能走 `fn_guest_shop_promo_set_breaker('closed', ...)`，这样 `guest_shop_promo_breaker_events`
> 里才留有 `manual_close` 审计行（**审计链本身就是证据的一部分**）。
> ④ 的原价单会吃 1 次 IP 额度且**不用券**（不占折扣额度）；若余量不足，可用 `evaluate` 代替并标注「降级执行」。

---

### 卡 9 · 日预算打满 → 促销停止、原价可买、告警发出　⚠️ **部分通过（PARTIAL）**

| | |
|---|---|
| **目的** | 券级/站点级硬预算打满后必须**立即停止让利**，但原价营业不受影响 |
| **入口** | 夹具切 `BUDGET_TIGHT` 重跑 → 浏览器 UI（邮箱 **H**）→ 工具箱 `gate`（只读验拒绝）→ probe **段 15**（预算行）、**段 4** |
| **成本** | **1 次 IP 额度**（只有第 1 次真实成功）；**第 2 次用只读 `gate` 验，不要真下单** |
| **步骤** | ① **先确认卡 4 的数字已抄进归档**（下一步会归零）；② 把 `S154_fixture_setup.sql` 的 `v_phase` 改成 `'BUDGET_TIGHT'`（cn 日预算 **1.00**），整块重跑；③ probe 段 15 记起点（`daily = 1.00`、`spent_cny = 0`）；④ 用邮箱 **H** + `SBXPROMO10` 在 ¥10 SKU 上下单并支付 —— 抵扣额正好 **¥1.00** ⇒ `spent` 0 → 1.00，**预算打满**；⑤ probe 段 15 确认 `spent_cny = 1.00`；⑥ **只读**验拒绝：`node supabase/sandbox/s154-guest-promo-toolbox.js gate --site cn --amount 1.00` → 期望 `allowed = false`、code = **`guest_promo_budget_exhausted`**；⑦ 浏览器：**不填优惠码**原价下单 → **必须成功** |
| **期望** | 第 1 次 ¥1.00 抵扣成功；之后 gate 判 `spent + 1.00 > 1.00` ⇒ **`guest_promo_budget_exhausted`**；**原价仍可买** |
| **判据** | `段15 spent_cny == daily == 1.00` **且** `⑥ code = guest_promo_budget_exhausted` **且** `⑦ 原价单成功` |
| **记录字段** | ② 的夹具 NOTICE、④ 的订单号与抵扣额、段 15 前后对照、⑥ 的 `gate` 输出、⑦ 的订单号 |
| **偏差（必须如实登记）** | 计划书要求「**告警发出**」，但**本批没有任何告警接线**（无 webhook / 无邮件 / 无 IM 通知），因此「告警发出」**不可验证**，只能登记为 **N/A**。预算打满的**可观测形态**是 gate 拒绝 + `guest_promo_budget_exhausted`，**不是**一条告警消息。**归档写「PARTIAL：预算硬停与原价可买 PASS；告警链路未接线，N/A」** |

> 相关 gate 码全集（排查用）：`guest_invalid_site`、`guest_discount_amount_invalid`、`guest_promo_halted`（卡 8）、
> `guest_promo_budget_closed`（预算被关闭，例如夹具 `CLOSED` 阶段或 intl 行被强制关闭）、
> `guest_promo_budget_exhausted`（本卡）。
> 夹具会**强制关闭 intl 预算行**以防串站 —— 若你误在 intl 站点测试，会看到 `guest_promo_budget_closed`，那不是故障。

---

### 2.2 九项预期结论一览（**归档时按这张表填**）

| # | 项 | 预期结论 | 说明 |
|---|---|---|---|
| 6 | H2 入参白名单 | ✅ **PASS** | `h2_violation_count = 0` |
| 1 | ¥0.01 零元购 | ⚠️ **PASS（机制名称与计划书不符）** | 实际码 `guest_discount_no_effect`；无 `min_payable`/C-B9 |
| 4 | 券配额原子性 | ✅ **PASS** | `guest_used_count` 停在 2、台账 2 行 |
| 5 | 反杀熟 H1 | ⚠️ **PASS（一处偏差）** | 金额逐分相等 ✅；`registered_user_match` 两边同为 `false`（公开路径传 `null`），「取值不同」无法产生 |
| 2 | ¥10 正向链路 | ✅ **PASS** | 应付以 **probe 段 6 现场算的**为准，勿硬记 9.09 |
| 3 | 少付拒绝 | ⚠️ **PARTIAL** | 金额拒绝 + 不发货 PASS；**自动熔断未接线**，DB 侧机制另验 |
| 7 | TTL 归还 | ⚠️ **PARTIAL** | 归还半项 PASS；**C-D3/C-D4 未实现**，拒绝半项 N/A；`GUEST_SHOP_MAX_QUANTITY` 保持 1 |
| 8 | 熔断 | ✅ **PASS** | 促销全停 + 原价可买 + `manual_open`/`manual_close` 各 +1 |
| 9 | 日预算 | ⚠️ **PARTIAL** | 硬停 + 原价可买 PASS；**告警未接线**，N/A |

> **4 项 PARTIAL（1 / 3 / 7 / 9）不许改写成「通过」。** 按 §17 第 12 条：
> **没有 §15.4 实机证据不得宣称游客促销「完成」或「可启用」**；
> 有证据但含偏差时，必须**连偏差一起归档** —— 偏差本身就是下一批的工作项（C-D3/C-D4、熔断接线、告警接线、`min_payable` 文本勘误）。

---

## §3 收尾：还原与复核

### 3.1 执行 cleanup

打开 `S154_cleanup.sql`，**只改 `EDIT HERE` 区**，然后**整块选中执行**：

- `v_reset_buyer_ids`：**默认空数组 = 不碰 `guest_shop_buyers`**。
  **仅当**你在卡 5 做了可选的 (c) 演示（手工把某个 buyer 的 `registered_user_match` 设成 `true`），
  才把那个 buyer id 显式列进去，例如：
  `v_reset_buyer_ids UUID[] := ARRAY['11111111-1111-1111-1111-111111111111']::UUID[];`
- 脚本**幂等**，执行 N 次结果相同；中途叫停也可以直接跑它收尾。

它**只写 4 处**（与夹具的写入面严格对齐）：
`(1)` `SBX` 前缀两张券的 5 个游客列 + `used_count`、
`(2)` `guest_shop_promo_budget` 的 **cn 行与 intl 行都关**（`enabled=false, daily=0, spent=0`）、
`(3)` `guest_shop_promo_breaker id=1`（**仅当它还是 open 时**合闸，并补一条审计行）、
`(4)` `guest_shop_buyers.registered_user_match → false`（仅当你填了 `v_reset_buyer_ids`）。

它**绝不写 / 绝不删**：`shop_products`、`shop_product_skus`、`shop_inventory`、`guest_shop_orders`、
`guest_shop_discount_redemptions`、`guest_shop_payment_events`、任何密钥 / pepper / claim secret / 卡密内容。

### 3.2 三条必须知道的「不还原」

| # | 不还原什么 | 为什么 | 你要做什么 |
|---|---|---|---|
| **N-1** | **台账与订单默认保留** | `guest_shop_discount_redemptions` 与 `guest_shop_orders` 是**财务审计证据**；§15.5 的归档要求恰恰是「把它们留在库里、把数字抄进 evidence 文档」。删掉它们等于删掉你自己的实机证据 | 什么都不做。脚本只在 **R4 / R5** 里**汇总**它们，不做任何 `DELETE` |
| **N-2** | **卡密不会被归还** | 卡 2 真实付款后那张卡密**已发货、已属于买家，是真销售**。卡 7 的 TTL 归还走的是 **worker**（`fn_guest_shop_release_expired_reservations`），不是 cleanup | 需要人工退款/补发/解锁，走 `docs/guest-shop-payment-fulfillment-runbook.md` 的后台流程。**不要用 SQL 直接改 `shop_inventory.status`** —— 那会绕过归还函数的幂等 claim，造成重复发货 |
| **N-3** | **24h 限流额度不清零** | per-contact 3 次 / per-IP 10 次是**按 `created_at >= now() - 24h` 从台账实时统计**的，且**不过滤 `returned_at`** ⇒ **已被 TTL 归还的行仍然计数** | 想立刻重跑：等 24h、或**换出口 IP**、或用**新邮箱**。这是设计如此，不是 bug |

### 3.3 读 R1–R6 报告并复核

cleanup 执行完会输出 6 段报告，**逐段确认**：

| 段 | 内容 | 期望 |
|---|---|---|
| **R1** | 两张 SBX 券 | 还原后必须是「**游客通道彻底关闭**」（`allow_guest = false`，游客计数归零） |
| **R2** | 预算 + 熔断器单行 | cn / intl 预算都 `enabled=false, daily=0, spent=0`；breaker = `closed` |
| **R3** | 熔断事件审计链 | 卡 8 的 `manual_open` / `manual_close` **以及 cleanup 的合闸**都应留痕 |
| **R4** | 本轮沙箱**台账**汇总 | **归档用数字**（这些行保留在库里，不删） |
| **R5** | 本轮沙箱**订单**汇总 | **归档用数字**；卡 1 断言「¥0.01 不新增订单行」、卡 3 断言「不发货」都靠它 |
| **R6** | 卡 5 (c) 演示是否已还原 | **只有你填过 `v_reset_buyer_ids` 才需要看** |

再跑一次复核（**全绿才算收尾完成**）：

```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
node supabase/sandbox/s154-guest-promo-toolbox.js status          # 预算关闭、breaker closed
node supabase/sandbox/s154-guest-promo-toolbox.js gate --site cn --amount 1.00   # allowed=false
npm run readiness:guest-shop -- --env-file server/.env.production --json
```

SQL Editor 侧：**段 4**（促销全局状态，注意这段在 SQL Editor 里跑不了，用工具箱 `status` 代替）、
**段 16**（迁移仍在位、cleanup 没有误删 schema）、**段 5**（两张券游客通道已关）。

> readiness 的**脏券扫描**把 `allow_guest=true AND guest_max_total_discount<=0` 判为 `INVALID`（exit 2）。
> 夹具给两张券的都是**显式正数**上限（`SBXPROMO10` 50.00 / `SBXQUOTA2` 2.00 = 正好 2 次 × ¥1.00），
> cleanup 又把 `allow_guest` 关掉，所以收尾后脏券数应为 **0**。
> `--fail-on-not-ready` 返回 **3** 仍是**预期的 fail-closed**（§15.4 证据归档前的正常状态），**不要用 `|| true` 绕过**。

---

## §4 归档（§15.5 的硬要求）

### 4.1 写到哪

**`/Volumes/chao/AI/xianyu_profit_calculator/docs/guest-shop-promo-evidence.md`**，新增 **§2.12**
（当前最后一个子节是 **§2.11**，所以下一个空号就是 §2.12）。

同时**更新 §2.6 的九项登记表**：把对应行的「⬜ 未执行」改成实际结论
（`✅ PASS` / `⚠️ PASS（含偏差）` / `⚠️ PARTIAL` / `❌ FAIL`），并把标题
「**全部未执行（0 / 9）**」改成实际完成度（例如「**9 / 9 已执行：5 PASS + 4 PARTIAL/偏差**」）。

### 4.2 每一项必须归档的字段

| 字段 | 说明 |
|---|---|
| 执行时间 | 精确到分钟（限流按 24h 滚动窗口统计，时间戳是复算额度的依据） |
| 入口 | UI 路径 / 工具箱命令行（**命令行原样贴**，但把邮箱换成代号 A–H） |
| 观测值 | 对应 probe 段落的**输出原样**（段 2/3/5/6/7/8/9/11/12/13/14/15/16/17） |
| 期望值 | 本手册 §2 各卡「期望」栏 |
| 判据结果 | 本手册 §2 各卡「判据」栏，逐条 TRUE/FALSE |
| **偏差** | 4 项 PARTIAL（1/3/7/9）+ 卡 5 的 `registered_user_match` 偏差，**必须写明原因与替代证据** |
| 内部 reject code | 凡是被拒的项，写 `evaluate` 吐出的**内部码**，不能只写对外的 `guest_discount_unavailable` |

### 4.3 归档纪律

1. **不许把 PARTIAL 改写成 PASS。** 按 `docs/guest-shop-promo-hardening-plan.md` **§17 第 12 条**：
   没有 §15.4 实机证据不得宣称游客促销「完成」或「可启用」；有证据但含偏差，必须**连偏差一起归档**。
2. **偏差要转成下一批工作项**，至少四条：C-D3 / C-D4 落地（解卡 7 的拒绝半项）、
   熔断自动接线（解卡 3 的「计数 +1」）、预算告警接线（解卡 9 的「告警发出」）、
   计划书 `min_payable` / C-B9 文本勘误（解卡 1 的名称不符）。
3. **登记而不追猎**（沿用 §2.7 的纪律）：若某项出现与预期不符的读数，
   先单独复跑该项确认，**不要用「重跑到出现想要的数字」来掩盖真实失败**。
4. **发布 ≠ 启用**：归档完成**只**满足 readiness `promo-parity-evidence` 的另一半
   （前一半「≥40 条黄金向量」已由 §2.11 的 74 条满足）。**启用**另需 §14 的灰度许可签署。
   在你下达明确部署指令前，**不部署**。

---

## §5 坑位速查表（**出错时先查这张表**）

| # | 坑 | 现象 | 处置 |
|---|---|---|---|
| 1 | **percent 语义反了** | 填 10 想打 9 折，结果「优惠码不可用」 | `discount_value` 是**结算比例（付多少）**。10% 券填 **90**。填 < 50 会撞游客 **50% 地板** → `guest_discount_below_floor` |
| 2 | **对外码统一塌缩** | 浏览器只说「优惠码不可用」，看不出原因 | 用工具箱 `evaluate`（只读、0 额度）看 **13 个内部 reject code** |
| 3 | **每 IP 24h 上限 10** | 后半程所有带券下单全被拒，内部码 `guest_discount_rate_limited` | 本地回环全程共用**一个** `ip_hash`。拒绝半边一律改用只读 `gate`/`evaluate`；真撞了就换出口 IP 或分两天 |
| 4 | **每联系方式 24h 上限 3** | 卡 4 打第 4 次时命中 `rate_limited` 而不是 `code_exhausted` | 邮箱 A **正好用 3 次**。限流检查排在券配额检查**前面**，两者对外都是 `guest_discount_unavailable`，归档必须写清命中哪条 |
| 5 | **`returned_at` 不豁免限流** | TTL 已归还，额度却没回来 | 24h 统计**不过滤 `returned_at`** ⇒ 归还的行仍计数（N-3）。设计如此 |
| 6 | **SQL Editor 报 `requires service_role`** | 段 4 或任何 `fn_guest_shop_*` 直接报错 | `auth.role()` 在 SQL Editor 里是 `anon`（GUC 全空）。**不是**迁移没落库、**不是**权限错。改用工具箱 |
| 7 | **查询密码被拒 `guest_password_weak`** | 建单直接 400 | K26：min 8 / max 64、大写+小写+数字+标点齐全、同字符连续 ≤3、不同字符 ≥5 种、不与邮箱 local part 碰撞、不在 denylist。**直接点「帮我生成」** |
| 8 | **TTL 默认 30 分钟** | 卡 7 干等 | 重启 preview 时加 `GUEST_SHOP_ORDER_TTL_SECONDS=300`（下限 300 / 上限 7200） |
| 9 | **重跑夹具会归零计数** | 卡 4 的数字消失 | 夹具幂等：每次执行把 SBX 券游客计数器与预算 `spent` 归零。**卡 9 切 `BUDGET_TIGHT` 前必须先抄卡 4 的数** |
| 10 | **硬记「9.09」** | 换了通道后证据变错 | `fee = CEIL(net × rate, 2)`；`rate = 0.01` → 9.09，`rate = 0` → 9.00。**每次以 probe 段 6 现场算的为准并一起归档** |
| 11 | **以为有 quote 端点** | 想在下单前拿到折扣报价 | **没有**（§23.2）。折扣只在 create-order 时算。想预判用 `evaluate` |
| 12 | **想在 Admin Studio 填游客四列** | 找不到字段 | **L4 管理端 UI 本批未建**。游客四列由**夹具 SQL** 写；Admin Studio 只负责建基础券 |
| 13 | **误在 intl 站点测试** | `guest_promo_budget_closed` | 夹具**强制关闭 intl 预算行**以防串站。用 `--site cn` |
| 14 | **`GUEST_SHOP_MAX_QUANTITY ≥ 2`** | 卡 7 拒绝半项本该失败却「通过」了 | C-D3/C-D4 未实现前**禁止开多件**，否则可被拿来免费锁库存。**保持 1** |
| 15 | **breaker 忘了合闸** | 后续所有项都 `guest_promo_halted` | 卡 8 的 ⑤ 必须执行。夹具 **H-2** 在 open 时**拒绝执行**，不会替你悄悄合闸 |
| 16 | **把 `--fail-on-not-ready` 的 exit 3 当故障** | 想用 `\|\| true` 绕过 | **3 是预期的 fail-closed**（证据归档前的正常状态）。**禁止绕过** |
| 17 | **游客商品数量被当成固定值** | 以为「就是那 2 个」 | 「哪些商品是游客商品」**完全取决于你在 Admin Studio 开了哪个开关**，不是代码里固定的 |

---

## §6 工具箱速查

```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
node supabase/sandbox/s154-guest-promo-toolbox.js <command> [options]
```

| 命令 | 性质 | 用途 | 关键参数 |
|---|---|---|---|
| `status` | **只读** | `fn_guest_shop_promo_status()`：预算 / breaker / 券的全局状态。**代替 SQL Editor 跑不了的段 4** | `--json` |
| `gate` | **只读** | `guest_shop_promo_gate()`：站点级放行判定。**验所有「拒绝半边」的主力，0 额度** | `--site cn --amount 1.00` |
| `evaluate` | **只读** | `fn_guest_shop_evaluate_discount()`：吐出 **13 个内部 reject code**。**排查「为什么显示优惠码不可用」的主力，0 额度** | `--site --product --sku --unit --code [--buyer <uuid> \| --latest-buyer] [--qty 1] [--ip-hash <64hex>] [--max-per-contact 3] [--max-per-ip 10]` |
| `breaker` | **写** | `fn_guest_shop_promo_set_breaker()`，自动写 `manual_open` / `manual_close` 审计行（卡 8） | `open\|closed --actor <名字> [--reason <原因>] --yes` |
| `record-event` | **写** | `fn_guest_shop_promo_record_event()`：手工写熔断事件，验 DB 侧自动跳闸（阈值 mismatch 3 / identity 20 / 窗口 900s）。**只有 `amount_mismatch` / `identity_limit_hit` 会自动跳闸**；禁止 `manual_open`/`manual_close`/`auto_open` | `--kind <种类> [--detail-json <json>] --yes` |
| `sweep` | **写** | `POST /api/shop/guest/worker`：触发 TTL 过期归还（卡 7） | `[--base-url http://127.0.0.1:8000] --yes` |
| `simulate-zpay-underpay` | **写** | 伪造「少付」易支付回调（卡 3）。**三重护栏**：拒绝 `money >= expected`、只接受 `SBX` 订单、只支持 zpay | `--merchant-order-no <no> --money 9.00 [--base-url ...] --yes` |
| `help` | — | 用法 | `--help` / `-h` |

**全局选项**：`--env-file <path>`（可重复；默认走 preview 同款 **5 文件链**）、`--json`。

**退出码**：`0` 成功 / `1` 命令自身判定失败（如 RPC 返回 `allowed=false`，**属正常业务结果**）/
`2` 用法或环境错误 / `3` **护栏拦截**（缺 `--yes`、非回环主机、金额不合法等）。

**内置红线（R1–R5）**：
`R1` 不执行任何 SQL/DDL，只通过 PostgREST 调既有 RPC 与读写既有表；
`R2` 永不打印密钥（pepper / zpay `pid`+`pkey` / worker secret / claim secret / 卡密 / `password_hash` /
完整 `contact_hash`+`ip_hash`），输出前统一过 `redact()`，`integration` 对象整体不进输出；
`R3` 所有**写**动作必须显式 `--yes`，且默认只允许打**本机回环**（非回环需再加 `--allow-remote-host`）；
`R4` 不启用游客商品、不打开游客开关、不改预算/券配置（那是 SQL Editor 的活）；
`R5` `evaluate` 只读可随便调，**但不提供 `reserve` 子命令** —— 真实抵扣只能由真实下单产生。

**交付前已验证**：`node --check supabase/sandbox/s154-guest-promo-toolbox.js` 通过；
**24 条护栏测试全部通过**（脱敏、回环限制、`--yes` 强制、SBX 前缀、金额方向、禁用 event kind 等）。

---

## §7 一页速查（打印出来放手边）

```
顺序：6 → 1 → 4 → 5 → 2 → 3 → 7 → 8 → 9
额度：真实抵扣单 ≤ 10（预算 8，余 2）；拒绝半边一律用只读 gate / evaluate
邮箱：A(卡4×3) B(卡5注册) C(卡5全新) D(卡2) E(卡3) F(卡7) H(卡9)   ← 7 个不同邮箱
券：  SBXPROMO10（主力，结算比例 90） / SBXQUOTA2（卡4，guest_max_uses=2，结算比例 90）
SKU： ¥0.01（卡1，≥1 张卡） / ¥10.00（其余，≥10 张卡）
预算：MAIN 20.00（卡1–8） → BUDGET_TIGHT 1.00（卡9）；切换前必须先抄卡4的数
TTL： 跑卡7 前用 GUEST_SHOP_ORDER_TTL_SECONDS=300 重启 preview
PARTIAL：1（无 min_payable）/ 3（熔断未接线）/ 7（C-D3/C-D4 未实现）/ 9（告警未接线）
归档： docs/guest-shop-promo-evidence.md §2.12 + 更新 §2.6 九项表
红线： Codex 不执行 SQL、不部署、不启用商品、不打印密钥；回滚用开关不用 DB 回滚
```
