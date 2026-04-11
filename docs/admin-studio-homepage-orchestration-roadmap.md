# Admin Studio Homepage 编排台路线图

这份文档用于把 `Admin Studio` 中“主页内容”模块，从当前的半成品工程，整理成一条可以直接排期执行的产品路线图。

这条路线图的重点不是继续堆表单，而是把它升级成一个真正可运营、可发布、可观测的 `Homepage Orchestration Center`。

配套文档：

- [admin-studio-rebuild-roadmap.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-rebuild-roadmap.md)
- [admin-studio-phase2-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase2-taskboard.md)
- [admin-studio-issue-backlog.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-issue-backlog.md)
- [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)
- [framer_home.js](/Volumes/chao/AI/xianyu_profit_calculator/js/framer_home.js)
- [prefetch-home.js](/Volumes/chao/AI/xianyu_profit_calculator/js/prefetch-home.js)
- [section-visibility.js](/Volumes/chao/AI/xianyu_profit_calculator/js/section-visibility.js)
- [server/api-handlers/admin/homepage/config.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/homepage/config.js)

## 1. 产品定位

`Homepage` 模块后续不建议朝“自由拖拽页面装修器”走，而应该明确定位为：

- `双站点首页编排台`
- `多模块增长运营台`
- `结构化发布与复盘中心`

原因：

- 当前网站不是单一内容站，而是 `Prompt + Shop + Verify + Guestbook + Ticker + 双站点` 组合产品
- 首页的核心价值，不在像素级装修，而在跨模块编排、发布管控、数据回流和活动承接
- 继续做重型页面搭建器，投入大、维护重，还会放大当前已有的数据契约不一致问题

因此，后续设计原则应当是：

1. 结构化编排优先于自由拖拽
2. 运营可信度优先于表单字段数量
3. 同一份配置要同时驱动后台编辑、前台渲染、预取缓存和分析归因
4. `all` 只做聚合查看，不承担任何写操作
5. `cn / intl`、`desktop / mobile`、`zh / en` 都是首页运营的一等维度

## 2. 当前缺口

从当前实现看，`Homepage` 已经有了基本底座，但还停在“链路存在、能力未收口”的阶段。

### 2.1 可信度缺口

- 后台存在一批“可配但不一定真实生效”的控件
- 前台主运行时、预取运行时、显隐运行时不是完全同一份 contract
- `display_order`、`ticker` 显隐、部分 `enable_auto` 语义还没有形成真行为

### 2.2 发布能力缺口

- 当前更像直接改线上
- 没有 `draft / publish / rollback`
- 没有按站点、按设备、按语言的发布前预览
- 没有定时生效和活动窗口

### 2.3 运营闭环缺口

- Gallery 已有“首页候选 / 去首页 / 加首页”雏形，但没有形成“候选池 -> 上线 -> 复盘”闭环
- Shop 和 Guestbook 首页位还不具备完整的人工精选能力
- Verify 仍更像静态文案卡片，而不是独立的转化入口
- 首页各模块的点击、跳转、转化、互动效果没有回流到编排台

### 2.4 模型对齐缺口

- Hero 运行时模型已经包含 `cta / custom_image / entries`，后台 UI 还没有对应编辑能力
- Verify 的图片仍以 base64 直接进入配置，不适合长期运营
- Shop 分类、Prompt 标签、Guestbook 精选、Ticker 内容源缺少结构化运营模型

### 2.5 旧语义与遗留工程缺口

- 还残留 `prompts -> gallery`、`footer` 仍在 homepage 域、旧缓存命名等遗留语义
- 文档里已经明确把这些问题列为待收口项，但还没有升级成新的产品路线图

## 3. 北极星目标

当这条路线图完成后，`Homepage` 模块应达到以下状态：

1. 运营可以在一个地方完成 `选内容 -> 预览 -> 发布 -> 观察效果 -> 再迭代`
2. 首页配置不再只是文案表单，而是模块化编排结果
3. 所有可配项都是真配置，不再制造“可配但不生效”的错觉
4. 每个首页位都能回看到自己的点击、转化、互动和业务结果
5. 首页改动具备版本、回滚、定时和健康检查能力

