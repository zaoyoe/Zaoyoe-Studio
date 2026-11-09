# KC 卡资产与本地支付结算加固（第 11 轮，2026-11-09）

本轮继续阶段 B 的第 2、3 步：让旧资产入口尊重 payment attempt 栅栏，并准备付款确认、卡片使用、CDK、任务终态和账本记录的同一事务结算。代码和离线验证已完成；账本仍未接入实时支付调用，栅栏默认关闭，数据库迁移只保存为草案。

## 已实施

- `services/kc-pay-gpt/mysql-store.js` 增加显式 `KC_PAYMENT_ATTEMPT_ASSET_GUARD=off|enforce`。`enforce` 模式把 `card_assets.payment_attempt_id IS NULL` 加入资产选择、占用、释放、清锁、计数、后台查看和外包支付路径；未知列时直接失败，不回退到无栅栏 SQL。默认 `off` 不引用草案列，迁移前可正常加载。
- 批量卡池保存先锁定现有 PAN 行，再更新；被占用或被栅栏阻挡的现有行会回滚，不会误判为不存在而重复插入。
- 后台删除、重置冷却、卡片秘密读取改为只允许空闲、无 owner、允许状态的卡片。待支付、人工复核或 attempt 绑定的卡不会被清除、重置或返回完整卡密。
- 新增 `services/kc-pay-gpt/lib/payment-attempt-settlement.js`。结算前重新锁定并复核 CDK、任务、最新 owner、其他阻塞任务、attempt 版本和卡片 fence；已付款路径原子写入唯一账单、卡片使用计数、卡片释放、CDK/任务终态和 attempt 收据；已确认未扣款路径原子退回 CDK、短暂冷却卡片、清理任务凭证并写入终态。未知、版本冲突、owner/fence 变化和任何写入/提交不确定都会回滚或保持待核查。
- 重放只读取已保存收据，并核验账单/证据，不再次计数、扣款或释放已被复用的资产。
- 新增待审迁移草案 `services/kc-pay-gpt/acceptance/payment-attempt-ledger/20261109-settlement-DRAFT.sql`，为账单和 attempt 收据建立唯一关联及限制；没有写入 `mysql-schema.sql`，没有执行回填或迁移。

## 离线证据

所有运行均通过 round8 的无环境文件、无网络 guarded runner，未启动 KC 服务、未连接数据库、未付款。

- [最终合并回归日志](/Volumes/chao/AI/xianyu_profit_calculator/docs/security-audit-evidence/2026-11-09-card-store-round11-settlement/final-round11-all.tap)：649 PASS / 0 FAIL，覆盖本轮结算、资产栅栏、round6/7/8/10 回归。
- [卡冻结契约日志](/Volumes/chao/AI/xianyu_profit_calculator/docs/security-audit-evidence/2026-11-09-card-store-round11-settlement/card-freeze-vitest.tap)：5 PASS / 0 FAIL。
- [本轮文件与证据清单](/Volumes/chao/AI/xianyu_profit_calculator/docs/security-audit-evidence/2026-11-09-card-store-round11-settlement/round11-final-manifest.json)。
- [编辑前字节快照清单](/Volumes/chao/AI/xianyu_profit_calculator/docs/security-audit-evidence/2026-11-09-card-store-round11-settlement/baseline-manifest.json)：6 个既有文件已做哈希和读回校验。

## 尚未完成的边界

这些测试是事务状态模型，不是 InnoDB、真实 DDL、真实连接断开、供应商回调或生产并发证据。Round10 的历史 KC 全套结果仍按原记录保留为 71 文件、1672 PASS / 40 FAIL / exit 1，未被本轮改写为通过。

要进入下一阶段，需先单独审阅并在隔离 MySQL 目标验证迁移草案、唯一键/FK、旧账单兼容和币种金额范围；再补真实数据库并发/提交应答丢失证据，最后才评估将 `KC_PAYMENT_ATTEMPT_ASSET_GUARD` 切到 `enforce` 和接入实时支付调用。当前没有执行 SQL、提交、推送或部署。

## 迁移预检追加记录（2026-11-09）

KC 生产 MySQL 的只读预检已经由 `kc-pay-gpt-mysql` 容器完成，目标是 MySQL 8.0.46 的 `plus_papay`；结果保存在 [kc-mysql-preflight-20261109-v4.tsv](security-audit-evidence/2026-11-09-card-store-round11-settlement/kc-mysql-preflight-20261109-v4.tsv)。预检确认新账本表、资产 fence 列和账单关联列均不存在，现有数据无需自动回填；3 条支付结果未知任务和 5 条带恢复标记的人工成功任务继续保留人工复核边界。

原 Round11 循环外键草案不再作为执行对象。当前候选是[四检查点迁移草案](../services/kc-pay-gpt/acceptance/payment-attempt-ledger/20261109-payment-attempt-ledger-CANDIDATE-DRAFT.sql)，只保留 attempt 到账单的单向外键，仍为 REVIEW ONLY / NOT EXECUTED。迁移就绪契约为 `4 PASS / 0 FAIL`，Round10/11 相关离线回归为 `286 PASS / 0 FAIL`；这些结果不能替代隔离 MySQL 8.0.46 的真实 DDL 和异常恢复验证。

当前仍不执行 SQL，不切换 `KC_PAYMENT_ATTEMPT_ASSET_GUARD=enforce`，不接入实时账本调用，也不提交、推送或部署。下一步是准备隔离 MySQL 8.0.46 验证环境，逐检查点验证迁移的续跑、唯一索引、CHECK、单向外键和异常中断恢复。

本机现有 MySQL 8.4.11 仅用于临时合成库兼容性检查，已验证候选 DDL 可创建三张表、单向外键、唯一 fence 索引和结算收据约束，临时库已清理。证据见 [round12-local-mysql84-compatibility.txt](security-audit-evidence/2026-11-09-card-store-round11-settlement/round12-local-mysql84-compatibility.txt)；它不能替代 MySQL 8.0.46 的隔离验证。
