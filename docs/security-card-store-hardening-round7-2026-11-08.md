# 第 7 轮安全加固：KC 持久支付保护与防重复付款

轮次日期：2026-11-08；证据收尾于 2026-11-09（Asia/Shanghai）。本轮修改仍在本地 dirty 工作区，未暂存、未提交、未推送、未创建 PR、未部署。未执行 SQL、未连接真实数据库、未实际付款、未启动生产 worker 或修改生产配置。定向离线验证通过，不代表线上已生效，也不能证明主站、KC、TG 已全面防住攻击。

## 1. 本轮修复

第六轮用内存标记和 owner 条件减少迟到任务误释放，但付款结果持久化、隔离或记账失败时，银行卡仍可能处于普通占用状态，被重启、过期锁或批量清理重新投入卡池。本轮把付款提交前的保护写入卡片本身，并收紧付款后的重试与释放边界。

1. **提交前持久保护。** `markCardPaymentStarted(cardId, ownerKey)` 用同一条 UPDATE 检查 active、正常、占用中和字节精确匹配的 owner，把卡片变为“支付处理中”。必须恰好修改一行；失锁、重复进入或写入失败会停止付款。支付模块先设置内存保护，再等待卡片保护写入和 `started` 任务状态持久化，任一步失败均按 `CARD_PAYMENT_HOLD_FAILED` 停止，不按普通拒付换卡。写入已落地但响应丢失的情况在离线模型中保持保护。
2. **阻止付款路径自动重复提交。** 当前支付重试调用方把同一个保护回调传给协议和 UI 路径。Hosted 与普通协议入口等待回调并传播错误，原有 UI 和 Grok native 路径也等待回调。协议进入保护后出现异常、验证码、3DS 或回退结果时，不再自动转 UI 付款；保护前满足原有回退条件的失败仍可转 UI。这个限制可能在真正扣款前就保留卡片，是保守策略的可用性代价。
3. **成功记账后才能释放。** 成功路径依次绑定支付资料、地址、记录卡片用量、写入账单，最后调用 `completeCardPayment`。该方法只释放属于当前 owner、active、占用中且处于“支付处理中”的卡片。资料、用量、账单或完成更新失败，不通过普通 finally 释放。相关写入不是一个完整的跨表原子结算，仍需人工核账和后续账本设计。

持久状态还用于保护以下入口：

- 普通 `releaseCard` 与 runtime 释放只允许“正常”卡，不能释放“支付处理中”。带 owner 的隔离、冷却、报废、资料及用量操作兼容支付保护状态。
- stale、重启和批量释放只回收“正常”卡。`payment_` owner 还须完整匹配本地任务，且任务明确为 `failed/cancelled`、付款为 `not_started/declined`、`recovery_required=0`；missing、debug、running、manual、unknown、succeeded 等记录不构成可安全回收的证据。保留既有 GPT 外包保护条件。
- 重启清理移除先读取任务、后依据内存结果清理的两阶段做法，在执行清理的 SQL 条件中检查任务证据。
- 管理员冻结和解冻只作用于空闲卡。冻结限正常/已冻结/已报废状态，解冻限已冻结，不能覆盖占用、支付中或待核账状态。

现有卡状态字段为 `VARCHAR(32)`，本轮未新增 schema 或迁移，也未执行 SQL。这是代码与离线模型结论，真实 MySQL 的排序规则、事务、并发和恢复行为尚未验收。

## 2. 本轮变更清单

本轮相对各文件修改前的 dirty 字节备份，共 11 个源码/测试文件；不能把相对 HEAD 的整份工作区差异视为本轮内容。

| 文件 | 本轮变化 |
|---|---|
| `services/kc-pay-gpt/mysql-store.js` | 支付保护与完成方法；清理条件；受保护操作兼容性；管理员冻结边界 |
| `services/kc-pay-gpt/payment-retry.js` | 持久保护回调、失败停止、禁止保护后自动回退、记账后完成释放 |
| `services/kc-pay-gpt/stripe-protocol-payment.js` | Hosted 与普通协议入口传播保护回调错误 |
| `services/kc-pay-gpt/test/payment-retry-safety.test.js` | 适配保护接口，注入写失败、响应丢失、重复回调、隔离/记账异常 |
| `services/kc-pay-gpt/test/payment-protocol-fallback.test.js` | 保护前可回退、保护后不得再转 UI，保护响应失败回归 |
| `services/kc-pay-gpt/test/mysql-card-cooldown.test.js` | 适配状态与归属条件 |
| `services/kc-pay-gpt/test/card-freeze.test.js` | 管理员冻结/解冻不能抹除支付和占用状态 |
| `services/kc-pay-gpt/test/stripe-protocol-payment.test.js` | 加载完整真实模块、禁网络 mocks，验证两种协议入口在保护失败后不发送后续请求 |
| `tests/security-round5-kc-owner-locks.test.js` | 离线清理模型适配本地任务安全终态；保留原安全断言 |
| `tests/security-round6-kc-card-ownership.test.js` | 离线 SQL 模型增加 `status IN (...)` 解析，保留归属与受保护状态断言 |
| `tests/security-round7-kc-payment-hold.test.js` | 新增完整 mysql-store 模块配合 mysql2 离线模型的持久状态与故障注入回归 |

