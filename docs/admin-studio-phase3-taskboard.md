# Admin Studio Phase 3 开发任务单

这份文档用于把 `Admin Studio` 第三阶段改造压成可以直接开工的任务单。

配套文档：

- [admin-studio-rebuild-roadmap.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-rebuild-roadmap.md)
- [admin-studio-phase1-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase1-taskboard.md)
- [admin-studio-phase2-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase2-taskboard.md)

## 1. Phase 3 目标

第三阶段聚焦两条“互动与治理”主线：

- `Comments` 社区治理补齐
- `Prompts / Gallery` 互动站点化

这一阶段的重点不是继续改底座，而是把前两个阶段留下的“内容和互动断层”收口，让社区治理和 Prompt 互动都形成真正闭环。

## 2. Phase 3 前置条件

开始第三阶段前，默认下面条件已经满足：

1. [admin-studio-phase1-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase1-taskboard.md) 已完成
2. [admin-studio-phase2-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase2-taskboard.md) 已完成
3. `all` 视图已不能执行写操作
4. `Homepage` 和退款链路已收口，不再占用主要改造带宽
5. 团队已接受 `prompts` 主表保持全局双语资产，不在这一阶段强拆 `site`

## 3. Phase 3 完成标准

满足以下条件，才算第三阶段完成：

1. 后台可以治理 `guestbook_messages`、`guestbook_comments`、`prompt_comments`
2. 留言板删除主贴、删除回复、互动清理三种行为都正确收口
3. `prompt_comments`、`comment_likes`、realtime 都严格按 `site` 隔离
4. gallery 后台不再保留误导性的站点筛选语义
5. Prompt 双语字段不再完全依赖自动翻译黑盒，至少可被运营显式查看和校对

## 4. 分支策略

这一阶段建议拆两条分支并行推进：

- `codex/admin-comments-closure`
- `codex/admin-prompts-site-aware`

如果团队人手有限，建议先做 `Comments`，再做 `Prompts / Gallery`，因为评论治理后台的业务闭环价值更直接。

## 5. 任务总览

| 任务 ID | 任务名 | 建议负责人 | 预估工时 | 前置依赖 | 是否阻塞后续 |
|---|---|---|---|---|---|
| `P3-C1` | Comments 统一读取模型与 Summary | 后端 | `1 天` | Phase 2 | 是 |
| `P3-C2` | 后台接入留言板回复链 | 前端 | `0.5-1 天` | `P3-C1` | 否 |
| `P3-C3` | 评论治理动作服务端化 | 后端 | `1 天` | `P3-C1` | 否 |
| `P3-C4` | 评论筛选与统计修正 | 前端 | `0.5-1 天` | `P3-C2` `P3-C3` | 否 |
| `P3-C5` | 封禁语义与评论配置收口 | 前端 / 产品 / 后端 | `0.5 天` | `P3-C4` | 是 |
| `P3-D1` | Prompt Comments 站点化 | 前端 | `1 天` | Phase 2 | 是 |
| `P3-D2` | Comment Likes 站点化 | 前端 / 后端 | `0.5-1 天` | `P3-D1` | 否 |
| `P3-D3` | Reply Trigger 补 Site 条件 | 后端 / SQL | `0.5 天` | `P3-D1` | 否 |
| `P3-D4` | Gallery 站点筛选止血 | 前端 | `0.5 天` | `P3-D1` | 否 |
| `P3-D5` | Prompt 双语字段最小可见化 | 前端 | `0.5-1 天` | `P3-D4` | 是 |

## 6. Comments 任务明细

## `P3-C1` Comments 统一读取模型与 Summary

目标：

- 给评论后台建立统一的读模型
- 让留言主贴、留言回复、Prompt 评论进入同一治理视角

涉及文件：

- 新增 `server/api-handlers/admin/comments/list.js`
- 新增 `server/api-handlers/admin/comments/summary.js`
- [admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/admin.js)

要做的事：

1. 统一输出评论治理视图的数据结构
2. 至少覆盖三类实体：
   - `guestbook_message`
   - `guestbook_comment`
   - `prompt_comment`
