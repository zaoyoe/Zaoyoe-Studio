# Admin Studio Homepage P0 工程任务单

## 目标

把 `主页内容` 从“半成品字段表单”收口成可上线的最小编排底座，完成以下 5 件事：

1. 统一 `admin / runtime / prefetch / visibility` 的 homepage contract。
2. 清理假配置，让 `display_order`、`ticker` 开关、`shop/guestbook` 数量与排序真正生效。
3. 补齐 `draft / publish / rollback` 最小闭环。
4. 给运营补上 `站点 + 语言 + 设备` 预览和健康检查。
5. 用测试和迁移脚本把 P0 交付边界固定下来。

## 范围

涉及文件：

- `admin-homepage.js`
- `admin-studio.html`
- `admin-studio.js`
- `css/admin-studio-page.css`
- `js/framer_home.js`
- `js/prefetch-home.js`
- `js/section-visibility.js`
- `server/api-handlers/admin/homepage/config.js`
- `server/api-handlers/admin/homepage/_shared.js`
- `tests/admin-homepage-config-handler.test.js`
- `tests/homepage-dual-site-contract.test.js`
- `tests/frontend-supabase-runtime-config.test.js`

新增文件：

- `docs/admin-studio-homepage-p0-taskboard.md`
- `js/homepage-contract.js`
- `supabase/migrations/20260410_homepage_drafts_and_releases.sql`

## 任务拆分

### P0-1 Contract 统一

目标：
让 homepage 只存在一份 section contract，不再出现字段名、显隐别名、排序语义各自不同步。

任务：

- 新增前台共享 contract helper，统一 section/order/content 归一化。
- `framer_home.js`、`prefetch-home.js`、`section-visibility.js` 改用同一套 section 名称。
- 兼容旧别名 `gallery -> prompts`，但新逻辑统一收敛到 `prompts`。
- `verify` 字段统一为 `section_title / section_subtitle / screenshot_path`。

验收：

- 首页直开和子页预取回首页，看到的 Hero / Verify / Ticker 数据结构一致。
- `SectionVisibility.isVisible('prompts')` 和旧调用 `isVisible('gallery')` 都能工作。

### P0-2 假配置收口

目标：
把后台里现有控件变成真配置，或在行为上明确降级。

任务：

- `display_order` 控制首页 section 渲染顺序。
- `ticker` 纳入 section visibility 体系。
- `ticker.enable_prompts / enable_products` 真正影响上下两行内容源。
- `shop.max_items / sort / category` 真正作用于首页商品聚合。
- `guestbook.max_items` 真正作用于首页留言聚合。
- 统一默认 section 顺序：`hero -> prompts -> shop -> verify -> guestbook -> ticker`。

验收：

- 调整排序后，首页 DOM 和用户看到的顺序一致。
- 关闭 ticker 或其中一个内容源后，首页与导航显隐正确。

### P0-3 Draft / Publish / Rollback

目标：
让 Homepage 编辑不再直接改线上，而是先存站点草稿，再发布和回滚。

任务：

- admin handler 增加 `include_draft` 查询和 `save_draft / publish / rollback` 动作。
- 新增 `homepage_site_drafts`、`homepage_site_releases` 存储结构。
- Admin Studio 顶部增加当前站点的草稿状态、最近发布时间、最近版本入口。
- Section 保存改为“保存草稿”。
- 增加“发布当前站点”和“回滚上一版”动作。

验收：

- 保存草稿不会直接改线上 published rows。
- 发布后线上 rows 更新，并生成 release snapshot。
- 回滚会把最近 release 快照恢复到 published rows，并生成新的 rollback release。

### P0-4 预览矩阵

目标：
让运营在后台即可快速检查 `CN / INTL + ZH / EN + Desktop / Mobile` 基本效果。

任务：

- Homepage 模块增加 preview shell。
- 支持切换站点、语言、设备宽度。
- 预览内容使用当前编辑中的 draft contract，不依赖线上已发布数据。
- 至少展示 Hero / Prompts / Shop / Verify / Guestbook / Ticker 的摘要预览。

验收：

- 不保存到线上时，也能在后台看到 draft 预览变化。
- 切换语言和设备后，主要文案与 section 显隐正确变化。

### P0-5 健康检查与校验

目标：
在发布前直接发现高概率运营事故。

任务：

- server 侧增加 section schema sanitize + validate。
- admin 侧展示 errors / warnings 健康卡片。
- 覆盖空标题、手动模式无数据、截图过大 base64、无效分类、ticker 无内容源等问题。

验收：

- 非法 payload 不会直接写入 published rows。
- 发布前能看到当前站点健康状态和问题列表。

### P0-6 旧语义清理

目标：
在不打断现有站点运行的前提下，先完成最关键的收口。

任务：

- Homepage 相关前台逻辑统一改用 `prompts`，保留 `gallery` 兼容层。
- Footer 不再挂在 Homepage 主编辑流里作为核心 P0 能力；仅保留现有可见性兼容，不继续扩散新逻辑。
- Verify 预览字段统一，不再让 prefetch 读旧键名。

验收：

- 新代码不再新增 `gallery` 作为 homepage 主语义。
- Footer 不阻塞 Homepage P0 发布链路。

## SQL 边界

P0 需要新增数据库对象，但本轮代码不直接执行 SQL：

- `homepage_site_drafts`
- `homepage_site_releases`
- 相关索引与更新时间触发器

迁移会以 SQL 文件形式落库，统一由人工执行。

## 交付物

- 工程任务单文档
- 前后台 contract 收口代码
- Draft / Publish / Rollback handler 与 UI
- 预览矩阵与健康检查 UI
- 迁移 SQL
- 覆盖 P0 的测试与回归清单
