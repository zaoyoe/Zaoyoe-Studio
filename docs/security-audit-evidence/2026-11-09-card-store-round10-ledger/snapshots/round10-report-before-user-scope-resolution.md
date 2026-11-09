# 第十轮：KC 支付 attempt 账本，阶段 A

2026-11-09（Asia/Shanghai）。**本地账本内核及迁移设计完成；未接入、未启用、未执行 SQL、未部署。**

## 1. 范围与现状

用户要求推进支付 attempt 账本。本轮交付独立可测试的事务内核，不把一张新日志表冒充完整支付幂等。
上轮授权的 12 项卡锁 MySQL 实验已经结束，本轮没有扩大该授权运行新 SQL、建库、启动实例或故障操作。

现有 `payment-retry.js` 以卡片持久 hold 阻挡重复入口，之后依次记录任务支付状态、
卡片使用信息、账单并释放卡片；这些不是同一笔结算事务。
`index.js` 的支付状态回调还涉及输出事件与父任务处理，不能只在回调旁边增加一次 INSERT 就认为原子性完成。

本轮新增：

- `services/kc-pay-gpt/lib/payment-attempt-ledger.js`：无环境读取、无驱动导入、无连接创建、无启动 DDL 的独立工厂。
- `services/kc-pay-gpt/acceptance/payment-attempt-ledger/20261109-ledger-DRAFT.sql`：MySQL 8.4 迁移**草案**，只保存未执行，不加入 `mysql-schema.sql`。
- `tests/security-round10-kc-payment-attempt-ledger.test.js`：事务内存模型、提交门、状态矩阵、失败/超时边界测试。
- `docs/security-audit-evidence/2026-11-09-card-store-round10-ledger/`：基线、快照、日志、清单与核验。

**既有支付/server 调用方未导入此模块，没有环境变量开关可直接启用。现有生产保护能力没有因此自动增强。**
主站、TG、NewAPI 不在本轮实现范围，虎皮椒/爱发电继续排除。

## 2. 账本绑定与不变量

- 每次尝试有随机 128-bit `attemptId`，与任务、卡片、序号、金额最小单位整数、币种、平台、套餐及 checkout 哈希绑定。
- provider 幂等键为不包含 CDK/卡号/凭证的 `kcpa_v1_<attemptId>`，固定后不可换键盲重试。
  **本模块不证明上游接受该键，也不保证外部支付 exactly-once。** 适配器必须确认上游真实幂等契约；不支持时保守查询/核账。
- 同任务未决尝试、同卡未决尝试、同 checkout 未决/已支付记录分别使用数据库唯一约束设计。
  已结算成功的 job/checkout 仍阻挡重付；同已付款 provider reference 不能归入另一 attempt。
- 卡表拟增加独立 `payment_attempt_id` 栅栏；不能只靠原来的 `payment_<jobKey>`，也不能只靠内存布尔值。
- 任务 → attempt → 卡片使用固定加锁顺序；版本 CAS 要求恰好一行。零行、多行、错 owner、错 attempt、错金额/币种均拒绝。
- 结果中不保存 PAN、CVC、Session、token、Cookie、CDK、邮箱、原始确认令牌或原始 provider 响应。
  checkout/reference/evidence 哈希不是身份认证，不可把它们或一个 `verified=true` 当作可信证据。

### 状态模型

```text
prepared -> armed -> unknown -> paid / no_charge
                  -> paid / no_charge

paid      -> settled_paid       （本阶段未实现）
no_charge -> settled_no_charge  （本阶段未实现）
prepared  -> cancelled          （本阶段未实现）
```

`armed` 表示提交门已持久化，不等于上游收到请求或扣款成功。
`paid/no_charge` 是可信查证结果的账本记录，不等于卡片、账单、CDK 与任务已原子结算。
`paid` 不允许降为 unknown/no_charge；同一证据重放只返回原结果，不产生再次提交的许可。
仅 `settled_no_charge/cancelled` 可允许下一次尝试，本阶段没有提供写入这些终态的 API。
不把“保存 declined 字串”或“超时已过”当作自动解锁条件。

## 3. 本地内核的三个入口

### prepare(intent)

只接受严格白名单字段。锁定并核对本地任务及此前尝试，验证卡片字节精确 owner，
在同一事务中新增 prepared 记录并绑定卡片栅栏。失败必须一起回滚，不能留下半条记录。
首次尝试遇到无账本的旧 declined 任务时转人工核查，不能直接假定历史没有扣款。

### dispatch(identity, submit)

锁定任务/attempt/卡片，验证原版本与栅栏，在同一事务中写入：
卡片支付 hold、任务 started、attempt armed/version+1。
**只有事务 COMMIT 收到成功确认、连接释放成功后，才调用一次注入的 submit。**
COMMIT 成功结果丢失、数据库/连接故障、超时、重复入口都不得调用 submit。
submit 抛错时尽力记录 unknown；即使该记录失败，也保留 durable armed/hold，不调用 fallback、不释放卡片、不自动重试。

submit 是未来的可信服务端适配器，不是 HTTP 用户回调。返回 success 并不会自动将账本标为 paid。
连接获取、查询、写入、begin/commit/rollback 均有独立限时；迟到连接销毁，错误不回池。
默认每步上限 5 秒，不是整个事务总时限；没有自动 deadlock/commit 重试。

### observe(identity, outcome)

