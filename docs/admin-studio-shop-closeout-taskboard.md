# Admin Studio 商城系统收口任务单

这份文档用于把当前 `Admin Studio` 商城系统的升级方向压成可以直接排期和开工的阶段性任务清单。

这份任务单的重点不是重新讨论“商城要不要做”，而是回答下面 4 个问题：

1. 商城系统当前已经做到哪一步
2. 还没收口的核心问题是什么
3. 后续应该按什么阶段推进
4. 每个阶段具体要做哪些任务、依赖什么、怎样算完成

配套文档：

- [admin-studio-product-analytics-phase1-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-product-analytics-phase1-taskboard.md)
- [admin-studio-business-analytics-closeout-audit.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-business-analytics-closeout-audit.md)
- [admin-studio-safe-rebuild-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-safe-rebuild-plan.md)
- [admin-studio-rebuild-roadmap.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-rebuild-roadmap.md)
- [admin-studio-shop-phase-a-test-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-shop-phase-a-test-checklist.md)
- [admin-studio-shop-phase-b-test-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-shop-phase-b-test-checklist.md)
- [admin-studio-shop-phase-c-test-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-shop-phase-c-test-checklist.md)

## 1. 当前状态（2026-04-09）

按当前代码和文档状态，商城系统已经不再处于“从 0 到 1”的阶段。

当前已经具备：

- 商品管理
- 库存导入与库存列表
- 订单列表与退款动作
- 履约任务、死信、锁冲突、人工重放
- 商品经营分析一期与二期的大部分能力
- 与支付 / 售后 / 履约 / 用户 / 内容的联动

当前更像是下面这种状态：

- `商城操作后台`：已可用，但主链稳定性和运维值班能力还值得继续收紧
- `商品经营分析`：主线基本完成，后续更多是独立深化，不再是补基础能力

所以接下来更合理的方向不是继续横向堆页面，而是：

1. 先收口 `订单 -> 库存 -> 履约` 交易主链
2. 再补强 `履约值班 / 发布检查 / 告警配置`
3. 最后再做 `内容经营 / 用户价值` 的独立深化

## 2. 分阶段目标

## Phase A：交易主链与值班闭环

目标：

- 把商城系统从“能跑”提升到“可信”
- 把履约工作台从“能看”提升到“可值班”
- 把异常订单处理从“跨页跳转”收口到“单页闭环”

这一阶段优先做：

1. 唯一关联硬化
2. 履约工作台查询重构
3. 订单详情单页闭环
4. 履约动作自动化回归

当前实施状态（2026-04-09）：

- `SC-A1` 已完成代码收口，订单 / 库存 / 订单详情已改为优先走 `shop_order_items` 精确关联
- `SC-A2` 已完成第一轮查询重构，履约主列表、死信、锁冲突已切到服务端分页优先
- `SC-A3` 已完成后台订单详情单页闭环，补齐支付 / 库存 / 履约 / 工单 / 风控摘要
- `SC-A4` 已补 handler 自动化回归，新增订单详情、履约列表、履约动作三组测试
- `20260409_phase_a_shop_linkage_closeout.sql` 已执行，历史单库存订单回填与 `fn_admin_list_inventory` 底层已收口
- 真人联调与统一 bug 回收请按 [admin-studio-shop-phase-a-test-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-shop-phase-a-test-checklist.md) 执行

## Phase B：可运营性与发布护栏

目标：

- 把商城从“开发驱动运维”提升到“运营可控”
- 把常见错误尽量前置到发布和配置阶段拦住

这一阶段优先做：

1. 商品发布检查器
2. 告警参数配置化
3. 多步写操作事务化
4. 检索与筛选增强

当前实施状态（2026-04-09）：

- `SC-B1` 已完成第一轮发布检查器收口，商品保存前会先走后台校验，阻塞错误会直接拦住保存，非阻塞风险会先确认再继续
- `SC-B2` 现有 `Ops Alerts` 配置中心已覆盖阈值、临时静默、工作时段、汇总发送和商城风险类配置，这一轮以验证和收口为主，没有重复重写告警中心
- `SC-B3` 已完成第一轮事务化收口，分类重命名、分类删除、商品批量排序优先走数据库 RPC 原子操作，RPC 未安装时才退回兼容路径
- `SC-B4` 已完成第一轮检索增强，商品支持关键字和发货模式筛选，订单支持邮箱/用户名回查，库存底层搜索已扩展到订单号、邮箱、批次和备注
- 仍需执行一条 SQL migration 完成 `SC-B3` / `SC-B4` 的数据库侧收口：
  - [supabase/migrations/20260409_phase_b_shop_guardrails.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260409_phase_b_shop_guardrails.sql)
