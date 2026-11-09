# KC 支付卡持久占用：隔离 MySQL 验收夹具

## 当前状态与边界

2026-11-09：仅完成本地离线验证，**没有创建或连接 MySQL，没有执行 fixture SQL 或 execute 模式**。
12 个真实数据库自动场景与 3 个手工故障场景全部 **NOT RUN**。本工具不是生产迁移、支付工具或上线脚本。

夹具通过 VM 读取当前 `mysql-store.js`，注入指定的实验 pool，只调用卡锁相关方法；
不启动 `server.js`，不读取 `.env`，不调用 `ensureReady()`，不运行真实支付或 worker。
它不证明主站、TG、NewAPI、WAF、完整 KC 支付链路或生产环境整体安全。

## 文件职责

- `cli.cjs`：默认只生成计划；execute 需要单独的确认字串和配置。
- `safety.cjs`：固定实验目标、严格参数与配置文件校验、拒绝业务环境变量、错误脱敏。
- `plan.cjs`：源码哈希、fixture 展开与场景清单。
- `fixture.sql`：新建实验库、标识表和四张业务表；没有在本轮执行。
- `store-loader.cjs`：读取实际 store 并注入 pool；确定性的客户端故障包装。
- `lab.cjs`：只读前置检查、限时连接、串行验收与首错停止。

fixture 是当前 schema 的卡锁相关子集，另包含清理逻辑引用的三个 `gpt_api_*` 列；
不是完整应用 schema，也不是可应用到生产的修复 SQL。合成卡号固定为 `SYNTHETIC-NOT-A-CARD`，
有效期与 CVC 为空。不要导入任何真实资产、历史任务、Session、支付或用户资料。

## 安全的离线入口

在仓库根目录运行以下命令只向 stdout 输出 JSON，**不会执行 JSON 中的 SQL**：

```sh
node services/kc-pay-gpt/acceptance/mysql-payment-hold/cli.cjs --plan --run-id 0123456789abcdef
```

无参数也只生成计划。输出必须包含 `mode=PLAN_ONLY`、`connected=false`、`sqlExecuted=false`。
target 模板中的 `serverUuid` 是故意无效的占位符，不能直接用于执行。

离线测试使用证据目录中的 `isolation/run.py`：清理环境后显式加载 `preload.cjs`，
在 Node API 层阻止网络连接、监听及常见 `.env` 读取路径。该 guard **不是 OS/native-code sandbox**，
不自动保护任意子进程；测试中另起的 Node 子进程也显式加载 guard。
日志文件采用独占创建，不覆盖此前结果。具体命令和计数见本轮报告及日志。

## 将来执行实验前的必要条件（本轮没有执行）

必须先获得用户对**隔离数据库 SQL 和故障验收**的明确授权，再逐项确认：

1. 使用本次新建、可整体丢弃、无生产数据及挂载的 MySQL **8.4** 实例。
   人工核对进程/容器身份、监听端口与网络路径，排除 SSH 隧道、代理和生产端口转发。
   **不能使用 KVM4、KC 现有库、共享库或生产备份克隆。** Loopback、UUID、标识行和低权限本身不能证明目标隔离。
2. 只映射 `127.0.0.1:23316`；不能使用 KC 的 `3311` 端口。不要对公网开放实验实例。
   不得自动启动 Docker、MySQL、worker 或更改现有服务配置。
3. 为该实验选择新的 16 位小写十六进制 runId，审查 plan 中完整 fixture SQL 和其目标范围。
   fixture 使用无 `IF NOT EXISTS` 的新库/用户创建，重名应失败，不能通过删现有数据或放宽检查继续。
4. 在已核实的一次性实例内，由实验管理员另行应用审查过的 fixture；
   只给 `kc_fault_harness@%` 该实验库的 SELECT/INSERT/UPDATE/DELETE，无角色、全局权限或 GRANT OPTION。
   fixture 的公开合成密码只适用于此隔离实例，绝非生产凭证。
5. 保持 `partial_revokes=OFF`；实验库授权使用转义下划线的库名。
   `CURRENT_ROLE()` 必须是 `NONE`，`SHOW GRANTS` 必须严格匹配实验权限。
   **实际 MySQL 授权输出及驱动兼容性仍待真实实例验证**；匹配失败时保留证据、诊断，不要直接放宽权限。
6. 从该实例核对真实 server UUID，保存绝对路径、非 symlink、大小不超过 4096 字节且权限 `0600` 的 target JSON。
   只允许 plan 模板中六个字段；不能加密码、URI、socket、额外驱动参数。
   runId、库名、UUID 与 `lab_identity` 必须一致，四张业务表必须为空。
