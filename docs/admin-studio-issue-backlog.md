# Admin Studio Issue 模板包

这份文档用于把 `Admin Studio` 三期改造任务压成可以直接复制到项目管理工具里的 issue 模板。

配套文档：

- [admin-studio-rebuild-roadmap.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-rebuild-roadmap.md)
- [admin-studio-phase1-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase1-taskboard.md)
- [admin-studio-phase2-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase2-taskboard.md)
- [admin-studio-phase3-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase3-taskboard.md)

## 1. 使用方式

建议每张 issue 至少保留这些字段：

- 标题
- 优先级
- 建议负责人
- 前置依赖
- 描述
- 涉及文件
- 验收标准
- 风险点
- 测试建议

如果要导入到 `Linear / Jira / 飞书项目`，可以直接按下面每张 issue 的结构复制。

## 2. Phase 1

## ISSUE `P1-1`

标题：`Admin Site Helper 收口`

优先级：`P0`

建议负责人：`平台 / 后端`

前置依赖：`无`

描述：

- 在服务端建立统一的 admin site 写入规则
- 为后续 handler 提供可复用的 `site` 规范化和写保护能力
- 统一 audit 中的站点记录口径

涉及文件：

- [api/_lib/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin.js)
- [api/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/admin.js)
- [tests/admin-handler-permissions.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-handler-permissions.test.js)

验收标准：

- 写请求传 `all` 会被明确拒绝
- `cn / intl` 会被正确保留
- audit 稳定带上 `site`

风险点：

- 公共 helper 改得太重会误伤已有 handler

测试建议：

- `node --test tests/admin-handler-permissions.test.js`

## ISSUE `P1-2`

标题：`前端站点写保护 Guard`

优先级：`P0`

建议负责人：`前端`

前置依赖：`P1-1`

描述：

- 在公共前端层拦截 `all` 视图下的写操作
- 避免每个模块各自处理 `site` 写入规则

涉及文件：

- [js/admin-site-filter.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-site-filter.js)
- [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js)
- [js/admin-studio-bootstrap.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-studio-bootstrap.js)

验收标准：

- 查看、筛选、分页不受影响
- 保存、删除、生成、退款类动作在 `all` 下被阻止
- 提示明确要求选择 `cn` 或 `intl`

风险点：

- guard 写太宽会误伤纯读动作

测试建议：

- 新增前端 guard 测试
- 手工验证 `all` 下纯读不受影响

## ISSUE `P1-3`

标题：`Homepage 写入口止血`

优先级：`P1`

建议负责人：`前端`

前置依赖：`P1-2`

描述：

- 去掉首页模块里 `all -> cn` 的默认写入
- 保存前统一走公共 `writableSite`

涉及文件：

- [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)

验收标准：

- `all` 下保存首页被阻止
- `cn / intl` 下仍可保存

风险点：

- 首页模块里存在隐藏保存入口未被一并修掉

测试建议：

- `all` / `cn` / `intl` 三态手工验证保存

## ISSUE `P1-4`

标题：`Points 写入口止血`

优先级：`P1`

建议负责人：`前端`

前置依赖：`P1-2`

描述：

- 去掉积分/兑换码模块里的隐式站点写入
- 生成批次、兑换码、保存动作统一走 `writableSite`

涉及文件：

- [admin-points.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-points.js)

验收标准：

- `all` 下不能生成兑换码或保存批次
- `cn / intl` 下行为保持正常

风险点：

- 兑换码和批次保存可能分散在多个入口

测试建议：

- 手工验证生成、保存、编辑三类动作

## ISSUE `P1-5`

标题：`Shop / Discounts / Gallery 写入口止血`

优先级：`P1`

建议负责人：`前端`

前置依赖：`P1-2`

描述：

- 补掉商城、折扣、Prompt 管理里的高风险错误写入口
- 去掉 `all -> cn` 默认回落

涉及文件：

- [js/admin-shop.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-shop.js)
- [admin-discounts.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-discounts.js)
- [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js)

验收标准：

- `all` 下不能进行相关写操作
- `cn / intl` 下流程仍可用

风险点：

- Prompt 管理和 Gallery 动作分散在大文件里，容易漏改

测试建议：

- 手工验证商品写操作、折扣编辑、prompt 保存

## ISSUE `P1-6`

标题：`Phase 1 回归测试与 Smoke 验收`

优先级：`P0`

建议负责人：`QA / 联调`

前置依赖：`P1-3` `P1-4` `P1-5`

描述：

- 确认公共 guard 没有误伤
- 确认所有高风险写入口都已被收住

涉及文件：

- [tests/admin-handler-permissions.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-handler-permissions.test.js)
- [tests/admin-payments-actions.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-payments-actions.test.js)
- [tests/admin-tickets-process.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-tickets-process.test.js)

验收标准：

