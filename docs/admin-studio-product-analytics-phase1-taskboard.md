# Admin Studio 商品经营一期任务单

这份文档用于把“经营分析重构方案”里的 `商品经营一期` 压成可以直接开工的任务清单。

目标不是一次把整套经营分析全部做完，而是先把后台最缺的“商品经营分析层”搭起来，让后台第一次能从经营角度看商品，而不只是管理商品。

配套文档：

- [admin-studio-business-analytics-restructure-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-business-analytics-restructure-plan.md)
- [admin-studio-business-analytics-closeout-audit.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-business-analytics-closeout-audit.md)
- [admin-studio-analytics-2-upgrade-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-analytics-2-upgrade-plan.md)
- [admin-studio-rebuild-roadmap.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-rebuild-roadmap.md)

## 一期当前状态（2026-04-07）

这份一期任务单当前已经不再是纯待办，而是大部分都已落地。按当前代码状态看：

- `PA1-1` 页面壳与导航：已完成
- `PA1-2` 商品分析 bundle / RPC：已完成
- `PA1-3` 商品总盘：已完成
- `PA1-4` 商品榜单：已完成
- `PA1-5` 商品漏斗：已完成
- `PA1-6` 库存与履约健康：已完成
- `PA1-7` 单品详情与跨模块跳转：已完成
- `PA1-8` 下钻协议与工作台联动：已完成
- `PA1-9` 商品事件埋点补齐：已完成到当前一期所需范围
- `PA1-10` 回归与 smoke：已建立并持续补充

从当前角度看，`商品经营一期` 可以认为已经完成，并且已经继续自然延伸到了二期：

- 预警中心
- 复查结论
- 历史结论
- 用户去向
- 内容带货归因
- 与支付 / 售后 / 履约 / 订单的处理闭环

所以这份任务单现在更适合被视为：

- `一期交付基线`
- 后续二期能力的完成参考

按 `2026-04-07` 当前主线判断，这份一期任务单已经不再是阻塞项；后续如果继续推进，更应该把精力放在 `内容经营 / 用户价值 / 运营保障` 的独立深化，而不是回头再补商品一期基础能力。

## 1. 商品经营一期的范围

一期只做“商品经营最值得先有的部分”，不追求一步到位。

这一期要解决的问题：

- 后台能不能快速看懂商品卖得怎么样
- 能不能找出值得补库存、调价、加曝光或下架的商品
- 能不能把商品经营和库存 / 订单 / 履约 / 用户联动起来

这一期暂时不做的内容：

- 全量用户价值模型
- 复杂归因算法
- 自动化 AI 建议动作
- 多维实验系统
- 全套 ROI 模型

## 2. 一期交付目标

商品经营一期完成后，后台至少要拥有下面 5 类能力：

1. 能看商品总盘
2. 能看商品榜单
3. 能看商品漏斗
4. 能看库存与履约健康
5. 能点进单品详情，并从详情跳到库存、订单、履约、商品编辑

## 3. 建议信息架构

推荐落位：

- 如果已经开始做新的 `经营分析` 一级侧栏，就把 `商品经营` 做成其中一个二级视图
- 如果还没拆一级侧栏，就先在当前 `数据分析` / `经营分析` 中新增一个 `商品` tab

建议一期页面结构：

1. `商品总盘`
2. `商品榜单`
3. `商品漏斗`
4. `库存与履约健康`
5. `单品详情抽屉 / 详情面板`

## 4. 完成标准

满足以下条件，才算一期完成：

1. 后台有单独的 `商品经营` 页面壳
2. 商品总盘能按 `all / cn / intl` 和时间范围切换
3. 商品榜单能至少展示 `销量 / 积分GMV / 转化率 / 高曝光低成交`
4. 商品漏斗能展示 `曝光 -> 点击 -> 下单 -> 支付成功 -> 发货成功`
5. 库存与履约健康能展示低库存、售罄、履约异常商品
6. 点击商品名能打开单品详情
7. 单品详情能跳到 `商城商品 / 库存 / 订单 / 履约`
8. 不再依赖前端大范围扫表拼商品经营数据

