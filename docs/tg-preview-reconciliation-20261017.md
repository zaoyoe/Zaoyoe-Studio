# 2026-10-17 TG 本地预览恢复与来源核对

## 结论与范围

早先的 hover、USDT 多网络、支付弹窗、邮箱查单和后台顶部分栏仍保存在
`a8cb` 的 `codex/tg-payment-dialog-fees` 未提交工作中。预览切到
`c66d` 的 `codex/tg-operations-closure` 时，没有自动带入这些未提交文件。
两个工作区的 HEAD 都是 `6e322240721059eac6909d923cf61148077ef5c0`；
只比 HEAD 无法发现这类遗漏。本次已把 TG 配套代码合入 c66d，并保留操作闭环改动。

本记录为新增证据，不修改其他文档里的历史 PASS / NOT RUN。恢复后的页面与 API
仍是本地工作区状态，尚未提交、推送或部署，不是生产发布证据。

## 来源与可恢复备份

- 当前工作区：`/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator`
- 较早 TG 改动来源：`/Users/wangyongchao/.codex/worktrees/a8cb/xianyu_profit_calculator`
- 当前分支：`codex/tg-operations-closure`
- 唯一 origin：`https://github.com/zaoyoe/Zaoyoe-Studio.git`
- 基线：`6e322240721059eac6909d923cf61148077ef5c0`；恢复前与重启前均 fetch main，落后计数为 0。
- 合并前当前工作区快照：`refs/codex-backups/tg-preview-closure-20261017T030142Z`
  → `944c456ce8f2c22dd10f731e5d1b0670b92abffe`。
- 合并前较早工作区快照：`refs/codex-backups/tg-preview-previous-20261017T030142Z`
  → `4af057e692244880e3016932496272f4f1ec3add`。
- 备份及原 index、staged/unstaged 补丁、文件清单：
  `/Users/wangyongchao/.codex/backups/tg-preview-reconcile-20261017T030142Z`。

备份通过独立 Git index 制作，原工作区与暂存状态保留。备份对象已回读核对。
`node_modules` 是指向较早工作区依赖的本地符号链接，不属于恢复源码或发布清单。

## 恢复与保留的功能

| 范围 | 当前代码 |
| --- | --- |
| 用户页面 | 恢复按钮 hover/按压、网络图标、价格与通道费、确认订单、站内付款弹窗、取消与查询凭证保留 |
| USDT | 恢复 BSC/BEP20、TON、Polygon、TRON/TRC20；原生 USDT 精确金额、报价绑定与市场汇率配套 |
| 查单 | 恢复邮箱 + 查询密码；管理员按邮箱、订单号或 Telegram 用户名查询 |
| 后台 | 恢复订单查询、购买订单、兑换订单、兑换码、商品定价、上游服务六个分栏和自定义下拉框 |
| 操作闭环 | 保留用户关单、兑换码预览/再次确认、后台组合筛选、详情与核对记录、上游查询和状态核验 |
| 合并修复 | 消除重复预览 DOM ID、重复筛选表单、DOM 节点变成 `[object Object]`、迟到详情响应重新打开弹窗等问题 |
| 共享样式 | 支付弹窗规则移到 `css/cash-payment-dialog.css`，商城同时引入；原商城契约仍检查实际加载的完整 CSS |

人工到账审核统一走 `approve_fulfillment`：服务端重新核对渠道收款，要求操作者确认
未退款、未另行发货。旧 `approve_payment` 快捷入口在页面移除，API 返回
`payment_recheck_required`，最终追加 SQL 也拒绝旧捷径。历史“操作闭环补齐”
章节中原快捷审核的描述保留为历史；当前行为以此处及本次源码为准。

## 真实预览与浏览器检查

预览地址为 `http://127.0.0.1:8000/tg` 和
`http://127.0.0.1:8000/tg-admin.html`。本次启动器为
`/tmp/tg-preview-c66d-6xZCVU/server.cjs`，日志为同目录的 `server.log`。
TG 页面、21 个静态依赖和 TG API 来自 c66d；其他页面沿用 a8cb 的既有预览来源。

`/healthz` 与 `/__tg_preview_source` 暴露非敏感的 commit、分支、工作区来源、
working-tree 标识和文件 SHA256，且 `productionEvidence=false`。
两个页面 HTTP 200、响应 no-store，21/21 个静态文件的 HTTP 内容散列与 c66d 一致。
启动输出也列出 SHA 与来源。此处 SHA 是基线，实际恢复内容是工作区改动，不能当作已提交版本。

- 真实用户页：目录与价格成功加载，四个 USDT 网络可见，TON 切换后选中状态正确；
  浏览器计算样式确认 hover/按压变换，页面未出现横向溢出；无控制台错误或警告。
- 隔离后台：仅测试数据，写操作禁用；六分栏、USDT 筛选、详情、较强的支付审核弹窗正常。
  服务日志共 9 次请求，除模拟登录安全预检外均为 GET，业务写请求 0 次。验证后已停止隔离服务器。
- 用户登录真实后台后补验：六分栏正常，购买列表加载 20 条；USDT 筛选后返回 14 条且全部为 USDT。
  控制台无错误。此为真实只读页面验证，不是模拟结果。
- 真实订单“详情 / 处理”仍受数据库迁移阻塞：只读 REST 字段检查返回 PostgreSQL `42703`，
  明确显示 `tg_purchase_orders.closed_at` 不存在；费用字段、履约字段和审计字段的零行 GET 检查均成功。
  已补 API 的明确 `resolution_migration_required` 提示，缺字段时不降级开放处理动作。

真实后台截图选用无客户明细的订单查询页；隔离截图明确标注测试数据。
本轮未登录其他账户、提交真实订单处理、调用补发或退款、执行 worker 或更改业务开关。

## 自动化与证据边界

| 检查 | 结果 |
| --- | --- |
| TG、Gramix、USDT、local-preview 回归（恢复完成初次） | PASS：675 / 675，失败/取消/跳过 0 |
| 加入真实后台缺字段错误处理后的同一套回归 | PASS：677 / 677，失败/取消/跳过 0 |
| 涉及共享支付弹窗 / 商城样式的 16 个测试文件 | PASS：276 / 276，失败/取消/跳过 0 |
| `git diff --check` | PASS |
| HTML ID 唯一性 | PASS：用户页 133 个、管理页 135 个，无重复 |
| 预览静态文件来源核对 | PASS：21 / 21 |
| 用户提供的原 operations 结构校验 | 用户提供 PASS；并发/业务仍为 NOT RUN |
| 本次最终 reconciliation SQL 的数据库执行与校验 | NOT RUN |
| 真实购买/付款/关单/人工复核/并发/履约验收 | NOT RUN |
| 生产三条部署链 | NOT RUN |

TG 回归命令：

```sh
node --test --test-reporter=spec --test-force-exit tests/tg-*.test.js tests/gramix-client.test.js tests/payment-usdt-*.test.js tests/local-preview-server.test.js
```

共享样式套件按 `rg -l 'cash-payment-dialog|shop-page.css' tests` 选出的 16 个文件运行。
两组测试有重合，不能相加为去重后的测试总数。旧文档中的 909、1432、1469 等数字
属于其各自历史运行，不由本次局部回归重新背书。

证据目录：`/Users/wangyongchao/.codex/backups/tg-preview-reconcile-20261017T030142Z/verification`。
其中保留初次 675 项日志、最终 677 项日志、共享样式日志、HTTP 散列、浏览器证据、
隔离请求记录、数据库零行字段探测与截图。原始临时日志以 `/tmp/tg-reconcile-` 开头。

## SQL 依赖与当前待执行项

> 执行入口更正（2026-10-17）：用户运行 review_resolution 时遇到前置检查失败。请使用文末“前置检查失败后的事务化恢复”中的新文件；原第 10–12 项及先前三份文件清单保留为历史记录，不再直接按该顺序执行。

**Codex 本轮未执行 SQL。**已知当前数据库缺少 `closed_at`，因此不能把用户先前提供的
“TG operations structural checks passed; concurrent/business acceptance remains NOT RUN”
解释为本次组合版本已完成数据库验收。该结果只属于原 operations 结构检查。

SQL 目录绝对路径：
`/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/migrations`。
在基础 TG domain、worker、currency guard、Stars、purchase domain、USDT 迁移已经完成的前提下，
以下为恢复代码的依赖顺序。应由数据库管理员先核对已应用记录，补齐缺失项；
不是要求重跑已执行的历史迁移。较早迁移会替换同名函数，不能在最终 reconciliation 之后再覆盖。