7. 使用干净进程环境。execute 拒绝 `DB_*`、MySQL/MariaDB、KC、支付、Supabase、代理、
   `DATABASE_URL`、`NODE_OPTIONS`、`NODE_PATH` 等变量，不能 source 业务 `.env`。
   不要为了通过检查改动当前 shell 或生产配置；另起受控实验进程。
8. 最后审查对应源码哈希和 SQL 授权范围。execute 需要 `--execute`、绝对 `--config` 及
   `--ack isolated-synthetic-mysql-only`；ack 只是工具门槛，**不等于用户授权或隔离证明**。
   本 README 不触发也不授权该动作。

## 计划覆盖的 12 个真实数据库场景

1. 字节精确 owner、一次性持久 hold 与完成后释放。
2. 并发 reserve 只能有一个取得同一张卡。
3. pending hold 经清理仍保留。
4. 运行中、未知、待核账、owner 不符、缺失或 debug 任务不能被当作安全清理依据。
5. failed/cancelled 且明确 not_started/declined 的正向清理。
6. hold 与清理竞态，保护门未成功时合成提交计数必须为零；没有真实支付请求。
7. 两个连接的 InnoDB 死锁及回滚清理。
8. 未提交连接销毁后的回滚。
9. COMMIT 发出前销毁连接并保留原始错误。
10. COMMIT 成功后故意丢弃客户端结果，不能立即复用卡。
11. hold 写入成功后故意丢弃客户端结果，不能复用卡。
12. 重新加载 store 模块后仍保留持久 hold。

场景 10/11 是**客户端成功结果注入丢弃**，不是实际 TCP COMMIT 回包丢失；
场景 12 是**模块重载**，不是 worker 进程或 MySQL 重启。真实 TCP 回包丢失、
worker 进程重启、mysqld 崩溃重启列为独立手工场景，不能用上述自动场景替代。

## 执行后的判断规则

- 前置检查只做身份/权限/表集/标识/空表的 SELECT 或 SHOW；连接包装另设会话锁等待上限。
- 前置检查通过后，每个场景之前仅 DELETE 四张实验业务表；不删标识、不 DROP/TRUNCATE。
- 任何失败立即停止，不再执行后续场景或清理，保留失败现场；超时/驱动失败销毁连接，避免回池。
- 报告只给受控错误码，不输出原始错误 message、SQL 参数、卡数据或凭证。
- 每个场景前后核对源码；变化标记 REVIEW，不能算通过。即使自动场景 PASS，手工场景仍独立记录。
- 不自动销毁实例、删库、调整业务锁或恢复生产配置；实验清理需另行明确处理。

## 残余风险与发布边界

持久 hold 不是逐 attempt 的完整幂等账本；同 owner ABA、外部请求在途时失锁、
部分记账以及保守锁定造成的可用性代价仍需后续设计与核账流程。
不得仅凭这些离线测试修改释放条件、恢复支付或声称“所有攻击均可防住”。

本轮未改 runtime/schema/镜像规则。Vercel 静态发布排除了 `/services/`、`/tests/`、`/docs/`；
KC 当前 Dockerfile 使用 `COPY . .`，并未排除 `acceptance/`，因此将来全量构建可能带入本夹具，
但夹具不是服务启动入口，也未被接入 HTTP 路由。发布前仍需单独审查是否将验收工具排除出镜像；
本轮没有构建镜像或验证生产制品，也没有以其它链路部署成功替代 KC 验证。

## 后续记录：第九轮已授权的真实实例验收

以上“未执行”描述保留为第八轮历史，不覆盖其证据。2026-11-09 用户另行明确授权后，
第九轮使用全新本地 MySQL **8.4.11** 数据目录完成了 **12/12 自动场景 PASS**。
三项手工故障（TCP 回包丢失、worker 进程重启、mysqld 崩溃重启）仍全部 **NOT RUN**。

真实验收发现并修正了两处夹具问题，不是生产支付修复：身份查询的保留字别名缺少反引号；
格式无效 owner 的预期错误码写成了归属丢失。现同时测试格式校验拒绝与数据库中尾随空格 owner
的字节精确比较，未放宽保护条件。失败记录和失败实例数据目录保留，最终通过来自另一全新实例。
本次未改 `mysql-store.js` 等支付 runtime 或 schema，未连接生产、付款、提交或部署。

实验进程已正常停止，23316 无监听；临时数据目录保留，不是长期备份承诺。
第九轮结果、只读收尾检查和重试归因见 `docs/security-card-store-hardening-round9-2026-11-09.md`
及 `docs/security-audit-evidence/2026-11-09-card-store-round9-mysql/`；不得回写第八轮结果为 PASS。
