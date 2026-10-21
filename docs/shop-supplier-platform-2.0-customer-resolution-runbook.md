# Supplier Platform 2.0：P2D-2 客户结案与原购买恢复

本切片补齐未交付供应商订单的客户资金处理、公开完结说明和同一标签页刷新后的积分购买核对。它是本地代码实现，**P2 整阶段、真实采购准入、worker 和发布均未完成**。客户已结案与上游采购已对账是独立事实；不能通过关闭客户订单清除未决扣费或再次采购。

## 1. 前序确认与本轮 SQL 顺序

本轮承接用户「已执行，按原计划继续」。按最近交付清单，记录为 P2D-1 migration/verify 用户报告执行；未提供数据库输出，不回写前序 NOT RUN，也不视为事务、并发或真实商户验收。

先确认 P2D-1 已安装，再由用户依次执行下面两份新文件，无需重放已经报告执行的前序迁移：

1. `supabase/migrations/20261019_shop_supplier_platform_v2_customer_resolution.sql`
2. `supabase/migrations/20261019_verify_shop_supplier_platform_v2_customer_resolution.sql`

Codex 未执行任何 SQL。本轮迁移不插入采购/交付准入证明，不启用商品、账号或采购开关，不创建真实订单。积分返还依赖现有六参数、区分付费/赠送来源且支持幂等的 `fn_recharge_points`；旧数据库若缺少对应钱包迁移，应先核对迁移记录，不能改用旧的总额加分函数。

第二份是只读结构核验，正常输出：

`Supplier P2D-2 customer resolution structural checks passed; concurrent/business acceptance remains NOT RUN`

该输出仅说明当时数据库的结构/权限检查通过，末尾的 NOT RUN 是预期的证据边界。保存实际输出及操作者/时间后，才能追加数据库应用记录。

## 2. 管理员操作

入口复用 Admin Studio 商城原货源工作区的「采购与交付」列表，或积分/游客原订单详情中的「供应商结案」。读取订单需要 `shop.manage` 权限；打开入口只读，不会退款、采购或发货。

表单仅展示原订单、本次处理金额、公开完结说明、内部备注、凭据引用和确认勾选。金额来自服务端，管理员不能在表单中改为其他金额。公开说明为 8–500 字，内部备注为 8–1000 字，凭据引用为 8–500 字；用户只能看到公开说明和结案方式/时间。

| 订单类型 | 处理前确认 | 本次动作 | 保留的原事实 |
| --- | --- | --- | --- |
| 原生积分供应商订单 | 未交付；原付费/赠送积分明细完整，无既有退款 | 按原两项构成精确退回，写入退款流水和结案说明 | 原扣款、采购请求、实际采购成本和风险占用 |
| 游客现金供应商订单 | 已确认收款、未渠道退款、未交付；先在外部完成全额补偿并持有凭据 | 登记已完成的人工补偿，包括原支付手续费 | 原支付状态、币种、渠道、网络及渠道退款状态 |

游客动作是补偿登记，不会调用支付渠道退款 API，不会把 confirmed/none 改成渠道已退款。若尚未补偿，不应勾选确认或登记已完成。已正常交付的订单不能走此入口，需要后续独立售后处理。

凭据引用可使用客服工单号、可复核的补偿记录编号等。服务端计算并校验其 SHA256；这是**引用字符串的指纹**，不代表系统已经访问或验证了外部凭据真伪。管理员仍对补偿事实及凭据可复核性负责，不将密钥或完整卡密粘入说明。

## 3. 结果不明与重复操作

管理员首次提交前将同一操作号、账号/站点/订单/资金类型及原处理内容保存在 sessionStorage。收到未知结果、断线或超时后保留原记录并锁定输入；重新打开同一订单会自动查询原处理，不重新生成退款操作。

- 「查询本次处理」只读查询原操作，绑定原管理员和原订单。
- 查到不可变完成凭据后才清除待核对记录，显示已完结说明。
- 查无凭据不代表上一请求一定未执行；可用「按原信息重试」，沿用同一操作号、同一金额和同一内容。
- 原管理员已切换时暂停处理；原操作不能由另一个账号认领。
- 已存在别的结案操作、既有退款引用、退款构成不完整或已交付时拒绝再次处理，先核对原记录。

积分退款的 `REFUND_<原订单 UUID>` 引用唯一；六参数充值函数若报告已去重，也不能冒充本次已退款。新结案事务会拒绝并要求核账。SQL 中的保护、唯一约束和加锁逻辑尚需真实数据库并发验收。

确认结案后刷新当前订单列表、原详情及已展开的采购列表，保持原列表页码和筛选。详情的迟到响应不得覆盖刚打开的其他订单。界面刷新失败会明确说明结案已确认，不能把已提交资金结果变成「结果未知」或再退款一次；辅助审计日志失败同样不改变不可变数据库凭据。

## 4. 数据保护和上游后续

结案凭据位于私有 `shop_supplier_customer_resolutions`，每个履约单元仅一条，禁止直接新增、更新、删除和截断，service_role 只有直接 SELECT 权限。写入仅由 service-role RPC 在事务内完成；管理员权限在服务端核验。