3. 给每条记录补齐 `entity_type / parent_id / thread_root_id / site / like_count / reply_count`
4. Summary 至少能返回总量、回复量、活跃作者数等核心统计

验收标准：

- 后台不再只看得到留言主贴和 Prompt 评论
- 统一列表结构能支撑后续筛选和治理动作

## `P3-C2` 后台接入留言板回复链

目标：

- 让后台真正看见留言板回复，而不是只看主贴

涉及文件：

- [admin-comments.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-comments.js)
- [guestbook.js](/Volumes/chao/AI/xianyu_profit_calculator/guestbook.js)

要做的事：

1. 在评论后台把 `guestbook_comments` 纳入列表
2. 支持区分“主贴”和“回复”
3. 在 UI 层补出 thread 关系和必要上下文

验收标准：

- 后台能浏览留言板回复链
- 回复不会再被错误归并成主贴统计

## `P3-C3` 评论治理动作服务端化

目标：

- 把删除、屏蔽、清理互动等治理动作从前端直写迁到服务端

涉及文件：

- 新增 `server/api-handlers/admin/comments/moderate.js`
- [admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/admin.js)
- [admin-comments.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-comments.js)

要做的事：

1. 提供“删除主贴整串”的服务端动作
2. 提供“只删单条回复”的服务端动作
3. 删除留言内容时，清理对应的 `guestbook_likes`
4. 保持 Prompt 评论侧的删除口径一致
5. 统一写 audit

验收标准：

- 删除主贴和删除回复是两种明确动作
- 删除留言内容后不会留下明显互动脏数据
- 前端不再直接删相关表

## `P3-C4` 评论筛选与统计修正

目标：

- 把现有评论后台里的假筛选和失真统计修正为真行为

涉及文件：

- [admin-comments.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-comments.js)
- Comments list / summary handler

要做的事：

1. 让“有回复 / 无回复 / 子回复 / 置顶”等筛选真正生效
2. 把 `guestbook_comments` 计入统计
3. 保持留言板和 Prompt 评论的统计口径一致

验收标准：

- UI 上出现的筛选都是真筛选
- 评论总数、活跃用户、增长趋势不再明显偏差

## `P3-C5` 封禁语义与评论配置收口

目标：

- 把当前模糊的封禁语义和假配置收口

涉及文件：

- [admin-comments.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-comments.js)
- [prompts-poetry.js](/Volumes/chao/AI/xianyu_profit_calculator/prompts-poetry.js)
- [supabase-guestbook-functions.js](/Volumes/chao/AI/xianyu_profit_calculator/supabase-guestbook-functions.js)
- [admin-config.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-config.js)

要做的事：

1. 明确 `blocked_users` 当前是全站 scope 还是分站 scope
2. 如果仍是全站 scope，在 UI 中明确提示
3. 盘点评论规则配置：
   - 真正接到前台逻辑上的保留
   - 无消费链路的标记为待下线

验收标准：

- 运营能理解封禁的实际作用范围
- 评论配置不再继续制造“可配但不生效”的错觉

## 7. Prompts / Gallery 任务明细

## `P3-D1` Prompt Comments 站点化

目标：

- 让 Prompt 评论的写入、读取、统计、realtime 都按站点隔离

涉及文件：

- [prompts-poetry.js](/Volumes/chao/AI/xianyu_profit_calculator/prompts-poetry.js)
- 如有需要，可新增轻量 handler 或 helper

要做的事：

1. 评论写入时补 `site`
2. 评论列表查询按 `prompt_id + site` 过滤
3. 评论数查询按当前站点统计
4. realtime 插入更新按当前站点隔离

验收标准：

- `cn` 站的评论不会出现在 `intl` 站
- comment badge 和评论弹窗统计口径一致

## `P3-D2` Comment Likes 站点化

目标：

- 让评论点赞的读写与评论本身保持同一站点口径

涉及文件：

- [prompts-poetry.js](/Volumes/chao/AI/xianyu_profit_calculator/prompts-poetry.js)
- [schema-comment-likes.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/schema-comment-likes.sql)
- 如有需要，新增小型 SQL trigger

要做的事：

1. 点赞写入补 `site`
2. 点赞读取补 `site`
3. 如前端仍可能漏传，增加数据库兜底回填