| 顺序 | 迁移 / 随后对应结构检查 |
| --- | --- |
| 1 | `20261015_tg_purchase_z_fees.sql` / `20261015_verify_tg_z_purchase_fees.sql` |
| 2 | `20261016_tg_purchase_cancellation_expiry.sql` / `20261016_verify_tg_purchase_cancellation_expiry.sql` |
| 3 | `20261016_tg_purchase_usdt_native_pricing.sql` / `20261016_verify_tg_purchase_usdt_native_pricing.sql` |
| 4 | `20261016_payment_usdt_market_fx.sql` |
| 5 | `20261016_payment_usdt_network_selection.sql` |
| 6 | `20261016_tg_purchase_zpay_reconciliation.sql` |
| 7 | `20261016_tg_purchase_fulfillment_review.sql` / `20261016_verify_tg_purchase_fulfillment_review.sql` |
| 8 | `20261016_tg_order_email_query.sql` / `20261016_verify_tg_order_email_query.sql` |
| 9 | `20261017_tg_operations_closure.sql` / `20261017_verify_tg_operations_closure.sql`（用户已提供原结构检查结果） |
| 10 | `20261017_tg_purchase_review_resolution.sql`（包含当前缺失的 `closed_at`） |
| 11 | `20261017_tg_runtime_reconciliation.sql`（必须最后安装） |
| 12 | `20261017_verify_tg_runtime_reconciliation.sql`（最终组合结构/ACL 检查） |

本次新增的最终 reconciliation 保留费用快照、四网络不可变报价、原生 USDT、TON memo、
ZPay 独立查询证据、锁顺序与幂等；同时保护已关闭/已取消订单不能恢复支付或自动履约，
并阻止旧快捷审核绕过渠道收款复核。安装不回放订单、不退款，也不启用业务开关。

最终校验即使成功，输出仍是：

```text
TG reconciled runtime structural checks passed; concurrent/business acceptance remains NOT RUN
```

只读结构校验不能代替运行时 RPC、权限、并发以及真实收款和发货验收。
真实后台订单详情的迁移提示须在用户补齐迁移后另行复核；本轮不将它记录为通过。

## 最后一次重启与真实会话复核

在补入缺字段的明确错误处理后，再次 fetch `origin/main`，落后计数仍为 0，
677 项回归全部通过。已重启 8000 端口预览，浏览器自动恢复原管理会话；
真实订单详情显示“订单处理数据库迁移尚未生效，请先完成迁移后再查看详情。”，
不再以通用服务错误遮蔽原因。该检查仅证明提示及阻断生效，数据库问题仍未解决。

重启后的 21/21 个静态响应与源码散列一致；31/31 个 TG 运行文件的诊断散列
也与当前源码一致。真实管理页未出现控制台错误或警告，最终停留在无订单明细的
“订单查询”分栏，原登录会话及两个预览标签页均已保留。

追加证据文件（不覆盖先前验证结果）：

- `verification/tg-reconcile-tg-live-admin-final.log`：677 项最终回归。
- `verification/tg-preview-after-api-fix-evidence.json`：最后重启的 HTTP 资源和运行文件散列。
- `verification/real-admin-evidence.json`：真实登录、六分栏、USDT 筛选和迁移阻塞提示。
- `verification/tg-admin-restored-real-final.jpg`：真实登录后的六分栏截图。

恢复后的完整源码另存于同一备份目录下的 `reconciled-final-*` 子目录，
其 `manifest.json` 记录独立 Git 快照引用、提交和逐文件回读结果；
该备份不会移动当前分支或改变暂存区，不能替代正式提交和发布。

## 前置检查失败后的事务化恢复（2026-10-17 追加更正）

用户执行 `20261017_tg_purchase_review_resolution.sql` 返回：

```text
ERROR: P0001: TG purchase fulfillment review is not ready
CONTEXT: PL/pgSQL function inline_code_block line 7 at RAISE
```

这是首个 DO 块中既有 readiness 函数返回 false；新增 `closed_at` 的 ALTER 尚未运行。
该错误本身不能区分支付证明、唯一索引或权限哪个子项失败。代码复核确认，先前给出的
迁移顺序存在确定冲突：`20261017_tg_operations_closure.sql` 重新定义收款确认函数，
移除了 `fn_tg_purchase_payment_reconciliation_ready()` 检查的 `authenticated_query`
和 `checkout_trade_no` 标记；复核 readiness 依赖此结果，随后 resolution 被阻断。
因此原顺序即使之前的 fulfillment_review 已安装，也不能直接走通。
此前“前三份关键文件按顺序补齐”的建议不完整，本节更正该执行入口，保留原记录。

当前恢复入口：

`/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/migrations/20261017_tg_runtime_recovery.sql`

在已有基础费用、取消、多网络、worker 与 operations 表结构的数据库上，
由操作者在 SQL 编辑器**完整执行这一个文件，不选择中间片段**。它在同一事务内依次：

1. 检查所需表、字段、网络与 operations RPC、唯一履约索引；缺失则明确列出对象并中止。
2. 恢复 ZPay 独立查询证明及身份保护，使支付 readiness 的必要条件重新成立。
3. 安装带退款/交付确认的 fulfillment_review，保留原 readiness 与 ACL 门禁。
4. 安装 closed_at、订单处理与关闭保护。
5. 安装最终组合函数，保留四网络、费用快照、迟到付款、锁和幂等保护。
6. 执行原最终结构及权限断言；全部通过后才 COMMIT 和返回结果。

文件包含原三份文件所需逻辑；成功后无需再重复执行旧 resolution 或旧支付迁移。
如前置检查报告缺项，先按报错核对相应迁移，不删除或跳过断言。
最终独立复查仍可运行 `20261017_verify_tg_runtime_reconciliation.sql`，它是只读结构检查。

预期成功结果：

```text
TG runtime recovery committed; structural checks passed; concurrent/business acceptance remains NOT RUN
```

生成器 `scripts/build-tg-runtime-recovery.js` 只读写本地文件，不连接数据库。
它嵌入各来源的 SHA256，去掉内部事务边界和重复 schema reload，将原结构断言放在唯一
COMMIT 之前；结果 SELECT 放在 COMMIT 之后。`--check` 可检查生成文件是否与来源一致。
原迁移没有被改写，readiness 函数也没有被改成固定 true。

本轮证据：

- 8 项新增恢复契约测试，覆盖旧顺序冲突、恢复顺序、事务边界、最终定义、权限与业务写入边界。
- 定向回归 30/30 通过，失败/取消/跳过 0。
- 离线 pglast 解析：48 条 SQL 顶层语句、23 项 PL/pgSQL 解析项通过；未连接数据库。
- 完整 TG 回归 685/685 通过，失败/取消/跳过 0（与 30 项定向回归有重合）；日志及文件散列另存本次 `verification/runtime-recovery-*` 证据。
- 用户数据库中的恢复 SQL、独立结构复查和真实业务/并发验收仍为 NOT RUN。

结构测试和离线解析不验证真实数据库对象是否完整；只有操作者实际执行后的结果
能证明数据库迁移提交成功。本轮 Codex 未执行任何 SQL。


## 操作者执行结果与详情读取复查（2026-10-17 追加）

操作者本轮回报三份 SQL 依次返回：

| 文件 | 操作者回报 | 证据范围 |
| --- | --- | --- |
| `20261017_tg_runtime_recovery.sql` | `TG runtime recovery committed; structural checks passed; concurrent/business acceptance remains NOT RUN` | 恢复事务已提交，文件内结构及权限断言通过 |
| `20261017_tg_runtime_reconciliation.sql` | `success` | 组合迁移执行成功；该文件没有额外结果 SELECT，因此仅提示成功符合预期 |
| `20261017_verify_tg_runtime_reconciliation.sql` | `TG reconciled runtime structural checks passed; concurrent/business acceptance remains NOT RUN` | 独立结构及权限检查通过 |

以上 SQL 状态依据操作者提供的执行结果；Codex 未连接数据库执行 SQL。
前文 NOT RUN 是当时的历史状态，原样保留。本节补充操作者执行后的新证据。
恢复脚本已包含最终 reconciliation，成功后不需要为这些提示再重复执行迁移。

Codex 随后在现有已登录本地预览中刷新管理页，只读打开此前被迁移阻断的同一笔
已过期订单，确认订单详情及“处理记录（最近 50 条）”正常加载，
“订单处理数据库迁移尚未生效”提示消失。页面显示“支付核对 / 补发审核”、
“关闭未付款订单”和“保存核对记录”入口；本轮没有提交这些业务动作。
检查后关闭详情并返回空的“订单查询”面板，保留登录状态与两个预览标签页。

此次只读复查的无敏感信息证据：

`/Users/wangyongchao/.codex/backups/tg-preview-reconcile-20261017T030142Z/verification/post-runtime-recovery-admin-detail.json`

