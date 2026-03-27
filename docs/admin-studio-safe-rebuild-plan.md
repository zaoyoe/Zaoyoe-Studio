# Admin Studio 安全重建顺序表

这份文档用于说明：在回滚到稳定快照 `bc80706` 之后，Admin Studio 相关能力应如何安全地重新引回，避免再次出现“配置全回默认、开关不可点、面板一直 loading”的连锁故障。

## 1. 复盘结论

本次后台大面积失稳，根因不是索引 SQL，而是把下面几类改动叠在同一阶段一起上了：

- 邮件告警通道
- 告警通道健康页
- 集中告警处理面板
- Admin Studio 的系统配置加载/保存主路径
- Admin Studio 的后台会话 / 鉴权链路
- 验证服务监控链路

这些改动共用了同一批底层文件：

- [admin-config.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-config.js)
- [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)
- [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js)
- [api/_lib/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin.js)
- [server/api-handlers/admin/settings/system-config.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/system-config.js)
- [server/api-handlers/admin/settings/verify-monitor.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/verify-monitor.js)
- [server/api-handlers/admin/settings/ops-alert-health.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/ops-alert-health.js)
- [server/api-handlers/admin/settings/ops-alert-monitor.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/ops-alert-monitor.js)

所以一旦公共加载链路失稳，表现会同时扩散到：

- `礼包配置 / 积分奖励 / 解锁定价 / 销售渠道`
- `支付通道 / 站外退款告警`
- `系统公告`
- `管理员访问 / Admin Audit Logs`
- `API 余额 / 验证服务运维面板`
- `告警通道健康页 / 集中告警处理面板`

## 2. 稳定基线

当前确认可作为稳定回补起点的版本是：

- `bc80706`

建议把它视为：

- `Admin Studio 稳定基线`
- `后续功能重引回的起点`

### 当前验证通过的新稳定锚点

在按 Phase A-D 逐步安全重建，并完成邮件通道联调验收后，当前确认可作为新的稳定锚点的版本是：

- `856f70a`

这版已经完成并通过人工验收的能力包括：

- 邮件告警后端发送能力
- 邮件告警前端配置 UI
- 告警通道健康页
- 集中告警处理面板
- 验证服务运维面板
- Vercel 深层 `/api/admin/settings/*` 路由转发

从这版开始，建议默认遵守两条规则：

1. 把 `856f70a` 视为新的回滚锚点。
2. 暂不进入 `Phase E`，除非有明确收益且愿意单独承担高风险改造。

## 3. 风险提交分组

### 不要整包重引的提交

下面这些提交不要直接整包 cherry-pick 回来：

- `97df945` `feat(ops-alerts): add email delivery and channel health tooling`
- `47502b3` `fix(admin): harden studio config load and save path`
- `12f5fad` `fix(admin): stabilize studio auth and verify runtime`
- `85c1183` `fix(admin): recover studio config and alert panels`
- `8fe3c0f` `fix(admin): use admin db client for settings handlers`
- `b9cf66f` `fix(admin): bypass broken settings config loads`

原因不是这些提交“完全不能用”，而是它们把“新功能 + 公共底层改造”绑在了一起， blast radius 太大。

### 可以保留的内容

下面这些方向本身是对的，可以保留，但必须拆分后重做：

- 邮件告警通道
- 告警健康页
- 集中告警处理面板
- 验证服务运维面板
- Admin Audit Monitor

### 可以直接保留的 SQL

下列 SQL 不需要回滚，可以继续保留：

- [20260325_add_ops_alert_monitor_indexes.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260325_add_ops_alert_monitor_indexes.sql)

这类索引 SQL 本身不会造成配置回默认、开关不可点或公告丢失。

## 4. 安全重建顺序

### Phase A：只回后端发送能力

目标：

- 只恢复邮件告警发送
- 不碰 Admin Studio 公共配置链路
- 不新增健康页和监控页

边界：

- 允许改 [api/_lib/ops-alerts.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/ops-alerts.js)
- 允许改后台密钥保存逻辑
- 不改 [admin-config.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-config.js) 的系统配置初始化主流程

上线前检查：

