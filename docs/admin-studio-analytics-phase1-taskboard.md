# Admin Studio 数据分析 Phase 1 任务单

这份文档用于把“数据分析 2.0”第一阶段改造压成可以直接开工的任务单。

配套文档：

- [admin-studio-analytics-2-upgrade-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-analytics-2-upgrade-plan.md)
- [admin-studio-rebuild-roadmap.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-rebuild-roadmap.md)

## 1. Phase 1 目标

第一阶段不追求把 analytics 一次性全部重做，而是先把“现在这页看起来像全局分析，但口径和刷新并不一致”的问题收住。

这一阶段只做三件事：

- 修正核心指标口径
- 统一日期范围与刷新行为
- 解决 analytics 模块重复初始化和订阅堆叠

## 2. Phase 1 完成标准

满足以下条件，才算第一阶段完成：

1. analytics 顶部日期范围对当前页全部核心卡片生效
2. `刷新` 与 `切换日期范围` 共用同一套 reload 逻辑
3. `DAU / MAU / comments_growth` 不再沿用明显失真的旧口径
4. analytics 模块重复进入或切站点时，不再叠加监听、图表和 realtime 订阅
5. 导出和 AI 洞察读取同一批时间窗口数据

## 3. 分支策略

主分支建议：

- `codex/admin-analytics-phase1`

建议按下面顺序拆 commit：

1. SQL / RPC 口径修正
2. 前端状态与刷新统一
3. 生命周期与 realtime 清理
4. 导出 / AI 对齐与回归

## 4. 任务总览

| 任务 ID | 任务名 | 建议负责人 | 预估工时 | 前置依赖 | 是否阻塞后续 |
|---|---|---|---|---|---|
| `A1-1` | Analytics 时间范围状态收口 | 前端 | `0.5 天` | 无 | 是 |
| `A1-2` | Analytics 口径修正 RPC | SQL / 后端 | `0.5-1 天` | 无 | 是 |
| `A1-3` | 全量卡片统一 reload 流程 | 前端 | `0.5-1 天` | `A1-1` `A1-2` | 是 |
| `A1-4` | 模块 teardown 与 realtime 清理 | 前端 | `0.5 天` | `A1-1` | 否 |
| `A1-5` | 导出与 AI 时间窗口对齐 | 前端 | `0.5 天` | `A1-2` `A1-3` | 否 |
| `A1-6` | 回归测试与 Smoke 验收 | 联调 / QA | `0.5 天` | `A1-3` `A1-4` `A1-5` | 是 |

## 5. 任务明细

## `A1-1` Analytics 时间范围状态收口

目标：

- 让 analytics 顶部时间范围成为整页统一状态
- 消除“部分图跟着变、部分图不跟着变”的体验割裂

涉及文件：

- [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)
- [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)

要做的事：

1. 在 [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js) 收口统一状态：
   - `site`
   - `startDate`
   - `endDate`
   - `days`
   - `activeTab`
2. 把 `preset` 与 `custom range` 都归一到同一套 state 更新入口
3. 去掉“部分函数自己算 `days`、部分函数自己读全局变量”的分散逻辑

验收标准：

- 顶部日期范围变更后，analytics 页能以统一参数重载
- 任意卡片不再出现仍显示旧窗口数据的情况

## `A1-2` Analytics 口径修正 RPC

目标：

- 先修掉最容易误导运营判断的核心口径问题
- 给 Phase 2 的 `v2 suite RPC` 打底

涉及文件：

- [supabase/analytics_site_filter.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/analytics_site_filter.sql)
- [supabase/analytics_advanced_site_filter.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/analytics_advanced_site_filter.sql)

要做的事：

1. 修正 `comments_growth` 的比较口径，改成“当前窗口评论量 vs 前一窗口评论量”
2. 明确 `DAU / MAU / active_users` 的过渡口径：
   - Phase 1 至少在文案和返回字段上区分“登录活跃”与“真实活跃”
   - 如果成本可控，优先切到 `user_events` 有效事件去重
3. 明确 `new_users` 的站点归因说明：
   - 如果还不能做真正站点新增，就在返回结构里拆成 `global_new_users` 与 `site_attributed_new_users`
4. 给漏斗结果增加 `is_proxy_metric` 标记，避免把代理值当成真实漏斗

验收标准：

- 不再出现“总评论数和上一周评论量比较”的伪增长
- 前端能区分真实指标与代理指标
- `cn / intl` 视图下的新用户语义更加明确

## `A1-3` 全量卡片统一 reload 流程

目标：

- 把日期范围切换、手工刷新、自动刷新统一到一套数据加载流程

涉及文件：

- [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)

要做的事：

1. 用单一入口替代当前的 `refreshChartsWithDateRange()`：
   - `reloadAnalyticsDashboard()`
2. 把下列区块全部纳入统一重载：
   - 概览 KPI
   - 用户趋势
   - 内容趋势
   - 社区趋势
   - 热门内容
   - 转化漏斗
   - 留存
   - 积分流向
   - 导出依赖数据
3. 顶部刷新按钮、自动刷新、日期范围应用都调用同一入口

验收标准：

- 顶部刷新与切日期范围不再出现结果不一致
- 关键卡片都能稳定响应新窗口

## `A1-4` 模块 teardown 与 realtime 清理

目标：

- 避免 analytics 重复初始化带来的监听和订阅堆叠

涉及文件：

- [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)
- [js/admin-studio-bootstrap.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-studio-bootstrap.js)
- [js/admin-site-filter.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-site-filter.js)

要做的事：

1. 给 analytics 模块增加已初始化标记和 teardown 容器
2. 保存并清理：
   - realtime channels
   - chart instances
   - auto refresh interval
   - 事件监听器
3. 站点切换时优先走数据 reload，不重复做整模块 init

验收标准：

- 连续切换 analytics 模块和站点后，不出现重复订阅日志
- 自动刷新不会重复启动多个 interval

## `A1-5` 导出与 AI 时间窗口对齐

目标：

- 让导出和 AI 读到的就是当前管理员正在看的那份数据

涉及文件：

- [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)

要做的事：

1. 导出逻辑改为读取统一日期状态，而不是各自读取不同默认值
2. AI 洞察参数改为读取当前时间范围与当前站点
3. 如果某些卡片仍是代理值，在 AI prompt 中显式说明

验收标准：

- 导出文件中的时间窗口与页面显示一致
- AI 不再默认只看最近 `7` 天

## `A1-6` 回归测试与 Smoke 验收

目标：

- 确认 Phase 1 改造没有引入新的 analytics 失真和前端抖动

涉及文件：

- analytics 相关测试文件
- 如有必要新增 `admin-analytics` 行为测试

建议自动测试：

```bash
node --test tests/admin-handler-permissions.test.js
```

如果当前仓库还没有 analytics 自动化测试，建议至少补一轮手工 Smoke：

1. 进入 analytics，切换 `7 / 30 / 90 / 自定义` 范围
2. 核对 KPI、趋势图、漏斗、积分图是否一起变化
3. 在 analytics 和其他模块之间反复切换，确认没有重复 toast、重复订阅、重复刷新
4. 在 `cn / intl / all` 间切换，确认语义和结果一致
5. 导出当前窗口数据，核对导出时间范围与页面一致
6. 在不同窗口下生成 AI 洞察，确认摘要会跟着变化
