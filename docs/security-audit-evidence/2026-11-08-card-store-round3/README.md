# 第三轮本地安全证据索引（2026-11-08）

这些文件记录 KC 核销入口、派发异常及启动恢复的本地修改与离线定向验证。它们不代表全量测试通过、真实 MySQL 集成通过或任何生产部署。

- `baseline-and-boundaries.json`：Git 基线、归档前 dirty 路径及操作边界。
- `source-manifest.json`：6 个本轮修改文件、3 个仅回归测试文件、4 个静态打包输入的当前 SHA256。
- `backup-manifests/` 与 `backup-verification.json`：5 个修改前 dirty 文件备份身份与字节核验。备份不是完整工作区、Git 或数据库备份，原备份位于临时目录。
- `delta/round3-delta.patch`：相对上述 dirty 备份的 960 行本轮差异；新增测试的 before 为 `/dev/null`。不是相对 HEAD 的完整发布差异。
- `verification-results.json`：最终两组定向测试 232 PASS，语法 6 PASS，以及历史失败的分开记录。
- `packaging-boundary.json`：KC 独立产物的静态包含关系；没有实际构建或核验生产 host compose。
- `raw/`：原始日志、隔离 launcher、Node guard、语法与空白检查。失败日志原样保留。
- `evidence-manifest.json`：归档文件与外部本轮报告的 SHA256。

## 离线运行边界

`run.py` 仅继承 PATH/TMPDIR/LANG/TZ 并注入合成 Session key；preload 拦截真实 `.env*` 的 Node 文件读取与 Node TCP/TLS/dgram，包括 loopback。它是 Node API guard，不是操作系统沙箱，不保证拦住 native addon 或独立子进程。自检输出在 `raw/selfcheck.log`；`blocked-reads.jsonl` 只有主动自检的合成路径。

原 launcher 和 preload 保留了 `/tmp/security-test-isolation-20261108` 绝对路径；重放需先检查原文件仍存在且 hash 与归档一致，或在单独离线目录复制并明确调整 guard 路径。不要直接执行 KC 的 `npm test`，它带读取真实 env 的参数。不要为重放加载真实凭证。

## 最终测试命令

以下是前一执行阶段的最终显式测试命令，本续接仅核对并归档原始输出，没有因文档编辑重复运行。命令的工作目录和环境另见 `verification-results.json` 与 `raw/run.py`。

```sh
python3 /tmp/security-test-isolation-20261108/run.py --cwd /Volumes/chao/AI/xianyu_profit_calculator --log /tmp/security-test-isolation-20261108/atomic-final.log -- node --test tests/security-round3-kc-activation-atomic.test.js tests/security-round2-kc-activation.test.js

python3 /tmp/security-test-isolation-20261108/run.py --cwd /Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt --log /tmp/security-test-isolation-20261108/kc-target-fixture-corrected.log -- node ./node_modules/vitest/vitest.mjs run test/gpt-outsourcing-store.test.js test/recharge-routing.test.js test/gpt-outsourcing-recovery.test.js test/task-safety.test.js test/local-preview-recovery.test.js --no-file-parallelism --maxWorkers=1
```

## 修改前红测的重放配方

原始完整命令未单独保存；下面是由保留的 launcher、测试名、备份身份重建的可读配方，不能作为“原始命令日志”。应写入新日志文件，不能覆盖本归档或既有日志。

```sh
python3 /tmp/security-test-isolation-20261108/run.py --cwd /Volumes/chao/AI/xianyu_profit_calculator --log /tmp/security-round3-baseline-replay-new.log --baseline-store BACKUP_ROOT/services/kc-pay-gpt/mysql-store.js -- node --test --test-name-pattern='atomic admission rolls back CDK consumption when task INSERT fails' tests/security-round3-kc-activation-atomic.test.js
```

`BACKUP_ROOT` 的实际值见 `backup-verification.json`。预期此单项在旧实现下失败；只有 `atomic-baseline-reproduced.log` 已复现“无任务仍占卡”，更早的 `atomic-baseline.log` 是 fixture SQL 正则不识别换行，不能算漏洞红测。

## 解释限制

有状态 mysql2 模型执行实际 store 模块，handler 和 startup 测试执行从源码提取的片段。模型以全事务 mutex 串行化，不模拟 MySQL 行锁、间隙锁、隔离级别、真实断连或进程崩溃。COMMIT/派发异常属于故障注入，不能标为生产容灾验收。

历史第二轮 KC 全量仍为 1620 PASS / 72 FAIL / 1 SKIP（1693 项）；本轮未重跑全量。本轮 token fixture 修正与新增缺 token 拒绝测试只证明其定向用例通过，不能重写历史全量结果。主站、TG、生产权限/WAF/真实交易及游客历史 promo 与 A5–G3 人工证据不在本轮验证范围。