## 5. 分支策略

主分支建议：

- `codex/admin-product-analytics-phase1`

建议按下面顺序拆 commit：

1. 页面壳与导航
2. bundle / RPC 数据层
3. 商品总盘与榜单
4. 漏斗与健康度
5. 单品详情与下钻
6. 埋点与回归

## 6. 任务总览

| 任务 ID | 任务名 | 建议负责人 | 预估工时 | 前置依赖 | 是否阻塞后续 |
|---|---|---|---|---|---|
| `PA1-1` | 商品经营页面壳与导航落位 | 前端 | `0.5 天` | 无 | 是 |
| `PA1-2` | 商品分析服务端 bundle / RPC 设计 | 后端 / SQL | `1-1.5 天` | 无 | 是 |
| `PA1-3` | 商品总盘卡片与趋势 | 前端 | `0.5-1 天` | `PA1-2` | 是 |
| `PA1-4` | 商品榜单区块 | 前端 | `0.5-1 天` | `PA1-2` | 否 |
| `PA1-5` | 商品漏斗区块 | 前端 / SQL | `0.5-1 天` | `PA1-2` | 否 |
| `PA1-6` | 库存与履约健康区块 | 前端 / 后端 | `0.5-1 天` | `PA1-2` | 否 |
| `PA1-7` | 单品详情抽屉与跨模块跳转 | 前端 | `1 天` | `PA1-3` `PA1-4` `PA1-6` | 否 |
| `PA1-8` | 下钻协议与工作台联动 | 前端 / 平台 | `0.5 天` | `PA1-7` | 否 |
| `PA1-9` | 商品事件埋点补齐 | 前端 / 后端 | `1-2 天` | `PA1-2` | 否 |
| `PA1-10` | 回归测试与 Smoke 验收 | 联调 / QA | `0.5-1 天` | `PA1-3`~`PA1-9` | 是 |

## 7. 任务明细

## `PA1-1` 商品经营页面壳与导航落位

目标：

- 在后台中给 `商品经营` 一个明确落位
- 不再把商品经营继续埋在现有混合型卡片里

涉及文件：

- [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)
- [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)
- 相关 analytics helper 文件

要做的事：

1. 选择一期落位方式：
   - 新一级侧栏 `经营分析`
   - 或在现有 analytics 中新增 `商品` tab
2. 新增商品经营挂载区：
   - `productOverview`
   - `productRankings`
   - `productFunnel`
   - `productHealth`
   - `productDetailPanel`
3. 统一接入现有：
   - 时间范围
   - 站点切换
   - 导出入口
   - 刷新入口

验收标准：

- 商品经营区有单独挂载区
- 站点和时间范围能作用于整页

## `PA1-2` 商品分析服务端 bundle / RPC 设计

目标：

- 先把商品分析数据层收口，避免再走前端大范围扫表拼装

建议新增的服务端入口：

- `product_summary_bundle`
- `product_rank_bundle`
- `product_funnel_bundle`
- `product_health_bundle`
- `product_detail_bundle`

建议输出结构：

1. `product_summary_bundle`
   - `summary`
   - `trend`
   - `siteComparison`
2. `product_rank_bundle`
   - `salesTop`
   - `gmvTop`
   - `conversionTop`
   - `highExposureLowConversion`
3. `product_funnel_bundle`
   - `shopExposure`
   - `productClick`
   - `detailView`
   - `purchaseIntent`
   - `purchaseSuccess`
   - `deliverySuccess`
4. `product_health_bundle`
   - `lowStockProducts`
   - `soldOutProducts`
   - `deliveryRiskProducts`
   - `refundRiskProducts`
   - `inventoryTurnoverHints`
5. `product_detail_bundle`
   - `product`
   - `trend`
   - `funnel`
   - `inventory`
   - `orders`
   - `delivery`
   - `relatedPrompts`

建议数据源：

- `shop_products`
- `shop_orders`
- `shop_order_items`
- `shop_inventory`
- `points_ledger`
- `payment_orders`
- `user_events`

验收标准：