- `all` 下的写操作都被阻止
- `cn / intl` 下的关键保存仍可用
- 没有新增白屏、死按钮或整页报错

风险点：

- guard 行为与实际模块写路径不完全一致

测试建议：

- `node --test tests/admin-handler-permissions.test.js`
- `node --test tests/admin-payments-actions.test.js`
- `node --test tests/admin-tickets-process.test.js`

## 3. Phase 2

## ISSUE `P2-A1`

标题：`Homepage Schema 兼容层`

优先级：`P0`

建议负责人：`后端 / SQL`

前置依赖：`Phase 1 完成`

描述：

- 把首页配置从“全局 section”升级为“站点 + section”
- 先建立兼容读能力，不直接强切后台

涉及文件：

- [supabase/homepage_config_schema.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/homepage_config_schema.sql)
- 新增 homepage 迁移脚本

验收标准：

- 旧数据被安全迁移成 `cn / intl`
- 新旧结构都可被兼容读取
- 不会因为迁移导致首页空白

风险点：

- 数据回填不完整会导致 `intl` 站内容缺失

测试建议：

- SQL 自检
- 本地 / preview 首页读取验证

## ISSUE `P2-A2`

标题：`Homepage 前台兼容读`

优先级：`P0`

建议负责人：`前端`

前置依赖：`P2-A1`

描述：

- 让前台首页先能读新结构
- 让缓存 key 正式按站点隔离

涉及文件：

- [js/framer_home.js](/Volumes/chao/AI/xianyu_profit_calculator/js/framer_home.js)
- [js/prefetch-home.js](/Volumes/chao/AI/xianyu_profit_calculator/js/prefetch-home.js)
- [js/section-visibility.js](/Volumes/chao/AI/xianyu_profit_calculator/js/section-visibility.js)
- [js/cache.js](/Volumes/chao/AI/xianyu_profit_calculator/js/cache.js)

验收标准：

- 当前站点能读到对应首页内容
- 一站缓存失效不会影响另一站

风险点：

- 前台只兼容了一半会导致线上读到混合结构

测试建议：

- `cn / intl` 双站手工 smoke

## ISSUE `P2-A3`

标题：`Homepage Admin Handler`

优先级：`P1`

建议负责人：`后端`

前置依赖：`P2-A1`

描述：

- 把首页后台读写从浏览器直写迁到服务端 handler

涉及文件：

- [api/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/admin.js)
- `server/api-handlers/admin/homepage/config.js`
- [api/_lib/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin.js)

验收标准：

- 首页后台不再前端直接写库
- `site` 只允许 `cn / intl`
- 首页改动在 audit 中可追溯

风险点：

- handler 读写口径与前台兼容读不一致

测试建议：

- 新增 homepage contract test

## ISSUE `P2-A4`

标题：`Homepage 后台切换新模型`

优先级：`P1`

建议负责人：`前端`

前置依赖：`P2-A2` `P2-A3`

描述：

- 让首页后台 UI 真正使用站点化配置模型
- 去掉独立的 `section_visibility`

涉及文件：

- [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)
- [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)

验收标准：

- `cn / intl` 切换后能看到不同首页内容
- 显隐和内容来自同一份数据

风险点：

- `ticker`、旧 section 映射、显隐逻辑混在一起

测试建议：

- 后台切站 + 前台预览联调

## ISSUE `P2-A5`

标题：`Homepage 旧语义清理与 Smoke`

优先级：`P1`

建议负责人：`前端 / QA`

前置依赖：`P2-A4`

描述：

- 清理首页域遗留的旧 section、旧缓存和旧映射语义

涉及文件：

- [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)
- [js/section-visibility.js](/Volumes/chao/AI/xianyu_profit_calculator/js/section-visibility.js)

验收标准：

- 不再残留 `global`、`gallery`、`footer` 等旧 homepage 语义
- 双站 smoke 稳定通过

风险点：

- 清理不彻底会导致新旧逻辑并存

测试建议：

- 首页双站 smoke checklist

## ISSUE `P2-B1`

标题：`共享退款编排服务`

优先级：`P0`

建议负责人：`后端`

前置依赖：`Phase 1 完成`

描述：

- 把商城退款执行链路收成一条共享服务
- 统一订单校验、站点退账、库存回滚、订单状态更新、audit

涉及文件：

- `api/_lib/shop/refunds.js`
- 相关 site-aware points helper

验收标准：

- 双站余额不会串改
- 同一笔退款重复提交可被幂等保护
- 退款失败不会留下半成功状态

风险点：

- 旧订单和新双站模型混用时容易出现兼容问题

测试建议：

- 新增 refund site isolation / idempotency tests

## ISSUE `P2-B2`

标题：`Payments Shop Refund Handler`

优先级：`P0`

建议负责人：`后端`

