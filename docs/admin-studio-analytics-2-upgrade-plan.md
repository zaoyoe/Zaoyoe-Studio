# Admin Studio 数据分析 2.0 升级方案

> 2026-04-05 结构更新说明：这份文档保留为早期 analytics 2.0 方案。若要按“商品为重点、分析中心与商城管理分离”的新版方向推进，请优先参考 [admin-studio-business-analytics-restructure-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-business-analytics-restructure-plan.md)。

这份文档用于把 `Admin Studio` 里的“数据分析”从通用图表页升级成贴合本站经营链路的“经营驾驶舱”，并把前期诊断沉淀成一份可以直接拆前端、埋点、SQL/RPC 任务的落地方案。

配套文档：

- [admin-studio-analytics-phase1-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-analytics-phase1-taskboard.md)
- [admin-studio-rebuild-roadmap.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-rebuild-roadmap.md)
- [admin-studio-workbench-remediation-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-workbench-remediation-plan.md)

## 1. 这份方案解决什么

当前“数据分析”分栏已经能展示一批后台图表，但它还更像一个“后台 BI 样板页”，不是围绕本站经营链路搭建的驾驶舱。

而本站本质上不是单一内容站，而是多条业务链路叠加的复合平台：

- 提示词内容浏览与积分解锁
- 积分钱包、充值、兑换与余额运营
- Google One 验证服务与额度/成功率管理
- 资源商城与订单交付
- 留言板社区与互动活跃
- 推广返佣与签到激励
- `cn / intl` 双站点运营

相关入口已经在前台和账户体系里明确存在，例如 [index.html](/Volumes/chao/AI/xianyu_profit_calculator/index.html)、[js/profile-modal-template.js](/Volumes/chao/AI/xianyu_profit_calculator/js/profile-modal-template.js) 和 [verify-widget.js](/Volumes/chao/AI/xianyu_profit_calculator/verify-widget.js)。

因此“数据分析 2.0”的目标不是再多加几张图，而是把后台改成真正可支撑下列问题的经营面板：

- 流量是从哪里来，落到哪个业务链路里
- 用户注册后，先去看 Prompt、充值、验证还是商城
- 充值后的首个消费行为是什么
- 积分主要被消耗在内容、验证、商城还是补贴
- `cn / intl` 两个站点的行为结构和价值密度有什么差异
- 返佣、签到、活动奖励到底是在拉新，还是只是在增加成本

## 2. 现状诊断

### 2.1 信息架构没有围绕经营链路组织

当前 analytics 只有三个一级页签：

- `用户表现`
- `积分生态`
- `AI 洞察`

入口定义见 [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)。

这套结构的问题不是“少一个 tab”，而是经营相关的数据被拆散了：

- 内容表现主要在 analytics
- 更偏经营的钱包和资金结构又散落在 payments 模块
- 验证服务没有独立的分析视图
- 社区、推广、签到没有被放进同一条增长链路里

结果就是后台能“看图”，但还不能支持“判断哪条业务链路值得继续投资源”。

### 2.2 核心指标口径不够稳

现有 `DAU / MAU / active_users` 主要来自 `user_login_history`，实际上更接近“登录用户”，而不是真正的“活跃用户”。实现见 [supabase/analytics_site_filter.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/analytics_site_filter.sql)。

这在本站会产生明显失真：

- 用户可能浏览 Prompt 但没有形成新的登录记录
- 用户可能主要在验证、商城、钱包链路活跃
- 部分用户行为已经进入 `user_events`，但没有成为主口径

另外，`new_users_today / new_users_week` 直接读取 `auth.users`，由于 `auth.users` 没有站点归因，当前 `cn / intl` 下的新增用户其实是共享口径，不是严格的分站点新增。实现也在 [supabase/analytics_site_filter.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/analytics_site_filter.sql)。

还有一个更具体的问题：`comments_growth` 用的是“全量总评论数”去和“前一周评论数”做对比，这个增长值在语义上并不成立。实现见 [supabase/analytics_site_filter.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/analytics_site_filter.sql)。

### 2.3 漏斗、留存和 AI 洞察大量依赖代理指标

“转化漏斗”当前的定义是：

