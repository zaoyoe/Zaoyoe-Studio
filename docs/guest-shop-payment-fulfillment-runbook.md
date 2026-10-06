# 游客现金订单支付与履约运行手册

本手册用于值班、对账和故障处理。游客订单与登录用户积分订单完全分离；任何人工操作都必须保留订单号、原因、操作者和审计记录。

## 发布不等于启用

游客购买代码发布必须按 `AGENTS.md`：从专用分支 PR 合入最新 `main`，禁止从 `codex/*` 功能分支执行 `npx vercel deploy --prod`。

生产拓扑固定为：

- Vercel 生产托管 `shop.html` / `js/guest-shop-client.js` / `css/shop-page.css` 等前端；
- `/api/shop/:path*` 由 Vercel 反代到 `https://verify-api.fatherkey.com/api/shop/:path*`；
- 游客 API、webhook、worker 实际运行在 KVM4 Verify Server；
- KVM4 Sub2API / NewAPI 仍是完整部署的第三条链路，但不承载游客下单。

因此游客购买相关发布必须同时验证四条链路：Vercel production、KVM4 Verify Server、KVM4 Sub2API、KVM4 guest-shop worker。其中 worker 只能在 verify 的 `.current-release` 已经等于最新 `main` 之后安装或启动。

硬禁止：

- 部署过程不得打开游客商品或游客 SKU；
- 部署过程不得执行 SQL，也不得回滚已有游客购买迁移；
- 不得把自动化全绿、readiness 默认退出码 0、或三条链路 Ready 当成可以启用游客购买；
- 关闭游客开关是业务回滚；数据库回滚和 Vercel-only rollback 都不是游客购买的标准回滚。

执行合同见 `docs/guest-purchase-task-2.0.md`（当前内容版本为任务 2.1；文件名为兼容既有引用而保留）。

## 游客应付金额

游客支付宝（ZPay）和 USDT（NOWPayments）的应付金额必须自动等于 **商品价 + 1% 通道手续费**。后台 stored `surcharge_rate=0` 或空值时回退 1%，不要让用户在支付宝/钱包里手改金额。测试 SKU `¥0.01` 加 1% 后向上取整为 `¥0.02`，这是预期。旧未付款会话仍是旧金额；可用「离开当前订单」清除本地界面后重新创建，但该动作不会取消服务端旧单，也不要再支付旧付款码。少付不会 confirm，也不会发货。


## 游客促销：阶梯价 / 闪购（L1）与优惠码（L2）

> 设计合同见 `docs/guest-shop-promo-hardening-plan.md`；**本批次的实现记录与偏差见该文档 §23，冲突以 §23 为准**。
> 迁移与 verify 脚本（**Codex 不执行 SQL，由运维/用户在目标库手工执行**）：
>
> - `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_guest_shop_promo_l1l2.sql`
> - `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql`（**只读**，**23 行**检查，可重复执行；第 1–22 行必须 PASS，第 23 行 `operator_state_review` 为 PASS 或 REVIEW）
>
> **发布不等于启用**：本批所有开关默认关闭，代码上线后游客结账的线上行为与之前**逐字一致**。

### 应付金额口径（本批之后）

新制度订单（`guest_shop_orders.list_unit_amount IS NOT NULL`）：

```text
list_unit_amount              折前单价（阶梯价/闪购已由 SQL resolver 命中）
list_amount  = list_unit_amount * quantity
discount_amount               券折扣（>= 0，且严格小于 list_amount）
unit_amount  = 折后净单价
payment_fee_amount = 按「折后净额」计算的通道费（支付宝/USDT，1%，向上取整到分）
total_amount = unit_amount * quantity + payment_fee_amount      <-- 买家实付
```

旧制度订单（`list_unit_amount IS NULL`，本批之前创建的行）**保持原样**：通道费折进 `unit_amount`、
`payment_fee_amount = 0`、`quantity = 1`。**不要**给旧行回显「已优惠 ¥0.00」或「手续费 ¥0.00」，
前端与订单接口都按 `list_unit_amount` 是否为 NULL 区分两种制度。

数据库层 `guest_shop_orders_amount_check` 钉死了：`total_amount > 0`（**永不产生 0 元单**）、
折扣**严格小于**折前总额（零元购地板）、折扣**不超过折前总额的 50%**、通道费**不超过 10% + 0.01**、
且三者必须自洽。**任何一条被违反都会写入失败**，这是最后一道闸，不依赖应用层正确。

> ⚠️ 本批**没有**折扣率 env 旋钮，`discount_codes` **也没有**折扣率列。50% 硬顶是唯一的折扣率边界。
> 收紧单券用 `guest_max_uses` / `guest_max_total_discount`；收紧整站用
> `guest_shop_promo_budget.daily_budget_cny`；提高 50% 本身只能改迁移并重跑 verify。

### 开关矩阵（默认全关，任何一项关闭都退回原价购买）

| 开关 | 位置 | 默认 | 生效方式 | 关闭时的行为 |
|---|---|---|---|---|
| `GUEST_SHOP_DISCOUNT_ENABLED` | KVM4 `.env` | 未设置 = 关 | **需重建容器**（`env_file` 只被 `--force-recreate` 重读） | 提交券码 → **403 `guest_discount_disabled`**（不是静默丢弃）；无券下单不受影响 |
| `GUEST_SHOP_MAX_QUANTITY` | KVM4 `.env` | `1`（`min=1`, `max=5`） | 需重建容器 | `1` = 每单只预占一行库存，阶梯价最多命中 qty=1 规则，与 L1 之前一致 |
| `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED` | KVM4 `.env` | `false` | 需重建容器 | **L2 的硬前置**：关着的时候 `discount_enabled` 恒为 false（折扣无法归属身份，数据库会抛 `guest_discount_identity_required`） |
| `guest_shop_promo_budget.enabled` + `daily_budget_cny` | DB（每站一行） | `false` / `0` | **即时** | gate 返回 `guest_promo_budget_closed`，游客只能原价购买（**这是有意的 fail-closed，不是故障**） |
| `guest_shop_promo_breaker.state` | DB（单行） | `closed` | **即时** | `open` = 所有游客折扣被拒（原价购买不受影响），readiness 判为 NOT_READY（退出码 3） |
| `discount_codes.allow_guest` | DB（每券） | `false` | **即时** | 该券对游客不可用；`guest_max_uses = 0` 同样表示**关闭**而不是无限 |

`discount_enabled` 由 preview 接口下发，取值是
`GUEST_SHOP_DISCOUNT_ENABLED && GUEST_SHOP_BUYER_CREDENTIAL_ENABLED`；
`quantity_cap` 是
`min(GUEST_SHOP_MAX_QUANTITY, sku.guest_max_quantity, product.guest_max_quantity, product.max_purchase_quantity, 99)` 的**生效值**。
前端只按这两个值显隐控件，**不做任何金额计算**。

### 促销 / 多件扩展启用前置清单（按顺序，缺一不可）

本清单只约束优惠码、阶梯价/闪购和 `quantity > 1`。它不阻塞已按任务 2.1 §61.9 通过直接安全门的 CN、原价、单件基础 SKU，也不阻塞所有扩展开关保持关闭的生产发布。

1. 在目标 Supabase 执行 `20260923_guest_shop_promo_l1l2.sql`（必须在 `20260922_guest_shop_access_resets.sql` **之后**）。
2. 执行 `20260923_verify_guest_shop_promo_l1l2.sql`（**23 行**），确认 **第 1–22 行全 PASS**，把输出归档到
   `docs/guest-shop-promo-evidence.md`（归档前抹掉密钥、claim token、卡密正文、查询密码明文）。
   第 23 行 `operator_state_review` **不是** PASS/FAIL 判定，它把实时运维状态（已开放游客结账的商品/SKU 数、
   `GUEST_SHOP_MAX_QUANTITY`、`GUEST_SHOP_DISCOUNT_ENABLED` 等）打印出来交人工确认：
   看到 `REVIEW` 表示「必须有人逐条核对列出的状态是有意为之」，**不代表迁移失败**；
   看到 `FAIL` 才是迁移问题。运维状态由人决定，迁移无权钉死，所以它单列一行。