前置依赖：`P2-B1`

描述：

- 给商城退款提供正式服务端入口
- 让浏览器不再直连旧退款 RPC

涉及文件：

- [api/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/admin.js)
- `server/api-handlers/admin/payments/shop-refund.js`
- [api/_lib/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin.js)

验收标准：

- 浏览器不再碰旧退款 RPC
- handler 权限、审计、错误口径统一

风险点：

- handler 只包了一层旧 RPC，没有真正按站点化逻辑执行

测试建议：

- permissions + happy path + failure path

## ISSUE `P2-B3`

标题：`Shop 前端退款入口切换`

优先级：`P1`

建议负责人：`前端`

前置依赖：`P2-B2`

描述：

- 保留商城退款弹窗交互
- 把提交逻辑切到新服务端 handler

涉及文件：

- [js/admin-shop.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-shop.js)

验收标准：

- 运营操作习惯不变
- 执行链路已切到新 handler

风险点：

- UI 成功态和库存刷新逻辑仍依赖旧返回结构

测试建议：

- 商城退款手工 smoke

## ISSUE `P2-B4`

标题：`Tickets Refund 复用共享服务`

优先级：`P1`

建议负责人：`后端`

前置依赖：`P2-B1`

描述：

- 让工单退款和商城退款共用同一条底层能力

涉及文件：

- [server/api-handlers/admin/tickets/process.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/tickets/process.js)
- 退款相关测试

验收标准：

- 工单侧不再保留第二套独立退款实现
- 工单处理结果仍能正常同步

风险点：

- 工单侧上下文字段和商城退款编排要求不完全一致

测试建议：

- `node --test tests/admin-tickets-process.test.js`

## ISSUE `P2-B5`

标题：`旧退款 RPC 退场与回归`

优先级：`P1`

建议负责人：`后端 / QA`

前置依赖：`P2-B3` `P2-B4`

描述：

- 确认旧退款 RPC 不再被浏览器直连
- 评估并收紧旧函数权限

涉及文件：

- [supabase/migrations/enhance_refund_function.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/enhance_refund_function.sql)
- 相关退款 SQL / 权限配置

验收标准：

- 浏览器不能直接调用旧退款 RPC
- 新退款主链路完整通过

风险点：

- 退场动作过早会影响尚未迁移的隐蔽入口

测试建议：

- 退款主链路完整回归

## 4. Phase 3

## ISSUE `P3-C1`

标题：`Comments 统一读取模型与 Summary`

优先级：`P0`

建议负责人：`后端`

前置依赖：`Phase 2 完成`

描述：

- 给评论后台建立统一读模型
- 覆盖留言主贴、留言回复、Prompt 评论

涉及文件：

- `server/api-handlers/admin/comments/list.js`
- `server/api-handlers/admin/comments/summary.js`
- [api/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/admin.js)

验收标准：

- 后台不再只看得到主贴和 Prompt 评论
- 统一列表结构能支撑筛选和治理动作

风险点：

- 统一模型设计得过窄，后续筛选和治理还得返工

测试建议：

- 新增 comments list / summary contract test

## ISSUE `P3-C2`

标题：`后台接入留言板回复链`

优先级：`P1`

建议负责人：`前端`

前置依赖：`P3-C1`

描述：

- 让评论后台真正展示 `guestbook_comments`
- 能区分主贴和回复

涉及文件：

- [admin-comments.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-comments.js)
- [guestbook.js](/Volumes/chao/AI/xianyu_profit_calculator/guestbook.js)

验收标准：

- 后台能浏览留言板回复链
- 回复不会继续被错误归并

风险点：

- UI 数据结构仍沿用旧单层模型

测试建议：

- 留言主贴 / 回复展示手工 smoke

## ISSUE `P3-C3`

标题：`评论治理动作服务端化`

优先级：`P0`

建议负责人：`后端`

前置依赖：`P3-C1`

描述：

- 把删除、屏蔽、互动清理等治理动作迁到服务端

涉及文件：

- `server/api-handlers/admin/comments/moderate.js`
- [api/admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/admin.js)
- [admin-comments.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-comments.js)

验收标准：

- 删除主贴和删除回复是两种明确动作
- 删除后不会留下明显脏数据
- 前端不再直删相关表

风险点：

- 删除范围定义不清，容易误删整串

测试建议：

- 主贴删除 / 回复删除 / likes 清理回归

## ISSUE `P3-C4`

标题：`评论筛选与统计修正`

优先级：`P1`

建议负责人：`前端`

前置依赖：`P3-C2` `P3-C3`

描述：

- 把评论后台里的假筛选和失真统计修成真行为

涉及文件：

- [admin-comments.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-comments.js)
- comments list / summary handler

验收标准：

- “有回复 / 无回复 / 子回复 / 置顶”等筛选真生效
- 总数、活跃用户、增长趋势明显更准确

