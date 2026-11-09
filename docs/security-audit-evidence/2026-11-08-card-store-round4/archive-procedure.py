from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, subprocess, shutil, difflib

repo=Path('/Volumes/chao/AI/xianyu_profit_calculator')
tmp=Path('/tmp/security-test-isolation-20261108')
evidence=repo/'docs/security-audit-evidence/2026-11-08-card-store-round4'
report=repo/'docs/security-card-store-hardening-round4-2026-11-08.md'
assert not evidence.exists() and not report.exists(), 'Refuse to overwrite an existing archive/report'
now=datetime.now(timezone.utc).isoformat()
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def git(*args): return subprocess.check_output(['git',*args],cwd=repo,text=True).strip()
def writejson(p,obj): p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
assert git('rev-list','--count','HEAD..origin/main')=='0'
assert git('remote','get-url','origin')=='https://github.com/zaoyoe/Zaoyoe-Studio.git'
assert git('branch','--show-current')=='main'
original_status=Path('/tmp/kc-local-settlement-20261108-backup/git-status-before.txt')
current_status=subprocess.check_output(['git','status','--porcelain=v1','--untracked-files=all'],cwd=repo,text=True)
before={line[3:] for line in original_status.read_text().splitlines()}
current={line[3:] for line in current_status.splitlines()}
assert not before-current
assert current-before=={'tests/security-round4-kc-local-settlement.test.js'}
assert all((repo/p).is_file() for p in before)

patch_paths=[('services/kc-pay-gpt/mysql-store.js','round4-mysql-store.js.patch'),('services/kc-pay-gpt/server.js','round4-server.js.patch'),('services/kc-pay-gpt/test/recharge-routing.test.js','round4-recharge-routing.test.js.patch'),('tests/security-round4-kc-local-settlement.test.js','round4-security-round4-kc-local-settlement.test.js.patch')]
for rel,name in patch_paths:
 old=Path('/tmp/kc-local-settlement-20261108-backup')/rel
 before_text=old.read_text().splitlines(keepends=True) if old.exists() else []
 patch=''.join(difflib.unified_diff(before_text,(repo/rel).read_text().splitlines(keepends=True),fromfile='a/'+rel if old.exists() else '/dev/null',tofile='b/'+rel))
 assert patch==(tmp/name).read_text(), 'Patch no longer represents current bytes: '+rel
assert (tmp/'round4-working-tree-delta.patch').read_bytes()==b''.join((tmp/name).read_bytes() for _,name in patch_paths)

for folder in ['raw','delta','backup-manifests']: (evidence/folder).mkdir(parents=True,exist_ok=False)
provenance=[]
def copy(src,dst,kind):
 src=Path(src);dst=evidence/dst; dst.parent.mkdir(parents=True,exist_ok=True)
 shutil.copyfile(src,dst)
 assert sha(src)==sha(dst)
 provenance.append({'source':str(src),'archive':str(dst.relative_to(evidence)),'sha256':sha(src),'byte_identical':True,'kind':kind})
rawnames=[
 'local-settlement-baseline.log','local-settlement-store.log','local-settlement-native-initial.log',
 'local-settlement-routing-initial.log','local-settlement-legacy-unknown-red.log',
 'local-settlement-routing-refined.log','local-settlement-renewal-red.log','local-settlement-renewal-fixed.log',
 'local-settlement-native-final.log','local-settlement-kc-final.log',
 'local-settlement-exception-message-red.log','local-settlement-kc-final-v2.log',
 'local-settlement-syntax-results.json','local-settlement-syntax-store.log',
 'local-settlement-syntax-worker.log','local-settlement-syntax-routing-test.log',
 'local-settlement-syntax-settlement-test.log','local-settlement-whitespace-results.json',
 'local-settlement-whitespace-probes.json','run.py','preload.cjs']
