# Admin Studio Homepage P1 工程任务单

更新时间：`2026-04-11`

## 范围

本任务单对应 Homepage 路线图中的 `P1：首页增长编排台`。

## 任务拆分

### P1-H1 Hero 结构化升级

状态：`已完成`

- 后台新增 Hero 主 CTA / 次 CTA / 自定义背景图 / 入口卡片编辑器
- 前台 Hero 支持 CTA、入口卡片和自定义背景视觉
- Hero 入口点击已纳入首页事件埋点

### P1-H2 Shop 首页位人工精选与动态分类收口

状态：`已完成`

- 后台商城分类改为读取真实 `shop_categories`
- 支持首页人工精选商品、顺序调整和角标配置
- 前台商城位采用 `人工置顶 + 自动补齐` 混合模式

### P1-H3 Guestbook 首页位运营层

状态：`已完成`

- 后台支持首页精选留言、推荐理由和兜底卡片
- 前台留言位支持精选优先、自动补位、兜底卡片混排
- 首页留言位点击已纳入埋点

### P1-H4 Verify 模块业务化升级

状态：`已完成`

- 后台支持主卖点、支持模型、CTA、风险提示
- 前台 Verify 位渲染业务字段并接入首页来源归因
- Verify 页面提交/成功/失败事件自动带 `source`

### P1-H5 Ticker 真正编排化

状态：`已完成`

- 后台支持 Prompt tags / 商品分类 / 活动关键词 / 自定义条目
- 前台 ticker 支持结构化条目和点击跳转
- 首页 ticker 点击已纳入埋点

### P1-H6 Homepage Analytics 回流

状态：`已完成`

- 新增 Homepage context handler，回传模块级表现、候选池和模板/定时摘要
- Homepage 编排台展示最近 7 天模块级指标
- Gallery 候选 Prompt 和首页位效果链路打通

### P1-H7 候选池 -> 上首页 -> 复盘 闭环

状态：`已完成`

- Homepage 后台展示 Prompt 候选池、商城候选池、留言候选池
- 支持一键加入首页精选
- 首页位和候选池共享同一份上下文数据

### P1-H8 定时发布与模板体系

状态：`已完成`

- 新增模板保存、套用
- 新增定时发布、取消定时
- 公共 `fn_get_homepage_config` 支持活动期 schedule overlay

## 配套迁移

- `supabase/migrations/20260411_homepage_p1_schedule_templates_and_runtime_rpc.sql`

## 备注

- Verify 截图目前仍兼容 URL / 现有图片链路；如需进一步做成统一资产管理，可在 `P2` 中继续收口成专门素材流。