3. `npm run readiness:guest-shop -- --env-file server/.env.production --fail-on-invalid` 必须退出 **0** 且 `findings: none`。
4. 逐项完成 readiness 输出的 **6 项 `promo` manual_review**：schema 已应用、预算已开、熔断 closed、
   **脏券扫描**（不得存在 `allow_guest=true` 且 `guest_max_uses=0` 或 `guest_max_total_discount<=0` 的券）、
   **SKU 件数扫描**、parity 证据已归档。
5. 改 `.env` 后必须先暂停 KVM4 health watchdog，再执行
   `cd /opt/zaoyoe-verify-server && docker compose up -d --no-deps --force-recreate --no-build verify-server`；
   确认 `/healthz` 后恢复 watchdog。**禁止用 `docker restart` 或 `docker compose restart`，两者都不会重读 `env_file`。**
6. 只有以上全部完成，才可以按 §14 的灰度许可为已通过基础门的**指定 SKU + 指定券码**开启促销或多件。`--fail-on-not-ready` 返回 `3` 是该扩展启用前的**预期**结果，不得用 `|| true` 绕过。

> **禁止只改 env 就把 `GUEST_SHOP_MAX_QUANTITY` 调到 ≥2**：库存占比闸（C-D3）与并发未付款单闸（C-D4）
> 本批**未实现**（见 `docs/guest-shop-promo-hardening-plan.md` §23.5）。放开多件之前必须先补这两道闸并重新归档证据。

### 运营错误码速查

买家侧**只会**看到「对外码」，细码只写审计与内部错误对象（`failResponse` 只序列化
`success/code/message`，细码不可能出现在响应里）。

| 对外码 | HTTP | 买家看到 | 运营含义 / 处置 |
|---|---|---|---|
| `guest_discount_unavailable` | 400 | 优惠码不可用 | **C-E6 统一码**：券不存在 / 未开游客 / 过期 / 未生效 / 站点或范围不符 / 次数或金额预算耗尽 / 身份超限 / 熔断中 / 折后低于地板 / 预占竞态，**全部收敛到这一个码**（防枚举）。查具体原因看 `guest_shop_promo_breaker_events` 与订单审计，**不要**给买家更细的文案 |
| `guest_invalid_discount_code` | 400 | 优惠码格式无效 | Node 层格式闸（`^[A-Z0-9][A-Z0-9_-]{0,49}$`）。频繁出现说明有人在撞库或前端有输入污染 |
| `guest_discount_disabled` | 403 | 游客优惠码通道未开启 | 开关关着却收到了券码。**不是故障**，但若量大说明前端显隐与开关不同步 |
| `guest_quantity_not_allowed` | 400 | 购买数量不可用 | 超出四处取小的生效上限。检查 `GUEST_SHOP_MAX_QUANTITY` 与该 SKU 的 `guest_max_quantity` |
| `guest_pricing_parity_mismatch` | 400 | 价格已更新，请重试 | **最高优先级告警**：JS 展示镜像与 SQL 权威价不一致。出现即说明定价链路分叉，**立即关闭全部促销开关并跳闸**，再排查 |
| `guest_promo_budget_closed` / `guest_promo_halted` | — | （内部细码，对外呈现为 `guest_discount_unavailable`） | 分别是「站点日预算未开/已打满」与「熔断跳闸」。前者是配置状态，后者需要人工恢复 |
| `guest_discount_identity_required` | — | （内部细码） | 折扣无法归属身份：`buyer_contact_hash` 缺失或不是 64-hex。通常是凭证开关关着却开了折扣开关 |
| `guest_discount_rate_limited` | — | （内部细码，对外呈现为 `guest_discount_unavailable`） | 24h 配额命中：每身份默认 **3 次**、每 IP 默认 **10 次**（函数内硬夹 10 / 50） |

**本批没有 quote 端点**：券码只在 `POST /api/shop/guest/orders` 的 body 里校验一次，
校验失败 = 一次失败的下单（**不写订单行**，预占的券预算与库存在同一事务内回滚），
前端收到上述折扣类错误后会**主动撤回**折扣显示。因此不存在「前端持有一份可篡改/过期的报价」，
但也意味着买家是**点了购买才知道券不能用**。preview 的参数白名单只有
`site` / `productId` / `skuId` / `quantity`，**不含券码**；券码永不进 URL、query、`localStorage`、`sessionStorage` 或缓存键。

### 熔断（`guest_shop_promo_breaker`）

- 状态只有 `closed` / `open`，**没有半开、没有自动恢复**（能跳闸的攻击者也能等冷却）。
- 阈值就在行上，可不改迁移调整：`mismatch_trip_threshold=3`（金额不一致，**最高优先级**）、
  `identity_trip_threshold=20`、`trip_window_seconds=900`（滚动 15 分钟）。
  CHECK 夹住范围（1–100 / 1–1000 / 60–86400），写不出「第一个事件就永久跳闸」。
- 人工恢复（**只能由运维执行，需记录 actor 与 reason**）：

  ```sql
  SELECT public.fn_guest_shop_promo_set_breaker('closed', '<操作者标识>', '<恢复原因>');
  ```

- 只读状态快照（无 PII、无密钥、不写库）：`SELECT public.fn_guest_shop_promo_status();`
- 跳闸期间**原价购买不受影响**，只有折扣被拒。

### 预算与配额归还

- 扣减是原子的：`fn_guest_shop_reserve_discount` 在同一事务里更新
  `discount_codes.guest_used_count` / `guest_discount_total`、站点日预算已用额，并写
  `guest_shop_discount_redemptions` 台账一行；余量不足则一行都不更新。
- 归还是幂等的：`fn_guest_shop_return_discount_reservation` 靠台账行的 `returned_at` 判重，
  **反复退款不会把券预算刷回无限**。订单过期释放、后台退款、履约失败都走同一条归还路径。
- 台账只存哈希（`buyer_contact_hash` 64-hex、`request_ip_hash`），**不存明文邮箱、密码、claim secret 或卡密**；
  RLS 开启、浏览器侧零权限、仅 `service_role`。
- 配额按 `buyer_contact_hash` **跨该邮箱的全部凭证分组并集**计数，**不按 `buyer_id`**
  （否则不停新建凭证分组就能无限刷新额度）。

### 紧急停机（三条互相独立的路径，任一即可）

1. `GUEST_SHOP_DISCOUNT_ENABLED=false` + 重建容器（需重启，最彻底）；
2. `UPDATE public.guest_shop_promo_budget SET enabled=false WHERE site='<site>'`（**即时**，只停该站）；
3. `UPDATE public.discount_codes SET allow_guest=false WHERE code='<CODE>'`（**即时**，只停单券）。

停机后**已创建**的促销单继续按原金额履约或退款，不要改价、不要手工改 `total_amount`
（会撞上金额 CHECK，并让对账与 webhook 校验失败）。


## 上线前配置与 readiness

生产环境必须配置独立的 `GUEST_SHOP_CLAIM_PEPPER`、
`GUEST_SHOP_CLAIM_DERIVATION_PEPPER` 和 `GUEST_SHOP_WORKER_SECRET`，三者均使用
至少 32 字节随机值；两个 claim pepper 必须彼此不同，也不能复用
`SUPABASE_SERVICE_ROLE_KEY`。推荐用以下命令生成：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