本次编辑前已 fetch canonical origin；HEAD 与 origin/main 均为
`6e322240721059eac6909d923cf61148077ef5c0`，落后计数 0。页面证据属于带本地改动的
预览，不是生产发布证据。本轮仅追加执行记录，不改运行代码、不重新执行既有测试。
此前 685/685 回归结果保持其原有测试范围。

当前状态：数据库恢复及结构检查为操作者回报 PASS；真实登录后的订单详情读取为
Codex 观察 PASS；真实关闭订单、人工审核/补发、支付回调及并发幂等验收仍为 NOT RUN。
操作入口可见不等于其业务动作已完成验收，不能据此宣称完整业务闭环。


## 购买订单单一入口与关闭受限说明（2026-10-17 追加）

本轮修复购买订单表中并列出现“处理订单 / 详情核对”和“详情 / 处理”的重复入口。
原因是恢复旧预览功能时保留了支付审核入口，同时新增了通用订单处理入口。
现在每行仅保留一个“详情 / 处理”；详情集中提供刷新、支付核对 / 补发审核与
适用订单的“关闭订单”入口。进入审核前会关闭通用详情，避免弹窗叠加。

关闭入口只负责进入原订单核对，不会直接提交关闭操作。对需人工处理、但服务端
尚不允许关闭的订单，审核页现在保留可见的禁用按钮，并显示服务端给出的原因。
符合关闭条件时，仍须填写有效备注，并确认未发货及收款/退款已妥善处理；
服务端 can_close、订单版本与并发控制保持原样。关闭不自动退款。

本轮修改范围：

- 运行页面：js/tg-admin.js、tg-admin.html；JS 资源版本更新为 20261017-order-actions-v2。
- 测试：tests/tg-admin-ui.test.js，新增 6 项覆盖单入口、受限关闭、有效关闭确认及终态限制。
- 本记录追加证据；未改动后端和 SQL。

验证结果：

- 定向回归 227/227 通过，失败/取消/跳过 0。
- 完整相关回归 691/691 通过，失败/取消/跳过 0；包含 TG、Gramix、USDT 及本地预览测试，和定向回归有重合，不能相加。
- JS 语法检查通过；修改后差异空白检查另存最终验证记录。
- 现有登录会话中，真实订单行仅出现一个“详情 / 处理”。进入详情后可见“关闭订单”，点击该入口仅打开审核核对页。
- 操作者截图中的人工复核订单支付已确认；原任务可能提交上游但暂无已记录的上游订单号。审核页关闭按钮可见且禁用，显示“当前不能关闭：原任务可能已提交上游，尚不能确认未发货……”等原因。没有修改这笔订单。
- 通过 HTTP 比较本地页面及 JS 的 SHA256，实际服务文件与当前工作区完全一致。

完整回归命令：

```sh
node --test --test-reporter=spec --test-force-exit tests/tg-*.test.js tests/gramix-client.test.js tests/payment-usdt-*.test.js tests/local-preview-server.test.js
```

编辑前再次 fetch canonical origin，HEAD 与 origin/main 均为
`6e322240721059eac6909d923cf61148077ef5c0`，落后计数 0。预览来源为当前工作区，包含未提交改动，
productionEvidence=false。本轮未部署、未执行 SQL、未提交真实关闭/补发/核对记录操作。
真实业务及并发验收仍为 NOT RUN；测试通过和入口可见不替代业务验收。

编辑前文件副本、修改后文件散列、测试日志、服务来源与浏览器证据归档：

`/Users/wangyongchao/.codex/backups/tg-preview-reconcile-20261017T030142Z/verification/admin-actions-20261017T041618Z`

## 购买详情稳定加载与当前弹窗内关单（2026-10-17 追加）

本节记录对上一节交互的进一步修正。此前详情中的“关闭订单”仅进入另一审核弹窗，
名称容易让操作者误以为已提交关单；加载时只有一行文字，弹窗随最终内容大幅变高。
现在购买详情从加载开始即使用固定的响应式框架、固定标题栏及可滚动正文；
骨架屏沿用最终详情的字段顺序和双栏/单栏布局。加载失败时保留框架并提供重试，
已关闭的弹窗不会被迟到响应重新打开。

关闭核对保留在当前购买详情内：

- “核对关闭条件”只读查询原任务与服务端 eligibility，不提交关单。
- 只有 resolution.ready 和 can_close 同为 true，才展示关闭原因与两项确认。
- 实际提交按钮明确标记为“确认关闭订单”；要求 6–500 字原因、确认未发货、确认收款/退款处理方式，提交时锁定以避免重复请求。
- 请求使用本次核对返回的最新 updated_at；成功必须返回相同订单、closed 终态及有效 closed_at。随后更新当前详情，并刷新购买列表、履约列表和处理记录。
- 版本冲突、未知响应、错误订单号、缺关闭时间或状态未变均不得显示成功；需要重新核对。重新核对会清除上次勾选。
- 未付款订单原有的关闭流程、支付核对/补发审核及审计记录入口保留；未放宽后端关闭条件。

本轮只修改 js/tg-admin.js、css/tg-admin.css、tg-admin.html、tests/tg-admin-ui.test.js，
并追加本记录。管理页 JS/CSS 缓存版本为 20261017-order-dialog-v3。
未修改后端、未执行 SQL，也未对真实订单提交关单、补发或备注。

验证：

| 检查 | 结果 |
| --- | --- |
| 调整前旧 UI 契约初次运行 | 221/227；6 项失败，涉及旧的跳转交互预期及首个 textarea 选择器 |
| 补充当前弹窗内交互覆盖后的定向回归 | PASS：240/240，失败/取消/跳过 0 |
| 最终完整 TG、Gramix、USDT、local-preview 回归 | PASS：704/704，失败/取消/跳过 0；与定向回归重合，不能相加 |
| JS 语法检查 | PASS |
| 真实加载骨架屏与完成态尺寸 | PASS：两态均 x=19、y=59、width=674、height=760，正文无横向溢出 |
| 390×844 窄屏检查 | PASS：弹窗在视口内；正文可滚动且无横向溢出；滚动前后标题 top=13、bottom=81.5 一致，检查后恢复原视口 |
| 真实后台只读关闭核对 | PASS：原详情弹窗内显示受限原因与禁用的“确认关闭订单”，未打开第二个弹窗 |
| 当前页面控制台 error/warn | 0 |
| 真实关闭/补发/付款及并发业务验收 | NOT RUN |
| 生产部署 | NOT RUN |

截图中的人工复核订单当前仍未关闭。服务端明确返回“原任务可能已提交上游，
尚不能确认未发货”；原订单状态仍为人工复核。这是关闭条件未满足，页面现在会直接
说明原因；只读核对不改变订单状态。有效关单与列表同步路径已通过隔离自动化测试，
不能把这些测试当作这笔真实订单已关闭的证据。

预览仍来自 c66d 当前工作区；基线 HEAD/origin/main 为
6e322240721059eac6909d923cf61148077ef5c0，编辑前 fetch 落后计数 0。
HTTP 页面、JS、CSS 的 SHA256 与当前文件逐一相等，Cache-Control 为 no-store。
sourceMode=working-tree、productionEvidence=false，因此不代表生产版本。

编辑前可恢复文件副本及散列、最终文件、阶段与最终日志、源差异、HTTP 散列、
加载态/完成态/受限态/窄屏截图和浏览器尺寸证据归档：

`/Users/wangyongchao/.codex/backups/tg-preview-reconcile-20261017T030142Z/verification/admin-dialog-20261017T042842Z`


## 原上游补录与明确未受理凭据结案（2026-10-17 追加）

本节追加本次实现与验证结果，保留前面所有历史记录。新增两条恢复路径：

- 补录原 Gramix UUID 后由服务端独立 GET，核验原提交标识、接收人、商品权益、提交币种和归属；确认时重新查单，按购买单与原任务两个版本原子关联，并保存恢复记录。
- 登记上游客服/工单或原请求明确拒绝凭据后结案：要求原请求、明确未受理且不会发货、未发货和收退款四项确认；完整反查只用于排除矛盾，不能替代人工留档的明确答复。凭据、取消原任务、关闭购买单和审计在同一事务写入。

原幂等键、提交时间、尝试次数、历史尝试、付款时间和收款事实保持可核对。
恢复不会重新 buy；关闭不会自动退款。补录 completed/processing/failed 分别进入
succeeded/retry_waiting/failed。retry_waiting 仅轮询已关联原单。
原标识缺失、权益不一致、查询不完整、关联缺失、超时、版本变化或工作租约冲突均拒绝提交。
响应丢失使用同一操作编号与请求内容重试；恢复凭据只追加。

实现文件为 server/tg/purchase-recovery.js、购买管理 handler、管理页 JS/CSS/HTML、
增量 migration/verify、readiness 文件清单和恢复测试。另修复公共购买状态对 closed 的投影，
补充关联失败原单后关闭核对控件解锁、关闭时间确认和迟到旧详情保护。
管理页资产版本为 20261017-upstream-recovery-v4。
操作手册：docs/tg-purchase-upstream-recovery.md。

