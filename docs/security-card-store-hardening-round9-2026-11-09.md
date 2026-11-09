# 发卡站安全加固，第九轮：已授权的隔离 MySQL 验收

日期：2026-11-09（Asia/Shanghai）。范围：**仅 KC 卡锁实验，不是生产安全验收或发布**。

## 1. 授权与实验边界

用户在本会话明确回复“授权”，范围为创建全新的一次性本地 MySQL 8.4 实例，
执行建库及合成数据读写/清理 SQL，运行 12 项卡锁验收；不连接生产、不提交、不部署。

- 使用已安装的 Homebrew MySQL **8.4.11**，不是 Docker，也未启动或修改既有 MySQL 服务。
- 每次实例使用新建的 `0700` 临时根目录、全新 datadir 和独立 socket/PID/tmp/日志。
- `mysqld --no-defaults`，干净环境；初始化和 fixture 期间关闭 TCP，只通过该 socket 核对 datadir、UUID 与版本。
- mysql 客户端使用 `--no-defaults --no-login-paths`，不读取现有配置或登录文件；实验 root 的公开合成密码在 socket 阶段设置。
- 随后只监听 **127.0.0.1:23316**，关闭 mysqlx 与 local infile；以 PID/启动参数/lsof 验证该监听属于新实例。
- 实验账号只有该实验库 SELECT/INSERT/UPDATE/DELETE，无角色、全局权限或 GRANT OPTION。
- target JSON 为绝对路径、普通文件、`0600`；身份、标识、表集和空表检查通过后才运行场景。
- runner 使用固定 pool 参数和 loopback 网络限制；每条驱动 SQL 在发送前落到绝对路径文件，不记录参数或结果中的卡资料。
  这些附加措施是受控实验的 API 级约束，不是通用 OS sandbox。

完整路径和身份在 `docs/security-audit-evidence/2026-11-09-card-store-round9-mysql/` 的
`context.json`、`listener-01.json`、`sql/scope-review.json` 及 `attempt-03/` 对应记录中。
没有读取业务 `.env`、导入生产备份/数据、执行真实支付、启动业务 worker 或使用 KVM4。

## 2. 最终结果：真实 MySQL 12/12 PASS

最终结果来自 **attempt-03 的全新实例**，不是清空失败库后掩盖失败：

| 自动场景 | 最终结果 |
| --- | --- |
| 字节精确 owner、一次性 hold、完成后释放 | PASS |
| 两个并发 reserve 只取得同一张卡一次 | PASS |
| pending hold 经各清理入口仍保留 | PASS |
| 运行中/未知/待核账/owner 不符/缺失/debug 任务不被安全清理 | PASS |
| failed/cancelled + not_started/declined 正向清理 | PASS |
| hold/清理竞态，保护门未成功则合成提交为零（12 次样本） | PASS |
| 两连接真实 InnoDB 死锁与回滚 | PASS |
| 未提交连接销毁后回滚 | PASS |
| COMMIT 发送前销毁连接，保留原始错误 | PASS |
| COMMIT 成功后丢弃客户端结果，卡不能复用 | PASS |
| hold 写入成功后丢弃客户端结果，卡不能复用 | PASS |
| 模块重载后仍保留持久 hold | PASS |

证据：`attempt-03/logs/execute-03.log`，exit **0**；preflight PASS；
`sourceBefore` 与 `sourceAfter` 的四个 runtime/schema 哈希一致。
本次实际发送 **874 条**已审查范围内的 SQL（含会话、前置检查、清理与事务语句），
只有一条返回预期的 **ER_LOCK_DEADLOCK**；详见 `attempt-03/sql-events-01.json`。
874 是语句数，不能当成 874 项验收或事务。

只读收尾检查确认最终合成卡 **1 张、hold 1 张、可复用 0 张**，其余三张业务表为空。
已正常停止实验 mysqld，端口 23316 无监听；成功库与失败库的数据目录均保留，未删除或重初始化失败现场。
临时目录可能被系统清理，不是长期可恢复备份承诺；持久证据是本轮 SQL/日志/源码快照与哈希。

## 3. 发现、修正与保留的失败

真实实验发现的是**夹具错误**，本轮没有修改生产支付 runtime 或 schema：

