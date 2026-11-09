# 第 5 轮安全加固：KC 银行卡归属释放与 CDK/task 锁顺序

日期：2026-11-08。覆盖 KC 本地代码与离线验证；主站、TG 和线上防火墙本轮没有新增验收。全部改动未提交，未推送、未创建 PR、未部署，线上尚未生效。未执行 SQL、未连接真实数据库、未做真实支付，也未启用游客购买或启动生产 worker。

## 1. 本轮结论

按任务批量释放银行卡原来使用 `locked_by = ? OR locked_by LIKE %key%`，可能把相近任务、前后缀或其他命名空间的锁一起释放。本轮改为只释放合法原始 jobKey 对应的 `payment_<jobKey>`，使用二进制精确比较，同时保留 `in_use = 1 AND status = '正常'` 条件。非法输入不执行 SQL；不靠 trim、截断或清洗去猜旧锁，历史裸 key、provider/debug 锁及人工复核资产保留待核验。

本地准入/结算已采用 CDK→task；此前 retirement/provider 路径先锁 task 再锁 CDK，存在相反的锁定顺序。本轮增加 `lockActivationTaskCdkFirst` 并接入 retirement、provider save/reserve/finalize。先用不加锁的 task 查询定位 CDK，锁 CDK 后再锁定并重读 task；job_key、id 或 cdk_code 绑定变化就抛出 `ACTIVATION_TASK_BINDING_CHANGED` 并回滚，不能继续锁第二张 CDK。

以上收紧的是具体释放入口及四条事务路径，不是全部资产释放已经闭环；未证明真实数据库中不存在其他死锁或并发风险。

## 2. 代码范围和行为

- `services/kc-pay-gpt/mysql-store.js`：增加 CDK-first helper；retirement 按最新 task 证据决定是否释放；provider reserve 校验 CDK 存在、active、used_at 和最新 task 归属；save/reserve/finalize 同步锁顺序。
- `services/kc-pay-gpt/mysql-store.js`：`releaseCardsByOwner` 仅接受 1–48 个 ASCII 字母、数字、下划线、连字符组成的字符串 jobKey，精确匹配 `payment_<jobKey>`。大小写、尾空格、相近 key、provider/历史命名空间均不能扩大释放范围。
- `services/kc-pay-gpt/test/gpt-outsourcing-store.test.js`：有效 CDK fixture 增加 `is_active: 1`，使原有成功路径符合新的准入前提。
- `tests/security-round5-kc-owner-locks.test.js`：新增 44 项，用真实 store 模块及 VM 注入的离线 mysql2 状态模型，覆盖精确释放、四路径锁顺序、等待 CDK 时未提前持有 task 锁、task 绑定变化/删除、fresh payment/provider/recovery 证据、缺失/停用 CDK、legacy hold、回滚和连接释放。

三个 server 清理调用静态复查均传入 `task.jobKey`。payment-retry 的标准付款 owner 是 `payment_<jobKey>`；其历史/调试 fallback 命名不被本轮批量释放猜测兼容。保留 legacy hold 入口；缺失 CDK 不能授权正常结算或释放资产。未增加自动死锁重试或 COMMIT 结果不明时的自动重试。

## 3. 验证结果

| 验证 | 结果 | 完成退出码 |
|---|---|---|
| 最终 44 项对修改前 dirty store | 7 PASS / 37 FAIL | 1 |
| 最终原生定向回归（第 2–5 轮） | 151 PASS / 0 FAIL | 0 |
| KC 九文件定向回归 | 306 PASS / 0 FAIL | 0 |
| 本轮最终定向合计 | **457 PASS / 0 FAIL** | 两次均 0 |
| KC 全量 71 文件 | **1672 PASS / 40 FAIL / 0 SKIP**；63 文件通过、8 文件失败，共 1712 项 | **1** |
| 新观察到的两项 UI 动画失败复跑 | 2 FAIL / 16 SKIP；只选择两项断言，无通过项 | 1 |
| 三个修改/新增 JS 的语法检查 | 三个均通过 | 三个均 0 |
| 逐文件备份增量的空白检查 | 无空白诊断；`--no-index --check` 有差异退出 1，不能记为 0 | 三个均 1 |

457 只合计两个最终定向调用，不叠加 baseline、中间结果、全量或 UI 复跑；KC 全量包含部分已经定向执行的测试。定向通过不能替代全量通过。

初次 baseline harness 等待旧实现不会触发的事件而被中断，退出 1，没有完整计数；原日志保留。随后 37 项 baseline 为 7 PASS / 30 FAIL，修复后 37 PASS，原生中间回归为 144 PASS；最后补齐 7 项才得到最终 44 项 baseline 和 151 项定向结果。各阶段日志分开归档，不能混作同一次运行。

### 3.1 全量失败与历史记录分别保留

与第 2 轮历史 1693 项（1620 PASS / 72 FAIL / 1 SKIP，退出 1）按文件和规范化 fullName 对照：本次 40 个失败中有 36 个重复失败，4 个为本次新观察到。历史原记录不修改，测试数量和运行条件存在差别，不能据此把全部变化归因于本轮修改。

| 本次失败文件 | 失败数 |
|---|---:|
| checkout-debug-server | 26 |
| gpt-outsourcing-admin | 2 |
| grok-commerce | 2 |
| pricing-flow | 1 |
| proxy-region-matcher | 1 |
| proxy-session-and-region | 1 |
| recharge-card-fixed-scroll | 1 |
| recharge-ui | 6 |

4 个新观察到的失败：