数据库前置为已有 purchase review resolution 就绪；本轮 SQL 留给操作者依序手动执行：

1. supabase/migrations/20261017_tg_purchase_upstream_recovery.sql
2. supabase/migrations/20261017_verify_tg_purchase_upstream_recovery.sql

第二份只读验证预期为：

```text
TG upstream recovery structural checks passed; concurrent/business acceptance remains NOT RUN
```

本轮没有执行上述 SQL，故该输出是预期值，不是已取得的数据库证据。
真实后台只读检查已确认新入口存在，并显示“上游订单恢复迁移尚未生效，请先执行迁移及只读验证”。
人工复核问题订单未被补录或关闭；未提交真实备注、补发、退款或结案操作。

| 检查 | 本轮结果 |
| --- | --- |
| 最终完整 TG / Gramix / USDT / local-preview 自动化回归 | PASS：804/804；失败、取消、跳过、todo 均为 0 |
| 管理页及新增服务、handler、readiness 的 JS 语法检查 | PASS |
| git diff --check | PASS |
| 预览重启后的来源 | 当前 c66d 工作区；HEAD=origin/main=6e322240721059eac6909d923cf61148077ef5c0，fetch 后落后计数 0 |
| 预览静态与运行文件 | TG 用户/管理 HTML、JS、CSS 的 HTTP 内容与工作区逐一相等；32 个运行文件散列一致，包含 purchase-recovery.js；Cache-Control=no-store |
| 真实后台只读入口 | PASS：新恢复入口和迁移待执行提示均可见；未暴露可写恢复表单 |
| 隔离合成页面双表单 | PASS：未核验时确认禁用；只读核验后允许确认；凭据结案展示四项确认 |
| 390×844 隔离凭据表单 | PASS：弹窗 x=19、y=12、width=352、height=820；正文 scrollWidth=clientWidth=350；滚动前后标题 top=13、bottom=81.5 不变；检查后恢复视口 |
| 真实后台及隔离页面控制台 error/warn | 0 |
| 增量迁移执行和只读数据库结构验证 | NOT RUN |
| 数据库并发、worker 竞争、真实补录/结案及用户状态验收 | NOT RUN |
| 真实支付、退款、补发与生产部署 | NOT RUN |

完整回归命令（其结果不可与以前回归数累加）：

```sh
node --test --test-reporter=spec --test-force-exit tests/tg-*.test.js tests/gramix-client.test.js tests/payment-usdt-*.test.js tests/local-preview-server.test.js
```

预览运行入口仍为 /tmp/tg-preview-c66d-6xZCVU/server.cjs，TG 来自 c66d，其他页面保留 a8cb 来源。
重启进程为 95405；启动日志包含 commit SHA。/__tg_preview_source 标记
sourceMode=working-tree、workingTreeDirty=true、productionEvidence=false。
工作区中的未提交内容仍不代表生产版本。
隔离测试站点仅绑定 127.0.0.1:8013，使用合成账号、订单和响应，没有真实后端代理；
仅提交 inspect_upstream_order / inspect_nonacceptance，未点击任何确认写入按钮，检查后关闭测试页与服务。

编辑前完整可恢复备份及散列、最终改动清单与散列、完整测试日志、HTTP/运行文件散列、
预览来源、真实只读提示截图、隔离表单/窄屏截图与尺寸证据归档于：

/Users/wangyongchao/.codex/backups/tg-purchase-recovery-20261017T045515Z

before.tar.gz / before-manifest.json 是修改前备份；验证记录位于 verification/。
数据库与真实业务状态保持 NOT RUN，不以静态契约、合成页面或本地预览替代。


## 2026-10-17 TG 管理导航改为 KC 风格窄图标栏（本地预览）

用户确认需要 KC 自动充值后台的窄图标栏交互。本轮在最新 origin/main
6e322240721059eac6909d923cf61148077ef5c0 的 c66d 工作区上完成导航调整，
fetch 后 HEAD 落后计数为 0。修改前备份已存在并逐文件读回验证。

- 桌面及平板（宽度至少 621px）默认固定 72px 图标栏；悬停、键盘聚焦或菜单按钮展开至 232px，覆盖正文。
- 图标按查询、订单管理和业务配置分组，保留分隔线、选中高亮和原有按钮反馈；展开显示模块名称。
- 手机使用 232px 抽屉，遮罩关闭、Esc、焦点循环和鉴权失效清理保留。
- 六模块复用原有 DOM；切换后保留搜索、筛选和未提交表单。
- 管理页 CSS/JS 资源版本为 20261017-kc-icon-rail-v2。

| 检查 | 本轮最终结果 |
| --- | --- |
| 管理页 UI 与页面契约定向回归 | PASS：133/133，失败、取消、跳过、todo 均为 0 |
| TG / Gramix / USDT / local-preview 完整相关回归 | PASS：810/810，失败、取消、跳过、todo 均为 0 |
| 先前 804 项最终回归的具名用例保留 | PASS：无缺失；本轮增加 6 个导航行为用例 |
| HTML 嵌套、145 个唯一 ID、六模块容器关系 | PASS |
| 712px 默认视口 | PASS：侧栏 72px，展开至 232px；正文 x=93.359375、width=597.28125 均不变；页面无横向溢出 |
| 六模块真实浏览器只读切换 | PASS：每次仅显示对应 panel，焦点转入正文；测试输入保留，验证后清除 |
| 390×844 手机视口 | PASS：抽屉 width=232；Tab/Shift+Tab 焦点循环；Esc 返回菜单按钮，释放背景锁；选择模块后关闭抽屉 |
| 1280×900 宽屏 | PASS：默认侧栏 72px，正文 width=1131.203125；键盘聚焦展开、方向键切换和 Esc 收起正常 |
| 浏览器视口 | 已恢复用户默认视口，停留订单查询模块 |
| 管理页控制台 error/warn | 0 |
| 六个 TG 用户/管理 HTML、CSS、JS 的 HTTP 内容 | PASS：与 c66d 文件逐一相同，Cache-Control=no-store |
| git diff --check 与管理脚本语法检查 | PASS |
| 数据库迁移、并发、真实支付/退款/补发/结案 | NOT RUN；本轮仅修改导航，不产生新的业务验收证据 |
| 生产部署 | NOT RUN |

完整相关回归仍使用上一节同一命令，810 是本轮最终运行总数，不与此前结果累加。
中间导航迭代日志的 779 项不是本轮最终结果；最终 810 项包含上一轮 804 项的全部具名用例，
比对记录保存于 verification/test-coverage-comparison.json。

预览继续复用双源服务 /tmp/tg-preview-c66d-6xZCVU/server.cjs：TG 来自 c66d，
其他页面保留 a8cb；静态文件实时读取，浏览器已刷新。sourceCommit 仍为上述 SHA，
sourceMode=working-tree、workingTreeDirty=true、productionEvidence=false。

本轮备份与证据：
/Users/wangyongchao/.codex/backups/tg-admin-drawer-20261017T053640Z

before.tar.gz / before-manifest.json 保留修改前文件；after.tar.gz / after-manifest.json
保存完成状态；verification/ 包含本轮变更补丁、测试日志、来源与 HTTP 散列、
模块切换记录，以及默认窄栏、展开与手机抽屉截图。


## 2026-10-17 TG 管理内容区移除重复标题（本地预览）

在 c66d 工作区（HEAD / origin/main 均为
6e322240721059eac6909d923cf61148077ef5c0，fetch 后落后计数为 0）
移除六个管理模块外层的 TELEGRAM OPERATIONS、大标题与说明，保留卡片内的业务标题。
正文直接从功能卡片开始，桌面卡片与顶栏间距为 32px。
刷新按钮移至右上角，随管理会话显示；原有操作结果与错误反馈保留，改为右下角浮层，
空提示不占空间。CSS/JS 资源版本为 20261017-compact-workspace-v3。

| 检查 | 本轮结果 |
| --- | --- |
| 管理页 UI 与页面契约定向回归 | PASS：133/133；失败、取消、跳过、todo 均为 0 |
| 六模块真实浏览器只读切换 | PASS：每次只显示对应模块，无外层重复标题 |
| 默认 712px 与手机 390px 视口 | PASS：无横向溢出，手机顶栏按钮无重叠 |
| 右上角刷新入口 | PASS：忙碌态结束后恢复可用，结果提示保留 |
| HTML ID | PASS：143 个唯一 ID，无重复 ID，仅一个刷新入口 |
| 浏览器控制台 error/warn | 0 |
| 六个 TG 用户/管理 HTML、CSS、JS 的 HTTP 内容 | PASS：与 c66d 文件一致 |
| 管理脚本语法与 git diff --check | PASS |
| 完整 TG 相关回归、并发、数据库及真实订单业务验收、生产部署 | 本轮 NOT RUN；不替代此前各轮结果 |

