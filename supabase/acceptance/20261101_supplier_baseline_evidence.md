# Supplier Acceptance Baseline Evidence

## Capture

- Captured: 2026-11-01
- Supabase project: `zaoyoe`
- Project ref: `mmkugdibsaeoevliebzk`
- Dashboard environment label: `main PRODUCTION`
- PostgreSQL: `17.6`
- Access mode: Supabase SQL Editor, `SELECT` statements only
- Production writes or migrations: none
- Business table rows read: none

## Production Schema Reference

Query source: `20261101_supplier_production_schema_readonly.sql`.

The result is a structural catalog reference for selected public supplier,
shop, and guest-shop relations. It contains 56 relations, including 21
`shop_supplier_*` relations, 38 supplier function signatures, and 42 related
types. It records columns, defaults, constraints, indexes, RLS policy metadata,
trigger definitions, view definitions, and supplier function properties. It
does not contain table rows, function bodies, or a complete dump of the public
schema, so it is not independently restorable as a database baseline.

Result artifact: `20261101_supplier_production_schema_reference.csv`.

SHA-256: `3c8e7e7514ac460fcaf00261f1312ddbb0ffdae6fd15afef8ad6567cfca2715a`.

### Full `public` Catalog Scope Probe

On 2026-11-01, a separate read-only catalog count query was run in the
verified production SQL Editor. It found 159 ordinary tables, 2 materialized
views, 8 sequences, 13 ordinary views, 401 functions, and 174 composite types
in `public`. This confirms the selected 56-relation reference is not a full
schema export and gives a concrete completeness target for the next capture.

Query source: `20261101_supplier_production_object_counts_readonly.sql`.
Result artifact: `20261101_supplier_production_object_counts_reference.csv`.
SHA-256: `52db2f57e13bd26d040a1d655301efffaeb42e29444b4984eafcb7cc30523957`.

## Production Migration Ledger

Query source: `20261101_supplier_remote_migration_ledger_readonly.sql`.

The read-only `supabase_migrations.schema_migrations` query returned six rows,
from `202606171905` through `20260731`. Those entries describe prompt/AI
migrations, not the repository's shop supplier migration chain. The production
catalog already contains the supplier relations, while the repository has
supplier migrations through `20261021`. Therefore this ledger is not evidence
that the shop migrations are unapplied; actual application provenance remains
unverified and must be established by catalog-to-migration verification.

Result artifact: `20261101_supplier_remote_migration_ledger_reference.csv`.

SHA-256: `a5de7449174edc2f2054194d634b62b2fa332bbf8f17d317e8773366d437c3e2`.

## Local Isolation Status

- Colima profile `p2g` is running.
- `supabase_db_shop-supplier-p2g-empty-20261030` is a healthy PostgreSQL 17.6
  container on port `55452`; its volume was preserved and only inspected with a
  read-only identity/catalog query. It has no application `public` tables.
- Existing `supabase_db_supabase` is also PostgreSQL 17.6 and has no application
  `public` tables. It was only inspected read-only and was not used as a target.
- Neither database is a matching shop/supplier baseline. No migrations have
  been applied to either one.
- A separately named, disposable acceptance database/container is still
  required before migration replay or database-backed acceptance tests.

## Result

- Production structural reference: **CAPTURED, scoped, non-restorable**.
- Full public catalog scope: **COUNTED; definitions not yet captured**.
- Production shop migration provenance: **UNVERIFIED**.
- Matching isolated application baseline: **NOT YET BUILT**.
- Supplier procurement, storefront sales, and automatic delivery remain
  disabled; this evidence does not authorize enabling them.

## Review Correction (2026-11-01)

The structural query and its CSV are references only, not a restorable dump.
Offline parsing confirmed 56 selected relations (21 `shop_supplier_*`), 38
supplier function signatures, and 42 related types. Function bodies, all other
public objects, role/extension definitions, and business rows are not included.

A name-only static comparison across the 321 repository migration SQL files
found that all 21 supplier table names created by those migrations and all 38
supplier function names are present in the captured production catalog. The
sorted name-list JSON SHA-256 is
`f33cb5bbbdeca1a83e95719decdb6056fca351d2422379fbb415aa913bf4590b`. This does
not compare columns, constraints, function bodies, privileges, or migration
provenance.

