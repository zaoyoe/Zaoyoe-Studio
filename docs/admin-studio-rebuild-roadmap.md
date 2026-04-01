# Admin Studio 重构路线图

这份文档用于把 `Admin Studio` 的现状问题、目标架构和三期改造计划收成一份可以直接排期执行的路线图。

配套文档：

- [admin-studio-phase1-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase1-taskboard.md)
- [admin-studio-phase2-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase2-taskboard.md)
- [admin-studio-phase3-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase3-taskboard.md)
- [admin-studio-issue-backlog.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-issue-backlog.md)
- [admin-studio-safe-rebuild-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-safe-rebuild-plan.md)

## 1. 背景

当前后台不是单一架构，而是两代实现叠在一起：

- 新模块已经逐步走服务端 handler、统一权限和审计，例如 [api/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/admin.js)、[api/_lib/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin.js)、[server/api-handlers/admin/payments/actions.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/payments/actions.js)
- 老模块仍然大量在浏览器里直接读写 Supabase，例如 [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)、[admin-comments.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-comments.js)、[admin-discounts.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-discounts.js)、[admin-points.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-points.js)

项目又已经进入 `cn / intl` 双站点阶段，因此旧模块里的“单站默认值”和“前端直写数据库”问题被进一步放大。

## 2. 现状问题

### 2.1 底座不统一

- 新模块通过 `/api/admin/*` 收口
- 老模块绕过服务端直接 `.from()` / `.rpc()` 写库
- 权限、错误模型、审计字段、站点参数没有统一约束

### 2.2 双站点语义不一致

- 多个模块仍然存在 `all -> cn` 的隐式写入
- 管理端的“查看全站”和“按站点编辑”没有被明确分开
- 一些模块前台已经分站，后台仍按单站思维管理

### 2.3 模块闭环不完整

- 首页内容和首页显隐来自两套配置源
- 留言板后台只能管主贴，回复和互动治理不完整
- 商城退款仍依赖旧 RPC，财务链路没有完全并入支付中心
- Prompt 内容是全局双语资产，但评论、点赞、realtime 的站点隔离没有收口

### 2.4 共享配置过重

- [admin-config.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-config.js) 承担了过多业务领域
- 存在一批“后台可配但前台不消费”的假配置
- 配置中心和业务后台混在一起，导致 blast radius 过大

## 3. 目标架构

### 3.1 统一的 Admin 写路径

所有后台写操作逐步统一到 `/api/admin/*`：

- 前端不直接承担敏感写入
- handler 统一执行 `requireAdmin`
- 所有 mutation 统一记录 audit
- `site` 只允许显式 `cn` 或 `intl`
- `all` 只用于查看，不用于写入

### 3.2 统一的站点语义

- `all`：聚合查看态
- `cn`：国内站编辑态
- `intl`：国际站编辑态

任何保存、删除、生成、退款、补偿类动作都必须在明确站点下执行。

### 3.3 内容域与互动域分开

- `homepage`：按站点维护内容和显隐
- `prompts`：保持全局双语内容资产
- `prompt_comments / comment_likes / prompt_unlocks`：按站点隔离
- `comments`：统一承担留言板和 prompt 评论治理

### 3.4 财务动作单一责任中心

- `shop` 负责商品、库存、订单运营
- `payments` 负责退款、补偿、异常回退等资产动作
- 资金类动作必须可审计、可幂等、可按站点回放

## 4. 模块决策

### 4.1 Homepage

现状：

- 内容配置仍是全局 `homepage_config`
- 显隐控制又单独走 `section_visibility`
- 还残留 `gallery / footer / global` 等旧语义

决策：

- `homepage_config` 升级为 `(site, section)` 模型
- `is_visible` 回到首页内容表，不再平行维护
- 首页域只保留 `hero / prompts / shop / verify / guestbook / ticker`
- `footer` 移出 homepage 域

### 4.2 Shop / Payments

现状：

- 商城退款前端仍直连旧 RPC
- 旧函数来自单站时代，和双站积分模型不完全匹配
- 工单退款和商城退款还不是一条执行链路

决策：

- 商城退款入口可留在 `shop`
- 执行权统一收进 `payments` 服务端
- 共享一套 refund orchestration

### 4.3 Comments

现状：

- 后台只覆盖 `guestbook_messages` 和 `prompt_comments`
- `guestbook_comments`、`guestbook_likes` 没有真正纳入治理
- 回复筛选和统计存在失真

决策：

- `comments` 统一治理三类实体：
  - `guestbook_message`
  - `guestbook_comment`
  - `prompt_comment`
- 删除、屏蔽、统计、筛选统一服务端化

### 4.4 Prompts / Gallery

现状：

- `prompts` 内容表本身不是按站点设计，而是全局双语资产
- `prompt_unlocks` 已站点化
- `prompt_comments`、`comment_likes`、realtime 还没有完整按站点收口
- gallery 模块里的站点筛选语义不清

决策：