for name in rawnames: copy(tmp/name,'raw/'+name,'original local test/check log or isolation tool; not rerun during archival')
for _,name in patch_paths: copy(tmp/name,'delta/'+name,'round4 delta against pre-round dirty file backup; new test against empty file')
copy(tmp/'round4-working-tree-delta.patch','delta/round4-working-tree-delta.patch','combined final round4 delta against pre-round dirty files, not against HEAD')
copy(original_status,'baseline-status-expanded.txt','pre-round expanded dirty path listing')
(evidence/'status-before-archive-expanded.txt').write_text(current_status)
copy('/tmp/kc-local-settlement-20261108-backup/baseline.json','backup-manifests/baseline.json','pre-round baseline record')
for root,name in [('kc-local-settlement-20261108-backup','initial.json'),('kc-round4-pending-renewal-implementation-before','pending-renewal.json'),('kc-round4-worker-error-before','worker-error.json')]:
 copy(Path('/tmp')/root/'manifest.json','backup-manifests/'+name,'original pre-edit per-file backup manifest')
copy(tmp/'local-settlement-backup-verification.json','backup-verification.json','archive-time readback and comparison with previously recorded hashes')

whitespace=json.loads((tmp/'local-settlement-whitespace-results.json').read_text())
probes=json.loads((tmp/'local-settlement-whitespace-probes.json').read_text())
assert all(r['exit_code']==1 and r['output']=='' for r in whitespace)
assert probes[0]['exit_code']==1 and not probes[0]['output']
assert probes[1]['exit_code']==3 and 'trailing whitespace' in probes[1]['output']
writejson(evidence/'whitespace-interpretation.json',{
 'status':'PASS','scope':'Four round4 incremental diffs; original nonzero results preserved unchanged.',
 'original_results':'raw/local-settlement-whitespace-results.json',
 'controlled_probes':'raw/local-settlement-whitespace-probes.json',
 'interpretation':'On this installed Git, a controlled clean no-index difference returned 1 with no diagnostics; intentional trailing whitespace returned 3 with diagnostics. All four actual checks returned 1 without diagnostics. The earlier wrapper incorrectly treated any nonzero as failure; no source was altered to change this result.',
 'does_not_assert':'Whole-worktree whitespace cleanliness; no entire-worktree check was used to hide existing changes.'})

changed=[p for p,_ in patch_paths]
dependencies=[
 'services/kc-pay-gpt/task-safety.js','services/kc-pay-gpt/session-security.js',
 'services/kc-pay-gpt/credential-security.js','services/kc-pay-gpt/package.json',
 'services/kc-pay-gpt/package-lock.json','services/kc-pay-gpt/vitest.config.js',
 'services/kc-pay-gpt/test/gpt-outsourcing-store.test.js','services/kc-pay-gpt/test/gpt-outsourcing-recovery.test.js',
 'services/kc-pay-gpt/test/task-safety.test.js','services/kc-pay-gpt/test/local-preview-recovery.test.js',
 'services/kc-pay-gpt/test/task-diagnostics.test.js','tests/security-round3-kc-activation-atomic.test.js',
 'tests/security-round2-kc-activation.test.js',
 'services/kc-pay-gpt/Dockerfile','services/kc-pay-gpt/.dockerignore',
 'services/kc-pay-gpt/docker-compose.yml','deploy/kvm4/verify-server.Dockerfile']
source_rows=[]
for rel in changed+dependencies:
 p=repo/rel
 if p.is_file(): source_rows.append({'path':rel,'role':'round4_changed_file' if rel in changed else 'related_dependency_or_packaging_snapshot','sha256_at_archive':sha(p),'bytes':p.stat().st_size})
 else: source_rows.append({'path':rel,'status':'NOT_FOUND','role':'related_dependency_or_packaging_snapshot'})
writejson(evidence/'source-manifest.json',{'captured_at_utc':now,'basis':'Current uncommitted file bytes at archive time; not a clean candidate or contemporaneous cryptographic binding of earlier test runs.','files':source_rows})

