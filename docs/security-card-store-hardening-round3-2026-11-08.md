# 发卡站第三轮安全加固实施记录（2026-11-08）

本轮完成 KC 自动充值核销入口、派发前补偿和启动恢复的本地加固，重点降低“CDK 已占用但没有可恢复任务”以及“旧任务误释放新任务 CDK”的风险。主站与 TG 本轮没有运行时代码改动；虎皮椒、爱发电继续排除。

**最终两组定向测试共 232 PASS / 0 FAIL。没有 commit、push、创建 PR、部署、执行 SQL、连接生产数据库、启动 worker、修改生产配置或创建真实交易。线上尚未因本轮工作发生变化。**

本报告是新增本地记录。第二轮报告、失败日志与历史验收结果保持原样。定向通过不等于 KC 全量通过，也不等于三套系统的交易风险已闭环。

## 1. 基线、备份与差异边界

| 项目 | 记录 |
|---|---|
| 工作目录 | `/Volumes/chao/AI/xianyu_profit_calculator` |
| 分支 | `main`，没有切分支 |
| HEAD / origin/main | `75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8` |
| origin | `https://github.com/zaoyoe/Zaoyoe-Studio.git` |
| 归档前 freshness gate | `git fetch origin main` 成功；`HEAD..origin/main` 落后计数为 0 |
| 新归档前 Git porcelain 条目 | 352；整个工作区的既有工作，不能全算本轮 |
| 发布候选 | `NOT_A_CLEAN_RELEASE_CANDIDATE`；没有新候选 commit |
| 用户此前报告的 SQL | `USER_REPORTED_APPLIED / NOT_INDEPENDENTLY_VERIFIED` |
| 本轮迁移、SQL、真实 MySQL 验证 | 没有新增迁移；SQL 与真实 MySQL 验证 `NOT RUN` |

修改前 dirty 文件备份：

```text
/var/folders/wl/8wb6rp_13z17vf97m3fkk0dw0000gn/T/kc-atomic-hardening-20261108-fozv701z
```

已重新读取并核验 5 份备份 SHA256，全部匹配。前 4 份登记在 `manifest.json`，WebSocket fixture 的补充备份登记在 `additional-backup-local-preview-recovery.json`。新增原子性测试原先不存在。

这是文件字节备份，**不是完整 dirty 工作区备份、Git commit/stash 或可恢复生产数据库备份**；原备份位于临时目录。没有执行 reset、restore、rebase、切分支或清理既有改动。证据中的 960 行 patch 相对本轮修改前 dirty 文件生成，不是相对 HEAD 的全量发布 diff。

## 2. 已实施的加固

### 2.1 CDK 占用和任务创建使用同一事务

`services/kc-pay-gpt/mysql-store.js` 的 `createTaskLog` 支持连接注入；新增 `createActivationTask` 在同一连接、同一事务中：

1. 锁定并重新检查 CDK 的 active、自助类型、占用状态和数据库时间冷却。
2. 检查 running/manual、需要恢复、支付结果不明及外包尚未结算的阻塞任务；已有 running 任务返回现有 jobKey，不创建第二个任务。
3. 重新核对 platform、plan_type、payment_region，避免读卡信息后配置变更仍按旧套餐派发。
4. 用条件更新占用 CDK，校验 affectedRows，然后加密 Session 并插入任务；插入或加密失败时共同回滚。

事务 COMMIT 结果不明时向上传播，不按 CDK 单独“补偿解锁”。故障注入已覆盖数据库应用提交但调用方丢失提交响应，以及后续重试恢复已持久化任务。

这些结果基于离线模型，不能声称已验证生产 InnoDB 的真实崩溃一致性或连接故障。

### 2.2 安全返卡必须确认具体任务归属

新增 `retireSafeActivationTask(jobKey, options)`：锁定任务、对应 CDK、最新任务归属与其他阻塞任务，重新读取当前状态。

默认只接受 running、无需恢复、payment_state 为 not_started、已知执行模式、没有任何外包订单号/任务号/raw 证据的任务。启动恢复显式传 `allowDeclined` 时，仅允许本地明确 declined 的额外情况。

必须确认该任务是 CDK 当前最新归属、CDK 仍 active 且已占用，并且没有其他阻塞任务，才在同一事务中结束任务、清理 Session 和返还 CDK；两次 UPDATE 均检查 affectedRows。拒绝则保留任务和 CDK，返回拒绝原因。