继续复用现有双源预览服务，静态文件实时读取，已刷新登录后的管理页并恢复默认视口。
来源诊断仍为 working-tree、workingTreeDirty=true、productionEvidence=false。
本轮备份、增量补丁、测试日志、HTTP 散列与浏览器截图保存于：

/Users/wangyongchao/.codex/backups/tg-admin-content-heading-20261017T060051Z


## 2026-10-17 TG 管理筛选控件、刷新反馈与模块骨架（本地预览）

在 c66d 工作区继续完成本地界面优化。完成前重新 fetch canonical origin/main，
HEAD 与 origin/main 均为 6e322240721059eac6909d923cf61148077ef5c0，落后计数为 0；
分支为 codex/tg-operations-closure。本轮没有提交或生产部署，现有业务改动保持在工作区中。

- 购买订单、兑换订单和兑换码批次的文本框、日期框、下拉框统一为 42px 高、10px 圆角，字体、内边距和边框一致。
- 三处“筛选 / 重置”改为并排等宽、同高按钮，保留主次层级和 hover / focus 反馈。
- 初始骨架按记住的六个业务模块分别展示，复用对应网格和卡片布局；同步筛选控件、日期框及按钮占位。
- 新增 js/tg-admin-shell.js，在鉴权依赖加载前读取非敏感模块偏好，避免先显示查询骨架再跳转到当前模块。
- 初次请求全部 settle 后才展示工作区；其中鉴权失败不会被稍后返回的请求重新显示为可用页面。
- 移除普通刷新时的“正在更新数据…”与“数据已更新”浮层，业务操作结果和错误提示保留。
- 右上刷新按钮为 36×36px 细线图标按钮，提供 hover、键盘焦点、旋转忙碌态及防重复点击。
- 管理页资源版本为 20261017-controls-refresh-v5。本地双源 launcher 已补映射新 shell 文件并重启。

| 检查 | 本轮最终结果 |
| --- | --- |
| TG / Gramix / USDT / local-preview 全部相关回归 | PASS：813/813；失败、取消、跳过、todo 均为 0 |
| 与此前 810 项完整回归比较 | PASS：原有用例全部保留，增加 3 项首屏加载与鉴权行为用例 |
| 712×878 默认视口 | PASS：三类筛选表单的骨架和实际 x/y/宽/高一致，所有筛选控件及按钮均为 42px 高 |
| 购买订单筛选区（默认视口） | PASS：骨架与实际均 x=122.359375、y=200、width=539.28125、height=228 |
| 兑换订单筛选区（默认视口） | PASS：骨架与实际均 x=122.359375、y=201、width=539.28125、height=202 |
| 兑换码生成及批次区（默认视口） | PASS：生成表单高度 398.3984375；批次筛选高度 148；骨架与实际均一致 |
| 390×844 手机视口 | PASS：单列表单的骨架与实际高度均为 682；全部筛选控件 42px，两个操作按钮各宽 154px；无横向溢出 |
| 1280×900 宽屏视口 | PASS：购买订单筛选骨架与实际高度均为 148；控件保持 42px 高；无横向溢出 |
| 普通刷新 | PASS：忙碌时 aria-busy=true 且禁用；完成后 aria-busy=false 并恢复可用；无普通刷新浮层 |
| 浏览器控制台 error/warn | 0 |
| HTML ID | PASS：142 个 ID 全部唯一 |
| 8 个 TG 用户/管理核心静态文件 HTTP 内容 | PASS：200、与 c66d 文件散列一致、Cache-Control=no-store，包含新 shell 脚本 |
| 两个管理脚本语法检查与 git diff --check | PASS |
| 数据库迁移、并发、真实支付/退款/补发/结案验收 | NOT RUN；本轮为界面与只读预览核验，不替代此前业务证据 |
| 生产部署 | NOT RUN |

本轮最终回归命令（不带强制退出参数）：

```sh
node --test --test-reporter=spec tests/tg-*.test.js tests/gramix-client.test.js tests/payment-usdt-*.test.js tests/local-preview-server.test.js
```

中间一次带 --test-force-exit 的运行仅报告 778 项，未作为完整回归通过证据；
最终不带该参数的运行完成 813 项，并按具名用例及出现次数确认此前 810 项无缺失。
单独运行 tg-purchase-recovery.test.js 为 74/74，通过记录一并保留。
以上总数不与此前各轮结果累加，不修改历史 NOT RUN / PARTIAL 记录。

骨架对齐的是卡片、表单、筛选行和表头结构；列表使用三行占位，最终总高度随真实记录数量变化。
手机及宽屏临时视口已恢复用户默认尺寸。预览继续使用双源服务：TG 来自 c66d，
其他页面保留 a8cb。来源诊断为 sourceMode=working-tree、workingTreeDirty=true、
productionEvidence=false，sourceCommit 为上述 HEAD；本地预览不作为生产证据。

修改前备份、最终文件、增量补丁、测试日志、HTTP 来源及散列、浏览器尺寸和截图保存于：

- /Users/wangyongchao/.codex/backups/tg-admin-loading-refresh-20261017T060940Z
- /Users/wangyongchao/.codex/backups/tg-admin-filter-controls-20261017T062939Z


## 2026-10-17 TG 订单详情、对账分组与加载态（本地预览）

本轮继续在 c66d 工作区、codex/tg-operations-closure 分支完成本地界面优化。
完成前重新 fetch canonical origin/main，HEAD 与 origin/main 均为
6e322240721059eac6909d923cf61148077ef5c0，落后计数为 0。
管理页资源版本为 20261017-detail-polish-v6；本轮没有提交或生产部署。

- 移除查询区“管理员无需用户查询密码。旧订单未绑定邮箱时，请使用订单号或 Telegram 用户名查询。”和“请选择订单类型并填写查询信息。”；空 live status 不占空间，真实查询结果和错误提示仍保留。
- 兑换详情按“订单概览 / 上游核对 / 人工处理或核对记录 / 处理记录”分组；购买详情按“订单概览 / 支付与履约 / 关闭订单 / 原上游订单恢复 / 核对记录 / 处理记录”分组。刷新归入概览，业务入口放在所属卡片内。
- 详情与支付审核的业务按钮统一为 40px 高、9px 圆角，保持主操作、次操作、危险操作、禁用及键盘焦点的视觉层级；手机尺寸下操作按钮与相应骨架占满所在行。
- 购买、兑换详情共用分组骨架和稳定弹窗外框；加载与失败重试沿用同一框架。兑换详情补齐鉴权、提交中保护、详情版本校验和 aria-busy，过期响应不能覆盖新详情或解除其加载态。
- 处理记录改为时间线，将事件、时间、备注和处理人分开；常见购买支付、发货、上游恢复事件及四类标准支付原因显示中文，自定义备注优先，未知事件或原因保留原值，不修改底层审计数据。
- 窄屏下关联履约单、上游订单号、原履约任务等长单号整行展示；骨架调用相同字段布局，避免长单号碎行以及真实操作区和骨架高度不一致。
- 保留支付核对、人工复核、关闭条件核对、原上游单补录和未受理凭据等原有流程；未通过点击验证业务提交。

| 检查 | 本轮最终结果 |
| --- | --- |
| TG / Gramix / USDT / local-preview 全部相关回归 | PASS：816/816；失败、取消、跳过、todo 均为 0 |
| 定向页面与交互回归 | PASS：160/160；是全量相关回归的子集，不累加 |
| 与此前 813 项完整回归比较 | PASS：按具名用例及出现次数核验，无缺失，新增 3 项详情异步行为测试 |
| 712×878 默认视口详情外框 | PASS：加载与实际均 x=19、y=59、width=674、height=760 |
| 默认视口兑换前三个固定分组 | PASS：概览高 206、上游核对高 375、核对记录高 285.5，骨架与实际 x/y/宽/高均一致 |
| 默认视口购买前两个固定分组 | PASS：概览高 401、支付与履约高 149，骨架与实际 x/y/宽/高均一致 |
| 390×844 手机视口详情外框 | PASS：加载与实际均 x=19、y=12、width=352、height=820 |
| 手机视口购买固定分组 | PASS：概览高 503、支付与履约高 193，骨架与实际 x/y/宽/高均一致；核对记录自身高度均为 281.5 |
| 按钮与溢出 | PASS：默认及手机视口显示的业务按钮均为 40px 高、9px 圆角；页面及详情内容无横向溢出 |
| 手机内部滚动 | PASS：内部 scrollTop=844 时，关闭详情按钮仍位于顶部且可见；临时视口已恢复默认尺寸 |
| 查询提示移除 | PASS：两段文字均未出现；空查询状态 display=none，无横向溢出 |
| 浏览器控制台 error/warn | 0 |
| TG 用户/管理 11 个核心静态资源 | PASS：HTTP 200、内容散列与 c66d 工作区一致、Cache-Control=no-store |
| 管理脚本语法与 git diff --check | PASS |
| 数据库迁移、并发及真实支付/关闭/退款/补发/结案验收 | NOT RUN；本轮仅界面与只读查看，不替代业务验收证据 |
| 生产部署 | NOT RUN |

