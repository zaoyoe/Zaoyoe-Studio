# 站外通知体系设计表

这份文档用于把当前站点的 `站内通知 + Telegram + 飞书` 告警能力收成统一规则。

当前基础能力已经具备：

- 站内管理员通知：`system_notifications`
- 站外异步队列：`ops_alert_jobs` / `ops_alert_job_attempts`
- 渠道发送能力：Telegram、飞书
- 后台可视化入口：`支付对账 -> 支付总览 / 异常运维`

建议后续统一按 `alert_type + severity + route + dedupe + escalation` 这 5 个维度扩展，而不是每个模块各写一套通知。

## 1. 渠道分工

### Telegram

- 用途：秒级、高危、必须立刻看到的异常
- 接收人：站长、核心管理员、技术值守
- 适合发送：
  - 支付链路中断
  - 高危退款失败
  - 验证服务不可用
  - 安全异常

### 飞书

- 用途：团队协作、处理分发、过程留痕
- 接收人：运营、客服、技术群
- 适合发送：
  - 工单待处理
  - 订单/库存异常
  - 支付 warning 级告警
  - 经营日报 / 周报

### 站内通知

- 用途：后台事实源、审计追溯
- 接收人：管理员
- 适合发送：
  - 所有需要在后台留痕的事件
  - 已处理 / 已恢复 / 已忽略结果

## 2. 默认路由规则

| 严重级别 | Telegram | 飞书 | 站内通知 | 说明 |
| --- | --- | --- | --- | --- |
| `critical` | 是 | 是 | 是 | 立即通知，必要时升级多通道 |
| `warning` | 否 | 是 | 是 | 先团队协作处理，超时再升级 |
| `info` | 否 | 可选汇总 | 是 | 主要留痕，不做打扰式提醒 |

建议再补一层升级规则：

- `warning` 30 分钟未处理，升级发 Telegram
- 同类 `critical` 10 分钟内连续 3 次，发升级提醒
- 夜间仅允许 `critical` 主动打扰

## 3. 推荐 alert_type 设计

### A. 支付 / 退款

| alert_type | 场景 | 默认级别 | 默认通道 | 去重建议 | 关键字段 |
| --- | --- | --- | --- | --- | --- |
| `payment_refund_ops` | 退款失败、扣回失败、补回失败 | `critical` | TG + 飞书 + 站内 | 45 分钟 | 订单号、用户ID、金额、积分、通道、最近错误 |
| `payment_gateway_degraded` | 支付成功率骤降 / 回调异常暴涨 | `critical` | TG + 飞书 + 站内 | 15 分钟 | 站点、通道、时间窗、失败率 |
| `payment_gateway_recovered` | 支付通道退出异常阈值，转入恢复观察 | `warning` | 飞书 + 站内 | 每次事故 1 次 | 站点、通道、持续时长、当前健康概览 |
| `payment_pending_review_spike` | 待审核订单短时堆积 | `warning` | 飞书 + 站内 | 30 分钟 | 订单数、站点、通道 |
| `payment_site_resolution_failed` | 回调无法可信解析站点 | `critical` | TG + 飞书 + 站内 | 10 分钟 | provider、订单号、host、最近错误 |
| `payment_config_changed` | 支付配置或密钥被修改 | `critical` | TG + 飞书 + 站内 | 5 分钟 | 操作人、变更项、时间 |

### B. 商城 / 订单 / 库存

| alert_type | 场景 | 默认级别 | 默认通道 | 去重建议 | 关键字段 |
| --- | --- | --- | --- | --- | --- |
| `shop_order_delivery_failed` | 发货失败 / 库存出库失败 | `warning` | 飞书 + 站内 | 30 分钟 | 订单号、商品、用户ID、错误 |
| `shop_order_delivery_recovered` | 订单退出履约失败状态并完成发货/退款关闭 | `warning` | 飞书 + 站内 | 每次事故 1 次 | 订单号、恢复结论、当前状态、持续时长 |
| `shop_order_high_value` | 高价值订单成交 | `info` | 飞书 | 立即发送 | 订单号、金额、商品、渠道 |
| `shop_inventory_low` | 库存低于阈值 | `warning` | 飞书 + 站内 | 6 小时 | 商品、剩余库存、近 7 天销量 |
| `shop_inventory_empty` | 商品售罄 | `warning` | 飞书 + 站内 | 6 小时 | 商品、最近下单数 |
| `shop_inventory_recovered` | 商品退出库存预警 / 售罄状态 | `warning` | 飞书 + 站内 | 每次事故 1 次 | 商品、恢复结论、当前库存 |
| `shop_orphan_order_detected` | 订单与库存/商品关联丢失 | `critical` | TG + 飞书 + 站内 | 30 分钟 | 订单号、用户ID、商品、异常原因 |