- 访问用户 = 近 `p_days` 登录过的用户
- 内容浏览 = 近 `p_days` 评论过或解锁过的用户
- 内容解锁 = 近 `p_days` 产生解锁的用户

实现见 [supabase/analytics_advanced_site_filter.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/analytics_advanced_site_filter.sql)。

这意味着当前漏斗并不是“真实浏览 -> 点击 -> 解锁”的内容漏斗，而是一组可用代理值。它可以用于粗看方向，但不适合拿来指导增长动作。

AI 洞察当前也主要基于概览、用户趋势和渠道数据拼 prompt，见 [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)。它并没有把验证服务、商城、返佣、签到、社区这些更贴近本站经营的指标纳进去。

### 2.4 全局日期范围与刷新行为不一致

UI 上已经给了统一日期范围选择器，见 [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)，但当前 `refreshChartsWithDateRange()` 实际只刷新：

- 用户趋势
- 内容趋势
- 社区趋势

实现见 [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)。

同样，顶部“刷新”也主要刷新 KPI 和这三类图，并没有把热门内容、漏斗、积分明细、A/B、AI 这类数据一起纳入一个统一刷新闭环，仍然在 [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)。

这会带来一个很直接的 UX 问题：用户看起来是在改“全页面时间范围”，但很多卡片实际上并没有跟着变。

### 2.5 埋点底座存在，但还没真正长成全站经营埋点

仓库已经有 `user_events.site`，`verification_logs.site` 和 `user_login_history.site` 等字段，双站分析需要的基础条件其实已经有一部分了，见 [supabase/dual_site_migration.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/dual_site_migration.sql)。

但实际前台埋点还很薄：

- `heartbeat.js` 每分钟上报一次 `page_view`
- 埋点主要挂在 Prompt 页面
- 还没有真正覆盖钱包、充值、验证提交、商城下单、留言板、推广入口

相关实现见 [js/heartbeat.js](/Volumes/chao/AI/xianyu_profit_calculator/js/heartbeat.js) 和 [prompts.html](/Volumes/chao/AI/xianyu_profit_calculator/prompts.html)。

这使得当前 analytics 更偏“基于业务表的事后统计”，而不是“基于行为事件的经营分析”。

### 2.6 模块重复初始化，长期运行有叠加风险

切到 analytics 模块会执行 `initAnalyticsModule()`，切站点时在 analytics 模块里也会再执行一次 `initAnalyticsModule()`。实现见：

- [js/admin-studio-bootstrap.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-studio-bootstrap.js)
- [js/admin-site-filter.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-site-filter.js)

但 `initAnalyticsModule()` 当前会重新绑定事件、重建 realtime 订阅，却没有显式 teardown，见 [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)。

这意味着管理端在长期使用下可能出现：

- 重复事件监听
- 重复订阅
- 图表和自动刷新实例堆叠

## 3. 数据分析 2.0 的目标原则

### 3.1 经营链路优先，不再按“技术分组”堆图

分析页应该围绕下面这条经营主链路组织：

`站点流量 -> 注册/激活 -> 首次关键行为 -> 充值/获得积分 -> 内容/验证/商城消费 -> 社区参与 -> 裂变/返佣 -> 留存复购`

### 3.2 先定义口径，再画图

所有核心指标都需要明确：

- 指标名称
- 业务解释
- 时间窗口
- 站点归因规则
- 数据源
- 是否为真实事件口径，还是代理口径

### 3.3 双站点必须是一级能力

`all / cn / intl` 不能只体现在筛选器里，还要体现在：

- 新增用户归因
- 活跃用户定义
- 转化率对比
- 积分进出结构
- 验证服务质量
- 内容消费偏好

### 3.4 分析结果必须能导向动作

图表不应该停在“告诉你发生了什么”，而应该支持：

- 跳转到对应 Prompt / 订单 / 用户 / Verify Monitor
- 下钻异常原因
- 带着上下文进入工作台处理

### 3.5 AI 助理是消费层，不是数据源

AI 洞察应该站在真实指标之上做总结、告警解释和建议生成，而不是继续消费不完整的代理数据。

## 4. 目标信息架构

建议把 analytics 从当前三分栏升级为六分栏：