- 真人联调与统一 bug 回收请按 [admin-studio-shop-phase-b-test-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-shop-phase-b-test-checklist.md) 执行

## Phase C：经营层独立深化

目标：

- 把商城系统上层的内容与用户经营视角做成独立能力
- 不再继续把所有经营判断都挤在商品视角里

这一阶段优先做：

1. 内容经营页
2. 用户价值驾驶舱

当前实施状态（2026-04-09）：

- `SC-C1` 已完成第一轮独立内容经营页收口，`content` 分栏新增独立“内容经营页”主视图，内容级经营判断、问题摘要、复查结论和建议动作已从原内容带货详情里抽出
- `SC-C1` 保留并复用了原“内容带货详情”作为下钻视图，内容经营页与带货详情、商品经营、订单链、用户价值之间的跳转已保持联动
- `SC-C2` 已完成第一轮独立用户价值驾驶舱收口，`growth` 分栏新增独立“用户价值驾驶舱”主视图，首单、复购、跨商品承接和退款风险复查已从原总览挂载升级成独立承接面板
- `SC-C2` 已补回写联动刷新，支付 / 售后 / 订单侧处理结果回写后，内容经营页、内容带货详情和用户价值驾驶舱会同步刷新复查结论
- `Phase C` 本轮没有新增必须执行的 SQL migration
- 真人联调与统一 bug 回收请按 [admin-studio-shop-phase-c-test-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-shop-phase-c-test-checklist.md) 执行

## 3. 完成标准

满足下面条件，才算这一轮商城系统收口基本完成：

1. 新订单都能稳定关联到唯一库存与履约任务
2. 订单页和库存页不再依赖主要的补猜 / 回推逻辑
3. 履约主列表、死信、锁冲突、冲突审计都能稳定分页与筛选
4. 异常订单处理时，支付 / 退款 / 库存 / 履约 / 工单 / 风控上下文能在一个主视图内完成承接
5. 履约关键动作具备自动化回归护栏
6. 商品发布前能拦住高风险错误配置
7. 告警参数可以由后台配置，而不是只能通过默认常量控制
8. 内容经营与用户价值进入独立深化阶段，不再和商城主链收口互相阻塞

## 4. 分支策略

建议按阶段拆分：

- `codex/admin-shop-closeout-phase-a`
- `codex/admin-shop-closeout-phase-b`
- `codex/admin-shop-closeout-phase-c`

如果团队人手有限，建议严格按 `A -> B -> C` 顺序推进。

原因：

- `Phase A` 是关键路径
- `Phase B` 建立长期运营护栏
- `Phase C` 属于经营产品深化，不应反向阻塞主链收口

## 5. 任务总览

| 任务 ID | 任务名 | 建议负责人 | 预估工时 | 前置依赖 | 是否阻塞后续 |
|---|---|---|---|---|---|
| `SC-A1` | 订单-库存-履约唯一关联硬化 | 后端 / SQL | `3-5 天` | 无 | 是 |
| `SC-A2` | 履约工作台查询与分页重构 | 后端 / 前端 | `2-4 天` | `SC-A1` | 是 |
| `SC-A3` | 订单详情单页闭环 | 前端 / 后端 | `2-3 天` | `SC-A1` `SC-A2` | 否 |
| `SC-A4` | 履约动作自动化回归补齐 | QA / 后端 | `1.5-2.5 天` | `SC-A2` | 是 |
| `SC-B1` | 商品发布检查器 | 前端 / 后端 | `1.5-2 天` | `SC-A1` | 否 |
| `SC-B2` | 告警参数配置化二期 | 后端 / Ops 前端 | `2-3 天` | 无 | 否 |
| `SC-B3` | 分类与批量写操作事务化 | 后端 / SQL | `1.5-2 天` | `SC-A1` | 否 |
| `SC-B4` | 后台检索与运营筛选增强 | 前端 / 后端 | `2-3 天` | `SC-A1` | 否 |
| `SC-C1` | 内容经营页 | 分析前端 / 分析后端 | `3-4 天` | `SC-A3` `SC-B4` | 否 |
| `SC-C2` | 用户价值驾驶舱 | 分析前端 / 分析后端 | `4-5 天` | `SC-A3` `SC-B4` | 否 |

