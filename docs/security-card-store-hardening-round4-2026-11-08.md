# 发卡站安全加固第 4 轮：KC 本地结算与自动续费核验

日期：2026-11-08。范围：KC `local_card_pool` 本地充值 worker 的任务归属、支付证据、事务结算和自动续费结果。虎皮椒、爱发电继续排除。

**本地定向测试 292 PASS / 0 FAIL；未提交、未推送、未部署，线上尚未生效。** 该结果不代表 KC 全量通过，也不代表主站、KC、TG 三系统完成安全验收。

## 1. 基线、修改与备份

- 分支 `main`；`HEAD = origin/main = 75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`。本次归档前重新执行 `git fetch origin main`，落后数为 0；origin 为规范 HTTPS 地址。
- 这是已有大量修改的工作区，不是干净发布候选。本轮开始的展开清单为 463 项；归档前为 464 项，新增路径仅 `tests/security-round4-kc-local-settlement.test.js`。原有路径均存在并可读；这仅证明路径保留，不等同于所有旧修改内容的完整哈希核验。
- 本轮增量文件：`services/kc-pay-gpt/mysql-store.js`、`services/kc-pay-gpt/server.js`、`services/kc-pay-gpt/test/recharge-routing.test.js`，以及上述新测试。最终 delta 相对于修改前的 dirty 文件备份生成，**不是整个工作区相对于 HEAD 的发布差异**。
- 初始备份 `/tmp/kc-local-settlement-20261108-backup/`；后续备份 `/tmp/kc-round4-pending-renewal-implementation-before/`、`/tmp/kc-round4-worker-error-before/`。8 份有预存哈希的文件均重新读回且匹配。`/tmp/kc-round4-renewal-followup-before/` 的另 3 份快照可读，但没有预存 manifest，只记录本次读取哈希。
- 这些是逐文件备份，不是完整工作区、Git stash/commit 或数据库备份。所有原备份保留；归档保存其 manifest 和核验结果。

## 2. 本轮修复

| 风险 | 实际修改 | 验证边界 |
|---|---|---|
| 任务先结束、CDK 返还后失败，造成任务与资产状态分裂 | 新增 `updateLocalActivationTask`，同一连接/事务内核验当前归属、写结算结果、清除明文及加密 Session，并按安全条件归还 CDK；检查 affectedRows | 原始用例复现 0 PASS / 1 FAIL，修复后离线故障注入通过；真实 MySQL 未验证 |
| 旧 worker / 延迟 stdout 覆盖新状态或别人的 CDK | 锁定 CDK→task→最新归属；限制允许状态；拒绝结束任务和不匹配归属；串行化 stdout 持久化，终结排在前置写入之后 | 覆盖陈旧归属、拒绝更新、重复结算与延迟回调 |
| 弱支付结果覆盖 started / unknown / succeeded 后重试或返卡 | 合并支付证据，保留较强状态；识别“支付结果未知”；支付风险或写入不明时停止自动重试，经受保护事务尝试转人工复核 | 该 worker 不再按 CDK 单独调用补偿返卡；其他返卡路径仍需继续审查 |
| COMMIT 回应丢失触发补偿，实际已支付却放出资产 | 持久化异常设置不确定状态；不再推测性解锁或报告成功；rollback 失败保留最初错误 | 区分写入前失败与已提交但丢回应。不能断言报错后数据库必定未提交 |
| 自动续费未核实却先落库 success | 支付完成后先保存 `manual / succeeded / recoveryRequired=true / autoRenewStatus=pending`，保留 CDK 并清除 Session；再使用 worker 续费证据或执行取消/核验；受归属保护的 annotate 保存确认结果后才报告成功 | 取消异常、结果未知、annotation 拒绝/失败/回应丢失均不发成功通知；回应丢失时数据库也可能已保存确认成功 |
| 错误通知与真实落库结果不一致，或直接暴露异常详情 | 状态/通知使用实际持久化结果；人工复核不误报卡池耗尽；worker catch 使用固定公开错误文案，诊断进入既有脱敏函数 | 新增回归先复现 70 PASS / 1 FAIL。只关闭此 catch 的公开消息泄露，未证明所有 message / autoRenewMessage 均被统一脱敏 |

`manual / pending` 是供人工复核的持久记录。Session 已清除，本轮没有证明自动恢复取消续费的能力；外部取消也可能已经生效但未收到响应。不得对不明结果直接重新支付。

## 3. 本地验证与原始失败记录

| 检查 | 结果 |
|---|---|
| 原生 Node 定向：round4 local settlement + round3 atomic admission + round2 activation | 107 PASS / 0 FAIL，退出 0 |
| KC Vitest 定向 6 文件：routing、outsourcing store/recovery、task safety、local preview recovery、diagnostics | 185 PASS / 0 FAIL，退出 0；其中 routing 71 项 |
| 本轮最终定向合计 | **292 PASS / 0 FAIL** |
| 四个修改/新增 JS 文件语法检查 | 4 PASS / 0 FAIL |
| 相对逐文件备份的增量空白检查 | 无诊断。原始 no-index 检查退出 1；本机对照表明干净差异退出 1、故意行尾空白退出 3。原脚本把所有非零视为失败，解释已另存，原输出未改 |