base={'head':git('rev-parse','HEAD'),'origin_main':git('rev-parse','origin/main'),'branch':git('branch','--show-current'),'origin':git('remote','get-url','origin'),'behind':int(git('rev-list','--count','HEAD..origin/main'))}
writejson(evidence/'baseline-and-boundaries.json',{
 'captured_at_utc':now,**base,'freshness_fetch':'git fetch origin main succeeded during this continuation before archive edits',
 'release_candidate':'NOT_READY_DIRTY_WORKTREE','status_mode':'git status --porcelain=v1 --untracked-files=all',
 'pre_round_status_entries':len(before),'pre_archive_status_entries':len(current),'new_paths_before_archival':sorted(current-before),
 'missing_pre_round_paths':sorted(before-current),'all_pre_round_paths_still_readable':True,
 'path_presence_limit':'Presence/readability does not establish byte-for-byte preservation of all pre-existing edits; no full initial workspace hash set exists.',
 'round4_changed_files':changed,'backup_scope':'Per-file dirty backups only; not full-workspace, stash/commit or database backup.',
 'prohibited_actions_not_performed':['commit','stage','push','PR','merge','deploy','SQL execution','real database connection','real payment','production worker startup','real .env read','reset/restore/clean/rebase/branch switch'],
 'systems':'This round is KC focused local testing. No new main-site, TG or production firewall/permission/release acceptance.'})

native=['node','--test','tests/security-round4-kc-local-settlement.test.js','tests/security-round3-kc-activation-atomic.test.js','tests/security-round2-kc-activation.test.js']
kc=['node','./node_modules/vitest/vitest.mjs','run','test/gpt-outsourcing-store.test.js','test/recharge-routing.test.js','test/gpt-outsourcing-recovery.test.js','test/task-safety.test.js','test/local-preview-recovery.test.js','test/task-diagnostics.test.js','--no-file-parallelism','--maxWorkers=1']
writejson(evidence/'verification-results.json',{
 'metadata_provenance':'Final command lists and completed exit codes carried in session continuation context; original logs copied byte-for-byte. No new execution sidecar or candidate-commit binding is claimed retrospectively.',
 'final_focused_suites':[
  {'cwd':str(repo),'launcher':str(tmp/'run.py'),'command':native,'exit_code_observed':0,'pass':107,'fail':0,'skip':0,'log':'raw/local-settlement-native-final.log'},
  {'cwd':str(repo/'services/kc-pay-gpt'),'launcher':str(tmp/'run.py'),'command':kc,'exit_code_observed':0,'files_pass':6,'pass':185,'fail':0,'log':'raw/local-settlement-kc-final-v2.log'}],
 'total_focused_pass':292,'total_focused_fail':0,
 'syntax':{'pass':4,'fail':0,'command_records':'raw/local-settlement-syntax-results.json'},
 'whitespace':{'status':'PASS_INCREMENTAL_ONLY','interpretation':'whitespace-interpretation.json'},
 'preserved_failures':[
  {'log':'raw/local-settlement-baseline.log','pass':0,'fail':1,'meaning':'Before helper: task result committed separately from failing CDK return'},
  {'log':'raw/local-settlement-legacy-unknown-red.log','pass':63,'fail':1,'meaning':'Legacy Chinese unknown-payment output did not reliably retain assets'},
  {'log':'raw/local-settlement-renewal-red.log','pass':65,'fail':2,'meaning':'Premature success persisted before auto-renew verification'},
  {'log':'raw/local-settlement-exception-message-red.log','pass':70,'fail':1,'meaning':'Raw worker exception leaked into public task message'}],
 'historical_not_current':{'round3_focused_pass':232,'round2_kc_full_suite':{'files':71,'tests':1693,'pass':1620,'fail':72,'skip':1,'exit_code':1,'rerun_this_round':False,'source_report':'docs/security-card-store-hardening-round2-2026-11-08.md'}},
 'not_run':['KC full suite in round4','real MySQL concurrent row/gap locks and deadlocks','real disconnect/process crash recovery','production KC artifact and host compose','main-site/TG runtime acceptance','WAF and production permission acceptance','guest promo archive contracts','A5-G3 manual acceptance','Docker build','SQL/migrations','deployment'],
 'test_limit':'Stateful mysql2 offline model serializes full transactions; actual source worker runs with mocked store in VM. Passing tests cannot establish real InnoDB lock, isolation or crash semantics.'})
