# 发卡站安全加固，第八轮：KC 隔离 MySQL 验收工具

日期：2026-11-09（Asia/Shanghai）。状态：**离线工具已验证；真实数据库验收 NOT RUN；未提交、未部署**。

## 1. 目的与本轮变化

承接第七轮支付卡持久 hold，建立可审查的一次性 MySQL 8.4 验收夹具，
不把离线状态机模拟、模块重载或客户端故障注入冒充真实数据库、网络或进程故障验证。

新增内容：

- `services/kc-pay-gpt/acceptance/mysql-payment-hold/`：默认 plan、安全配置校验、fixture、
  当前 store 的 VM 注入、限时 pool、12 个数据库场景和首错停止机制，以及 README。
- `tests/security-round8-kc-mysql-lab.test.js`：防误连接/误授权、默认无副作用、配置与环境拒绝、
  权限/身份前置检查、错误脱敏、当前 store 调用边界、超时和驱动报错销毁连接的离线测试。
- `docs/security-audit-evidence/2026-11-09-card-store-round8/`：基线、读回核验备份、
  API 级离线 guard、干净环境运行器、原始日志、源码清单及验证记录。

本轮修正的是**验收工具**：主动检查当前角色和严格授权；连接超时、迟到连接与驱动失败不回池；
清理错误不得覆盖原始查询错误。实际 MySQL 角色/授权文本与 mysql2 兼容性未验证，仍是实验验收事项。
没有修改生产支付代码、schema、部署脚本或服务配置。

## 2. 最终离线验证结果

同一测试的重复运行不累加；初次结果仍保留。

| 项目 | 文件数/检查数 | PASS | FAIL | Exit / 状态 |
| --- | ---: | ---: | ---: | --- |
| 第八轮新离线测试，`offline-tests-02.log` | 1 文件 | 79 | 0 | 0 |
| 第七轮持久 hold 定向回归，`payment-hold-regression-01.log` | 1 文件 | 119 | 0 | 0 |
| 本轮最终测试合计 | 2 文件 | **198** | **0** | 0 |
| 最终语法检查，`syntax-results-02.json` | 7 个 Node + 1 个 Python AST | 8 | 0 | 0 |
| 默认 plan，`plan-only-01.log` | 1 命令 | — | — | PLAN_ONLY，无连接/SQL执行 |
| 真实 MySQL 自动场景 | 12 场景 | 0 | 0 | **全部 NOT RUN** |
| TCP 回包丢失、worker 重启、mysqld 崩溃重启 | 3 场景 | 0 | 0 | **全部 NOT RUN** |

`offline-tests-01.log` 的 77 PASS 是新增驱动失败断言之前的历史结果，不并入最终总数。
本轮日志不替代第七轮归档。第七轮相关回归历史为 26 文件 1001 PASS/0 FAIL；
更早 KC 全量历史仍为 **71 文件 1672 PASS/40 FAIL/exit 1**，本轮未重跑或将其改绿。
本轮 198 项是**离线测试用例**，不是 198 次真实 MySQL 验收。

可复核的离线测试命令如下，输出日志必须使用尚不存在的绝对路径：

```sh
python3 docs/security-audit-evidence/2026-11-09-card-store-round8/isolation/run.py \
  --cwd /Volumes/chao/AI/xianyu_profit_calculator \
  --log /absolute/new/offline-tests.log \
  -- node --test tests/security-round8-kc-mysql-lab.test.js
```

运行器清理环境并显式加载 guard，测试另启 Node 子进程时也显式加载 guard。
这是对受控测试的 Node API 级防误操作措施，不是 OS/native-code 隔离或通用子进程 sandbox。
测试中的 SQL 字符串由 fake pool/spies 读取，不向数据库发送。

## 3. 证据及未改动范围

基线 `baseline.json`：`main` / `HEAD=origin/main=75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`，
规范 HTTPS origin；开始与本次续做均 fetch 检查，落后计数 0。
工作区原本不干净，初始展开状态为 651 条，**不是旧时点的 603 条**；
没有 reset、restore、clean、rebase、切分支、暂存、提交、推送、PR 或发布。

修改验收文件前进行了字节备份并读回比较，身份位于：

- `backups/harness-before-review/manifest.json`
- `backups/harness-before-offline-tests/manifest.json`
- `backups/before-driver-error-guard/manifest.json`
- 四个 runtime/schema 的原始备份及哈希在 `baseline.json`。

最终文件哈希与不变性检查见 `source-manifest.json` 和 `verification-results.json`；
包含第七轮 35 源码、42 证据、四个 runtime/schema、原始 dirty 条目及空暂存区核对。
这里只保存本轮证据，没有重写第七轮归档或删除失败记录。

`js/engagement-runtime-loader.js` 的交接哈希差异仍为 **REVIEW**：
本轮观察值 `c9186bfbfe8422abe6d1676a2f47402a12c8c4df3895073bf9fb6d807af53413`；
更早差异来源未归因，本轮未修改或恢复该文件，不能声称已解决。

## 4. 安全结论与下一步

本轮证明工具的已测离线边界与错误处理，不证明 InnoDB 并发、崩溃耐久性、真实 COMMIT 回包窗口、
完整支付端到端或生产环境行为。成功提交后丢弃客户端结果不是 TCP 丢包；重载模块不是进程重启。
持续 hold 仍不是逐 attempt 幂等账本，同 owner ABA、在途外部请求失锁、部分记账和人工核账风险仍保留。

下一步应在**用户明确授权后**，核实全新一次性 MySQL 8.4 实例与 SQL 范围，
再执行 12 个自动场景；三个人工故障场景分别归档，不以自动结果替代。
实验实例不能是 KVM4、共享库、生产隧道或生产备份克隆。本轮没有启动实例、连接数据库、
执行 SQL、运行 execute 模式、付款、启动 worker、构建镜像或部署。

主站与 TG 前轮结果没有被此 KC 局部验收替代；本轮未继续审计其 runtime。
虎皮椒、爱发电继续排除。不存在“全站已经绝对防住所有攻击”的结论。

Vercel ignore 排除相关源码/证据目录；KC 镜像当前 `COPY . .` 可能包含验收夹具，
发布前须审查验收工具打包边界。本轮未改这些规则、未构建或发布任何生产制品。
操作细节与隔离条件见 `services/kc-pay-gpt/acceptance/mysql-payment-hold/README.md`。
