# 游客购买实机证据归档

> 本文件按 `docs/guest-shop-order-access-2.0.md` §16.4 与
> `docs/guest-shop-promo-hardening-plan.md` §15.4 的要求，归档**必须由人在真实环境执行**的步骤结果。
> Codex 不执行 SQL、不启用游客商品、未取得明确指令前不部署（`AGENTS.md` 硬禁令）。
>
> 约定：
>
> 1. 迁移文件名里的日期（`20260920` / `20260921` / `20260922`）是**排序标签**，不代表执行日期；
>    实际执行日期以各节表头的「执行日」为准。
> 2. 任何截图或 SQL 输出粘贴进本文件前，必须先抹掉 `GUEST_SHOP_*` 密钥值、claim token、
>    卡密正文、一次性找回链接与查询密码明文（`AGENTS.md` 禁止它们出现在日志/文档/聊天记录里）。
> 3. verify 脚本只读、可重复执行；「FAIL」的含义先按
>    `docs/guest-shop-order-access-2.0.md` §12.1 D-10 排查**探针自身**，再怀疑迁移。

> **2.1 当前入口口径（2026-09-21）：** 本文件早期 A0–A3 记录中的“订单号 +
> 取货口令”、`guest/recover` 和 `guest/access/upgrade` 只作为历史设计/数据库审计
> 证据保留，不能证明或恢复当前买家能力。当前唯一用户查询入口是邮箱 + 查询密码；
> 公开旧路由和旧页面已移除。`claim_secret_hash` / HttpOnly claim proof 的履约用途
> 不受此收口影响，但不得展示为用户查询凭证。

---

## 1. 订单访问 2.0：迁移落库与 verify（A0–A3）

执行日：**2026-09-18**　执行人：**用户（在目标 Supabase SQL editor 手工执行）**　Codex：**未执行任何 SQL**

### 1.1 三个迁移 + 三个 verify 的总结果

| # | 迁移 | 对应 verify | verify 行数 | 结果 |
|---|---|---|---|---|
| 1 | `supabase/migrations/20260920_guest_shop_buyer_credentials.sql` | `20260920_verify_guest_shop_buyer_credentials.sql` | 11 | ⚠️→✅ 首轮 **1 行 FAIL**（诊断为 verify 探针缺陷 D-10，非迁移缺陷）；探针修复后**同日复跑 11/11 全 PASS**，逐行见 §1.5。**迁移未重跑，也不需要重跑** |
| 2 | `supabase/migrations/20260921_guest_shop_buyer_group_upsert.sql` | `20260921_verify_guest_shop_buyer_group_upsert.sql` | 6 | ✅ **全行 PASS（6/6）**，逐行见 §1.7 |
| 3 | `supabase/migrations/20260922_guest_shop_access_resets.sql` | `20260922_verify_guest_shop_access_resets.sql` | 7 | ✅ **全行 PASS（7/7）**，逐行见 §1.2 |

三个迁移都是**行为中立**的：`GUEST_SHOP_BUYER_CREDENTIAL_ENABLED` 仍为关闭状态，
应用层不读写这些新表，落库前后线上行为完全一致。**本次未打开任何开关、未启用游客商品。**

**三步校验现已全部通过（24 行 PASS / 0 FAIL）**：步骤 1 见 §1.5（11 行）、步骤 2 见 §1.7（6 行）、
步骤 3 见 §1.2（7 行）；首轮那行假 FAIL 的诊断与处置见 §1.3。**数据库侧 A0–A3 已落地并校验完毕，
剩余启用前置见 §1.4。**

### 1.2 步骤 3（`20260922_verify_guest_shop_access_resets.sql`）逐行结果

用户实机输出原样归档（observed 与 expected **逐字一致**）：

| sort_order | check_name | status | observed 要点 |
|---|---|---|---|
| 1 | `resets_table_present` | PASS | `{"guest_shop_access_resets": true}` |
| 2 | `resets_columns` | PASS | `missing_columns: []`、`forbidden_plaintext_columns: []` |
| 3 | `resets_constraints` | PASS | `token_hash_is_sha256_hex_shape: true`、`used_and_revoked_are_exclusive: true`、`ttl_bounded_to_24h: true`、`buyer_id_fk_cascades: true`、`admin_id_has_no_fk: true`、`missing_constraints: []` |
| 4 | `resets_indexes` | PASS | `token_index_is_partial: true`、`one_pending_index_is_unique_and_partial: true`、`missing_indexes: []` |
| 5 | `attempts_outcome_widened` | PASS | `constraint_present / single_outcome_constraint / keeps_every_legacy_outcome / adds_reset_and_upgrade_outcomes` 全 `true` |
| 6 | `rls_and_privileges` | PASS | `anon_grants: 0`、`public_grants: 0`、`authenticated_grants: 0`、`rls_enabled: true`、`no_browser_policies: true`、`service_role_grants: true` |
| 7 | `no_side_effects` | PASS | `no_new_function / no_trigger_on_buyers / no_trigger_on_resets / buyers_table_untouched` 全 `true`、`resets_table_empty_until_enabled: 0` |

安全含义（为什么这 7 行值得单独归档）：

- `rls_and_privileges` 三个 `grants = 0` + `no_browser_policies` + 仅 `service_role`：
  浏览器侧**任何身份**都读不到这张表，一次性找回链接的 `token_hash` 不可能被前端直接捞出。
- `forbidden_plaintext_columns: []` + `token_hash_is_sha256_hex_shape: true`：
  表里不存在明文 token 列，且 token 列被 CHECK 钉成 64 位 sha256 hex（D-7/D-9 的最后一道闸）。
- `used_and_revoked_are_exclusive` + `one_pending_index_is_unique_and_partial`：
  链接「用后即焚」与「每分组至多一条待用链接」由 DB 约束兜底，并发签发失败关闭。
- `ttl_bounded_to_24h`：TTL 上限被 CHECK 夹住，运维写不出「永久有效」的找回链接。
- `no_side_effects` + `resets_table_empty_until_enabled: 0`：迁移没有偷偷建函数/触发器，
  也没有产生任何数据；开关未开时表恒空。

### 1.3 步骤 1 的唯一 FAIL 行：诊断与处置（D-10）

| 项 | 内容 |
|---|---|
| FAIL 行 | `buyers_constraints.password_format_pins_scrypt_and_norm_version` |
| observed / expected | `false` / `true` |
| 结论 | **verify 脚本探针自身缺陷（假 FAIL）；迁移 `20260920` 是正确的，一行未改** |
| 根因 | 原探针 `def ~ 'norm=v[0-9]+'` 是 POSIX 正则，`[0-9]` 被读成**字符类**，要求 `norm=v` 后紧跟一个数字；而 `pg_get_constraintdef` 反解析出的文本里 `norm=v` 后是字面字符 `[`，探针**永不命中** |
| 迁移正确性的独立证据 | `tests/guest-shop-buyer-credentials.test.js`：用**真实 scrypt 产物**（`scrypt$32768$8$1$norm=v1$<base64>$<base64>`）逐字验证过同一条 CHECK |
| 实证锚点 | 同一轮里步骤 3 的 `token_hash_is_sha256_hex_shape` 用 `LIKE '%[0-9a-f]{64}%'` 在真实库上 **PASS**，证明 PG 反解析会原样保留 `[...]` / `{64}` 字面量 → 字面量探针在真实库上安全 |
| 处置 | **不重跑迁移**，只重跑修复后的 `20260920_verify_guest_shop_buyer_credentials.sql`（只读、可重复执行） |

本轮同时修掉的两个**同类隐患**（当时还没报错，但迟早会假 FAIL 或放过真缺陷）：

1. `contact_hash_format_is_64_hex`：`~ 'contact_hash' AND ~ '0-9a-f'` → `strpos(def, 'contact_hash') > 0 AND strpos(def, '[0-9a-f]{64}') > 0`。
   旧写法只查字母表、**不查长度**，32 位十六进制也能蒙混过关；新写法钉死 64 位。
2. `group_range_upper_bound_at_least_app_cap`：`~ '<= [3-9]'` → `COALESCE((substring(def from '<= *([0-9]+)'))::int, 0) >= 3`。
   旧写法把「DB 上限 ≥ 应用上限 K38=3」写成**个位数字形状**，将来把上限调到 10 会假 FAIL；新写法数值化，NULL → 0 → false 仍然 fail-closed。

规则已写进 `20260920_verify_guest_shop_buyer_credentials.sql` 文件头的「RULE FOR PROBE AUTHORS」段，
并由新增的 `tests/guest-shop-verify-probe-contract.test.js`（11 条，纯静态重放）把守：
探针被抽出来按 PG 语义对真实迁移文本求值、含正则源码的约束出现 `~` 即红、
**逐字重放已退役的错误探针复现假 FAIL**（harness 自检）、无法识别的谓词形状直接抛错、
verify 行清单冻结（20260920 共 11 行、20260922 共 7 行）。

### 1.4 启用前仍待补齐的实机项

- [x] ~~重跑 `supabase/migrations/20260920_verify_guest_shop_buyer_credentials.sql`~~ → **11 行全 PASS**（2026-09-18 复跑，输出已归档在 §1.5）
- [ ] `npm run readiness:guest-shop -- --env-file server/.env.production --fail-on-invalid`
      （预期 `--fail-on-not-ready` 仍返回 `3`，**禁止 `|| true` 绕过**）
- [ ] §15.3 G1：内部开启 `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED` 后，自测下单 / 查询 / 详情 / 卡密全链路截图
- [ ] 登录失败阶梯锁定触发截图（§8.1）
- [x] ~~历史订单「订单号 + 取货口令」找回仍可用的截图（§13.1 不可回归项）~~ → **不适用**：旧用户查询模式已移除；历史订单如需核验走客服/运营内部流程，不再补做公开入口截图
- [ ] 登录用户「我的钱包 → 订单记录」零改动截图（§11.1 不可回归项）

> 以上适用项全部归档前，**不得宣称邮箱 + 查询密码链路可启用**；发布仍须走 `AGENTS.md` 的游客专用分支 + 四链路流程，
> 且必须等用户明确下达部署指令。

### 1.5 步骤 1 复跑逐行结果（探针修复后，**11/11 全 PASS**）

复跑日：**2026-09-18**（同日，探针修复后）　脚本：`supabase/migrations/20260920_verify_guest_shop_buyer_credentials.sql`
执行人：**用户**　Codex：**未执行任何 SQL**

| sort_order | check_name | status | observed 要点（与 expected 逐字一致） |
|---|---|---|---|
| 1 | `buyer_tables_present` | PASS | `guest_shop_buyers: true`、`guest_shop_access_attempts: true` |
| 2 | `buyers_columns` | PASS | `missing_columns: []`、`unexpected_denormalised_columns: []`（库里**没有**明文邮箱/密码列） |
| 3 | `buyers_constraints` | PASS | `password_format_pins_scrypt_and_norm_version: true`（**首轮唯一 FAIL 行，现 PASS**）、`contact_hash_format_is_64_hex: true`、`group_range_upper_bound_at_least_app_cap: true`、`group_unique_covers_site_contact_group: true`、`missing_constraints: []` |
| 4 | `buyers_indexes` | PASS | `guest_shop_buyers_pkey` / `_site_contact_group_uniq` / `_contact_idx` / `_locked_idx` 四个齐备 |
| 5 | `access_attempts_shape` | PASS | `_pkey` / `_contact_idx` / `_ip_idx` 齐备、`missing_constraints: []`、`outcome_allows_credential_conflict: true` |
| 6 | `rls_and_privileges_closed` | PASS | `browser_policies: []`、`anon_select_buyers: false`、`anon_select_attempts: false`、`authenticated_select_buyers: false`、`authenticated_select_attempts: false`、两张表 `rls_enabled: true`、`realtime_published: false`、仅 `service_role` 有 select/insert |
| 7 | `orders_buyer_id_link` | PASS | `column_present` / `index_present` / `foreign_key_to_buyers` 全 true、`column_nullable_for_history: true`、`foreign_key_on_delete_set_null: true` |
| 8 | `create_order_signature_migrated` | PASS | `arity: 13`、`single_overload: true`、`has_p_buyer_id_param: true`、`new_13_param_signature_present: true`、`legacy_12_param_signature_absent: true`、`security_definer: true`、`search_path_pinned: true` |
| 9 | `create_order_buyer_binding_guards` | PASS | 9 项全 true：`rejects_buyer_contact_mismatch`、`binding_checks_same_contact_hash`、`binding_checks_same_site`、`requires_contact_hash_with_buyer_id`、`insert_persists_buyer_id`、`keeps_credit_price_resolver`、`keeps_service_role_gate`、`quantity_still_hardcoded_to_one`、`keeps_existing_guards` |
| 10 | `create_order_grants` | PASS | `anon_execute: false`、`public_execute: false`、`authenticated_execute: false`、`service_role_execute: true` |
| 11 | `a0_is_behaviour_neutral` | PASS | `buyer_id_has_no_not_null` / `orders_rls_still_enabled` / `no_backfill_trigger_on_orders` / `no_purge_job_created_by_migration` 全 true |

安全含义（这 11 行分别堵住了什么）：

- **浏览器不可达**（第 6、10 行）：`guest_shop_buyers`（存 scrypt 哈希与锁定状态）与下单 RPC 对
  `anon` / `authenticated` **零权限、零 policy、未进 realtime publication**，只能由服务端 service_role 访问。
  即使前端被 XSS 打穿，也捞不到任何哈希、无法直接调 RPC 造单。
- **串号/错绑防线在 DB 层**（第 9 行）：「订单绑定的 `buyer_id` 必须与 `(site, contact_hash)` 三元组一致」
  是**数据库级**校验（`rejects_buyer_contact_mismatch` + `binding_checks_same_contact_hash` + `binding_checks_same_site`），
  应用层被绕过也会 fail-closed；`requires_contact_hash_with_buyer_id` 堵掉「只给 buyer_id 不给邮箱哈希」的半绑定。
- **金额与数量权威仍在服务端**（第 9 行）：`keeps_credit_price_resolver`（价格由 resolver 决定，不信客户端报价）
  与 `quantity_still_hardcoded_to_one`（游客单固定 1 件）在迁移后**没有被削弱** —— 这是「零元购/刷库存」的两道主闸。
- **无重载歧义**（第 8 行）：`single_overload: true` + `legacy_12_param_signature_absent: true` 证明旧的 12 参签名
  已彻底移除；否则攻击者可以直接调旧签名绕过 `p_buyer_id` 绑定校验。`security_definer` + `search_path_pinned`
  防止靠搜索路径劫持函数。
- **历史订单数据不被迁移误改**（第 7、11 行）：`column_nullable_for_history` +
  `foreign_key_on_delete_set_null` + `buyer_id_has_no_not_null` + `no_backfill_trigger_on_orders`
  —— 老订单可保持 `buyer_id IS NULL`，迁移**没有回填、没有加 NOT NULL、没有建触发器、
  没有建清理任务**。这是数据库结构的历史审计事实，不代表仍提供订单号 + 取货口令公开查询；
  当前用户查询统一走邮箱 + 查询密码，历史订单人工核验走内部流程。
- **防爆破取证就位**（第 4、5 行）：`locked_idx` 支撑 §8.1 阶梯锁扫描；`guest_shop_access_attempts` 的
  contact / ip 双索引支撑双维度锁定；`outcome_allows_credential_conflict` 让「凭证分组冲突」可取证。
- **行为中立已实证**（第 2、11 行）：`unexpected_denormalised_columns: []` 说明没有偷偷存明文邮箱/密码，
  配合开关关闭，落库前后线上行为一致。

> 复跑用的是**修复后的探针**（D-10）。同一份迁移、同一座库，只换探针就从 FAIL 变 PASS ——
> 这本身就是「坏的是校验器」的最直接实证。`tests/guest-shop-verify-probe-contract.test.js`
> 已把三条探针的字面量写法冻结，同类错误再犯会先在 CI 里红。
>
> **探针勘误（2026-09-23，同类事故第二次，已修，迁移未动）**：L1+L2 批次把 `fn_guest_shop_create_order`
> 的签名从 **13 参**扩到 **15 参**（新增 `p_quantity integer`、`p_discount_code text`）。上表第 8、9 行的
> `new_13_param_signature_present` 与 `quantity_still_hardcoded_to_one` 两个探针把「13 参」「固定 1 件」
> **写死在字面量里**，于是在同一座已落库 A0 的库上重跑归档 verify 会假 FAIL —— 坏的仍然是校验器，不是迁移。
> 修法与 D-10 同源：**改成时代感知（era-aware），而不是再钉一个新常量。**
>
> - `fn` / `fn_grants` 两个 CTE 改为按 `pronamespace + proname` 解析函数，不再用
>   `to_regprocedure('public.fn_guest_shop_create_order(...13 参...)')` 钉死签名；签名形状交给下面的 `fn_era` 判断。
> - 新增 `fn_era` CTE：`a0_signature`（13 参）与 `l1l2_signature`（15 参）两个布尔，SQL 里逐字注释了两个时代各自的入参表。
> - 第 8 行 `new_13_param_signature_present` → **`known_signature_present`**，observed = `a0_signature OR l1l2_signature`；
>   同行 `arity` 改为 observed = `min(arity)`、expected = `CASE WHEN l1l2_signature THEN 15 ELSE 13 END FROM fn_era`。
> - 第 9 行 `quantity_still_hardcoded_to_one` → **`quantity_policy_matches_era`**：A0 时代要求函数体**不含** `p_quantity`；
>   L1L2 时代要求函数体**同时含** `p_quantity` 与 `guest_quantity_not_allowed` —— 即数量仍由服务端裁决、超限直接抛错，
>   「零元购 / 超量刷库存」的闸门没有因为多了个入参而变松。
>
> **上表第 8、9 行是 A0 时代的快照。**重跑后应看到 `arity: 15` 与两个新键名（`known_signature_present`、
> `quantity_policy_matches_era`），**行数仍是 11 行**，其余 9 行的键名与结论不变。时代无关的保证
> （浏览器不可达、串号/错绑防线在 DB 层、`security_definer` + `search_path` 钉死、历史订单不被误伤、
> 无重载歧义、防爆破取证就位）在两个时代都仍然成立，因此本节的安全含义段落无需修订。
>
> 守门员（两道，均已跑绿）：
> `tests/guest-shop-create-order-signature-compat.test.js` 新增 §5（7 个测试，**自动从迁移里推导出每一个历史签名**，
> 断言归档 verify 认识当前签名、绝不发明任何迁移没装过的签名、按函数名而非精确签名解析、已退役键名保持退役、
> arity 的 CASE 覆盖当前时代），15/15 通过；
> `scripts/guest-shop-readiness.js` 新增要求项 `verify-era-aware-signature` / `verify-known-signature-key` /
> `verify-era-aware-quantity`，以及禁止项 `verify-no-signature-pinned-cte` / `verify-no-era-pinned-arity` /
> `verify-retired-13-param-key` / `verify-retired-quantity-key`（A0 探针）与 `verify-a1b-era-aware-rpc` /
> `verify-a1b-retired-rpc-key`（A1b 探针）。
> **`supabase/migrations/20260920_guest_shop_buyer_credentials.sql` 一行未改，无需重跑。**