## 4. 路线图总览

| 阶段 | 核心目标 | 关键词 | 完成后解决的问题 |
|---|---|---|---|
| `P0` | 把模块做成“可信的运营底座” | 契约统一、假配置收口、预览、发布安全 | 先解决“能不能放心用” |
| `P1` | 把模块做成“真正的首页增长编排台” | 精选编排、数据回流、定时、模板 | 再解决“能不能高效运营” |
| `P2` | 把模块做成“可实验、可自动化的运营系统” | 轻量实验、推荐辅助、自动巡检 | 最后解决“能不能持续放大效果” |

## 5. P0：可信运营底座

## `P0-H1` Homepage Contract 统一与假配置收口

目标：

- 把后台编辑、前台渲染、预取缓存、显隐控制统一到同一份首页 contract
- 把当前“看起来能配、实际上不一定生效”的控件全部收口

涉及文件：

- [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)
- [framer_home.js](/Volumes/chao/AI/xianyu_profit_calculator/js/framer_home.js)
- [prefetch-home.js](/Volumes/chao/AI/xianyu_profit_calculator/js/prefetch-home.js)
- [section-visibility.js](/Volumes/chao/AI/xianyu_profit_calculator/js/section-visibility.js)
- [server/api-handlers/admin/homepage/config.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/homepage/config.js)

要做的事：

1. 给 `hero / prompts / shop / verify / guestbook / ticker` 定义明确 schema
2. 统一字段命名，避免主运行时和预取运行时各用一套字段
3. 把 `display_order` 做成真能力，或者下线这个控件
4. 把 `ticker` 的显隐、内容源、速度全部做成真行为
5. 梳理 `enable_auto` 语义：
   - 真正有自动聚合的保留
   - 没有自动聚合链路的不要继续显示
6. 所有消费者统一通过同一份站点化数据模型读配置

验收标准：

- 后台保存后的内容，在首页直开、子页面返回首页、预取缓存命中三种路径上表现一致
- 不再存在“保存了但看不到效果”的字段
- 首页配置从“前端能读到”升级为“多入口一致生效”

## `P0-H2` CN / INTL + Desktop / Mobile + Language 预览矩阵

目标：

- 让运营在保存或发布前，就能看到不同站点、设备和语言下的首页效果

涉及文件：

- [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)
- [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)
- 如有需要，可新增 preview shell 或 lightweight render endpoint

要做的事：

1. 增加站点切换预览：
   - `CN`
   - `INTL`
2. 增加设备视图：
   - `Desktop`
   - `Mobile`
3. 增加语言视图：
   - `ZH`
   - `EN`
4. 预览支持未发布草稿，不要求先落线上
5. 支持跳转校验：
   - Hero 入口
   - Prompt 卡片
   - Shop 卡片
   - Verify CTA
   - Guestbook 按钮

验收标准：

- 运营不用反复切前台页面肉眼验证
- 首页主要模块可以在发布前完成多维预览
- 双站和多语言错位问题能在后台提前发现

## `P0-H3` Draft / Publish / Rollback 最小发布闭环

目标：

- 把“直接改线上”升级为最小可控发布流

涉及文件：

- Homepage 配置存储模型
- Homepage Admin Handler
- Admin Studio Homepage UI

要做的事：

1. 区分 `draft` 与 `published`
2. 支持手动发布当前草稿
3. 记录发布时间、发布人、发布说明
4. 支持回滚到上一版已发布配置
5. 发布时自动刷新站点级缓存

验收标准：

- 首页配置不再默认直接覆盖线上状态
- 运营可以知道“当前线上版本是什么、草稿版本是什么”
- 出现误操作时可一键回退

## `P0-H4` 内容健康检查与配置校验

目标：

- 把容易在线上出错的问题，在后台提前暴露

