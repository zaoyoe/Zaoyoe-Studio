# TG 独立兑换订单处理与人工完结

适用于 `TG-…` 独立兑换订单：没有关联 `TGP-…` 购买单、持有原兑换码，当前停在人工复核或失败状态。购买单的发货任务应继续通过购买订单处理，不使用此能力。

目标订单 `TG-1224A9A53E5A435D9E09` 属于独立兑换订单，已有原始上游提交记录，但缺少上游订单号。此前只读查询没有找到匹配记录；这不能证明上游未受理，也不能作为重复购买或恢复兑换码的依据。本轮没有完结该真实订单，没有执行 SQL，没有退款或补发。

## 数据库安装（操作者手动执行）

前置条件：现有 TG 运行时已恢复并对齐，具备 `fn_tg_finish_order`、`fn_tg_review_order` 和原始提交币种记录。应先完成原运行时的结构验证。不要在新增迁移后重新运行会覆盖同名函数的旧迁移。

依次执行以下两份文件：

1. `/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/migrations/20261017_tg_redemption_resolution.sql`
2. `/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/migrations/20261017_verify_tg_redemption_resolution.sql`

第一份为事务性安装，成功时显示 Success 即可；第二份为只读结构及权限验证，预期返回：

```text
TG redemption resolution structural checks passed; concurrent/business acceptance remains NOT RUN
```

结构验证通过不代表真实事务、并发或业务验收通过。上游订单归属冲突、旧结构不满足前置条件时，安装应失败并保留原数据，不能删除证据来安装。未安装时，后台仍可查看原订单与查询上游，新处理入口禁用并提示数据库升级。

## 处理入口与结果

进入 TG 管理页的“兑换订单”，点击目标订单“详情 / 对账”。“订单处理”提供三个互斥展开的表单，只有满足条件的入口可用。

| 入口 | 必要事实 | 订单与兑换码结果 |
| --- | --- | --- |
| 补录原上游订单 | 找到本次原始请求对应的 Gramix 订单 UUID，独立 GET 校验原提交标识、账号、权益与扣款币种一致 | 上游完成则同步已完成与已兑换；处理中只恢复原单查单；失败或取消则同步失败，继续人工处理 |
| 凭未受理证明结案 | 原订单没有上游订单号；完整且可关联的查询没有匹配，并取得上游明确未受理且不会后续发货的凭据 | 订单已完结；兑换码可选择作废，或在兑换码及批次仍有效时恢复可兑换 |
| 人工完结 | 已实际核实用户收货、已另行退款，或已与用户协商处理；管理员确认原请求及可能的上游风险 | 订单已完结；核实收货记为已兑换，退款或协商处理则作废兑换码 |

补录会在确认提交时重新 GET 上游，不能用过期的预览结果写入。接收账号、会员时长、Stars 数量、原提交标识或扣款币种无法一致核验时，禁止关联。查询超时、空列表、余额变化、缺少关联字段均不能证明未受理。

登记未受理凭据需要填写凭据类型、可追溯编号或链接（6–200 字）、上游确认时间，以及明确答复（20–1000 字），并确认原请求未受理且不会后续交付。确认时间不能早于原始提交时间或晚于当前时间。系统重新查询若发现匹配、冲突、分页未完成或缺少关联字段，会拒绝结案。

人工完结只登记已经发生的实际处理。退款应先通过实际渠道完成；协商应先完成相应沟通和处理。本地完结不会调用购买、补发或退款接口，也不能撤回已提交上游的请求。原始提交事实不完整时仍可登记实际处理结果，但必须确认上游可能后续交付的风险。

## 内部依据与用户说明

每次提交都需要单独填写内部处理依据（6–500 字）。两个结案入口还必须填写给用户的完结说明（6–500 字），表单直接预览用户将看到的说明。内部凭据、管理员身份、操作哈希和原提交标识均不进入公开查询。