### 1.6 「迁移已落库、代码尚未发布」的线上兼容性核对

时间差是客观存在的：SQL 在 2026-09-18 落库时，线上跑的仍是 **main 分支**的代码
（本次改动**未推送、未部署**）。核对结论：**这个顺序是安全的，线上游客下单链路行为不变。**

| 核对项 | 证据 |
|---|---|
| 唯一的运行时调用方用具名参数 | `origin/main:server/api-handlers/public/guest-shop.js:1431` → `.rpc('fn_guest_shop_create_order', { ... })`，传 12 个具名参数，**不含 `p_buyer_id`** |
| 少传 `p_buyer_id` 仍能解析到 13 参函数 | 迁移里 `p_buyer_id UUID DEFAULT NULL`，且**带默认值的参数连续排到末尾**（PG 规则）；`p_ttl_seconds INTEGER DEFAULT 1800` 同理 |
| 少传 = 老行为，而不是报错 | 函数体 `IF p_buyer_id IS NOT NULL THEN ... ELSE v_buyer_id := NULL; END IF;`（`20260920` 迁移第 272–286 行） |
| 旧签名不会残留成第二个重载 | verify 第 8 行：`single_overload: true`、`legacy_12_param_signature_absent: true`、`arity: 13` |
| 权限没有因为换签名而丢失或放宽 | verify 第 10 行：`service_role_execute: true`，`anon/public/authenticated_execute: false` |
| 原有守卫一条没少 | verify 第 9 行 9 项全 true：`keeps_credit_price_resolver`（价格由 resolver 决定，不信客户端）、`keeps_service_role_gate`、`quantity_still_hardcoded_to_one`、`keeps_existing_guards` |
| `20260922` 放宽 outcome 不会让现有写入失效 | 步骤 3 verify 第 5 行：`keeps_every_legacy_outcome: true`（新枚举是旧枚举的**严格超集**） |
| 订单表没有被顺带改动 | verify 第 7、11 行：`column_nullable_for_history` / `foreign_key_on_delete_set_null` / `buyer_id_has_no_not_null` / `no_backfill_trigger_on_orders` / `orders_rls_still_enabled` |

⚠️ 反过来说，**如果调用方用的是位置参数，这次换签名就会直接把线上下单打断**：
第 10 位会把 `p_request_ip_hash` 的 TEXT 塞进 `p_buyer_id UUID`，报
`function ... does not exist`，或者在类型恰好兼容时**静默错位**。仓库里已确认没有位置参数调用，
并新增 `tests/guest-shop-create-order-signature-compat.test.js`（5 条）把这件事钉死：

1. `api/` 与 `server/` 下**所有** `.rpc('fn_guest_shop_*', ...)` 调用点的第二参数必须是对象字面量；
2. 调用方键集合与迁移声明的 13 个参数**逐字相同**（防拼写错误、防漏传、防重复传）；
3. 模拟「线上 main 的 12 参调用」：省略的参数必须带 `DEFAULT`、默认值必须是 `NULL`，
   且**带默认值的参数必须连续到末尾**；
4. 函数体必须保留 `ELSE v_buyer_id := NULL`（少传 = 不绑定，不是报错），
   同时保留 `guest_buyer_contact_required` / `guest_buyer_mismatch` 两道 fail-closed；
5. 旧 12 参签名必须按**精确参数表** DROP、**禁止 CASCADE**、迁移里只允许一个 create 定义，
   且新签名必须重新 `GRANT ... TO service_role` + `REVOKE ... FROM PUBLIC, anon, authenticated`。

变异验证（证明这些断言真的会咬人，不是空转）：把 `p_buyer_id UUID DEFAULT NULL` 的 `DEFAULT NULL` 去掉 →
第 3 条红；把调用方的 `{` 改成 `[` → 第 1、2 条红。两次变异后文件均已还原，`git diff` 为空。

> `DROP FUNCTION` 与 `CREATE OR REPLACE FUNCTION` 之间存在一个极短的解析窗口（已执行完毕）。
> 期间若有游客下单请求，最坏表现是该请求失败并由前端重试；RPC 是原子的、订单创建幂等
> （`idempotency_key` + advisory lock），不会产生半写状态或重复订单。

### 1.7 步骤 2（`20260921_verify_guest_shop_buyer_group_upsert.sql`）逐行结果

执行日：**2026-09-18**　执行人：**用户**　Codex：**未执行任何 SQL**

| sort_order | check_name | status | observed 要点（与 expected 逐字一致） |
|---|---|---|---|
| 1 | `upsert_fn_present_and_unique` | PASS | `present: true`、`overload_count: 1`（**只有一个重载**） |
| 2 | `upsert_fn_signature` | PASS | `arity: 7`、`in_params_match: true`（7 个入参名**逐位**一致）、`returns_buyer_id / returns_group_no / returns_allocation: true`、`is_set_returning: true` |
| 3 | `upsert_fn_security_posture` | PASS | `security_definer: true`、`search_path_pinned: true`、`not_immutable: true` |
| 4 | `upsert_fn_grants` | PASS | `service_role_execute: true`；`anon_execute / authenticated_execute / public_execute` 全 `false` |
| 5 | `upsert_fn_body_guarantees` | PASS | 9 项全 `true`：`advisory_lock_serialises_contact`、`insert_never_upserts`、`effective_group_uses_exists_not_counter`、`recycle_cooldown_applied`、`cap_conflict_token_present`、`contact_hash_validated`、`password_format_validated`、`registered_match_written_as_record`、`registered_match_never_a_predicate` |
| 6 | `a1b_is_additive` | PASS | `buyers_table_present / group_unique_still_present / buyers_rls_still_enabled / create_order_rpc_still_13_params: true`；`no_new_buyers_columns / no_trigger_added_to_buyers / no_purge_job_created: true` |

安全含义（这 6 行分别堵住了什么）：

- **分组分配 RPC 浏览器不可达**（第 4 行）：`fn_guest_shop_upsert_buyer_group` 只对 `service_role` 开放，
  `anon` / `authenticated` / `PUBLIC` 零 EXECUTE。分组号、容量上限、回收冷却全部由服务端裁决，
  前端无法自选或反复申请「新分组」来蹭更宽松的配额。
- **`insert_never_upserts` 是 N2（卡密串号/接管）的根**（第 5 行）：函数体只允许
  `ON CONFLICT ON CONSTRAINT guest_shop_buyers_site_contact_group_uniq DO NOTHING`，并显式**禁止任何 `DO UPDATE`**。
  否则后来者可以用同一 `(site, contact_hash, group_no)` 覆盖已存在分组的 `password_hash`，
  直接接管别人的凭证分组，进而读到别人的卡密。
- **并发不会双开分组**（第 5 行）：`advisory_lock_serialises_contact`
  （`pg_advisory_xact_lock(hashtextextended(...))`）把同一联系方式的并发注册串行化；
  `effective_group_uses_exists_not_counter` 用 `EXISTS` 实数分组而**不是自增计数器**，
  计数器漂移不会突破 cap；撞 cap 时抛 `guest_buyer_credential_conflict`，**fail-closed** 而不是放行。
- **不能靠换邮箱无限刷配额**（第 5 行）：`recycle_cooldown_applied` 把分组回收夹在冷却期之后。
- **DB 层再校验一次数据形状**（第 5 行）：`contact_hash_validated`（64-hex）与
  `password_format_validated`（scrypt 前缀 + `norm=v`）在写入前由函数体把关，
  应用层被绕过也写不进脏凭证 —— 脏 `password_hash` 会让后续登录校验退化成不可比对的字符串。
- **反杀熟硬约束落到 DB**（第 5 行）：`registered_match_written_as_record: true` 且
  `registered_match_never_a_predicate: true` —— 「是否命中已注册邮箱」**只能作为取证记录写入**，
  永不作为过滤条件、比较或分支判据（H2 / 促销方案 §22.5）。注册邮箱用户与游客拿到的
  价格与资格**完全一致**，不存在「老用户被区别对待」的实现路径。
- **A1b 是纯加法，没有踩 A0**（第 6 行）：没有新增列、没有给 `guest_shop_buyers` 挂触发器、
  没有创建清理任务，RLS 仍启用，分组唯一约束仍在，`fn_guest_shop_create_order` 仍是 **13 参**
  （即 A0 换签名后没有被 A1b 改回去或改出第二个重载）。
- **具名参数契约不会被重载打断**（第 1、2 行）：`overload_count: 1` + 7 个入参名逐位一致，
  保证 PostgREST 的具名调用唯一可解析。这与 A0 精确 DROP 旧 12 参签名是同一个坑：
  多出一个重载，所有具名调用立刻变歧义。

> **计数勘误（2026-09-18）**：本节归档前，§1.1 与设计合同把步骤 2 记为「5 行」（总数 23），
> 实际 verify 输出 **6 行**（总数 **24**）。原因是 `tests/guest-shop-verify-probe-contract.test.js`
> 的「行清单冻结」断言当时只覆盖 `20260920` 与 `20260922` 两个脚本，A1b 不在册，
> 因此没有任何自动化守门员发现文档少算一行。已补上 `checkNames(SOURCES.a1bVerify)` 的 6 项断言，
> 三个 verify 现在全部在册；行数口径已同步改为 11 + 6 + 7 = **24**。**迁移与 verify 脚本本身一行未改。**
>
> **探针勘误（2026-09-23）**：第 6 行的 `create_order_rpc_still_13_params` 与 §1.5 是同一个坑 ——
> L1+L2 把签名扩到 15 参后，这个键名会把 A1b 的「纯加法」结论误判成 FAIL。已改名为
> **`create_order_rpc_known_signature`**，observed 改为「两个时代的 `to_regprocedure` 命中其一」
> （`20260920` 装的 13 参 **或** `20260923` 装的 15 参）。因此上面「A1b 是纯加法」那条里的
> 「`fn_guest_shop_create_order` 仍是 **13 参**」应读作「仍属于**已知时代**且**只有一个重载**」——
> A1b 要证明的从来是「没被改回去、没改出第二个重载」，而不是「参数个数永远等于 13」。
> 当前 15 参签名由 `supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql` 的
> `function_arity_single_overload` 钉住。**本节行数仍是 6 行，`20260921` 迁移一行未改。**

---

## 2. 游客促销 L1+L2 合并批：代码 / 测试 / 就绪度证据（**未部署**；迁移**已落库**，verify 首跑 20 PASS / 2 FAIL 已修为 **23 行**）

批次日：**2026-09-19**　分支：`codex/guest-shop-promo-l1l2`（自 `main` 的 `0ac8cf17e`）　执行人：**Codex**

红线状态（`AGENTS.md` 硬禁令逐条自检）：

| 禁令 | 本批状态 |
|---|---|
| 未取得明确指令前不部署 | ✅ **未部署**，工作区改动**未提交、未推送** |
| Codex 不执行 SQL | ✅ **一行 SQL 都没执行**；`20260923` 迁移与 verify 只写成文件，留给用户（§2.4）。落库与首跑均由**用户**完成（§2.9） |
| 不打开游客商品 / SKU / 购买开关 | ✅ 未碰；新增的 `GUEST_SHOP_DISCOUNT_ENABLED` 默认关闭，`GUEST_SHOP_MAX_QUANTITY` 默认 **1** |
| 不打印 `GUEST_SHOP_*` 密钥值 | ✅ 本节与所有测试输出均无密钥明文；readiness 的 5 条 warning 只报「未配置」，不回显值 |
| 不从功能分支 `vercel deploy --prod` | ✅ 未执行任何 vercel 命令 |

> **本节归档「机器可复现」的那一半证据**（代码 + 测试 + 就绪度扫描）。
> 「必须由人在真实环境执行」的那一半，进度已更新为：
> **① `20260923` 迁移 —— 已由用户落库（§2.9）；② verify —— 已由用户首跑，22 行报 20 PASS / 2 FAIL，
> 两处均为探针缺陷、迁移一行未改，已升级为 23 行并待复跑（§2.9 / §2.10）；③ §15.4 九项沙箱实机验证 —— 仍 0/9（§2.6）。**
> 因此：**本批次仍不等于「完成」，更不等于「可启用」**；`readiness --fail-on-not-ready` 仍返回 **3**（§2.3）。

### 2.1 改动清单

新增文件（4 个，**本批产物**）：

| 文件 | 行数 | 作用 |
|---|---|---|
| `api/_lib/guest-shop/promo.js` | 510 | 券码归一化、白名单/配额判定、**服务端**折扣计算入口（客户端不参与金额） |
| `tests/guest-shop-promo-error-contract.test.js` | 473 | 9 例：迁移里每个 `guest_*` RAISE 码都有公开 HTTP 映射；C-E6 归一；不泄漏 SQLSTATE / 内部细码 |
| `supabase/migrations/20260923_guest_shop_promo_l1l2.sql` | 3538 | L1+L2+L3(定价权威) 的库侧实现；`fn_guest_shop_create_order` 13→**15** 参。**已由用户落库**；探针修复轮只改 §9 运维注释，DDL/函数体一行未动 |
| `supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql` | 1433 | **23 行**只读 verify（清单见 §2.5）；**已首跑**：22 行版本 20 PASS / 2 FAIL，两处均为探针缺陷（§2.9），修复后**待复跑**（§2.10） |

已跟踪文件改动（**24 个**，`git show --numstat` 快照，+增 / −删）：

| 文件 | +/− | 文件 | +/− |
|---|---|---|---|
| `api/_lib/guest-shop/pricing.js` | +106 / −3 | `shop.html` | +49 / −1 |
| `api/_lib/guest-shop/runtime-config.js` | +31 / −0 | `supabase/migrations/20260920_verify_guest_shop_buyer_credentials.sql` | +69 / −14 |
| `api/_lib/guest-shop/security.js` | +95 / −4 | `supabase/migrations/20260921_verify_guest_shop_buyer_group_upsert.sql` | +16 / −6 |
| `css/shop-page.css` | +45 / −0 | `tests/guest-shop-buyer-order-credentials.test.js` | +8 / −1 |
| `docs/guest-purchase-task-2.0.md`（新增 §59 + §60） | +277 / −0 | `tests/guest-shop-create-order-signature-compat.test.js` | +301 / −10 |
| `docs/guest-shop-payment-fulfillment-runbook.md`（游客促销启用前置清单） | +163 / −0 | `tests/guest-shop-credit-pricing.test.js` | +65 / −2 |
| `docs/guest-shop-promo-evidence.md`（本文件） | §2 追加后继续增长，故不列 numstat | `tests/guest-shop-frontend-contract.test.js` | +67 / −5 |
| `docs/guest-shop-promo-hardening-plan.md`（新增 §23） | +184 / −0 | `tests/guest-shop-order-access-endpoints.test.js` | +145 / −0 |
| `js/guest-shop-client.js` | +495 / −8 | `tests/guest-shop-orders-idempotency.test.js` | +18 / −3 |
| `scripts/guest-shop-readiness.js` | +454 / −11 | `tests/guest-shop-readiness.test.js` | +111 / −0 |
| `server/api-handlers/public/guest-shop.js` | +491 / −70 | `tests/guest-shop-security.test.js` | +81 / −1 |
| `server/guest-shop-worker.js` | +81 / −10 | `tests/guest-shop-verify-probe-contract.test.js` | +488 / −5 |

> 口径：**4 个新文件 + 24 个已跟踪文件改动 = 提交含 28 个文件**。
>
> ⚠️ 上表的 +/− 是**写作时的快照，会随 amend 漂移**（本文件、两个测试文件与 readiness 脚本都在同一个提交里被反复编辑）。
> 与本节「不写死 commit hash」同一条纪律：**权威口径是 `git show --numstat`，本节只把「文件清单 + 4/24/28 这三个计数」当作稳定不变量**。
> 首次归档时本表写的是「22 个已跟踪 / 共 26 个文件」，那是**漏计**：`tests/guest-shop-readiness.test.js` 与
> `tests/guest-shop-verify-probe-contract.test.js` 的改动当时只在工作区、没进提交（源码进了、对应测试没进）。
> 本轮 amend 已把这两个文件补进同一个提交，28 才是完整口径 —— 这正是「计数漂移」必须靠机器口径而不是靠手抄的原因。

**提交时必须排除的 4 个无关未跟踪文件**（2026-09-17 的部署草稿/包装脚本，非本批产物，也不属于任何已批准流程；**本轮 amend 后已用 `git show --name-only` 复核：4 个文件均不在提交内，仍是未跟踪状态**）：
`DEPLOYMENT_STEPS.md`、`deploy-guest-shop-worker.sh`、`kvm4-deployment-guide.md`、`kvm4-env-template.txt`。
其中 `kvm4-deployment-guide.md` 自身首行即标注「本文件已作废（v1 草稿）」；`deploy-guest-shop-worker.sh`
绕过 `AGENTS.md` 规定的 `npm run deploy:kvm4:*` 与 host installer 路径。**这四个文件不得随本批进入 `main`。**