涉及文件：

- Homepage Admin UI
- Homepage Handler
- Homepage runtime health helpers

要做的事：

1. 增加 schema 级校验：
   - 必填字段
   - 类型校验
   - 数量范围
2. 增加首页健康检查：
   - 翻译缺失
   - 图片失效
   - 精选 Prompt 不存在
   - Shop 精选商品已下架
   - Verify 截图无效
   - Guestbook 精选内容缺失
   - 导航 / footer / section 显隐不一致
3. 发布前显示风险等级：
   - 阻塞发布
   - 警告但可发布
4. 为每条问题提供快速定位入口

验收标准：

- 首页线上空白、死图、断链等问题能被提前发现
- 后台对运营给出明确纠错路径
- handler 不再接受明显漂移的无效 content

## `P0-H5` 旧语义清理与测试矩阵补齐

目标：

- 清理遗留命名和旧概念，避免新旧逻辑长期并存

涉及文件：

- [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)
- [section-visibility.js](/Volumes/chao/AI/xianyu_profit_calculator/js/section-visibility.js)
- Homepage tests

要做的事：

1. 清理 `prompts -> gallery` 的旧语义残留
2. 把 `footer` 从 homepage 域中移出，纳入独立站点布局域
3. 清理旧缓存命名与兼容逻辑
4. 补 Homepage smoke matrix：
   - `cn / intl`
   - `zh / en`
   - `desktop / mobile`
   - `prefetch / cold start`
   - `draft / publish / rollback`

验收标准：

- 首页域不再背着历史命名包袱继续扩展
- 测试矩阵能覆盖最常见的线上回归路径

## 6. P1：首页增长编排台

## `P1-H1` Hero 结构化升级

目标：

- 把 Hero 从“只改标题副标题”升级为“可运营的首屏入口区”

涉及文件：

- Homepage schema
- Homepage Admin UI
- [framer_home.js](/Volumes/chao/AI/xianyu_profit_calculator/js/framer_home.js)

要做的事：

1. 开放 Hero CTA 配置：
   - 主按钮文案与链接
   - 次按钮文案与链接
2. 开放 Hero 入口卡片配置：
   - 是否展示
   - 图标
   - 文案
   - 目标模块 / 链接
3. 支持自定义背景图或视觉资产
4. 支持站点和语言差异配置

验收标准：

- Hero 不再只是静态 copy 配置
- 首页首屏可承接活动入口、业务入口和重点导流

## `P1-H2` Shop 首页位人工精选与动态分类收口

目标：

- 给首页商城位补齐真正可运营的手动编排能力

涉及文件：

- Homepage Admin UI
- Shop Admin / category data
- Homepage runtime

要做的事：

1. 增加 `自动推荐 + 人工置顶` 混合模式
2. 允许手动精选商品并调整顺序
3. 分类下拉改为读取真实 `shop_categories`
4. 首页位增加站点、库存、上架状态感知
5. 对活动商品、新品、缺货商品给出运营提示

验收标准：

- 商城首页位可以承接新品、活动、库存波动
- 运营不再只能依赖随机或弱排序逻辑

## `P1-H3` Guestbook 首页位运营层

目标：

- 把留言板首页位从“最新内容展示”升级成“可控的社区氛围位”

涉及文件：

- Homepage schema
- Homepage Admin UI
- Comments / Guestbook admin context
- Homepage runtime

要做的事：

1. 增加 Guestbook 首页精选能力
2. 支持置顶卡片、运营推荐卡片和兜底内容
3. 当留言内容被删除、折叠或不适合展示时，支持自动替补
4. 允许运营配置显示条数和混排逻辑
5. 和评论治理后台打通“从治理结果直接加入首页精选”

验收标准：

- 留言板首页位能主动传达社区氛围，而不是只被动展示最新内容
- 社区内容异常不会直接让首页位塌陷

## `P1-H4` Verify 模块业务化升级

目标：

- 把 Verify 从静态说明块升级成独立的转化入口

