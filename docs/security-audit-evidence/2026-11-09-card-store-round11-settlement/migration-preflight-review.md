# Round11 KC 迁移前审计（2026-11-09）

状态：REVIEW，未执行 SQL。

## 结论

Round10 与 Round11 草案暂不应直接在生产 KC MySQL 执行。当前没有目标数据库的只读结构证据，且草案存在可修复的迁移工程问题。代码仍保持账本未接入、资产栅栏默认关闭。

## 已确认的问题

1. **两套历史账单结构存在漂移**

   `services/kc-pay-gpt/mysql-schema.sql` 的 `billing_records` 已包含 `card_number`、`platform` 和 64 字符 `plan_type`；历史 `mysql-update-stripe.sql` 创建的旧版本缺少 `card_number`、`platform`，且 `plan_type` 为 16 字符。运行时 `ensureReady` 会尝试补列和扩容，但迁移不能假定服务已经启动过。执行前必须从目标库只读确认真实列、类型、引擎和索引。

2. **草案不可安全重入**

   Round10 的 `CREATE TABLE kc_local_payment_attempts` 与两个 `ALTER TABLE` 没有 `IF NOT EXISTS` 或迁移检查。Round11 的新增列、唯一键、两个外键和 CHECK 约束也没有检查。任一步成功后下一步失败，重新执行会遇到重复对象或重复列错误。

3. **DDL 不是一个可回滚事务**

   两份文件包含多个 `CREATE/ALTER TABLE`。MySQL DDL 会产生隐式提交，不能按应用事务假设“全部成功或全部回滚”。必须按阶段执行并在每个阶段记录结构证据和备份标识。

4. **Round11 形成循环外键**

   `billing_records.local_payment_attempt_id` 引用 `kc_local_payment_attempts.attempt_id`，同时 `kc_local_payment_attempts.settlement_billing_id` 又引用 `billing_records.id`。这种设计未经过真实 MySQL 8.4 DDL 验证，会增加修复、导入、删除和部分迁移恢复的复杂度。应在隔离库验证，或改成单向关系后再进入生产。

5. **目标库数据前置检查尚未完成**

   还没有确认目标库是否存在同名表、同名索引/约束、非 InnoDB 表、字符集/排序规则不匹配、历史重复 card fence 值或未完成的上一轮迁移。Round10 的新列理论上初始为 NULL，但不能替代目标库核验。

## 执行前必须满足的条件

- 明确目标为 KC 生产 MySQL 还是隔离测试库，并记录数据库名和环境；不读取或输出密码。
- 取得可恢复备份，并在备份中验证 `card_assets`、`billing_records`、`task_logs`、`cdk_codes` 的结构和数据可读。
- 先在隔离 MySQL 8.4 验证改进后的可重入迁移、索引、CHECK、外键和异常中断后的续跑。
- 决定循环外键是否保留；未完成决定前不执行 Round11。
- 生成带版本/检查点的正式迁移文件。当前两份 `DRAFT.sql` 仍是设计证据，不是生产执行文件。
- 迁移完成并验证后，才考虑把 `KC_PAYMENT_ATTEMPT_ASSET_GUARD` 切到 `enforce`；实时支付调用仍需另行接线和验收。

## 已准备的只读预检

[20261109-migration-preflight-READONLY.sql](../../../../services/kc-pay-gpt/acceptance/payment-attempt-ledger/20261109-migration-preflight-READONLY.sql) 是 **MySQL 8.0/8.4 专用**，只能在 KC 的独立 MySQL 数据库运行，不能在 Supabase/PostgreSQL SQL Editor 运行。它只读取 `information_schema` 和聚合计数，不返回卡号、CVC、令牌、Session、邮箱或密钥，也不包含 `CREATE`、`ALTER`、`UPDATE`、`DELETE`。它必须在选定目标库后单独运行，并把结果保存为证据；不能和迁移脚本拼接执行。

## 当前无需用户执行的事项

现在不需要你执行任何 SQL。你需要保留现有数据库备份，并在我完成隔离库验证和正式迁移文件后，再对“KC 生产 MySQL 执行 Round10 + Round11 迁移”作一次明确授权。

本审计未连接数据库、未启动服务、未进行付款、未提交或部署。

## 目标库纠正记录

收到一次 Supabase/PostgreSQL 执行结果：`42883 function database() does not exist`。这证明脚本被送到了 PostgreSQL，而不是 KC MySQL；由于预检脚本在第一条只读查询处失败，且整份脚本不含写操作，本次没有迁移或数据修改。后续必须改在 KC 独立 MySQL 目标上运行，不能把 Supabase 的结果当作 KC 结构证据。

## KC MySQL 只读预检结果