| 分栏 | 关注问题 | 核心 KPI | 核心图表 | 应支持动作 |
|---|---|---|---|---|
| `总览驾驶舱` | 平台整体是否健康 | 活跃用户、站点新增、首充率、首个消费去向、验证成功率、净积分流量 | 北极星趋势、经营漏斗、`cn/intl` 对比、异常告警 | 跳转支付、Prompt、Verify、用户明细 |
| `内容增长` | Prompt 内容是否在带动消费和互动 | `prompt_view_uv`、解锁率、解锁后评论率、热门 Prompt 收益 | 内容漏斗、内容热榜、分类热度、站点偏好 | 跳 Prompt 编辑、评论治理、活动配置 |
| `积分与交易` | 积分从哪里来、花到哪里去、是否健康 | 充值积分、奖励积分、消费积分、燃烧率、ARPPU、余额集中度 | 收支趋势、用途结构、充值转化、余额分层 | 跳钱包、订单、退款、异常补偿 |
| `验证服务` | 验证业务有没有赚钱、有没有堵、有没有掉成功率 | 提交量、成功率、平均处理时长、失败原因、额度余量、单次成功成本 | 成功率趋势、SLA、失败原因分布、额度预警 | 跳 Verify Monitor、配置、工单 |
| `社区与裂变` | 社区是否在带动留存和裂变 | 留言量、回复率、活跃贡献者、邀请人数、首充邀请转化、返佣成本 | 社区互动趋势、邀请漏斗、返佣 ROI、签到 uplift | 跳留言治理、推广配置、奖励配置 |
| `AI 助理` | 哪些变化最值得管理员处理 | 结构化洞察、异常摘要、实验建议、待处理机会点 | 经营摘要卡、异常解释卡、实验看板 | 一键跳转对应模块处理 |

这里最关键的变化不是“多了三个 tab”，而是把你网站最有业务特色的三块能力显式拉到分析首页：

- `验证服务`
- `社区与裂变`
- `积分与交易`

这三块是你站点和普通 Prompt 站最不一样的地方。

## 5. 指标体系建议

## 5.1 全站北极星指标

建议把下面这些指标提升到总览级别：

| 指标 | 业务解释 | 建议口径 |
|---|---|---|
| `站点活跃用户` | 真正发生业务行为的用户数 | 基于 `user_events` 中有效业务事件去重，而不是只看登录 |
| `注册新增` | 全局新增注册 | `auth.users` |
| `站点新增` | 首次在某站产生有效行为的新增用户 | 取用户首个带 `site` 的关键事件 |
| `首充转化率` | 新用户是否快速进入付费链路 | 注册后 `7` 天内完成首次充值的用户占比 |
| `首次消费去向` | 充值后用户优先消费在哪条业务链路 | 首次充值后第一笔消费落到 `Prompt / Verify / Shop / Other` |
| `净积分流量` | 平台积分池是净流入还是净流出 | `points_in - points_out` |
| `验证成功率` | 验证业务质量 | `verify_success / verify_submit` |
| `Prompt 解锁率` | 内容变现效率 | `unlock_success_uv / prompt_view_uv` |
| `返佣 ROI` | 裂变激励是否划算 | 邀请用户贡献价值 / 返佣与奖励成本 |

其中有两个指标尤其适合你的网站：

- `首次消费去向`
- `返佣 ROI`

因为它们能直接回答“这个站到底更像内容站、服务站还是积分站”。

## 5.2 内容增长指标

内容分栏建议至少包含下列指标：

- `prompt_list_exposure_uv`
- `prompt_view_uv`
- `unlock_click_uv`
- `unlock_success_uv`
- `unlock_rate`
- `avg_points_per_unlock`
- `unlock_after_recharge_rate`
- `comment_after_unlock_rate`
- `top_prompts_by_unlocks`
- `top_prompts_by_points_consumption`
- `cn/intl category preference split`

口径建议：

- `prompt_view` 必须是真实详情页访问或卡片展开事件，不再使用评论/解锁行为代理“浏览”
- `unlock_rate = unlock_success_uv / prompt_view_uv`
- `unlock_after_recharge_rate` 用于回答充值后内容消费承接是否顺畅

底层业务表可以继续使用：

- [supabase/analytics_site_filter.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/analytics_site_filter.sql) 中已有的 `prompt_unlocks`
- Prompt 互动相关表与管理逻辑

