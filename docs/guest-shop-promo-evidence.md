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
| 1 | `supabase/migrations/20260920_guest_shop_buyer_credentials.sql` | `20260920_verify_guest_shop_buyer_credentials.sql` | 11 | ⚠️ 首轮 **1 行 FAIL** → 诊断为 verify 探针缺陷（D-10），已修复；**迁移无需重跑**，待重跑修复后的 verify |
| 2 | `supabase/migrations/20260921_guest_shop_buyer_group_upsert.sql` | `20260921_verify_guest_shop_buyer_group_upsert.sql` | 5 | ✅ **全行 PASS** |
| 3 | `supabase/migrations/20260922_guest_shop_access_resets.sql` | `20260922_verify_guest_shop_access_resets.sql` | 7 | ✅ **全行 PASS（7/7）**，逐行见 §1.2 |

三个迁移都是**行为中立**的：`GUEST_SHOP_BUYER_CREDENTIAL_ENABLED` 仍为关闭状态，
应用层不读写这些新表，落库前后线上行为完全一致。**本次未打开任何开关、未启用游客商品。**

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

- [ ] 重跑 `supabase/migrations/20260920_verify_guest_shop_buyer_credentials.sql`，**11 行全 PASS**，把输出粘回本节
- [ ] `npm run readiness:guest-shop -- --env-file server/.env.production --fail-on-invalid`
      （预期 `--fail-on-not-ready` 仍返回 `3`，**禁止 `|| true` 绕过**）
- [ ] §15.3 G1：内部开启 `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED` 后，自测下单 / 查询 / 详情 / 卡密全链路截图
- [ ] 登录失败阶梯锁定触发截图（§8.1）
- [ ] 历史订单「订单号 + 取货口令」找回仍可用的截图（§13.1 不可回归项）
- [ ] 登录用户「我的钱包 → 订单记录」零改动截图（§11.1 不可回归项）

> 以上全部归档前，**不得宣称订单访问 2.0 可启用**；发布仍须走 `AGENTS.md` 的游客专用分支 + 四链路流程，
> 且必须等用户明确下达部署指令。