完整相关回归命令：

```sh
node --test --test-reporter=spec tests/tg-*.test.js tests/gramix-client.test.js tests/payment-usdt-*.test.js tests/local-preview-server.test.js
```

新增行为测试分别验证兑换详情骨架与实际分组、只读上游查询失败后保留查询参数重试、
旧兑换响应不能覆盖新详情或清除其 busy 状态。原关闭订单历史断言跟随中文事件显示调整，
仍验证关闭事件及原关闭备注；未删除业务安全断言。816 项最终运行未使用强制退出参数。

加载骨架对齐固定概览、上游/支付区域及记录表单；关闭订单、上游恢复、人工处理等卡片
依据订单状态和上游结果出现，处理记录长度取决于真实数据，故不将整个动态内容高度描述为完全一致。
继续使用现有双源预览：TG 来自 c66d，其他页面保留 a8cb。来源诊断为
sourceMode=working-tree、workingTreeDirty=true、productionEvidence=false，
sourceCommit 为上述 HEAD；工作区界面预览不作为生产证据。

修改前备份已逐文件散列核验，历史文档保持原内容并仅追加本节。最终文件、增量补丁、
测试日志及用例比较、HTTP 来源和散列、浏览器尺寸、控制台和截图保存于：

/Users/wangyongchao/.codex/backups/tg-admin-detail-polish-20261017T064623Z


## 2026-10-17 弹窗关闭、单层聚焦与兑换码尾号直点复制（本地预览）

本轮在 c66d 的 codex/tg-operations-closure 工作区继续修改，开始前重新 fetch canonical
origin/main，HEAD 与 origin/main 均为 6e322240721059eac6909d923cf61148077ef5c0，
落后计数为 0。管理页资源版本为 20261017-copy-toast-v8；来源模式仍为 working-tree，
workingTreeDirty=true、productionEvidence=false。TG 静态和 API 保持来自 c66d，其他页面
保留 a8cb 的既有双源预览。本轮未提交、推送或生产部署。

上一版 20261017-dialog-copy-v7 增加三个原生弹窗的遮罩点击关闭、表单单层聚焦边框，
以及受鉴权和严格审计约束的单码恢复接口。此前 816 项回归全部保留，增加 16 项，
最终相关回归 832/832、定向 179/179。恢复接口使用原有加密数据，无迁移；只有审计
成功才返回完整码，审计不含明文、密文或摘要。该版本在复制后展开原码、失败时提供
手动选中输入框，是用户后续要求变更前的行为，不能描述为当前交互。

当前版本只展示兑换码尾号，点击即可复制完整码；不再显示“查看并复制”、展开原码、
“已复制”行内文字或表格下方的成功提示。悬停只变色并下压 1px，按下下压 2px，
背景透明、无边框或阴影。复制成功后在浏览器底部居中显示带勾图标的胶囊，文字为
“复制成功”，上浮进入、约 2.4 秒隐藏，重复复制重置计时，不抢焦点；详情关闭会清理
提示，过期的读取或复制完成不能影响新详情。失败只提示剪贴板权限和重试，不展开原码。

| 检查 | 本轮最终结果 |
| --- | --- |
| TG / Gramix / USDT / local-preview 相关回归 | PASS：834/834；失败、取消、跳过和 todo 均为 0 |
| 定向管理 UI 和处理器测试 | PASS：181/181；为相关回归子集，不累加 |
| 与上一版 832 项比较 | PASS：按名称和次数比较；3 项随用户要求更新行为/标题，旧用例没有遗漏；新增 2 项异步复制和胶囊生命周期测试 |
| 真实批次复制 | PASS：现有已撤销批次，剪贴板符合完整 Premium 码格式及对应尾号；页面无完整码，未归档完整码 |
| 默认 712×878 视口 | PASS：复制前后表格 x/y/宽/高相同；胶囊宽 114、高 43.5，距窗口底部 24px |
| 悬停效果 | PASS：背景透明、border=0px、box-shadow=none；文字变为强调色并有轻微下压 |
| 390×844 视口 | PASS：弹窗宽 352，页面无横向溢出，表格在内部横向滚动；胶囊距底部 24px；完成后恢复默认视口 |
| 外侧关闭与清理 | PASS：详情关闭、内容清空、胶囊隐藏；生成未确认保存和提交中关闭保护由行为测试覆盖 |
| 浏览器控制台 warn/error | 0 / 0 |
| JavaScript 语法及 git diff --check | PASS |
| 实际生成/撤销、付款/退款、订单关闭/补发/结案及数据库并发 | NOT RUN |
| 生产部署 | NOT RUN |

完整相关回归命令：

```sh
node --test --test-reporter=spec tests/tg-*.test.js tests/gramix-client.test.js tests/payment-usdt-*.test.js tests/local-preview-server.test.js
```

首次定向测试新增的文本等值断言遇到模拟 DOM helper 拼接的前导空格，已按实际尾号
文本修正断言并重跑通过；首次浏览器截图取得过早，尚未完成异步读取，随后再次点击并
等待可见胶囊，确认实际复制完成。原失败和过程结果保留在备份中，未改写为成功。

本轮只修改管理页前端、对应 UI 行为测试和追加文档；单码恢复后端没有再次改动。
旧版备份继续保留：
/Users/wangyongchao/.codex/backups/tg-admin-dialog-copy-20261017T072156Z

当前修改前后文件、增量补丁、散列、测试日志与用例比较、浏览器证据、安全截图、
预览诊断及资源来源核对归档于：
/Users/wangyongchao/.codex/backups/tg-admin-copy-pill-20261017T074054Z


## 2026-10-17 批次使用率与撤销操作区核对（追加记录）

本轮按用户要求调整批次列表与详情；本地资源版本为 20261017-batch-usage-v9。
使用率 = 已成功兑换张数 / 实际生成张数，以百分比、数量与细进度条呈现；生成申请量
不作为分母。零生成安全显示 0%，缺失、负数或不一致的统计显示“—”。新增列、空态
和兑换码分栏的加载骨架保持七列顺序一致，沿用原 API 统计字段，没有后端或 SQL 变更。

详情按钮与表格之间增加独立 24px 留白，复制反馈是否隐藏均不影响间距。撤销成功不再
显示右下角“撤销操作已完成”，继续刷新批次列表与当前详情；失败仍显示错误。
前序尾号点击复制、底部“复制成功”胶囊、弹窗外关闭和单层聚焦样式均保留。

| 检查 | 本轮最终结果 |
| --- | --- |
| 最新 main 基线 | HEAD = origin/main = 6e322240721059eac6909d923cf61148077ef5c0；落后计数 0 |
| 本地静态来源 | c66d 工作区；五份实际 HTTP 资源均为 200/no-store，内容与当前文件散列一致 |
| 本地预览诊断 | sourceMode=working-tree、productionEvidence=false；静态/服务来源提交均为上述 SHA |
| 定向管理 UI 与处理器测试 | PASS：186/186；失败、取消、跳过和 todo 均为 0；为相关回归子集 |
| TG / Gramix / USDT / local-preview 相关回归 | PASS：839/839；失败、取消、跳过和 todo 均为 0 |
| 与上一版比较 | 前序 UI 用例保留；新增五项使用率、骨架、撤销成功刷新及失败错误测试；原批次操作列索引随新列调整 |
| 1440×1000 桌面 | 七列完整；页面及表格无横向溢出；详情表格与按钮间距 24px |
| 390×844 窄屏 | 页面无横向溢出，表格内部滚动；详情宽 352px，按钮间距仍为 24px |
| 默认视口恢复 | PASS：恢复 712×878，无页面横向溢出；保留管理页预览 |
| 真实统计与安全 | 四个现有批次均为零次成功兑换，显示 0%；只读检查，页面及截图没有完整兑换码 |
| 浏览器控制台 warn/error | 0 / 0 |
| JavaScript 语法及 git diff --check | PASS |
| 实际生成/撤销/兑换、付款/退款、订单关闭/补发/结案及数据库并发 | NOT RUN |
| SQL 执行及生产部署 | NOT RUN |

定向测试命令：

```sh
node --test --test-reporter=spec tests/tg-admin-ui.test.js tests/tg-handlers.test.js
```

完整相关回归命令：

```sh
node --test --test-reporter=spec tests/tg-*.test.js tests/gramix-client.test.js tests/payment-usdt-*.test.js tests/local-preview-server.test.js
```