1. **准备脚本写文件错误**：Python `Path.open()` 不支持 `opener` 参数。
   当时已完成 socket-only fixture 与 loopback 启动，但还未运行场景。
   保存原脚本和 exit 1 记录，修正为内置 `open()`，只补写 `0600` target 文件；未重建或重跑 fixture。
2. **execute-01 / preflight FAIL**：`CURRENT_USER()` 的别名未用反引号引用，在真实 8.4.11 返回 `ER_PARSE_ERROR`。
   12 场景全 NOT RUN。只读诊断确认未引用形式失败、引用形式成功，随后修正夹具 SQL 并补断言；
   `current_role` 别名也统一引用，但该未引用形式在本次诊断中本来可执行，不能把它也描述成已复现的语法错误。
3. **execute-02 / 首场景 FAIL**：格式非法的尾随空格请求 owner 返回 `ASSET_LOCK_OWNER_INVALID`，
   夹具却预期 `CARD_LOCK_OWNERSHIP_LOST`。这是更早的安全拒绝，不是锁被绕过。
   剩余 11 场景 NOT RUN，未继续清理。保留并停止原实例，换新 datadir/runId/UUID 后才重跑。
4. 修正错误码预期，同时**增加**数据库中存储 owner 尾随空格、请求 owner 合法的实际 SQL 比较检查，
   仍必须拒绝 hold 与释放；补充格式非法 owner 在进入 SQL 前拒绝的离线用例。
   未降低身份、权限、owner 字节比较、hold 或首错停止条件。

上述失败均保留，未改写成 PASS。`setup-attempt-01.json`、`execute-attempt-01.json`、
`execute-attempt-02.json`、只读诊断、原始报告、SQL 发送清单及修改前快照可独立复核。

## 4. 离线回归与源码完整性

| 验证 | 文件/检查数 | PASS | FAIL | Exit |
| --- | ---: | ---: | ---: | ---: |
| 第八轮夹具测试（增加 1 个错误码用例） | 1 文件 | 80 | 0 | 0 |
| 第七轮持久 hold 定向回归 | 1 文件 | 119 | 0 | 0 |
| 本轮最终离线合计，`logs/offline-final-01.log` | 2 文件 | **199** | **0** | 0 |
| 活跃文件语法，`syntax-scope.json` | 12 Node + 3 Python AST | 15 | 0 | 0 |

重复的离线运行不累加；3 个历史快照另做了语法检查，但不计入活跃文件的 15 项，
语法通过不能证明这些保留的旧错误脚本可运行。
此前 KC 全量历史仍为 **71 文件 1672 PASS/40 FAIL/exit 1**，本轮没有重跑或将其改绿。

工作基线 `main` / `HEAD=origin/main=75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`，fetch 后落后计数 0。
只修改夹具 `lab.cjs`、夹具测试和 README（追加后续记录）；新增本轮报告及证据。
四个 runtime/schema、前轮证据与原暂存区未被改动；README/夹具/测试修改前备份均读回一致。
最终清单与核验见 `source-manifest.json`、`verification-results.json`，不把脏工作区当作发布候选。
`js/engagement-runtime-loader.js` 更早交接哈希差异仍 **REVIEW**，未归因、未修改或恢复。

## 5. 仍未验证与后续优先级

以下三项仍 **NOT RUN**，本次没有获得或执行其进一步故障操作：

- 真实 TCP COMMIT 回包丢失；成功后丢弃客户端结果不是这个网络窗口。
- 带持久 hold 的业务 worker 进程重启；模块重载不是进程重启。
- 带持久 hold 的 mysqld 崩溃/非正常重启；建库阶段或收尾的正常停启不是崩溃验收。

12 次竞态采样不是所有并发交错的穷举；本地 8.4.11、子集 schema 与 VM 注入也不等于生产配置、
完整应用启动、外部支付、网络故障或端到端结算已经验证。
持久 hold 仍不是逐 attempt 的完整幂等账本，同 owner ABA、在途请求失锁、部分记账、
人工核账与保守锁定的可用性成本仍保留。

后续先为上述三项分别制定隔离验收与恢复边界，再推进 attempt 级幂等账本/核账设计。
主站、TG、NewAPI、WAF 不在本轮实际运行范围，不以本 KC 局部结果替代其审计或发布证据。
虎皮椒、爱发电继续排除。本轮**没有提交、推送、PR、部署、镜像构建或生产 SQL**。
