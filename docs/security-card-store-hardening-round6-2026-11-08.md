# 第 6 轮安全加固：KC 银行卡锁归属与支付调用兼容性

日期：2026-11-08。本轮修改保留在本地 dirty 工作区，未暂存、未提交、未推送、未创建 PR、未部署。未执行 SQL、未连接真实数据库、未做真实支付、未改生产配置或启动生产 worker。主站、TG、NewAPI 和线上 WAF 本轮均没有新增验收；本报告不能证明三个系统已全面防住攻击。

## 1. 本轮修复与结论

原有单卡释放、冷却、报废、人工复核、用量和支付资料更新缺少一致的锁归属约束，旧任务或迟到 finally 可能按资产 ID 修改已经转交给另一任务的卡。本轮把这组自动操作改为同时校验资产 ID、active、正常状态、in_use 和完整 owner，并在执行变更的同一条 SQL WHERE 中用二进制比较 owner；用量统计的锁定读取及更新均检查归属。失锁后不把受保护的变更当成成功。

支付模块为同一次调用传播同一个 owner。没有 JOB_KEY 的调试/手动入口改为由支付模块生成随机 owner，避免把 CDK 放进锁名，也避免此前 CLI 的 CDK＋时间戳超过新长度限制。合法任务 JOB_KEY 原样保留，非法或超长值停止支付。预热卡必须携带相同 owner receipt；没有找到生产者的代码路径，因此只验证消费端契约，不声称端到端预热链路已验收。

在识别支付结果后、调用结果持久化回调前，先设置内存 cardHandled 标记，防止回调、支付资料或用量写库异常被 finally 误认为“尚未处理”而普通释放。这个标记不是持久恢复机制：回调在冷却/隔离之前失败时，卡仍可能只是普通 in_use，其他回收入口尚未闭环。

## 2. 修改清单与接口契约

| 文件 | 变化 |
|---|---|
| services/kc-pay-gpt/mysql-store.js | owner/ID 严格校验；自动卡操作的同语句归属条件；保留锁定 receipt；runtime 释放传 owner |
| services/kc-pay-gpt/payment-retry.js | owner 校验、随机 fallback、全路径传 owner、预热 receipt、失锁停止和回调前 cardHandled |
| services/kc-pay-gpt/index.js | 未提供 JOB_KEY 时不再使用包含 CDK 的 fallback |
| services/kc-pay-gpt/chatgpt.js | 两个入口只传 JOB_KEY 或 undefined，由支付模块生成缺省 owner |
| services/kc-pay-gpt/test/mysql-card-cooldown.test.js | 适配并验证冷却/失锁契约 |
| services/kc-pay-gpt/test/payment-retry-safety.test.js | 支付回调、资料/用量失败、预热、失锁和清理回归 |
| services/kc-pay-gpt/test/payment-protocol-fallback.test.js | 适配归属与释放结果契约 |
| tests/security-round6-kc-card-ownership.test.js | 新增 164 项 store 离线模型测试 |
| tests/security-round6-kc-payment-callers.test.js | 新增 15 项 caller 兼容性测试 |

存储 owner 接受 1–64 位 ASCII 字母、数字、下划线、连字符，不 trim、不截断、不清洗；资产 ID 必须为正安全整数或规范数字字符串。支付模块显式 JOB_KEY 限 1–48 位，在存储中使用 payment_ 前缀；缺省 owner 使用 payment_debug_ 加 16 字节安全随机数的十六进制表示。releaseCard 返回 0/1，0 是未修改的幂等结果；支付正常流程要求释放恰好影响 1 行，否则停止。其他受保护卡变更影响 0 行时抛出 CARD_LOCK_OWNERSHIP_LOST。拒付冷却若失锁立即停止，其他数据库错误仍尝试带相同 owner 的隔离。