### 2.2 测试计数（本机复跑，2026-09-19，命令与输出原样）

聚焦测试（`node --test --test-force-exit <file>`）：

| 测试文件 | tests | pass | fail |
|---|---|---|---|
| `tests/guest-shop-promo-error-contract.test.js`（新） | 9 | 9 | 0 |
| `tests/guest-shop-frontend-contract.test.js` | 26 | 26 | 0 |
| `tests/guest-shop-create-order-signature-compat.test.js`（含新 §5 的 7 例） | 15 | 15 | 0 |
| `tests/guest-shop-buyer-order-credentials.test.js` | 31 | 31 | 0 |
| `tests/guest-shop-verify-probe-contract.test.js` | 19 | 19 | 0 |
| `tests/guest-shop-readiness.test.js` | 29 | 29 | 0 |
| **聚焦小计** | **129** | **129** | **0** |

全量回归（`npm run test:security`，即 `node --test --test-force-exit tests/*.test.js`）：

```
tests 3370
pass 3370
fail 0
cancelled 0
EXIT=0
```

`main` 基线为 **3156 pass / 0 fail**，本批 **+214**，fail 仍为 **0** —— 满足 §15.3「pass 只增不减、fail 恒为 0」。

> **计数演进**：§59 归档时为 **3361**；探针修复轮（§2.9）新增 9 例
> （`guest-shop-verify-probe-contract` 11→**19**、`guest-shop-readiness` 28→**29**）后为 **3370**。
> 两个聚焦文件均已连跑稳定（探针合同 ×5、flake 用例 ×40），不属于 §2.7 描述的瞬时少计。

### 2.3 就绪度扫描（`node scripts/guest-shop-readiness.js --json`）

| 指标 | 值 | 说明 |
|---|---|---|
| `checks` 总数 | **308** | 新增 `promo` 组 **120** 项（本批最大增量；探针修复轮 +12：9 条要求项 + 3 条禁止项） |
| `ok:true` | **308 / 308** | 无一项 `ok:false` |
| `invalid_count` | **0** | `findings: []` |
| `warning_count` | **5** | 全部是「本地无 `.env.production` / 无 production 标识 / 两个 pepper 未配置 / NOWPayments 退款需人工」——**本地环境的预期告警，不是代码缺陷** |
| `manual_review_count` | **20**（基线 14，+6） | 新增 6 项全在 `promo` 组：`promo-schema-applied`、`promo-budget-opened`、`promo-breaker-closed`、`promo-dirty-coupon-scan`、`promo-sku-quantity-scan`、`promo-parity-evidence` |
| `ok` | `true` | |
| `ready` | **`false`** | 预期：没有实机证据就不该 ready |
| `--fail-on-invalid` 退出码 | **0** | 无 INVALID |
| `--fail-on-not-ready` 退出码 | **3** | **预期的 fail-closed**（`AGENTS.md`：不得用 `\|\| true` 绕过） |

按 area 分布：`promo` **120**、`buyer_credentials` 77、`repo` 46、`limits` 22、`docs` 19、`provider` 10、
`secrets` 5、`rate_limit` 3、`runtime` 2、`env` 2、`worker` 1、`callback` 1。

**`ready:false` + 退出码 3 是本批的正确终态**，不是待修故障：它精确表达「代码与自动化守门员就位，
但沙箱实机证据（§2.6）与迁移落库（§2.4）尚未发生，因此不得启用」。

### 2.4 待用户执行的 SQL（**Codex 不执行，只交付绝对路径**）

按顺序在目标 Supabase SQL editor 手工执行；**执行完把 verify 输出贴回来，由我归档进本节**：

1. 迁移（写操作，落库后行为仍中立，因为开关默认关闭）：
   [`/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_guest_shop_promo_l1l2.sql`](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_guest_shop_promo_l1l2.sql)
2. verify（只读、可重复执行，**23 行**；首跑用的是 22 行旧版，结果见 §2.9，**需用当前版本复跑**，见 §2.10）：
   [`/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql`](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql)

⚠️ 两个**已归档的**旧 verify 脚本在本批被改成「时代感知」（§1.5 / §1.7 的探针勘误）。
若要在同一座库上重跑它们，请用**修复后**的版本，并预期看到新键名：

3. [`/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260920_verify_guest_shop_buyer_credentials.sql`](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260920_verify_guest_shop_buyer_credentials.sql)（11 行；第 8 行键名 `known_signature_present`、`arity` 应为 **15**；第 9 行键名 `quantity_policy_matches_era`）
4. [`/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260921_verify_guest_shop_buyer_group_upsert.sql`](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260921_verify_guest_shop_buyer_group_upsert.sql)（6 行；第 6 行键名 `create_order_rpc_known_signature`）

> **A0 的三个迁移（`20260920` / `20260921` / `20260922`）一行未改，不需要重跑。**
> 改的是**校验器**，不是被校验的对象 —— 这正是 D-10 的结论，本批是同类事故第二次（§1.5 勘误）。

### 2.5 `20260923_verify` 的 **23 行**检查清单（首跑结果见 §2.9，修复后待复跑见 §2.10）

| # | check_name | 判定口径 | # | check_name | 判定口径 |
|---|---|---|---|---|---|
| 1 | `orders_new_columns` | PASS | 12 | `zero_purchase_guards` | PASS |
| 2 | `orders_amount_check` | PASS | 13 | `resolver_tier_flash_parity` | PASS |
| 3 | `orders_quantity_and_code_checks` | PASS | 14 | `replay_return_types_cast` | PASS |
| 4 | `reservations_multi_row` | PASS | 15 | `existing_rows_satisfy_new_checks` | PASS |
| 5 | `ledger_table_columns` | PASS | 16 | `no_side_effects` | PASS |
| 6 | `ledger_constraints` | PASS | 17 | `discount_codes_guest_columns` | PASS |
| 7 | `ledger_indexes` | PASS | 18 | `promo_budget_table` | PASS |
| 8 | `ledger_rls_and_privileges` | PASS | 19 | `promo_breaker_table` | PASS |
| 9 | `function_arity_single_overload` | PASS | 20 | `promo_breaker_events_table` | PASS |
| 10 | `function_privileges` | PASS | 21 | `ledger_return_columns` | PASS |
| 11 | `function_hardening` | PASS | 22 | `promo_function_guards` | PASS |
| **23** | **`operator_state_review`** | **PASS 或 REVIEW（设计如此）** | | | |

**第 1–22 行必须全 PASS**；任何一行 FAIL 都意味着迁移被部分应用。

**第 23 行 `operator_state_review` 是本轮新增的「人工确认行」，不是 PASS/FAIL 判定。**
它把**实时运维状态**打印出来（已开放游客结账的商品/SKU、`GUEST_SHOP_MAX_QUANTITY`、
`GUEST_SHOP_DISCOUNT_ENABLED`、促销预算与熔断状态），因为这些值由**人**决定，任何迁移都无权钉死。
`REVIEW` 的含义是「必须有人逐条核对列出的状态是有意为之」，**绝不代表迁移失败**；只有 `FAIL` 才是迁移问题。
第 23 行会**点名具体商品**而不是只给计数 —— 光有计数无法据此行动，首跑时 `1 → 2` 的增量正是这样被发现的（§2.9）。

其中与「绝不零元购」直接相关、**必须看到 PASS 才谈启用**的四行：
第 2 行 `orders_amount_check`（`guest_shop_orders_amount_check`：零元购地板 + 50% 硬顶 + 通道费 10% 硬顶）、
第 9 行 `function_arity_single_overload`（15 参且**唯一重载**，否则攻击者可调旧签名绕过绑定校验）、
第 12 行 `zero_purchase_guards`、第 22 行 `promo_function_guards`（白名单+配额闸真的在 `evaluate` 里、
`reserve` 真的原子扣预算与计数）。**首跑时 (2)(9)(22) 已 PASS，(12) 因探针缺陷假 FAIL，已修（§2.9）。**

### 2.6 §15.4 九项沙箱实机验证：**全部未执行（0 / 9）**

`docs/guest-shop-promo-hardening-plan.md` §15.4 明写「**由用户执行，Codex 不执行 SQL、不启用商品**」。
本批**一项都没跑**，因此按 §15.5 与 §17 第 12 条：**不得宣称游客促销「完成」或「可启用」**。待跑清单原样登记：

| # | 待验证项 | 状态 |
|---|---|---|
| 1 | ¥0.01 沙箱 SKU + percent 10% 券 → 必须被 `min_payable` **拒绝**，不得产生 0 元单（C-B9） | ⬜ 未执行 |
| 2 | ¥10 SKU + percent 10% 券 → 应付 9.00 + 1% 通道费(ceil) = **9.09**，实付 9.09 → 正常发货 | ⬜ 未执行 |
| 3 | 故意只付 9.00（少付手续费）→ webhook `amount_mismatch`，**不发货**，熔断计数 +1 | ⬜ 未执行 |
| 4 | `guest_max_uses=2` 的券第 3 次使用 → `guest_discount_unavailable`，`guest_used_count` 停在 2（§9.3 原子性） | ⬜ 未执行 |
| 5 | **反杀熟 H1**：注册邮箱游客会话 vs 全新邮箱游客会话，折后金额**逐分相等**；两边都能用券；`registered_user_match` 取值不同但**金额相同** | ⬜ 未执行 |
| 6 | **H2 入参白名单**：定价 resolver 入参不含 `registered_user_match` / `merged_into_user_id` / `buyer_id` / `credential_group_no` / `failed_login_count` / `last_login_at` / `email_verified_at` | ⬜ 未执行 |
| 7 | 批量创建不付款单 → 触达 C-D3 / C-D4 后拒绝；TTL 到期库存与预算同时归还（C-D6 / C-C5） | ⬜ 未执行　**且 C-D3/C-D4 本批未实现（§23.5），此项当前必然不通过** |
| 8 | 手动置 `guest_shop_promo_breaker` = open → 促销全停、**原价仍可买**；后台恢复 → 促销恢复 | ⬜ 未执行 |
| 9 | 日预算打满 → 促销停止、原价可买、告警发出 | ⬜ 未执行 |

第 5、6 项是 §22.5 反杀熟的守门员，**不可删除**；第 7 项在 C-D3/C-D4 落地前无法通过，
这也是 `GUEST_SHOP_MAX_QUANTITY ≥ 2` **本批禁止开启**的原因（§23.5）。

### 2.7 计数勘误：一次瞬时少计（3314）与两次一致 3361

本批开发过程中，全量套件出现过一次 **3314** 的读数，比稳定值 3361 少 47。
诊断为 **`--test-force-exit` 在高负载下的瞬时少计**（强制退出打断了尚未汇报的子测试计数），
**不是**测试丢失或断言失效：紧随其后的两次连续运行都稳定给出 **3361 / 3361 / 0 fail**，
本节 §2.2 归档的是第三次连续一致运行（`EXIT=0`）。

处置方式：**登记而不追猎**。若后续再出现非 3361 的读数，先单独复跑该文件确认 pass/fail，
再判断是否真有回归；不要用「重跑到出现想要的数字」来掩盖真实失败。

同类计数纪律另见 §1.7 的「计数勘误（2026-09-18）」：文档少算一行 verify 输出，
根因是自动化守门员的覆盖清单不全。本批已把三个 verify 的行清单全部纳入
`tests/guest-shop-verify-probe-contract.test.js`（冻结行名，促销 verify 现为 **23** 行），
并新增 §2.5 的 23 行登记表作为人工对账基准。§2.9 是这条纪律的**第三次**兑现：
首跑出现的 2 个 FAIL 全部是登记表与守门员没覆盖到的**探针**缺陷，而不是迁移缺陷。

### 2.8 本批结论（**2026-09-19 探针修复轮后更新**）

**已就位**：L1（游客多件 + 阶梯价 + 闪购，积分与现金等值参与结算）、L2（游客优惠码 + 券级/站点级硬预算 +
身份配额台账 + 熔断）、L3 的定价权威部分（create-order 内重算 + 金额 CHECK + fingerprint 扩展 + 退款/过期幂等归还）
的**代码、迁移文件、23 行 verify、自动化守门员、就绪度扫描**全部完成并跑绿；
所有折扣**只走服务端定价**，客户端仅做展示格式化，不参与金额计算。
`20260923` **迁移已由用户落库**，verify 已首跑一次并完成两类探针缺陷修复（§2.9）。

**未就位（因此不得启用）**：修复后的 23 行 verify **尚未复跑**（§2.10）、第 23 行报出的
**`guest_products_enabled = 2`** 尚待用户确认（§2.9.5）、§15.4 九项沙箱实机验证 **0/9**、
C-D3 / C-D4 / C-D5 **未实现**、L4 后台运营界面**未开工**、quote 端点**本批不做**（§23.2）。
**代码仍未部署**（未推分支、未开/合 PR、未 vercel、未触发 KVM4 任何链路）。

**下一步（严格按序）**：① 用户**复跑** §2.10 的 23 行 verify，把输出贴回来由我归档进 §2.10；
② 用户按 §2.9.5 确认第 23 行的运维状态（尤其是 1 → 2 的第二个游客商品）；
③ 用户执行 §15.4 九项（第 7 项需先补 C-D3/C-D4）；④ 用户下达明确部署指令后，
才按 `AGENTS.md` 的游客购买四条链路流程发布；⑤ 发布 ≠ 启用，启用另需 §14 灰度许可签署。


### 2.9 首次实机执行归档：22 行 → **20 PASS / 2 FAIL**，两处均为**探针缺陷**（D-10 第 3、4 类）

执行日 **2026-09-19**，执行人 **用户**（Codex 未执行任何 SQL）。
迁移 `20260923_guest_shop_promo_l1l2.sql` 已在目标 Supabase 落库，随后执行当时的 **22 行**版 verify。

> 代码注释里出现的「2026-09-23」沿用迁移文件名 `20260923_*` 的序号日期，指的是**同一个事件**，不是另一天。

#### 2.9.1 逐行结果（22 行原样）

| # | check_name | 结果 | # | check_name | 结果 |
|---|---|---|---|---|---|
| 1 | `orders_new_columns` | PASS | 12 | `zero_purchase_guards` | **FAIL** |
| 2 | `orders_amount_check` | PASS | 13 | `resolver_tier_flash_parity` | PASS |
| 3 | `orders_quantity_and_code_checks` | PASS | 14 | `replay_return_types_cast` | PASS |
| 4 | `reservations_multi_row` | PASS | 15 | `existing_rows_satisfy_new_checks` | PASS |
| 5 | `ledger_table_columns` | PASS | 16 | `no_side_effects` | **FAIL** |
| 6 | `ledger_constraints` | PASS | 17 | `discount_codes_guest_columns` | PASS |
| 7 | `ledger_indexes` | PASS | 18 | `promo_budget_table` | PASS |
| 8 | `ledger_rls_and_privileges` | PASS | 19 | `promo_breaker_table` | PASS |
| 9 | `function_arity_single_overload` | PASS | 20 | `promo_breaker_events_table` | PASS |
| 10 | `function_privileges` | PASS | 21 | `ledger_return_columns` | PASS |
| 11 | `function_hardening` | PASS | 22 | `promo_function_guards` | PASS |

**与「绝不零元购」直接相关的四行里，(2) `orders_amount_check`、(9) `function_arity_single_overload`、
(22) `promo_function_guards` 首跑即 PASS**；只有 (12) FAIL，且 15 个键里 14 个为 `true`。

#### 2.9.2 FAIL 行 1 —— 第 12 行 `zero_purchase_guards`（D-10 **第 3 类**：注释文本被当作可执行代码）

observed / expected 的唯一差异键：

```text
evaluate_is_read_only : false  (observed)
evaluate_is_read_only : true   (expected)
```

其余 14 键全部 `true`：`claim_is_aggregate_aware`、`confirm_is_aggregate_aware`、`evaluate_enforces_half_floor`、
`mark_needs_all_rows_consumed`、`reserve_reasserts_half_floor`、`create_bounds_quantity_1_to_5`、
`reserve_delegates_to_evaluate`、`create_reserves_all_or_nothing`、`delivered_content_guards_state`、
`reserve_snapshot_pins_zero_false`、`create_caps_by_all_three_ceilings`、`evaluate_calls_resolver_zero_false`、
`create_requires_identity_for_discount`、`create_never_reserves_shared_or_duplicate_rows`。

| 项 | 内容 |
|---|---|
| 结论 | **verify 探针自身缺陷（假 FAIL）；`fn_guest_shop_evaluate_discount` 确实只读，迁移一行未改** |
| 根因 | `pg_proc.prosrc` **原样保留函数自己的 SQL 注释**。该函数在说明原子性时写了 “deduction is the atomic **UPDATE** pair in `fn_guest_shop_reserve_discount`”，退役探针 `prosrc ~* 'UPDATE'` 把这句**散文**当成了 DML |
| 同类先例 | 与 §1.3 的 `pwd_format` 假 FAIL、§1.5/§1.7 的签名时代假 FAIL 同源：**报 FAIL 的始终是校验器** |
| 修法 | 新增 CTE `fn_code`（先剥 `--` 行注释与 `/* */` 块注释），本文件**所有**函数体探针统一改跑 `fn_code` |
| **明确禁止的两种「修法」** | ① 删掉那句原子性说明注释；② 删掉 `evaluate_is_read_only` 断言。两者都是**用安全断言换绿灯**，已在 readiness 设为禁止项 |

#### 2.9.3 FAIL 行 2 —— 第 16 行 `no_side_effects`（D-10 **第 4 类**：把运维状态钉死成常量）

```text
guest_products_enabled : 2  (observed)
guest_products_enabled : 0  (expected)
```