但浏览类指标需要新增埋点。

## 5.3 积分与交易指标

目前“积分生态”最需要升级的是分类粒度。

建议把积分进出结构拆成下列类别：

| 分类 | 示例来源 |
|---|---|
| `充值` | 钱包充值、购买积分 |
| `兑换码` | redemption / batch redeem |
| `签到奖励` | check-in 奖励 |
| `推广奖励` | 注册奖励、返佣、活动拉新奖励 |
| `系统补偿` | 手工补发、故障补偿 |
| `Prompt 解锁` | 内容解锁消耗 |
| `验证服务` | Google One 验证提交消耗 |
| `商城消费` | 资源商品支付消耗 |
| `退款返还` | 退款、订单回滚返还 |
| `管理扣减` | 管理员扣减 |

这比当前在 [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js) 里的粗分类更适合你现在的业务结构。

建议新增的经营指标：

- `recharge_users`
- `first_recharge_users`
- `ARPPU`
- `points_in_by_reason`
- `points_out_by_reason`
- `points_burn_ratio`
- `points_velocity`
- `balance_concentration_top10`
- `paid_vs_bonus_consumption_mix`
- `refund_recovery_points`

数据源主要来自：

- `points_balance`
- `points_ledger`
- `shop_orders`
- `prompt_unlocks`

相关表在 [supabase/analytics_site_filter.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/analytics_site_filter.sql) 和现有钱包/商城逻辑中都已经存在。

## 5.4 验证服务指标

验证业务建议独立成一个完整分栏，而不是继续藏在“AI 洞察”或 settings monitor 里。

建议核心指标如下：

- `verify_submit_count`
- `verify_success_count`
- `verify_success_rate`
- `verify_avg_processing_minutes`
- `verify_priority_share`
- `verify_failed_reason_top`
- `verify_points_consumption`
- `verify_points_cost_per_success`
- `verify_quota_remaining`
- `verify_backlog_jobs`

这里有两个很有本站特色的指标：

- `verify_points_cost_per_success`
- `verify_priority_share`

因为你的验证服务不是单纯的技术功能，而是实际收费、实际消耗积分的产品线。相关业务表和监控入口已经存在于：

- [verify-widget.js](/Volumes/chao/AI/xianyu_profit_calculator/verify-widget.js)
- [server/api-handlers/admin/settings/verify-monitor.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/verify-monitor.js)
- `verification_logs`

## 5.5 社区与裂变指标

这一块建议把留言板、推广和签到放到同一分栏，因为它们共同回答的是“低成本增长是否成立”。

建议指标：

- `guestbook_post_count`
- `guestbook_reply_rate`
- `guestbook_like_rate`
- `active_contributors`
- `invite_clicks`
- `invited_signups`
- `invited_first_recharge_users`
- `invitee_total_spend`
- `commission_paid`
- `registration_rewards_paid`
- `affiliate_roi`
- `checkin_users`
- `checkin_to_consume_rate`

现有推广数据基础并不弱，已经能从推广函数里看出：

- 被邀请用户来自 `profiles.invited_by`
- 邀请后的充值与消费可通过 `points_ledger`、`shop_orders` 还原
- 返佣与注册奖励也能从 `points_ledger` / `pending_referral_rewards` 归集

相关实现可参考 [6.5_affiliate_dashboard_upgrade.sql](/Volumes/chao/AI/xianyu_profit_calculator/6.5_affiliate_dashboard_upgrade.sql)。

## 6. 埋点升级方案

## 6.1 埋点目标

目标不是把所有页面都打满埋点，而是先补齐经营链路上最关键的真实事件。

建议第一批必须补齐的事件：