生产还要配置独立的 `GUEST_SHOP_CONTACT_HASH_PEPPER` 和
`GUEST_SHOP_REQUEST_HASH_PEPPER`，用于隔离联系方式哈希和请求指纹；同样不得复用
claim pepper、`CRON_SECRET` 或 `SUPABASE_SERVICE_ROLE_KEY`。生产禁止内存限流，必须启用持久化限流并在目标
Supabase 中确认 `take_rate_limit_tokens` RPC、权限和存储表可用。

### 凭证与访问审计保留矩阵

`GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED` 是独立的数据生命周期开关，默认
`false`。它不能跟随 `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED` 自动关闭，否则凭证回滚后已存在的
`guest_shop_access_attempts` 会永久停止清理。

| 凭证开关 | retention 开关 | 允许状态 | 运维含义 |
|---|---|---|---|
| OFF | OFF / 未设置 | 允许（默认） | 不产生新的凭证访问审计，也不运行 retention RPC |
| ON | OFF / 未设置 | **禁止** | readiness 硬失败；不得开启凭证能力 |
| ON | ON | 条件允许 | 必须先应用 `20260924_guest_shop_access_attempt_retention.sql`，并用只读 `20260924_verify_guest_shop_access_attempt_retention.sql` 取得 **7/7 PASS** |
| OFF | ON | 允许且是凭证回滚后的必需状态 | 停止凭证入口，但继续按保留期清理历史访问审计 |

启用顺序固定为：由用户/数据库运维应用 retention migration；运行只读 verify 并归档
**7/7 PASS**；先设置 `GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED=true`；按下节流程重建
`verify-server` 并观察 worker；最后才可在独立批准后开启凭证和查询页开关。Codex 发布过程不执行
这些 SQL，也不把 migration 文件存在误报成目标库已应用。

凭证回滚时关闭 `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED` 和查询页开关，但 retention 必须保持 ON，
worker/timer 也必须继续运行。只有从凭证关闭时刻起已经跨过配置的保留期、历史行已按该保留期清理，
且没有 retention 错误或积压证据后，才可另行关闭 retention 开关。

worker 只能使用专用 `GUEST_SHOP_WORKER_SECRET` 调用：

```text
POST /api/shop/guest/worker
```

由 systemd timer 每 10 秒调用一次（单次 oneshot 仍串行执行）；禁止仅依赖通用 `CRON_SECRET`。调用 503、无运行记录、
履约积压或 `dead_letter` 增长时立即告警并暂停扩大游客商品范围。

要把支付确认后的正常履约延迟从定时器等待降到通常约 1～3 秒，可在 KVM4
Verify Server 的 `.env` 显式设置 `GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED=true`，并按下方
流程重建 `verify-server` 使 `env_file` 生效。该开关只在长驻 KVM4 进程且
`VERIFY_SERVER_WORKERS_ENABLED` 为真时生效；Vercel/serverless 永远不启用。即时 kick
不是可靠性边界：systemd timer 仍必须保留并运行，负责进程重启、网络错误和 kick 失败后的兜底。

kick 路径的跟踪日志由 `GUEST_SHOP_IMMEDIATE_FULFILLMENT_DEBUG` 控制，**默认关闭**，只在核对
发货延迟时临时打开。它只经仓库结构化 logger 输出订单 ID 与耗时，不写任何文件，也不输出
claim token、卡片或 provider payload。不要重新引入 `/tmp/worker-kick.log` 之类的同步文件写：
阻塞式 I/O 落在买家轮询的请求路径上，与降延迟目标相反；已确认订单会被每次 status 轮询重复
kick，日志量会随买家流量放大。

游客支付 adapter 走 `resolvePaymentProviderSecrets`：优先读后台 stored secret，
`.env` 里的 `ZPAY_PKEY` / `NOWPAYMENTS_API_KEY` 只是回退。KVM4 `.env` 没有这两项
不等于支付密钥缺失；登录支付能跑是预期现象。不要为了“看起来齐套”把登录支付密钥
复制进游客专用环境变量。

### 改 `.env` 后必须重建 verify-server

compose `env_file` 只在创建容器时加载。写入或轮换 `GUEST_SHOP_*` 后，先停
watchdog，再执行：

```bash
systemctl stop zaoyoe-kvm4-health-watchdog.timer zaoyoe-kvm4-health-watchdog.service
cd /opt/zaoyoe-verify-server
docker compose up -d --no-deps --force-recreate --no-build verify-server
curl -fsS http://127.0.0.1:3001/healthz
systemctl start zaoyoe-kvm4-health-watchdog.timer
```

`docker restart` 和 `docker compose restart` 都不会重读 `env_file`，容器会继续用旧开关或密钥，
worker 会 401/503。
重建时不要 `--build`，也不要顺手 recreate 其他 worker。命令、journal 和聊天里
都不要打印 secret。compact verify 镜像可能不含 `deploy/kvm4/guest-shop-worker/*`；
那不是启动失败，host 安装器落地的 systemd unit 才是调度来源。

### KVM4 调度器安装（仅部署准备，不替代应用发布）

仓库提供只调用本机 `127.0.0.1:3001` 的 systemd service/timer。它不接受订单号、库存或
支付 payload，也不写数据库；应用代码必须先按最新 `main` 发布，再安装调度器。安装脚本默认
只 `enable` 定时器而不启动，确认 secrets、端口和健康检查后才显式启动：

```bash
npm run install:kvm4:guest-shop-worker -- --host <KVM4_HOST> --port <SSH_PORT> --key <SSH_KEY>
# 复核 systemd unit、.env 权限、/healthz 后再启动：
npm run install:kvm4:guest-shop-worker -- --start --host <KVM4_HOST> --port <SSH_PORT> --key <SSH_KEY>
```

该安装器的远端应用根目录固定为 `/opt/zaoyoe-verify-server`，与静态 systemd unit 的
`ConditionPathExists` 和 `EnvironmentFile` 完全一致。不要传 `--root`，也不要设置不同的
`KVM4_ROOT`；自定义根目录会在发起 SSH 前被拒绝，避免“安装成功但加载了另一份 `.env`”的
配置分裂。若未来要迁移根目录，必须同时更新 unit、安装器、契约测试并单独完成 KVM4 验收。

安装前后检查：

```bash
systemctl status zaoyoe-guest-shop-worker.timer --no-pager
systemctl list-timers --all --no-pager | grep zaoyoe-guest-shop-worker
journalctl -u zaoyoe-guest-shop-worker.service -n 50 --no-pager
```

不要把 `GUEST_SHOP_WORKER_SECRET` 写进 unit 文件、命令历史或监控标签；只放在
`/opt/zaoyoe-verify-server/.env`（权限 `0600`）。若 timer 连续返回 503/超时，先停止 timer，
保留订单和支付证据，再按下方死信/退款流程处理。该安装脚本不执行 SQL，也不负责开启游客商品。

retention 每十分钟最多连续清理 10 批、每批最多 1000 行。清理配置/RPC/结果异常时，worker 返回
HTTP 503 和稳定码 `guest_access_audit_cleanup_failed`；10 批后仍有 `has_more=true` 时返回 HTTP 503
和 `guest_access_audit_backlog_degraded`。该次履约扫描仍按幂等规则完成，响应中的
`worker_run_success=true` 不得被误读为 retention 健康，也不得因此批量重放订单。systemd oneshot
会记录 failed/HTTP 503；用 `journalctl -u zaoyoe-guest-shop-worker.service` 确认失败时间，再从
`zaoyoe-verify-server` 容器日志的 `maintenance degraded` 记录核对稳定码、批次数、删除数与
`has_more`。在错误或积压消失前不得扩大游客商品或关闭 retention。

上线前执行只读检查：

```bash
npm run readiness:guest-shop -- --env-file server/.env.production --fail-on-invalid
```

