# Admin Studio Workbench 整改任务单

这份文档用于把 `Admin Studio` 工作台专项体检结论压成一份可以直接排期执行的整改任务单。

配套文档：

- [admin-studio-rebuild-roadmap.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-rebuild-roadmap.md)
- [admin-studio-issue-backlog.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-issue-backlog.md)
- [admin-studio-safe-rebuild-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-safe-rebuild-plan.md)
- [admin-studio-phase2-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase2-taskboard.md)
- [admin-studio-phase3-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-phase3-taskboard.md)

## 1. 这份任务单解决什么

这次专项体检暴露的不是单点 bug，而是四类问题同时存在：

- 高危安全边界没有完全收口
- 集中告警和实际处理工作台之间还存在断层
- 旧模块仍残留浏览器直写数据库 / RPC 的敏感路径
- 某些工作区已经可看，但还不能真正形成“进入即处理”的闭环

因此这份任务单不替代原来的三期路线图，而是补一层 `安全 + 工作台闭环 + 遗留写路径` 的专项收口。

## 2. 优先级总览

| 任务 ID | 任务名 | 优先级 | 建议负责人 | 预估工时 | 说明 |
|---|---|---|---|---|---|
| `WB-P0-1` | Verify Monitor 内部鉴权替换 | `P0` | 后端 / 平台 | `0.5-1 天` | 阻断 admin token 跨服务透传 |
| `WB-P0-2` | Prompts RLS 权限收口与单一权威迁移 | `P0` | 后端 / SQL | `0.5 天` | 修复 IaC 漂移型放权风险 |
| `WB-P1-1` | 集中告警面板纳入 Verify / Security 告警族 | `P1` | 后端 | `0.5 天` | 统一接警入口 |
| `WB-P1-2` | Verify / Audit Monitor 升级为可处理工作台 | `P1` | 前端 / 后端 | `1-1.5 天` | 从“监控面板”升级为“处理面板” |
| `WB-P1-3` | Shop 遗留库存 RPC 写路径收口 | `P1` | 前端 / 后端 | `1 天` | 统一走 `/api/admin/*` mutation |
| `WB-P2-1` | Comments 后台分页与真筛选 | `P2` | 后端 / 前端 | `1 天` | 避免历史问题脱离视野 |
| `WB-P2-2` | Verify Monitor 采样面板改 incident 视图 | `P2` | 后端 | `0.5-1 天` | 避免把最近 80 条当成全局真相 |
| `WB-P2-3` | Homepage `all` 语义显式化 | `P2` | 前端 | `0.5 天` | 去掉 `all -> cn` 误导语义 |
| `WB-P2-4` | Discounts 写路径服务端化 | `P2` | 前端 / 后端 | `0.5-1 天` | 读写模型统一 |

## 3. P0 安全专项

## `WB-P0-1` Verify Monitor 内部鉴权替换

目标：

- 去掉主站管理员 `Bearer` token 向外部 verify 服务的透传
- 改成真正的 server-to-server 内部鉴权

涉及文件：

- [server/api-handlers/admin/settings/verify-monitor-queue.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/verify-monitor-queue.js)
- [server/api-handlers/admin/settings/verify-monitor-quota.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/verify-monitor-quota.js)
- [server/index.js](/Volumes/chao/AI/xianyu_profit_calculator/server/index.js)
- [tests/admin-verify-monitor-proxy-settings.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-verify-monitor-proxy-settings.test.js)

要做的事：

1. 删除 `Authorization` 头的原样透传
2. 为 verify server 增加独立内部鉴权方案
3. 把 `requireAdminOrInternalAccess` 从“等同 requireAdmin”改成真实双通道校验
4. 为 quota / queue / monitor 代理补失败与拒绝访问测试

验收标准：

- 主站 admin token 不再出现在下游 verify 请求头里
- verify monitor 仍可正常读取额度和队列状态
- verify server 不能在无内部凭证时被任意探测

测试建议：

- `node --test tests/admin-verify-monitor-proxy-settings.test.js`
- 新增 verify server 内部鉴权测试

## `WB-P0-2` Prompts RLS 权限收口与单一权威迁移

目标：

- 消除 `prompts` 表权限定义冲突
- 明确只允许服务端受控写入

涉及文件：