这次接入范围为核销入口的派发前补偿与安全启动恢复。**普通本地 worker 的所有失败收尾尚未改用这一原子路径。**

### 2.3 派发结果不明时保留占用

`services/kc-pay-gpt/server.js` 的入口改用 `createActivationTask`。已有任务的重试返回现有 jobKey 与 taskAccessToken，不重复派发。

外包 Session JSON 解析在派发边界前完成。调用外包 worker 或本地 worker 之前即标记 `workerDispatched`，因为同步抛错也不能证明 worker 从未启动。跨过边界后保留 CDK、任务及容量槽，避免启动结果不明时允许第二次充值。

派发前异常只尝试按 jobKey 安全收尾，不回退到无归属的 `markCdkUnused`。安全收尾拒绝或自身异常时保留证据待复核。

代价是异常时可能保留容量，需要启动恢复或人工复核；本轮没有实现完整自动恢复与超时释放，不能描述成完全自愈。

### 2.4 启动恢复重新检查数据库当前证据

启动恢复使用 `retireSafeActivationTask(..., {allowDeclined: true})`。如果任务所有者或支付证据已经变化，安全返卡拒绝；此时保留当前行，避免用启动时的旧快照覆盖新证据。

外包相关任务继续由原外包恢复路径处理。本轮未启动任何实际 worker、浏览器充值任务或生产服务。

### 2.5 修正 WebSocket 测试 fixture，保留鉴权

`local-preview-recovery.test.js` 的原 fixture 缺少 taskAccessToken，已有运行时鉴权因此拒绝建立连接。fixture 现传合成 token，订阅断言检查 token，保留重连、心跳与旧连接事件测试，并新增缺 token 时不创建连接的测试。

没有放松运行时鉴权，也未改前端 runtime。原先 5 项 fixture 失败的日志仍保留。

## 3. 本轮文件清单

| 文件 | 用途 |
|---|---|
| `services/kc-pay-gpt/mysql-store.js` | 任务准入、返卡事务与连接注入 |
| `services/kc-pay-gpt/server.js` | 核销入口、派发异常和启动恢复接入 |
| `services/kc-pay-gpt/test/recharge-routing.test.js` | 原子准入接口的 routing fixture 与回归 |
| `services/kc-pay-gpt/test/local-preview-recovery.test.js` | token fixture 和缺 token 拒绝验证 |
| `tests/security-round2-kc-activation.test.js` | 原入口回归适配与检查 |
| `tests/security-round3-kc-activation-atomic.test.js` | 新增事务故障、归属、并发及异常恢复验证 |

当前文件可能包含此前未提交工作。SHA256 见证据目录 `source-manifest.json`；本轮增量见 `delta/round3-delta.patch`，已通过只读 `git apply --reverse --check` 对照当前文件，未实际应用 patch。

## 4. 验证结果与历史失败

| 验证 | 结果 | 边界 |
|---|---|---|
| Native 原子性与入口定向测试 | 71 PASS / 0 FAIL / 0 SKIP；exit 0 | 最终 `atomic-final.log` |
| KC 五文件定向回归 | 161 PASS / 0 FAIL；exit 0 | 26 store、54 routing、6 recovery、56 safety、19 preview |
| 最终两组定向合计 | **232 PASS / 0 FAIL** | 不累加中间重复测试 |
| 六个修改 JS 文件 `node --check` | 6 PASS / 0 FAIL | 语法检查 |
| 本轮 delta 新增行空白检查 | PASS | 不代表整个 dirty 工作区检查通过 |
| 修改前 INSERT 故障红测 | 0 PASS / 1 FAIL；exit 1，符合预期 | 旧 dirty store 无任务仍留下 consumed CDK |
| 当前真实 MySQL / InnoDB | **NOT RUN** | 无数据库连接和 SQL 执行 |
| KC 最终全量 | **NOT RUN** | 本轮仅执行定向测试 |
| 生产交易 / 部署 / 健康验收 | **NOT RUN** | 无线上变更 |

修改前红测的有效证据为 `atomic-baseline-reproduced.log`。更早的 `atomic-baseline.log` 是 fixture SQL 正则不识别换行，不能算作漏洞复现。原始完整红测命令没有单独存留；证据 README 中的配方明确标为重建说明，不冒充原始命令日志。