只有最后一个测试是本轮新建文件。第五、六轮 root 测试在本轮开始前已是 untracked，不能因为 Git 显示未跟踪就算作本轮全部新建。未修改 `stripe-payment.js`、`grok-native-payment.js` 等现有 UI gate 实现；当前生产协议调用方传入保护回调，但协议函数本身仍接受缺省回调，未来新增调用方必须再次检查。

## 3. 最终验证与中间失败

只合计下面三次最终调用，实际执行 26 个不重复测试文件：

| 最终调用 | 实际文件数 | 结果 | 退出码 |
|---|---:|---|---:|
| Node 第 2–7 轮定向安全回归 | 9 | 477 PASS / 0 FAIL / 0 SKIP | 0 |
| KC 支付、路由、任务、外包恢复等 Vitest | 15 | 506 PASS / 0 FAIL | 0 |
| ChatGPT 账单与结账两文件 Vitest | 2 | 18 PASS / 0 FAIL | 0 |
| **最终定向合计** | **26** | **1001 PASS / 0 FAIL** | 三次均 0 |

KC 扩展调用实际传了 16 个 selector，其中 `test/chatgpt-protocol-first.test.js` 不存在，被 Vitest 静默忽略，不能记为已执行。之后单独执行真实存在的 `chatgpt-billing.test.js` 和 `chatgpt-checkout-team-promo.test.js`，得到额外 18 项通过。执行文件清单、命令计划、结果和日志路径分别保存在证据目录。

中间结果保留如下，不再次加入最终通过数：

| 阶段 | 结果 | 退出码 |
|---|---|---:|
| 首次六文件 Vitest | 149 PASS / 27 FAIL | 1 |
| 适配保护接口后的中间 Vitest | 174 PASS / 2 FAIL | 1 |
| helper 适配后六文件 Vitest | 176 PASS / 0 FAIL | 0 |
| 追加故障注入首次运行 | 192 PASS / 2 FAIL | 1 |
| 修正完整协议模块测试的 require 基准后 | 194 PASS / 0 FAIL | 0 |
| 第七轮 store 初次离线模型 | 163 PASS / 0 FAIL | 0 |
| 第 2–7 轮首次联合 Node 回归 | 462 PASS / 15 FAIL | 1 |

追加协议测试的两项失败来自夹具相对 require 路径，已改为以真实协议模块 URL 建立 `createRequire`。联合 Node 回归的 15 项失败来自第六轮模型只解析 `status = '正常'`、未解析新增 `status IN (...)`，补充解析后原安全断言通过。没有删除失败断言，也未修改旧报告把历史 FAIL 改为 PASS。早期命令未完整保留的部分只按日志和会话记录归档，不伪造完整 shell transcript。

11 个变更 JS 的 `node --check` 均退出 0。限定路径的 `git diff --check` 退出 0，但它不覆盖 untracked 文件；本轮 11 文件的精确增量另在临时副本中逆向恢复并正向重放，每步退出 0，修改前 10 份快照与当前 11 文件分别核对 SHA256。

第六轮历史 710 项定向通过保持原记录。KC 历史全量仍为 **71 文件、1672 PASS / 40 FAIL、exit 1**；本轮没有重跑全量，不能报告为“全量绿色”。

## 4. 证据与隔离边界

测试通过环境清理 runner，使用合成 session key；Node preload 阻止真实 `.env*` 读取及 `net/tls/dgram` 连接。它不是操作系统、native addon、Chromium 或独立子进程的完整沙箱。ChatGPT 回归日志有 Sentinel 网络失败与生成的不透明长值，不能据 Node guard 声称所有运行路径都不存在外联。

