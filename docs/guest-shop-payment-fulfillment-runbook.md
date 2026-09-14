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

## 上线前配置与 readiness

生产环境必须配置独立的 `GUEST_SHOP_CLAIM_PEPPER`、
`GUEST_SHOP_CLAIM_DERIVATION_PEPPER` 和 `GUEST_SHOP_WORKER_SECRET`，三者均使用
至少 32 字节随机值；两个 claim pepper 必须彼此不同，也不能复用
`SUPABASE_SERVICE_ROLE_KEY`。推荐用以下命令生成：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

如需隔离数据用途，再配置独立的 `GUEST_SHOP_CONTACT_HASH_PEPPER` 和
`GUEST_SHOP_REQUEST_HASH_PEPPER`。生产禁止内存限流，必须启用持久化限流并在目标
Supabase 中确认 `take_rate_limit_tokens` RPC、权限和存储表可用。

worker 只能使用专用 `GUEST_SHOP_WORKER_SECRET` 调用：

```text
POST /api/shop/guest/worker
```

建议由 cron/systemd 每分钟调用一次；禁止仅依赖通用 `CRON_SECRET`。调用 503、无运行记录、
履约积压或 `dead_letter` 增长时立即告警并暂停扩大游客商品范围。

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

NOWPayments 游客网络固定为 `usdtbsc`。NOWPayments 退款暂按人工队列处理，核对收款地址、
金额、交易哈希和出款凭证后再完成退款；不把自动退款视为已就绪。

## 日常指标与告警

- `payment_confirmed_to_delivered_seconds`：P95 > 120 秒告警，P99 > 300 秒升级。
- `paid_unfulfilled_count`：任意非零持续 10 分钟告警。
- `guest_payment_review_count`、`amount_mismatch_count`：出现即进入人工复核。
- `reservation_expired_count`：15 分钟内超过 5 笔，检查释放 worker 和库存锁。
- `refund_pending_age_seconds`：超过 30 分钟告警，超过 2 小时升级财务。
- `dead_letter_count`：任意新增即告警，不得直接批量重放。

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
