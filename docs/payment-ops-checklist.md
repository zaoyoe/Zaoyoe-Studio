# 测试数据清理 + 安全收尾清单

这份清单按“先验收，再清理，再轮换密钥”的顺序执行。  
所有正式链路都建议统一使用 [https://www.zaoyoe.com](https://www.zaoyoe.com)。

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
   - Vercel 的 `SUPABASE_SERVICE_ROLE_KEY`
   - Railway / verify server 的 `SUPABASE_SERVICE_ROLE_KEY`（如果该服务也在使用）
5. 如果你打算一并轮换后台加密种子，再同步更新：
   - `ADMIN_CONFIG_ENCRYPTION_KEY`
6. 重新部署：
   - Vercel
   - Railway（如果它依赖这个 key）
7. 部署后重新验证：
   - 管理员后台
   - 钱包充值
   - 爱发电订单查询

## 6. 模拟支付收尾

1. 当前 `模拟支付` 只作为临时桥接方案。
2. 在虎皮椒或其它正式支付通道上线后：
   - 关闭 `模拟支付`
   - 保留历史订单对账
   - 不再允许新用户走模拟直充

## 7. 后续接入虎皮椒时的最低要求

后续接虎皮椒时，不要再新写一套散落逻辑，直接补到统一 provider adapter：

1. `createCheckout`
2. `verifyWebhook`
3. `queryOrder`
4. `refund`
5. 自动入账
6. 异常回调记录到 `payment_events`