- Structural query SHA-256:
  `7b4693c6932d9917046acf2c9c923159ce14bbb4ff31013c23eaa9e4b76021a0`
- Structural result SHA-256:
  `3c8e7e7514ac460fcaf00261f1312ddbb0ffdae6fd15afef8ad6567cfca2715a`
- Migration-ledger query SHA-256 (corrects the earlier `c1d3...` entry):
  `e4fd608135dc2533bd0d1fce0679c10072e0551b6ab10c50f3ac2ebfa814b969`
- Migration-ledger result SHA-256:
  `a5de7449174edc2f2054194d634b62b2fa332bbf8f17d317e8773366d437c3e2`
- Current checkout and `origin/main` both resolve to
  `9748be9c8373edd617ec15b7b5c0d52865554f14`. The 321-file migration
  manifest SHA-256 is
  `8322f1d3581da13e8eb89626cec957ec2773e44961b071436121ff92d2612e83`;
  no migration files differ from that commit.
- The Colima `p2g` profile is running. Existing empty databases were not
  changed. No new target was created because no restorable, source-bound
  baseline is available yet.
- Focused supplier/admin/workspace/delivery tests: 98 pass, 0 fail, 0
  cancelled, 0 skipped, 0 todo.

Production migration provenance remains unverified. The isolated G0 baseline
is not complete; this correction does not authorize production SQL changes or
supplier purchases, delivery, or storefront sales.

## 2026-11-02 本地 Supplier-Focused 基线补充与状态更正

本节更正 §58–§79 和 §38.10 在新隔离目标建立前的现场状态；旧段落作为当时观察保留，不代表当前状态。

### 隔离目标身份

- 目标仅为本机 Colima `p2g` 中的新 PostgreSQL 容器/卷，不是 `zaoyoe` 生产项目，也没有通过任何 Supabase 远程连接写入。
- 容器：`supabase_db_shop-supplier-p2g-baseline-20261102`；Docker context：`colima-p2g`；镜像：`public.ecr.aws/supabase/postgres:17.6.1.075`；PostgreSQL：`17.6`；状态：`healthy`；宿主机端口：`55453`。
- 独立卷：`supabase_db_shop-supplier-p2g-baseline-20261102`。原有 `supabase_db_shop-supplier-p2g-empty-20261030`（55452）和 `supabase_db_supabase` 未改动。
- 应用源码 `HEAD` 与 `origin/main` 均为 `9748be9c8373edd617ec15b7b5c0d52865554f14`，`HEAD..origin/main=0`。工作树为 detached 且有既存改动；验收绑定的是该源码 commit、下列 SQL 文件 SHA 与本地验收记录，不代表脏工作树已提交或生产发布。
- SQL 目标指纹、对象清单、容器/卷和计数保存在 `20261102_supplier_p2g_baseline_reference.csv`。

### 基线范围与来源

这是**supplier-focused 本地兼容基线**，不是全量生产 schema dump，也不声称覆盖商城其他功能的完整行为。它不含生产行、Auth 用户、供应商凭据、商品、库存、订单、采购或交付内容。bootstrap 和迁移仅在这个新本地卷执行：

| 文件 | 用途 | SHA-256 |
| --- | --- | --- |
| `20261102_supplier_p2g_baseline_bootstrap.sql` | 最小兼容基础对象 | `c7d36953628d8bbf778297afd7c589d8f72c8fecaaac30b03197a7c993e838a5` |
| `20260523_add_shop_product_skus.sql` | SKU 结构 | `23a7712b48c46da9544e212a675b5f2b7fb7782d3765871587fe6f644af6923a` |
| `20260606_add_shop_inventory_procurement_sources.sql` | 库存采购来源结构 | `634734fbbc1043d170c7574ebb9635d2613dd1e71e2bfad794b7f81c0eb258af` |
| `20261006_add_shop_supplier_catalog_core.sql` | 供应商目录核心结构 | `6e7f9c5749431104289b87d0b61456b48c6bf4e6a740f2df07f44676e0312871` |
| `20261019_shop_supplier_platform_v2_readonly.sql` | 虾仁变体/快照与 service-only 草稿导入 RPC | `bece751537039e700e211a339310771dab77b1ba9f5338c5d3aa05f707080418` |
| `20261019_verify_shop_supplier_platform_v2_readonly.sql` | 只读 P0/P1 结构验收 | `3e239afe41ef758a21e67c57963e9da34b0ad2629b058455df389ce9e0deefb0` |