- [supabase/prompts-schema.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/prompts-schema.sql)
- [supabase/schema.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/schema.sql)
- `supabase/migrations/*`
- [tests/admin-prompts-manage-handler.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-prompts-manage-handler.test.js)

要做的事：

1. 明确一个 schema 文件为权威来源
2. 新增迁移，显式删除 `Authenticated insert/update` 类策略
3. 把 `prompts` 写权限收口到 `service_role` 或受控 handler
4. 增加 RLS 策略形状回归测试

验收标准：

- 仓库内不再并存互相冲突的 prompts 写权限定义
- 登录普通用户无法直接写 `prompts`
- admin handler 现有流程不受影响

测试建议：

- 新增 prompts policy contract test
- `node --test tests/admin-prompts-manage-handler.test.js`

## 4. P1 工作台闭环专项

## `WB-P1-1` 集中告警面板纳入 Verify / Security 告警族

目标：

- 让 `verify_*` 和 `security_admin_login_anomaly` 真正进入统一分诊池

涉及文件：

- [server/api-handlers/admin/settings/ops-alert-monitor.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/ops-alert-monitor.js)
- [api/_lib/ops-alerts.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/ops-alerts.js)
- [tests/admin-ops-alert-monitor-settings.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-ops-alert-monitor-settings.test.js)

要做的事：

1. 为集中告警面板增加 `verify` 分类
2. 为集中告警面板增加 `security / audit` 分类
3. 对齐告警类型与工作台目标映射
4. 为新增分类补列表、统计和 case event 测试

验收标准：

- 验证额度、验证堆积、验证失败率、管理员登录异常都能在同一集中告警面板看到
- 值班人员不需要知道“告警源在哪个二级设置页”才能接单

测试建议：

- `node --test tests/admin-ops-alert-monitor-settings.test.js`

## `WB-P1-2` Verify / Audit Monitor 升级为可处理工作台

目标：

- 让 `verify-monitor` 和 `admin-audit-monitor` 从“只看面板”变成“可接手、可标记、可关闭”的工作区

涉及文件：

- [js/admin-workbench.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-workbench.js)
- [admin-config.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-config.js)
- `server/api-handlers/admin/settings/verify-monitor*`
- [server/api-handlers/admin/settings/admin-audit-monitor.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/admin-audit-monitor.js)

要做的事：

1. 为 verify / audit 面板补 case 或 note 结构
2. 支持从告警入口带上下文直接落到目标记录
3. 支持最小处理动作：
   - 认领
   - 标记观察中
   - 关闭 / 忽略
4. 把处理动作纳入 audit

验收标准：

- 从集中告警点击进入后可直接处理，不只是滚动到某个区域
- verify / audit 问题有明确处理状态，不再依赖口头交接

测试建议：

- 新增 workbench workspace behavior 测试
- 新增 verify / audit case handler 测试

## `WB-P1-3` Shop 遗留库存 RPC 写路径收口

目标：

- 去掉商城库存导入 / 释放里的浏览器直连 RPC
- 统一走服务端 mutation 和 audit

涉及文件：

- [js/admin-shop.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-shop.js)
- `server/api-handlers/admin/shop/*`
- [tests/admin-site-write-guards-contract.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-site-write-guards-contract.test.js)

要做的事：

1. 把 `doImport`、`doImportFromView`、`releaseReserve` 迁到 `/api/admin/shop/*`
2. 与现有 `callAdminMutation('import_inventory')` 路径合并
3. 统一写保护、权限和 audit 口径
4. 扩展 contract test，覆盖遗留入口

验收标准：

- 商城库存相关写动作都不再由浏览器直接 `rpc()`
- `all` 视图下继续禁止写入
- 导入和释放路径共享统一后端校验

测试建议：

- `node --test tests/admin-site-write-guards-contract.test.js`
- 新增 shop mutation handler 测试

## 5. P2 一致性与治理补齐

## `WB-P2-1` Comments 后台分页与真筛选

目标：

- 避免评论后台只看到最新一小段样本
- 让筛选和统计建立在完整查询空间上

涉及文件：

- [server/api-handlers/admin/comments/list.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/comments/list.js)
- [server/api-handlers/admin/comments/summary.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/comments/summary.js)
- [admin-comments.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-comments.js)

要做的事：