成功后后台显示“已完结”、完结时间、处理结果、兑换码处置及处理记录。用户使用原订单凭据查询，或通过原邮箱与查询密码 / 已登录账户查询，同样看到“订单已完结”和该订单保存的公开说明，自动轮询停止。旧订单说明不随兑换码后续使用而改变。

实际收货的人工登记仍保留“已完结”，不伪装成上游自动发货成功；上游完成时间 `completed_at` 与管理员完结时间 `closed_at` 分开记录。原提交时间、币种、上游订单号、错误及已结束的尝试记录保留。

## 一致性、重试与权限

处理接口要求超级管理员和同源 JSON 请求。读取与提交分别检查订单和兑换码版本；写入采用兑换码 → 订单 → 批次的锁顺序。活跃或残留租约、兑换码已被消费、账号或权益不一致、另一任务占用时均拒绝处理。

同一事务更新订单、兑换码、批次已兑换数量、未结束尝试记录及审计凭据。首次确认收货只增加一次批次已兑换数。已完结任务失去工作租约，不会重新被自动领取；迟到的旧 worker 结果无法覆盖完结说明。

提交期间禁止切换处理路径和关闭弹窗。响应未确认时保留操作 UUID 和完整请求，锁住输入，使用“查询并重试本次处理”核对同一次操作。服务端只有在操作者、订单、操作类型与完整请求哈希全部一致时才返回已保存结果，重复操作不会重复计数或购买。版本冲突时保留已填说明并要求刷新核对。

处理凭据表启用 RLS，只允许 service role 读取，通过受限 SECURITY DEFINER RPC 追加，禁止客户端直接写入；触发器禁止修改或删除已有凭据。唯一上游归属索引与操作 UUID 冲突会回滚整个事务。

## 本轮交付与证据边界（2026-10-17）

运行文件：`server/tg/redemption-resolution.js`、管理订单处理器与筛选、公共兑换及查询投影、`js/tg-admin.js`、`js/tg.js`、`js/tg-order-query.js`、`tg-admin.html` 和 `css/tg-admin.css`。数据库文件为以上安装与只读验证两份；测试包含服务、管理弹窗、用户查询与 SQL 契约。Verify Server 包需包含上述 server/js 运行文件，Vercel 需包含对应静态页面和资源，不能以零散文件替代完整发布提交。

- 自动化测试与本地预览证据在验证完成后追加记录，原有购买订单的历史测试结果不替代本能力证据。
- 两份 SQL 的静态 SQL / PL/pgSQL 解析通过；没有连接数据库。
- 数据库迁移应用：NOT RUN。
- 数据库事务、并发与真实业务验收：NOT RUN。
- 目标真实订单完结：NOT RUN。
- 生产发布：NOT RUN。

数据库验收应使用隔离测试订单，至少记录：三种上游状态同步、账号 / 权益 / 币种 / 原提交标识不匹配拒绝、未受理凭据缺失或查询不完整拒绝、失效批次不能恢复码、三种实际处理结果、收货计数只加一次、相同请求重试、同操作 ID 不同请求冲突、两个操作竞争同单、worker 竞争、旧版本或租约拒绝，以及凭据查询与邮箱查询显示同一说明。真实结果应追加归档；自动化模拟或结构验证不能将这些 NOT RUN 改为 PASS。


## 本轮最终验证记录（2026-10-17，追加）

- 代码基线：`codex/tg-operations-closure`，`HEAD 6e322240721059eac6909d923cf61148077ef5c0`。再次执行 `git fetch origin main` 后，`git rev-list --count HEAD..origin/main` 为 `0`；origin 为规范 HTTPS 远端。交付内容仍是本地工作树修改，未提交、未发布。
- 完整相关回归：**1,050 通过，0 失败，0 跳过，0 取消**。运行命令如下；包含 TG 服务、管理与用户页面、Gramix、USDT 以及新增 SQL 契约。数据库行为由模拟或契约覆盖，不视为真实数据库验收。