涉及文件：

- Homepage schema
- Homepage Admin UI
- Verify runtime

要做的事：

1. 增加 Verify 业务字段：
   - 主卖点
   - 特性标签
   - CTA 文案
   - 风险提示
   - 支持模型说明
2. 截图改为走资产存储，不再长期依赖 base64
3. 支持站点差异 copy 和图像资产
4. 为 Verify 首页位埋点：
   - 曝光
   - 点击
   - 到达 verify 页面
   - 启动验证
   - 验证成功

验收标准：

- Verify 首页位能被作为真实转化入口运营
- 内容与业务结果可以建立归因关系

## `P1-H5` Ticker 真正编排化

目标：

- 把 Ticker 从“速度配置块”升级成可编排的信息流模块

涉及文件：

- Homepage schema
- Homepage Admin UI
- Homepage runtime

要做的事：

1. 把上行 / 下行内容源明确结构化：
   - Prompt tags
   - Product categories
   - 活动关键词
   - 自定义条目
2. 让 `enable_prompts / enable_products` 真正影响渲染结果
3. 支持按站点配置不同 ticker 内容
4. 支持活动期临时替换 ticker 内容

验收标准：

- Ticker 不再只是视觉装饰，而是可控的信息导流层
- 后台控件与前台行为一一对应

## `P1-H6` Homepage Analytics 回流

目标：

- 把首页位效果回流到编排台，让“精选”不再只靠感觉

涉及文件：

- Homepage Admin UI
- Analytics handlers
- Homepage event schema

要做的事：

1. 给每个首页模块补核心指标：
   - 曝光
   - 点击
   - 跳转
   - 转化
   - 互动
2. 支持查看模块级、卡片级、条目级表现
3. 首页编排台中展示最近 7 天 / 30 天核心趋势
4. 能从 Homepage 跳到更深的 Analytics drilldown

验收标准：

- 每个首页位都能看到“配了之后表现如何”
- 运营可以基于数据迭代，而不是只能凭经验替换

## `P1-H7` 候选池 -> 上首页 -> 复盘 闭环

目标：

- 把 Gallery 中的“首页候选”状态，升级成真正的 Homepage 工作流

涉及文件：

- [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js)
- Homepage Admin UI
- Analytics linkage

要做的事：

1. 让候选 Prompt 支持记录：
   - 候选原因
   - 推荐人
   - 最近表现
   - 当前站点适配情况
2. 在 Homepage 中显示候选池和已上首页条目
3. 支持“从候选池一键加入首页精选”
4. 支持对已上首页条目查看上线后效果变化

验收标准：

- Prompt 上首页不再只是一次性动作
- 形成“候选、上线、复盘、替换”的完整闭环

## `P1-H8` 定时发布与模板体系

目标：

- 把首页运营从手工蹲点，升级为计划性执行

涉及文件：

- Homepage release model
- Homepage Admin UI

要做的事：

1. 支持配置开始时间 / 结束时间
2. 支持节日、活动、专题首页模板
3. 支持复制模板到 `cn / intl`
4. 支持从历史版本生成新模板
5. 增加常用模板：
   - 新品上新模板
   - 活动促销模板
   - 国际站冷启动模板
   - 社区活跃模板

验收标准：

- 首页运营不再完全依赖人工在固定时间切换
- 模板可以降低重复运营成本

## 7. P2：实验化与自动化运营系统

## `P2-H1` Homepage 轻量实验能力

目标：

- 在不引入重型实验平台的前提下，支持首页关键位做小步试验

涉及文件：

- Homepage release model
- Analytics
- Homepage runtime

要做的事：

1. 支持首页核心位轻量双版本：
   - 标题
   - 副标题
   - CTA
   - 精选清单
2. 支持按站点分别实验
3. 支持查看实验结果与胜出版本
4. 胜出版本可一键转正式发布

验收标准：

- 首页优化可以通过小流量试验推进
- 不需要一上来建设复杂 AB 平台也能跑起来

