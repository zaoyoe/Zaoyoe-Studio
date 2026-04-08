# Admin Studio 经营分析重构方案

这份文档用于把 `Admin Studio` 当前的“数据分析”从混合型图表页，重构成一个真正围绕经营管理和运维联动的分析中心。

它不是对现有 analytics 小修小补，而是一次重新定盘：

- 明确“商品经营”是一级重点，不再埋在“积分与交易”下面
- 明确“商城管理”和“经营分析”是两套不同职责
- 明确分析页的目标不是多放几张图，而是让管理员能够看懂、下钻、跳转、处理

这份文档在信息架构层面，作为 `analytics 2.0` 的新版主方案使用。

配套文档：

- [admin-studio-analytics-2-upgrade-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-analytics-2-upgrade-plan.md)
- [admin-studio-product-analytics-phase1-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-product-analytics-phase1-taskboard.md)
- [admin-studio-business-analytics-closeout-audit.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-business-analytics-closeout-audit.md)
- [admin-studio-rebuild-roadmap.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-rebuild-roadmap.md)
- [admin-studio-workbench-remediation-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-workbench-remediation-plan.md)

## 当前落地状态（2026-04-07）

这份方案最初是用来定方向的。到 `2026-04-07`，其中相当一部分已经不是“计划”，而是已经落地：

- 左侧栏主入口已经升级成 `经营分析中心`
- URL 规范入口已经使用 `module=business-center`
- 顶部已经有：
  - `经营分析中心`
  - `经营中心入口层`
  - `经营分层导航`
  - `当前经营视角`
- `商品经营` 已经形成完整样板间
- `运营保障驾驶舱` 已经形成独立主视图
- `用户 / 内容` 已经开始承接商品经营方法
- `用户价值`、`内容带货`、`运营保障` 都已经形成各自的回写与复查闭环
- 顶部 `经营分析中心` 已经开始承接收官总览、主线状态和可恢复深链

当前仍属于“下一阶段决策”的，不是入口命名，而是是否要进一步拆成更重的独立路由或子应用。

## 1. 先说结论

当前后台的问题，不是“图表不够多”，而是“分析结构和业务结构错位”。

现有后台里：

- `商城` 模块负责商品、库存、订单、履约管理，[admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)
- `数据分析` 模块负责总览、内容、积分与交易、验证服务、社区与裂变，[admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)

但真正的业务重点是：

- 用户从哪里来
- 被什么提示词吸引
- 什么时候充值
- 最终买了什么商品
- 商品是否能卖、能交付、能复购
- 异常是否要去支付、履约、库存、工单处理

因此最合理的重构不是继续把“商品”塞进现有 `积分与交易` tab，而是：

1. 保留 `商城` 模块，继续承担操作和管理职责。
2. 把 `数据分析` 升级成独立的 `经营分析` 中心。
3. 在 `经营分析` 里把 `商品经营` 提升为一级板块。
4. 把支付、履约、验证、工单、风控从“业务表现”里拆出来，放到独立的 `运营保障` 板块。

最终推荐结构不是“三瓣”，而是 **4+1 结构**：

- `经营总览`
- `用户增长`
- `提示词内容`
- `商品经营`
- `运营保障`

如果后面需要，再给 `AI 助理` 做成辅助手动区，而不是一级主视图。

## 2. 现状与问题边界

### 2.1 当前 analytics 对商城只做到“交易事件聚合”

当前 analytics 里最接近商城经营的卡片，是 `真实交易转化`。  
但它统计的是全站事件级聚合：

- `wallet_open`
- `recharge_click`
- `recharge_success`
- `shop_view`
- `shop_purchase`

对应实现见 [admin-analytics.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js)。

这能回答：

- 有没有人进商城
- 有没有人购买
- 商城购买率高不高

但它回答不了：

- 是哪个商品卖得好
- 哪个商品高曝光低成交
- 哪个商品退款率高
- 哪个商品库存快耗尽
- 哪个商品履约容易出问题
- 哪个商品在 `CN / INTL` 表现差异最大

所以当前 analytics 不是没有“商城相关数据”，而是缺少“商品经营分析层”。

### 2.2 当前商城模块偏操作，不偏经营

当前 `商城` 模块的页签是：

- `商品`
- `导入`
- `库存`
- `订单`
- `API 履约`

见 [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)。

这套结构适合做：

- 改商品
- 补库存
- 查订单
- 看履约死信

但不适合做经营判断，因为它缺少：