其余 6 键全部符合：`ledger_has_no_policy:true`、`no_trigger_on_ledger:true`、`no_trigger_on_orders:true`、
`writable_browser_policies:[]`、`shared_discount_engine_untouched:true`、`reservation_validation_trigger_intact:true`。

| 项 | 内容 |
|---|---|
| 结论 | **探针设计缺陷，不是迁移缺陷，也不是安全缺陷**。库里没有任何促销函数写 `shop_products` |
| 根因 | 探针把**运维状态**（已开放游客结账的商品数）钉成常量 `0`。用户为测试开了 2 个商品 —— 这是**人的决定**，任何迁移都无权、也无法把它变回 0，于是正确的库必然 FAIL |
| 修法 | 第 16 行只保留**机制**断言 `promo_functions_never_write_products`（任何 `guest_shop*` 函数都不得写 `shop_products`）；实时状态挪到**新增的第 23 行** `operator_state_review`，输出 PASS 或 REVIEW |
| 附带收获 | 第 23 行**点名具体商品**而不是只给计数，`1 → 2` 的增量因此立刻可见（§2.9.5） |

#### 2.9.4 「剥注释」的安全性证明（这是放松扫描，必须证明只影响注释）

1. **字面量扫描**：引号感知扫描器取出仓库里全部 **53** 个 `guest_shop*` 函数体中的字符串/美元引用字面量，
   其中含 `--` 或 `/*` 的字面量数 = **0** → 剥注释不可能吃掉任何被断言的正文。
2. **探针静态重放**：全部体探针在 raw `prosrc` 与 `fn_code` 两种口径下重放，**正向探针结果逐一相同**；
   唯一变化的是那条负向只读 DML 探针（`FAIL → PASS`），正是本次要修的目标。
   **不存在任何 `PASS → FAIL` 方向的漂移。**
3. **反向保险**：`fn_code` 定义为 `SELECT f.*, regexp_replace(...) AS code FROM guest_fns f`，是 `guest_fns` 的
   **严格超集**，`prosrc` 仍在；需要原文的探针可继续使用它。
4. **fail-closed 键 + 守门员**：verify 内保留「剥注释没有把函数体剥空」的证明键；
   `tests/guest-shop-verify-probe-contract.test.js` **§7** 逐字验证剥注释保住字符串字面量与美元引用体、只丢散文，
   并断言**四个 verify 脚本全部只读**。
5. **规则入档**：verify 文件头 `RULE FOR PROBE AUTHORS` 从 3 类扩到 **4 类**，并写明正向探针口径不变、
   唯一例外是负向只读探针、任何体探针不得向 `PASS → FAIL` 漂移。

#### 2.9.5 ⚠️ 第 23 行点名的运维状态：**`guest_products_enabled = 2`**（待用户确认）

> **2026-09-19 更新：本节已由用户裁决闭合，结论见 §2.10.2。** 用户确认**保留这 2 个游客商品**，并澄清
> 「某商品是否属于游客商品，取决于管理员在 Admin Studio 里打开了哪个商品的游客开关，是动态、管理员可控的，
> 既不是固定 1 个、也不是固定 2 个」。据此**作废下文引用的旧常设规则中的「计数上限（不得再开第二个）」一句**，
> 改为「数量由管理员开关决定，无固定上限；但每个被打开的商品仍须低价值 / 非共享 / 自动发货，且不得公开上架」。
> **REVIEW 机制与技术护栏一条未弱化**（`GUEST_SHOP_MAX_QUANTITY=1`、`GUEST_SHOP_DISCOUNT_ENABLED=OFF`、预算 disabled/0、熔断 closed）。
> 下文「请二选一」的原始待确认口径**保留不删**，作为审计轨迹。

既有口径是 **1** 个（`docs/guest-purchase-task-2.0.md` 常设规则原文：
「用户已主动打开 1 个商品做测试准备，非代码故障；~~**不得再开第二个**~~【2026-09-19 作废，见 §2.10.2】，也不得公开上架」）。请二选一：

- **有意开启**（例如新增沙箱测试 SKU）→ 把该 SKU 写进白名单说明并更新上面那条常设规则；
  同时确认它满足「低价值 / 非共享 / 自动发货」，且**未公开上架**。
- **误开** → 立刻 `allow_guest_purchase = false` 关掉。按 §17 第 10 条，
  **回滚游客结账的正确方式是关开关，不是 DB 回滚，也不是 Vercel 回滚。**

**在用户确认之前**：`GUEST_SHOP_MAX_QUANTITY` 保持 **1**、`GUEST_SHOP_DISCOUNT_ENABLED` 保持 **OFF**、
`guest_shop_promo_budget` 保持 `enabled=false / daily_budget_cny=0`、熔断保持 `closed`。
Codex **不代为打开任何开关、不执行任何 SQL、不部署**。

#### 2.9.6 探针修复轮的变更与复跑证据（本机，2026-09-19）

| 文件 | 变更 |
|---|---|
| `supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql` | 22 → **23 行**，1279 → **1433** 行；新增 `fn_code`；第 16 行改机制断言；新增第 23 行 `operator_state_review`；文件头规则 3 扩写 + 规则 4 新增。**仍为单条只读语句**（libpg-query 解析：`statements: 1`） |
| `supabase/migrations/20260923_guest_shop_promo_l1l2.sql` | **只改 §9 运维注释**（23 行、第 1–22 行须 PASS、第 23 行 REVIEW 语义）。**DDL / 函数体 / CHECK / 索引 / 权限一行未动** |
| `tests/guest-shop-verify-probe-contract.test.js` | 11 → **19** 例（1103 行）。新增 §7「体探针必须剥注释」、§8「运维状态不得钉死」、「四个 verify 全部只读」、冻结行清单补到 **23** 个促销行名；顺带修掉 `password_hash` 用例约 **12%** 的偶发变红（注入确定性 `+` / `/`）。**×5 稳定，flake 用例 ×40 稳定** |
| `scripts/guest-shop-readiness.js` | 新增 **9** 条 `PROMO_VERIFY_REQUIREMENTS` + **3** 条 `PROMO_VERIFY_PROHIBITIONS`；修正 `promo-schema-applied` 文案（23 行 + REVIEW 语义） |
| `tests/guest-shop-readiness.test.js` | 28 → **29** 例（858 行）。促销 verify 篡改测试新增 **7** 个 fail-closed 变体 |

复跑读数（与 §2.2 / §2.3 一致）：

```text
node --test --test-force-exit tests/guest-shop-verify-probe-contract.test.js  →  tests 19  pass 19  fail 0
node --test --test-force-exit tests/guest-shop-readiness.test.js              →  tests 29  pass 29  fail 0
npm run test:security                                                        →  tests 3370 pass 3370 fail 0  EXIT=0
node scripts/guest-shop-readiness.js --json     →  checks 308  ok 308/308  invalid 0  warning 5  manual_review 20  ready false
node scripts/guest-shop-readiness.js --fail-on-invalid    →  EXIT 0
node scripts/guest-shop-readiness.js --fail-on-not-ready  →  EXIT 3   （预期的 fail-closed，禁止 || true 绕过）
```

#### 2.9.7 本轮踩到的一个**测试自身**缺陷（登记，不追猎）

篡改测试的 `no-review-row` 变体最初只替换了行名的**第一处**出现（`checks` CTE 里），
而最后的判分 `CASE` 里那一处没换 → 闸门仍然命中，**测试会假绿**。
修法：改为**全局替换**，并在每个变体后加 `assert.notEqual(tampered, realVerify, ...)`，
「篡改根本没生效」这种最危险的空转从此直接变红。同类纪律见 §2.7。

### 2.10 23 行 verify 复跑归档：第 1–22 行**全 PASS**，第 23 行 `operator_state_review` = **REVIEW**（用户已确认运维状态）

执行日 **2026-09-19**，执行人 **用户**（Codex 未执行任何 SQL）。复跑用的是 §2.9.6 升级后的 **23 行**版
`20260923_verify_guest_shop_promo_l1l2.sql`，**未重跑迁移** —— 落库版本与当前文件在 DDL / 函数体 / CHECK /
索引 / 权限上逐字等价（本轮迁移只改了 §9 运维注释）。用户回执：「验证结果符合预期」。

绝对路径（Codex 不执行，仅交付）：

[`/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql`](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql)

#### 2.10.1 复跑结果（原样登记）

```text
执行日：2026-09-19　执行人：用户　目标库：目标 Supabase（生产库，service_role 权限）
第 1–22 行：22 PASS / 0 FAIL
第 23 行 operator_state_review：REVIEW
第 23 行列出的游客商品：guest_products_enabled = 2
  · 52246f1d-b98d-4920-9129-581296f43de9「测试」   is_active=true  guest_skus=0
  · c16212d8-6ad8-4b3c-831c-3cc68b2d7a52「测试 2」 is_active=true  guest_skus=0
guest_skus_enabled = 0　guest_discount_codes_open = 0
用户确认：保留这 2 个游客商品（裁决见 §2.10.2）
```

与「绝不零元购」直接相关的四行 —— `orders_amount_check`(2)、`function_arity_single_overload`(9)、
`zero_purchase_guards`(12)、`promo_function_guards`(22) —— **复跑全部 PASS**。其中 (12) 首跑因探针缺陷假 FAIL
（§2.9.2，D-10 第 3 类），修复后本轮兑现为 PASS；第 16 行 `no_side_effects` 改为机制断言后亦 PASS（§2.9.3，
D-10 第 4 类）。**首跑的 20 PASS / 2 FAIL 归档（§2.9）保留不删**，作为探针纪律的实证锚点。

#### 2.10.2 第 23 行 REVIEW 的用户裁决（运维状态，非代码故障）

第 23 行 `operator_state_review` 输出 **REVIEW**（**不是** FAIL；语义见 §2.9.5 / `docs/guest-purchase-task-2.0.md` §60.5）。
用户于 **2026-09-19** 当面裁决，原文要点：

- **保留这 2 个游客商品**：均为本人手动开启的沙箱测试商品（「测试」「测试 2」），`is_active=true`、`guest_skus=0`、
  未公开上架。
- **关键澄清（推翻旧常设规则的「固定 1 个」前提）**：某商品是否属于游客商品，**取决于管理员在 Admin Studio
  里打开了哪个商品的游客开关**，是**动态、管理员可控**的，**既不是固定 1 个、也不是固定 2 个**。
  旧常设规则原文「用户已主动打开 1 个商品做测试准备……**不得再开第二个**，也不得公开上架」建立在
  「游客商品数恒为 1」的错误前提上。据此**作废其中的「计数上限（不得再开第二个）」这一句**，改为：
  「**游客商品数量由管理员开关决定，无固定上限；但每一个被打开的商品都必须满足低价值 / 非共享 / 自动发货，
  且未公开上架**」。**「不得公开上架」与三条资质要求原样保留。**
- **REVIEW 机制本身保留不删**：第 23 行继续逐次点名当前所有游客商品（而非只给计数），供每次复跑人工对账；
  这正是 1 → 2 增量当初被发现的机制（§2.9.5），不因数量上限作废而削弱。
- **技术护栏一条未弱化**：`GUEST_SHOP_MAX_QUANTITY` 仍为 **1**、`GUEST_SHOP_DISCOUNT_ENABLED` 仍为 **OFF**、
  `guest_shop_promo_budget` 仍 `enabled=false / daily_budget_cny=0`、熔断仍 `closed`；
  实测 `guest_skus_enabled=0`、`guest_discount_codes_open=0`。Codex **不代为打开任何开关、不执行任何 SQL、不部署**。

> 常设规则同步更新处（注解 / 取代而非删除，保留审计轨迹）：
> `docs/guest-purchase-task-2.0.md` 第 **202 / 659 / 678 / 733 / 782** 行、本文档 **§2.9.5**（第 569 行）。
> 各处均补「**2026-09-19 更新**：计数上限作废，数量由 Admin Studio 开关动态决定；资质三条与不得公开上架保留」。

#### 2.10.3 复跑后的失败处置规则（保留，供将来任何一次复跑沿用）

- 若第 1–22 行出现 FAIL：**不要**改迁移，先把该行 observed / expected 贴回来，按 §2.9 的方法判定是探针还是迁移。
- 若第 23 行为 REVIEW：按 §2.10.2 逐条核对列出的运维状态并签字确认；REVIEW **不是**失败。
- 本次复跑第 1–22 行 **0 FAIL**、第 23 行 **REVIEW 已由用户确认**，**§2.10 归档闭合**。

### 2.11 §9.5 黄金向量 parity 测试 + 配套只读 SQL 交付（readiness `promo-parity-evidence` 硬证据）

readiness 的 `promo-parity-evidence`（`scripts/guest-shop-readiness.js:1352`）要求：启用游客促销前，必须归档
**≥40 条黄金向量 parity 测试结果** + §15.4 沙箱实机证据。本轮交付**前者**（后者仍 **0/9**，§2.6），
因此该检查项**仅满足一半**，`ready` 仍为 **false**，**不得据此宣称完成或可启用**。

| 交付物 | 绝对路径 | 规模 | 实测状态（2026-09-19，本机） |
|---|---|---|---|
| parity 测试 | [`/Volumes/chao/AI/xianyu_profit_calculator/tests/guest-shop-pricing-parity.test.js`](/Volumes/chao/AI/xianyu_profit_calculator/tests/guest-shop-pricing-parity.test.js) | 380 行 / 9 例 / **74 条黄金向量**（A32·B10·C20·D12） | `node --test` **9 pass / 0 fail** |
| 配套只读 SQL | [`/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_verify_guest_shop_promo_parity.sql`](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_verify_guest_shop_promo_parity.sql) | 120 行 / **单条** `WITH...SELECT` / 32 条 group-A fixture | libpg-query `statements: 1`；注释外**无** INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE/GRANT/REVOKE |

> 黄金向量总数以测试自身计算为准：`UNIT(32) + SUBTOTAL(5) + ORDER_PAYABLE(5) + BREAKDOWN(20) + QUANTITY(12) = 74`，
> 测试用例「§9.5 黄金向量总数 ≥ 40」断言 `total >= 40`，实测 `GOLDEN_TOTAL=74`，远超规格线。

#### 2.11.1 权威边界（继承 `pricing.js` / `promo.js` 文件头红线，测试逐条固化）

- `resolveGuestCreditUnitAmount` 是 SQL `public.guest_shop_resolve_credit_unit_amount` 的**只读 JS 镜像**，
  只算「单价 / 列表价」（基础价、闪购、阶梯），**从不算折扣**；用例「红线：resolver 镜像从不算折扣——
  折扣类入参被完全忽略」直接断言：传入折扣类入参时镜像输出与不传时逐字相同。
- `buildGuestAmountBreakdown` 只把**数据库已返回**的金额整形为展示用 breakdown，任何缺失 / 零值 / 负值 /
  不自洽（`net + fee ≠ total`）的行一律 **fail-closed 返回 null**，绝不自行推算金额（group C 20 条向量覆盖）。
- 件数天花板：resolver `GUEST_QUANTITY_CEILING=99`、breakdown/order `GUEST_MAX_QUANTITY_CEILING=5`；
  越界 env 一律**降级到 1，绝不放大**（group D 12 条向量 + 红线用例「quantity 天花板与 SQL 边界一致（99）」）。
- 默认通道附加费 `0.01`，手续费 `roundUpMoneyAmount`（ceil）。

#### 2.11.2 防漂移：测试 ↔ SQL 同源

- 配套 SQL 由测试源码生成（脚本 `/tmp/gen_parity_sql.js`），group-A 的 VALUES 与 JS fixture **逐字一致**，
  32/32 expected 值与 JS 镜像相同；用例「§9.5 配套 SQL parity 文件存在且覆盖全部 group A fixture id」断言
  SQL 文件存在、含每一个 group-A id、且剥注释后无写关键字。
- `p_now` 两侧统一固定为 `'2026-09-14T12:00:00.000Z'`，闪购生效 / 过期完全由 fixture 决定，与真实时钟无关。
- resolver 已 `REVOKE FROM PUBLIC/anon/authenticated`、仅 `GRANT` 给 `service_role`，故配套 SQL 由用户在
  SQL Editor（service_role）执行；**Codex 不执行**。
- group B/C/D 依赖订单行 / 券行 / 买家身份等 DB 状态，无法只靠字面量在 DB 侧重放；其 DB 侧权威由
  §15.4 九项沙箱实机验证 + 23 行 verify 的 `zero_purchase_guards` / `promo_function_guards` 行覆盖，
  本测试只固化它们的 **JS 展示层 fail-closed** 行为。

#### 2.11.3 回归读数（本轮，2026-09-19，本机实测）

```text
node --test --test-force-exit tests/guest-shop-pricing-parity.test.js  →  tests 9  pass 9  fail 0
受影响的合同测试（probe-contract / readiness / 前端合同）              →  74 pass / 0 fail
npm run test:security                                                  →  tests 3379 pass 3379 fail 0  EXIT=0
node scripts/guest-shop-readiness.js --json     →  checks 308  ok 308/308  invalid 0  warning 5  manual_review 20  ready false
node scripts/guest-shop-readiness.js --fail-on-invalid    →  EXIT 0
node scripts/guest-shop-readiness.js --fail-on-not-ready  →  EXIT 3   （预期的 fail-closed，禁止 || true 绕过）
```

> 全量从 §2.9.6 的 **3370** 增至 **3379**（+9 = parity 测试 9 例），满足「pass 只增不减、fail 恒为 0」。
> **瞬时少计纪律（§2.7）**：本轮首跑曾报 `tests 3340`，第二次独立运行即恢复 `3379 / 3379 / 0 fail / EXIT=0`；
> 3340 属 §2.7 已登记的瞬时少计（异步用例在 `--test-force-exit` 下偶发未及登记），**以复跑后的 3379 为权威**，
> 不因首跑少计而追猎或改测试。
> `ready` 仍为 **false**：parity 证据已就位，但 §15.4 九项沙箱实机验证仍 **0/9**（§2.6），
> 故 `promo-parity-evidence` 仅满足「≥40 条黄金向量」一半，**不得据此宣称完成或可启用**。
### 2.12 C-D3/C-D4/C-D5 安全闸代码补充（2026-09-22）

