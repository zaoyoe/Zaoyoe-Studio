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
- [ ] 历史订单「订单号 + 取货口令」找回仍可用的截图（§13.1 不可回归项）
- [ ] 登录用户「我的钱包 → 订单记录」零改动截图（§11.1 不可回归项）

> 以上全部归档前，**不得宣称订单访问 2.0 可启用**；发布仍须走 `AGENTS.md` 的游客专用分支 + 四链路流程，
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
- **历史订单不被误伤**（第 7、11 行）：`column_nullable_for_history` + `foreign_key_on_delete_set_null` +
  `buyer_id_has_no_not_null` + `no_backfill_trigger_on_orders` —— 老订单 `buyer_id IS NULL`，仍走
  「订单号 + 取货口令」（§13.1 不可回归项），迁移**没有回填、没有加 NOT NULL、没有建触发器、没有建清理任务**。
- **防爆破取证就位**（第 4、5 行）：`locked_idx` 支撑 §8.1 阶梯锁扫描；`guest_shop_access_attempts` 的
  contact / ip 双索引支撑双维度锁定；`outcome_allows_credential_conflict` 让「凭证分组冲突」可取证。
- **行为中立已实证**（第 2、11 行）：`unexpected_denormalised_columns: []` 说明没有偷偷存明文邮箱/密码，
  配合开关关闭，落库前后线上行为一致。

> 复跑用的是**修复后的探针**（D-10）。同一份迁移、同一座库，只换探针就从 FAIL 变 PASS ——
> 这本身就是「坏的是校验器」的最直接实证。`tests/guest-shop-verify-probe-contract.test.js`
> 已把三条探针的字面量写法冻结，同类错误再犯会先在 CI 里红。

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
