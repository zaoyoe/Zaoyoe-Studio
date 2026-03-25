# 测试数据清理 + 安全收尾清单

这份清单按“先验收，再清理，再轮换密钥”的顺序执行。  
所有正式链路都建议统一使用 [https://www.zaoyoe.com](https://www.zaoyoe.com)。  
如果你现在处理的是一次完整发布，而不只是支付专项收尾，先看 [vercel-release-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/vercel-release-checklist.md)。
如果你接下来想把 Telegram / 飞书从“退款异常提醒”扩成整站通知体系，再看 [ops-alert-notification-matrix.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/ops-alert-notification-matrix.md)。

## 1. 支付后台验收

1. 用真实管理员账号登录 [https://www.zaoyoe.com](https://www.zaoyoe.com)。
2. 打开 `/admin-studio.html`，进入 `支付对账`。
3. 依次检查：
   - `支付总览` 的 8 张卡片能显示
   - `最近 24 小时异常趋势` 正常出图
   - `全站收支` 的 `业务收支拆分`、`积分流水分类` 都能正常显示
   - `异常运维` 的 `异常队列`、`最近订单`、`测试数据清理` 正常显示
4. 切换时间范围：
   - 最近 7 天
   - 最近 30 天
   - 自定义日期范围
5. 再确认：
   - 手动刷新可用
   - 自动刷新可用
   - Excel / CSV 导出可用
   - `上次刷新时间` 会更新

## 2. 普通用户权限验收

1. 退出管理员账号，登录普通用户账号。
2. 尝试打开 `支付对账`。
3. 确认：
   - 前端会拦截管理员视图
   - 后端接口不会返回支付数据
   - 即使知道接口地址，也只能看到 `403` 或拦截结果

## 3. 正式域名链路验收

1. 全流程都使用 [https://www.zaoyoe.com](https://www.zaoyoe.com)。
2. 确认：
   - Google 登录完成后，刷新页面仍保留登录态
   - 钱包充值入口正常
   - 订单查询正常
   - 后台支付页正常

## 4. 清理测试数据

1. 用管理员账号进入 `支付对账 -> 异常运维 -> 测试数据清理`。
2. 先点 `重新扫描`。
3. 核对扫描结果只包含：
   - `AUTO_CDX_*` 订单
   - `codex.*@example.com` 账号
4. 再点 `清理测试数据`。
5. 清理完成后再次 `重新扫描`，确认结果为 0，或者只剩明确保留的样本。
6. 如果想做数据库抽查，可核对：
   - `payment_orders`
   - `payment_events`
   - `afdian_orders`
   - `profiles`
   - `points_balance`
   - `points_ledger`
   - `user_checkins`
   - `user_events`

## 5. 轮换 Supabase 高权限密钥

1. 打开 Supabase 项目后台。
2. 进入 `Settings -> API Keys`。
3. 重新生成 / 轮换 `secret/service role key`。
4. 把新的 key 更新到：
   - Vercel 的：
     - `SUPABASE_URL`
     - `SUPABASE_PUBLISHABLE_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `ADMIN_CONFIG_ENCRYPTION_KEY`
     - `PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET`
     - `ADMIN_STUDIO_ACCESS_SECRET`
     - `ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL`（如果仍需远程模拟支付）
   - Railway / verify server 的：
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `ADMIN_CONFIG_ENCRYPTION_KEY`
     - `PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET`
     - `ADMIN_STUDIO_ACCESS_SECRET`
     - `APP_BASE_URL`
     - `ALLOWED_ORIGINS`
     - `TRUSTED_PROXY_IPS`
     - `AFDIAN_WEBHOOK_TRUSTED_PROXIES`
     - `AFDIAN_WEBHOOK_ALLOWED_IPS`
5. 轮换或补齐变量后，先跑：
   - `npm run check:prod-env -- --env-file server/.env.staging --validate-supabase --validate-payment-schema --check-app-runtime`
   - `npm run smoke:payment -- --env-file server/.env.staging --config-only --allow-production-like`
6. `check:prod-env` 现在会额外输出两块关键信息：
   - `app payment auth-check endpoint`
     - `401 Unauthorized` 表示新版本已部署，JWT 探针接口在线
     - `404 Not Found` 表示线上还没 redeploy 到最新代码
   - `Platform env checklist`
     - `Vercel` 和 `Railway / verify server` 各自该补哪些变量，会逐项列出来
   - `SUPABASE_SERVICE_ROLE_KEY`
     - 如果脚本提示它看起来像 `publishable/anon key`，说明 env 文件把公钥塞进了高权限槽位，不能继续上线
7. 如果 `TRUSTED_PROXY_IPS` / `AFDIAN_WEBHOOK_TRUSTED_PROXIES` 还拿不准，先用管理员账号带 Bearer Token 请求：
   - `GET /api/admin/network/request-context`
   - 这个接口会返回当前请求看到的 `socket_ip`、`x-forwarded-for/forwarded`、解析后的 `resolved_client_ip`，以及当前代理链配置缺口
   - 真正的 `AFDIAN_WEBHOOK_ALLOWED_IPS` 仍要结合爱发电官方来源和 Railway 日志确认；当 webhook 因白名单被拦时，日志里现在会打印完整的结构化网络上下文
   - 也可以直接运行：`npm run inspect:proxy-chain -- --env-file server/.env.staging --base-url https://www.zaoyoe.com --admin-email zaoyoe@gmail.com`
   - 该脚本会自动采样线上 Railway 代理链，并输出推荐的 `TRUSTED_PROXY_IPS` / `AFDIAN_WEBHOOK_TRUSTED_PROXIES`
   - 如果爱发电开发者认证还没开通，脚本会建议先把 `AFDIAN_WEBHOOK_ALLOWED_IPS` 设成 `203.0.113.254/32`，让 webhook 先保持 fail-closed，等首个真实回调出现后再替换成真实源 IP
   - 如果想把“当前是不是安全待命”一次性看完，直接运行：`npm run afdian:readiness -- --env-file server/.env.staging --base-url https://www.zaoyoe.com --admin-email zaoyoe@gmail.com`
   - `SAFE_PENDING_AFDIAN_APPROVAL` 就是当前爱发电未开通阶段的目标状态；更多说明见 `docs/afdian-pending-activation-handoff.md`
8. 重新部署：
   - Vercel
   - Railway（如果它依赖这个 key）
   - Railway 的 `Root Directory` 必须指向仓库根目录 `.`，不要再设成 `server`
   - 原因：`server/index.js` 会加载仓库根目录下的共享模块 `api/_lib/*`；如果只部署 `server/` 子目录，进程会在启动前崩掉，最终表现为 `/healthz` 持续 healthcheck failure
   - 如果 Railway 日志里出现 `setup │ deno` 或 `deno cache cloud-functions/...`，说明根目录构建被误判成了 Deno；此时必须确认仓库根目录的 `nixpacks.toml` 已生效，并且部署日志里能看到 `npm ci`
9. 部署后重新验证：
   - 管理员后台
   - 钱包充值
   - 爱发电订单查询
10. 验证通过后，再跑一次只读收尾审计：
   - `npm run audit:payment-closeout -- --env-file server/.env.staging`
   - 如果结果提示 `remote_mock_payment_still_enabled`，说明生产态远程 mock 仍开放，测试完成后应尽快关闭。
   - 如果结果提示 `smoke_payment_artifacts_present` 或 `smoke_users_still_present`，说明专用 smoke 测试痕迹还在，建议去 `支付对账 -> 异常运维 -> 测试数据清理` 做清理。
11. 如果后台尚未部署到带有新 cleanup 规则的版本，或需要命令行收尾，可改用：
   - 预览：`npm run cleanup:payment-fixtures -- --env-file server/.env.staging`
   - 真删：`npm run cleanup:payment-fixtures -- --env-file server/.env.staging --execute`
   - 默认只会清理 `AUTO_CDX_*` / `SMOKE_*` 订单，以及 `codex.*@example.com` / `smoke-payment-*@zaoyoe.invalid` 测试账号。

## 6. 模拟支付收尾

1. 当前 `模拟支付` 只作为临时桥接方案。
2. 在虎皮椒或其它正式支付通道上线后：
   - 关闭 `模拟支付`
   - 保留历史订单对账
   - 不再允许新用户走模拟直充

### 临时开启 mock 的正确顺序

1. 在绑定 [https://www.zaoyoe.com](https://www.zaoyoe.com) 的 `Vercel Production` 环境添加：
   - `ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL=2026-03-28T23:59:59+08:00`
2. 完成一次 `Redeploy`。
3. 先预览存储层切换计划：
   - `npm run sync:payment-channel -- --env-file server/.env.staging --provider mock`
4. 预览输出里必须看到：
   - `target_provider: mock`
   - `runtime.mock_allowed: yes`
5. 再真正切换：
   - `npm run sync:payment-channel -- --env-file server/.env.staging --provider mock --execute`
6. 验证 [https://www.zaoyoe.com/api/payments/config](https://www.zaoyoe.com/api/payments/config)：
   - `config.active_provider = "mock"`
   - `config.providers.mock.enabled = true`
   - `recharge_options.mock_payment_enabled = true`
   - `runtime.mock_payment.allowed = true`

### 测试结束后恢复真实支付

1. 删除 `ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL`。
2. 再次 `Redeploy`。
3. 切回真实通道：
   - `npm run sync:payment-channel -- --env-file server/.env.staging --provider afdian --execute`
4. 复核 [https://www.zaoyoe.com/api/payments/config](https://www.zaoyoe.com/api/payments/config)：
   - `config.active_provider = "afdian"`
   - `config.providers.mock.enabled = false`
   - `recharge_options.mock_payment_enabled = false`
   - `runtime.mock_payment.allowed = false`

## 7. 虎皮椒上线前最少复核项

当前代码状态：
- 虎皮椒已经能真实创建支付
- `/api/payments/hupijiao/webhook` 已能验签、落 `payment_events`、更新 `payment_orders`、自动入账
- `queryOrder` 已接进统一 adapter
- 后台退款流已开放到“异常队列 + 最近订单”，会先查单再退款并写审计
- 已入账/已发点的订单会先扣回积分，再调虎皮椒退款；若网关失败，会按精确 paid / bonus 拆分自动补回积分
- `admin_refund_failed` / `admin_refund_reclaim_failed` / `admin_refund_compensation_failed` 会进入退款专题，并给管理员投递站内 `system_notifications` 告警
- 同一笔退款异常通知带有最近窗口去重，短时间重复重试不会把管理员通知刷爆
- 现在已经支持把高危退款异常异步投递到 Telegram / 飞书；投递走 `ops_alert_jobs` 队列，不会阻塞退款主流程

上线前至少确认这几项：

1. 后台 `payment_channels.active_provider` 已切到 `hupijiao`
2. `merchant_id(APPID)`、`HUPIJIAO_SECRET_KEY`、`notify_url`、`return_url` 已配置完整
3. `notify_url` 指向 Railway 服务端的 `/api/payments/hupijiao/webhook`
4. 至少做 1 笔正式小额联调，确认 `payment_events`、`payment_orders`、`payment_checkout_sessions` 都有联动更新
5. 如果要收紧来源链路，再补：
   - `HUPIJIAO_WEBHOOK_TRUSTED_PROXIES`
   - `HUPIJIAO_WEBHOOK_ALLOWED_IPS`
6. 先执行 migration：`20260324_add_admin_refund_reclaim_rpc.sql`，确认 `fn_deduct_points_admin_site_with_breakdown` 已落库
7. 做 1 笔“已入账订单退款”演练，确认后台会写入：
   - `payment_events.admin_refund_*`
   - `payment_orders.provider_metadata.refund_reclaimed_*`
   - `admin_audit_logs`
8. 如果要启用站外退款异常告警，再执行 migration：`20260324_add_ops_alert_queue.sql`
9. 进入 `Admin Studio -> 设置 -> 站外退款告警`，至少确认：
   - 总开关已开启
   - 至少 1 个外部通道已开启
   - Telegram 已填写 `Chat ID` 且 `Bot Token` 状态显示已配置
   - 或飞书 `Webhook` 状态显示已配置
10. 站外告警密钥管理规则：
   - 后台页面里输入的 Telegram Bot Token / 飞书 Webhook 会进入 `admin_secret_store`
   - 如果状态显示“环境变量”，说明密钥来自部署平台，需去 Vercel / Railway 修改，后台不会直接删除环境变量
11. 启用后可在库里抽查：
   - `ops_alert_jobs`
   - `ops_alert_job_attempts`
   - 重点看 `status`、`remaining_channels`、`last_error`
12. 后台日常巡检入口：
   - `支付对账 -> 支付总览 -> 站外告警投递`
     - 看当前范围内的送达、重试和死信数量
   - `支付对账 -> 异常运维 -> 站外告警队列`
     - 对死信任务可直接 `登记重试`
     - 对无需继续推送的任务可 `标记已处理`