前文 §2.6、§2.8 和 §23.5 记录的是 2026-09-19 促销批次当时尚未实现三道闸的历史快照；本节记录后续代码准备，不改写实机证据状态。

| 项目 | 当前状态 |
| --- | --- |
| C-D3 source-chain 库存占比 | `20260924_guest_shop_promo_safety_gates.sql` 已写入；按 `inventory_source_sku_id` 聚合 alias，product 级锁，物理 `reserve` hold 保守计入 |
| C-D4 联系哈希/IP 并发上限 | 已写入；`pending` / `created` / `review` 有效持仓单跨站点统一计数，2 笔上限 |
| C-D5 促销 TTL | 已写入；订单和 reservation 均受 600 秒硬上限，更新路径同样受延迟触发器保护 |
| 数据库落库 / verify | **11/11 `ok=true`**。用户已在目标 Supabase 运行只读 verify，Codex 未执行 SQL。逐行结果见 §2.13 |
| 实机并发、过期释放、支付与运营证据 | C-D4 拒绝半项的 HTTP 和库内回读已闭合（§2.15）。C-D3、过期物理释放、支付和运营证据仍未闭合。促销和多件开关继续关闭，`GUEST_SHOP_MAX_QUANTITY` 保持 1 |

工作树中的 `20260925_guest_shop_promo_gates.sql` 是未跟踪的另一份历史草稿，不在当前 readiness 或执行顺序内；不得与 20260924 迁移同时应用，也不得单独替代它。

### 2.13 目标库只读 verify（2026-09-22，11/11）

用户返回的只读结果与 `20260924_verify_guest_shop_promo_safety_gates.sql` 的 11 个 `check_name` 一致，全部 `ok=true`。这是 schema 事实，不是沙箱实机结论。§2.6 和沙箱手册里的历史 PARTIAL 行保持原样。

| check_name | ok | detail |
| --- | --- | --- |
| contact_index | true | open-contact index uses the global identity key |
| deferred_trigger | true | constraint trigger is deferred until transaction commit |
| function_security | true | prosecdef=true; search_path=public,pg_temp |
| ip_index | true | open-IP index uses the global identity key |
| open_order_guard | true | contact/IP open-order cap is present |
| promo_reservation_ttl_guard | true | discounted reservations cannot outlive the 600-second order deadline |
| reservation_deferred_trigger | true | reservation status and TTL updates are covered by the same deferred guard |
| stock_gate_function | true | C-D3/C-D4/C-D5 trigger function exists |
| stock_index | true | reservation source-snapshot stock-gate index exists |
| stock_ratio_guard | true | guest stock hold ratio rejects at 20 percent |
| ttl_hard_ceiling | true | discounted orders have a 600-second maximum TTL |

本节只归档 schema verify。当时尚未执行的实机并发、C-D3/C-D4 拒绝、过期释放、支付和运营证据，不因 11/11 写成 PASS。C-D4 拒绝半项的后续 HTTP 与库内回读见 §2.15，不回写本节。卡 7 继续是 PARTIAL。`GUEST_SHOP_MAX_QUANTITY` 保持 1，促销开关、预算和熔断保持关闭。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。


### 2.14 卡 7 拒绝半项预检（2026-09-22，未实机）

本步开始做卡 7 的拒绝半项，停在建单之前。本机 `127.0.0.1:8000` 没有 preview 在听。Codex 没有启动 preview，没有执行 SQL，没有部署，没有打开游客商品、促销或多件。历史 PARTIAL 不改写。

买家对 C-D3 和 C-D4 只会看到同一个对外码 `guest_promo_safety_limit`（HTTP 409，文案「当前游客购买较多，请稍后再试」）。内部细码 `guest_stock_hold_limit` / `guest_open_orders_limit` 留在服务端错误对象上，创建订单的响应不会带出，当前也没有单独日志。实机不能靠浏览器文案归因。

闸门公式是 `held * 100 >= total * 20`，`total = held + available`，只数 `is_shared = false` 的 source-chain 卡密。按这个公式：

- 非共享卡 ≤ 5 张：第一笔未付款单就会被 C-D3 拒绝。
- 6 到 10 张：第一笔可以通过，第二笔被 C-D3 拒绝。这时还没有第 3 笔，不能当成 C-D4。
- 单独证明 C-D4：至少 11 张非共享卡，同一联系人或同一 IP 连续建单。前两笔成功，第 3 笔拒绝，回滚后 probe 里仍只有 2 笔 held。
- 只有共享库存时 `total = 0`，C-D3 不拒绝。这种 SKU 不能用来证明 C-D3。

C-D5 才看优惠码和优惠金额。C-D3/C-D4 对原价、数量 1 的未付款游客单同样生效。目标库里闸门对象已经在，重新打开任何一个游客 SKU 都会撞上，即使促销开关仍然关着。

延迟约束触发器在事务提交时拒绝。创建订单 RPC 是一个事务，拒绝必须回滚订单和预占。接口报错之后如果多出 held 行，不能算通过。

本步没有改闸门函数，也没有把内部细码打进买家响应或日志。公开响应继续合并成一个码，避免被探测是库存闸还是身份闸。归因留给操作者的只读 probe。

卡 7 继续是 PARTIAL。`GUEST_SHOP_MAX_QUANTITY` 保持 1，促销开关、预算和熔断保持关闭。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。

### 2.15 卡 7 C-D4 HTTP 实机（2026-09-22，库内回读已闭合）

本地 preview 对「测试 2」`c16212d8-6ad8-4b3c-831c-3cc68b2d7a52` / `db8cc9bd-898a-49ff-adb4-cc07f94d7d8f` 的报价是原价 ¥144、数量上限 1、优惠关闭、凭证开关关闭。同一沙箱邮箱、原价、不付款连续建单：

- 201 `GS2026092203042062438815D6D1931`，优惠 ¥0，应付 ¥145.44，过期 `2026-09-22T03:34:20Z`。
- 201 `GS20260922030428167558C70FFF67A`，优惠 ¥0，应付 ¥145.44，过期 `2026-09-22T03:34:28Z`。
- 409 `guest_promo_safety_limit`，没有订单号。

用户在 2026-09-22 11:10（Asia/Shanghai）前跑了 `supabase/sandbox/S154_cd4_reject_readback.sql` 段 4，八项全是 `true`。库内是同一联系人、同一 IP、两笔原价未付款 held、没有第三笔、正好两张预占。非共享可用卡在建单前是 41，两笔占不到 20%。第三笔 409 `guest_promo_safety_limit` 因此归因到 C-D4，不是 C-D3。C-D4 拒绝半项闭合。

这仍不是卡 7 PASS。C-D3 没做。两笔原过期点是 11:34:20 和 11:34:28.167897（北京时间），物理释放还没回读。过期后不要重跑旧段 4。只读脚本是 `supabase/sandbox/S154_cd4_expiry_readback.sql`；未到当前 `expires_at` 时「仍在 TTL 内」不是失败。2026-09-22 11:34（Asia/Shanghai）提前脚本报「已经提前过了」并中止，没有改任何行。第二笔库内截止是 `2026-09-22 03:34:28.167897+00`，整秒字面量对不上，「仍在未来 3 分钟内」被误当成已提前。同一次过期回读差 9 秒，`seconds_until_later_expiry=9`、`within_ttl_expected=true`，安全项全是 true，不是失败。11:35 之后的过期回读段 6 已闭合：`both_expired=true`，`clock_layer_closed=true`，`release_layer_closed=true`，`both_reservations_released=true`，`both_inventory_available=true`，`cd3_stale_hold_count=0`，`cd4_contact_open_count=0`，`cd4_ip_open_count=0`，`seconds_until_later_expiry=-429`。原价、数量 1、未付款、未发货、无支付确认、无券台账、无第三笔仍全是 true。时钟层和物理释放都已闭合。这仍不是卡 7 PASS，因为 C-D3 还没做。不要在「测试」或「测试 2」上硬做 C-D3，164 张和 41 张都远低于 20% 的可观测区间，也不要改库存状态去凑 5 到 10 张。2026-09-22 预检已跑完：29 行，`use_for_cd3=true` 为 0。不要把那份预检当当前步骤重跑。2026-09-22 缺口脚本已跑完：五行，`only_switch_missing` 全部是 false。详见 `docs/guest-shop-promo-evidence.md` §2.18。不要重跑缺口脚本，不要写启用 SQL，不要建单，不要上架，不要开游客开关。真实商品和名称含「测试请勿兑换」的不要打开。这两笔的时钟层和物理释放都已闭合，库存已回到 `available`，不再占用 C-D3。不要为了做 C-D3 去压「测试」或「测试 2」的库存。没有付款，没有改数量或促销开关，没有部署，Codex 没有执行 SQL。卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。


### 2.16 卡 7 C-D4 过期释放回读（2026-09-22，已闭合）

提前脚本没有改这两笔。第二笔库内截止保持 `2026-09-22 03:34:28.167897+00`。截止前 9 秒的回读是「仍在 TTL 内」，不是失败。截止后的段 6：

| 字段 | 结果 |
|---|---|
| both_orders_present / both_expired | true / true |
| both_original_price_qty1 / both_unpaid / both_unfulfilled | true / true / true |
| no_payment_confirmation / no_discount_ledger / no_third_order | true / true / true |
| cd4_contact_open_count / cd4_ip_open_count | 0 / 0 |
| clock_layer_closed | true |
| both_reservations_released / both_inventory_available | true / true |
| release_layer_closed | true |
| cd3_stale_hold_count / cd3_stale_hold_present | 0 / false |
| seconds_until_later_expiry | -429 |
| readback_note | 时钟层和物理释放都已闭合。卡 7 仍是 PARTIAL，因为 C-D3 还没做。 |

C-D4 的拒绝半项和 TTL 物理释放都已闭合。卡 7 继续 PARTIAL。不要重跑旧拒绝回读，不要再跑提前脚本，不要付款，不要在这两笔上做 C-D3。`GUEST_SHOP_MAX_QUANTITY` 保持 1。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。


### 2.17 卡 7 C-D3 预检负结果（2026-09-22，未建单）

本节取代 §2.15 里「下一步只跑预检」的说法。用户已经执行 `supabase/sandbox/S154_cd3_preflight_readonly.sql`。Codex 没有执行 SQL。返回 29 行，`use_for_cd3=true` 为 0。没有建单，没有改库存，没有打开游客开关，没有付款。

那一版 `preflight_note` 把所有 `guest_ready=false` 都写成「游客通道没开」。这过宽：同一行还可能是商品或 SKU 下架、人工发货，或 CN 单价为空。不能据此打开任何开关。预检脚本已按六个条件拆开备注。当前步骤不必为了改备注重跑预检。

只有两行 `guest_ready=true`，都不能证明 C-D3：

| 商品 / SKU | product_id / sku_id | 非共享可用 | 结论 |
|---|---|---|---|
| 测试 2 / 测试 | `c16212d8-6ad8-4b3c-831c-3cc68b2d7a52` / `db8cc9bd-898a-49ff-adb4-cc07f94d7d8f` | 41 | 同一联系人会先撞 C-D4 |
| 测试 / 默认规格 | `52246f1d-b98d-4920-9129-581296f43de9` / `cc5d1ea9-83db-4c88-8fa8-fe7040c7c80d` | 164 | 同一联系人会先撞 C-D4 |

名称含「测试」、非共享 total 在 1 到 5、但 `guest_ready=false` 的有五行。预检当时没有给出各自失败原因。失败原因已在 §2.18 拆开，下表只保留预检时的身份，不要再把它读成「原因未知」：

| 商品 / SKU | 单价 | total | product_id / sku_id |
|---|---|---|---|
| 测试 / 人工 | 2.00 | 1 | `690fd7f1-090d-4ffe-a5c3-88bf674fba7f` / `a93915ae-3f88-4cb3-8e89-aa832b4e5028` |
| 测试 / 默认规格 | 1.00 | 3 | `690fd7f1-090d-4ffe-a5c3-88bf674fba7f` / `2a6a27c0-953d-49b9-a421-0d84f6be7021` |
| 测试规格 / 默认规格 | 2.00 | 3 | `d2e832c8-f7c0-4a07-b492-6ed5e7e9d7ff` / `16d29e7d-22f4-4bf7-9cde-b6c8e59b9da1` |
| 测试请勿兑换 / 7米 | 6.00 | 3 | `875cdf10-cb5b-4f7f-baae-b747e318a8c3` / `da4fef2d-83c3-40e6-98ba-e6fc3986dc07` |
| 测试规格 / 测出 | 12.00 | 4 | `d2e832c8-f7c0-4a07-b492-6ed5e7e9d7ff` / `23078131-0af7-4d70-814c-e693c4021fd8` |

「测试请勿兑换」不要打开。上面两个都叫「测试」的商品不是同一条：¥0.01、164 张那条是 `52246f1d-b98d-4920-9129-581296f43de9`；¥1 / ¥2、total 1 和 3 那条是 `690fd7f1-090d-4ffe-a5c3-88bf674fba7f`。不要把开关开到 164 张那条上。

同一份结果里，非共享 total 在 1 到 5 的真实商品不进缺口脚本，也不是候选：Gemini Pro 3 个月 / 3 个月成品号，小火箭 / 美区，小火箭 / 已开通 icloud，【租借】Appstore 软件下载 / 美区，Apple id / 尼日利亚，Apple id / 日本，纪念碑谷1+2 / 永久维护，美国苹果ID已开通iCloud / 美区。6 到 10 张的行若被打开，第一笔会真占 1 张，其中有 Apple id、Tiktok、租借，也有「测试请勿兑换 / 3米」。不要为了凑 5 到 10 张去改库存状态。

本节记录的是预检当时还没拆开的五行。2026-09-22 缺口脚本已经跑完，五行失败原因和 `only_switch_missing=false` 见 §2.18。不要重跑预检，也不要把缺口脚本当当前步骤重跑。不要写启用 SQL，不要建单。

卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `20260925_guest_shop_promo_gates.sql`。


### 2.18 卡 7 C-D3 缺口已拆开（2026-09-22，未建单）

本节取代 §2.15 和 §2.17 里「下一步只跑缺口脚本」的说法。用户已经执行 `supabase/sandbox/S154_cd3_gap_readonly.sql`。Codex 没有执行 SQL。返回 5 行。`guest_ready` 全部是 false，`only_switch_missing` 全部是 false。没有建单，没有上架，没有打开游客开关，没有改库存，没有付款。

五行的共同状态：`product_active=false`，`sku_active=true`，`product_allow_guest=false`，`sku_allow_guest` 是空，所以 `effective_guest=false`。`delivery_type=KEY`，`price_ok=true`，`guest_held_reserve=0`。SKU 游客开关是空，生效开关继承商品级关闭。

| 商品 / SKU | 单价 | total | 失败条件 | only_switch_missing | product_id / sku_id |
|---|---|---|---|---|---|
| 测试 / 人工 | 2.00 | 1 | 商品未上架、游客开关关闭、SKU 人工发货 | false | `690fd7f1-090d-4ffe-a5c3-88bf674fba7f` / `a93915ae-3f88-4cb3-8e89-aa832b4e5028` |
| 测试 / 默认规格 | 1.00 | 3 | 商品未上架、游客开关关闭 | false | `690fd7f1-090d-4ffe-a5c3-88bf674fba7f` / `2a6a27c0-953d-49b9-a421-0d84f6be7021` |
| 测试规格 / 默认规格 | 2.00 | 3 | 商品未上架、游客开关关闭 | false | `d2e832c8-f7c0-4a07-b492-6ed5e7e9d7ff` / `16d29e7d-22f4-4bf7-9cde-b6c8e59b9da1` |
| 测试规格 / 测出 | 12.00 | 4 | 商品未上架、游客开关关闭 | false | `d2e832c8-f7c0-4a07-b492-6ed5e7e9d7ff` / `23078131-0af7-4d70-814c-e693c4021fd8` |
| 测试请勿兑换 / 7米 | 6.00 | 3 | 商品未上架、游客开关关闭、商品和 SKU 都人工发货 | false | `875cdf10-cb5b-4f7f-baae-b747e318a8c3` / `da4fef2d-83c3-40e6-98ba-e6fc3986dc07` |

「测试请勿兑换」不要打开，也不要逐项补它缺的条件。

商品级上架和商品级游客开关会作用到同一商品的全部 SKU：

- `690fd7f1-090d-4ffe-a5c3-88bf674fba7f` 上有两行。「人工」还卡在 SKU 人工发货；「默认规格」只差商品上架和商品级游客开关。打开这一层，会让 ¥1、total 3 的「默认规格」变成 `guest_ready`，人工发货那行仍然不是。
- `d2e832c8-f7c0-4a07-b492-6ed5e7e9d7ff` 上两行都只差商品上架和商品级游客开关。打开这一层，total 3 和 total 4 两行都会变成 `guest_ready`。
- 不要开到已开通的 ¥0.01 商品 `52246f1d-b98d-4920-9129-581296f43de9`。那条有 164 张，同一联系人会先撞 C-D4。

total 在 1 到 5 且当前 held 为 0 时，第一笔就应 409，闸门正常时不占卡。这只在该 SKU 已经 `guest_ready` 之后才测得出来。现在没有任何一行是。

停。没有明确指定某一个测试 SKU，并接受该商品需要上架、游客开关目前是商品级关闭之前，不要写启用 SQL，不要建单，不要上架，不要改库存。真实商品仍然不是候选。6 到 10 张的行一旦打开，第一笔会真占 1 张，也不要为了凑这个区间去改库存状态。

卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `20260925_guest_shop_promo_gates.sql`。


### 2.19 卡 7 C-D3 专用商品待确认（2026-09-22，未建单）