该隔离库没有仓库应用迁移账本；SQL 的执行顺序和 SHA 由本记录明确列出，不能据此推导生产迁移来源或完整迁移历史。生产项目未执行迁移。

### 验收结果

- `20261019_verify_shop_supplier_platform_v2_readonly.sql` 在该数据库执行成功，结果为：`Supplier P0/P1 structural checks passed; concurrent/merchant/business acceptance remains NOT RUN`。
- 关键结构：`shop_supplier_accounts`、`shop_supplier_product_mappings`、`shop_supplier_availability` 均启用 RLS；虾仁草稿导入函数为固定 `search_path` 的 `SECURITY DEFINER`，只授予 `service_role`；商品默认 SKU 触发器存在并启用。
- `16688/default` 与 `xiareng/default` 均为 disabled。`shop_products`、`shop_inventory`、`shop_orders`、`shop_order_items`、供应商映射和 availability 当前行数均为 0。
- 数据库身份查询只检查版本、对象名和迁移目录，不读取业务行；完整结果见同目录 SQL 和 CSV。
- Supplier/Admin/UI/import/delivery/schema 聚焦 Node 契约：**109 PASS、0 FAIL、0 CANCELLED、0 SKIPPED、0 TODO**。这是离线代码测试，不是并发、真实商户、采购或交付验收。

### 更正后的状态

- Supplier-focused isolated baseline：**PASS**（本机新隔离数据库，限上述结构范围）。
- Complete production schema-only baseline：**NOT AVAILABLE**；生产参考仍是选择性 catalog 数据，不可恢复。
- Production migration provenance：**UNVERIFIED**；生产账本不证明商城迁移来源。
- P1A 快照内分类浏览/筛选：**代码与契约测试 PASS**；真实虾仁目录数据尚未验收。
- 虾仁分类持久身份语义：**UNVERIFIED / BLOCKED**；`cat-N` 仅为单快照键，`upstreamIdCandidate` 仅为候选观察值，不可用于持久映射。
- P1B 持久分类树/分类映射：**BLOCKED ON UPSTREAM EVIDENCE**。
- 并发数据库验收、真实商户 API、采购、交付、商品销售及生产发布：**NOT RUN**。

本次仅在隔离本地数据库执行了上述 bootstrap、迁移与只读 verifier；没有接触生产写路径、没有调用虾仁 API、没有读取或输出任何凭据。采购、自动交付和销售仍保持关闭。

### 2026-11-02 隔离导入 RPC 回滚式集成冒烟

- 执行目标经 `docker --context colima-p2g`、容器名
  `supabase_db_shop-supplier-p2g-baseline-20261102`、镜像、健康状态、独立卷
  和 PostgreSQL `17.6` 再次核验；数据库名为 `postgres`。SQL 在执行前检查
  `app.supplier_p2g_target` session marker 和数据库名，拒绝未标记的连接。
- SQL 文件：`20261102_supplier_p2g_import_rpc_rollback_smoke.sql`。
  SHA-256：`eb26c0d86c269c3a2c78268bd05f226082d0c401d66ebbc98fda6374bda07afa`。
- 执行命令通过精确容器中的 `psql -v ON_ERROR_STOP=1` 输入该归档 SQL；返回
  `PASS: draft, default SKU, disabled mapping, replay idempotency, single audit record`，
  随后输出 `ROLLBACK`。
- 回滚后只读复核：临时 Auth 用户、商品、映射、审计均为 `0`；隔离库商品、
  库存、订单、映射、availability 均为 `0`；`xiareng/default` 仍为 disabled。
- 新增静态安全契约
  `tests/supplier-p2g-rollback-smoke-contract.test.js`：**2 PASS、0 FAIL**。
  它验证精确隔离目标标记、任何 fixture 写入前执行目标检查、只允许回滚、
  禁止启用商品/映射，以及幂等与审计断言。