首次定向新增的骨架断言错误匹配了导航上的 data-section=Codes，结果为 185/186；
将定位限定到骨架根节点后重跑为 186/186，随后完整相关回归为 839/839。首次失败日志
继续保留，不改写为成功。浏览器只读 DOM 镜像没有暴露原生 progress 的 IDL 值，随后
通过 max/value DOM 属性确认真实进度值正确；原始观察与属性核对同时归档。

本轮未重启现有双源预览；TG 静态/API 继续由 c66d 工作区提供，其他页面沿用 a8cb。
本地证据不能替代生产部署或并发/业务验收。修改前后的六个范围文件、相对本轮基线的
增量补丁、散列、测试日志、用例比较、安全截图和预览来源归档于：
/Users/wangyongchao/.codex/backups/tg-admin-batch-usage-20261017T080059Z


## 2026-10-17 查询清空、购买审核骨架与预览配置恢复（追加记录）

“清空查询”现在同时记录本标签页已清空的非敏感标记，刷新时不再从保存订单自动恢复
查询字段或发起旧查询；原订单记录仍保留，主动点击保存订单后仍可继续查看详情。
初始化和 pageshow 清理浏览器恢复的邮箱查询字段，pagehide 清理查询凭据；密码框使用
new-password 自动填充语义，避免被当作登录密码。

购买审核弹窗采用同一固定外框，标题和重新核对操作栏固定，中间区域滚动。请求期间
展示与结果对应的十二个基础字段、说明和操作占位，保留已知订单号；失败时撤下骨架，
保留错误和重新核对入口。占位不包含可提交的处理操作。

本次“TG 购买服务暂不可用”来自未加载运行配置的裸启动进程；源码目录仍是 c66d。
已恢复先前共享预览入口 /tmp/tg-preview-c66d-6xZCVU/server.cjs：TG 静态/API 使用
c66d，其他页面及既有运行配置沿用 a8cb。没有复制、修改或打印任何密钥。
该共享预览应使用现有入口启动；不要直接裸起 scripts/local-preview-server.js，
否则当前没有独立 .env 的 c66d 会再次缺失配置。

| 检查 | 本轮最终结果 |
| --- | --- |
| 最新 main 基线 | 再次 fetch；HEAD 与 origin/main 的落后计数为 0；源提交 6e322240721059eac6909d923cf61148077ef5c0 |
| 本地预览来源 | /__tg_preview_source HTTP 200；静态与服务提交均为上述 SHA；sourceRoot=c66d；productionEvidence=false |
| 静态资源 | /tg、/tg-admin.html、三份 TG JS 及管理页 CSS 共六份 HTTP 200/no-store，内容与工作区一致 |
| 购买查询配置 | 重启前 503；重启后无参数请求 400，合成订单/无效凭据请求 404“订单不存在或查询凭证无效” |
| 后台真实读取 | 登录会话正常，原购买订单查询及详情/核对均成功返回 |
| 清空后刷新 | 浏览器合成输入→清空→刷新；邮箱、密码、邮箱查询订单号及两组原订单号/凭证共七字段均为空；查询服务就绪 |
| 审核加载/完成态 | 默认 712×878 视口下均为 x=19、y=49、width=674、height=780；十二个基础字段对齐；页面无横向溢出 |
| 定向回归 | 七个文件全部通过、exit 0；本次使用 dot reporter，未单独归档精确用例总数 |
| 初次新增用例 | 初次 UI 运行 227 PASS / 2 FAIL；修正新测试中的错误 fixture 和 503 文案预期后通过，不将首次结果改写为 PASS |
| JavaScript 语法、HTML ID、差异空白检查 | PASS；tg.html 148 个 ID、tg-admin.html 190 个 ID，无重复 |
| 真实用户凭据的成功详情验收 | NOT RUN：当前用户标签页没有保存的真实订单凭据；鉴权错误恢复不等同于成功详情验收 |
| 实际付款、补发、关单、退款及并发验收 | NOT RUN |
| SQL 执行及生产部署 | NOT RUN |

通过的定向回归命令：

```sh
node --test --test-reporter=dot tests/tg-public-ui.test.js tests/tg-admin-ui.test.js tests/tg-pages-contract.test.js tests/tg-routing.test.js tests/tg-purchase.test.js tests/tg-handlers.test.js tests/tg-order-query.test.js
```

加载与完成态的浏览器截图分别保存于：
/tmp/tg-preview-c66d-6xZCVU/review-skeleton-20261017.png
/tmp/tg-preview-c66d-6xZCVU/review-ready-20261017.png

本轮范围文件修改前快照：
/var/folders/wl/8wb6rp_13z17vf97m3fkk0dw0000gn/T/tg-query-review-before-2mq_179c
本地工作区修改与运行配置恢复仅为本地预览证据，不代表生产发布。

## 2026-10-17 已完结 USDT 订单缺失历史账单的展示修正（追加记录）

针对 TGP-4DE0F3B36E854616BDE4，通过现有只读数据 API 核对：订单创建于
2026-10-16T00:19:31.176207Z，已于 2026-10-17T11:11:17.131010Z 完结，支付状态保留
manual_review。订单人民币计价 total_minor=1414，crypto_checkout 和 provider_trade_no
均为空，verified_payment 为空对象，关联历史汇率报价与网络报价 RPC 均未返回记录。
现有数据不能提供准确 USDT 金额或付款网络；数据库未保存记录也不等于已证明外部
渠道从未创建账单。历史 usdt_bep20 支付方式标识不能单独作为实际付款网络的证据。

原用户详情将所有缺少金额的 USDT 订单统一显示为“USDT 金额待渠道确认”，列表和
后台查询卡片则统一显示“USDT 金额见详情”，导致已完结订单仍像在等待报价。现将
已完结、人工核对、已付款、过期、取消等非等待创建账单的订单，在没有渠道金额时
显示“未记录 USDT 金额”，详情没有网络时显示“未记录网络协议”。待付款且尚未发货
的订单继续保留待渠道确认的提示；只有本地保存且尚未获取状态的卡片保留查看详情
入口文案。已有 crypto_checkout/crypto_payment 的历史订单继续展示保存的准确金额
与网络，支付弹窗也可使用历史 crypto_payment 的展示字段。

没有按当前汇率估算旧订单金额，没有修改订单状态或写入账单数据，没有执行 SQL。

| 检查 | 本轮结果 |
| --- | --- |
| 源基线 | fetch origin main 成功，HEAD..origin/main=0；HEAD=6e322240721059eac6909d923cf61148077ef5c0 |
| 修改前快照 | /Users/wangyongchao/.codex/backups/tg-usdt-history-20261017T143744Z/before；六份文件逐一散列校验通过 |
| 用户与后台 UI 回归 | 233 PASS / 0 FAIL |
| 九份相关测试回归 | 367 PASS / 0 FAIL / 0 SKIP，exit 0 |
| 预览来源和静态文件 | sourceCommit/serverSourceCommit 均为上述 HEAD；sourceRoot=c66d；三份修改 JS 均 HTTP 200/no-store 且与工作区逐字节一致 |
| 后台真实订单 | 原登录会话重新查询该订单，显示“人工核对 / 已完结”和“未记录 USDT 金额”；没有提交任何处理动作 |
| 用户详情 | 合成同状态订单与各类历史缺失/待付款/已有账单用例均通过；真实用户凭据的成功详情验收 NOT RUN，当前标签页没有该订单凭据 |
| JS 语法与差异空白 | PASS |
| 实际付款、退款、关单、补发、结案及数据库并发验收 | NOT RUN |
| SQL 执行及生产发布 | NOT RUN；本地 working-tree 预览，productionEvidence=false |

相关回归命令：

```sh
node --test --test-reporter=spec tests/tg-public-ui.test.js tests/tg-admin-ui.test.js tests/tg-pages-contract.test.js tests/tg-routing.test.js tests/tg-purchase.test.js tests/tg-handlers.test.js tests/tg-order-query.test.js tests/tg-admin-order-query.test.js tests/tg-payment-pricing.test.js
```

本轮改动限于 js/tg.js、js/tg-order-query.js、js/tg-admin.js、两份 UI 测试与本追加记录。
测试日志、来源诊断、修改前后快照、增量补丁及真实订单的安全截图保存在上述备份目录。
静态资源已由当前预览直接读取；没有重启服务或更改运行配置。


## 2026-10-17 支付宝与 USDT 切换过渡（追加记录）

