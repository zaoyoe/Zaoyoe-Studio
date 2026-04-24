# Admin Studio 全模块升级任务清单

更新时间：2026-04-21

## 本轮已落地

- AI 成本控制：`AdminAI` 默认携带结构化 token 预算，按 lean / balanced / expanded 三档限制输入字符与输出 token。
- Codex Relay 加固：服务端识别预算、限制请求体、截断超长文本、限制输出 token、脱敏上游错误，并将 `reasoning_effort` 映射为 Responses API 的 `reasoning.effort`。
- 跨模块反馈：新增 Admin Command Center，订阅模块切换、站点切换、上下文接力和 AI 请求事件。
- 安全反馈：管理员权限确认后同步到指挥台，设置、安全、告警等入口可从统一工作台跳转。
- 现代视觉反馈：新增统一运营脉冲、AI 预算、模块联动、安全状态卡片，移动端自适应。
- Analytics 联动回归：内容、积分交易、验证服务、社区增长分栏改为按需触发刷新并断言可见 KPI，站点切换会显式校验内容榜 `site` 上下文与 realtime teardown/rebuild。
- Tickets / Chat 闭环：本地 admin route 夹具补齐工单列表、SLA metrics、汇总追踪 digest；客服工作台支持用原始 session id 解析聚合会话，快捷回复、订单/充值/验证/工单状态标签可联动渲染。
- 默认 smoke 现代化：`smoke:admin-local` 改为 core suite，顺序覆盖 gallery / shop / analytics，并按模块预算输出耗时和检查数量；新增 `smoke:admin-all` 全模块入口，带模块级预算、短冷却和一次自动重试，覆盖 homepage / gallery / comments / shop / points / growth-center / analytics / settings / tickets / chat。
- 统一反馈层：`admin-studio.js` 的顶部状态与 toast 现在会发出同一条反馈信号，`Admin Command Center` 新增“统一反馈”流，沉淀最近的 Loading / Saved / Partial / Failed 回执，便于跨模块追踪最近一次动作结果。
- 性能切片：评论模块不再在后台访问确认后抢先拉取首屏列表，改为进入模块时再初始化；营销资产中心改为 shell 激活时懒启动，保留后续激活补同步，避免未进入增长分栏时提前绑定事件和请求数据。
- 性能切片延伸：积分模块改为 shell 激活后才初始化批次/生成视图，设置模块改为按上下文解析目标 tab 后再渲染与预热，bootstrap 仅保留 ops-alerts 的轻量绑定，不再抢先拉起整包 settings / points 数据。
- 性能切片续航：支付对账模块改为 shell 激活后才初始化，切换模块时由 shell 生命周期接管 `init / context / site-change`，并保留启动时 URL 直达支付页的按需自启动，避免 sidebar 切换继续走 bootstrap 直连初始化。
- 性能切片补齐：商城后台模块改为 shell 激活后初始化，订单 / 库存 / 履约常用上下文由 `ShopAdmin` 直接接管，站点切换优先走 shell `onSiteChange`，并移除 bootstrap 对商城的直连初始化与 load 自启动。
- 性能切片补齐：工单后台模块改为 shell 激活后初始化，队列 / 概览 / 汇总工作区由 `AdminTickets` 统一接管，评论与分析上下文优先走 shell `handleContext`，站点切换通过 shell `onSiteChange` 回收刷新，并移除 bootstrap 对工单的直连初始化。
- 性能切片补齐：用户后台模块改为 shell 激活后初始化，目录刷新继续沿用站点感知与 URL 恢复逻辑，shell 负责接管 `activate / site-change`，并移除 bootstrap 对用户模块的直连初始化。
- 性能切片补齐：客服后台模块改为 shell 激活后初始化，聊天实例复用、会话检索与站点切换刷新统一走 shell 生命周期，bootstrap 仅保留可选预热，不再在模块切换时直连创建聊天实例。
- 联动链路收口：告警 / 工单 / workbench 打开客服会话时优先走 `AdminShell.openContext('chat', ...)`，避免跨模块再直接创建 `AdminChat` 实例，客服壳层与会话聚焦统一由 shell 路由接管。
- 告警兜底跳转补齐：当 workbench 入口不可用时，客服告警卡片跳往会话、商城订单、支付总览会优先走 `AdminShell.openContext('chat'|'shop'|'payments', ...)`，仅把旧的 `switchModule + init` 流程保留为最后兜底。
- workbench 主链升级：评论、工单、商城、支付，以及设置页下的验证运维 / 访问审计入口，现已优先通过 `AdminShell.openContext(...)` 投递上下文；`settings` 模块补齐 `handleContext` 后，告警工作区对 verify / audit 的聚焦也能走统一 shell 生命周期。
- workbench 支线继续收口：优惠码风控入口和风险用户入口现已优先通过 `AdminShell.openContext('discounts'|'users', ...)` 投递上下文；`discounts` 补齐 shell 激活 / `handleContext`，`users` 补齐 modal/search context 处理，bootstrap 不再直接初始化优惠码模块。
- P1 detail context 收口：用户详情 helper 现已优先走 `AdminShell.openContext('users', ...)` 并保留 analyticsContext；工单提醒定位优先走 `AdminShell.openContext('tickets', ...)`；商城订单行详情入口补成 shell-first 的 `openOrderDetailContext(...)`，同时 `AdminShell` 自身补上 `shop` 默认 order detail 兜底。
- P1 analytics destination 收口：analytics workbench 中 payments / tickets / shop / comments / settings 的跨模块跳转已改成 shell-first；商城 `handleShellContext` 同步补齐 fulfillment task / dead-letter filter 透传，商品分析、支付异常、验证运维等下钻不再先走 `switchModule + 实例直连`。
- P2 command center / feedback layer 续推：评论模块 toast 已改成优先复用全局 `showToast` 并接入 `admin-feedback-signal`，避免统一反馈层漏记；ops-alert workbench 打开支付订单时也改成 shell-first，同时通过 `AdminPayments.getLastFocusResult()` 保留是否命中订单的结果语义。
- P2 action bus 续推：后台全局委托动作里，payments / tickets 的分析摘要、优先级聚焦、异常专题、超时队列入口都改成 shell-first；`AdminPayments.handleContext` 与 `AdminTickets.handleShellContext` 同步补齐 `priorityAction / issueSummary` 解析，保证统一路由后仍能落到原有聚焦行为。
- P2 prompt context 续推：Gallery / Analytics / Homepage / Users 里残留的 prompt 跳转入口继续收口到 shell-first；`HomepageAdmin` 正式注册 `AdminShell` 生命周期并补齐 `handleShellContext / handleSiteChange`，评论、首页、画廊之间的 prompt 接力不再优先走模块直连。
- P2 prompt analytics 续推：Gallery / Homepage / Comments 到内容经营分析的 prompt 跳转也改成 shell-first；`AdminGrowthCenter.handleContext` 负责消费 `open-prompt-analytics` 上下文并同步 analytics route / tab / content detail，prompt 联动链路不再依赖 `switchModule('growth-center')` 直连。
- P2 command center 上下文回执：`AdminShell` 现在会把每次 `openContext` 的送达状态、处理结果、目标动作透传到 `admin-shell-context`；`Admin Command Center` 的最近联动同步展示动作、目标 id 与送达状态，让 prompt analytics / 订单 / 工单这类跨模块操作可回溯。
- P2 性能切片续推：增长经营工作区移除文件尾部的无条件 `init()` 入口，改成仅在模块可见且后台访问已确认时通过 shell/激活 helper 懒启动，减少后台首屏阶段偷偷拉起增长中心数据与事件绑定的概率。
- P2 fallback 懒激活收口：analytics workbench、ops workbench、客服告警卡片、评论关联工单的回退链路已从 `switchModule + init()` 改成模块级 `activate(...)`，让 payments / tickets / shop 在 shell 不可用时也继续沿用懒激活语义，避免切模块时把重型模块提前整包拉起。
- P2 chat 懒加载收口：移除 bootstrap 侧遗留的客服预热调度；`AdminShell` 默认回退与 `admin-site-filter` 的站点切换改为复用 `handleAdminChatModuleSiteChange` / `ensureAdminChatInstance`，不再直接 `new AdminChat(...)`，同时 shop / tickets / payments 的壳层默认回退优先走模块 `activate(...)`，继续压缩壳层直连实例与 eager boot。
- P2 site-change helper 收口：`users / comments` 的站点切换现在也公开为共享 helper，`AdminShell` 默认 fallback 与 `admin-site-filter` 旧回退统一复用这些 helper，不再各自拼装 `loadUsers()` / `loadComments()` 分支，减少重模块刷新逻辑分叉。
- P2 settings / ops-alerts site-change 收口：`settings / discounts / ops-alerts` 改为显式共享 site-change helper；`AdminShell` 与 `admin-site-filter` 直接复用 helper，不再广播无人消费的 `admin-shell-site-reload-requested` 事件，设置页与告警工作台的站点切换刷新链路终于落回可见、可测的真实入口。
- P2 内容经营 site-change 收口：`homepage / points / growth-center` 也公开为共享 site-change helper；`AdminShell` 默认 fallback 与 `admin-site-filter` 的 legacy reload 现在统一复用 helper，增长经营在 shell 模式下不再偷偷依赖隐式 `admin-site-changed` 监听，内容经营模块的切站刷新链路进一步回到同一条主线。
- P2 analytics site-change 收口：分析中心补齐 `handleAdminAnalyticsSiteChange` 共享 helper，`AdminShell` 与 `admin-site-filter` 对 `analytics / business-overview / commerce-center` 的切站刷新改为优先复用同一入口；`commerce-center` 不再被壳层误判成“已由原生监听接管”而空转，分析容器的切站恢复开始与其他模块保持统一语义。
- P2 末端直连清理：`comments` 的上下文恢复补齐 `ensureCommentsModuleActive(...)`，Prompt / 用户评论上下文不再直接硬编码 `switchModule('comments')`；`points` 的兑换码用户跳转优先走 `AdminShell.openContext('users', ...)`，仅在 shell 不可用时才回落到旧模块切换。
- P2 commerce site-change helper 收口：`shop / tickets / payments` 公开显式 site-change helper，`AdminShell` 默认回退与 `admin-site-filter` 的 commerce 刷新分支优先复用 helper；壳层不再把 `comments / gallery / shop / payments` 误判成“天然原生监听已接管”，commerce 模块的切站刷新主线继续向 shell-first 对齐。
- P2 users 上下文收口：`admin-users` 公开 `openAdminUsersShellContext(...)` 共享 helper，`admin-workbench` 在 shell 不可用或上下文未送达时优先复用用户模块自己的上下文解析入口，不再自己散装拼 `openUserModal(...)` 参数，用户详情打开链路继续回到同一语义。
- P2 workbench 模块上下文收口：`payments / shop / discounts` 公开 `openAdmin*ShellContext(...)` 共享 helper，`admin-workbench` 在 shell 不可用时优先把上下文交回模块自己的 activate + handleContext 入口，不再继续手写一份 payments/shop/discounts 内部状态拼装和手动聚焦逻辑。
- P2 settings / tickets 上下文收口：`admin-config` 与 `admin-tickets` 也公开 `openAdmin*ShellContext(...)` 共享 helper，`admin-workbench` 在 `verify-monitor / admin-audit-monitor / tickets-pending / tickets-resolved` 的 shell-less fallback 中优先复用模块自己的 activate + handleContext 入口，不再继续散装拼 view switch、手动 refresh 与 ticket filter/search 分支。
- P2 analytics destination helper 收口：`admin-points` 公开 `openAdminPointsShellContext(...)`，分析目的地对 `points / users / settings-affiliate / verify-monitor` 的路由现在优先复用 `AdminShell` 或模块自己的共享 helper；`admin-studio` 里的“设置打开积分目录”和“分析打开用户详情”也改成 shell-first，不再保留直切模块后手工补动作的旁路。
- P2 command center / comments / ops-alerts helper 收口：`admin-comments` 公开 `openAdminCommentsShellContext(...)`，`admin-config` 公开 `openAdminOpsAlertsShellContext(...)` 并把 `ops-alerts` 正式注册进 `AdminShell`；`analytics-workbench` 对 `comments / ops-alerts-*` 的目的地路由、`admin-workbench` 的评论 fallback、`AdminShell` 的 comments 默认兜底、`Admin Command Center` 的 quick action，以及 `tickets.openSlaSettings()` 都开始优先复用这些共享 helper，不再继续分叉到散装 `switchModule + switchView + 手动聚焦`。
- P2 prompt / growth-center helper 收口：`admin-homepage` 公开 `openAdminHomepageShellContext(...)`，`growth-center` 公开 `openAdminGrowthCenterShellContext(...)`；`admin-studio` 与评论 Prompt 上下文在 shell 不可用时改为优先复用这些 helper，不再直接 `switchModule('homepage'/'growth-center')`。同时增长中心的 `openModule / openAsset` 改成优先走 `AdminShell.activateModule(...)` 或模块自己的共享 helper，积分批次 / 套餐与券码详情入口不再从增长中心内部硬切模块再补动作。
- P2 comments module bridge 收口：`gallery` 公开 `openAdminGalleryShellContext(...)`，评论详情里的用户、Prompt、工单三条跨模块入口在 `AdminShell.openContext(...)` 不可用时，也会先激活目标模块并交给 `openAdminUsersShellContext(...)` / `openAdminGalleryShellContext(...)` / `openAdminTicketsShellContext(...)`，不再直接 `switchModule + setTimeout` 维护第二套上下文投递脚本。
- P2 analytics commerce fallback 收口：分析目的地里的 `shop / payments / tickets` 在 `AdminShell.openContext(...)` 不可用时，已经改成先切到目标模块并复用 `openAdminShopShellContext(...)` / `openAdminPaymentsShellContext(...)` / `openAdminTicketsShellContext(...)`；只有共享 helper 不存在或明确失败时才继续使用旧的内部操作 fallback。
- P2 analytics destination fallback 再收口：分析目的地里的 `shop / payments / tickets / comments / users / points / settings / ops-alerts` 在 shell 拒绝上下文投递后，统一先走 `AdminShell.activateModule(..., { deferContext: true })` 再交给模块共享 helper；只有缺少 shell 激活能力时才退回 legacy `switchModule`，减少 fallback 里的懒加载语义分叉。
- P2 command center quick bridge 收口：指挥台快速入口现在在 shell 拒绝路由时会先通过 `AdminShell.activateModule(..., { deferContext: true })` 激活目标模块，再把上下文交给各模块公开的 `openAdmin*ShellContext(...)` helper；增长经营 / 商品经营也走共享 analytics helper，并把按钮自身与统一反馈流同步切到 Loading / Saved / Failed，不再把 quick action 直接落到老式 `switchModule` 旁路。
- P2 points 生成链路修复：兑换码生成提交前会在套餐快照缺失时轻量同步 `points/catalog`，避免生成视图刚切入或 smoke 快速提交时误判“套餐未加载”而挡住 `points/manage` 写入；全模块 `smoke:admin-all` 已确认 11 个模块全部通过。
- P2 points 生成 / 删除链路稳态收口：`generateCodesForm` 现在由 `admin-points.js` 自己接管提交并加上去重保护，不再只依赖较晚挂载的壳层 submit 委托；本地 smoke 也补齐了套餐选项初始化、批次回跳重开、删除前选中态保持的显式等待与回退，`points` 在单模块与全模块 smoke 里都能稳定跑完整个“生成 -> 编辑 -> 作废 -> Lookup -> 切站 -> 删除”闭环。
- P2 报表反馈与大文件拆分收口：首页残留的模板/定时发布/实验/推荐/主题包/报表/精选 Prompt 动作现已全部接入统一反馈流；`admin-config.js` 中集中告警清单、交班摘要、CSV 导出相关逻辑已抽到 `js/admin-config-ops-alert-reports.js`，并新增 `ops-alerts-report` 指挥台来源标签。拆分后重新跑通 `tests/admin-command-center.test.js`、`tests/admin-performance-lazy-activation.test.js`、`tests/frontend-supabase-runtime-config.test.js` 与 `smoke:admin-all`，11 个后台模块继续全绿。
- P1 points 统一反馈补齐：兑换码生成成功、校验失败、站点不可写、请求失败现在都会发出 `points-generate` 结构化回执；`Admin Command Center` 新增“兑换码生成”来源标签，指挥台能回看生成动作是否真正落库；补齐提交态直验后，`points` 单模块 smoke 与 `smoke:admin-all` 再次全绿。
- P1 settings / ops-alerts 统一反馈补齐：登录安全、公告、支付通道、验证配置、站外告警保存，以及告警 case 认领 / 重开、批量静默等动作现在都会发出结构化 `admin-feedback-signal`；`Admin Command Center` 新增 `settings-security / settings-announcement / settings-payment / settings-verify / ops-alerts-settings / ops-alerts-case / ops-alerts-mute` 来源标签，值班台终于能记住“改了什么、成没成功”，不再只停留在页面级跳转。
- P1 homepage / smoke 收口：首页模块剩余的模板、定时发布、实验、推荐、主题包、报表复制、精选 Prompt 失败分支都接入了统一 `admin-feedback-signal`，`Admin Command Center` 新增 `homepage-*` 来源标签；同时修掉 gallery 本地 smoke 里 `editPrompt()` Promise 被直接卡住与切站等待条件过宽导致的误报，`node scripts/admin-local-smoke.js --module gallery` 与 `npm run smoke:admin-all` 已重新全绿。
- P0 入口可用性修复：Admin Studio 权限 gate 增加总超时兜底；`AdminAccess` 的 Supabase REST fallback、短时 cookie session 签发 / 清理请求都加上超时保护；同时修复 `admin-comments.js` 与 `admin-studio.js` 的 `showToast` 顶层命名冲突，避免脚本解析失败后页面一直停在“正在校验后台访问权限”。
- P0 入口可用性续推：Admin Studio 权限 gate 现在会在缓存误判、权限 RPC 瞬时失败、启动期未预期异常时自动停止 pending，优先强制刷新一次权限，再退回可操作的失败态，避免后台入口继续无声卡在加载圈。
- P0 登录回流闭环：`admin-entry` 在未登录时会记住 `/admin-entry.html?next=/admin-studio.html` 回流目标，首页 Google 登录成功后会优先消费这条短时跳转记录并自动返回后台入口；`auth-callback` 也会优先使用同一份短时 redirect cache，避免登录成功后还停在首页。
- P0 会话恢复续推：Analytics / Shop / Tickets / Chat 告警动作的后台请求头现在优先复用 `AdminApi.buildRequestInit()`，在 SDK session 尚未就绪时再回退到 runtime `accessToken()`，减少登录刚恢复时首波后台请求因 token 空档失败的概率。
- P0 会话恢复兜底：共享 `AdminApi.fetch()` 现在会在 cookie-priority 请求命中 401 / 403 时自动清理本地 Admin Studio session cache，并重试一次 bearer token；显式 bearer 请求不会重复重试，降低短期 cookie 失效对后台主链的影响。
- P0 会话恢复压窗：`requireAdminStudioAccess()` 现在会在放行后台 shell 前，短时间尝试先热 Admin Studio cookie session；如果首轮失败或超时，页面仍会继续进入后台，但会立刻在后台发起一次 `forceRefresh` 重试，把“已放行但 cookie 还没就绪”的竞态窗口压到更小。
- P0 安全与成本续推：`AdminAI` 现在强制显式 budget tier，Gallery / Analytics / Shop / 翻译调用点全部补齐预算声明；Gemini 代理补上与 Codex 一致的预算裁剪、输出上限和错误脱敏，Codex 连通性探针失败也会回传脱敏后的错误详情。
- P0 安全与成本续推：后台鉴权链路已切到 Admin Studio 短期 cookie session 优先、Supabase bearer token 回落；`AdminApi` / `AdminAI` / settings / payments 共用这条请求初始化策略，同时补上高风险动作 audit 覆盖合同测试，锁住 AI 配置、支付配置、告警静默、批量删除、退款、封禁的审计回归。
- P1 数据反馈贯通：支付异常处理 / 批量归档、商城订单退款 / 履约 / 商品库存操作、工单单笔 / 批量处理、券码生成 / 恢复 / 重试结果统一发往 `admin-feedback-signal`，指挥台用 Saved / Partial / Failed 沉淀最近处理结果。
- P1 数据反馈补齐：用户批量通知 / 封禁 / 积分 / 管理员权限、积分批次 / 兑换码内联动作、评论批量状态 / 指派 / 删除也接入统一反馈来源，指挥台可区分用户批量、积分批次、评论批量等处理回执。
- P1 治理动作收口：评论单笔建工单 / 状态 / 指派 / 优先级 / 标签 / 备注 / 删除 / 置顶 / 封禁，用户卡券删除恢复 / 头像重置 / 单用户积分 / 标签 / 危险清理，以及积分套餐创建保存删除均接入统一回执来源。
- P1 移动端批量与恢复提示：用户 / 评论 / 积分批量菜单补齐移动端底部安全区、滚动锁定和 aria 开合状态；空选择、站点不可写、无可处理对象等异常路径会给出恢复指引并写入统一回执。
- P1 支付 / 工单异常恢复回执：支付分析摘要、优先级聚焦、异常主题，以及工单摘要聚焦、超时队列打开，现在都会在 shell 与 fallback 两条路径上写入统一回执；缺少目标标识时也会立即提示刷新卡片后重试。
- P1 商城履约异常恢复回执：delivery 问题摘要、死信时间桶、冲突死信视角，以及 shell 打开的 fulfillment 队列现在都会发出统一回执，方便从指挥台追踪恢复动作。