保留原始失败：分步结算 0/1、旧格式未知支付 63/1、续费先报成功 65/2、公开异常详情 70/1（依次为 PASS/FAIL）。中间通过记录也单独保留，未替换历史失败。

第 3 轮 232 PASS 是历史结果。第 2 轮 KC 全量历史结果仍为 **71 文件 / 1693 项：1620 PASS / 72 FAIL / 1 SKIP，退出 1**；本轮没有重跑全量，不能估算剩余失败数量或宣称已经全绿。游客历史 promo archive 合同与 A5–G3 手工验收本轮均未执行，两类证据继续分开。

## 4. 离线与证据边界

测试 launcher 仅继承 PATH/TMPDIR/LANG/TZ，并使用合成 Session key；Node preload 阻止真实 `.env*` 文件读取和 Node TCP/TLS/dgram 连接，包括 loopback。它是 **Node API guard，不是操作系统沙箱**；不据此证明 native addon 或独立子进程隔离。归档不复制跨轮累计的 blocked-reads 日志以冒充本轮独立证据。

原生测试运行真实 store 模块和有状态 mysql2 替身，以全事务 mutex 串行化；worker 测试从真实源码提取函数并在 VM 中注入 mock store。这些测试可以验证程序分支、写入顺序与模拟失败后的决策，不能替代 InnoDB 行/间隙锁、隔离级别、真实断连、死锁或崩溃恢复。

`source-manifest.json` 是归档时未提交文件的哈希。测试日志原样复制，命令及完成退出码依据本次会话记录整理；没有追认“这些测试运行时已绑定干净候选提交”的证据。

## 5. KC 独立产物边界

KC Dockerfile 使用 `COPY . .` 并启动 `node server.js`，`.dockerignore` 不排除本轮 runtime 文件；仓库 compose 的 build 和 bind mount 包含 KC 源码。此为静态包含关系，生产 host compose 未核验。

`deploy/kvm4/verify-server.Dockerfile` 不复制 KC 源码，所以 Vercel / Verify 发布成功不能证明 KC 修复上线。未来需独立核验 KC 产物、对应 SHA 与健康状态，并保留 `/opt/kc-pay-gpt/.env`、host compose、data、debug_screenshots、product_files 和 mysql_data。本轮未构建 Docker、未 SSH、未部署。

安装在本机的 mysql2 默认 flags 包含 FOUND_ROWS，store pool 没有覆盖该设置；生产依赖版本与真实 affectedRows 行为仍为 NOT RUN。

## 6. 仍需优先推进

| 优先级 | 剩余问题 | 当前状态 |
|---|---|---|
| P1 | 统一本地准入/结算与既有 retirement/provider settlement 的锁顺序 | 本轮 helper 采用 CDK→task；既有部分路径仍 task→CDK。真实死锁与重试语义 NOT RUN |
| P1 | 真实隔离 MySQL 并发、断连、COMMIT 不明与恢复 | 离线模型通过，数据库级验证 NOT RUN；执行 SQL 需另有明确授权 |
| P1 | KC 全量回归欠账 | 历史 72 FAIL 保留，本轮没有全量结果；需要继续修复和重跑 |
| P1/P2 | `releaseCardsByOwner` 仍使用 `LIKE %owner%` | 归属匹配范围风险尚未闭环，应核对所有释放入口与兼容迁移路径 |
| P2 | 持久 pending 续费的人工/自动恢复流程 | 已留人工复核记录，自动恢复和外部幂等性未验证 |
| P2 | 多实例共享限流、CVV / 产品凭证全面加密、消息字段统一脱敏 | 本轮未完成；不能用 Session 清除或局部固定文案代替 |
| REVIEW | 主站、TG、WAF、生产权限与运行版本 | 本轮没有新的验收证据，不能套用 KC 定向结论 |

P1/P2 表示继续处理优先级，不代表已经在生产验证攻击成功或发生损失。下一阶段可先在本地梳理资产归属释放路径、统一锁顺序，并继续解决全量回归；真实数据库验证需独立安排。

## 7. 证据与系统状态

证据目录：`docs/security-audit-evidence/2026-11-08-card-store-round4/`。保存基线、逐文件备份核验、最终增量、原始失败/通过日志、语法记录、空白检查解释、隔离工具、源码及归档哈希。初始清单和归档前清单采用相同的 untracked 展开方式。

| 系统 / 链路 | 本轮状态 |
|---|---|
| KC 本地定向验证 | PASS，限 292 项 |
| KC 全量 | NOT RUN；保留第 2 轮历史失败 |
| KC 生产独立产物 | NOT RUN；本轮修复未上线 |
| Vercel production | NOT RUN |
| KVM4 Verify Server / TG worker | NOT RUN |
| KVM4 Sub2API / NewAPI | NOT RUN |
| WAF / 生产数据库 / 权限核验 | NOT RUN |
| SQL / 真实交易 / 游客购买启用 | NOT RUN |

未执行提交、暂存、推送、PR、部署、SQL、真实支付或生产 worker 启动；未读取真实 `.env`，未执行会丢弃工作区的 Git 操作。
