# Admin Studio Phase 2 开发任务单

这份文档用于把 `Admin Studio` 第二阶段改造压成可以直接开工的任务单。

配套文档：

- [admin-studio-rebuild-roadmap.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-rebuild-roadmap.md)
- [admin-studio-phase1-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase1-taskboard.md)

## 1. Phase 2 目标

第二阶段聚焦两条最关键的业务主线：

- `Homepage` 双站闭环
- `Shop / Payments` 财务动作并轨

这一阶段的核心不是“多做功能”，而是把已经进入双站和新支付体系的核心路径真正收口。

## 2. Phase 2 前置条件

开始第二阶段前，默认下面条件已经满足：

1. [admin-studio-phase1-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase1-taskboard.md) 已完成
2. `all` 视图下已经不能执行写操作
3. 新增 admin handler 已经有统一 `site` 约束和 audit 口径
4. 团队已经接受“先兼容读，再切换写”的发布方式

## 3. Phase 2 完成标准

满足以下条件，才算第二阶段完成：

1. 首页内容、显隐、缓存都按 `cn / intl` 独立维护
2. 首页前台读链路和后台编辑链路来自同一份站点化模型
3. 商城退款不再前端直连旧 RPC
4. 商城退款执行链路统一进入服务端 handler
5. 一笔退款只影响订单所属站点的积分、订单状态和库存

## 4. 分支策略

这一阶段建议拆两条分支并行推进：

- `codex/admin-homepage-dualsite`
- `codex/admin-shop-refund-serverize`

如果团队人手有限，也可以先做 `Homepage`，后做 `Shop / Payments`，但不要把两条线混在一个超大分支里。

## 5. 任务总览

| 任务 ID | 任务名 | 建议负责人 | 预估工时 | 前置依赖 | 是否阻塞后续 |
|---|---|---|---|---|---|
| `P2-A1` | Homepage Schema 兼容层 | 后端 / SQL | `1-1.5 天` | Phase 1 | 是 |
| `P2-A2` | Homepage 前台兼容读 | 前端 | `0.5-1 天` | `P2-A1` | 是 |
| `P2-A3` | Homepage Admin Handler | 后端 | `0.5-1 天` | `P2-A1` | 否 |
| `P2-A4` | Homepage 后台切换新模型 | 前端 | `1 天` | `P2-A2` `P2-A3` | 否 |
| `P2-A5` | Homepage 旧语义清理与 Smoke | 前端 / QA | `0.5-1 天` | `P2-A4` | 是 |
| `P2-B1` | 共享退款编排服务 | 后端 | `1-1.5 天` | Phase 1 | 是 |
| `P2-B2` | Payments Shop Refund Handler | 后端 | `0.5-1 天` | `P2-B1` | 是 |
| `P2-B3` | Shop 前端退款入口切换 | 前端 | `0.5 天` | `P2-B2` | 否 |
| `P2-B4` | Tickets Refund 复用共享服务 | 后端 | `0.5 天` | `P2-B1` | 否 |
| `P2-B5` | 旧退款 RPC 退场与回归 | 后端 / QA | `0.5-1 天` | `P2-B3` `P2-B4` | 是 |

## 6. Homepage 任务明细

## `P2-A1` Homepage Schema 兼容层

目标：

- 把首页配置从“全局 section”升级为“站点 + section”
- 先建立兼容能力，不直接强切后台

涉及文件：

- [homepage_config_schema.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/homepage_config_schema.sql)
- 新增 migration
- 如有需要，相关 SQL function 定义

要做的事：

1. 给 `homepage_config` 增加 `site`
2. 唯一键调整为 `(site, section)`
3. 迁移旧数据，至少生成 `cn` 和 `intl` 两套行
4. `intl` 优先使用旧 `_en` 字段回填
5. 补索引，保证 `(site, is_visible, display_order)` 读性能

验收标准：

- 新旧数据都可被安全读取
- 不会因为迁移导致首页空白
- `cn / intl` 行数据完整存在

## `P2-A2` Homepage 前台兼容读

目标：

- 让前台先能读新结构
- 在后台切换前完成兼容

涉及文件：

- [framer_home.js](/Volumes/chao/AI/xianyu_profit_calculator/js/framer_home.js)
- [prefetch-home.js](/Volumes/chao/AI/xianyu_profit_calculator/js/prefetch-home.js)
- [section-visibility.js](/Volumes/chao/AI/xianyu_profit_calculator/js/section-visibility.js)
- [cache.js](/Volumes/chao/AI/xianyu_profit_calculator/js/cache.js)

要做的事：

1. 首页读取按当前站点取配置
2. 预取 key 和更新时间 key 改成按站点命名
3. 前台允许短期兼容旧结构，直到 admin 写链路切换完成

验收标准：

- 当前站点能稳定读到对应首页内容
- 一站的缓存失效不会影响另一站
- 页面切换当天不出现首页空白

## `P2-A3` Homepage Admin Handler

目标：

- 把首页后台读写从浏览器直写迁到服务端

涉及文件：

- [admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/admin.js)
- 新增 `server/api-handlers/admin/homepage/config.js`
- [admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin.js)

要做的事：

1. 提供站点化 `GET`
2. 提供站点化 `POST/PATCH`
3. 写入显式拒绝 `all`
4. audit 统一记录 `module=homepage`

验收标准：

- 首页后台不再前端直接写库
- `site` 只允许 `cn / intl`
- 首页改动在 audit 中可追溯

## `P2-A4` Homepage 后台切换新模型

目标：

- 让后台 UI 真正使用新首页模型

涉及文件：

- [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)
- [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)

要做的事：

1. 改后台加载逻辑，按站点读取首页配置
2. 去掉单独的 `section_visibility` 平行状态
3. 让 `is_visible` 跟 section 内容一起维护
4. `all` 视图保持只读