## P0 安全与成本

- Codex / Gemini 代理统一预算协议，所有 AI 调用必须显式声明预算档位。
- 上游错误、密钥、token、Authorization 信息必须脱敏后返回。
- 所有写操作继续强制站点写入守卫，`all` 视图仅允许读。
- 后台访问优先使用短期 Admin Studio cookie session，失败回落到 Supabase token。
- 高风险动作保留 audit log：AI 配置、支付配置、告警静默、批量删除、退款、封禁。

## P1 交互与联动

- Gallery -> 评论 / 主页 / 经营分析保持上下文接力。
- 告警工作区 -> 支付、工单、库存、验证、安全审计保持目标模块聚焦。
- 用户详情、订单详情、工单详情统一通过 `AdminShell.openContext` 打开。
- 指挥台继续接入更多模块的 `handleContext` 生命周期，减少直接 DOM 调用。
- 站点筛选切换时，各模块使用 `admin-shell-site-changed` 统一刷新。

## P1 数据呈现

- 经营分析优先使用 bundle 接口，避免多次 RPC 扇出。
- AI 洞察只输入聚合摘要、指标口径、异常卡片、动作候选，不输入完整原始明细。
- 表格加载继续使用 skeleton，并补齐批量动作的成功、失败、部分失败反馈。
- 支付、商城、券码、工单、用户、积分、评论批量动作和核心单笔治理动作已接入“最近一次处理结果”统一反馈；移动端批量菜单与主要异常恢复提示已补齐，后续继续扩展到更多异常恢复入口。
- 指挥台沉淀最近 3 条跨模块上下文，便于回溯处理路径；支付 / 工单 / 商城履约的分析聚焦与异常恢复也会留下可追踪回执。