| 事件名 | 触发位置 | 关键字段 | 用途 |
|---|---|---|---|
| `page_view` | 全站页面进入 | `site` `page` `session_id` | 基础流量 |
| `prompt_view` | Prompt 详情或展开 | `prompt_id` `category` | 内容浏览 |
| `unlock_click` | 点击解锁 | `prompt_id` `price` | 内容转化前行为 |
| `unlock_success` | 解锁成功 | `prompt_id` `points_spent` | 内容付费结果 |
| `wallet_open` | 打开钱包 | `entry` | 钱包入口分析 |
| `recharge_click` | 点击充值 | `channel` `package_id` | 充值漏斗 |
| `recharge_success` | 充值成功 | `amount` `points` `channel` | 付费转化 |
| `verify_submit` | 提交验证任务 | `priority` `points_cost` | 验证业务漏斗 |
| `verify_success` | 验证成功 | `duration_ms` | 服务质量 |
| `verify_fail` | 验证失败 | `reason_code` | 失败分析 |
| `shop_view` | 查看商品 | `product_id` `category` | 商城浏览 |
| `shop_purchase` | 商城下单成功 | `order_id` `price_paid` | 商业转化 |
| `guestbook_post` | 发布留言 | `message_id` | 社区活跃 |
| `guestbook_reply` | 回复留言 | `message_id` `reply_id` | 社区深度 |
| `affiliate_invite_click` | 点击推广链接/复制口令 | `channel` | 裂变前行为 |
| `checkin_success` | 签到成功 | `streak_days` `points_reward` | 激励分析 |

## 6.2 埋点字段规范

建议统一事件包结构：

- `site`
- `session_id`
- `user_id`
- `event_name`
- `page_url`
- `referrer`
- `module`
- `entity_type`
- `entity_id`
- `event_value`
- `points_delta`
- `metadata`
- `experiment_id`（可选，仅在手动启用 experiment runtime 时上报）
- `variant_id`（可选，仅在手动启用 experiment runtime 时上报）

这意味着当前 [js/heartbeat.js](/Volumes/chao/AI/xianyu_profit_calculator/js/heartbeat.js) 应该从“单页 heartbeat 脚本”升级成“全站共享 tracker”，heartbeat 只作为在线状态补充，不再承担主分析事件入口。

## 6.3 埋点接入顺序

建议按下面顺序推进：

1. `Prompt + 钱包 + 充值`
2. `验证服务`
3. `商城`
4. `留言板 + 推广 + 签到`
5. 可选：仅在手动启用 experiment runtime 时补 `A/B experiment exposure + conversion`

这样可以最快补齐最核心的经营闭环。

## 7. SQL / RPC 升级方案

## 7.1 设计原则

当前 analytics RPC 基本都还是：

- `p_days`
- `p_site`

建议升级成统一的：

- `p_start_date`
- `p_end_date`
- `p_site`

原因很直接：

- 自定义日期范围天然需要起止日期
- 单纯 `days` 不适合做跨月、活动期和周同比分析
- 前端也能真正做到“所有卡片共享同一时间窗口”

## 7.2 建议新增的 RPC 套件

建议不要再继续堆很多零散的单图表 RPC，而是改成分域套件：

- `get_analytics_overview_v2(p_start_date, p_end_date, p_site)`
- `get_analytics_content_suite_v2(p_start_date, p_end_date, p_site)`
- `get_analytics_points_trade_suite_v2(p_start_date, p_end_date, p_site)`
- `get_analytics_verify_suite_v2(p_start_date, p_end_date, p_site)`
- `get_analytics_community_growth_suite_v2(p_start_date, p_end_date, p_site)`
- `get_ai_summary_data_v2(p_start_date, p_end_date, p_site)`

每个 suite RPC 返回一个结构化 JSON，前端一次请求一个分栏需要的全部数据，减少“十几张卡片各调一个 RPC”的碎片化加载模式。

## 7.3 建议建设的中间聚合层

为了不让所有图表都去直接扫业务明细表，建议增加一层日聚合视图或物化视图：

- `analytics_daily_active_users`
- `analytics_daily_content`
- `analytics_daily_points`
- `analytics_daily_verify`
- `analytics_daily_commerce`
- `analytics_daily_growth`

典型来源：

- `user_events`
- `user_login_history`
- `prompt_unlocks`
- `points_ledger`
- `shop_orders`
- `verification_logs`
- `guestbook_messages`
- `profiles.invited_by`
- `pending_referral_rewards`

这层聚合的价值在于：

- 统一口径
- 降低前端图表请求波动
- 为 AI 洞察和导出复用同一批事实数据

## 7.4 兼容与迁移建议

不建议一次性删除旧 RPC。

建议分三步：

1. 保留旧 RPC，给新前端只接 `v2`
2. 导出、AI、日期范围先切到 `v2`
3. 所有卡片迁完后再清理旧接口