store 测试使用完整真实模块和 mysql2 离线模型，能够检查应用分支、owner 条件、持久状态与故障注入。它不能替代 InnoDB 并发、死锁、连接中断、COMMIT 已成功但客户端不知情、进程崩溃和真实支付平台的验收。

归档保留 10 个运行日志：5 个按原字节复制，5 个因有限正则发现敏感形态而归档脱敏副本。`log-provenance.json` 记录原始 `/tmp` 路径、原始与脱敏哈希、匹配/替换数量及扫描模式；不输出匹配原值。脱敏副本不是原始字节日志，有限扫描也不能证明没有秘密。原始日志仍在 `/tmp`，保留期限无保证。

KC `Dockerfile` 使用 `COPY . .`，当前 `.dockerignore` 未排除三个变更运行文件，仅完成静态输入检查，未构建镜像或验证生产 artifact。KC 独立部署于 `/opt/kc-pay-gpt`，Vercel 或 Verify 部署成功也不能证明 KC 已上线。本轮未接触该主机目录的 `.env`、host compose、data、debug_screenshots、product_files 或 mysql_data。

## 5. 当前仍然存在的风险与下一步

- **真实故障语义未验收。** 需要在另行授权的隔离 MySQL 测试目标中验证行锁、并发清理与付款、死锁、连接中断、COMMIT 不明和重启恢复；不能直接在生产上用测试 SQL 或付款试错。
- **仍缺支付账本与代际约束。** 当前保护减少卡片误释放和自动重复提交，但不提供跨任务、跨进程、按订单唯一的完整支付幂等账本。相同 owner 的 ABA、失锁后已在途的外部请求、部分记账，仍需唯一 attempt、单调代际 fencing、支付平台幂等键与核账流程进一步约束。
- **保护可能提前生效。** 税区、验证码等真正付款前步骤失败，也可能保留卡片。debug 或缺失任务的普通占用不会因缺乏证据而自动回收，需要可审计的人工核账、确认和解锁流程，不能直接按时间强制释放。
- **当前检查限 KC。** 主站、TG、NewAPI、WAF 和生产权限没有本轮新增验收；也未验证真实充值、发卡或跨系统资金一致性。

下一步优先补隔离 MySQL 故障验收方案与可重复夹具，再设计按付款 attempt 的账本和代际约束。在未获得 SQL 执行授权前，保留为本地代码、测试与方案，不连接真实数据库或执行迁移。

## 6. 工作区与历史完整性

本轮基线及归档时为 `main`，HEAD 与已 fetch 的 `origin/main` 同为 `75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`，behind=0，canonical HTTPS origin 正确，暂存为空。修改前基线 603 条展开 dirty 状态在归档前均保留；状态保留不等于整个工作区已逐字节备份。10 份本轮所涉旧文件的修改前字节快照和两份接续中间快照均已读回验证；未创建 stash 或备份 commit，不能将其描述为完整工作区/数据库备份。

第六轮报告与证据的 43 个历史文件逐个核验未变，原有历史结果和范围外 REVIEW 不变。收尾发现范围外 `js/engagement-runtime-loader.js` 的当前哈希与交接记录不同，来源未归因，未修改、未恢复、未纳入本轮 delta，单列 **REVIEW**。首次归档程序因此保护性退出 1、未写归档；记录差异边界后继续归档，该事件不是测试失败修复或工作区整体一致的证明。

证据位于 `docs/security-audit-evidence/2026-11-08-card-store-round7/`。`final-integrity.json` 核验本轮源码哈希、43 个历史文件、603 条原始状态、Git index/staging 和范围外文件观察；整份工作区不能标为一致。`evidence-manifest.json` 收录报告及除自身外的证据哈希，避免循环引用，不等于签名或不可篡改存档。

| 系统/能力 | 本轮状态 |
|---|---|
| KC 定向离线验证 | PASS：1001 项，26 个实际文件 |
| KC 全量 | 历史 FAIL：1672 PASS / 40 FAIL；本轮重跑 NOT RUN |
| 真实 MySQL、支付、故障恢复 | NOT RUN |
| KC 生产独立产物 | NOT RUN；本地修复未上线 |
| 主站、TG、NewAPI、WAF、生产权限 | NOT RUN |
| 第六轮历史证据完整性 | PASS：43 文件不变 |
| 整份工作区字节一致性 | REVIEW：范围外文件哈希差异，且没有全量历史字节基线 |
| 提交、推送、PR、部署、SQL、游客启用 | NOT RUN |
