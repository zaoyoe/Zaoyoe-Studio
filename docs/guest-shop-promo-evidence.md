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