- `站外退款告警` 原有 Telegram / 飞书不受影响
- 邮件仅作为新增通道，不影响现有配置项读写

### Phase B：只回告警通道健康页

目标：

- 恢复健康页展示
- 只读，不承担系统配置初始化责任

边界：

- 新增 `/api/admin/settings/ops-alert-health`
- 前端面板独立失败、独立提示
- 不允许因为健康页失败影响其它设置区

上线前检查：

- 健康页失败时只影响自己
- `礼包配置 / 支付通道 / 系统公告 / 验证设置` 不会回默认

### Phase C：只回集中告警处理面板

目标：

- 恢复集中告警面板和快捷入口
- 批量动作先做最小集

边界：

- 新增 `/api/admin/settings/ops-alert-monitor`
- 不改系统配置主加载
- 不改后台登录 / 会话链路

上线前检查：

- 面板 loading 超时后只报自身错误
- 其它配置区仍保持正常

### Phase D：只回验证运维面板

目标：

- 恢复 `API 余额 / 当前额度 / 接口状态 / 队列状态 / 最近任务 / 最近失败`

边界：

- 新增 `/api/admin/settings/verify-monitor`
- 浏览器不直接承担复杂鉴权和跨域探测
- 面板失败时不影响验证服务配置本身的开关和值

上线前检查：

- `启用验证服务`
- `验证 API Key`
- `验证 API Base URL`
  这几项仍可正常读写

### Phase E：最后才动系统配置和鉴权底座

目标：

- 如果确实需要改 `system_config` 的主加载路径
- 如果确实需要改 Admin Studio 短时会话 / 鉴权补签逻辑

要求：

1. 单独发版
2. 不和新面板一起上
3. 必须先有接口级 smoke test
4. 必须先在 preview 做人工验收

这一步是最高风险项，优先级最低。

## 5. 每次重引回必须做的验收

每一个 Phase 都必须至少验这几项：

1. `礼包配置` 数值是否真实回显
2. `支付通道` 状态是否真实回显
3. `站外退款告警` 开关和配置是否真实回显
4. `积分奖励 / 解锁定价 / 销售渠道` 是否真实回显
5. `系统公告` 内容是否真实回显
6. `管理员访问 / Admin Audit Logs` 是否可加载
7. 新增面板失败时，是否只影响自己

如果这 7 项里有任意一项被拖坏，就停止继续往后引回。

## 6. 推荐回补节奏

推荐使用下面的节奏，而不是“大包一次回”：

1. 一次只回一个 Phase
2. 每个 Phase 单独 `commit + push`
3. 每个 Phase 单独线上验收
4. 验收通过后再开始下一阶段

推荐顺序：

1. `Phase A` 邮件告警后端
2. `Phase B` 告警通道健康页
3. `Phase C` 集中告警处理面板
4. `Phase D` 验证运维面板
5. `Phase E` 系统配置 / 鉴权底座改造

## 7. 下一批低风险可配置计划

在当前稳定锚点基础上，后续优先补“监控参数可配置”，而不是继续改公共加载链路。

优先级最高：

1. `库存与补货`
   - `low_stock_threshold`
   - `sweep_interval_ms`
   - `dedupe_window_minutes`
   - `sales_window_days`
   - `recovery notification enabled`
   - 可选增加：
     - 夜间免打扰
     - 固定时段汇总
     - 临时静默到某个时间点

第二梯队：

1. `工单超时`
   - 待处理超时阈值
   - critical 阈值
   - 去重窗口
2. `验证额度 / 验证堆积 / 验证失败率`
   - 阈值
   - 巡检频率
   - 去重窗口
3. `支付通道异常`
   - 巡检窗口
   - 失败 / 5xx 阈值
   - 去重窗口
4. `客服消息 / 购买成功 / 充值成功`
   - 巡检频率
   - 回看窗口
   - 去重窗口
   - 是否仅工作时间通知
## 8. 一句话原则

以后凡是会碰到下面任意一项，都默认视为高风险变更：

- `admin-config.js`
- `api/_lib/admin.js`
- `system_config` 主加载链路
- 后台短时会话 / 鉴权补签

高风险变更必须和“新面板 / 新告警 / 新按钮”拆开发。
