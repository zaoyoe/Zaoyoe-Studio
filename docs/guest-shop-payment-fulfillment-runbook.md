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

执行合同见 `docs/guest-purchase-task-2.0.md`。

## 游客应付金额

游客支付宝（ZPay）和 USDT（NOWPayments）的应付金额必须自动等于 **商品价 + 1% 通道手续费**。后台 stored `surcharge_rate=0` 或空值时回退 1%，不要让用户在支付宝/钱包里手改金额。测试 SKU `¥0.01` 加 1% 后向上取整为 `¥0.02`，这是预期。旧未付款会话仍是旧金额，必须先点「关闭当前订单」再重新创建；少付不会 confirm，也不会发货。


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
cd /opt/zaoyoe-verify-server
docker compose up -d --no-deps --force-recreate --no-build verify-server
curl -fsS http://127.0.0.1:3001/healthz
```

`docker restart` 不会重读 `env_file`，容器会继续用旧密钥，worker 会 401/503。
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

上线前执行只读检查：

```bash
npm run readiness:guest-shop -- --env-file server/.env.production --fail-on-invalid
```

该命令不会连接数据库或输出 secret。`--fail-on-invalid` 只拦截格式、密钥、数值和代码契约等
自动化硬错误；即使进程返回 0，也不代表可以打开游客商品。provider 启用状态、商品 allowlist、
限流 RPC 和支付平台后台配置仍必须由值班人员人工核对。

需要把 readiness 当作“启用前”硬闸门时，再显式开启严格模式：

```bash
npm run readiness:guest-shop -- --env-file server/.env.production --fail-on-invalid --fail-on-not-ready
```

退出码约定如下：`0` 表示本次请求的闸门均通过；`2` 表示 `--fail-on-invalid` 发现硬错误；`3`
表示 `--fail-on-not-ready` 发现 `operational_ready=false`（未识别 production、仍有人工/数据库
复核项或存在其他未闭环证据）。当前脚本是刻意不连接数据库/provider 的离线检查器，因此在
人工证据尚未接线时，严格模式返回 `3` 是预期的 fail-closed 结果；不得用 `|| true` 忽略，也不得
据此打开游客商品。只有在目标 Supabase、支付平台、KVM4 worker 和沙箱证据均归档后，才可将严格
模式作为发布/启用检查的一部分。

readiness 未完成人工复核不得打开游客商品。

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

20260915 积分价 SQL 已在目标库执行；verify 1-7 PASS。第 8 项 `REVIEW` 只表示当前有 1 个商品
开了 `allow_guest_purchase`，不是约束失败。内部测试最多保留这一个低价值、非共享、自动发货 SKU；
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

订单号只能查询非敏感状态，不能单独取货。跨设备必须提供高熵取货口令或人工核验；口令仅存 HMAC，不能进入 URL、日志、埋点或支付 metadata。当前设备优先使用 `Secure; HttpOnly; SameSite=Lax` Cookie。

## 关闭游客开关与回滚

关闭商品游客开关后，API 应拒绝新游客订单；已付款订单继续由 worker 履约或退款。数据库迁移不回滚、不删除业务记录。恢复开关前先确认死信、退款和库存异常队列已有人负责。

## 证据留存

每次事故至少保存：订单号、provider 订单号、事件键、金额/币种、状态转移、库存/预占 ID、退款结果、操作者、时间和最终处置。禁止保存 claim secret、完整卡密或支付密钥。