只有已认证的服务端 provider 查询/webhook 验证器可以调用。
paid/no_charge 必须与锁定的 amountMinor、currency、checkoutHash 一致，保存引用/证据哈希并做版本 CAS。
不同证据、冲突结果或旧版本不可覆盖新状态。
**本阶段只记事实，不释放卡片、不返 CDK、不改账单，不把 parent task 直接结束。**

## 4. 必须完成后才可接入生产的阶段 B

1. **可信金额和标识适配**：从服务端最终已验证的 checkout 报价转换整数最小单位，明确币种精度；
   不能对浏览器金额做浮点乘法后直接采信。checkout/reference 哈希使用稳定 provider 命名空间，
   paid reference 必须指向同一真实扣款，不是任意可复用的 Session 或客户端参数。
2. **迁移审核及隔离真实 DB 验收**：检查新列、唯一生成列、CHECK、MySQL 驱动行为、事务/死锁/断连；
   本轮没有验证这些 SQL 在真实 MySQL 可执行。上轮 12 项 PASS 不能替代这套新 schema 的验收。
3. **全部资产入口适配**：reserve、预热、普通释放、按 owner 释放、stale/reset、冷却、报废、
   profile/usage 更新、人工操作均须尊重 `payment_attempt_id` 与未决账本。
   当前旧入口还不认识新栅栏，**单独执行草案或只接 dispatch 都不安全**。
4. **原子结算**：账单使用唯一 attempt 关联；卡片使用记账/解除栅栏、任务/CDK 终态、账单与
   `settled_*` 在同一事务完成。拆分写入不能继续称为完整账本；本阶段没有实现这一步。
5. **结果认证与人工核账**：上游签名/查询真实性、订单/金额/币种/扣款引用绑定，冲突保留证据。
   既有错误字符串分类、`canRetryCard` 或布尔 success 不能直接驱动 no_charge 结算。
6. **调用链与恢复**：协议/UI 回调、预热、所有 worker/父任务结算一起接入。无持久任务的 debug
   支付不能静默绕过账本；旧未决记录不能自动回填为“未提交”。另补三项未做的真实故障验收。
7. **默认关闭发布与启用分离**：全链路契约、历史失败归因、迁移与恢复方案通过，再单独审批 SQL、发布和启用。

因此本轮模型中的同-owner ABA 拒绝不等于现网 ABA 已解决；网络在途请求也不能仅用本地栅栏撤销。

## 5. 验证与证据边界

| 最终离线验证 | 文件数 | PASS | FAIL | Exit |
| --- | ---: | ---: | ---: | ---: |
| 新账本内核/事务模型 | 1 | 128 | 0 | 0 |
| 既有 MySQL 实验夹具防误操作测试 | 1 | 80 | 0 | 0 |
| 既有持久 hold 定向回归 | 1 | 119 | 0 | 0 |
| 合计，`logs/offline-final-02.log` | 3 | **327** | **0** | **0** |

新模块和新测试语法检查 2/2 通过。运行器清理环境并加载既有离线 guard，
阻止网络连接、监听及常见 `.env` 读取；测试 SQL 仅送给内存解释器。
内存模型串行化事务并模拟约束/回滚，不是 InnoDB、DDL、真实 COMMIT/TCP 丢包或崩溃耐久性证据。
此前 97、109 项及上一版 326 项通过日志保留，不叠加进 327。
旧 KC 全量历史仍为 **71 文件 1672 PASS / 40 FAIL / exit 1**，未重跑或改绿。

工作基线 `main / 75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`，规范 HTTPS origin，fetch 后落后 0。
六个既有关键 runtime/schema 已做字节快照并读回；第八/九轮 162 个证据文件原样保留。
没有 reset/rebase/restore/clean/切分支、暂存、提交、推送、PR、构建或部署。
新文件的增量快照保留在本轮 evidence；一次追加测试前的快照脚本报了 Path 拼接错误，未生成该快照，
已单独记录 FAIL，不能声称该步备份成功。随后只插入新测试，未删除原用例或修改历史源码；早期快照及日志仍在。
原有 `js/engagement-runtime-loader.js` 交接哈希差异仍 REVIEW，不归因、不恢复。

最终源文件/证据哈希、不变性核对和打包静态检查见本轮 `source-manifest.json` 与 `verification-results.json`。
KC Dockerfile 的 `COPY . .` 会包含 lib 和未排除的 acceptance 草案，但不会自动执行它们；
Vercel 静态规则排除 `/services/`、`/tests/`、`/docs/`。本轮没有构建或验证生产制品。

**本轮状态：内核阶段 A 完成；阶段 B/真实数据库迁移验收/生产接入均 NOT RUN。**

### 归档补记：工作区完整性 REVIEW

首轮归档未通过原始 git status 条目保留断言：开始时存在的未跟踪文件
`tests/nav-glass-foreground-motion.test.js` 当前不存在，且不是被 gitignore 隐藏或变成已跟踪文件。
本轮没有编辑/删除该路径，变化来源尚未归因；不擅自重建、恢复或删除相关记录。
原始和结束状态、失败断言及该例外保留在本轮 evidence。
因此 **工作区整体完整性为 REVIEW，而非 PASS**；它不改变 327 项离线结果，也不能被离线通过掩盖。
在归因并协调该差异前，不准备发布候选或执行提交/部署/SQL。