本节取代 §2.18 末尾「停。没有明确指定某一个测试 SKU」。用户不改现有五行，也不压「测试」或「测试 2」的库存。专用商品名正好是「沙箱CD3」。2026-09-22 用户声明已在 Admin Studio 建好。当时 Codex 没有执行 SQL，确认结果还没贴回。确认和 HTTP 结果见 §2.20。不要按本节再跑确认 SQL。

当时的现行步骤是只跑 `supabase/sandbox/S154_cd3_fixture_confirm_readonly.sql`。全文一条 SELECT，期望正好 1 行，不输出卡密、联系人、IP、凭证或订单号。通过条件是 `confirm_verdict` 以「确认通过」开头，并且：

- `product_count = 1`，`sku_count = 1`，`guest_ready = true`
- `price_points = 3.00`，`zpay_only = true`，`effective_guest_qty = 1`
- `nonshared_available = 5`，`guest_held_reserve = 0`，`cd3_total = 5`
- `shared_rows = 0`，`nonshared_other = 0`，`source_only_self = true`
- `product_stock_count = 5`，`sku_stock_count = 5`，`existing_guest_orders = 0`

没通过时看 `failed_conditions` 和 `near_miss_names`，只改这一件商品。不要建单，不要付款，不要开券，不要改 `GUEST_SHOP_MAX_QUANTITY`。5 张非共享库存时，闸门在提交时把新预占计入 held：`1 * 100 >= 5 * 20`，第一笔就应 409。1 到 4 张也会拒绝，但不是这条边界；6 张或更多会让第一笔真占库存。`is_shared = true` 不进占比。

卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。
### 2.20 卡 7 C-D3 HTTP 已拒绝（2026-09-22，回读已由 §2.21 闭合）

本节取代 §2.19 的「确认结果还没贴回」。用户贴回确认行，`confirm_verdict` 以「确认通过」开头。Codex 没有执行 SQL。

商品 `沙箱CD3` / SKU `默认规格`：`c373b8b7-ebce-4709-b8d4-c192abd36869` / `f928599e-30e8-4b3e-aa86-34ec09e2d659`。CN 单价 3.00，`guest_ready=true`，通道只 `["zpay"]`，`effective_guest_qty=1`，`max_purchase_quantity=1`。非共享 available=5，held=0，`cd3_total=5`，共享行 0，其他状态 0，`source_only_self=true`。商品和规格 `stock_count` 都是 5，既有游客订单 0，`nonshared_by_status` 为 `{"available":5}`，`failed_conditions` 为空。

随后只打了一笔。preview 200，金额 3 CNY，数量 1，`quantity_cap=1`，`discount_enabled=false`，`buyer_credential_required=false`，通道只有 `zpay`。prepare 200。commit 409 `guest_promo_safety_limit`，文案「当前游客购买较多，请稍后再试」，没有订单号，没有付款。时间 2026-09-22 12:42（Asia/Shanghai）。站点 cn，provider `zpay`，channel `alipay`，无优惠码，联系邮箱 `cd3-boundary-20260922@sandbox.invalid`。打完后本地 preview 已停。

公开码同时覆盖 C-D3 和 C-D4。回读已贴回，闭合记录见 §2.21。不要重跑 `supabase/sandbox/S154_cd3_reject_readback.sql`，不要第二笔，不要付款，不要重跑确认、预检、缺口脚本或 C-D4 回读。

卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `20260925_guest_shop_promo_gates.sql`。

### 2.21 卡 7 C-D3 拒绝回读已闭合（2026-09-22，游客开关已由 §2.22 闭合）

本节取代 §2.20 的「回读未贴回」。用户贴回 `supabase/sandbox/S154_cd3_reject_readback.sql`，正好 1 行。Codex 没有执行 SQL。

`target_present=true`。商品「沙箱CD3」/ 规格「默认规格」，`c373b8b7-ebce-4709-b8d4-c192abd36869` / `f928599e-30e8-4b3e-aa86-34ec09e2d659`，`price_points=3.00`。`guest_orders_on_product=0`，`payment_orders_on_product=0`，`reservations_on_product=0`。`nonshared_available=5`，`guest_held_reserve=0`，`shared_rows=0`，`nonshared_other=0`。商品和规格 `stock_count` 都是 5。`live_open_guest_orders=0`。

`readback_verdict`：C-D3 拒绝可归因。没有订单，5 张仍 available，全库未过期未付款 held 少于 2，C-D4 不可能先触发。不要再试，不要付款。测完关掉这件商品的游客开关。

C-D4 要同一联系人哈希或同一 IP 哈希上已有至少 2 笔未过期未付款 held。全库为 0，所以 12:42 那笔 HTTP 409 归因到 C-D3，并且事务已回滚。C-D3 拒绝半项闭合。这是原价、无券、无预算消耗，不能代替卡 7 里促销单 TTL 后库存与预算同时归还。历史偏差格和标题继续 PARTIAL，不得改写成整卡 PASS。

当时的现行步骤已经完成，整行见 §2.22。不要再关一次，也不要重跑开关回读。当时只关这一件商品的游客开关：Admin Studio 打开「沙箱CD3」，取消「允许游客购买」并保存。规格上的游客开关如果单独勾着，也要取消。不要写关闭 SQL。关完后只跑 `supabase/sandbox/S154_cd3_switch_off_readonly.sql`。`switch_verdict` 以「游客开关已关」开头才算完成。拒绝回读不看开关，所以开关在那次贴回时仍是开的，中文游客商城当时仍能看到 ¥3。商品若仍上架，登录积分商城可能还能看到这 5 张；本步不要求下架。

不要重跑回读，不要第二笔，不要付款，不要改库存。`GUEST_SHOP_MAX_QUANTITY` 保持 1。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。


### 2.22 卡 7「沙箱CD3」游客开关已关（2026-09-22）

本节取代 §2.21 的「游客开关仍待关」。用户贴回 `supabase/sandbox/S154_cd3_switch_off_readonly.sql`，正好 1 行。Codex 没有执行 SQL。`switch_verdict` 以「游客开关已关」开头。

`target_present=true`。商品「沙箱CD3」/ 规格「默认规格」，`price_points=3.00`。`product_active=true`，`sku_active=true`。`product_allow_guest=false`，`sku_allow_guest` 为空，`effective_guest=false`，`guest_switch_off=true`。`guest_orders_on_product=0`，`payment_orders_on_product=0`，`reservations_on_product=0`。`nonshared_available=5`，`guest_held_reserve=0`，`shared_rows=0`，`nonshared_other=0`。商品和规格 `stock_count` 都是 5。

`switch_verdict`：游客开关已关。商品仍上架，登录积分商城可能还能看到这 5 张。本步不要求下架。不要再打开游客开关，不要建单，不要付款。

开关回读不输出 id。脚本按已确认的 `c373b8b7-ebce-4709-b8d4-c192abd36869` / `f928599e-30e8-4b3e-aa86-34ec09e2d659` 定位，商品名、规格名和单价都没变。有效开关是 `COALESCE(sku.allow_guest_purchase, product.allow_guest_purchase, false)`。商品级已关，规格级为空，游客结算进不去。

游客开关关闭闭合。这仍是原价、无券、无预算消耗，不能代替促销单 TTL 后库存与预算同时归还。卡 7 标题和历史偏差格继续 PARTIAL，不得改写成整卡 PASS。不要回写 §2.6 的九项历史表。

不要重跑开关回读、拒绝回读、确认、预检、缺口脚本、C-D4 回读或提前脚本。不要第二笔，不要付款，不要开券，不要改库存，不要再打开这件商品的游客开关。「沙箱CD3」不开工促销。促销 TTL 归还的现行步骤见 §2.23，不能复用这件 5 张的「沙箱CD3」。`GUEST_SHOP_MAX_QUANTITY` 保持 1。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。


### 2.23 卡 7 促销 TTL 归还：先确认「沙箱CD7」（2026-09-22，未建单）

本节取代 §2.22 的「不开工促销」。只开工确认，不开工建单。Codex 没有执行 SQL。卡 7 继续 PARTIAL，不得改写成整卡 PASS。不要回写 §2.6 的九项历史表。

不能复用「沙箱CD3」。5 张会让第一笔被 C-D3 拒绝，而且那次没有券、没有预算消耗。也不能改库存去凑，也不能把「测试」「测试 2」拿来用。

现行步骤是先在 Admin Studio 新建「沙箱CD7」，再建好后只跑 `supabase/sandbox/S154_cd7_fixture_confirm_readonly.sql`。全文一条 SELECT。通过判语必须以「确认通过」开头。确认通过前不要下单，不要付款。

规格：正好一个默认规格；KEY、自动发货；商品上架；只开商品级游客开关，规格级留空；通道只开 ZPay；CN 单价正好 10.00；游客单次上限 1；无限购或限购 1；无秒杀、无阶梯价；库存来源只有规格自己；非共享 available 正好 6；held 为 0；无共享行和其他状态；两级 `stock_count` 都是 6；无既有游客订单。

6 张时第一笔预占后 `1*100 < 6*20`，过 C-D3。第二笔 `2*100 >= 6*20`，被 C-D3 拒绝。11 张会让第二笔也过闸，不要做成 11 张。确认通过后仍只能准备 1 笔，本步连这一笔也不建。

券复用 `SBXPROMO10`：percent、结算比例 90、游客余量至少 1 次且至少 ¥1.00、共享次数不限、无人群包、非互斥。抵扣 ¥1.00，商品净额 ¥9.00。不要跑 `S154_fixture_setup.sql`。CN 预算须能覆盖这 ¥1.00，intl 预算保持关闭，熔断保持 closed。「沙箱CD3」游客开关必须仍关。

上架并打开游客开关后，中文游客商城会公开看到 ¥10。优惠环境开关没开时，原价仍能买走这 6 张。不要打开生产 `GUEST_SHOP_DISCOUNT_ENABLED`。`GUEST_SHOP_MAX_QUANTITY` 保持 1。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。

确认行已在 2026-09-22 贴回。随后的 500 见 §2.24，回读见 §2.25。不要再跑本确认。

### 2.24 卡 7「沙箱CD7」确认通过，促销 commit 返回 500（2026-09-22，回读已由 §2.25 闭合）

本节取代 §2.23 的「确认通过前不要下单」。用户贴回 `supabase/sandbox/S154_cd7_fixture_confirm_readonly.sql`，正好 1 行，`confirm_verdict` 以「确认通过」开头。Codex 没有执行 SQL。卡 7 继续 PARTIAL，不得改写成整卡 PASS。不要回写 §2.6 的九项历史表。

商品「沙箱CD7」/ 规格「默认规格」，`5f940176-8059-443a-b5fd-79adc883a810` / `c955f03a-8cd6-44b8-b751-06e2ad66d4cd`，`price_points=10.00`。`guest_ready=true`，商品级游客开关开，规格级为空，`effective_guest=true`。非共享 available=6，held=0，共享行 0，其他状态 0，`cd7_total=6`，`source_only_self=true`，通道只 `["zpay"]`。游客单次上限 1，限购 1，既有游客订单 0，两级 `stock_count` 都是 6。`one_hold_under_20=true`，`second_hold_hits_cd3=true`。券 `SBXPROMO10` 是 percent、结算比例 90，预期抵扣 ¥1.00，商品净额 ¥9.00，不是脏券。CN 日预算 20.00，已用 0.00，剩余 20.00，熔断 closed。intl 预算关闭。「沙箱CD3」游客开关仍关。`failed_conditions` 为空。

随后只打了 1 笔不付款促销单。preview 200，金额 10 CNY，数量 1，`quantity_cap=1`，`discount_enabled=true`，`buyer_credential_required=true`，通道只有 `zpay`。prepare 200。commit 500 `guest_shop_request_failed`，文案「游客购买请求失败」，没有订单号。时间 2026-09-22 14:06（Asia/Shanghai）。站点 cn，provider `zpay`，channel `alipay`，券 `SBXPROMO10`，联系邮箱 `cd7-ttl-20260922@sandbox.invalid`。没有第二笔，没有付款。本地 preview 已停。生产折扣开关没有打开。

公开 500 不区分 `guest_discount_amount_invalid`、`guest_invalid_order_ttl`、`guest_promo_order_ttl_invalid` 和未映射的 `P0001`。响应里没有内部码。这不是成功单，也不是卡 7 闭合。

当时的现行步骤已经完成，整行见 §2.25。不要再跑 `supabase/sandbox/S154_cd7_commit_probe_readonly.sql`。当时这份回读是全文一条 SELECT。贴回的 `readback_verdict` 以「没有留下订单」开头，所以不要直接重跑建单。以「已留下 1 笔未付款促销单」开头或其他判语都不是这次的结果。

不要重跑确认、CD3 开关/拒绝/确认、预检、缺口、C-D4 回读或提前脚本。不要付款，不要改库存，不要开生产折扣。`GUEST_SHOP_MAX_QUANTITY` 保持 1。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。


### 2.25 卡 7 促销 commit 回读：没有留下订单（2026-09-22，时钟默认值当时待验证）

本节取代 §2.24 的「回读未贴回」。用户贴回 `supabase/sandbox/S154_cd7_commit_probe_readonly.sql`，正好 1 行。Codex 没有执行 SQL。卡 7 继续 PARTIAL，不得改写成整卡 PASS。不要回写 §2.6 的九项历史表。 三行时钟验证已经贴回，现行记录见 §2.26。下面保留当时还没验证时的门，不要再跑迁移或验证。

`target_present=true`。商品「沙箱CD7」/ 规格「默认规格」，`5f940176-8059-443a-b5fd-79adc883a810` / `c955f03a-8cd6-44b8-b751-06e2ad66d4cd`，`price_points=10.00`。`guest_orders_on_product=0`，`orders_after_attempt=0`，`live_unpaid_holds=0`。`paid_like_orders=0`，`discounted_orders=0`，`discount_amount_sum=0`。支付订单、预占、held、released 都是 0。`nonshared_available=6`，`guest_held_reserve=0`，商品和规格 `stock_count` 都是 6。券核销、未归还台账、已归还台账都是 0。`coupon_count=1`，`guest_used_count=0`，`guest_discount_total=0.00`，`cn_effective_spent=0.00`。`newest_*` 全部是 null。

`readback_verdict` 以「没有留下订单」开头。完整判语：没有留下订单。6 张仍 available，券计数和当日预算仍是 0。这不是成功单，也不要当成卡 7 闭合。不要自行重试，不要付款。

2026-09-22 14:06（Asia/Shanghai）那笔公开 500 因此可以归因到提交前失败。内部码是 `guest_promo_order_ttl_invalid`，映射表把它收成 `guest_shop_request_failed`。不要翻日志原文。

根因是两只时钟。`created_at` 的列默认值仍是 `NOW()`，也就是事务开始时刻。建单函数用 `clock_timestamp()` 做 `v_now`，`expires_at` 和预占 `reserved_until` 都是 `v_now` 加 TTL。有券时 TTL 正好 600 秒，而 20260924 延迟触发器不允许促销单的 `expires_at` 或 `reserved_until` 晚于 `created_at + 600 seconds`。函数入口比事务起点晚，所以正好 600 秒一定越界。异常回滚后库里什么都不留。

`guest_invalid_order_ttl`、`guest_discount_amount_invalid`、C-D3 和 C-D4 都对不上这次的 500 和零订单。percent 90 仍是付 90%，¥10 抵扣 ¥1、净额 ¥9。不要改券，不要把 600 改成 599。

修复文件是 `supabase/migrations/20260926_guest_shop_promo_ttl_clock.sql`，只有 `ALTER TABLE public.guest_shop_orders ALTER COLUMN created_at SET DEFAULT clock_timestamp();`。不改旧行，不替换 20260923 的建单函数。不要应用 `20260925_guest_shop_promo_gates.sql` 来代替。

现行步骤：先跑上面的迁移，再跑 `supabase/migrations/20260926_verify_guest_shop_promo_ttl_clock.sql`。期望 3 行且全部 `ok=true`：`created_at_default`、`create_order_omits_created_at`、`create_order_uses_clock_timestamp`。第一行 detail 若是 `now()`，说明迁移还没执行，不是脚本损坏。验证通过前不要建单，不要付款。

验证通过后才考虑最多 1 笔原参数促销 commit。本步不要打。6 张里最多 1 笔未付款预占。生产折扣保持关闭，商品仍公开标价 ¥10，原价仍可能被买走。`GUEST_SHOP_MAX_QUANTITY` 保持 1。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。


### 2.26 卡 7 时钟默认值已验证（2026-09-22，下一笔尚未建单）

本节取代 §2.25 的「时钟默认值待验证」。用户贴回 `supabase/migrations/20260926_verify_guest_shop_promo_ttl_clock.sql`，正好 3 行，全部 `ok=true`。Codex 没有执行 SQL。

| check_name | ok | detail |
| --- | --- | --- |
| created_at_default | true | clock_timestamp() |
| create_order_omits_created_at | true | 15-arg INSERT omits created_at |
| create_order_uses_clock_timestamp | true | v_now is clock_timestamp and expires_at adds p_ttl_seconds |

`supabase/migrations/20260926_guest_shop_promo_ttl_clock.sql` 已生效。新行 `created_at` 默认是 `clock_timestamp()`。15 参建单函数仍不写 `created_at`，`v_now` 仍是 `clock_timestamp()`，`expires_at` 仍加 `p_ttl_seconds`。不要重跑这两份 SQL。

这只证明默认值。14:06 那笔仍没有留下订单，当时的内部码是 `guest_promo_order_ttl_invalid`。验证不等于留下订单。下一笔还没打，尚未建单。卡 7 继续 PARTIAL，不得改写成整卡 PASS。不要回写 §2.6 的九项历史表。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

持有回读是 `/Volumes/chao/AI/xianyu_profit_calculator/supabase/sandbox/S154_cd7_promo_hold_readback.sql`。建单前先跑一次，以「还没有这 1 笔」开头不是失败。建单后 600 秒内再跑，以「持有已闭合」开头才算这半步。过点但仍 held 不是归还失败。