该命令不会连接数据库或输出 secret。`--fail-on-invalid` 只拦截格式、密钥、数值和代码契约等
自动化硬错误；即使进程返回 0，也不代表可以打开游客商品。provider 启用状态、商品 allowlist、
限流 RPC 和支付平台后台配置仍必须由值班人员人工核对。

需要把 readiness 当作“当前功能启用前”的聚合检查时，再显式开启严格模式：

```bash
npm run readiness:guest-shop -- --env-file server/.env.production --fail-on-invalid --fail-on-not-ready
```

退出码约定如下：`0` 表示本次请求的闸门均通过；`2` 表示 `--fail-on-invalid` 发现硬错误；`3`
表示 `--fail-on-not-ready` 发现 `operational_ready=false`（未识别 production、仍有人工/数据库
复核项或存在其他未闭环证据）。当前脚本是刻意不连接数据库/provider 的离线检查器，因此在
人工证据尚未接线时，严格模式返回 `3` 是预期的 fail-closed 结果；不得用 `|| true` 忽略，也不得
把缺失证据对应的功能打开。聚合 `operational_ready=false` 不阻塞扩展开关保持关闭的发布，也不自动
阻塞 CN、原价、单件基础 SKU；基础 SKU 仍必须通过任务 2.1 §61.9.2 的直接安全门。只有要开启的
provider、站点、凭证、促销或多件功能，其对应人工项才是该功能的硬门。

ZPay 与 NOWPayments 控制台的 callback 必须分别指向：

```text
https://<受管域名>/api/shop/guest/webhooks/zpay
https://<受管域名>/api/shop/guest/webhooks/nowpayments
```

NOWPayments 游客网络固定为 `usdtbsc`。游客商品标价始终是人民币（复用积分价，1 积分 = 1 元），
国内站和国际站结算币种都是 CNY。ZPay/易支付始终收人民币；NOWPayments 始终收 USDT-BEP20，
下单时按登录用户充值同一套逻辑把人民币折成实时等额 USD quote 再转 USDT，不得把 USD quote
当成订单结算币种。NOWPayments 退款暂按人工队列处理，核对收款地址、
金额、交易哈希和出款凭证后再完成退款；不把自动退款视为已就绪。

20260915 积分价 SQL 已在目标库执行；verify 1-7 PASS。第 8 项 `REVIEW` 当时只表示有 1 个商品
开了 `allow_guest_purchase`，不是约束失败，也不是当前商品数量的权威快照。现行状态必须通过
Admin Studio/operator review 按精确 product/SKU 复核；每个开放 SKU 都应是低价值、非共享、自动发货且可单独关闭。
不得据此公开上架，也不得再跑 20260913 / 20260914 / 20260915 迁移。

20260916 / 20260917 / 20260918 / 20260919 已在目标库执行（verify 分别 3/3、4/4、6/6、6/6 PASS）。
D3-01 已用官方 unlock + 本地 worker 履约到 delivered，不要重跑 20260913 / 20260914 /
20260915 / 20260916 / 20260917 / 20260918 / 20260919。INTL create-order 闸门已解除，但不要
据此立刻新开 NOWPayments 扣款；网络仍固定 `usdtbsc`，标价始终 CNY。已 delivered 订单禁止再
手工改库存或批量重放死信。
D3-04 已验证：同一已付款 ZPay 回调重放到 `/api/shop/guest/webhooks/zpay` 必须 200
`duplicate: true`，不得新插事件、不得二次发货、不得改 `fulfilled_at`。伪造签名属于 D3-03，
必须进 invalid-bucket 并拒绝，不得占用业务 event_key。
D3-05 已验证：对已 delivered 订单补发签名正确但非终态（`WAIT_BUYER_PAY`）的乱序回调，必须 202
`accepted: false`，写入 invalid-bucket rejected 事件，`final_status_verified=false`，不得
`confirm_payment`，不得把 `delivered` / `consumed` / `sold` 划回。
D3-06 已验证：对已 delivered 订单补发签名正确但少付（`money=0.00` vs expected `0.01`）的终态回调，必须 202
`accepted: false`，`amount_verified=false`，不得改 `paid_amount`，不得回退 delivered。
D3-07 已验证：对已 delivered 订单补发签名正确但多付（`money=1.00` vs expected `0.01`）的终态回调，必须 202
`accepted: false`，`observed_amount=1`，`amount_verified=false`，不得改 `paid_amount`，不得回退 delivered。
D3-20 已验证：游客已付回调打到充值入口 `/api/payments/zpay/webhook` 必须 503 `payment order not ready`，不得写
`points_ledger`，不得改游客单；充值单回调打到 `/api/shop/guest/webhooks/zpay` 必须 202 `accepted: false`，
invalid-bucket rejected，`payment_order_id=null`，不得 `confirm_payment`。本地 preview 需要独立文件
`api/payments/zpay/webhook.js`，与 NOWPayments 入口同构。
同一来源 IP 的 invalid-bucket 窗口为 5 分钟；窗口内不同异常 body 会 `event_key_body_conflict`，这仍是拒绝。金额或币种异常回调同样不得回退终态。
D3-08 已收口：CN ZPay 结算币种由站点推导为 CNY，`parseGuestWebhook` 会覆盖 payload `currency`，binding 用 `expected.currency` 对比自身，`providerQuoteChecks` 对非 NOWPayments 恒为 valid。因此 CN 错币种记 `BLOCKED+ZPay currency is site-derived`，真实错币种放到 INTL NOWPayments 的 quote / `actually_paid_currency`。
不要用「金额正确 + 只改 currency」重放已 delivered 订单。
D3-02 已验证：未付款单到期后只能由官方 worker 调 `fn_guest_shop_release_expired_reservations` 释放
`held` 预占；已 `consumed` / delivered 的 D3-01 不得被划回 available。worker 入口不接受 body。

## 日常指标与告警

- `payment_confirmed_to_delivered_seconds`：P95 > 120 秒告警，P99 > 300 秒升级。
- `paid_unfulfilled_count`：任意非零持续 10 分钟告警。
- `guest_payment_review_count`、`amount_mismatch_count`：出现即进入人工复核。
- `reservation_expired_count`：15 分钟内超过 5 笔，检查释放 worker 和库存锁。
- `refund_pending_age_seconds`：超过 30 分钟告警，超过 2 小时升级财务。
- `dead_letter_count`：任意新增即告警，不得直接批量重放。

游客现金订单告警由独立模块 `api/_lib/guest-shop-alerts.js` 产生，`source` 固定为 `guest_shop_monitor`。不得并入 `shop_order_delivery` 告警，也不要给 ops-alerts 增加新的 routing key 或 mute UI。阈值只使用环境变量和模块默认值，不写入 ops-alerts runtime config。即使 ops alerts 关闭，verify server 仍会计算指标并打日志。值班入口保持本手册，后台入口是 Admin Studio → 商城 → 游客异常订单。

对账默认只核对本站记录：

```bash
npm run reconcile:guest-shop
```

该命令默认 `--local-only`。只有值班明确需要核对支付渠道时才加 `--query-provider`；provider 查询失败保持 review，不得自动确认发货。对账输出禁止包含卡密、`claim_secret_hash`、`recovery_code` 或回调原文。

## 数字商品退款与争议

- 游客现金购买的数字商品，若卡密、账号或兑换码尚未领取/展示，可申请原路退款。
- 卡密一旦向用户展示，不自动退款；拒付或 chargeback 期间冻结订单，不得补发。
- NOWPayments 退款暂按人工队列核对收款地址、金额、交易哈希和出款凭证。
- 死信只允许单笔解锁，禁止批量重放。

## 隐私、保留与删除

游客现金购买只保存取货口令与联系方式的 HMAC 或哈希。财务、支付、退款与争议记录在争议处理期内不删除，并依法保留至义务届满。当前设备取货凭证使用 HttpOnly Cookie。告警、对账和后台列表都不得回显明文口令或卡密。