## `P2-H2` 推荐辅助与运营建议

目标：

- 给运营提供“下一步该换什么”的决策辅助

涉及文件：

- Homepage Admin UI
- Analytics recommendation helpers
- Candidate pool / product pool / guestbook pool

要做的事：

1. 基于近 7 天表现给出推荐替换项
2. 为 Prompt、Shop、Guestbook 分别生成候选建议
3. 增加简单运营信号：
   - CTR 下降
   - 点击高但转化低
   - 精选位连续疲劳
   - 留言板互动下滑
4. 支持人工确认后再应用建议，不做黑盒自动改版

验收标准：

- 编排台能辅助运营做更快决策
- 推荐逻辑透明、可解释、可人工确认

## `P2-H3` 自动巡检与运营告警

目标：

- 让首页问题从“靠人发现”升级为“系统主动提醒”

涉及文件：

- Homepage health checks
- Admin alerts / ops alerts

要做的事：

1. 定时检查首页健康状态
2. 对以下问题发送告警：
   - 关键模块被误隐藏
   - 发布版本无效
   - 核心图片失效
   - 精选条目下架
   - 翻译缺失
   - CTR / 转化异常波动
3. 支持生成首页运营日报 / 周报

验收标准：

- 首页问题可以在用户投诉前被发现
- 运营和产品可以被动接收关键异常，而不是手动巡站

## `P2-H4` 主题包与场景化编排

目标：

- 把首页从“模块配置集合”提升到“场景化运营资产”

涉及文件：

- Homepage template system
- Homepage release model

要做的事：

1. 定义场景包：
   - 节日活动
   - 新品发布
   - 国际站专题
   - 社区活动
2. 一个主题包同时包含：
   - Hero
   - Prompt 精选
   - Shop 精选
   - Verify 文案
   - Guestbook 精选
   - Ticker 内容
3. 支持一键套用和局部覆盖

验收标准：

- 首页运营可以围绕“专题”和“活动”而不是零散字段展开
- 多模块联动不再需要人工逐块调整

## 8. 推荐排期顺序

建议按下面顺序推进：

1. `P0-H1` Homepage Contract 统一与假配置收口
2. `P0-H2` 预览矩阵
3. `P0-H3` Draft / Publish / Rollback
4. `P0-H4` 健康检查与校验
5. `P0-H5` 旧语义清理与测试矩阵
6. `P1-H1` Hero 升级
7. `P1-H2` Shop 人工精选
8. `P1-H3` Guestbook 运营层
9. `P1-H4` Verify 业务化
10. `P1-H5` Ticker 编排化
11. `P1-H6` Analytics 回流
12. `P1-H7` 候选池闭环
13. `P1-H8` 定时发布与模板
14. `P2-H1` 轻量实验
15. `P2-H2` 推荐辅助
16. `P2-H3` 自动巡检与告警
17. `P2-H4` 场景化主题包

## 9. 不建议现在做的事

为了避免把路线图带偏，当前阶段不建议优先投入：

1. 通用型自由拖拽页面搭建器
2. 为首页单独造一套重型 CMS
3. 没有发布闭环前就上复杂个性化推荐
4. 没有指标回流前就上复杂 AI 自动改版

原因：

- 这些方向开发成本高、维护重
- 会先放大当前 contract 不统一和发布能力不足的问题
- 对当前网站规模而言，结构化编排的投入产出比更高

## 10. 阶段完成标准

### P0 完成标准

- `Homepage` 模块成为可信的运营底座
- 所有保留字段都是真配置
- 运营能预览、发布、回滚并看到健康状态

### P1 完成标准

- `Homepage` 模块成为真正的首页增长编排台
- Prompt、Shop、Verify、Guestbook、Ticker 都能被结构化运营
- 编排动作与效果数据形成闭环

### P2 完成标准

- `Homepage` 模块具备轻量实验、推荐辅助和自动巡检能力
- 首页优化从“手工经验驱动”升级为“系统辅助驱动”