到期回读是 `/Volumes/chao/AI/xianyu_profit_calculator/supabase/sandbox/S154_cd7_promo_expiry_readback.sql`。未到 `expires_at` 不是失败，判语以「仍在 TTL 内」开头。不要提前截止时间。两边都归还时以「归还已闭合」开头，同时仍不是整卡 PASS。只归还一边是泄漏。两边都还没释放是 worker 还没跑，不是失败，不要手工改行。

不要付款，不要开生产折扣。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `20260925_guest_shop_promo_gates.sql`。「沙箱CD3」游客开关保持关闭。「沙箱CD7」仍公开标价 ¥10。

### 2.27 卡 7 留下 1 笔未付款促销单（2026-09-22，持有回读还没贴回）

本节取代 §2.26 的「下一笔尚未建单」。§2.26 保留时钟验证当时的记录。不要回写 §2.6。

2026-09-22 15:34（Asia/Shanghai）基线回读已贴回，判语以「还没有这 1 笔」开头。随后只打了 1 笔未付款促销单，commit HTTP 201，订单号 `GS2026092207342938190F2B83D5ACF`。数量 1，标价 10.00，抵扣 1.00，商品净额 9.00，通道费 0.09，应付 9.09，券 `SBXPROMO10`。响应 `expires_at` 是 `2026-09-22T07:44:29.38158+00:00`（北京时间 15:44:29）。本地 preview 已停。生产 `GUEST_SHOP_DISCOUNT_ENABLED` 没有打开，也没有把 Node 的 600 改成 599。持有回读还没贴回，这不是持有闭合，也不是整卡 PASS。请立刻重跑 `supabase/sandbox/S154_cd7_promo_hold_readback.sql`。不要再打第二笔，不要付款，不要提前截止时间。

持有回读是 `/Volumes/chao/AI/xianyu_profit_calculator/supabase/sandbox/S154_cd7_promo_hold_readback.sql`。以「持有已闭合」开头才算这半步。到期回读是 `/Volumes/chao/AI/xianyu_profit_calculator/supabase/sandbox/S154_cd7_promo_expiry_readback.sql`。未到 `expires_at` 不是失败。不要提前截止时间。卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

### 2.28 卡 7 持有回读已闭合（2026-09-22，到期回读还没贴回）

本节取代 §2.27 的「持有回读还没贴回」。不要回写 §2.6。

2026-09-22 持有回读已贴回，判语以「持有已闭合」开头。订单 `GS2026092207342938190F2B83D5ACF`，`created_at` `2026-09-22 07:34:29.534068+00`，`expires_at` `2026-09-22 07:44:29.38158+00`，`ttl_seconds` 599.848。大于 590 且不超过 600，通过。差出的 0.152 秒是 `created_at` 默认值略晚于 `v_now`，不要把 Node 的 600 改成 599。数量 1，站点 cn，未付款，未发货，抵扣 1.00，商品净额 9.00，通道费 0.09，应付 9.09，券 `SBXPROMO10`。非共享 available 5，游客 held 1，券两处计数和当日预算都是 1.00。`product_stock_count` 与 `sku_stock_count` 从 6 变为 5，是预占后的可售数，加上 held 仍是 6，不是丢卡。这只闭合持有半步。卡 7 继续 PARTIAL，不得改写成整卡 PASS。不要回写 §2.6。到期后再跑 `supabase/sandbox/S154_cd7_promo_expiry_readback.sql`。未到 `expires_at` 不是失败。两边都还没释放是 worker 还没跑，不是失败，不要手工改行。不要付款，不要再打第二笔，不要提前截止时间。

到期回读是 `/Volumes/chao/AI/xianyu_profit_calculator/supabase/sandbox/S154_cd7_promo_expiry_readback.sql`。未到 `expires_at` 不是失败。卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。


### 2.29 卡 7 促销到期归还已闭合（2026-09-22，游客开关还没关）

本节取代 §2.28 的「到期回读还没贴回」。不要回写九项历史表（§2.6）。

2026-09-22 到期回读已贴回，判语以「归还已闭合」开头。订单 `GS2026092207342938190F2B83D5ACF`，`seconds_until_expiry` -128.353。预占 `released`，释放原因 `expired`，库存回到 `available`。非共享 available 6，游客 held 0，两级 `stock_count` 都回到 6。持有期间的 5 是可售数，不是丢卡。券 `guest_used_count`、`coupon_used_count`、`guest_discount_total` 都回到 0，`returned_redemptions=1`，`open_redemptions=0`。`cn_budget_is_today=true`，`cn_effective_spent=0.00`。`inventory_returned=true`，`budget_returned=true`。三处付款类计数都是 0。生产 worker 已经释放，没有手工改行。

订单行仍记着抵扣 1.00、应付 9.09，`payment_status=pending`。不要把订单行改成 0，也不要付款。这只闭合归还半步。卡 7 继续 PARTIAL，不得改写成整卡 PASS。

「沙箱CD7」游客开关还没关。下一步只在 Admin Studio 取消这一件的「允许游客购买」，再跑 `supabase/sandbox/S154_cd7_switch_off_readonly.sql`。`switch_verdict` 以「游客开关已关」开头才算完成。不要付款，不要再打一笔，不要下架，不要开生产折扣。「沙箱CD3」游客开关保持关闭。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。


### 2.30 卡 7「沙箱CD7」游客开关已关（2026-09-22）

本节取代 §2.29 的「游客开关还没关」。不要回写九项历史表（§2.6）。

2026-09-22 用户贴回 `supabase/sandbox/S154_cd7_switch_off_readonly.sql`，正好 1 行。Codex 没有执行 SQL。`switch_verdict` 以「游客开关已关」开头。

`target_present=true`。商品「沙箱CD7」/ 规格「默认规格」，`5f940176-8059-443a-b5fd-79adc883a810` / `c955f03a-8cd6-44b8-b751-06e2ad66d4cd`，`price_points=10.00`。`product_active=true`，`sku_active=true`。`product_allow_guest=false`，`sku_allow_guest` 为空，`effective_guest=false`，`guest_switch_off=true`。游客订单 1，付款类订单 0，支付行 1，已确认类事件 0，预占 1，held 0，已释放 1。非共享 available 6，游客 held 0，共享行 0，其他状态 0。商品和规格 `stock_count` 都是 6。

`switch_verdict`：游客开关已关。商品仍上架，登录积分商城可能还能看到这 6 张。本步不要求下架。不要再打开游客开关，不要建单，不要付款。

开关回读不输出 id，也不输出订单号。脚本按已确认的这两个 id 定位，商品名、规格名和单价都没变。唯一的游客订单仍是 `GS2026092207342938190F2B83D5ACF`。有效开关是 `COALESCE(sku.allow_guest_purchase, product.allow_guest_purchase, false)`。商品级已关，规格级为空，游客结算进不去。

订单行仍记着抵扣 1.00、应付 9.09，`payment_status=pending`。不要把订单行改成 0，也不要付款。预占已经释放。这只闭合开关。卡 7 继续 PARTIAL，不得改写成整卡 PASS。不要回写九项历史表。

不要重跑开关回读。不要再打开「沙箱CD7」或「沙箱CD3」。不要动「测试」「测试 2」「测试请勿兑换」，也不要动 ¥0.01 / 164 张和 ¥144 / 41 张。卡 8 会打开全局促销熔断并要求原价购买，等于要把刚关上的游客开关再打开，本步不授权。生产折扣保持关闭。`GUEST_SHOP_MAX_QUANTITY` 保持 1。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。

### 2.31 卡 8 熔断基线（2026-09-22，尚未贴回）

本节取代 §2.30 的「卡 8 本步不授权」。不要回写九项历史表（§2.6）。

2026-09-22 用户要求按计划继续。现行步骤只跑 `supabase/sandbox/S154_cd8_breaker_baseline_readonly.sql`。全文一条 SELECT，不调用 `fn_guest_shop_promo_status()`。`baseline_verdict` 以「基线通过」开头才算这半步。写着「缺行」或「熔断不是 closed」时不要补行，不要改状态。`manual_open_count` 与 `manual_close_count` 是以后各加 1 的起点，不要求现在是 0。

数据库闸先看熔断，再看预算。暂停码是 `guest_promo_halted`。这条函数不读生产折扣开关，所以不要为了看见这个码去打开 `GUEST_SHOP_DISCOUNT_ENABLED`。熔断是全局的。原价购买会重新打开「沙箱CD7」，本步不授权。不要打开熔断，不要建单，不要付款。

订单 `GS2026092207342938190F2B83D5ACF` 仍记着抵扣 1.00。不要改成 0。卡 7 继续 PARTIAL，不得改写成整卡 PASS。不要回写九项历史表。卡 9 还没开始。`GUEST_SHOP_MAX_QUANTITY` 保持 1。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。不得应用 `20260925_guest_shop_promo_gates.sql`。

### 2.32 卡 8 熔断基线已贴回，只打开熔断（2026-09-22，打开结果尚未贴回）

本节取代 §2.31 的「现行步骤只跑基线」。不要回写九项历史表（§2.6）。上一节的「尚未贴回」保留，不要改成已完成。

2026-09-22 用户贴回 `supabase/sandbox/S154_cd8_breaker_baseline_readonly.sql`，正好 1 行。Codex 没有执行 SQL。`baseline_verdict` 以「基线通过」开头。`breaker_state=closed`，`state_exclusive_ok=true`，打开人、打开时间、原因、合闸人和合闸时间都是空。阈值 3 / 20 / 900。八个事件计数全是 0，其中 `manual_open_count=0`、`manual_close_count=0`。CN 启用，日预算 20.00，日期 2026-09-22，已用 0.00。intl 关闭，日预算 0.00，已用 0.00。

2026-09-22 基线已贴回，`baseline_verdict` 以「基线通过」开头。`breaker_state=closed`，`state_exclusive_ok=true`，事件计数全是 0，`manual_open_count=0`，`manual_close_count=0`。CN 日预算 20.00，当日已用 0.00，日期 2026-09-22，intl 关闭且日预算 0.00。现行步骤只打开熔断正好一次：`node supabase/sandbox/s154-guest-promo-toolbox.js breaker open --actor s154-card8 --reason "S154 第8项" --yes`。然后 `node supabase/sandbox/s154-guest-promo-toolbox.js gate --site cn --amount 1.00`。期望 `allowed=false`、code=`guest_promo_halted`。工具箱把这行印成「未通过 / 需要人工判读」是预期业务结果，退出码仍是 0，不要因此重试，也不要打开 `GUEST_SHOP_DISCOUNT_ENABLED`。最后跑 `supabase/sandbox/S154_cd8_breaker_open_readonly.sql`。全文一条 SELECT。`open_verdict` 以「打开半步通过」开头才算这半步。不要合闸，不要建单，不要付款。不要打开「沙箱CD7」或「沙箱CD3」。订单 `GS2026092207342938190F2B83D5ACF` 的抵扣 1.00 不要改成 0。卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

不要第二次打开。第二次不会新增 `manual_open`，工具箱却仍印成功。不要用 `record-event` 补审计。不要跑夹具，也不要跑 cleanup。cleanup 会在 open 时自己合闸并补 `manual_close`。原价购买不在这一步，它会重新打开「沙箱CD7」。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `20260925_guest_shop_promo_gates.sql`。卡 9 还没开始。卡 7 继续 PARTIAL，不得改写成整卡 PASS。

### 2.33 卡 8 打开半步已贴回，只合闸一次（2026-09-22，合闸回读尚未贴回）

本节取代 §2.32 的「打开结果尚未贴回」。不要回写九项历史表（§2.6）。上一节的「尚未贴回」保留，不要改成已完成。

2026-09-22 用户贴回 `supabase/sandbox/S154_cd8_breaker_open_readonly.sql`，正好 1 行。Codex 没有执行这条 SQL。`open_verdict` 以「打开半步通过」开头。`breaker_state=open`，`state_exclusive_ok=true`，`breaker_reason=S154 第8项`，`opened_by=s154-card8`，`opened_at=2026-09-22 09:00:51.533097+00`。`closed_at` 和 `closed_by` 为空。阈值 3 / 20 / 900。`event_count=1`，`manual_open_count=1`，`manual_close_count=0`，`manual_open_matched=1`，其余四类事件都是 0。CN 启用，日预算 20.00，日期 2026-09-22，已用 0.00。intl 关闭，日预算 0.00，已用 0.00。两个沙箱商品的游客开关仍关。CD7 游客订单 1，付款类 0。CD3 游客订单 0。订单 `GS2026092207342938190F2B83D5ACF` 仍未付款，预占已释放，抵扣仍是 1.00。

同一轮 gate 为 `allowed=false`、code=`guest_promo_halted`，退出码 0。工具箱印「未通过 / 需要人工判读」是预期。不要打开 `GUEST_SHOP_DISCOUNT_ENABLED`。

2026-09-22 打开半步已贴回。合闸已经执行正好一次，不要再跑：`node supabase/sandbox/s154-guest-promo-toolbox.js breaker closed --actor s154-card8 --reason "S154 第8项恢复" --yes`。返回 `closed`，`closed_by=s154-card8`，`closed_at=2026-09-22 09:18:20.678679+00`（北京时间 17:18:20），熔断行 reason 为空是预期。随后 `node supabase/sandbox/s154-guest-promo-toolbox.js gate --site cn --amount 1.00` 已执行，`allowed=true`、code=`ok`，退出码 0。不要重复合闸。现行步骤只跑 `supabase/sandbox/S154_cd8_breaker_close_readonly.sql`。全文一条 SELECT。`close_verdict` 以「合闸半步通过」开头才算这半步。以「还是 open」开头不是失败，不要在 SQL Editor 里改状态。不要再打开，不要建单，不要付款。

合闸会把熔断行 reason、opened_at、opened_by 清空。关闭原因只留在 manual_close 事件。看到熔断行 reason 为空不要再合一次，也不要再打开。第二次 closed 不会新增审计，工具箱仍印成功。不要跑夹具，也不要跑 cleanup。原价购买不在这一步，它会重新打开「沙箱CD7」。卡 8 模板步骤④还没做，合闸后整卡仍不是 PASS，不得改写成整卡 PASS。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。卡 9 还没开始。卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

### 2.34 卡 8 合闸回读已贴回，卡 9 只读预算基线（2026-09-22，基线尚未贴回）

本节取代 §2.33 的「合闸回读尚未贴回」。上一节写入时的现行记录见 §2.33。不要回写九项历史表（§2.6）。不要改写上一节的「合闸回读尚未贴回」，也不要改写上一节的「卡 9 还没开始」。

2026-09-22 用户贴回 `supabase/sandbox/S154_cd8_breaker_close_readonly.sql`，正好 1 行。Codex 没有执行这条 SQL。`close_verdict` 以「合闸半步通过」开头。`breaker_state=closed`，`state_exclusive_ok=true`，`breaker_reason` 为空，`opened_by` 为空，`opened_at` 为空。`closed_by=s154-card8`，`closed_at=2026-09-22 09:18:20.678679+00`（北京时间 17:18:20）。阈值 3 / 20 / 900。`event_count=2`，`manual_open_count=1`，`manual_close_count=1`，两种 matched 都是 1，其余事件种类都是 0。CN 启用，日预算 20.00，已用 0.00，日期 2026-09-22。intl 关闭，日预算 0.00，已用 0.00。两个沙箱商品的游客开关仍关。CD7 游客订单 1，付款类 0。CD3 游客订单 0。订单 `GS2026092207342938190F2B83D5ACF` 仍未付款，预占已释放，抵扣仍是 1.00。

同一轮 gate 已是 `allowed=true`、code=`ok`，退出码 0。不要重跑 gate。合闸已经执行正好一次，不要再跑 `breaker closed`。第二次不会新增审计，工具箱仍印成功。不要用 `record-event` 伪造审计。不要再合一次，不要打开熔断。

现行步骤只跑 `supabase/sandbox/S154_cd9_budget_baseline_readonly.sql`。全文一条 SELECT，不调用 `fn_guest_shop_promo_status()`。`baseline_verdict` 以「基线通过」开头才算这半步。不要改 `v_phase`，不要切 `BUDGET_TIGHT`，不要跑夹具，也不要跑 `S154_fixture_setup.sql` 或 `S154_cleanup.sql`。夹具会把 CN 日预算改成 1.00 并归零计数。不要建单，不要付款，不要打开「沙箱CD7」或「沙箱CD3」，不要开 `GUEST_SHOP_DISCOUNT_ENABLED`。

卡 9 模板里的支付、`guest_promo_budget_exhausted` 和原价可买都不在这一步。原价购买会重新打开「沙箱CD7」，公开 6 张 ¥10 的卡。告警链路未接线，没有 webhook、邮件或 IM，以后只能记 N/A，不能据此把卡 9 写成整卡 PASS。订单抵扣 1.00 不要改成 0。卡 8 合闸后仍不是整卡 PASS，不得改写成整卡 PASS。卡 7 继续 PARTIAL。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。
### 2.35 卡 9 只读预算基线已贴回（2026-09-22，不切 BUDGET_TIGHT）

本节取代 §2.34 的「基线尚未贴回」。上一节写入时的现行记录见 §2.34。不要回写九项历史表（§2.6）。不要改写上一节的「基线尚未贴回」。

2026-09-22 用户贴回 `supabase/sandbox/S154_cd9_budget_baseline_readonly.sql`，正好 1 行。Codex 没有执行这条 SQL。`baseline_verdict` 以「基线通过」开头。`breaker_state=closed`，`state_exclusive_ok=true`，`breaker_reason` 为空，`opened_by` 为空，`opened_at` 为空。`closed_by=s154-card8`，`closed_at=2026-09-22 09:18:20.678679+00`（北京时间 17:18:20）。阈值 3 / 20 / 900。`event_count=2`，`manual_open_count=1`，`manual_close_count=1`，也就是 `manual_open=1`，`manual_close=1`。两种 matched 都是 1，其余事件种类都是 0。CN 启用，日预算 20.00，已用 0.00，日期 2026-09-22。intl 关闭，日预算 0.00，已用 0.00，日期 2026-09-22。两个沙箱商品的游客开关仍关。CD7 游客订单 1，付款类 0。CD3 游客订单 0。订单 `GS2026092207342938190F2B83D5ACF` 仍未付款，预占已释放，抵扣仍是 1.00。