- 前端不再自己拼大对象
- 商品经营所有区块都有稳定 bundle 来源

## `PA1-3` 商品总盘卡片与趋势

目标：

- 先回答“整个商城卖得怎么样”

建议卡片：

- 成交订单数
- 成交用户数
- 商品积分 GMV
- 客单价
- 支付成功率
- 履约成功率
- 退款率
- 商品复购率

建议图表：

- 商品成交趋势折线
- `CN / INTL` 商品成交对比柱图
- 类目贡献 donut / treemap

涉及文件：

- 商品经营页面壳文件
- 对应 chart loader helper

验收标准：

- 切换站点和时间范围时总盘同步变化
- 能一眼看到商品经营整体健康度

## `PA1-4` 商品榜单区块

目标：

- 让后台能快速定位“好商品”和“问题商品”

建议榜单：

- 销量 Top 20
- 积分 GMV Top 20
- 转化率 Top 20
- 高曝光低成交 Top 20
- 退款率 Top 20
- 履约异常率 Top 20

建议字段：

- 商品名
- 类目
- 站点
- 曝光
- 点击
- 成交用户
- 成交订单
- 积分 GMV
- 转化率
- 健康度标签

交互要求：

- 点击商品名打开单品详情
- 点击异常标签跳到库存 / 履约 / 订单

验收标准：

- 后台能快速识别头部商品和问题商品

## `PA1-5` 商品漏斗区块

目标：

- 让后台知道商品流失发生在哪一层

建议漏斗阶段：

- 商城页曝光
- 商品卡点击
- 商品详情浏览
- 购买点击
- 支付成功
- 发货成功
- 售后 / 退款

注意：

- 一期如果没有全量细粒度事件，可以先上“可用真实事件版本”
- 但必须显式标注哪些阶段是代理值，哪些是真实事件

建议图表：

- 漏斗图
- 站点对比漏斗
- 商品级对比表

验收标准：

- 能识别是曝光不足、点击不足、支付不足还是发货失败

## `PA1-6` 库存与履约健康区块

目标：

- 商品经营不只看卖得出去，还要看交付是否健康

建议区块：

- 低库存商品
- 售罄商品
- 长期积压商品
- 履约失败商品
- 死信关联商品
- 风险商品

建议图表：

- 库存健康矩阵
- 履约异常趋势
- 低库存告警榜

建议联动：

- 跳库存列表
- 跳履约工作台
- 跳订单列表

验收标准：

- 商品经营页能直接看到库存和交付风险

## `PA1-7` 单品详情抽屉与跨模块跳转

目标：

- 每个商品都能变成一个“可经营对象”

建议详情结构：

- 基础信息
- 趋势
- 漏斗
- 订单
- 库存
- 履约
- 相关提示词
- 用户购买概况

建议跳转：

- 跳 `商城 > 商品编辑`
- 跳 `商城 > 库存`
- 跳 `商城 > 订单`
- 跳 `商城 > API 履约`
- 跳 `用户管理`

验收标准：

- 单品详情能承载经营和运维双视角

## `PA1-8` 下钻协议与工作台联动

目标：

- 统一商品经营所有图表项的点击行为

建议协议字段：

- `destination`
- `sectionId`
- `entityType`
- `entityId`
- `site`
- `startDate`
- `endDate`
- `sourcePanel`

建议支持的 `entityType`：

- `product`
- `product_category`
- `product_order`
- `inventory_batch`
- `delivery_task`
- `user`
- `prompt`

验收标准：

- 点击任意商品分析项，都能稳定带上下文跳转

## `PA1-9` 商品事件埋点补齐

目标：

- 给商品经营后续二期和三期打底

建议新增事件：

- `shop_home_view`
- `product_card_click`
- `product_detail_view`
- `product_purchase_click`
- `product_purchase_success`
- `product_refund`
- `product_delivery_success`
- `product_delivery_fail`

建议字段：

- `site`
- `product_id`
- `category`
- `price_points`
- `source_page`
- `source_prompt_id`
- `source_channel`

一期要求：

- 至少补齐点击、详情、购买成功、发货成功、发货失败

验收标准：