```sh
node --test --test-reporter=tap tests/tg-*.test.js tests/gramix-client.test.js tests/payment-usdt*.test.js
```

- 静态解析：安装文件 21 条 SQL、2 个 PL/pgSQL 函数、1 个 DO 块；验证文件 4 条 SQL、1 个 DO 块，全部 PARSED。只解析本地文件，没有连接或执行数据库。
- 本地双来源预览已重启：TG 前后端来自本工作树，其余页面仍来自 a8cb 工作树。`/__tg_preview_source` 的 `sourceCommit` 与 `serverSourceCommit` 均为上述 HEAD，10 个相关运行文件的指纹与本地一致，健康检查为 `ok`。`productionEvidence: false`；SHA 表示基线提交，未提交内容通过文件指纹补充标识。
- 已登录浏览器只读核验目标订单：仍为“人工复核”；“订单处理”显示“补录原上游订单”“凭未受理证明结案”“人工完结”三个禁用入口，提示“兑换订单处理功能需要数据库升级，请先执行兑换单结案迁移及只读验证。”普通详情仍可读取，未提交任何真实处理。
- `git diff --check`：通过。
- 本轮操作前的可恢复备份：`/Users/wangyongchao/.codex/backups/tg-redemption-resolution-20261017T112255Z/working-tree.tar.gz`，文件清单在同目录 `manifest.json`，保留未删除。

验证产物归档于 `/Users/wangyongchao/.codex/artifacts/tg-redemption-resolution-20261017/`：

- `tg-redemption-full-regression.log`：完整测试结果。
- `tg-redemption-resolution-sql-parse.json`：静态 SQL / PL/pgSQL 解析结果。
- `tg-redemption-resolution-preview-evidence.json`：预览来源、健康结果及 10 项文件指纹。
- `tg-redemption-resolution-preview.png`：已登录浏览器的三个处理入口与数据库升级提示截图。

数据库迁移应用、数据库事务 / 并发 / 真实业务验收、目标订单实际完结以及生产发布继续保持 **NOT RUN**。以上追加证据不改变前面的证据边界，也不替代历轮记录。

## 处理确认与同次操作恢复修复（2026-10-17，追加）

用户反馈 `TG-1224A9A53E5A435D9E09` 提交人工完结后一直显示“尚未收到处理确认”，输入保持锁定。只读查看该订单时，状态仍是人工复核、上游订单号为空，处理记录没有人工完结结果。本轮没有取得这次失败请求的原始数据库错误码，不能断言该请求的具体失败原因已经由日志证实。

代码审查确认一处可导致保存失败的缺陷：原结案 RPC 在 `SECURITY DEFINER SET search_path = public, pg_temp` 中直接调用 `digest()`，该函数可能位于其他扩展 schema。现改用 `pg_catalog.sha256(pg_catalog.convert_to(..., 'UTF8'))` 及 `pg_catalog.encode`，并加入固定 SHA-256 向量与函数定义就绪检查。已知 SQL / schema 拒绝可返回经过白名单筛选的修复提示；网络错误和未知失败仍保持“结果不确定”，不推断事务已经回滚，也不泄露数据库错误原文。

已安装原结案迁移的数据库，操作者应依次手动执行以下**增量**文件，无需重跑旧运行时恢复文件：

1. `/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/migrations/20261017_tg_redemption_resolution_confirmation.sql`
2. `/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator/supabase/migrations/20261017_verify_tg_redemption_resolution_confirmation.sql`

第一份事务性替换函数定义、安装私有 readiness 并刷新 schema cache，不调用处理函数、不修改订单数据。它要求原结案迁移的结构检查先通过；报前置条件错误时应核对原安装结果，不能跳过检查。第二份是只读结构和权限验证，预期结果为：

```text
TG redemption resolution confirmation structural checks passed; concurrent/business acceptance remains NOT RUN
```