## 6. Phase A 任务明细

## `SC-A1` 订单-库存-履约唯一关联硬化

目标：

- 把 `订单 -> 库存 -> 履约任务` 收成唯一主链
- 消灭后台里对订单和库存内容的主要补猜逻辑
- 让退款、履约、售后都围绕同一条主记录运转

涉及文件：

- [server/api-handlers/admin/shop/orders.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/orders.js)
- [server/api-handlers/admin/shop/inventory.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/inventory.js)
- [server/api-handlers/admin/shop/delivery-tasks.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/delivery-tasks.js)
- [api/shop/purchase.js](/Volumes/chao/AI/xianyu_profit_calculator/api/shop/purchase.js)
- [server/api-handlers/admin/payments/shop-refund.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/payments/shop-refund.js)

要做的事：

1. 盘点当前会导致 `inventory_id / order_id / task.order_id` 缺失的场景
2. 明确新订单的唯一关联写入规则
3. 调整购买、履约建单、退款回滚链路，保证主链一致
4. 把后台读取改成“主链优先”，把补偿逻辑降为历史兼容兜底
5. 如有必要，补一轮历史脏数据修复脚本或只读兼容方案

验收标准：

1. 新订单都能唯一反查到库存与履约任务
2. 订单页不再依赖主要的 `points_ledger` 时间窗回推
3. 库存页不再依赖主要的 `buyer_id + product_id` 反推订单
4. 退款、履约、售后对同一订单的上下文一致

## `SC-A2` 履约工作台查询与分页重构

目标：

- 把履约台从“拉全量再本地过滤”提升到“服务端可扩展分页”
- 为值班场景提供稳定的列表、筛选、统计和刷新能力

涉及文件：

- [server/api-handlers/admin/shop/delivery-tasks.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/delivery-tasks.js)
- [server/api-handlers/admin/shop/delivery-actions.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/delivery-actions.js)
- [js/admin-shop.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-shop.js)

要做的事：

1. 重构主任务列表查询
2. 重构死信列表查询
3. 重构锁冲突列表查询
4. 重构冲突审计与人工重放记录查询
5. 统一分页、筛选、统计口径
6. 保留必要的历史兼容，但不再把全量拉取作为主路径

验收标准：

1. 主任务列表、死信、锁冲突、冲突审计都走服务端分页
2. 高量数据下切筛选或翻页不会明显卡顿
3. 冲突桶、任务聚焦、重放记录仍能保留现有联动能力
4. 值班路径下的刷新、复制恢复链接、异常状态展示保持可用

## `SC-A3` 订单详情单页闭环

目标：

- 给商城异常订单提供单页闭环处理视图
- 避免在商城、支付、售后、运营保障之间来回跳转

涉及文件：

- [js/admin-shop.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-shop.js)
- [server/api-handlers/admin/shop/orders.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/orders.js)
- [server/api-handlers/admin/payments/shop-refund.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/payments/shop-refund.js)
- [server/api-handlers/admin/settings/ops-alert-monitor.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/ops-alert-monitor.js)
- [server/api-handlers/admin/tickets/metrics.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/tickets/metrics.js)

要做的事：

1. 在订单详情里补齐支付、退款、库存、履约、工单、风控摘要
2. 提供常见处理动作的清晰入口
3. 明确异常态、空态、处理中状态的 UI 语义
4. 保持与商品经营、运营保障、工单的跳转上下文一致

验收标准：

1. 处理异常订单时，80% 常用信息可在一个主视图完成阅读
2. 支付、退款、履约、工单、风控摘要口径一致
3. 对于需要跨模块深挖的场景，跳转上下文可恢复
4. 单页不会因为缺少某个子系统字段而直接报错

## `SC-A4` 履约动作自动化回归补齐

目标：

- 给履约值班链路建立自动化护栏
- 降低后续调整查询、动作、策略时的回归风险

涉及文件：