凭证访问审计默认保留 30 天（允许配置范围 7–180 天），由独立 retention 开关控制。关闭凭证功能
不等于删除或停止清理：按上面的回滚矩阵继续运行 worker，直到历史访问审计跨过保留窗口并完成清理。

## 回调丢失或 provider 已付款、本地未确认

1. 用 provider 订单号和本站 `order_no` 查询 provider 状态。
2. 对照 `guest_shop_payment_events`、`guest_shop_payment_orders` 和订单状态，确认金额、币种、站点、用途均一致。
3. 仅在 provider 终态已验证且事件幂等键未成功处理时，登记补偿事件并运行 worker；禁止手工直接改库存为 `sold`。
4. provider 查询失败或字段不一致时保持 `review`，不得发货，记录下一次重试时间。

## 本地已确认、provider 状态异常

暂停自动补发，保留已落库回调原文哈希和验签结果，联系支付渠道确认是否拒付/争议。若确认退款或拒付，走幂等退款流程；已展示卡密的订单不得自动重复发货。

## 已付款但无库存

订单进入 `paid_unfulfillable`，保留支付和预占证据，创建退款或人工履约队列。运营可选择同等商品补发或原路退款，必须二次确认并写入审计；关闭游客开关不会影响该队列。

## 后台写路径（退款 / 补发 / 解锁死信）

只读异常列表不是运营完成。写操作入口在 Admin Studio 商城「游客异常订单」表的「操作」列，复用现有 `shop-refund-modal` 二次确认，不另做高饱和仪表盘。

权限与契约：

- 权限：现有 `shop.manage`，不发明第二套管理员体系
- 接口：`POST /api/admin?route=shop/guest-orders`
- body：`{ "action", "orderId", "confirm": true, "reason": "8-500 chars", "site": "cn|intl|all" }`
- `action` 白名单：`request_refund` | `manual_fulfill` | `unlock_dead_letter`
- `confirm !== true` → 400；原因不足 8 字 → 400
- 20260914 RPC 已在目标数据库安装（verify 5/5 PASS）。若生产代码尚未发布到该 commit，handler 仍可能 503；SQL 通过不等于可运营
- 响应只回 `orderId/orderNo/payment/fulfillment/refund/reservation`。禁止回吐卡密、claim hash、`recovery_code`、`inventory_id`
- 成功后写 `writeAdminAuditLog`，`actionType` 分别为 `shop.guest_order.request_refund` / `manual_fulfill` / `unlock_dead_letter`

操作规则：

1. **申请退款**  
   仅当 `payment_status=confirmed` 或 `fulfillment_status=paid_unfulfillable`。已 `refunded/chargeback/succeeded/manual_review` 拒绝。有活动 worker 租约拒绝。第一次申请把 `refund_status=none` 改成 `pending`，由 worker 继续处理；已 `pending/failed` 的订单保持原退款状态并记录原因。NOWPayments 退款仍按人工队列核对收款地址、金额、交易哈希后再完成。

2. **补发库存**  
   仅 `paid_unfulfillable` + `payment_status=confirmed` + `quantity=1`，且退款不在 `pending/succeeded/manual_review`。人工发货快照拒绝。RPC 用 `FOR UPDATE OF i SKIP LOCKED` 领取同 SKU 非共享 `available` 库存，直接 `available→sold`，并把唯一 reservation 行改绑到新库存。后台和接口都 **不返回 content**。游客之后走原来的取货口令领取。

3. **解锁死信**  
   只允许单笔，禁止批量重放。确认无活动履约/退款租约后，把订单 `dead_letter` 改回 `failed`，清 worker metadata 死信标记并重置 attempt。`refund_status in (pending, failed)` 的订单解锁后仍应被 worker 扫到，不得因为曾经 dead_letter 就被 skip。

值班注意：

- 有活动租约时先等 worker，不要连点解锁/补发
- 连续 503 先停扩大商品范围，再检查 SQL 是否已执行、verify 是否已发布到对应 commit
- 不要在列表页、toast、审计详情里展示 secret
- 关闭游客开关不会取消这些写路径；已付款订单仍可退款或补发

## 履约 worker 崩溃、重试和死信

租约过期后只允许带 `task_id + order_id + status` 条件重试。达到重试上限进入 `dead_letter`，人工检查库存是否已消费、支付是否终态，再执行单笔重放。重放前先确认旧 worker 没有活动租约。不要从 journal 或后台批量重放；只走上面的「解锁死信」按钮。

## 退款悬挂或失败

保持订单不可再次领取，记录 provider 查询结果、退款请求号和重试次数。网关超时不得盲目重复退款；先查退款状态，确认未成功后再使用相同幂等键重试。超过 2 小时升级财务并通知用户。

## 跨设备找回与凭证

跨设备查询统一进入 `/guest-orders.html`，使用下单邮箱 + 查询密码；订单号只能作为已认证会话中的可选筛选/定位条件，不能单独查询或取货。历史未绑定订单如需处理，走客服/运营人工核验，并由管理员签发一次性找回链接。订单履约仍由服务端 `Secure; HttpOnly; SameSite=Lax` claim proof 授权；取货凭证只用于履约和内部 break-glass，不得展示、复制或进入 URL、日志、埋点、支付 metadata。

## 关闭游客开关与回滚

关闭商品游客开关后，API 应拒绝新游客订单；已付款订单继续由 worker 履约或退款。数据库迁移不回滚、不删除业务记录。恢复开关前先确认死信、退款和库存异常队列已有人负责。

若同时回滚邮箱 + 查询密码能力，只关闭凭证与查询页开关；
`GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED` 保持 `true`，并继续运行 guest-shop worker。
完成保留期清理后再单独评审是否关闭 retention，禁止在同一次紧急回滚中一起关闭三个开关。

## 证据留存

每次事故至少保存：订单号、provider 订单号、事件键、金额/币种、状态转移、库存/预占 ID、退款结果、操作者、时间和最终处置。禁止保存 claim secret、完整卡密或支付密钥。

### 恢复的历史促销归档片段

以下内容从已确认的历史工作提交恢复，仅用于保留原始证据和状态，不改变当前开关、数据库或验收结论。

> **禁止只改 env 就把 `GUEST_SHOP_MAX_QUANTITY` 调到 ≥2**：C-D3/C-D4/C-D5 的只读 verify 已在 2026-09-22 返回 11/11 `ok=true`（见 `docs/guest-shop-promo-hardening-plan.md` §23.11 与 `docs/guest-shop-promo-evidence.md` §2.13）。schema 通过不等于卡 7 的实机拒绝通过，也不等于卡 7 整卡通过。C-D3/C-D4 拒绝半项和原价 TTL 物理释放已经闭合，但促销单的库存与预算同时归还、以及运营证据还没做。放开多件之前数量保持 1。