- 不给 `prompts` 主表硬加 `site`
- 先收口互动链路的站点隔离
- 后台补双语字段可见性
- gallery 的站点筛选只用于互动指标，不用于内容主表

## 5. 三期计划

## Phase 1：底座统一与站点写保护

目标：

- 封住 `all -> cn` 隐式写入
- 给新旧模块建立统一写规则

范围：

- [api/_lib/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin.js)
- [api/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/admin.js)
- [js/admin-site-filter.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-site-filter.js)
- [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js)
- [js/admin-studio-bootstrap.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-studio-bootstrap.js)
- 高风险老模块的写入口补丁

完成标准：

- `all` 视图下不能写
- mutation 统一透传 `site`
- audit 稳定记录 `site`

## Phase 2：双站首页与财务链路收口

目标：

- 首页内容、显隐、缓存按站点统一
- 商城退款迁到服务端支付链路

范围：

- Homepage：
  - [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)
  - [js/framer_home.js](/Volumes/chao/AI/xianyu_profit_calculator/js/framer_home.js)
  - [js/prefetch-home.js](/Volumes/chao/AI/xianyu_profit_calculator/js/prefetch-home.js)
  - [js/section-visibility.js](/Volumes/chao/AI/xianyu_profit_calculator/js/section-visibility.js)
  - `server/api-handlers/admin/homepage/*`
- Shop / Payments：
  - [js/admin-shop.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-shop.js)
  - [js/admin-payments.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-payments.js)
  - [server/api-handlers/admin/payments/actions.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/payments/actions.js)
  - `server/api-handlers/admin/payments/shop-refund.js`
  - `api/_lib/shop/refunds.js`

完成标准：

- `cn` 和 `intl` 首页独立编辑、独立缓存、独立生效
- 商城退款不再前端直连 RPC
- 退款按订单站点精确退账

## Phase 3：社区治理与 Prompt 互动闭环

目标：

- 补齐留言板回复和互动治理
- 让 prompt 互动数据真正站点隔离

范围：

- Comments：
  - [admin-comments.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-comments.js)
  - [guestbook.js](/Volumes/chao/AI/xianyu_profit_calculator/guestbook.js)
  - `server/api-handlers/admin/comments/*`
- Prompts / Gallery：
  - [prompts-poetry.js](/Volumes/chao/AI/xianyu_profit_calculator/prompts-poetry.js)
  - [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js)
  - [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)
  - [js/admin-site-filter.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-site-filter.js)
  - [supabase/trigger-auto-link-replies.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/trigger-auto-link-replies.sql)

完成标准：

- 后台能治理留言主贴、留言回复、prompt 评论
- 删除内容时不会留下互动脏数据
- `cn / intl` 的 prompt 评论、点赞、realtime 不串站

## 6. 执行顺序与并行关系

必须串行：

1. Phase 1

可并行：

- Phase 2 里的 `Homepage` 和 `Shop / Payments`
- Phase 3 里的 `Comments` 和 `Prompts / Gallery`

建议顺序：

1. Phase 1
2. Phase 2
3. Phase 3

## 7. 风险提示

### 7.1 公共 guard 误伤

Phase 1 最容易把纯读动作也拦住，因此要把写动作和查看动作明确分开。

### 7.2 首页切换当天空白

Homepage 必须先做“兼容读”，再做“新结构写入”，避免发布当天首页空白。

### 7.3 财务半成功

退款编排必须是幂等的，避免出现：

- 积分退了但订单没变
- 库存回了但审计没记
- 订单标记了但站点余额退错

### 7.4 Prompt 方向做偏

Prompts 这包最大的风险不是实现难，而是问题识别错误：

- 不应该优先给 `prompts` 主表拆 `site`
- 应该优先收口评论、点赞、realtime 和后台站点语义

## 8. 测试要求

每个 Phase 都至少补 4 类测试：

- 权限
- 站点过滤
- 成功路径
- 审计写入

现有测试风格可参考：

- [tests/admin-handler-permissions.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-handler-permissions.test.js)
- [tests/admin-payments-actions.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-payments-actions.test.js)
- [tests/admin-tickets-process.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-tickets-process.test.js)

## 9. 第二阶段待办

以下内容建议放在上述三期完成之后，再进入第二阶段：

- `Settings` 瘦身
- `Points` 域拆分为“积分资产 / 套餐 / 兑换码”
- `Chat + Tickets + Ops Alerts` 重切为正式工作台
- `Users` 模块瘦身
- `Export / 合规` 补齐
- 死配置和假配置清理

## 10. 验收总口径

三期完成后，Admin Studio 至少应达到以下状态：

- 新旧模块不再各自维护一套写入规则
- 双站点语义清楚：`all` 只看，`cn / intl` 才能写
- 首页、财务、社区、Prompt 互动四条主线都形成闭环
- 后台配置与前台真实行为的错位显著减少
- 后续的 `Settings`、`Points`、`Chat/Tickets/Ops` 重构可以在稳定底座上继续推进