- 新增 `tests/admin-shop-delivery-tasks-handler.test.js`
- 新增 `tests/admin-shop-delivery-actions-handler.test.js`
- [tests/admin-shop-orders-handler.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-shop-orders-handler.test.js)
- [tests/admin-shop-inventory-handler.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-shop-inventory-handler.test.js)

要做的事：

1. 为履约任务列表补 handler 测试
2. 为死信、锁冲突、冲突审计、重放记录补覆盖
3. 为人工重放、转死信、强制解锁、标记已送达等动作补测试
4. 建立一组稳定 fixture 支撑值班场景回归

验收标准：

1. 履约关键动作都有自动化测试
2. 查询、筛选、异常返回都有基础护栏
3. 后续改履约台时，不需要完全依赖真人 smoke 才知道是否改坏

## 7. Phase B 任务明细

## `SC-B1` 商品发布检查器

目标：

- 把商品高风险错误配置尽量拦在保存 / 发布前
- 减少“商品配错后才在订单或履约侧暴露”的问题

涉及文件：

- [js/admin-shop.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-shop.js)
- [server/api-handlers/admin/shop/mutate.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/mutate.js)

要做的事：

1. 校验 `delivery_type` 与 `webhook_target`
2. 校验 KEY 型商品的库存健康提示
3. 校验限购配置的完整性与冲突
4. 校验发货说明、注意事项等关键字段
5. 给出“阻止保存”与“允许保存但提示风险”的分级反馈

验收标准：

1. 明显错误的 API 商品配置会在保存前被拦住
2. 明显高风险的 KEY 商品配置会给出库存或履约警告
3. 发布前反馈语义明确，不会把非阻塞问题误报成保存失败

## `SC-B2` 告警参数配置化二期

目标：

- 把库存、履约、退款、售后相关告警的主要参数做成后台可配置
- 让值班规则不再只能依赖默认常量

涉及文件：

- [docs/admin-studio-safe-rebuild-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-safe-rebuild-plan.md)
- [server/api-handlers/admin/settings/ops-alerts.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/ops-alerts.js)
- [server/api-handlers/admin/settings/ops-alert-monitor.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/ops-alert-monitor.js)
- [api/_lib/shop-inventory-alerts.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/shop-inventory-alerts.js)
- [api/_lib/shop-order-delivery-alerts.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/shop-order-delivery-alerts.js)

要做的事：

1. 补库存补货相关阈值配置
2. 补静默到某时间、工作时段、汇总发送配置
3. 补履约与死信相关的主要策略参数
4. 保持告警监控面板和策略面板的口径一致

验收标准：

1. 库存与补货主要参数可配置
2. 静默、汇总、工作时段等规则可配置
3. 配置变更后，监控面板能准确反映当前生效值

## `SC-B3` 分类与批量写操作事务化

目标：

- 避免分类重命名、删除、批量迁移、批量删除过程中留下半成功状态
- 把多步写操作收成原子动作或受控补偿流程

涉及文件：

- [server/api-handlers/admin/shop/mutate.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/mutate.js)

要做的事：

1. 梳理分类 rename / delete 的多步写流程
2. 梳理商品批量迁移与批量删除的异常返回口径
3. 明确事务化方案或受控补偿方案
4. 补回归测试，覆盖失败中断场景

验收标准：

1. 分类重命名失败不会留下“分类已改名但商品未同步”的状态
2. 分类删除失败不会留下“部分商品已迁移、部分未迁移”的状态
3. 批量动作的成功数、失败数和回滚语义明确

## `SC-B4` 后台检索与运营筛选增强

目标：

- 让商城后台更适合运营、客服和值班场景
- 减少必须知道精确 ID 才能定位问题的情况

涉及文件：

- [server/api-handlers/admin/shop/products.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/products.js)
- [server/api-handlers/admin/shop/orders.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/orders.js)
- [server/api-handlers/admin/shop/inventory.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/inventory.js)
- [js/admin-shop.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-shop.js)

要做的事：

1. 增强订单、商品、库存的联合检索能力
2. 增强退款状态、履约状态、风险标签等筛选
3. 提供适合运营的常用预设筛选
4. 保持 URL 深链和筛选上下文可恢复

验收标准：

1. 常见运营问题能通过 1-2 次筛选快速定位
2. 订单、商品、库存三类视图的筛选语义尽量一致
3. 复制链接后，同事打开能恢复当前筛选上下文