`kc-target-final.log` 的中间结果为 155 PASS / 5 FAIL，修正 token fixture 并增加拒绝用例后最终为 161 PASS。所有原日志分别保留，没有覆盖或删除失败断言。

**第二轮 KC 全量的历史结果仍是 71 个文件、1693 项：1620 PASS / 72 FAIL / 1 SKIP，exit 1。** 本轮没有重跑全量，不能推算剩余失败数量，也不能把该结果改写成 PASS。历史游客 promo 档案契约和 A5–G3 人工验收均未在本轮重跑，不能互相替代。

## 5. 离线隔离与测试局限

测试仅继承 PATH/TMPDIR/LANG/TZ，设置合成 KC Session key。Node preload 拦截真实 `.env*` 读取和 TCP/TLS/dgram，包括 loopback；自检与拦截日志已归档。它仅是 Node API guard，**不是 OS 沙箱**，不应视为 native addon 或独立子进程的隔离证明。

测试执行实际 store 模块，以及从实际源码提取的 handler/startup 片段，注入有状态 mysql2 客户端，Session 加密使用实际模块与合成 key。模型用全事务 mutex 串行化，**不模拟真实 MySQL 行锁/间隙锁、隔离级别、进程崩溃或真实断连**。

准入采用 CDK→task，安全返卡和既有 settlement 存在 task→CDK 锁序，尚未统一；真实死锁行为 `NOT RUN`。既有 `withTransaction` 的 rollback 失败可能遮盖原异常，本轮未修改。生产 InnoDB、唯一约束与隔离级别也未独立核验。

## 6. 独立产物与生产边界

静态核查发现：KC Dockerfile 使用 `COPY . .` 并启动 `node server.js`，`.dockerignore` 不排除两个修改 runtime 文件。仓库 KC compose 的 build 与 bind mount 能说明仓库的包含关系，**不能证明生产 host compose 当前如此**。

Verify Dockerfile 复制 adapters/api/server/js/scripts/docs/supabase，不包含 `services/kc-pay-gpt`。因此 KC 必须有独立发布产物；Vercel 或 Verify 发布成功不能作为本轮 KC 修复已生效的证据。

本轮没有 Docker build、部署脚本执行、生产安装核查或 SSH。未来实际发布仍需遵守最新 main、干净候选、完整清单及相应链路验证。生产 KC 的 `.env`、host compose、data、debug_screenshots、product_files 和 mysql_data 必须保留。

## 7. 仍需闭环的交易风险

| 优先级 | 缺口 | 当前证据与后续验证 |
|---|---|---|
| P1 | 普通本地 worker 的部分失败收尾仍为分步更新任务和返卡 | `server.js:4229`、`:4291` 等仍调用无任务归属的 `markCdkUnused`；需扩展按 task 归属的原子结算并保留未知支付状态 |
| P1 | 真实 MySQL 并发、锁序与故障语义未验证 | 需要隔离测试库的并发、死锁、断连与重试验证；离线 mutex 不能替代 |
| P1 | KC 全量测试欠账 | 72 项历史失败保留；需要继续修复并完成最终全量，不通过删断言或改证据变绿 |
| P2 | 派发不明的保留任务与容量回收 | 当前保留以防重复派发，自动恢复链路尚未完整 |
| P2 | 多实例共享限流、银行卡 CVV / 产品凭证全面加密 | 本轮未闭环，不能由 Session 加密和入口事务代替 |
| REVIEW | 主站、TG 及生产权限/WAF/代理/发布 SHA | 本轮无新的运行时与生产证据；沿用各自历史审计边界，不能套用 KC 结论 |

P1 表示应继续优先处理，尚未对生产构造攻击或证明已发生实际损失。

## 8. 证据位置与状态

证据目录：`docs/security-audit-evidence/2026-11-08-card-store-round3/`。包含基线与 dirty 清单、5 份备份核验、源码 hash、原始日志、隔离工具、本轮 delta、静态打包边界和归档清单。源码当前 hash 与测试输出分开记录，原始历史档案保持不变。

| 系统 / 链路 | 本轮状态 |
|---|---|
| KC 本地定向加固验证 | PASS，限上述 232 项 |
| KC 独立生产产物 | NOT RUN，线上未生效 |
| Vercel production | NOT RUN |
| KVM4 Verify Server / TG worker | NOT RUN |
| KVM4 Sub2API / NewAPI | NOT RUN |
| SQL / 生产交易 / 游客购买启用 | NOT RUN |