### C. 售后工单

| alert_type | 场景 | 默认级别 | 默认通道 | 去重建议 | 关键字段 |
| --- | --- | --- | --- | --- | --- |
| `ticket_new` | 新售后工单创建 | `info` | 飞书 + 站内 | 不去重 | 工单号、订单号、用户ID、原因 |
| `ticket_refund_related` | 退款相关工单 | `warning` | 飞书 + 站内 | 30 分钟 | 工单号、订单号、支付通道 |
| `ticket_sla_overdue` | 工单超时未处理 | `warning` | 飞书 + 站内 | 1 小时 | 工单号、等待时长、责任人 |
| `ticket_sla_recovered` | 工单退出超时未处理状态 | `warning` | 飞书 + 站内 | 每次事故 1 次 | 工单号、恢复结论、持续时长 |
| `ticket_repeat_complaint` | 同订单重复投诉 | `warning` | 飞书 + 站内 | 6 小时 | 工单数、订单号、用户ID |
| `ticket_high_risk_escalation` | 高危投诉或人工升级 | `critical` | TG + 飞书 + 站内 | 30 分钟 | 工单号、原因、备注 |

### D. 验证服务

| alert_type | 场景 | 默认级别 | 默认通道 | 去重建议 | 关键字段 |
| --- | --- | --- | --- | --- | --- |
| `verify_quota_low` | 验证额度低于阈值 | `warning` | 飞书 + 站内 | 6 小时 | 剩余额度、预计可用时长 |
| `verify_service_disabled` | 验证服务被关闭或不可用 | `critical` | TG + 飞书 + 站内 | 15 分钟 | 当前状态、最近错误 |
| `verify_failure_rate_spike` | 验证失败率飙升 | `critical` | TG + 飞书 + 站内 | 15 分钟 | 时间窗、失败率、受影响用户 |
| `verify_incident_escalated` | 多类验证高危信号叠加，升级成综合告警 | `critical` | TG + 飞书 + 站内 | 20 分钟 | 命中信号、关键摘要、最新时间 |
| `verify_incident_recovered` | 验证综合异常退出升级状态，进入恢复观察 | `warning` | 飞书 + 站内 | 每次事故 1 次 | 恢复结论、持续时长、剩余信号 |
| `verify_latency_spike` | 耗时异常升高 | `warning` | 飞书 + 站内 | 30 分钟 | p95/p99 耗时 |
| `verify_queue_backlog` | 任务堆积 / 并发锁冲突放大 | `warning` | 飞书 + 站内 | 30 分钟 | 任务数、热点目标、最近错误 |

### E. 留言板 / 评论 / 内容

| alert_type | 场景 | 默认级别 | 默认通道 | 去重建议 | 关键字段 |
| --- | --- | --- | --- | --- | --- |
| `content_spam_spike` | 留言板 / 评论垃圾内容激增 | `warning` | 飞书 + 站内 | 2 小时 | 时间窗、命中数、关键词 |
| `content_high_intent_message` | 高意向合作 / 投诉留言 | `info` | 飞书 + 站内 | 不去重 | 留言ID、用户、摘要 |
| `content_abuse_report` | 被举报内容新增 | `warning` | 飞书 + 站内 | 30 分钟 | 内容ID、作者、原因 |

### F. 返佣 / 渠道增长

| alert_type | 场景 | 默认级别 | 默认通道 | 去重建议 | 关键字段 |
| --- | --- | --- | --- | --- | --- |
| `affiliate_abuse_suspected` | 邀请异常放量 / 疑似刷号 | `warning` | 飞书 + 站内 | 2 小时 | 邀请码、来源用户、命中规则 |
| `affiliate_reward_release_failed` | 冻结奖励解冻失败 | `warning` | 飞书 + 站内 | 1 小时 | 用户ID、订单号、最近错误 |
| `affiliate_conversion_drop` | 渠道转化明显下滑 | `info` | 飞书汇总 | 每日汇总 | 渠道、对比周期、转化率 |

### G. 安全 / 配置 / 管理操作