[有效预检证据 v4](./kc-mysql-preflight-20261109-v4.tsv) 已从 KVM4 的 `kc-pay-gpt-mysql` 容器读取，目标为 MySQL 8.0.46、数据库 `plus_papay`。容器状态为 healthy，相关表为 InnoDB、`utf8mb4_unicode_ci`。

- `kc_local_payment_attempts` 尚不存在。
- `card_assets.payment_attempt_id` 尚不存在，attempt 唯一索引也不存在。
- `billing_records` 已有 `DECIMAL(10,2)`、64 字符 `plan_type` 和 `platform`，与当前候选适配器兼容。
- 卡片共 3 张：2 张正常空闲、1 张冻结；当前没有支付处理中卡片，也没有 attempt 栅栏存量需要回填。
- 账单共 72 条：成功 8 条、失败 61 条、待处理 3 条；现有行不需要填入本地 attempt 关联。
- 任务统计为 100 条：63 条开放任务，其中 3 条为 `payment_state=unknown` 且要求人工复核，另有 5 条人工成功任务仍保留恢复标记。它们必须继续走旧任务复核边界，不能由新账本自动认领。

v1/v2 预检输出因客户端未固定 `utf8mb4`，中文状态曾显示为 `???`，只保留作历史过程证据；v4 使用 `--default-character-set=utf8mb4` 并在脚本中加入 `SET NAMES utf8mb4`，是有效版本。

基于真实预检，已准备去除循环外键并按检查点执行的[候选迁移草案](../../../../services/kc-pay-gpt/acceptance/payment-attempt-ledger/20261109-payment-attempt-ledger-CANDIDATE-DRAFT.sql)。它仍未执行，且执行前仍需要可恢复备份、隔离库 DDL 验证和针对每个检查点的结果归档。

## 2026-11-09 复核更新（追加记录）

本节保留并修正前文的历史判断。KC 独立 MySQL 只读预检已经完成，前文“还没有目标数据库的只读结构证据”仅适用于本记录创建时，不能继续作为当前状态结论。

- 有效证据：[kc-mysql-preflight-20261109-v4.tsv](./kc-mysql-preflight-20261109-v4.tsv)。目标为 KVM4 的 `kc-pay-gpt-mysql`，MySQL 8.0.46，数据库 `plus_papay`，容器为 healthy；没有执行 DDL、回填或其他写操作。
- 预检确认 `kc_local_payment_attempts`、`card_assets.payment_attempt_id` 和相关新索引均不存在；现有 `billing_records` 的金额、计划和平台字段与候选适配器兼容。
- 已废弃循环外键方案，当前审阅对象为[四检查点候选迁移](../../../../services/kc-pay-gpt/acceptance/payment-attempt-ledger/20261109-payment-attempt-ledger-CANDIDATE-DRAFT.sql)。候选只保留 `kc_local_payment_attempts.settlement_billing_id -> billing_records.id` 的单向外键，并禁止历史任务自动回填。
- [迁移就绪契约](../../../../tests/security-round12-kc-migration-readiness.test.js)结果为 `4 PASS / 0 FAIL`，证据见 [round12-migration-readiness.tap](./round12-migration-readiness.tap)。它核验了预检内容、四个检查点、无循环账单外键、预检无写操作以及 `mysql-schema.sql` 未被草案字段污染。
- Round10/11 相关离线回归本轮复跑为 `286 PASS / 0 FAIL`。这些仍是模型和契约证据，不等同于真实 InnoDB DDL、并发、断连或提交应答丢失验证。

当前结论：目标结构预检已通过，迁移仍处于 REVIEW；生产 SQL 仍未执行，`KC_PAYMENT_ATTEMPT_ASSET_GUARD` 仍为 `off`，实时账本调用仍未接入。下一阻塞项是使用隔离 MySQL 8.0.46 完成四检查点的真实 DDL、续跑、索引、CHECK、外键和异常中断验证；在此之前不得执行 KC 生产迁移。

候选迁移 SHA-256：`72cd874f208053144b333684cfa88ca031c8de9c2af4335e0abee9fc803e9bd2`。

## 本机兼容性补充（2026-11-09）

本机临时隔离库使用 Homebrew MySQL 8.4.11 和纯合成空表完成了候选 DDL 的兼容性检查：三张表、单向外键、卡片 fence 唯一索引以及 `settled_paid` 收据约束均可创建并写入；临时 schema 已删除并验证不存在。证据见 [round12-local-mysql84-compatibility.txt](./round12-local-mysql84-compatibility.txt)。

该结果只证明 MySQL 8.4.11 的本地兼容性，不能替代生产同版本的 MySQL 8.0.46 验证，也没有验证真实旧表、并发、锁等待、连接断开或提交应答丢失场景。