## P2 性能

- 首屏只加载当前模块必要数据，其他模块通过激活生命周期懒加载。
- 重型图表、导出、AI 洞察保持手动触发或后台预取，不进入首屏关键路径。
- 模块切换使用稳定尺寸容器，避免工具栏、卡片、表格状态变化导致布局跳动。
- 继续收敛超大单文件，把模块渲染、事件、API、导出按现有 `js/admin-*` 结构拆分。

## P2 视觉

- 所有模块保持统一状态语言：Ready、Loading、Saved、Partial、Failed。
- 危险动作使用明确二次确认和结果复盘，不只依赖 toast。
- 移动端优先保证表格操作、筛选器、批量菜单不溢出。
- 保留现有后台风格，但减少单一色系块面，用少量功能色区分 AI、安全、联动、业务。

## 回归范围

- `tests/admin-codex-handler.test.js`
- `tests/admin-ai-health-status.test.js`
- `tests/admin-shell.test.js`
- `tests/admin-command-center.test.js`
- `tests/admin-analytics-progressive-tabs.test.js`
- `tests/admin-local-smoke-script.test.js`
- `tests/admin-tickets-ui.test.js`
- `tests/admin-chat-progressive-session.test.js`
- `npm run smoke:admin-local`
- `node scripts/admin-local-smoke.js --module homepage --timeout-ms 90000 --virtual-time-budget-ms 120000`
- `node scripts/admin-local-smoke.js --module gallery --timeout-ms 90000 --virtual-time-budget-ms 120000`
- `node scripts/admin-local-smoke.js --module growth-center --timeout-ms 180000 --virtual-time-budget-ms 240000`
- `node scripts/admin-local-smoke.js --module analytics --timeout-ms 240000 --virtual-time-budget-ms 340000`
- `node scripts/admin-local-smoke.js --module points --timeout-ms 150000 --virtual-time-budget-ms 220000`
- `node scripts/admin-local-smoke.js --module settings --timeout-ms 150000 --virtual-time-budget-ms 200000`
- `node scripts/admin-local-smoke.js --module tickets --timeout-ms 120000 --virtual-time-budget-ms 180000`
- `node scripts/admin-local-smoke.js --module chat --timeout-ms 120000 --virtual-time-budget-ms 180000`
- `npm run smoke:admin-all`