## 8. 前端改造方案

## 8.1 页面结构

建议直接改 [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html) 中 analytics 页签结构：

- 把当前 `用户表现 / 积分生态 / AI 洞察` 改成六分栏
- 每个分栏采用“北极星 KPI + 主图 + 次图 + 可行动清单”的统一布局
- `AI 助理` 保留独立页签，但其数据源全部来自其它五个分栏

## 8.2 状态管理

建议在 [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js) 里收敛出统一的 analytics store：

- `site`
- `startDate`
- `endDate`
- `activeTab`
- `loadingState`
- `lastLoadedAt`
- `subscriptions`
- `chartInstances`

并把所有刷新统一到一个入口：

- `reloadAnalyticsSuite({ site, startDate, endDate, tab })`

这样可以彻底替代当前“切日期刷新三张图、点刷新再刷另一部分”的半联动模式。

## 8.3 生命周期与清理

`initAnalyticsModule()` 需要改成幂等初始化，并提供 teardown：

- 首次进入模块时初始化
- 站点切换只走数据 reload
- 离开模块或重复进入时先清理旧 chart / interval / realtime channel

这样可以解决 [js/admin-studio-bootstrap.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-studio-bootstrap.js)、[js/admin-site-filter.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-site-filter.js) 与 [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js) 之间的重复初始化问题。

## 8.4 导出与 AI

导出和 AI 应该共用同一批 suite 数据，而不是各自再单独组装不同的数据源。

建议：

- `导出` 按分栏导出，外加“全局打包导出”
- `AI 助理` 读取 suite 聚合数据，输出：
  - 数据亮点
  - 风险预警
  - 可执行建议
  - 建议跳转入口

## 9. 分阶段落地建议

## Phase 1：先修口径和刷新一致性

目标：

- 修正 `DAU / MAU / comments_growth` 口径问题
- 统一日期范围与刷新行为
- 给 analytics 增加初始化幂等与 teardown

建议范围：

- [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)
- [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)
- [supabase/analytics_site_filter.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/analytics_site_filter.sql)
- [supabase/analytics_advanced_site_filter.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/analytics_advanced_site_filter.sql)

完成标准：

- 日期范围对 analytics 全量生效
- refresh 行为和日期范围共享同一套 reload 逻辑
- analytics 模块不再重复叠加监听与订阅

## Phase 2：重构信息架构与新增验证/裂变分栏

目标：

- 把 analytics 升级成六分栏
- 将验证服务、社区与裂变显式拉入经营分析首页
- 把积分经营视图从“流水图”升级成“经营结构图”

建议范围：

- [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)
- [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)
- 新增 `v2` suite RPC

完成标准：

- analytics 信息架构与实际业务链路对齐
- 管理员能从分析页直接跳到 Prompt、Payments、Verify、Comments 等处理入口

## Phase 3：补齐真实埋点与 AI/实验升级

目标：

- 建立全站行为埋点
- 用真实事件重做内容漏斗、充值漏斗和裂变漏斗
- 让 AI 和 A/B 真正建立在经营数据上

建议范围：

- `Prompt / Wallet / Verify / Shop / Guestbook / Affiliate / Check-in` 前台入口
- `user_events` 埋点 SDK
- `get_ai_summary_data_v2`

完成标准：

- 内容、验证、商城、裂变都能拿到真实事件漏斗
- `AI 助理` 能输出更像“运营结论”而不是“通用摘要”的分析

## 10. 如果现在只先做三件事

如果这轮不想铺太大，我建议优先做下面三件事：

1. 把 analytics 的日期范围、刷新、初始化生命周期先修正
2. 把“积分生态”升级成“积分与交易”，并补出 `验证服务` 分栏
3. 在 `Prompt / Wallet / Verify` 三条主链路先补一套真实埋点

这是性价比最高的一条路径，因为它会先把“看起来有数据”变成“数据真的能指导动作”。

## 11. 不建议先做的事

这轮不建议优先做下面两类动作：

- 继续往现有 `AI 洞察` 里堆 prompt 模板
- 在旧口径上继续加更多新图表

原因很简单：如果底层口径和事件数据不够稳，图越多，误导越强。