- 该集成冒烟仅验证当前 supplier-focused 隔离基线上的草稿导入 RPC 路径；不构成
  完整商城 schema、真实供应商目录、并发、采购、交付或生产迁移验收。生产
  `zaoyoe` 未连接写入，虾仁 API 未调用，商品销售与采购仍关闭。

### 2026-11-02 管理员身份与 Admin Studio 401 根因证据

- 目标项目仍为 Supabase `zaoyoe`（project ref `mmkugdibsaeoevliebzk`），环境为
  `main PRODUCTION`。本节只记录只读诊断，不是迁移，也没有修改 Auth 或角色数据。
- 旧浏览器请求中观察到的会话 `sub` 为
  `2e69a374-b00e-41e7-bcc4-27e055470040`；该 token 的过期时间为
  `2026-11-01 04:12:18 UTC`，当前日期为 `2026-11-02`，因此不能继续复用。
- `20261102_supplier_admin_role_bytes_readonly.sql` 返回的 `super_admin` 行实际身份为
  `2e69a374-b00e-41e8-bcc4-27e055470040`；长度为 36，UTF-8 hex 解码与该 UUID
  一致。它与旧会话 `sub` 的差异是中间一位：`41e8` 对 `41e7`。
- 最终对照 SQL：`20261102_supplier_admin_identity_pair_readonly.sql`，结果为：

  | label | user_id | auth_user_exists | roles |
  | --- | --- | --- | --- |
  | `admin_role_user_id` | `2e69a374-b00e-41e8-bcc4-27e055470040` | `true` | `super_admin` |
  | `session_token_sub` | `2e69a374-b00e-41e7-bcc4-27e055470040` | `false` | 空 |

- `api/_lib/admin.js` 的 `requireAdmin()` 会先验证会话用户，再通过
  `get_user_permissions` 或 `admin_roles.user_id = user.id` 解析管理员角色。旧会话的
  `sub` 既不是现有 Auth 用户，也没有管理员角色；再叠加 token 已过期，所以
  `/api/admin/access/session` 返回 `401 Unauthorized` 与工作树、8000 预览快照无关。
- 结论：必须在 `8000` 的 Admin Entry 正常重新完成 Google 登录，获取绑定到真实
  `...41e8...` 用户的新会话；不得把旧 token 或手工修改前端缓存当作修复。

### 2026-11-02 8000 虾仁目录两次只读观察

- 当前验收入口为 `http://localhost:8000/admin-studio.html?module=shop&shopTab=supplier-catalog`，使用已重新登录的 Admin Studio 会话。页面两次可见快照分别记录为 `2026-11-02 08:25:26` 和刷新后的 `2026-11-02 08:33:01`；两次均为虾仁默认账号、国内站、目录读取，不涉及导入、采购、报价、库存或交易写路径。
- 两次适配器只读归一化结果完全一致：`categoryCount=181`、`itemCount=3665`，分类 `itemCount` 总和为 `3665`；`upstreamIdCandidate` 缺失数为 `0`，候选分类 ID 重复数为 `0`，分类名称重复数为 `0`，多分类商品数为 `0`，商品分类归属次数为 `0`，本轮观察稳定性为 `stable=true`。
- 两次观察的脱敏结构摘要如下。摘要只用于证明本次响应在相同账号/站点和读取窗口内的可重复性，不包含商品说明、凭据、签名或卡密：

  | 摘要 | SHA-256 |
  | --- | --- |
  | 分类顺序 | `b7ee5175ea9fcddd50898f46f2286cc9dc2d1628a48152b82b624c538091752c` |
  | 分类名称顺序 | `b8cd0b15c86b43821617b6e48efe17f58e3c4ef137bf661add88e4484efdcefa` |
  | 分类候选 ID | `6c92e7361d56a4e1f82dc153b4f8fc11a0b9cb150c5e53aec34c55289e73d082` |
  | 商品分类归属 | `b74029f46ff8a2a38ea40d0aeea673728fbb97449bd922ef91e3be6220b0490e` |
  | 分类计数 | `37e7e1a03a5a25d2905f392ab403a093633914cabdf1236358ae52f765db40e6` |

