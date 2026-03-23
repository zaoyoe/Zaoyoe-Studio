# 爱发电待开通阶段交接

这份 handoff 只处理一种状态：站点支付安全已经收口，但爱发电开发者认证还没开通，所以真实 webhook 白名单只能先保持 `fail-closed`。

## 当前目标状态

当下面这条命令返回 `SAFE_PENDING_AFDIAN_APPROVAL` 时，就说明当前环境已经进入“安全待命”：

```bash
npm run afdian:readiness -- --env-file server/.env.staging --base-url https://www.zaoyoe.com --admin-email zaoyoe@gmail.com
```

这个状态的含义是：

- 生产态远程 mock 支付已经关闭
- smoke 测试订单 / 测试账号已经清理干净，或没有遗留
- Railway 代理链已经被正确信任，`resolved_client_ip` 不再停留在 `100.64.0.x`
- `AFDIAN_WEBHOOK_ALLOWED_IPS` 仍然是 `203.0.113.254/32`
  - 这是刻意保留的 `fail-closed` 占位值
  - 它的作用是“在未认证阶段先拦住所有 webhook”

## 一条命令能看什么

`npm run afdian:readiness` 会自动串三件事：

1. 读取 env 文件并执行 `audit:payment-closeout`
2. 调用 Railway 的 `/api/admin/network/request-context` 采样代理链
3. 汇总成一个明确状态，并给出下一步动作

输出里最关键的是：

- `status`
- `proxy_inspection`
- `recommended_env`
- `next_steps`

## 状态说明

- `SAFE_PENDING_AFDIAN_APPROVAL`
  - 当前最理想的待开通状态
  - 说明只剩 `AFDIAN_WEBHOOK_ALLOWED_IPS` 的占位值还没替换
- `READY_FOR_REAL_AFDIAN_WEBHOOK`
  - 已经不依赖占位白名单，可以继续做真实 webhook 验收
- `LOCAL_AUDIT_ONLY`
  - 只做了本地/配置侧检查，还没完成线上代理链确认
- `ACTION_REQUIRED`
  - 还有风险项没收口，不能当成安全待命

## 待开通阶段不要做的事

- 不要删掉 `AFDIAN_WEBHOOK_ALLOWED_IPS`
- 不要把 `TRUST_ALL_PROXIES=true` 当作临时捷径
- 不要把一次旧采样得到的 Railway `100.64.0.x` 长期写死后就不再复核
- 不要在开发者认证开通前开放爱发电真实支付入口

## 开通后的第一轮动作

1. 保持当前 `AFDIAN_WEBHOOK_ALLOWED_IPS=203.0.113.254/32` 不变。
2. 触发一笔最小真实爱发电订单。
3. 去 Railway 日志里查：
   - `[Afdian] Webhook blocked due to IP allowlist mismatch`
4. 从这条日志里拿到 `resolved_client_ip`。
5. 把 `AFDIAN_WEBHOOK_ALLOWED_IPS` 改成该 IP 的 `/32`，或收敛后的最小 CIDR。
6. Redeploy。
7. 再次运行：

```bash
npm run afdian:readiness -- --env-file server/.env.staging --base-url https://www.zaoyoe.com --admin-email zaoyoe@gmail.com
```

如果这时已经没有额外阻塞项，就可以进入真实 webhook 验收。

## 关于 Railway 代理链

Railway 入口 IP 会漂移，所以文档里的历史样例只能帮助理解，不应该当成永久配置。  
真正要信的是脚本当前输出的：

- `TRUSTED_PROXY_IPS`
- `AFDIAN_WEBHOOK_TRUSTED_PROXIES`

每次 redeploy 或运维变更后，都优先重新跑一次 readiness 脚本。