- 商品总盘
- 商品榜单
- 类目结构
- 单品转化
- 库存周转
- 商品异常率
- 商品与提示词/用户的联动视图

### 2.3 当前商城里唯一带“分析味”的是履约运维分析

`API 履约` 里已经有一块比较完整的趋势/热点视图，例如：

- 冲突热点
- 冲突趋势
- 死信列表
- 任务表

实现见 [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html) 和 [js/admin-shop.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-shop.js)。

但这块属于 `履约运维分析`，不是 `商品经营分析`。

它回答的是：

- 哪个目标地址冲突多
- 哪个通道容易出问题
- 哪些任务死信了

而不是：

- 哪个商品卖得最好
- 哪个商品毛利/消耗最高
- 哪个商品值得扩库存
- 哪个商品值得下架

## 3. 目标信息架构

## 3.1 新的一层职责划分

建议把后台职责拆成两条线：

### A. 管理执行线

保留现有模块，负责“改”和“处理”：

- `商城`
- `支付对账`
- `评论管理`
- `用户管理`
- `售后工单`
- `验证服务`

### B. 经营分析线

新增或重构一个一级入口 `经营分析`，负责“看”和“判断”：

- `经营总览`
- `用户增长`
- `提示词内容`
- `商品经营`
- `运营保障`

这两条线不要混。

一句话总结：

- `商城` 是操作后台
- `经营分析` 是经营驾驶舱

## 3.2 侧栏建议

当前已经落地的主入口是：

- `经营分析中心`

进入后，再显示分层经营导航：

- `总览`
- `用户`
- `提示词`
- `商品`
- `运营保障`

当前已经采用的是折中方案：

- 工程层继续沿用原 `analytics` 模块承载
- 产品层主入口升级成 `经营分析中心`
- URL 规范入口升级成 `module=business-center`

这保证了：

- 不打断现有深链
- 不强迫一次性重做全部运行时模块
- 同时已经把产品层的一级结构定下来

## 4. 五个板块怎么拆

## 4.1 经营总览

用途：给你一个全站驾驶舱，先看方向，再决定下钻去哪条线。

建议 KPI：

- 业务活跃用户
- 站点新增
- 首次充值转化率
- 首次消费去向
- 商品成交用户数
- 商品积分 GMV
- Prompt 解锁率
- 验证成功率
- 工单积压
- 履约异常数

建议图表：

- 北极星趋势折线
- `CN / INTL` 对比柱状图
- 全站经营漏斗
- 异常分布卡
- 待处理动作卡

建议动作：

- 跳商品经营
- 跳支付对账
- 跳履约工作区
- 跳用户详情
- 跳异常处理

## 4.2 用户增长

用途：判断用户从哪里来，留不留得住，值不值得继续投。

建议指标：

- 新增
- 激活
- 业务活跃
- 留存
- 复购
- 首充
- 高价值用户占比
- 风险用户占比

建议图表：

- 新增/活跃趋势
- Cohort 留存
- 用户分层漏斗
- 复购趋势
- 用户价值分布

建议下钻：

- 点击人群进入用户列表
- 点击昵称进入用户详情
- 按站点切片
- 按来源切片

## 4.3 提示词内容

用途：判断什么内容在带来浏览、解锁、评论，以及商品导流。

建议指标：

- Prompt 浏览 UV
- 解锁 UV
- 解锁率
- 评论参与率
- 热门内容榜
- 高曝光低转化内容
- 内容带来的商品点击/购买

建议图表：

- 内容趋势折线
- 内容漏斗
- 内容热榜
- 分类 treemap
- 内容到商品的 Sankey

关键补充：

内容分析不应该只看内容本身，还要看：

- 哪个 Prompt 带来充值
- 哪个 Prompt 带来商品浏览
- 哪个 Prompt 带来商品购买

这块是后面“内容和商品联动”的关键。

## 4.4 商品经营

这是这次重构的核心。

用途：让“商品”从后台管理对象，升级成真正的经营对象。

建议拆成 5 层：

### A. 商品总盘

回答：整个商城现在卖得怎么样。

建议指标：

- 成交订单数
- 成交用户数
- 商品积分 GMV
- 客单价
- 支付成功率
- 履约成功率
- 退款率
- 故障率

图表：

- 商品成交趋势
- 类目贡献占比
- 站点对比

### B. 商品榜单

回答：哪个商品好卖，哪个商品值得重点盯。

建议榜单：