> **闸门已经在目标库，原价单件也会撞上。** 20260924 的 C-D3/C-D4 不看优惠码。重新打开游客 SKU 后，非共享 source-chain 卡密不超过 5 张时，第一笔未付款单就会被 C-D3 拒绝；同一邮箱或同一 IP 的第 3 笔未付款单会被 C-D4 拒绝。库存只有 6 到 10 张时，第 2 笔会先被 C-D3 拒绝；单独证明 C-D4 至少要 11 张非共享卡。买家都只看到 `guest_promo_safety_limit`。这不是把数量调到 2，也不是开促销。C-D4 拒绝半项、TTL 物理释放和 C-D3 拒绝半项已闭合。C-D3 用「沙箱CD3」打了一笔原价 HTTP 409；回读证明没有订单、5 张仍 available、全库未过期未付款 held 少于 2。卡 7 仍是 PARTIAL，因为历史偏差格还要求促销单 TTL 后库存与预算同时归还，这次没有券，也没有预算消耗。见 `docs/guest-shop-promo-evidence.md` §2.22。「沙箱CD3」的游客开关已在 Admin Studio 关掉并回读闭合，不要再打开，不要用 SQL 改。商品仍上架，登录积分商城可能还能看到这 5 张；本步不要求下架。促销 TTL 归还已确认专用商品「沙箱CD7」，并打过一笔公开 500 的促销 commit。回读判语以「没有留下订单」开头。内部原因是 `guest_promo_order_ttl_invalid`：订单 `created_at` 仍默认 `NOW()`，促销 `expires_at` 用 `clock_timestamp()` 加 600 秒，延迟触发器在提交时回滚。现行步骤先执行 `supabase/migrations/20260926_guest_shop_promo_ttl_clock.sql`，再执行 `supabase/migrations/20260926_verify_guest_shop_promo_ttl_clock.sql`。三行 `ok=true` 之前不要建单。见 `docs/guest-purchase-task-2.0.md` §61.37。不要复用「沙箱CD3」，不要再 commit，不要付款。三行验证已贴回，现行记录改到 §61.38。下一笔还没打，尚未建单。持有回读是 `supabase/sandbox/S154_cd7_promo_hold_readback.sql`，到期回读是 `supabase/sandbox/S154_cd7_promo_expiry_readback.sql`。未到 `expires_at` 不是失败。不要提前截止时间。
| `guest_promo_safety_limit` | 409 | 暂时不能创建订单。这个商品当前可售数量较少，或你还有未支付的游客订单。请稍后再试。 | C-D3 与 C-D4 仍共用这一个对外码。内部细码是 `guest_stock_hold_limit` 或 `guest_open_orders_limit`，响应里看不到。文案同时说出两种买家能理解的原因，避免像故障；不要改成两句不同的话去区分库存占比和并发未付款单。原价、数量 1 也会命中 |
- `promo_budget_exhausted_count`：15 分钟内达到 5 次预算耗尽拒绝时，发出 `guest_shop_promo_budget_exhausted` 告警；优惠保持 fail-closed，核查流量和预算配置，原价购买路径应继续可用。阈值可由 `GUEST_SHOP_MONITOR_PROMO_BUDGET_EXHAUSTED_WINDOW_MINUTES` 与 `GUEST_SHOP_MONITOR_PROMO_BUDGET_EXHAUSTED_COUNT_THRESHOLD` 收紧或调整。
预算耗尽事件只读取 `guest_shop_promo_breaker_events` 的 `id/kind/site/occurred_at`，不读取 `detail`，避免告警路径接触联系方式/IP 等身份摘要。

   仅 `paid_unfulfillable` + `payment_status=confirmed` + `quantity` 在 `1..5`，且退款不在 `pending/succeeded/manual_review`。人工发货快照拒绝。L1 多件订单会先锁定整组 reservation（`order_id` 下按 `created_at, id` 排序），已 `consumed` 的卡必须仍是 `sold` 且非共享；只替换 `released` 或仍 `held` 的行，逐张用 `FOR UPDATE OF i SKIP LOCKED` 领取同来源 SKU 的非共享 `available` 库存并改为 `sold`。所有替换成功后才把订单改为 `delivered`；任一张库存不足时事务原子失败，不留下部分补发，应转退款或稍后重试。RPC 更新既有 reservation，不插入新行；后台和接口都 **不返回 content、claim secret、recovery code 或 inventory_id**。游客之后走原来的取货口令领取。

2026-09-22 15:34（Asia/Shanghai）已留下 1 笔未付款促销单 `GS2026092207342938190F2B83D5ACF`，commit HTTP 201，应付 9.09。持有回读还没贴回。请立刻重跑 `supabase/sandbox/S154_cd7_promo_hold_readback.sql`。不要再打第二笔，不要付款，不要提前截止时间。卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

2026-09-22 持有回读已贴回，判语以「持有已闭合」开头。订单 `GS2026092207342938190F2B83D5ACF`，`ttl_seconds` 599.848。到期回读还没贴回。北京时间 15:44:29 之后再跑 `supabase/sandbox/S154_cd7_promo_expiry_readback.sql`。未到 `expires_at` 不是失败。不要再打第二笔，不要付款，不要提前截止时间。卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

2026-09-22 到期回读已贴回，判语以「归还已闭合」开头。订单 `GS2026092207342938190F2B83D5ACF`，`seconds_until_expiry` -128.353，释放原因 `expired`。非共享 available 回到 6，游客 held 为 0，券计数和当日预算回到 0，`cn_budget_is_today=true`。订单行仍记着抵扣 1.00，不要改成 0。这仍不是整卡 PASS，不要回写九项历史表。「沙箱CD7」游客开关还没关。下一步只取消它的「允许游客购买」，再跑 `supabase/sandbox/S154_cd7_switch_off_readonly.sql`。不要付款，不要再打一笔，不要提前截止时间。卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

2026-09-22 开关回读已贴回，判语以「游客开关已关」开头。商品「沙箱CD7」/「默认规格」，`5f940176-8059-443a-b5fd-79adc883a810` / `c955f03a-8cd6-44b8-b751-06e2ad66d4cd`，单价 10.00。`product_allow_guest=false`，`sku_allow_guest` 为空，`effective_guest=false`，`guest_switch_off=true`。商品和规格仍上架。登录积分商城可能还能看到这 6 张。本步不要求下架。游客订单 1、支付行 1、已释放预占 1、held 0，非共享 available 6，两级 `stock_count` 都是 6，付款类计数都是 0。不要再打开游客开关，不要建单，不要付款。订单行仍记着抵扣 1.00，不要改成 0。这仍不是整卡 PASS，不要回写九项历史表。卡 8 会打开全局促销熔断并要求一笔原价购买，等于要把刚关上的游客开关再打开，本步不授权。卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

2026-09-22 用户要求按计划继续。卡 8 现行步骤只做熔断基线，只跑 `supabase/sandbox/S154_cd8_breaker_baseline_readonly.sql`。全文一条 SELECT，不调用 `fn_guest_shop_promo_status()`。`baseline_verdict` 以「基线通过」开头才算这半步。不要打开熔断，不要补插缺行。`guest_promo_halted` 由数据库闸在预算之前返回，不要为了看见它打开 `GUEST_SHOP_DISCOUNT_ENABLED`。原价购买会重新打开「沙箱CD7」，本步不授权。不要建单，不要付款。订单 `GS2026092207342938190F2B83D5ACF` 的抵扣 1.00 不要改成 0。卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

2026-09-22 基线已贴回，`baseline_verdict` 以「基线通过」开头。`breaker_state=closed`，`state_exclusive_ok=true`，事件计数全是 0，`manual_open_count=0`，`manual_close_count=0`。CN 日预算 20.00，当日已用 0.00，日期 2026-09-22，intl 关闭且日预算 0.00。现行步骤只打开熔断正好一次：`node supabase/sandbox/s154-guest-promo-toolbox.js breaker open --actor s154-card8 --reason "S154 第8项" --yes`。然后 `node supabase/sandbox/s154-guest-promo-toolbox.js gate --site cn --amount 1.00`。期望 `allowed=false`、code=`guest_promo_halted`。工具箱把这行印成「未通过 / 需要人工判读」是预期业务结果，退出码仍是 0，不要因此重试，也不要打开 `GUEST_SHOP_DISCOUNT_ENABLED`。最后跑 `supabase/sandbox/S154_cd8_breaker_open_readonly.sql`。全文一条 SELECT。`open_verdict` 以「打开半步通过」开头才算这半步。不要合闸，不要建单，不要付款。不要打开「沙箱CD7」或「沙箱CD3」。订单 `GS2026092207342938190F2B83D5ACF` 的抵扣 1.00 不要改成 0。卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