风险点：

- 前台筛选条件与后端 summary 口径不一致

测试建议：

- 筛选联调 smoke

## ISSUE `P3-C5`

标题：`封禁语义与评论配置收口`

优先级：`P1`

建议负责人：`前端 / 产品 / 后端`

前置依赖：`P3-C4`

描述：

- 明确封禁的实际作用范围
- 处理评论相关假配置

涉及文件：

- [admin-comments.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-comments.js)
- [prompts-poetry.js](/Volumes/chao/AI/xianyu_profit_calculator/prompts-poetry.js)
- [supabase-guestbook-functions.js](/Volumes/chao/AI/xianyu_profit_calculator/supabase-guestbook-functions.js)
- [admin-config.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-config.js)

验收标准：

- 运营能理解封禁的实际范围
- 评论配置不再继续制造假开关

风险点：

- 产品语义未定会导致实现来回反复

测试建议：

- 封禁前后台联调

## ISSUE `P3-D1`

标题：`Prompt Comments 站点化`

优先级：`P0`

建议负责人：`前端`

前置依赖：`Phase 2 完成`

描述：

- 让 Prompt 评论的写入、读取、统计、realtime 全部按站点隔离

涉及文件：

- [prompts-poetry.js](/Volumes/chao/AI/xianyu_profit_calculator/prompts-poetry.js)

验收标准：

- `cn` 站评论不会出现在 `intl` 站
- comment badge 和评论弹窗统计口径一致

风险点：

- 只改查询不改写入，或只改写入不改 realtime

测试建议：

- prompt comments site isolation test

## ISSUE `P3-D2`

标题：`Comment Likes 站点化`

优先级：`P1`

建议负责人：`前端 / 后端`

前置依赖：`P3-D1`

描述：

- 让评论点赞的读写与评论本身保持同一站点口径

涉及文件：

- [prompts-poetry.js](/Volumes/chao/AI/xianyu_profit_calculator/prompts-poetry.js)
- [supabase/schema-comment-likes.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/schema-comment-likes.sql)

验收标准：

- 点赞数和点赞态不会跨站串数据
- `comment_likes` 口径与 `prompt_comments` 一致

风险点：

- 现有唯一键和新 `site` 口径不完全一致

测试建议：

- likes site isolation regression

## ISSUE `P3-D3`

标题：`Reply Trigger 补 Site 条件`

优先级：`P1`

建议负责人：`后端 / SQL`

前置依赖：`P3-D1`

描述：

- 防止回复自动挂链在站点隔离后串错父评论

涉及文件：

- [supabase/trigger-auto-link-replies.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/trigger-auto-link-replies.sql)

验收标准：

- 自动挂链不会跨站点关联错误父评论

风险点：

- 旧数据兼容和新 trigger 条件不一致

测试建议：

- reply trigger SQL 验证

## ISSUE `P3-D4`

标题：`Gallery 站点筛选止血`

优先级：`P1`

建议负责人：`前端`

前置依赖：`P3-D1`

描述：

- 先止住 gallery 模块里的误导性站点筛选

涉及文件：

- [js/admin-site-filter.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-site-filter.js)
- [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js)

验收标准：

- gallery 后台不再保留“切了站点但页面没变化”的假筛选

风险点：

- 如果直接隐藏筛选，需要确认不会影响其他模块入口

测试建议：

- gallery 模块切站 smoke

## ISSUE `P3-D5`

标题：`Prompt 双语字段最小可见化`

优先级：`P1`

建议负责人：`前端`

前置依赖：`P3-D4`

描述：

- 给 Prompt 编辑表单增加“高级语言字段”可见入口
- 不再让双语字段完全依赖自动翻译黑盒

涉及文件：

- [admin-studio.html](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.html)
- [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js)

验收标准：

- 运营可以显式查看和调整双语字段
- 保存后字段不会再完全依赖黑盒翻译

风险点：

- 表单复杂度上升，需要控制在“最小可见化”范围

测试建议：

- Prompt 编辑表单 smoke

## 5. 推荐标签

如果项目管理工具支持标签，建议统一使用：

- `admin-studio`
- `phase-1`
- `phase-2`
- `phase-3`
- `site-awareness`
- `audit`
- `payments`
- `homepage`
- `comments`
- `gallery`

## 6. 推荐状态流

建议每张 issue 使用同一套状态流：

1. `Todo`
2. `In Progress`
3. `In Review`
4. `QA`
5. `Done`

## 7. 推荐史诗划分

如果需要按 Epic 管理，建议这样分：

- `Epic 1` Admin Foundation
- `Epic 2` Homepage Dual-Site Closure
- `Epic 3` Payments / Refund Unification
- `Epic 4` Comments Governance Closure
- `Epic 5` Prompts / Gallery Site-Aware Interactions