- proxy-region-matcher 选择数据库代理池：`TEST_NETWORK_CONNECT_BLOCKED`，Node guard 阻止 MySQL 连接。
- proxy-session-and-region 的 CONNECT relay 重试：同一 guard 阻止 loopback HTTP 请求。两项均作为隔离受限保留失败，不放松 guard 或连接真实数据库来消红；未验证对应功能在真实目标可正常工作。
- recharge-ui 的 native-height mobile card：单帧移动约 153.7px，断言要求小于 50px。
- recharge-ui 的 intermediate viewport heights：反向移动帧数为 2，断言要求 0。两项单独复跑仍失败，复跑未改源码或断言；该静态页面测试不导入 mysql-store，但当前证据不足以确定根因或把失败归因于本轮 patch。

历史另 36 个失败所在的 billing-form、claude-navigation、claude-payment-flow、grok-native-flow、local-preview-recovery、recharge-routing 六个文件本次通过。此为后续运行的结果，不追认历史为 PASS。机器对照列表保存在 `full-regression-comparison.json`。

## 4. 离线模型和生产证据边界

本轮测试执行真实 store 代码，用可控状态模型模拟 mysql2、事务写入、暂停 CDK 锁获取及 task 证据变化。这验证程序调用顺序和受控交错下的决策；不能替代真实 InnoDB 行锁/间隙锁、隔离级别、死锁、断连、COMMIT 不明或崩溃恢复验证。

launcher 仅继承 PATH/TMPDIR/LANG/TZ，使用合成 Session key；Node preload 阻止真实 `.env*` 文件读取和 TCP/TLS/dgram 连接，包括 loopback。它是 Node API guard，不是操作系统沙箱，也不是完整 Chromium/native addon/独立子进程网络隔离证明。跨轮累计 blocked-reads 日志未复制为本轮独立证据。

日志原样复制。命令、退出码及计数部分依据会话记录整理，保留 full/UI wrapper 元数据。`source-manifest.json` 是归档时 dirty 工作区的源码哈希；没有追认“测试绑定了干净候选提交”。本轮仅保留逐文件修改前备份和可逆 delta，不是完整工作区/数据库备份，不能用于声称满足发布备份门槛。

## 5. 独立 KC 产物边界

KC Dockerfile 第 43 行 `COPY . .`、第 58 行启动 `node server.js`；`.dockerignore` 不排除本轮 mysql-store runtime 文件。以上只是静态包含关系；生产 host compose、Docker build 和实际镜像本轮均未核验。

Verify Dockerfile 不复制 KC 源码，所以未来 Vercel / Verify 发布成功不能证明 KC 修复上线。KC 必须独立核验对应源码/产物和健康状态，并保留 `/opt/kc-pay-gpt/.env`、host compose、data、debug_screenshots、product_files 及 mysql_data。主站、TG、NewAPI、WAF 和生产权限本轮均为 NOT RUN。

## 6. 后续风险与优先级

| 优先级 | 待处理项 | 当前证据边界 |
|---|---|---|
| P1 | `releaseCard(cardId)` 仍按 ID 释放，无 owner 条件 | payment-retry 有三处调用；两处传入的第二参数当前函数不接收。需追踪迟到 finally/旧任务释放新锁等路径，本轮未修复 |
| P1 | `releaseRuntimeAssets` / `releaseAssetById` 的同类释放归属 | 仍需逐入口审计，不能用精确批量释放的通过结果覆盖 |
| P1 | 真实隔离 MySQL 并发、死锁、断连、COMMIT 不明和恢复 | NOT RUN；执行 SQL 需用户另有明确授权 |
| P1 | KC 全量回归欠账 | 当前 40 FAIL 保留；2 项隔离阻止、2 项新增 UI 失败与 36 项重复失败分别记录 |
| P2 | 测试中的外部代理凭证形态 URL | 静态发现待核验/脱敏；未测试有效性，未确认泄露，不在报告复制值 |
| P2 | 多实例共享限流、CVV/产品凭证全面加密、消息字段统一脱敏、持久 pending 恢复 | 本轮没有完成，不据局部修复声称闭环 |
| REVIEW | 主站/TG/WAF 与生产运行版本、权限 | 本轮无新增验收证据 |

P1/P2 表示继续处理的优先级，不代表已经证明生产可利用或发生损失。下一轮先追踪按 ID 释放的所有调用及失败恢复，再设计带归属/租约的受约束释放和离线交错验证；不要直接用宽泛自动重试掩盖资金结果不明。

## 7. 证据与 Git 状态

证据目录：`docs/security-audit-evidence/2026-11-08-card-store-round5/`，保存逐文件备份清单与读回核验、本轮精确 delta 及临时副本逆向恢复核验、原始失败/中断/通过日志、命令、计数、源码哈希、隔离工具、全量失败对照及包装边界。

基线分支为 main，HEAD 与 origin/main 同为 `75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`，fetch 成功且 behind 为 0。本轮前 510 条展开 dirty 状态在归档前全部保留，新增两条为 fixture 修改和第 5 轮新测试；归档自身会增加文档路径。未暂存、未提交、未推送、未创建 PR，未执行 reset/restore/clean/rebase/分支切换。最终状态见 `final-integrity.json`。

| 系统 / 链路 | 本轮状态 |
|---|---|
| KC 最终本地定向验证 | PASS，限 457 项 |
| KC 全量 | FAIL，1672 PASS / 40 FAIL |
| KC 生产独立产物 | NOT RUN；修复未上线 |
| Vercel production | NOT RUN |
| KVM4 Verify Server / TG worker | NOT RUN |
| KVM4 Sub2API / NewAPI | NOT RUN |
| WAF / 生产数据库 / 权限核验 | NOT RUN |
| SQL / 真实交易 / 游客购买启用 | NOT RUN |