支付卡片和网络按钮在选项清单不变时保留原 DOM，仅更新选中态和可用状态，避免
重建节点打断边框、背景、勾选动画或键盘焦点。支付卡片的选中底色使用透明度过渡。
USDT 网络区域采用 320ms 的网格高度过渡，配合透明度和轻微位移；隐藏时立即设置
inert 与 aria-hidden，快速反向切换由 CSS 从当前进度继续。金额文本立即更新，通过
轻微淡入展示新金额；金额容器按实测高度过渡，减少说明换行时按钮突然移动。再次
切换会取消前一次高度动画；系统启用减少动态效果时跳过金额动画，CSS 过渡也关闭。

| 检查 | 本轮结果 |
| --- | --- |
| 源基线 | 本轮 fetch origin main 成功，HEAD..origin/main=0；HEAD=6e322240721059eac6909d923cf61148077ef5c0 |
| 修改前快照 | /Users/wangyongchao/.codex/backups/tg-payment-motion-20261017T144754Z/before；四份文件逐一散列校验可读 |
| 用户 UI、页面契约、金额计算回归 | 66 PASS / 0 FAIL / 0 SKIP，exit 0 |
| 桌面浏览器 | 支付方式与金额切换正确；观察到高度、透明度、金额位移的动画中间值；卡片节点与焦点保持 |
| 快速反向与网络选择 | 键盘连续切换时网络区域从当前高度反向过渡；TON 在支付宝与 USDT 来回切换后仍被选中 |
| 窄屏浏览器 | 390×844 下网络按钮自动换为两行，documentWidth=scrollWidth=390；网络高度和金额排版适配；检查后已恢复视口 |
| 键盘与隐藏区域 | 支付宝选中后网络立即 inert/aria-hidden；从 USDT 卡片 Tab 直接到核对按钮，跳过隐藏网络按钮 |
| 减少动态效果 | 代码核对通过；浏览器系统偏好的实际切换 NOT RUN |
| 预览来源 | sourceCommit/serverSourceCommit 均为上述 HEAD；sourceRoot=c66d；tg.html、js/tg.js、css/tg.css 与工作区逐字节一致 |
| 实际下单、支付及其他订单写操作 | NOT RUN |
| SQL 执行及生产发布 | NOT RUN；本地 working-tree 预览，productionEvidence=false |

本轮测试命令：

```sh
node --test --test-reporter=spec tests/tg-public-ui.test.js tests/tg-pages-contract.test.js tests/tg-payment-pricing.test.js
```

本轮仅修改 js/tg.js、css/tg.css、tg.html 和本追加记录。修改前后快照、增量补丁、
测试结果摘要、来源诊断和桌面/窄屏截图保存于本轮备份目录；未重启服务或修改运行配置。


## 2026-10-17 购买金额明细、选中样式、移动端支付与本地回调恢复（追加记录）

按最终确认的展示要求，应付金额下保留商品规格、商品金额和通道手续费三项，
桌面分为三列，窄屏按标签和值逐行对齐。手续费金额和费率独立排版；不再拼接
Gas、市场汇率或取整说明。支付宝与 USDT 卡片只显示图标和名称，移除通道副文案
及网络选择下的 Gas 提示。会员时长和支付卡片移除对勾及空心圆，保留选中边框、
底色、键盘操作和 aria-pressed。640px 及以下的支付卡片采用两列，骨架沿用同一布局。

首屏目录加载使用套餐价格、支付图标和名称、应付金额及三项明细的骨架，避免
在请求返回前显示“待公布／未开放”。真实关闭配置仍保留关闭状态；请求失败可
重试，重试请求锁定重复提交，重试按钮不受收件人必填校验阻断。后台汇率刷新
保留当前价格，失败后可恢复。没有可用支付方式时展示金额不可用，不保留永久骨架。

本地支付核对失败的原因为回调中继和旧临时隧道已经退出。已恢复 8012 中继，
重新启动现有 cloudflared 临时隧道，备份后更新本地既有运行配置的回调 origin，
并通过原共享入口重新启动 8000 预览。仅签名支付 webhook 与挑战式健康探测可从
隧道访问；后台页面、后台 API 与 catalog 的公网访问均返回 404。没有绕过回调
就绪检查；预检要求服务标识、健康状态和随机 challenge 全部匹配，拒绝离线 HTML
及旧挑战响应。生产仍使用原固定域名，不使用本地预览回调地址。

共享入口仍为 /tmp/tg-preview-c66d-6xZCVU/server.cjs：TG 静态和 API 源自 c66d，
其他页面与既有运行配置沿用 a8cb。修改的环境配置仅为本地回调 origin；修改前
文件保存在本轮备份目录且权限为 0600，未将密钥写入源码、日志或验收记录。

| 检查 | 本轮最终结果 |
| --- | --- |
| 最新 main 基线 | fetch origin main 成功；HEAD..origin/main=0；源提交 6e322240721059eac6909d923cf61148077ef5c0 |
| 修改前快照 | /Users/wangyongchao/.codex/backups/tg-payment-cleanup-20261017T145959Z/before；八份文件散列校验可读；新增卡片要求另存 before-card-layout |
| 首次四份定向测试 | 75 PASS / 0 FAIL / 0 SKIP；此结果产生于最终三项明细之前，仅作阶段记录 |
| 最终四份定向测试 | 77 PASS / 0 FAIL / 0 SKIP，exit 0 |
| 扩展至七份相关回归 | 123 PASS / 0 FAIL / 0 SKIP，exit 0 |
| 桌面骨架与实际尺寸 | 套餐均高 113.32px；支付卡片均高 65px；金额区均为 662×155.5px |
| 390px 骨架与实际尺寸 | 套餐均高 61px；支付卡片均高 63px；金额区均为 316×189px |
| 320px 窄屏 | 两张支付卡片各宽 118px、同一行；名称未截断；scrollWidth=viewportWidth=320 |
| 选中和支付切换 | 桌面与窄屏的对勾及圆圈节点数均为 0；支付宝／USDT 的选中状态、金额明细和四网络展开正确 |
| 预览来源与静态内容 | sourceCommit/serverSourceCommit 为上述 HEAD；sourceRoot=c66d；HTML/JS/CSS 均 HTTP 200/no-store 且与工作区逐字节一致 |
| 预览后端内容 | 36 份运行文件散列与服务启动时一致，无修改后未重启的后端文件 |
| 本地回调恢复 | 本地及公网挑战探测通过；真实 assertCallbackReady 触发一次公网探测并通过；三条非回调公网路径均 404 |
| JavaScript 语法及差异空白 | PASS |
| 实际下单、付款、到账、退款及并发业务验收 | NOT RUN；就绪探测不替代真实支付验收 |
| SQL 执行及生产部署 | NOT RUN；本地 working-tree 预览，productionEvidence=false |

最终相关回归命令：

```sh
node --test --test-reporter=tap tests/tg-public-ui.test.js tests/tg-pages-contract.test.js tests/tg-payment-pricing.test.js tests/tg-payment-callback-preview.test.js tests/tg-payment-gateway.test.js tests/tg-usdt-payment.test.js tests/tg-routing.test.js
```

测试日志、最终来源和回调诊断、运行文件一致性、排版尺寸、修改前后快照及增量补丁
保存在本轮备份目录。效果截图包括 payment-alipay-desktop.png、payment-usdt-desktop.png、
payment-alipay-mobile.png、payment-usdt-mobile.png、payment-alipay-320.png 及两份加载截图。
浏览器的临时响应式尺寸已恢复，保留用户页和已登录的管理页供继续查看。


## 2026-10-17 商品切换区文案精简

按用户要求移除 Premium 卡片的“3 / 6 / 12 个月”、Stars 卡片的
“按需购买，或兑换码领取”，以及商品切换区下方的说明段落。同步删除脚本中
动态写入该段落的逻辑与无引用的样式，切换 Premium／Stars、购买／兑换时
不会恢复旧文案。商品卡片保留图标、名称、选中状态和既有动画。

- main 新鲜度：git fetch origin main 成功，HEAD..origin/main=0。
- 源提交：6e322240721059eac6909d923cf61148077ef5c0；本地 working-tree 预览。
- 相关测试：tg-public-ui、tg-pages-contract 共 66 PASS / 0 FAIL / 0 SKIP，exit 0。
- JavaScript 语法与增量差异空白检查通过。
- 桌面 1280px 和移动端 390px 实测：商品区仅含两个产品名称；说明节点不存在；
  下方间距为 24px；无横向溢出。已核对购买／兑换及产品切换，恢复默认窗口尺寸。
- 本地预览 HTML、JS、CSS 均 HTTP 200、no-store，与当前工作区逐字节一致；
  sourceCommit/serverSourceCommit 均为上述 SHA，sourceRoot 指向 c66d。
- 备份、增量补丁、测试日志、来源检查与截图：
  /Users/wangyongchao/.codex/backups/tg-product-copy-20261017T152758Z。
- 真实下单、付款、订单写操作及并发业务验收：NOT RUN。
- SQL 与生产部署：NOT RUN；productionEvidence=false。