事务源码保持原生订单 → 履约单元 → 账号策略 → 采购意图 → dispatch attempt 的加锁顺序。不可变凭据的精确原生字段投影是唯一结案授权；保留 `supplier_dispatch_resolution_required`，不开放普通退款/关闭绕过采购保护。已结案原生记录只允许继续核对所需的 dispatch 版本及更新时间，不允许改归属、资金、交付结果或公开说明。

客户结案将 outbox 留在 review/customer_resolution_required，保留冻结账号、原请求、原上游订单、采购 attempt、实际扣费、加密回执及风险占用。它不会把未受理、未扣费或未发货当作已证实，也不会释放上游风险预算。

迟到的上游商品仍经过 P2D-1 原生可交付核验：结案订单不能再交付给客户，内容留在加密隔离记录中，实际成本及敞口保留。客户取货 RPC 在选取加密内容前返回 closed，不解密、不发放隔离商品。查询、成本对账和后续处置需继续使用原采购身份，不能创建替代采购来消除未知结果。

## 5. 用户侧显示

钱包积分订单、游客订单列表与详情按白名单显示公开结案结果，正文可看到管理员的完结说明；不返回内部备注、凭据引用、凭据指纹、账号配置或密文。

游客正在付款的弹窗若查询到补偿结案，展示公开说明并收起付款码/付款配置和取消入口，停止倒计时和自动轮询，清理本地已确认的订单句柄。状态接口跳过渠道状态刷新、付款数据重建及发货触发；原支付事实仍原样返回。该订单不能被展示为正常已发货。

## 6. 积分购买同标签页恢复

实际购买前先调用认证、只读的 `prepareRecovery`，由服务器确定 local 或 supplier_v2。真实购买再次核验来源，发生变化返回 purchase_source_changed，且在报价、资金动作或幂等执行之前拒绝。历史客户端未携带来源提示时保留既有后端路径。

只有 supplier_v2 购买会在请求发送前保存积分购买 journal；local 路径不产生无法由供应商 RPC 恢复的记录。记录绑定当前账号及站点，账号/站点切换后不认领原操作。存储不可读、损坏或无法确认原记录时停止购买，避免绕过原不确定请求。

同一标签页刷新后，商城显示「核对上次购买」入口。它只查询原 operation/idempotency key，不重新报价、扣款、发货或恢复编辑购物车。恢复查询独立于当前 intake 开关、映射可售状态和报价 TTL，因暂停新销售而无法新购时，仍可查询已形成的原订单。

- confirmed：确认原订单，清除该 journal，提供原钱包订单记录入口；保留当前购物车的用户编辑。
- unconfirmed：没有取得已消费报价对应的原订单证明，继续锁定原操作；提示查看钱包记录或联系管理员，不能认定未扣款并重新购买。
- 登录或站点变化、网络失败、数据库返回不一致：继续保留原 journal，不产生另一笔购买。

sessionStorage 仅保证同一标签页刷新恢复，不承诺关闭浏览器后、其他设备或跨标签页恢复；不以 TTL 自动删除未知操作。记录不保存登录令牌、支付查询凭证、卡密或密文。浏览器记录被手工删除后不能靠本功能证明可重购，应查原订单和账目。

## 7. 本地验证与初次失败记录

最终相关回归：**128 文件 / 1472 测试，1472 PASS、0 FAIL、0 SKIPPED、0 CANCELLED、0 TODO**。选择范围为 admin-shop、guest-shop、shop-supplier、shop-cart、shop-auth-login-prompt、shop-purchase、wallet，以及 payment-readiness-gate 和 admin-wallet-point-lots-contract；包含既有两份 promo 历史 archive 契约。没有删除或弱化 archive 断言，也不以其结果替代 A5–G3 手工业务证据。

最终完整命令及文件清单记录在 `/tmp/run-supplier-p2d2-final-regression.js` 和 `/tmp/supplier-v2-p2d2-final-regression-20261019.json`；逐项日志为 `/tmp/supplier-v2-p2d2-final-regression-20261019.log`，SHA256：

`14baf4f3e515c846091216cf28bb7b0839ef575bbc5259df6be43257086f5f80`

本轮首轮完整回归 **123 文件 / 1382 测试，1378 PASS / 4 FAIL**；日志 `/tmp/supplier-v2-p2d2-initial-regression-20261019.log`、JSON 同前缀，SHA256 为 `223ebe65f84511900fab1e18b9a5f9abb858ba6a442fa6a36e328720d82c1463`。三项是旧退款保护提示改为供应商结案后的字符串期望，一项是 VM 测试缺少新只读来源准备及 journal 模拟。修正测试准备和提示期望后，继续保留原资金保护断言，并新增身份、金额、只读恢复、来源变化及前端未知结果用例。

其他专项证据独立保留，不覆盖其初次结果：