- 观察到的前五个分类候选值为 `cat-1 -> 6`、`cat-2 -> 7`、`cat-3 -> 8`、`cat-4 -> 9`、`cat-5 -> 10`。其中 `cat-N` 是当前快照的临时 session key，数字只记录 `upstreamIdCandidate`，不能据此建立持久分类映射。
- 该证据补足了“当前登录目录响应可重复、候选 ID 在本次响应中唯一、当前观察没有多分类商品”的事实，但没有证明分类 ID 的供应商/账号/站点作用域，也没有证明改名、重排、删除后重建时的长期稳定性或 ID 重用规则。当前仍为：`identityStatus=unverified`、`categoryIdentityStatus=unverified`、P1B **BLOCKED ON UPSTREAM EVIDENCE**。
- 因此本轮只把 P1A 的真实登录态目录观察从 `NOT RECEIVED` 更正为“已取得两次只读观察证据”；不改变 G0 完整生产 schema-only 基线仍 **NOT AVAILABLE**、生产迁移来源仍 **UNVERIFIED** 的结论，也不授权执行生产 SQL、建立持久映射、导入商品、采购、交付或销售。

### 2026-11-02 13:01 CST 8000 现场复核与隔离 verifier 结果

- 在重新登录的 `localhost:8000` Admin Studio 中再次搜索 `2E4ED4E08F9B9210` 并读取库存/询价，实际结果为库存 `15625`、数量 1 报价 `0.17 CNY`；页面提示报价为所选数量总价，库存与报价均未锁定。本次没有导入、采购或销售写入。
- `GET /healthz` 实际返回当前 worktree、`sourceCommit=9748be9c8373edd617ec15b7b5c0d52865554f14`、`supabaseProxyEnabled=true`、`workingTreeDirty=true`、`changedFileCount=82`、`productionEvidence=false`。dirty 预览中的 `sourceMatchesStartup=false` 和 `restartRequired=true` 按本地服务保守计算，不视作文件错配或生产证据。
- `scripts/verify-supplier-p2g-baseline.js` 返回 `ok: true`。目标为 Colima `p2g` 的 `supabase_db_shop-supplier-p2g-baseline-20261102`，PostgreSQL `17.6`、healthy、host port `55453`；供应商表 RLS、默认 SKU trigger、`import_shop_supplier_draft_v2` 的 SECURITY DEFINER/search path/执行权限、空业务表和 `16688/default`、`xiareng/default` disabled 状态均通过。
- 本次聚焦测试为 **85 PASS、0 FAIL、0 CANCELLED、0 SKIPPED、0 TODO**；`node --check` 通过。`git diff --check` 仅发现 `css/shop-list-layout.css` 与 `css/shop-page.css` 末尾已有空行，未因该无关格式问题改写工作树。

这次验证只推进了 P1A 和本地 supplier-focused 基线；G0 完整生产 schema-only 导出、生产迁移来源、虾仁分类长期身份语义、P1B 持久映射、采购/交付和销售仍未通过，也没有执行生产 SQL 或真实采购。

### 2026-11-02 13:13 CST 本机隔离 RPC 回滚烟测

- 执行前 verifier：`npm run verify:supplier-p2g` 返回 `ok: true`。目标为 `colima-p2g` / `supabase_db_shop-supplier-p2g-baseline-20261102` / PostgreSQL `17.6` / host port `55453`；不是 Supabase `zaoyoe` 生产项目。
- 实际执行文件：`/Users/wangyongchao/.codex/worktrees/2bf1/xianyu_profit_calculator/supabase/acceptance/20261102_supplier_p2g_import_rpc_rollback_smoke.sql`。SHA-256：`eb26c0d86c269c3a2c78268bd05f226082d0c401d66ebbc98fda6374bda07afa`。
- 结果：目标标记校验通过；首轮 `import_shop_supplier_draft_v2` 生成 inactive 草稿、默认 SKU 和 disabled mapping；重复导入返回 `already_imported`，同一 mapping 和审计记录各一条；事务以 `ROLLBACK` 结束。脚本没有 HTTP 请求、没有虾仁 API 调用、没有生产写入。
- 回滚后复核：`auth.users`、`shop_products`、`shop_product_skus`、`shop_inventory`、`shop_orders`、`shop_order_items`、`shop_supplier_product_mappings`、`shop_supplier_availability`、`admin_audit_logs` 均为 `0`；两个默认供应商账号仍为 disabled；verifier 再次通过。
- 供应商相关测试集合：**514 PASS、0 FAIL、0 CANCELLED、0 SKIPPED、0 TODO**。该计数覆盖离线契约、handler/UI、虾仁适配器、供应商运行时和 P2G 脚本契约，不等于真实供应商、并发、生产或支付验收。