验收标准：

- 点赞数和点赞态不会跨站串数据
- `comment_likes` 口径与 `prompt_comments` 一致

## `P3-D3` Reply Trigger 补 Site 条件

目标：

- 防止回复自动挂链在站点隔离后继续跨站串父评论

涉及文件：

- [trigger-auto-link-replies.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/trigger-auto-link-replies.sql)

要做的事：

1. 在 trigger 查询父评论时加入 `site` 条件
2. 确认旧数据兼容策略

验收标准：

- 自动挂链不会跨站点关联错误父评论

## `P3-D4` Gallery 站点筛选止血

目标：

- 先止住 gallery 模块里误导性的站点筛选语义

涉及文件：

- [admin-site-filter.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-site-filter.js)
- [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js)

要做的事：

1. 明确 gallery 模块切站后到底影响什么
2. 如果暂时没有站点化互动 summary，就先隐藏或禁用该筛选
3. 如果保留筛选，就明确说明“只影响互动指标，不影响 Prompt 内容主表”

验收标准：

- gallery 后台不再保留“切了站点但页面其实没变化”的假筛选

## `P3-D5` Prompt 双语字段最小可见化

目标：

- 让运营最少限度地看到并校对 Prompt 双语字段

涉及文件：

- [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)
- [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js)

要做的事：

1. 给 Prompt 表单增加“高级语言字段”展开区
2. 让 `title_zh / title_en / prompt_text_zh / prompt_text_en` 至少可见
3. 保留自动翻译，但不再把它当成唯一入口

验收标准：

- 运营可以显式查看和调整双语字段
- 保存后字段不会再完全依赖黑盒翻译结果

## 8. 测试与验收

自动测试至少运行：

```bash
node --test tests/admin-handler-permissions.test.js
node --test tests/admin-payments-actions.test.js
node --test tests/admin-tickets-process.test.js
```

建议新增：

- Comments admin contract test
- Guestbook reply moderation regression test
- Prompt comments site isolation test
- Comment likes site isolation test

手工 Smoke：

### Comments

1. 进入评论后台，确认能看到留言主贴、留言回复、Prompt 评论
2. 删除一条留言回复，确认不会误删整串
3. 删除一条留言主贴，确认回复和相关互动被清理
4. 切换“有回复 / 无回复 / 子回复”等筛选，确认都真生效

### Prompts / Gallery

1. 在 `cn` 站对某个 Prompt 发评论
2. 切到 `intl` 站确认该评论不出现
3. 在 `cn` 站点赞评论，切到 `intl` 确认点赞态不串站
4. 进入后台 gallery，确认站点筛选语义清楚
5. 打开 Prompt 编辑表单，确认双语字段可见

## 9. 建议排期

如果两条线并行，建议按 5 到 6 个工作日推进：

### Day 1

- `P3-C1`
- `P3-D1`

### Day 2

- `P3-C2`
- `P3-C3`
- `P3-D2`

### Day 3

- `P3-C4`
- `P3-D3`

### Day 4

- `P3-C5`
- `P3-D4`

### Day 5

- `P3-D5`
- 联调与回归

### Day 6

- 修尾项
- 发布说明

## 10. 风险点

第三阶段最常见的翻车点有 4 类：

1. 评论后台数据模型补了一半，导致 UI 仍然失真
2. 删除主贴和删除回复动作没有清晰分开，误删范围过大
3. Prompt 评论补了 `site`，但点赞、realtime、trigger 没一起补，结果只是把问题换了位置
4. 团队又回到“给 prompts 主表加 site”的错误方向，导致内容资产和互动域一起失控

因此这一阶段一定要保证：

- `Comments` 先把读取模型和服务端治理动作补完整
- `Prompts` 先改互动，不碰主内容表的站点拆分
- 删除行为、统计行为、realtime 行为一起验证

## 11. 交付物

Phase 3 结束后，应该交付这些东西：

1. 一套统一的评论治理读模型
2. 一条服务端化的评论治理动作链路
3. 一套站点隔离的 Prompt 评论和点赞行为
4. 一份语义清楚的 gallery 站点筛选行为
5. 一组覆盖评论治理和 Prompt 互动站点隔离的回归测试