验收标准：

- 后台切换 `cn / intl` 时能看到不同首页内容
- 显隐和内容来自同一份数据
- `ticker` 能进入统一模型

## `P2-A5` Homepage 旧语义清理与 Smoke

目标：

- 清理首页域遗留的旧概念和旧缓存

涉及文件：

- [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)
- [section-visibility.js](/Volumes/chao/AI/xianyu_profit_calculator/js/section-visibility.js)
- 前台缓存相关代码

要做的事：

1. 清理 `global` 缓存键语义
2. 清理 `prompts -> gallery` 旧映射
3. 把 `footer` 从 homepage 域移出
4. 做首页双站 smoke

验收标准：

- 不再残留旧 section 和旧缓存语义
- 首页双站 smoke 稳定通过

## 7. Shop / Payments 任务明细

## `P2-B1` 共享退款编排服务

目标：

- 把商城退款的核心执行逻辑收成一条服务端能力

涉及文件：

- 新增 `api/_lib/shop/refunds.js`
- 如需要，相关 site-aware points helper

要做的事：

1. 读取订单，拿到 `user_id / price_paid / site / inventory`
2. 校验订单当前是否可退款
3. 按订单站点退积分
4. 回滚库存状态
5. 更新订单退款状态
6. 写统一 audit

验收标准：

- 同一用户双站余额不会串改
- 同一笔退款重复提交可被幂等保护
- 退款失败不会留下半成功状态

## `P2-B2` Payments Shop Refund Handler

目标：

- 给商城退款提供正式服务端入口

涉及文件：

- [admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/admin.js)
- 新增 `server/api-handlers/admin/payments/shop-refund.js`
- [admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin.js)

要做的事：

1. 增加 `/api/admin/payments/shop-refund`
2. 复用共享退款编排服务
3. 权限先沿用商城售后上下文
4. 返回标准 JSON 错误模型

验收标准：

- 浏览器不再碰旧退款 RPC
- handler 权限、审计、错误口径统一

## `P2-B3` Shop 前端退款入口切换

目标：

- 在不重做商城 UI 的前提下完成服务端切换

涉及文件：

- [admin-shop.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-shop.js)

要做的事：

1. 保留退款弹窗交互
2. 把提交逻辑从 `rpc('fn_admin_refund_order')` 改成 `fetch('/api/admin/payments/shop-refund')`
3. 成功后继续刷新订单和库存视图

验收标准：

- 运营操作习惯不变
- 执行链路已切到新 handler

## `P2-B4` Tickets Refund 复用共享服务

目标：

- 让工单退款和商城退款共用一条底层退款能力

涉及文件：

- [tickets/process.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/tickets/process.js)
- 退款相关测试

要做的事：

1. 找出工单退款的旧执行路径
2. 改为调用共享退款编排服务
3. 保持工单侧上下文和结果同步逻辑

验收标准：

- 工单退款不再保留第二套独立退款实现
- 工单链路仍能同步回 ticket 结果

## `P2-B5` 旧退款 RPC 退场与回归

目标：

- 让旧退款 RPC 退居兜底或彻底退场

涉及文件：

- [enhance_refund_function.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/enhance_refund_function.sql)
- 退款相关 SQL / 权限配置

要做的事：

1. 确认前端已没有直连旧 RPC
2. 评估是否收紧旧 RPC 对 `authenticated` 的可执行授权
3. 回归退款主链路

验收标准：

- 浏览器不能直接调用旧退款 RPC
- 退款主链路全部通过新服务端实现

## 8. 测试与验收

自动测试至少运行：

```bash
node --test tests/admin-handler-permissions.test.js
node --test tests/admin-payments-actions.test.js
node --test tests/admin-tickets-process.test.js
```

建议新增：

- Homepage site read/write contract test
- Shop refund site isolation test
- Shop refund idempotency test

手工 Smoke：

### Homepage

1. 在 `cn` 站编辑首页标题并保存
2. 刷新后确认 `intl` 不受影响
3. 在 `intl` 站切换 section 显隐并保存
4. 刷新前台确认只影响当前站点

### Shop / Payments

1. 用测试订单执行一次退款
2. 确认订单状态变化正确
3. 确认对应站点余额变化正确
4. 确认库存状态变化正确
5. 确认 audit 可见
6. 重复提交同一退款，确认不会二次退账

## 9. 建议排期

如果两条线并行，建议按 5 到 6 个工作日推进：

### Day 1

- `P2-A1`
- `P2-B1`

### Day 2

- `P2-A2`
- `P2-B1` 收尾

### Day 3

- `P2-A3`
- `P2-B2`

### Day 4

- `P2-A4`
- `P2-B3`

### Day 5

- `P2-A5`
- `P2-B4`

### Day 6

- `P2-B5`
- 联调与发布说明

## 10. 风险点

第二阶段最常见的翻车点有 4 类：

1. 首页 schema 已切，但前台还没兼容，导致首页空白
2. 首页内容已双站，显隐还在旧配置，导致两套来源打架
3. 退款链路只改了一半，出现“前端切到新接口，底层仍是旧单站逻辑”
4. 退款编排没有幂等，重复点击导致二次退账

因此这一阶段一定要保证：

- 先兼容读，再切换写
- 首页和退款都按“先底层、后 UI”的顺序推进
- 财务链路以幂等和 audit 为第一优先级

## 11. 交付物

Phase 2 结束后，应该交付这些东西：

1. 一套站点化的 Homepage 配置模型
2. 一条首页前后台统一的读写链路
3. 一条服务端化的商城退款链路
4. 一条共享的退款编排能力
5. 一组针对首页和退款主链路的最小回归测试