| 日志（均位于 /tmp） | 结果 | 解释 |
| --- | --- | --- |
| supplier-p2d2-focused-first.log | 76 PASS / 0 FAIL | 服务端结案、权限、journal 与购买 UI |
| supplier-p2d2-contract-first.log | 12 PASS / 1 FAIL | 新测试错误要求既有退款/交付条件的固定书写顺序；改为独立核验两条件，未放宽产品逻辑 |
| supplier-p2d2-contract-recovery-second.log | 27 PASS / 0 FAIL | 纠正上述新测试后，连同认证/来源准备和原操作恢复 |
| supplier-p2d2-guest-closure-first.log | 81 PASS / 2 FAIL | 新 VM 断言只查子按钮 hidden；既有弹窗实际由父配置区隐藏 |
| supplier-p2d2-guest-closure-second.log | 83 PASS / 0 FAIL | 校验父区隐藏、终态、无付款码、无轮询/发货/领货 |
| supplier-p2d2-parent-refresh-first.log | 7 PASS / 0 FAIL | 后台父详情刷新、迟到响应保护、刷新失败不改变金融确认 |
| supplier-p2d2-final-guard-focused.log | 17 PASS / 0 FAIL | 原退款引用去重冲突及后台同步专项 |

SQL 离线检查为 **12 份 migration/verify + 7 个重建原生函数纯解析、23 个补丁锚点回放通过**，使用 pglast parse_sql/parse_plpgsql 及现有重建 helper；未连接数据库、执行 SQL 或调用商户。记录为 `/tmp/supplier-v2-p2d2-sql-parse-20261019.json`、`/tmp/supplier-p2d2-patch-replay.json`，命令为 `PYTHONPATH=/tmp/tg-sql-parser python3 /tmp/check-supplier-p2d2-sql.py`。先前一次 pglast 导入失败属于解析器 PYTHONPATH 准备问题，不代表数据库错误；只在正确加载解析器并核对当前文件哈希后记录解析 PASS。

## 8. 源码与发布边界

工作区：`/Users/wangyongchao/.codex/worktrees/c66d/xianyu_profit_calculator`；分支 `codex/shop-supplier-platform-2`；唯一 origin 为 `https://github.com/zaoyoe/Zaoyoe-Studio.git`。本轮修改前已 fetch，HEAD 与 origin/main 均为 `e9db00863fddaaab782c00aef14bb1bd21040314`，落后计数 0。

源码清单同时包含 tracked changes 与 untracked 文件，不能只用 git diff 推断发布范围。本切片主要涉及新的结案 migration/verify、resolution 服务与管理路由、原生订单的公开投影、采购列表/结案表单、钱包/游客终态显示、积分来源准备与恢复协议、共用 journal 及相应测试。前序 P1–P2D-1 新文件仍在同一工作区保留，不能因未跟踪而遗漏。

源码/JS 语法/已跟踪和未跟踪空白检查报告为 `/tmp/supplier-v2-p2d2-source-checks-20261019.json`，收尾记录追加精确数量。该报告是工作区文件证据，不是提交 SHA 对应的生产证据。

本轮未执行 reset/rebase/restore 等破坏性 Git 操作，保留前序恢复引用；未创建干净发布候选、提交、推送、部署或调整 8000 预览，也未启用商品、worker 或真实采购。前序备份不是本轮新增文件已备份的证明；未来发布前仍需按 AGENTS.md 创建并核验包含全部改动的恢复备份和完整提交。

## 9. 待实际验收矩阵

| 验收项 | 当前证据 | 状态 |
| --- | --- | --- |
| 本轮结构迁移和只读 verify | 只交付文件，未收到执行输出 | NOT RUN |
| 积分返还两种来源、lot、流水、原订单/凭据同事务；并发相同/不同操作 | 本地源码与模拟测试 | NOT RUN（数据库事务/并发） |
| 先前已入账退款引用与新结案竞争 | 源码 fail-closed 检查 | NOT RUN（数据库并发） |
| 人工补偿证明真实、足额含费、原支付/渠道退款事实不变 | 参数/接口模拟 | NOT RUN（实际业务） |
| 正常交付与结案竞争、迟到商品隔离、成本/敞口不消失 | 源码保护与纯解析 | NOT RUN（数据库并发/商户） |
| 管理员和用户界面、同标签页刷新、切换账号/站点、断网重试 | VM 模拟 | NOT RUN（真实浏览器业务） |
| 上游采购/交付合同和真实商户恢复 | 没有新增准入证明 | NOT RUN |
| Vercel / KVM4 Verify / NewAPI / guest-shop worker | 无发布动作 | NOT RUN |

下一步先由用户提供本轮 migration/verify 执行结果；随后继续 P2 运行协调、限速/告警和端到端故障验收，并补齐尚未完成的运营联动。实际成本已保存不等于利润/营销闭环完成；P3 主备与第二渠道、P4 代理开放 API 仍按原计划后续推进。


2026-10-19 收尾追加：全部 **84 个**改动/新增文件已纳入来源清单，**60 个 JavaScript** 文件语法检查通过，tracked 与 untracked 文件的空白检查均通过。完整回归测试与 SQL 解析结果沿用第 7 节，本次只追加文档和核对文件哈希，不将工作区文件清单冒充生产提交。