releaseRuntimeAssets 在任何 UPDATE 前验证两个 ID，随后分别执行带 owner 的 UPDATE；它不是跨资产事务，不能保证故障时两个资产全有或全无。管理员 setCardFrozen、邮箱预留 reservePoolEmail 没有纳入本轮自动卡归属改造。

## 3. 验证与证据边界

| 验证 | 结果 | 退出码 |
|---|---|---|
| 初始 157 项对修改前 dirty store | 1 PASS / 156 FAIL | 1 |
| 回调修复前选定断言 | 25 PASS / 10 FAIL / 65 SKIP | 1 |
| 最终原生定向，第 2–6 轮 | 315 PASS / 0 FAIL / 0 SKIP | 0 |
| 最终 KC 十文件 Vitest | 362 PASS / 0 FAIL | 0 |
| 调用入口兼容性 | 15 PASS / 0 FAIL | 0 |
| 追加 ChatGPT 两文件回归 | 18 PASS / 0 FAIL | 0 |
| 本轮最终定向合计 | **710 PASS / 0 FAIL**，只合计上述四个最终调用 | 四次均 0 |
| 修改/新增 JS 语法 | 9 个文件通过 | 九次均 0 |
| 9 文件增量在临时字节副本逆向恢复、正向重放 | PASS，分别核对修改前 7 文件及修改后 9 文件 SHA256 | 两次 patch 均 0 |
| 第 5 轮历史 KC 全量 71 文件 | **1672 PASS / 40 FAIL**，本轮未重跑 | **1** |
| 真实 MySQL、真实支付及生产验收 | **NOT RUN** | — |

原生 315 项包含原有 151 项和本轮 store 164 项。164 项使用真实完整 store 模块加 SQL WHERE 驱动的离线状态模型，并非真实 MySQL；mysql2 FOUND_ROWS 只离线实例化配置，不能作为服务器 affectedRows 实际语义证据。15 项 caller 测试中两个 ChatGPT 入口执行真实完整模块且依赖、页面/checkout/支付均 mock；index 仅执行 owner 表达式并检查传参契约，不是完整 CLI/browser 测试。

710 项在 dirty 本地源码上执行，不能称为全量通过或干净发布候选验证。原始失败、中间通过和最终通过日志分别保留，不叠加计数。首个应用脚本写源码前失败后的 native-first 日志仍属于旧源码结果。初始测试是 157 项，后增至 164 项；未保存初始 157 项测试源码快照，不能用当前测试冒充逐字节可复现的旧版本。命令与退出码哪些由会话记录重建，见 raw-provenance.json。

历史 40 项失败分别为 checkout-debug-server 26、gpt-outsourcing-admin 2、grok-commerce 2、pricing-flow 1、proxy-region-matcher 1、proxy-session-and-region 1、recharge-card-fixed-scroll 1、recharge-ui 6。第 5 轮两项 UI 复跑仍失败。该历史结论继续保留；本轮没有证明它们已解决，也没有重写第 5 轮证据。

离线启动器仅继承有限环境变量并注入合成 session key，Node guard 阻止真实 .env* 读取及 net/tls/dgram 连接。它不是操作系统、Chromium/native addon 或独立子进程的完整网络沙箱；跨轮累计 blocked-read 日志不视为本轮独立证据。归档前有限凭证形态扫描未匹配，并非完整无秘密证明。

## 4. 仍未闭合的资金风险

| 优先级 | 剩余方向 | 当前边界 |
|---|---|---|
| P1 | 支付结果持久恢复与回收联动 | 内存 cardHandled 不能替代持久 pending/manual 状态；回调失败后的普通 in_use 卡仍可能被其他入口清理 |
| P1 | releaseStaleAssetLocks | 目前对 gptapi 未结算任务有保护；普通 payment owner 尚无同等支付状态保护 |
| P1 | releaseCardsByOwner 与 server 清理 | 即使 owner 精确，仍仅依据正常状态清理，未根据 payment_state 判定可回收；server 三处调用需与持久恢复一并收紧 |
| P1 | 租约代际和旧进程继续提交 | 相同 owner 重入/ABA 没有 generation/fencing；数据库 CAS 不阻止失锁旧进程继续向外部支付系统提交 |
| P1 | 真实数据库故障与全量欠账 | MySQL 并发、死锁、断连、COMMIT 不明、崩溃恢复未验收；历史全量 40 FAIL 未解决 |
| P2 | 跨资产释放和全系统复核 | 两个 runtime UPDATE 不是跨资产事务；主站、TG、NewAPI、WAF/权限和运行版本另行核验 |