基线通过不是整卡 PASS。这一轮没有新的 SQL。不要改 `v_phase`，不要切 `BUDGET_TIGHT`，不要跑夹具，也不要跑 `S154_fixture_setup.sql` 或 `S154_cleanup.sql`。不要打开熔断，不要打开「沙箱CD7」或「沙箱CD3」，不要建单，不要付款，不要开 `GUEST_SHOP_DISCOUNT_ENABLED`。

卡 9 模板里的支付、`guest_promo_budget_exhausted` 和原价可买都不在这一轮。夹具会把 CN 日预算从 20.00 改成 1.00 并归零计数。原价购买会重新打开「沙箱CD7」，公开 6 张 ¥10 的卡。告警链路未接线，没有 webhook、邮件或 IM，不能据此把卡 9 写成整卡 PASS。证据 §2.6 仍是全部未执行（0 / 9），卡 4 的券配额仍是「⬜ 未执行」。切 `BUDGET_TIGHT` 前要先抄卡 4，这一轮不补做卡 4，也不回写 §2.6。订单抵扣 1.00 不要改成 0。卡 8 合闸后仍不是整卡 PASS，不得改写成整卡 PASS。卡 7 继续 PARTIAL。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

### 2.36 切预算前只读抄录卡 4 计数（2026-09-22，抄录尚未贴回）

本节取代 §2.35 的「没有新的 SQL」。上一节写入时的现行记录见 §2.35。不要回写九项历史表（§2.6）。不要改写上一节的「没有新的 SQL」，也不要改写上一节的「基线通过不是整卡 PASS」。

2026-09-22 卡 9 只读预算基线已贴回，`baseline_verdict` 以「基线通过」开头。上一节写入时这一轮没有新的 SQL。`breaker_state=closed`，`closed_by=s154-card8`，`closed_at=2026-09-22 09:18:20.678679+00`，`manual_open=1`，`manual_close=1`。CN 日预算仍是 20.00，已用 0.00，日期 2026-09-22，intl 仍关闭。抄录尚未贴回。现行步骤只跑 `supabase/sandbox/S154_cd9_card4_snapshot_readonly.sql`。全文一条 SELECT，不调用 `fn_guest_shop_promo_status()`，也不调用 `fn_guest_shop_promo_set_breaker`。`snapshot_verdict` 以「抄录通过」开头才算这半步。抄的是 `SBXPROMO10` 和 `SBXQUOTA2` 的游客计数、让利总额，以及按券汇总的台账行数和金额，不输出联系人或 IP。这不是卡 4 PASS。证据 §2.6 仍是全部未执行，卡 4 的券配额仍是「⬜ 未执行」。不要回写 §2.6。计数不是 0 时留下本行，这一轮仍不要切。写着异常不是邀请去修。不要改 `v_phase`，不要切 `BUDGET_TIGHT`，不要跑夹具，也不要跑 `S154_fixture_setup.sql` 或 `S154_cleanup.sql`。不要打开熔断，不要打开「沙箱CD7」或「沙箱CD3」，不要建单，不要付款，不要开 `GUEST_SHOP_DISCOUNT_ENABLED`。卡 9 模板里的支付、`guest_promo_budget_exhausted` 和原价可买都不在这一步。夹具会把 CN 日预算从 20.00 改成 1.00 并归零计数。原价购买会重新打开「沙箱CD7」，公开 6 张 ¥10 的卡。告警链路未接线，没有 webhook、邮件或 IM，不能据此把卡 9 写成整卡 PASS。订单 `GS2026092207342938190F2B83D5ACF` 的抵扣 1.00 不要改成 0。卡 8 合闸后仍不是整卡 PASS，不得改写成整卡 PASS。卡 7 继续 PARTIAL。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

上面把「没有新的 SQL」留在上一节。期望 `SBXPROMO10` 为 percent、结算比例 90、`guest_max_uses` 50、让利上限 50.00，`SBXQUOTA2` 为 percent、结算比例 90、`guest_max_uses` 2、让利上限 30.00。两边 `guest_used_count`、`used_count`、`guest_discount_total` 都应为 0。`SBXPROMO10` 台账应为 1 行已归还、抵扣 1.00；`SBXQUOTA2` 台账应为 0 行。这是脚本里的通过条件，不是已经贴回的新抄录。`discount_codes` 没有 `updated_at`，脚本不选它。不要建单，不要付款。


### 2.37 切预算前卡 4 抄录已贴回（2026-09-22，不切 BUDGET_TIGHT）

本节取代 §2.36 的「抄录尚未贴回」。上一节写入时的现行记录见 §2.36。不要回写九项历史表（§2.6）。不要改写上一节的「抄录尚未贴回」，也不要改写上一节里那句尚未贴回时的现行步骤。

2026-09-22 用户贴回 `supabase/sandbox/S154_cd9_card4_snapshot_readonly.sql`，正好 1 行。Codex 没有执行这条 SQL。`snapshot_verdict` 以「抄录通过」开头。`SBXPROMO10` 与 `SBXQUOTA2` 都是 percent、结算比例 90、active、站点 cn、`allow_guest=true`、`max_uses=0`。`SBXPROMO10` 的 `guest_max_uses` 是 50、让利上限 50.00；`SBXQUOTA2` 的 `guest_max_uses` 是 2、让利上限 30.00。两边 `guest_used_count`、`used_count`、`guest_discount_total` 都是 0。`SBXPROMO10` 台账 1 行且已归还，抵扣 1.00，没有未归还行；`SBXQUOTA2` 台账 0 行。

`breaker_state=closed`，`state_exclusive_ok=true`，`closed_by=s154-card8`，`closed_at=2026-09-22 09:18:20.678679+00`，`manual_open=1`，`manual_close=1`。通过判语要求阈值仍是 3 / 20 / 900，其余事件种类都是 0。CN 日预算仍是 20.00，已用 0.00，日期 2026-09-22。intl 仍关闭，日预算 0.00，已用 0.00，日期 2026-09-22。两个沙箱游客开关仍关。「沙箱CD7」游客订单 1，付款类 0；「沙箱CD3」游客订单 0。订单 `GS2026092207342938190F2B83D5ACF` 仍未付款，预占已释放，抵扣仍是 1.00。

抄录通过不是卡 4 PASS，也不是卡 9 整卡 PASS。卡 9 基线通过不是整卡 PASS。证据 §2.6 仍是全部未执行（0/9），卡 4 的券配额仍是「⬜ 未执行」。不要回写 §2.6。这一轮没有新的 SQL。现有夹具仍指向「测试」¥0.01 和「测试 2」¥144.00，重跑会把 CN 日预算从 20.00 改成 1.00 并归零计数。¥1.00 的日预算只适用于「沙箱CD7」的 1.00 抵扣，不能靠重跑夹具切过去。这一轮不改夹具，也不另写预算 SQL。不要改 `v_phase`，不要切 `BUDGET_TIGHT`，不要跑夹具，也不要跑 `S154_fixture_setup.sql` 或 `S154_cleanup.sql`。不要打开熔断，不要打开「沙箱CD7」或「沙箱CD3」，不要建单，不要付款，不要开 `GUEST_SHOP_DISCOUNT_ENABLED`。

卡 9 模板里的支付、`guest_promo_budget_exhausted` 和原价可买都不在这一轮。原价购买会重新打开「沙箱CD7」，公开 6 张 ¥10 的卡。告警链路未接线，没有 webhook、邮件或 IM，不能据此把卡 9 写成整卡 PASS。写着异常不是邀请去修。不调用 `fn_guest_shop_promo_status()`，也不调用 `fn_guest_shop_promo_set_breaker`。订单抵扣 1.00、商品净额 9.00、通道费 0.09、应付 9.09 不要改成 0。卡 8 合闸后仍不是整卡 PASS，不得改写成整卡 PASS。卡 7 继续 PARTIAL。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。
### 2.38 2026-09-22 把 CN 日预算从 20.00 收到 1.00（结果尚未贴回，不切 BUDGET_TIGHT）

本节取代 §2.37 的「也不另写预算 SQL」。上一节写入时的现行记录见 §2.37。不要回写九项历史表（§2.6）。不要改写上一节的「也不另写预算 SQL」，也不要改写上一节的「这一轮没有新的 SQL」。那两句是上一节写入时的现行记录。上一节不得出现 `S154_cd9_cd7_budget_tighten.sql`，也不得把这次收紧写成已经贴回。

2026-09-22 切预算前的卡 4 抄录已经贴回。结果尚未贴回。整份执行 `supabase/sandbox/S154_cd9_cd7_budget_tighten.sql`。Codex 不执行这条 SQL。不要只跑最后一条 SELECT。执行前 CN 日预算仍是 20.00，已用 0.00，日期 2026-09-22。脚本只改已有 cn 行的日上限到 1.00，不改已用、日期、intl、券、台账、熔断或游客开关。

`tighten_verdict` 以「收紧半步通过」开头，才表示这一次从 20.00 收到 1.00。以「本次没有再改」开头不是失败，不要把 20.00 写回去。以「看不清」开头表示没有本次标记；若 NOTICE 已经说收到 1.00，整份再跑，不要手工改数字。写着异常不是邀请去修。上海当天不是 2026-09-22 就中止。预算表没有触发器。表开了 RLS 且没有策略，请仍在 SQL Editor 整份执行；改到 0 行就停，不要加策略。

CN 日预算是全站上限，不是「沙箱CD7」私有。生产「测试」`52246f1d-b98d-4920-9129-581296f43de9`（¥0.01）游客入口可能仍开，「测试 2」`c16212d8-6ad8-4b3c-831c-3cc68b2d7a52` 是 ¥144。原价不消耗预算。打开「沙箱CD7」会公开 6 张 ¥10 的卡。0.00 + 1.00 可以通过门禁，第二笔 1.00 才是 `guest_promo_budget_exhausted`。这一步两笔都不建。1.00 过了当天也不会自己回到 20.00，扣减只重置已用，不恢复日上限。`v_phase` 继续留在 `MAIN`。不要改 `v_phase`，不要切 `BUDGET_TIGHT`，不要跑夹具，也不要跑 `S154_fixture_setup.sql` 或 `S154_cleanup.sql`。

告警没有 webhook、邮件或 IM，只能记 N/A。订单 `GS2026092207342938190F2B83D5ACF` 的抵扣 1.00、商品净额 9.00、通道费 0.09、应付 9.09 不要改成 0。这不是卡 4 PASS，也不是卡 9 整卡 PASS。证据 §2.6 仍是 0/9，卡 4 仍是「⬜ 未执行」。不要回写 §2.6。不调用 `fn_guest_shop_promo_status()`，不调用 `fn_guest_shop_promo_set_breaker`，也不调用 `guest_shop_promo_gate`。不要打开熔断，不要打开「沙箱CD7」或「沙箱CD3」，不要建单，不要付款，不要开 `GUEST_SHOP_DISCOUNT_ENABLED`。卡 7 继续 PARTIAL，不得改写成整卡 PASS。卡 8 合闸后仍不是整卡 PASS。卡 9 基线通过不是整卡 PASS。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

### 2.39 2026-09-22 CN 日预算已收到 1.00（收紧半步已贴回，不切 BUDGET_TIGHT）

本节取代 §2.38 的「结果尚未贴回」。上一节写入时的现行记录见 §2.38。不要回写九项历史表（§2.6）。不要改写上一节的「结果尚未贴回」，也不要改写上一节里那句整份执行收紧脚本的现行步骤。那两句是上一节写入时的现行记录。上一节不得把这次收紧写成已经贴回。

2026-09-22 用户贴回 `supabase/sandbox/S154_cd9_cd7_budget_tighten.sql`，正好 1 行。Codex 没有执行这条 SQL。`tighten_marker=updated`，`tighten_verdict` 以「收紧半步通过」开头。`breaker_state=closed`，`closed_by=s154-card8`。CN 启用，日预算 1.00，已用 0.00，日期 2026-09-22。intl 关闭，日预算 0.00，已用 0.00，日期 2026-09-22。不要重跑这份收紧脚本。第二次整份重跑看到「本次没有再改」不是失败，但这一轮不要再跑。不要把 20.00 写回去。以「看不清」开头仍然不是这半步的完成判语。写着异常不是邀请去修。这一轮没有新的 SQL。CN 日预算是全站上限，不是「沙箱CD7」私有。生产「测试」`52246f1d-b98d-4920-9129-581296f43de9`（¥0.01）游客入口可能仍开，「测试 2」`c16212d8-6ad8-4b3c-831c-3cc68b2d7a52` 是 ¥144。原价不消耗预算。打开「沙箱CD7」会公开 6 张 ¥10 的卡。0.00 加 1.00 可以通过门禁，第二笔 1.00 才是 `guest_promo_budget_exhausted`。这一轮两笔都不建。1.00 过了当天也不会自己回到 20.00。卡 9 模板里的支付、打满拒绝实机和原价可买都不在这一轮。支付和原价购买都会重新打开「沙箱CD7」。本贴回不授权。告警没有 webhook、邮件或 IM，只能记 N/A，不能据此把卡 9 写成整卡 PASS。这不是卡 4 PASS，也不是卡 9 整卡 PASS。证据 §2.6 仍是 0/9，卡 4 仍是「⬜ 未执行」。不要回写 §2.6。不要改 `v_phase`，不要切 `BUDGET_TIGHT`，不要跑夹具或 cleanup。不调用 `fn_guest_shop_promo_status()`，不调用 `fn_guest_shop_promo_set_breaker`，也不调用 `guest_shop_promo_gate`。不要打开熔断，不要打开「沙箱CD7」或「沙箱CD3」，不要建单，不要付款，不要开 `GUEST_SHOP_DISCOUNT_ENABLED`。订单 `GS2026092207342938190F2B83D5ACF` 的抵扣 1.00 不要改成 0。卡 7 继续 PARTIAL，不得改写成整卡 PASS。卡 8 合闸后仍不是整卡 PASS。卡 9 收紧半步通过不是整卡 PASS。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

### 2.40 2026-09-23 卡 9 已付款订单回读（结果尚未贴回）

用户报告订单 `GS20260922120128080254E4D17280D` 已支付 9.09。应付探针结果已贴回：站点 `cn`，配置来源 `sites.cn`，ZPay 有效费率 0.01，标价 10.00，抵扣 1.00，净额 9.00，通道费 0.09，应付 9.09。此前错误是把 `S154_probe_readonly.sql` 的说明标题「段 6 · 通道附加费」当作 SQL 执行，数据库在中文标题处报语法错误；该标题不是 SQL。卡 9 的专用应付文件 `supabase/sandbox/S154_cd9_payable_probe_readonly.sql` 已有正确结果，无需重跑。

用户已整文件执行 `supabase/sandbox/S154_cd9_payment_readback.sql` 并贴回一行。结果 `readback_verdict` 以「支付半步通过」开头：订单与支付 confirmed，金额 10.00 - 1.00 + 0.09 = 9.09，实付/应付均 9.09，四项验证标志均真；订单 delivered、预占 consumed、库存 sold，`fulfilled_at` 存在，仍有 5 张可用。CN 预算日 2026-09-22 上限/已用均 1.00；intl 关闭。SBXPROMO10 台账两行，一行 open 1.00、一行 returned 1.00；券计数 1 / 抵扣合计 1.00。SBXQUOTA2 使用数与台账均为 0。旧单仍 pending、released、抵扣 1.00；CD7 恰好两笔游客订单；CD3 开关关闭且订单为 0；熔断 closed，阈值 3/20/900，事件数 2。

该支付半步已通过，但不代表卡 9 整卡 PASS：告警链路、打满拒绝实机和原价购买尚未闭合；这笔订单也不闭合卡 2。§2.6 仍为 0/9，阶段 5 为 `in_progress`，总进度 80%（4/5）。预算仍属于 2026-09-22，不要滚动日期或清零，不要恢复到 20.00。不要再次付款或建单，不要踢 worker，不要重开游客开关，不要跑夹具或 cleanup。

写入本节时阶段 5 为 `in_progress`，总进度为 80%（4/5）；这是该回读归档时的进度快照。

### 2.41 2026-09-23 卡 9 支付半步已通过（整卡仍未通过）

本节记录用户已贴回的卡 9 支付回读结果，替代 §2.40 的「结果尚未贴回」。§2.40 中关于误执行说明标题的错误记录仍保留作审计；不要修改那段历史。

用户贴回订单 `GS20260922120128080254E4D17280D` 的 `supabase/sandbox/S154_cd9_payment_readback.sql` 结果，是「沙箱CD7」游客单。支付与订单均 confirmed，paid/expected/total 均 9.09，订单手续费和支付手续费均 0.09；四个支付校验标志全真。履约 delivered、refund none、reservation consumed；预占库存 sold，available 5。促销预算日期 2026-09-22，CN 上限/已用 1.00/1.00，intl 关闭。SBXPROMO10 两次使用、累计让利 1.00；台账两行，一开一还，各 1.00。SBXQUOTA2 使用数与台账为 0。之前那笔仍 pending、released、抵扣 1.00。CD7 两笔游客订单，CD3 关闭且无游客单；熔断仍 closed，审计事件 2。

这是卡 9 的支付半步通过，不是整卡 PASS。告警、预算打满拒绝实机和原价购买尚未完成；也不关闭卡 2。不要滚动或清零 2026-09-22 预算，不要恢复 20.00，不再付款或建单，不踢 worker，不改写 §2.6（仍 0/9）。阶段 5 仍 `in_progress`，总进度 80%（4/5）。