- 销量 Top 20
- 收入 Top 20
- 转化率 Top 20
- 高曝光低成交 Top 20
- 退款率 Top 20
- 故障率 Top 20

图表：

- 横向条形图
- 散点图：曝光 x 转化 x 收入

### C. 单品漏斗

回答：商品在哪一步流失。

建议漏斗：

- 商城页曝光
- 商品点击
- 详情浏览
- 下单
- 支付成功
- 发货成功
- 售后/退款

图表：

- Funnel
- Sankey
- 站点对比图

### D. 库存与履约健康

回答：商品卖得出去，但能不能稳定交付。

建议指标：

- 低库存商品
- 售罄商品
- 周转慢商品
- 履约失败商品
- 死信关联商品
- 风险商品

图表：

- 库存健康矩阵
- 低库存告警榜
- 履约异常趋势

### E. 单品详情

回答：一个商品值不值得加库存、调价、加曝光、下架。

建议详情页：

- 基础信息
- 近 7/30/90 天趋势
- 曝光/成交/复购
- 用户画像
- 来源渠道
- 关联提示词
- 订单与退款
- 库存批次
- 履约与告警

单品详情必须支持直接跳：

- 商品编辑
- 库存列表
- 订单列表
- 履约任务
- 风险处理

## 4.5 运营保障

用途：把异常处理从“业务表现”里拆出去，单独看“哪里出问题了”。

建议子块：

- 支付
- 履约
- 验证
- 工单
- 风控

建议指标：

- 支付成功率
- 待认领订单
- 履约死信数
- 验证失败率
- 工单 SLA
- 风险订单数

建议图表：

- 异常趋势
- 根因分布
- 待处理队列
- 告警热力图

## 5. 为什么不是简单分三类

你提到可以拆成：

- 用户表现
- 提示词
- 商品

这个方向是对的，但如果只拆成三瓣，会有一个问题：

- 支付放哪
- 履约放哪
- 验证放哪
- 工单放哪
- 风控放哪

这些能力都很重要，如果硬塞进某一类，最后还是会重新揉在一起。

所以更好的办法是：

- `用户`
- `提示词`
- `商品`
- `运营保障`

再加一个：

- `经营总览`

这样结构才稳。

## 6. 数据层改造建议

## 6.1 现有可复用的数据资产

当前已经可以复用的数据表和事实层：

- `shop_products`
- `shop_orders`
- `shop_order_items`
- `shop_inventory`
- `payment_orders`
- `points_ledger`
- `user_events`
- `prompt_unlocks`
- `verification_logs`

这意味着我们不是从零开始，而是已经具备做“商品经营分析”的基础。

## 6.2 当前最大的缺口：商品级事件维度不够细

当前 `user_events` 已经能支撑全站行为分析，但商品相关埋点还不够细。

建议标准化商品事件：

- `shop_home_view`
- `product_card_click`
- `product_detail_view`
- `product_purchase_click`
- `product_purchase_success`
- `product_refund`
- `product_delivery_success`
- `product_delivery_fail`

每条都建议补齐：

- `site`
- `product_id`
- `category`
- `price_points`
- `source_page`
- `source_prompt_id`
- `source_channel`

## 6.3 建议新增的分析聚合层

建议新建服务端 bundle / RPC / 物化聚合，而不是继续前端拼：

- `product_summary_bundle`
- `product_rank_bundle`
- `product_funnel_bundle`
- `product_health_bundle`
- `product_detail_bundle`
- `content_product_attribution_bundle`
- `user_value_segment_bundle`
- `operations_guard_bundle`

## 6.4 商品分析需要的事实模型

建议建立这些稳定输出对象：

- `product_daily_metrics`
- `product_category_daily_metrics`
- `product_funnel_daily`
- `product_inventory_health_daily`
- `product_refund_delivery_daily`
- `content_to_product_daily`
- `user_to_product_daily`

这样前端不用每次直接扫表，也不会把逻辑写死在某个 JS 文件里。

## 7. 图表与呈现方式建议

你特别提到“不要只浮于表面”，这点很关键。

所以图表不应只停留在 KPI 卡片，建议组合如下：

### 经营总览

- KPI 卡
- 异常告警卡
- 总经营漏斗
- 站点对比柱图

### 用户增长

- Cohort 留存热力图
- 分层漏斗
- 用户价值分布

### 提示词内容

- 趋势图
- 热榜
- 分类 treemap
- 内容到商品 Sankey