不要第二次打开。不要跑 `S154_fixture_setup.sql` 或 `S154_cleanup.sql`。cleanup 在 open 时会自己合闸并补 `manual_close`。原价购买会重新打开「沙箱CD7」，本步不授权。`GUEST_SHOP_MAX_QUANTITY` 保持 1。卡 9 还没开始。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。卡 7 继续 PARTIAL，不得改写成整卡 PASS。

2026-09-22 打开半步已贴回，`open_verdict` 以「打开半步通过」开头。`breaker_state=open`，`opened_by=s154-card8`，`breaker_reason=S154 第8项`，`opened_at=2026-09-22 09:00:51.533097+00`，`manual_open_count=1`，`manual_close_count=0`。CN 日预算 20.00，当日已用 0.00，日期 2026-09-22，intl 关闭且日预算 0.00。gate 为 `allowed=false`、code=`guest_promo_halted`，退出码 0。工具箱印「未通过 / 需要人工判读」是预期，不要因此重试，也不要打开 `GUEST_SHOP_DISCOUNT_ENABLED`。合闸已经执行正好一次，不要再跑：`node supabase/sandbox/s154-guest-promo-toolbox.js breaker closed --actor s154-card8 --reason "S154 第8项恢复" --yes`。返回 `closed`，`closed_by=s154-card8`，`closed_at=2026-09-22 09:18:20.678679+00`（北京时间 17:18:20），熔断行 reason 为空是预期。随后 `node supabase/sandbox/s154-guest-promo-toolbox.js gate --site cn --amount 1.00` 已执行，`allowed=true`、code=`ok`，退出码 0。不要重复合闸。现行步骤只跑 `supabase/sandbox/S154_cd8_breaker_close_readonly.sql`。全文一条 SELECT。`close_verdict` 以「合闸半步通过」开头才算这半步。以「还是 open」开头不是失败。合闸会把熔断行 reason 清空，关闭原因只留在 manual_close 事件。不要再打开，不要建单，不要付款。不要打开「沙箱CD7」或「沙箱CD3」。订单 `GS2026092207342938190F2B83D5ACF` 的抵扣 1.00 不要改成 0。原价购买不在这一步。卡 8 合闸后仍不是整卡 PASS，不得改写成整卡 PASS。卡 9 还没开始。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。卡 7 继续 PARTIAL。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

2026-09-22 合闸回读已贴回，`close_verdict` 以「合闸半步通过」开头。`breaker_state=closed`，`closed_by=s154-card8`，`closed_at=2026-09-22 09:18:20.678679+00`（北京时间 17:18:20），`manual_open=1`，`manual_close=1`。熔断行 reason 为空是预期。同一轮 gate 已是 `allowed=true`、code=`ok`。不要再合一次，不要再打开。现行步骤只跑 `supabase/sandbox/S154_cd9_budget_baseline_readonly.sql`。全文一条 SELECT。`baseline_verdict` 以「基线通过」开头才算这半步。CN 日预算应仍是 20.00，已用 0.00，日期 2026-09-22，intl 仍关闭。不要改 `v_phase`，不要切 `BUDGET_TIGHT`，不要跑夹具，也不要跑 `S154_fixture_setup.sql` 或 `S154_cleanup.sql`。不要打开熔断，不要打开「沙箱CD7」或「沙箱CD3」，不要建单，不要付款，不要开 `GUEST_SHOP_DISCOUNT_ENABLED`。卡 9 模板里的支付、`guest_promo_budget_exhausted` 和原价可买都不在这一步。夹具会把 CN 日预算改成 1.00 并归零计数。原价购买会重新打开「沙箱CD7」。告警链路未接线，不能据此把卡 9 写成整卡 PASS。订单 `GS2026092207342938190F2B83D5ACF` 的抵扣 1.00 不要改成 0。卡 8 合闸后仍不是整卡 PASS，不得改写成整卡 PASS。卡 7 继续 PARTIAL。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

2026-09-22 卡 9 只读预算基线已贴回，`baseline_verdict` 以「基线通过」开头。`breaker_state=closed`，`closed_by=s154-card8`，`closed_at=2026-09-22 09:18:20.678679+00`，`manual_open=1`，`manual_close=1`。CN 日预算仍是 20.00，已用 0.00，日期 2026-09-22，intl 仍关闭。Codex 没有执行这条 SQL。这一轮没有新的 SQL。不要改 `v_phase`，不要切 `BUDGET_TIGHT`，不要跑夹具，也不要跑 `S154_fixture_setup.sql` 或 `S154_cleanup.sql`。不要打开熔断，不要打开「沙箱CD7」或「沙箱CD3」，不要建单，不要付款，不要开 `GUEST_SHOP_DISCOUNT_ENABLED`。

卡 9 基线通过不是整卡 PASS。模板里的支付、`guest_promo_budget_exhausted` 和原价可买都不在这一轮。夹具会把 CN 日预算从 20.00 改成 1.00 并归零计数。原价购买会重新打开「沙箱CD7」，公开 6 张 ¥10 的卡。告警链路未接线，没有 webhook、邮件或 IM，不能据此把卡 9 写成整卡 PASS。证据 §2.6 仍是全部未执行，卡 4 的券配额仍是「⬜ 未执行」。切 `BUDGET_TIGHT` 前要先抄卡 4，这一轮不补做卡 4，也不回写 §2.6。订单 `GS2026092207342938190F2B83D5ACF` 的抵扣 1.00 不要改成 0。卡 8 合闸后仍不是整卡 PASS，不得改写成整卡 PASS。卡 7 继续 PARTIAL。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

2026-09-22 卡 9 只读预算基线已贴回，`baseline_verdict` 以「基线通过」开头。上一节写入时这一轮没有新的 SQL。`breaker_state=closed`，`closed_by=s154-card8`，`closed_at=2026-09-22 09:18:20.678679+00`，`manual_open=1`，`manual_close=1`。CN 日预算仍是 20.00，已用 0.00，日期 2026-09-22，intl 仍关闭。抄录尚未贴回。现行步骤只跑 `supabase/sandbox/S154_cd9_card4_snapshot_readonly.sql`。全文一条 SELECT，不调用 `fn_guest_shop_promo_status()`，也不调用 `fn_guest_shop_promo_set_breaker`。`snapshot_verdict` 以「抄录通过」开头才算这半步。抄的是 `SBXPROMO10` 和 `SBXQUOTA2` 的游客计数、让利总额，以及按券汇总的台账行数和金额，不输出联系人或 IP。这不是卡 4 PASS。证据 §2.6 仍是全部未执行，卡 4 的券配额仍是「⬜ 未执行」。不要回写 §2.6。计数不是 0 时留下本行，这一轮仍不要切。写着异常不是邀请去修。不要改 `v_phase`，不要切 `BUDGET_TIGHT`，不要跑夹具，也不要跑 `S154_fixture_setup.sql` 或 `S154_cleanup.sql`。不要打开熔断，不要打开「沙箱CD7」或「沙箱CD3」，不要建单，不要付款，不要开 `GUEST_SHOP_DISCOUNT_ENABLED`。卡 9 模板里的支付、`guest_promo_budget_exhausted` 和原价可买都不在这一步。夹具会把 CN 日预算从 20.00 改成 1.00 并归零计数。原价购买会重新打开「沙箱CD7」，公开 6 张 ¥10 的卡。告警链路未接线，没有 webhook、邮件或 IM，不能据此把卡 9 写成整卡 PASS。订单 `GS2026092207342938190F2B83D5ACF` 的抵扣 1.00 不要改成 0。卡 8 合闸后仍不是整卡 PASS，不得改写成整卡 PASS。卡 7 继续 PARTIAL。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。