writejson(evidence/'packaging-boundary.json',{
 'basis':'Read-only static source review, no Docker build or host inspection',
 'kc':{'dockerfile':'services/kc-pay-gpt/Dockerfile','copy':'COPY . .','entrypoint':'node server.js','runtime_files_not_excluded_by_dockerignore':['mysql-store.js','server.js','task-safety.js'],'compose':'Repository build context and bind mounts include KC source; production host-level compose is unverified.'},
 'verify':{'dockerfile':'deploy/kvm4/verify-server.Dockerfile','does_not_copy':'services/kc-pay-gpt'},
 'consequence':'KC requires a separately verified artifact. Vercel or Verify success alone cannot prove KC changes are live.',
 'production_protected':['/opt/kc-pay-gpt/.env','/opt/kc-pay-gpt/docker-compose.yml','data/','debug_screenshots/','product_files/','mysql_data'],
 'mysql2_found_rows':'Installed local mysql2 default flags include FOUND_ROWS; local store pool does not override flags. Production installed package and actual affectedRows semantics NOT RUN.'})

report.write_text('''# 发卡站安全加固第 4 轮：KC 本地结算与自动续费核验

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
''')
(evidence/'README.md').write_text('''# 第 4 轮 KC 本地结算证据

关联报告：`docs/security-card-store-hardening-round4-2026-11-08.md`。

- `baseline-and-boundaries.json`：基线与本轮边界；两个展开 dirty 清单；归档本身会新增文档路径。
- `backup-verification.json`、`backup-manifests/`：8 份预存哈希核验通过，另 3 份无预存 manifest 的快照只证明本次可读。原逐文件备份保留在 JSON 指向的 `/tmp` 位置，不是全工作区备份。
- `delta/`：对本轮修改前 dirty 备份的差异；不能作为 HEAD 到当前完整发布清单。
- `raw/`：原始失败、中间通过、最终通过、语法与空白检查；未覆盖历史失败。
- `verification-results.json`：最终 107 + 185 = 292 定向通过。命令和退出码整理自会话，原日志按字节复制。KC 全量本轮 NOT RUN。
- `whitespace-interpretation.json`：保留 no-index 原退出 1，以本机对照解释；未因包装脚本误判而改源码。
- `source-manifest.json`：归档时当前文件哈希，不是干净候选提交或对以前运行的追溯绑定。
- `packaging-boundary.json`：静态 KC/Verify 包含范围，生产 NOT RUN。
- `raw-provenance.json` / `evidence-manifest.json`：复制源、字节一致性与归档哈希。

测试隔离工具是 Node API guard，不是 OS 沙箱。`run.py` 中绝对路径指向原 `/tmp/security-test-isolation-20261108/`；原文件保留。若复现，请输出到新的日志文件，勿覆盖归档及原始失败记录。round4 原生测试基线覆写环境名是 `KC_LOCAL_STORE_SOURCE`，而 launcher 的 `--baseline-store` 设置的是其他测试使用的 `KC_ATOMIC_STORE_SOURCE`；两者不可混用。

没有执行 SQL、真实数据库/支付、部署或生产 worker。本轮没有主站/TG/WAF 运行时验收。报告中的后续事项保持待办，归档不表示批准上线。
''')
writejson(evidence/'raw-provenance.json',{'copied_at_utc':now,'copies':provenance,'excluded':'Cumulative blocked-reads.jsonl from other runs/rounds; not a dedicated round4 boundary log.'})
# Preserve the exact archival procedure; it is not a test-execution transcript.
copy(tmp/'archive-round4.py','archive-procedure.py','archive-time procedure; refuses to overwrite existing archive')
# Re-save provenance including the archiver copy, then seal all archive contents.
writejson(evidence/'raw-provenance.json',{'copied_at_utc':now,'copies':provenance,'excluded':'Cumulative blocked-reads.jsonl from other runs/rounds; not a dedicated round4 boundary log.'})
files=sorted(p for p in evidence.rglob('*') if p.is_file())
entries=[{'path':str(p.relative_to(repo)),'sha256':sha(p),'bytes':p.stat().st_size} for p in files]
entries.append({'path':str(report.relative_to(repo)),'sha256':sha(report),'bytes':report.stat().st_size})
writejson(evidence/'evidence-manifest.json',{'captured_at_utc':now,'algorithm':'SHA-256','scope':'Archive files and associated report; manifest excludes itself. These hashes seal current evidence copies, not a release candidate.','files':entries})
assert all(sha(repo/r['path'])==r['sha256'] for r in entries)
print(json.dumps({'report':str(report),'evidence':str(evidence),'sealed_files':len(entries),'copied_files':len(provenance),'backup_hash_matches':8,'focused_pass':292,'focused_fail':0},ensure_ascii=False,indent=2))