### 商品经营

- 销量榜
- 收入榜
- 转化漏斗
- 类目 treemap
- 散点图
- 库存健康矩阵
- 履约异常趋势

### 运营保障

- 死信趋势
- 失败原因分布
- 工单 SLA 热图
- 风险订单队列

## 8. 跨模块联动设计

这是整个方案能不能“真用起来”的关键。

必须建立这些联动：

- 从 Prompt 跳到被其带来的商品
- 从商品跳到购买它的用户
- 从商品跳到订单、履约、库存、退款
- 从用户跳到消费内容和购买商品
- 从异常卡跳到支付/履约/工单处理页

建议统一一个下钻协议：

- `destination`
- `sectionId`
- `entityType`
- `entityId`
- `site`
- `timeRange`
- `sourcePanel`

这样点击任何图表项，都能带着上下文去到正确页面，而不是每张卡自己写一套跳转逻辑。

## 9. 实施顺序

## Phase 1：先完成信息架构重构

目标：

- 把 `数据分析` 重命名/升级为 `经营分析`
- 新建 5 个一级分析视图
- 不急着一次做满数据，先把页面壳搭起来

产出：

- 新侧栏或新 tab 壳层
- 新模块挂载点
- 新 bundle 命名空间

## Phase 2：优先落“商品经营一期”

这是最值得先做的一期。

一期先做：

- 商品总盘
- 商品榜单
- 单品漏斗
- 库存与履约健康
- 单品详情入口

这一步完成后，后台就会第一次拥有“商品经营分析”能力。

## Phase 3：补“内容 -> 商品 -> 用户”联动

重点做：

- 内容带商品购买归因
- 商品购买用户分层
- 用户首次消费去向

这是把全站真正串起来的阶段。

## Phase 4：补“运营保障驾驶舱”

把支付、履约、验证、工单、风控统一收进一个运营保障面板。

## Phase 5：再决定 AI 助理怎么嵌入

AI 助理建议继续保持“手动触发”，不重新回到日常自动流程。

更适合的位置是：

- 在每个板块提供手动 AI 总结
- 在异常卡旁提供解释和建议
- 在商品详情里给“建议动作”

而不是单独再回到“大而全的自动分析入口”。

## 10. 最终建议

如果只给一个最终建议，就是下面这三句：

1. `商城` 继续做操作后台，不要硬塞经营分析。
2. `数据分析` 升级成 `经营分析中心`。
3. `商品经营` 提升为一级重点板块，与 `用户`、`提示词`、`运营保障` 并列。

这比继续在当前 `积分与交易` tab 里追加几张商城图，要更清晰，也更适合长期维护。

## 11. 当前落地状态（2026-04-06）

如果按当前代码落地情况看，这份方案已经不再停留在“规划”阶段：

- `商品经营一期` 已经基本做成
- `商品经营二期` 已经做到预警、复查、回写和经营建议层
- `用户侧闭环` 已经基本打通
- `内容侧深链` 已经推进到内容带货详情、样本、支付/售后问题摘要和回写
- `总览` 已经开始承接商品经营判断

当前更适合把它理解成：

- `商品经营` 已经是样板间
- `整站经营分析重构` 已经进入后段

更细的收官盘点见：

- [admin-studio-business-analytics-closeout-audit.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-business-analytics-closeout-audit.md)

## 12. 下一步可直接开工的任务

建议接下来直接按下面顺序开工：

1. 改导航：
把 `数据分析` 改造成 `经营分析` 新壳层，并确定 5 个一级视图。

2. 先做 `商品经营一期` 页面骨架：

- 商品总盘
- 商品榜单
- 单品漏斗
- 库存与履约健康
- 单品详情占位

3. 同时定义商品级 bundle / RPC：

- `product_summary_bundle`
- `product_rank_bundle`
- `product_funnel_bundle`
- `product_health_bundle`
- `product_detail_bundle`

4. 最后再补商品行为埋点和归因。

如果要继续往下推进，下一步最适合做的是：

- 直接产出 `商品经营一期任务清单`
- 或者直接在后台里先搭出 `经营分析` 的新导航骨架

商品经营一期任务清单现已落在：

- [admin-studio-product-analytics-phase1-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-product-analytics-phase1-taskboard.md)

如果现在继续往下推进，不建议再回到零散链路补丁，而应该优先看收官盘点里的两件事：

1. `运营保障驾驶舱` 收官
2. `结构层最终产品决策`