- 商品漏斗不再只有粗粒度 `shop_view / shop_purchase`

## `PA1-10` 回归测试与 Smoke 验收

目标：

- 确保商品经营一期上线后不是一堆图，而是真能用

建议自动化覆盖：

- 页面壳加载
- bundle-first 请求链
- 单品详情打开
- 下钻协议
- 站点和时间范围联动

建议手工 Smoke：

1. 切换 `all / cn / intl`
2. 切换 `7 / 30 / 90 / 365 / 自定义`
3. 点击商品榜单项进入单品详情
4. 从单品详情跳库存、订单、履约
5. 对比一个高销量商品和一个问题商品的链路是否清晰
6. 检查导出是否带当前站点和时间范围

## 8. 推荐执行顺序

建议按下面顺序推进：

### 第 1 周

- `PA1-1`
- `PA1-2`
- `PA1-3`

先把页面壳、bundle 和商品总盘立起来。

### 第 2 周

- `PA1-4`
- `PA1-5`
- `PA1-6`

把榜单、漏斗、库存与履约健康补齐。

### 第 3 周

- `PA1-7`
- `PA1-8`
- `PA1-10`

把单品详情和下钻收口，并做验收。

### 第 4 周

- `PA1-9`

把商品事件埋点补齐，为后续二期扩展做准备。

如果资源有限，也可以采用更现实的顺序：

1. 页面壳
2. 商品总盘
3. 商品榜单
4. 库存与履约健康
5. 单品详情
6. 商品漏斗
7. 埋点补齐

## 9. 一期之后的二期方向

商品经营一期做完后，二期最值得继续的方向是：

- 内容到商品归因
- 用户到商品价值分层
- 类目经营驾驶舱
- 商品价格与折扣效果
- 商品退款与工单联动
- 商品 ROI 与站点差异分析

## 10. 一期当前状态（2026-04-06）

按当前代码落地情况，这份一期任务单里的核心目标已经基本达成：

| 任务 ID | 当前状态 | 说明 |
|---|---|---|
| `PA1-1` | `已完成` | 商品经营已在 `经营分析` 内有独立落位与挂载区 |
| `PA1-2` | `已完成` | 商品 summary / rank / funnel / health / detail bundle 已落地 |
| `PA1-3` | `已完成` | 商品总盘、趋势、类目贡献、经营矩阵已落地 |
| `PA1-4` | `已完成并扩展` | 榜单已从一期扩展到退款/履约/内容带货等二期榜单 |
| `PA1-5` | `已完成并扩展` | 商品漏斗已升级为详情 / 意图 / 支付 / 发货链 |
| `PA1-6` | `已完成并扩展` | 库存与履约健康已接预警与问题处理联动 |
| `PA1-7` | `已完成并扩展` | 单品详情已承接经营、库存、履约、订单、内容、用户 |
| `PA1-8` | `已完成并扩展` | 下钻协议已打通到订单 / 履约 / 支付 / 售后 / 用户 |
| `PA1-9` | `已完成基础版` | 商品事件埋点与商品归因主链已落地 |
| `PA1-10` | `已完成基础版` | 前端守门回归已长期跟随，smoke 仍偶发卡住 `RUNNING` |

也就是说：

- `商品经营一期` 可以认为已经基本做成
- 当前继续推进时，更适合按“商品经营二期 / 整站经营分析收官”来理解，而不是继续把工作拆回一期任务单

更完整的当前盘点见：

- [admin-studio-business-analytics-closeout-audit.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-business-analytics-closeout-audit.md)

## 11. 下一步建议

如果按这份任务单继续推进，最适合立即开工的是：

1. 不再回头补一期页面壳，而是继续追 `商品经营二期` 的收官项
2. 把商品样板间的方法复制到 `运营保障` 主视图
3. 再决定是否把当前 `经营分析` 进一步升级成更独立的产品结构

也就是说，下一步最值得直接落代码的，不再是回补：

- 页面壳
- 数据 bundle
- 商品总盘
- 商品榜单

而是优先看：

- `运营保障驾驶舱`
- `结构层最终拍板`