## 8. Phase C 任务明细

## `SC-C1` 内容经营页

目标：

- 把现有“内容带货详情”升级成独立的内容经营视图
- 让内容侧能回答“要不要继续放量、哪里还没收口”

涉及文件：

- [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)
- [js/admin-analytics-panel-loaders.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-analytics-panel-loaders.js)
- [docs/admin-studio-business-analytics-closeout-audit.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-business-analytics-closeout-audit.md)

要做的事：

1. 从现有内容带货详情中抽出内容经营主视图
2. 补内容级经营判断
3. 补内容级复查结论
4. 补内容级建议动作和下次复查方式

验收标准：

1. 内容侧不再只是“带货样本详情”
2. 内容经营页能回答“继续放量 / 待复查 / 暂缓推进”
3. 内容、商品、订单链路之间的跳转保持稳定

当前状态（2026-04-09）：

- 已在 `analytics content` 分栏落地独立内容经营页
- 已补内容级经营判断、问题摘要、复查结论、建议动作和用户价值承接入口
- 已保留原内容带货详情作为下钻层，避免内容经营页再次退化为纯详情页

## `SC-C2` 用户价值驾驶舱

目标：

- 把当前“被商品影响用户”的承接链升级成独立经营视角
- 让用户侧能回答“哪类用户值得重点运营、问题卡在哪一层”

涉及文件：

- [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)
- [js/admin-analytics-panel-loaders.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-analytics-panel-loaders.js)
- [docs/admin-studio-business-analytics-closeout-audit.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-business-analytics-closeout-audit.md)

要做的事：

1. 抽出独立用户经营视图
2. 补用户价值分层、复购承接、跨商品承接
3. 保持内容、商品、支付、售后的用户链路一致

验收标准：

1. 用户侧不再只附着在用户详情
2. 能看清用户价值是否真正沉淀，而不只是形成首单
3. 用户经营页不会和商品经营页重复堆叠同一套信息

当前状态（2026-04-09）：

- 已在 `analytics growth` 分栏落地独立用户价值驾驶舱
- 已补首单、复购、跨商品承接、高价值样本和退款风险复查视图
- 已补回写刷新，支付 / 售后 / 订单处理结果会同步刷新独立用户价值驾驶舱

## 9. 建议执行顺序

推荐按下面顺序推进：

1. `SC-A1`
2. `SC-A2`
3. `SC-A4`
4. `SC-A3`
5. `SC-B1`
6. `SC-B3`
7. `SC-B4`
8. `SC-B2`
9. `SC-C1`
10. `SC-C2`

原因：

- `SC-A1` 是整条主链的根
- `SC-A2` 和 `SC-A4` 决定值班能力是否可靠
- `SC-A3` 负责把交易问题单页收口
- `SC-B1` `SC-B3` `SC-B4` 都建立在主链已可信的前提上
- `SC-C1` `SC-C2` 属于经营层深化，不应抢占主链收口带宽

## 10. 第一阶段（Phase A）建议节奏

如果团队按 `1 名后端 / SQL + 1 名后台前端 + 0.5 名 QA` 配置推进，建议把 `Phase A` 控制在 `2 周` 左右。

建议节奏：

1. 第 1 周前半：
   - 冻结主链规则
   - 盘点历史兼容和脏数据
   - 确定履约查询重构边界
2. 第 1 周后半：
   - 接入履约主列表和订单详情壳层
   - 开始补履约动作测试骨架
3. 第 2 周前半：
   - 收口死信、锁冲突、重放记录
   - 接单页闭环和跨模块摘要
4. 第 2 周后半：
   - 完成自动化回归
   - 只修联调阻塞，不新增范围

Phase A 最低放行标准：

1. 新订单主链稳定
2. 履约主要值班列表稳定
3. 履约关键动作有自动化回归
4. 订单详情达到基础闭环能力

## 11. 一句话结论

这一轮商城系统最合理的推进方式不是继续补零散功能，而是：

1. 先收口 `交易主链`
2. 再补 `值班与运营护栏`
3. 最后推进 `内容经营 / 用户价值` 的独立深化

也就是说：

- `Phase A` 解决“商城是否可信”
- `Phase B` 解决“商城是否可长期运营”
- `Phase C` 解决“商城上层经营能力是否继续升级”