| alert_type | 场景 | 默认级别 | 默认通道 | 去重建议 | 关键字段 |
| --- | --- | --- | --- | --- | --- |
| `security_admin_login_anomaly` | 管理员异常登录 / 异地登录 | `critical` | TG + 飞书 + 站内 | 30 分钟 | 管理员、IP、UA、时间 |
| `security_rate_limit_spike` | 限流命中激增 | `warning` | 飞书 + 站内 | 30 分钟 | 接口、IP、数量 |
| `security_secret_changed` | 高危密钥被更新 / 删除 | `critical` | TG + 飞书 + 站内 | 10 分钟 | 密钥名、操作人、时间 |
| `security_mock_enabled` | 生产环境误开 mock 支付 | `critical` | TG + 飞书 + 站内 | 10 分钟 | 环境、到期时间、操作者 |
| `security_webhook_guard_missing` | Webhook 白名单或信任代理缺失 | `critical` | TG + 飞书 + 站内 | 30 分钟 | provider、缺失配置项 |

### H. 经营日报 / 周报

| alert_type | 场景 | 默认级别 | 默认通道 | 去重建议 | 关键字段 |
| --- | --- | --- | --- | --- | --- |
| `ops_daily_digest` | 每日经营摘要 | `info` | 飞书 | 每日 1 次 | 收入、订单、退款、验证、工单 |
| `ops_weekly_digest` | 每周经营摘要 | `info` | 飞书 | 每周 1 次 | 周环比、Top 商品、Top 提示词 |

## 4. 推荐消息模板字段

无论哪个模块，站外消息尽量统一这些字段：

- 标题：发生了什么
- 专题：异常类别 / 业务模块
- 站点：`cn` / `intl`
- 通道：支付通道 / 业务来源
- 目标：订单号 / 工单号 / 留言ID / 用户ID
- 金额与积分：如适用
- 最近错误：技术原因或上游返回
- 建议动作：先看哪里、先做什么
- 处理入口：后台导航路径
- 发生时间

建议：

- Telegram 文案短一些，优先看结论和关键 ID
- 飞书文案长一些，适合附上处理建议和上下文

## 5. 推荐的升级策略

### 规则 1

- `warning` 首先发飞书
- 超过 SLA 未处理，再升级发 Telegram

### 规则 2

- 同类 `critical` 在短时间内连续触发
- 第二次开始附加“持续异常”标记

### 规则 3

- 恢复型事件也要发站内通知
- 飞书可选发“已恢复”，Telegram 默认不发，避免刷屏

## 6. 结合当前网站的落地优先级

### P0：最值得先做

1. `payment_gateway_degraded`
2. `verify_quota_low`
3. `ticket_sla_overdue`
4. `shop_inventory_low`
5. `security_admin_login_anomaly`

### P1：第二批

1. `shop_order_delivery_failed`
2. `payment_pending_review_spike`
3. `verify_failure_rate_spike`
4. `affiliate_abuse_suspected`
5. `content_spam_spike`

### P2：增强项

1. `ops_daily_digest`
2. `ops_weekly_digest`
3. `shop_order_high_value`
4. `affiliate_conversion_drop`

## 7. 推荐开发顺序

### 第一步

复用当前 `ops_alert_jobs` 体系，把告警范围从 `payment_refund_ops` 扩成多 `alert_type`。

### 第二步

在各模块补统一入队入口，例如：

- 支付：`server/api-handlers/admin/payments/**`
- 工单：`server/api-handlers/admin/tickets/process`
- 验证：`server/index.js`
- 商城：`js/admin-shop.js` 对应后台接口 / 服务端逻辑

### 第三步

在后台增加“通知路由设置”：

- 每个 `alert_type` 选择发 Telegram / 飞书 / 站内
- 可配置最小级别
- 可配置去重窗口
- 可配置升级规则

### 第四步

在 `支付总览` 现有“站外告警投递”基础上，再加：

- 通道成功率
- 最近失败原因聚合
- 最近 24 小时 dead-letter 变化
- 每类 alert_type 的命中趋势

## 8. 当前代码最适合扩展的入口

- 告警队列与路由：
  - [ops-alerts.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/ops-alerts.js)
- 站内管理员通知：
  - [admin-notifications.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin-notifications.js)
- 退款 / 支付异常：
  - [actions.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/payments/actions.js)
- 支付后台总览：
  - [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)
- 工单处理：
  - [tickets/process](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/tickets/process.js)

## 9. 一句话建议

对你这个站，最好的用法不是“把所有消息都发到 Telegram/飞书”，而是：

- `Telegram` 专管高危、立刻要处理的事
- `飞书` 负责团队协作和处理分发
- `站内通知` 负责留痕与审计

这样既不会被消息淹没，也能把支付、商城、验证、工单和安全真正串成一套运营体系。
