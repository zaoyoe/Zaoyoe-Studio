# Admin Studio 首页模块 P2 工程任务单

更新时间：2026-04-11

## 目标

让 `Homepage` 模块从 “结构化编排台” 升级为 “带实验、推荐、巡检和主题包的运营系统”，并继续复用现有：

- 首页 contract / draft / publish / rollback
- Homepage analytics 回流
- 模板与定时发布
- Prompt / Shop / Guestbook 候选池

本轮默认原则：

- 不引入重型 AB 平台
- 不新增独立 CMS
- 尽量复用现有 JSON contract 与发布链路
- 优先做可落地、可解释、可人工确认的能力

## P2-H1 轻量实验能力

状态：已完成

任务拆解：

1. 在 homepage contract 中新增实验字段归一化
2. 支持按 section + field 保存轻量实验配置
3. 支持首页运行时按站点做 control / variant 分流
4. 对实验曝光与点击补充埋点
5. 在 Admin Studio 展示实验结果、CTR 和胜出版本
6. 支持一键将胜出版本转为当前草稿正式内容

本次落地范围：

- `Hero.title`
- `Hero.subtitle`
- `Verify.cta_text`
- `Prompts.featured_items`
- `Shop.custom_items`
- `Guestbook.featured_items`

## P2-H2 推荐辅助与运营建议

状态：已完成

任务拆解：

1. 基于近 7 天首页表现生成运营信号
2. 为 Prompt / Shop / Guestbook 生成可解释推荐建议
3. 推荐建议保留替换原因和目标条目
4. 支持人工点击后应用到当前草稿

本次落地范围：

- CTR 下滑信号
- Verify 点击高但转化低信号
- Prompt 精选替换建议
- Shop 精选补强建议
- Guestbook 精选替换建议

## P2-H3 自动巡检与运营告警

状态：已完成

任务拆解：

1. 在首页上下文接口中生成巡检告警
2. 汇总健康检查错误 / 警告为可读告警卡
3. 增加关键模块误隐藏、发布不完整、实验胜出提醒
4. 生成首页日报 / 周报摘要
5. 支持后台一键复制日报 / 周报文本

## P2-H4 主题包与场景化编排

状态：已完成

任务拆解：

1. 定义内置主题包
2. 支持把模板类型扩展为主题包
3. 支持按模块局部覆盖套用
4. 主题包覆盖 Hero / Prompt / Shop / Verify / Guestbook / Ticker

本次内置主题包：

- 节日活动
- 新品发布
- 国际站专题
- 社区活动

## 实施文件

- `server/api-handlers/admin/homepage/context.js`
- `server/api-handlers/admin/homepage/_shared.js`
- `js/homepage-contract.js`
- `admin-homepage.js`
- `js/framer_home.js`
- `js/prefetch-home.js`
- `css/admin-studio-page.css`
- `admin-studio.html`
- `index.html`
- `prompts.html`
- `shop.html`
- `verify.html`
- `guestbook.html`
- `tests/admin-homepage-context-handler.test.js`
- `tests/frontend-supabase-runtime-config.test.js`

## 数据与发布策略

本轮默认不新增首页 P2 专用数据表，直接复用：

- `homepage_site_drafts`
- `homepage_site_releases`
- `homepage_site_templates`
- `homepage_site_schedules`
- `homepage_config`
- `user_events`

P2 配置以 homepage section JSON 字段扩展方式保存，继续走现有草稿 / 发布 / 回滚闭环。

## 完成标准

- Admin Studio 可创建并查看首页轻量实验
- 前台首页会对实验位进行轻量分流并回传埋点
- 后台可看到推荐建议、巡检告警、日报周报
- 主题包可一键套用并支持模块级局部覆盖
- 不需要新增 SQL 才能完成本轮核心交付

## 测试与缺陷跟踪

- 测试清单：[docs/admin-studio-homepage-p2-test-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-homepage-p2-test-checklist.md)
- 缺陷登记模板：[docs/admin-studio-homepage-p2-defect-template.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-homepage-p2-defect-template.md)