静态复查时 reserveCard 和 reserveAssetRow 的 card 分支都要求 in_use=0；不能声称这两个入口本身直接抢占超时的 in_use 卡。reserveAssetRow 的 phone 分支允许 stale 条件。银行卡超时清理风险来自单独的 releaseStaleAssetLocks 等回收入口。下一轮先设计“支付提交证据持久化→确认未扣款/成功/未知→有依据地结算或隔离→回收”的状态闭环，覆盖超时、批量和崩溃清理；不得靠缩短超时或无条件重试处理结果不明。

## 5. 包装、备份和 Git 完整性

KC 是独立服务。静态 Dockerfile 的 COPY . . 会包含本轮四个 runtime 文件，KC .dockerignore 没有排除它们；Verify Dockerfile 不复制 KC。未构建镜像、未核验生产 host compose 或实际镜像内容，Vercel/Verify 发布成功也不能证明 KC 已上线。本轮未接触 /opt/kc-pay-gpt 的 .env、host docker-compose.yml、data/、debug_screenshots/、product_files/ 或 mysql_data。

基线分支 main，HEAD 与 origin/main 同为 75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8，归档前重新 fetch 成功且 behind=0。原有 551 条展开 dirty 状态记录在归档前全部保留。另观察到 js/engagement-runtime-loader.js 的范围外改动，保留并单独记录，不纳入本轮 delta，不推断改动来源。状态记录的保留不等于已保存整个工作区所有文件的历史字节。

修改前 7 份逐文件 dirty 字节快照位于 /tmp/kc-round6-owner-cas-20261108-before，清单及读回核验保存在证据目录。它们不是完整工作区/数据库备份，也未创建备份 commit 或 stash；/tmp 保留期限无保证。归档包含本轮精确 delta、临时副本逆向恢复与正向重放结果、原始日志、源码 SHA256、语法和包装边界。源码哈希不追认为已提交候选版本。

证据目录：docs/security-audit-evidence/2026-11-08-card-store-round6/。final-integrity.json 记录归档后 HEAD、remote、origin/main、index、staging、551 条原状态记录、9 个源码哈希和第 5 轮历史证据哈希的复核。evidence-manifest.json 收录报告和除自身外的证据文件哈希，它不是签名或不可篡改证据。

| 系统/能力 | 状态 |
|---|---|
| KC 本轮定向离线验证 | PASS：710 项 |
| KC 全量 | 历史 FAIL：1672 PASS / 40 FAIL；本轮重跑 NOT RUN |
| 真实 MySQL/支付/恢复验收 | NOT RUN |
| KC 生产独立产物 | NOT RUN；本地修复未上线 |
| 主站/Vercel、Verify/TG、NewAPI、WAF/生产权限 | NOT RUN |
| 提交、推送、PR、部署、SQL、游客购买启用 | NOT RUN |

## 归档后补充核验

补充核验边界：本轮 9 个变更文件、22 个归档源码文件和第 5 轮 39 个历史证据文件的哈希均与归档记录一致；551 条原始 dirty 状态行仍保留。范围外 `js/engagement-runtime-loader.js` 的当前哈希与先前归档时不同，来源未归因，未恢复或纳入本轮补丁。整份工作区的字节一致性不能据此标为 PASS；该范围外变化记录为 REVIEW，详见 `archive-inclusion-verification.json`。本次只补日志收录和归档检查，没有重跑测试。