1. 给留言和 Prompt 评论列表增加服务端分页 / cursor
2. 把搜索和筛选尽量下沉到服务端
3. 让 summary 统计和列表口径一致

验收标准：

- 后台能访问旧评论，不再被 `limit(50/100)` 截断
- 筛选结果不再只针对当前样本生效

## `WB-P2-2` Verify Monitor 采样面板改 incident 视图

目标：

- 避免把最近 80 条日志误当成验证系统全貌

涉及文件：

- [server/api-handlers/admin/settings/verify-monitor.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/settings/verify-monitor.js)
- [tests/admin-verify-monitor-settings.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-verify-monitor-settings.test.js)

要做的事：

1. 明确区分 sample panel 和 incident view
2. 至少补一种更稳的聚合：
   - 按 job / verification 聚合
   - 按失败类型聚合
   - 按活跃时长聚合
3. 对外返回游标或时间窗口信息

验收标准：

- Verify monitor 不再给人“只看最近 80 条就是全量”的错觉
- 持续性故障能稳定浮现

## `WB-P2-3` Homepage `all` 语义显式化

目标：

- 去掉 `all -> cn` 的隐式回落

涉及文件：

- [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)

要做的事：

1. 明确 `all` 只读聚合态，或直接移除该选项
2. 不允许使用“全站”标签展示单站数据
3. 让首页模块和全局站点语义保持一致

验收标准：

- 运营不会再误把 `all` 当成真实全站视图
- 首页读取和编辑语义一致

## `WB-P2-4` Discounts 写路径服务端化

目标：

- 让折扣模块的读写路径统一到 admin handler

涉及文件：

- [admin-discounts.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-discounts.js)
- [server/api-handlers/admin/discounts/list.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/discounts/list.js)
- 新增 `server/api-handlers/admin/discounts/mutate.js`

要做的事：

1. 把启用 / 停用、删除、生成三类动作迁到服务端
2. 保持和 `discounts/list` 一样的权限与站点口径
3. 写入统一带 audit

验收标准：

- 折扣模块不再出现“读走 handler、写走浏览器直表”的混合结构
- 后续新增折扣策略时不必再碰前端直写逻辑

## 6. 建议执行顺序

建议不要按模块散打，而是按下面三个批次执行：

### Batch A：安全止血

1. `WB-P0-1`
2. `WB-P0-2`

完成标准：

- 不再有跨服务 admin token 透传
- `prompts` 权限定义收成单一口径

### Batch B：工作台闭环

1. `WB-P1-1`
2. `WB-P1-2`
3. `WB-P1-3`

完成标准：

- 集中告警面板能覆盖 verify / security
- verify / audit 进入后可直接处理
- shop 不再残留库存相关旧写路径

### Batch C：治理与一致性补齐

1. `WB-P2-1`
2. `WB-P2-2`
3. `WB-P2-3`
4. `WB-P2-4`

完成标准：

- 评论后台不再丢历史治理视野
- verify monitor 不再只靠样本视图支撑运维判断
- homepage / discounts 语义和写路径全部与主框架一致

## 7. 与现有路线图的关系

这份任务单建议按下面方式并入原路线图：

- `WB-P0-1` `WB-P0-2`：作为独立热修，不等待 Phase 2 / Phase 3
- `WB-P1-1` `WB-P1-2`：可视为 [admin-studio-safe-rebuild-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-safe-rebuild-plan.md) 里集中告警 / verify monitor 的后续闭环补齐
- `WB-P1-3` `WB-P2-4`：并入 Phase 2 的 `Shop / Payments` 与管理写路径收口
- `WB-P2-1`：并入 Phase 3 的 `Comments` 治理补齐
- `WB-P2-2`：作为 verify 运维面板二期增强，不必阻塞前两批任务
- `WB-P2-3`：并入 Phase 2 的首页站点语义收口

## 8. 最小验收清单

这批整改至少要补下面这些回归：

1. verify monitor 代理不再透传 admin `Authorization`
2. prompts 普通登录用户不能直接写入
3. 集中告警面板能显示 verify / security 事件
4. verify / audit 告警进入后可直接认领或关闭
5. shop 库存导入 / 释放不再从浏览器直连 RPC
6. comments 后台能翻页看到旧内容
7. homepage `all` 不再等同 `cn`
8. discounts 模块不再浏览器直写 `discount_codes`