本条证据将本机 supplier-focused 隔离库的“草稿导入事务、幂等重放、禁用状态、审计唯一性、回滚无残留”标为 **PASS**；不改变完整生产 schema-only 基线 **NOT AVAILABLE**、生产迁移来源 **UNVERIFIED**、虾仁分类长期身份语义 **UNVERIFIED**、P1B 持久映射 **BLOCKED**、采购/交付/销售 **未开放** 的结论。

### 2026-11-02 14:01 CST 虾仁官方 API 文档核对与客户端边界

- 文档来源：`https://xiareng.cc/user/index/api`。本次只核对公开接口定义，没有提交虾仁交易请求，也没有读取或记录 `app_key`、签名、卡密或账户余额。文档页面的字段说明与当前客户端实现逐项比对如下：

  | 接口 | 文档字段 | 当前实现结论 |
  | --- | --- | --- |
  | `POST /shared/commodity/inventory` | `sharedCode`、返回库存 `count`，并包含 `price`、`user_price`、`config` 等商品信息 | 已按 `sharedCode` 请求并读取 `count`；价格只作为当前参考，不声明成本锁定；未假设文档没有定义的 `factory_price` |
  | `POST /shared/commodity/inventoryState` | `shared_code`、`num`；可选 `race`、`card_id`、`card_ids` | 已作为只读交易前预检；当前仅透传已核验的 `race`，未把卡片参数当成已核验 SKU |
  | `POST /shared/commodity/stock` | `code`；可选 `race`、`sku` | 已支持受限、只读的 SKU 组合；不接受未核验的卡片/组件字段 |
  | `POST /shared/commodity/valuation` | `code`、`num`；可选 `race`、`sku`、`card_id`、`card_ids` | 已支持受限 SKU 询价；仍保留数量、价格和上游可售状态未锁定提示 |
  | `POST /shared/commodity/trade` | `shared_code`、`num`、建议唯一的 `request_no`，长度不超过 64 | 交易路径只保留在隔离的人工采购契约测试中；`request_no` 被标为 `advisory_only`，不当作可恢复幂等键 |
  | `POST /shared/commodity/query` | `tradeNo` | 已使用大小写精确的 `tradeNo`；不发送未文档化的 `trade_no` |

- 文档建议 `request_no` 唯一传入，但没有给出按该值查询原始订单、重复请求的恢复结果、保留期限或跨账号作用域保证。当前适配器因此将 `capabilities.idempotency` 保持为 `false`，`procurement=false`，并在交易网络/HTTP/协议异常、响应缺少订单号或实际扣款超过保护线时返回未知结果，禁止自动重试。
- `app_key` 仅用于本地签名；它不上传为业务字段、不写入归一化目录、不写入验收记录或错误信息。采购/交付仍未开放，文档字段对齐只证明“读取、库存预检和询价边界已核对”，不证明真实采购、资金扣款、订单恢复或卡密交付已经验收。
- 本次代码验证：虾仁适配器测试 **36 PASS、0 FAIL**；供应商聚焦集合 **528 PASS、0 FAIL、0 CANCELLED、0 SKIPPED、0 TODO**；`npm run verify:supplier-p2g` 返回 `ok: true`。本机 `8000/healthz` 仍指向当前 worktree，`supabaseProxyEnabled=true`，预览为 dirty working-tree 模式；未执行生产 SQL、未调用 `/trade`、未创建真实订单。

本条只补足官方 API 字段证据和安全边界，不改变虾仁分类长期身份语义 **UNVERIFIED**、P1B 持久映射 **BLOCKED**、采购/交付/商品销售 **未开放** 的放行状态。