2026-09-22 用户贴回 `supabase/sandbox/S154_cd9_card4_snapshot_readonly.sql`，正好 1 行。Codex 没有执行这条 SQL。`snapshot_verdict` 以「抄录通过」开头。`SBXPROMO10` 与 `SBXQUOTA2` 都是 percent、结算比例 90、active、站点 cn。`SBXPROMO10` 的 `guest_max_uses` 是 50、让利上限 50.00；`SBXQUOTA2` 的 `guest_max_uses` 是 2、让利上限 30.00。两边 `guest_used_count`、`used_count`、`guest_discount_total` 都是 0。`SBXPROMO10` 台账 1 行且已归还，抵扣 1.00；`SBXQUOTA2` 台账 0 行。`breaker_state=closed`，`closed_by=s154-card8`，`closed_at=2026-09-22 09:18:20.678679+00`，`manual_open=1`，`manual_close=1`。CN 日预算仍是 20.00，已用 0.00，日期 2026-09-22，intl 仍关闭。两个沙箱游客开关仍关。「沙箱CD7」游客订单 1，付款类 0；「沙箱CD3」游客订单 0。订单 `GS2026092207342938190F2B83D5ACF` 仍未付款，预占已释放，抵扣仍是 1.00。这一轮没有新的 SQL。这不是卡 4 PASS，也不是卡 9 整卡 PASS。卡 9 基线通过不是整卡 PASS。证据 §2.6 仍是全部未执行（0/9），卡 4 的券配额仍是「⬜ 未执行」。不要回写 §2.6。现有夹具仍指向「测试」¥0.01 和「测试 2」¥144.00，重跑会改写 CN 日预算并归零计数。不要改 `v_phase`，不要切 `BUDGET_TIGHT`，不要跑夹具，也不要跑 `S154_fixture_setup.sql` 或 `S154_cleanup.sql`。不要打开熔断，不要打开「沙箱CD7」或「沙箱CD3」，不要建单，不要付款，不要开 `GUEST_SHOP_DISCOUNT_ENABLED`。卡 9 模板里的支付、`guest_promo_budget_exhausted` 和原价可买都不在这一轮。原价购买会重新打开「沙箱CD7」，公开 6 张 ¥10 的卡。告警链路未接线，没有 webhook、邮件或 IM，不能据此把卡 9 写成整卡 PASS。写着异常不是邀请去修。不调用 `fn_guest_shop_promo_status()`，也不调用 `fn_guest_shop_promo_set_breaker`。订单抵扣 1.00 不要改成 0。卡 8 合闸后仍不是整卡 PASS，不得改写成整卡 PASS。卡 7 继续 PARTIAL。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。
2026-09-22 切预算前的卡 4 抄录已贴回。结果尚未贴回。整份执行 `supabase/sandbox/S154_cd9_cd7_budget_tighten.sql`，不要只跑最后一条 SELECT。Codex 不执行这条 SQL。它只把已有 CN 日预算从 20.00 收到 1.00，不改已用、日期、intl、券、熔断或游客开关。`tighten_verdict` 以「收紧半步通过」开头，才表示这一次从 20.00 收到 1.00；以「本次没有再改」开头不是失败；以「看不清」开头表示没有本次标记，请整份再跑，不要手工改数字。不要把 20.00 写回去。写着异常不是邀请去修。CN 日预算是全站上限，不是「沙箱CD7」私有。生产「测试」`52246f1d-b98d-4920-9129-581296f43de9`（¥0.01）游客入口可能仍开，「测试 2」`c16212d8-6ad8-4b3c-831c-3cc68b2d7a52` 是 ¥144。原价不消耗预算。打开「沙箱CD7」会公开 6 张 ¥10 的卡。0.00 加 1.00 可以通过门禁，第二笔 1.00 才是 `guest_promo_budget_exhausted`，这一步两笔都不建。1.00 过了当天也不会自己回到 20.00。预算表没有触发器；表开了 RLS 且没有策略，改到 0 行就停，不要加策略。告警没有 webhook、邮件或 IM，只能记 N/A。订单 `GS2026092207342938190F2B83D5ACF` 的抵扣 1.00 不要改成 0。这不是卡 4 PASS，也不是卡 9 整卡 PASS。证据 §2.6 仍是 0/9，卡 4 仍是「⬜ 未执行」。不要回写 §2.6。不要改 `v_phase`，不要切 `BUDGET_TIGHT`，不要跑夹具或 cleanup。不调用 `fn_guest_shop_promo_status()`，不调用 `fn_guest_shop_promo_set_breaker`，也不调用 `guest_shop_promo_gate`。不要打开熔断，不要打开「沙箱CD7」或「沙箱CD3」，不要建单，不要付款，不要开 `GUEST_SHOP_DISCOUNT_ENABLED`。卡 7 继续 PARTIAL，不得改写成整卡 PASS。卡 8 合闸后仍不是整卡 PASS。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

2026-09-22 用户贴回 `supabase/sandbox/S154_cd9_cd7_budget_tighten.sql`，正好 1 行。Codex 没有执行这条 SQL。`tighten_marker=updated`，`tighten_verdict` 以「收紧半步通过」开头。`breaker_state=closed`，`closed_by=s154-card8`。CN 启用，日预算 1.00，已用 0.00，日期 2026-09-22。intl 关闭，日预算 0.00，已用 0.00，日期 2026-09-22。不要重跑这份收紧脚本。第二次整份重跑看到「本次没有再改」不是失败，但这一轮不要再跑。不要把 20.00 写回去。以「看不清」开头仍然不是这半步的完成判语。写着异常不是邀请去修。这一轮没有新的 SQL。CN 日预算是全站上限，不是「沙箱CD7」私有。生产「测试」`52246f1d-b98d-4920-9129-581296f43de9`（¥0.01）游客入口可能仍开，「测试 2」`c16212d8-6ad8-4b3c-831c-3cc68b2d7a52` 是 ¥144。原价不消耗预算。打开「沙箱CD7」会公开 6 张 ¥10 的卡。0.00 加 1.00 可以通过门禁，第二笔 1.00 才是 `guest_promo_budget_exhausted`。这一轮两笔都不建。1.00 过了当天也不会自己回到 20.00。卡 9 模板里的支付、打满拒绝实机和原价可买都不在这一轮。支付和原价购买都会重新打开「沙箱CD7」。本贴回不授权。告警没有 webhook、邮件或 IM，只能记 N/A，不能据此把卡 9 写成整卡 PASS。这不是卡 4 PASS，也不是卡 9 整卡 PASS。证据 §2.6 仍是 0/9，卡 4 仍是「⬜ 未执行」。不要回写 §2.6。不要改 `v_phase`，不要切 `BUDGET_TIGHT`，不要跑夹具或 cleanup。不调用 `fn_guest_shop_promo_status()`，不调用 `fn_guest_shop_promo_set_breaker`，也不调用 `guest_shop_promo_gate`。不要打开熔断，不要打开「沙箱CD7」或「沙箱CD3」，不要建单，不要付款，不要开 `GUEST_SHOP_DISCOUNT_ENABLED`。订单 `GS2026092207342938190F2B83D5ACF` 的抵扣 1.00 不要改成 0。卡 7 继续 PARTIAL，不得改写成整卡 PASS。卡 8 合闸后仍不是整卡 PASS。卡 9 收紧半步通过不是整卡 PASS。`GUEST_SHOP_MAX_QUANTITY` 保持 1。不得应用 `supabase/migrations/20260925_guest_shop_promo_gates.sql`。阶段 5 保持 `in_progress`，总进度保持 80%（4/5）。

2026-09-23 用户贴回卡 9 支付回读，结果为「支付半步通过」。订单与支付 confirmed，四项验证标志全真，实付/应付 9.09、订单手续费 0.09；履约 delivered、预占 consumed、库存 sold。促销预算仍记录在 2026-09-22，CN 上限/已用 1.00/1.00，intl 关闭。不要滚动预算日期、清零或恢复 20.00。此证据不代表卡 9 整卡 PASS，也不闭合卡 2；不要再次付款、建单、踢 worker 或重开游客商品。