从全新数据库安装时，更新后的原结案安装文件也包含相同修复；本增量用于已安装的数据库，两处处理函数定义有契约测试校验一致。静态解析不验证实际数据库权限、扩展配置、事务或并发行为。

修复后的管理页新增“查询处理结果”，仅 GET 读取当前订单和本次 operation UUID 的凭据，不调用上游或写入订单；记录按订单和当前操作者隔离。“查询并重试本次处理”先做同样的查询：已有凭据时直接确认；未找到时，只有数据库确认修复就绪才重发完全相同的请求、说明、版本及 UUID。查不到记录不等同于事务已回滚；查询失败时不发送第二次提交。重复提交仍由数据库锁、请求哈希及操作 UUID 去重。

新版本在提交前将完整待确认请求保存到当前标签页的 sessionStorage，按当前管理员与订单隔离；关闭重开详情或刷新后恢复原操作并锁定输入。确认成功或首次收到明确的请求拒绝后清理。sessionStorage 不可用时仅保留内存副本。**升级前已丢失的旧页面内存和操作 UUID 无法由新版本追溯恢复**，应先刷新详情核对已保存的处理记录，不能假称旧操作已恢复。后台仍需按实际完成的收货、退款或协商结果填写处理依据及用户可见说明。

本轮代码和预览验证：

- 规范远端 `https://github.com/zaoyoe/Zaoyoe-Studio.git`；`codex/tg-operations-closure`，`HEAD 6e322240721059eac6909d923cf61148077ef5c0`。修改前及预览启动前重新 fetch，落后 `origin/main` 的提交数均为 `0`。代码仍是未提交工作树，不构成生产发布。
- 完整相关回归：**1,078 通过、0 失败、0 跳过、0 取消**。命令仍为 `node --test --test-reporter=tap tests/tg-*.test.js tests/gramix-client.test.js tests/payment-usdt*.test.js`。覆盖只读结果查询、鉴权隔离、已保存结果恢复、查询失败不重复提交、修复缺失时禁写、同 UUID 重试、刷新恢复以及 SQL 增量约束。
- 静态 SQL / PL/pgSQL 解析通过：原安装 22 条 SQL / 2 个 PL/pgSQL 函数 / 1 个 DO 块；增量修复 8 条 SQL / 1 个 PL/pgSQL 函数 / 1 个 DO 块；两份验证各 4 条 SQL / 1 个 DO 块。解析器为本地 pglast 8.6，全程没有连接或执行数据库。
- 本地双来源预览已重启：进程 `87677`，启动时间 `2026-10-17T13:03:38.455Z`。TG 来自 c66d，其余页面保持 a8cb；提交标识与 HEAD 一致，36 个 TG 运行文件的启动指纹、当前诊断指纹和磁盘指纹全部一致；`/healthz` 为 `ok`，`productionEvidence: false`。启动时指纹是新增的独立证据，不能以动态读取磁盘的指纹冒充进程已加载新代码。
- 重启后已登录页面只读查看目标订单：仍是人工复核，三个处理入口禁用，提示“兑换单处理确认功能需要增量数据库修复，请执行兑换单处理确认修复及只读验证；原订单不会被自动完结。”没有填写真订单说明、点击提交、退款或补发。
- 可恢复文件备份 `/Users/wangyongchao/.codex/backups/tg-resolution-confirmation-20261017/` 保留，manifest 记录操作前 9 个相关文件的 SHA-256；前轮完整工作树备份也继续保留。

证据归档于 `/Users/wangyongchao/.codex/artifacts/tg-resolution-confirmation-20261017/`：`full-regression.tap`、`sql-static-parse.json`、`preview-evidence.json` 和 `order-processing-repair.png`。本轮增量数据库迁移应用、真实数据库事务与并发验收、目标订单实际完结、用户端真实完结结果验证、生产发布均为 **NOT RUN**。这些追加记录不改写前面的历史结果。
