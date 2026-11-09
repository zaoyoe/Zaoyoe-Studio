#!/usr/bin/env python3
"""Archive existing round-6 local evidence; never stage, restore or deploy."""
import concurrent.futures, difflib, hashlib, json, re, shutil, subprocess, tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/Volumes/chao/AI/xianyu_profit_calculator')
BACKUP = Path('/tmp/kc-round6-owner-cas-20261108-before')
OUT = ROOT / 'docs/security-audit-evidence/2026-11-08-card-store-round6'
REPORT = ROOT / 'docs/security-card-store-hardening-round6-2026-11-08.md'
EXPECTED_HEAD = '75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8'
EXPECTED_INDEX = '0cffdc8f7b49154ec9082ca7c97b5b5a0be0c4df5dd6ae1c20526f9aca9130b7'

def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def command(args, cwd=ROOT):
    p = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    return {'command': args, 'cwd': str(cwd), 'exit': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr}
def git(*args):
    p = command(['git', *args])
    assert p['exit'] == 0, p
    return p['stdout'].strip()
def save(name, data):
    p = OUT/name; p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False)+'\n')
def index_path():
    p=Path(git('rev-parse','--git-path','index'))
    return p if p.is_absolute() else ROOT/p

assert not OUT.exists() and not REPORT.exists(), 'Never overwrite an existing historical archive'
assert git('rev-parse','HEAD') == EXPECTED_HEAD
assert git('rev-parse','origin/main') == EXPECTED_HEAD
assert git('rev-list','--count','HEAD..origin/main') == '0'
assert git('remote','get-url','origin') == 'https://github.com/zaoyoe/Zaoyoe-Studio.git'
assert git('branch','--show-current') == 'main'
assert git('diff','--cached','--name-only') == ''
assert digest(index_path()) == EXPECTED_INDEX

baseline=json.loads((BACKUP/'baseline.json').read_text())
snapshots=json.loads((BACKUP/'manifest.json').read_text())
new_paths=['tests/security-round6-kc-card-ownership.test.js','tests/security-round6-kc-payment-callers.test.js']
modified_paths=[x['path'] for x in snapshots]
source_paths=modified_paths+new_paths
source_before={rel:digest(ROOT/rel) for rel in source_paths}
status_before=command(['git','status','--porcelain','--untracked-files=all'])['stdout']
original_status=(BACKUP/'status-before.txt').read_text()
missing_before=sorted(set(original_status.splitlines())-set(status_before.splitlines()))
assert not missing_before
unattributed_before=[' M js/engagement-runtime-loader.js']
assert set(unattributed_before) <= set(status_before.splitlines())
unattributed_hashes={'js/engagement-runtime-loader.js':digest(ROOT/'js/engagement-runtime-loader.js')}
historical_paths=[ROOT/'docs/security-card-store-hardening-round5-2026-11-08.md', *sorted((ROOT/'docs/security-audit-evidence/2026-11-08-card-store-round5').rglob('*'))]
historical_before={str(p.relative_to(ROOT)):digest(p) for p in historical_paths if p.is_file()}

scan=json.loads(Path('/tmp/kc-round6-log-pattern-scan-prearchive.json').read_text())
assert all(all(n==0 for n in row['match_counts'].values()) for row in scan['results'])
OUT.mkdir(parents=True)
for name in ['raw','delta','backup-manifests']:(OUT/name).mkdir()
save('log-pattern-scan.json',scan)
for name in ['baseline.json','manifest.json']:
    shutil.copyfile(BACKUP/name,OUT/'backup-manifests'/name)
(OUT/'baseline-status-expanded.txt').write_text(original_status)
(OUT/'status-before-archive-expanded.txt').write_text(status_before)

backup_checks=[]
for entry in snapshots:
    p=BACKUP/entry['path']; sha=digest(p)
    check={**entry,'snapshot_absolute_path':str(p),'observed_sha256':sha,'verified':sha==entry['sha256'],'observed_bytes':p.stat().st_size}
    assert check['verified'] and check['observed_bytes']==entry['bytes']
    backup_checks.append(check)
save('backup-verification.json',{'scope':'Seven per-file pre-change dirty byte snapshots, not a complete workspace or database backup. Snapshot bytes remain at the recorded /tmp paths; /tmp retention is not guaranteed. The archive stores manifests and exact round deltas. No backup commit or stash created.','entries':backup_checks})

patches=[]; whitespace=[]
for rel in source_paths:
    before=(BACKUP/rel).read_text() if rel in modified_paths else ''
    after=(ROOT/rel).read_text()
    patch=''.join(difflib.unified_diff(before.splitlines(keepends=True),after.splitlines(keepends=True),fromfile='a/'+rel if rel in modified_paths else '/dev/null',tofile='b/'+rel))
    assert patch
    name=rel.replace('/','__')+'.patch'
    (OUT/'delta'/name).write_text(patch); patches.append(patch)
    check=command(['git','diff','--no-index','--check','--',str(BACKUP/rel) if rel in modified_paths else '/dev/null',str(ROOT/rel)])
    whitespace.append({**check,'path':rel,'interpretation':'No whitespace diagnostics' if not(check['stdout'] or check['stderr']) else 'REVIEW'})
combined=''.join(patches)
(OUT/'delta/round6-working-tree-delta.patch').write_text(combined)
save('whitespace-results.json',{'note':'git diff --no-index --check can return 1 for differing files without whitespace diagnostics; exits are recorded exactly. These compare round snapshots, not HEAD.','results':whitespace})
assert all(not (x['stdout'] or x['stderr']) for x in whitespace), 'Keep diagnostics; do not claim clean whitespace'

# Only touch temporary byte copies, never restore or apply patches to the checkout.
tmp=Path(tempfile.mkdtemp(prefix='kc-round6-delta-recovery-'))
for rel in source_paths:
    dst=tmp/rel;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/rel,dst)
reverse=command(['patch','-p1','-R','--batch','--fuzz=0','-i',str(OUT/'delta/round6-working-tree-delta.patch')],cwd=tmp)
assert reverse['exit']==0,reverse
restored=[{'path':x['path'],'expected_sha256':x['sha256'],'actual_sha256':digest(tmp/x['path']),'matches':digest(tmp/x['path'])==x['sha256']} for x in snapshots]
assert all(x['matches'] for x in restored)
removed=[{'path':rel,'absent_after_reverse':not(tmp/rel).exists()} for rel in new_paths]
assert all(x['absent_after_reverse'] for x in removed)
forward=command(['patch','-p1','--batch','--fuzz=0','-i',str(OUT/'delta/round6-working-tree-delta.patch')],cwd=tmp)
assert forward['exit']==0,forward
reapplied=[{'path':rel,'expected_sha256':source_before[rel],'actual_sha256':digest(tmp/rel),'matches':digest(tmp/rel)==source_before[rel]} for rel in source_paths]
assert all(x['matches'] for x in reapplied)
save('delta-recovery-verification.json',{'scope':'Round-only differences from seven dirty snapshots and two newly created tests; not a complete HEAD release manifest. Reverse and forward application occurred in a temporary byte copy only.','temporary_copy':str(tmp),'reverse_command':reverse,'restored_snapshots':restored,'new_files_removed':removed,'forward_command':forward,'reapplied_sources':reapplied,'status':'PASS'})

logs=[
 ('kc-round6-baseline-native.log',157,1,156,0,1,'FAIL','Initial 157 tests against pre-change dirty store; not the later 164-test version.'),
 ('kc-round6-native-first.log',157,1,156,0,1,'FAIL','Apply script failed before writing runtime source. This is still old-source evidence, not an after-fix result.'),
 ('kc-round6-native-after.log',157,157,0,0,0,'PASS','Intermediate; before seven additional store assertions.'),
 ('kc-round6-vitest-adapted.log',105,105,0,0,0,'PASS','Intermediate three-file result, excluded from final sum.'),
 ('kc-round6-retry-before-callback-fix.log',100,25,10,65,1,'FAIL','Selected callback failures before callback fix, not a whole-round baseline.'),
 ('kc-round6-vitest-after-callback-fix.log',140,140,0,0,0,'PASS','Intermediate three-file result after callback fix.'),
 ('kc-round6-native-final.log',315,315,0,0,0,'PASS','Final native: 151 earlier-round cases plus 164 round-6 store cases.'),
 ('kc-round6-vitest-final.log',362,362,0,0,0,'PASS','Final 10-file Vitest selection.'),
 ('kc-round6-caller-compatibility-final.log',15,15,0,0,0,'PASS','Final caller tests: real complete ChatGPT module with mocked external dependencies; index expression/argument contract only, not a complete CLI/browser run.'),
 ('kc-round6-chatgpt-regression-final.log',18,18,0,0,0,'PASS','Final two-file ChatGPT selection after caller changes.'),
]
results=[]
for filename,total,passed,failed,skipped,exit_code,status,note in logs:
    original=Path('/tmp')/filename;dest=OUT/'raw'/filename
    shutil.copyfile(original,dest)
    assert digest(original)==digest(dest)
    text=dest.read_text()
    if 'native' in filename or 'caller-compatibility' in filename:
        def count(key):
            matches=re.findall(r'(?:^|\n)(?:#|ℹ) '+re.escape(key)+r' (\d+)\b',text)
            assert len(matches)==1,(filename,key,matches)
            return int(matches[0])
        assert [count(k) for k in ['tests','pass','fail','skipped']]==[total,passed,failed,skipped]
    else:
        assert f'{passed} passed' in text
        if failed:assert f'{failed} failed' in text
        if skipped:assert f'{skipped} skipped' in text
    results.append({'log':'raw/'+filename,'tests':total,'passed':passed,'failed':failed,'skipped':skipped,'exit_code_from_session_record':exit_code,'status':status,'note':note,'raw_sha256':digest(dest),'count_validation':'Matched raw summary'})
for name in ['run.py','preload.cjs']:
    shutil.copyfile(Path('/tmp/security-test-isolation-20261108')/name,OUT/'raw'/name)
shutil.copyfile('/tmp/kc-round6-syntax-final.json',OUT/'raw/syntax-results.json')

native_tests=[
 'tests/security-round2-kc-activation.test.js','tests/security-round3-kc-activation-atomic.test.js',
 'tests/security-round4-kc-local-settlement.test.js','tests/security-round5-kc-owner-locks.test.js',
 'tests/security-round6-kc-card-ownership.test.js']
vitest_tests=[f'test/{n}.test.js' for n in ['openai-payment-method','payment-retry-safety','mysql-card-cooldown','recharge-routing','card-freeze','payment-protocol-fallback','gpt-api-client','stripe-protocol-payment','task-safety','payment-decline-dictionary']]
commands=[
 {'log':'raw/kc-round6-native-final.log','cwd':str(ROOT),'command':['node','--test','--test-reporter=tap',*native_tests],'provenance':'Reconstructed semantic command and reporter from session summary/raw log; argument ordering not a shell transcript.'},
 {'log':'raw/kc-round6-vitest-final.log','cwd':str(ROOT/'services/kc-pay-gpt'),'command':['node','./node_modules/vitest/vitest.mjs','run',*vitest_tests,'--no-file-parallelism','--maxWorkers=1'],'provenance':'Reconstructed semantic command/test selection from session summary; not an independently persisted shell transcript.'},
 {'log':'raw/kc-round6-caller-compatibility-final.log','cwd':str(ROOT),'command':['node','--test',new_paths[1]],'provenance':'Command retained in session summary.'},
 {'log':'raw/kc-round6-chatgpt-regression-final.log','cwd':str(ROOT/'services/kc-pay-gpt'),'command':['node','./node_modules/vitest/vitest.mjs','run','test/chatgpt-billing.test.js','test/chatgpt-checkout-team-promo.test.js','--no-file-parallelism','--maxWorkers=1'],'provenance':'Command retained in session summary.'},
]
save('raw-provenance.json',{'raw_logs':'Ten original logs copied byte-for-byte after finite text-shape scanning. Intermediate source versions are not reconstructed and are not claimed to be rerunnable from the final tree.','exit_codes':'From prior execution/session record, not embedded in all raw outputs or freshly rerun during archive.','final_commands':commands,'launcher':'python3 /tmp/security-test-isolation-20261108/run.py --cwd <cwd> --log <original-log> -- <command>','baseline_source':'Initial baseline used KC_ATOMIC_STORE_SOURCE pointing at '+str(BACKUP/'services/kc-pay-gpt/mysql-store.js')+'. Current test source has 164 cases; the initial 157-case snapshot is not separately retained.','intermediate_commands':'Not fully retained; scope/counts/stage are recorded without inventing exact command lines.','source_status':'All results were produced with dirty local files, not a clean committed release candidate.'})
final_components=[r for r in results if any(r['log']==c['log'] for c in commands)]
assert sum(r['passed'] for r in final_components)==710 and sum(r['failed'] for r in final_components)==0
save('verification-results.json',{'runs':results,'final_focused_total':{'passed':710,'failed':0,'skipped':0,'components':[r['log'] for r in final_components]},'counting_boundary':'Only four final invocations count toward 710. Do not add baseline/intermediate runs or the historical full suite. The 151 earlier-round cases intentionally occur inside native-final.','final_file_counts':{'vitest':10,'chatgpt_additional_vitest':2,'syntax':9},'historical_full_suite':{'status':'FAIL','passed':1672,'failed':40,'skipped':0,'files':71,'passed_files':63,'failed_files':8,'exit_code':1,'source':'../2026-11-08-card-store-round5/verification-results.json','round6_rerun':'NOT RUN'},'real_database_and_production':'NOT RUN'})

coverage_paths=list(dict.fromkeys(source_paths+native_tests+['services/kc-pay-gpt/'+p for p in vitest_tests]+['services/kc-pay-gpt/test/chatgpt-billing.test.js','services/kc-pay-gpt/test/chatgpt-checkout-team-promo.test.js']))
save('source-manifest.json',{'scope':'Hash of dirty local source at archive time, including final-test inputs. Not a clean candidate commit, an attestation of test-time immutability, or a complete release manifest.','files':[{'path':rel,'bytes':(ROOT/rel).stat().st_size,'sha256':digest(ROOT/rel),'round6_delta':rel in source_paths} for rel in coverage_paths]})
packaging_paths=['services/kc-pay-gpt/Dockerfile','services/kc-pay-gpt/.dockerignore','deploy/kvm4/verify-server.Dockerfile']
save('packaging-boundary.json',{'static_files':[{'path':rel,'sha256':digest(ROOT/rel)} for rel in packaging_paths],'kc_runtime_delta':[p for p in modified_paths if '/test/' not in p],'finding':'KC Dockerfile line 43 COPY . . includes the four changed runtime JS files under its service context; .dockerignore does not exclude them. Verify image uses explicit COPY paths and does not copy KC. KC is an independent production chain.','not_verified':['KC Docker image build','host compose and image contents','KC running release','Vercel production','KVM4 Verify/TG worker','NewAPI','WAF and production permissions'],'host_preservation':'No changes to /opt/kc-pay-gpt/.env, docker-compose.yml, data/, debug_screenshots/, product_files/, mysql_data.'})
save('baseline-and-boundaries.json',{'archive_time_utc':datetime.now(timezone.utc).isoformat(),'git_baseline':baseline,'remote':'https://github.com/zaoyoe/Zaoyoe-Studio.git','fetch':'git fetch origin main succeeded immediately before this archive; HEAD and origin/main unchanged; behind=0.','authorization':'Local implementation, offline verification, and evidence archive only. No staging, commit, push, PR or deployment. No SQL, real DB, real payment, production configuration or worker changes.','test_isolation':'Launcher only inherits PATH/TMPDIR/LANG/TZ and injects a synthetic session key. Node fs guard blocks actual .env* reads; Node net/tls/dgram outbound connections are blocked, including loopback. Not an OS, browser, native-addon or independent-subprocess network sandbox. Cumulative blocked-read logs are not new round-6 evidence.','unattributed_extra_status_before_archive':unattributed_before,'unattributed_scope_note':'Observed outside this round; retained without attributing origin, restoring, or including in the round patch. Baseline status rows record paths/status, not all workspace bytes.','not_run':['Real MySQL concurrency/locking/affectedRows semantics','deadlocks','disconnects and ambiguous COMMIT','crash recovery','full KC suite rerun in round6','main-site/TG/NewAPI/WAF production verification'],'out_of_scope':['虎皮椒','爱发电']})

REPORT.write_text('''# 第 6 轮安全加固：KC 银行卡锁归属与支付调用兼容性

日期：2026-11-08。本轮修改保留在本地 dirty 工作区，未暂存、未提交、未推送、未创建 PR、未部署。未执行 SQL、未连接真实数据库、未做真实支付、未改生产配置或启动生产 worker。主站、TG、NewAPI 和线上 WAF 本轮均没有新增验收；本报告不能证明三个系统已全面防住攻击。

## 1. 本轮修复与结论

原有单卡释放、冷却、报废、人工复核、用量和支付资料更新缺少一致的锁归属约束，旧任务或迟到 finally 可能按资产 ID 修改已经转交给另一任务的卡。本轮把这组自动操作改为同时校验资产 ID、active、正常状态、in_use 和完整 owner，并在执行变更的同一条 SQL WHERE 中用二进制比较 owner；用量统计的锁定读取及更新均检查归属。失锁后不把受保护的变更当成成功。

支付模块为同一次调用传播同一个 owner。没有 JOB_KEY 的调试/手动入口改为由支付模块生成随机 owner，避免把 CDK 放进锁名，也避免此前 CLI 的 CDK＋时间戳超过新长度限制。合法任务 JOB_KEY 原样保留，非法或超长值停止支付。预热卡必须携带相同 owner receipt；没有找到生产者的代码路径，因此只验证消费端契约，不声称端到端预热链路已验收。

在识别支付结果后、调用结果持久化回调前，先设置内存 cardHandled 标记，防止回调、支付资料或用量写库异常被 finally 误认为“尚未处理”而普通释放。这个标记不是持久恢复机制：回调在冷却/隔离之前失败时，卡仍可能只是普通 in_use，其他回收入口尚未闭环。

## 2. 修改清单与接口契约

| 文件 | 变化 |
|---|---|
| services/kc-pay-gpt/mysql-store.js | owner/ID 严格校验；自动卡操作的同语句归属条件；保留锁定 receipt；runtime 释放传 owner |
| services/kc-pay-gpt/payment-retry.js | owner 校验、随机 fallback、全路径传 owner、预热 receipt、失锁停止和回调前 cardHandled |
| services/kc-pay-gpt/index.js | 未提供 JOB_KEY 时不再使用包含 CDK 的 fallback |
| services/kc-pay-gpt/chatgpt.js | 两个入口只传 JOB_KEY 或 undefined，由支付模块生成缺省 owner |
| services/kc-pay-gpt/test/mysql-card-cooldown.test.js | 适配并验证冷却/失锁契约 |
| services/kc-pay-gpt/test/payment-retry-safety.test.js | 支付回调、资料/用量失败、预热、失锁和清理回归 |
| services/kc-pay-gpt/test/payment-protocol-fallback.test.js | 适配归属与释放结果契约 |
| tests/security-round6-kc-card-ownership.test.js | 新增 164 项 store 离线模型测试 |
| tests/security-round6-kc-payment-callers.test.js | 新增 15 项 caller 兼容性测试 |

存储 owner 接受 1–64 位 ASCII 字母、数字、下划线、连字符，不 trim、不截断、不清洗；资产 ID 必须为正安全整数或规范数字字符串。支付模块显式 JOB_KEY 限 1–48 位，在存储中使用 payment_ 前缀；缺省 owner 使用 payment_debug_ 加 16 字节安全随机数的十六进制表示。releaseCard 返回 0/1，0 是未修改的幂等结果；支付正常流程要求释放恰好影响 1 行，否则停止。其他受保护卡变更影响 0 行时抛出 CARD_LOCK_OWNERSHIP_LOST。拒付冷却若失锁立即停止，其他数据库错误仍尝试带相同 owner 的隔离。

releaseRuntimeAssets 在任何 UPDATE 前验证两个 ID，随后分别执行带 owner 的 UPDATE；它不是跨资产事务，不能保证故障时两个资产全有或全无。管理员 setCardFrozen、邮箱预留 reservePoolEmail 没有纳入本轮自动卡归属改造。

## 3. 验证与证据边界

| 验证 | 结果 | 退出码 |
|---|---|---|
| 初始 157 项对修改前 dirty store | 1 PASS / 156 FAIL | 1 |
| 回调修复前选定断言 | 25 PASS / 10 FAIL / 65 SKIP | 1 |
| 最终原生定向，第 2–6 轮 | 315 PASS / 0 FAIL / 0 SKIP | 0 |
| 最终 KC 十文件 Vitest | 362 PASS / 0 FAIL | 0 |
| 调用入口兼容性 | 15 PASS / 0 FAIL | 0 |
| 追加 ChatGPT 两文件回归 | 18 PASS / 0 FAIL | 0 |
| 本轮最终定向合计 | **710 PASS / 0 FAIL**，只合计上述四个最终调用 | 四次均 0 |
| 修改/新增 JS 语法 | 9 个文件通过 | 九次均 0 |
| 9 文件增量在临时字节副本逆向恢复、正向重放 | PASS，分别核对修改前 7 文件及修改后 9 文件 SHA256 | 两次 patch 均 0 |
| 第 5 轮历史 KC 全量 71 文件 | **1672 PASS / 40 FAIL**，本轮未重跑 | **1** |
| 真实 MySQL、真实支付及生产验收 | **NOT RUN** | — |

原生 315 项包含原有 151 项和本轮 store 164 项。164 项使用真实完整 store 模块加 SQL WHERE 驱动的离线状态模型，并非真实 MySQL；mysql2 FOUND_ROWS 只离线实例化配置，不能作为服务器 affectedRows 实际语义证据。15 项 caller 测试中两个 ChatGPT 入口执行真实完整模块且依赖、页面/checkout/支付均 mock；index 仅执行 owner 表达式并检查传参契约，不是完整 CLI/browser 测试。

710 项在 dirty 本地源码上执行，不能称为全量通过或干净发布候选验证。原始失败、中间通过和最终通过日志分别保留，不叠加计数。首个应用脚本写源码前失败后的 native-first 日志仍属于旧源码结果。初始测试是 157 项，后增至 164 项；未保存初始 157 项测试源码快照，不能用当前测试冒充逐字节可复现的旧版本。命令与退出码哪些由会话记录重建，见 raw-provenance.json。

历史 40 项失败分别为 checkout-debug-server 26、gpt-outsourcing-admin 2、grok-commerce 2、pricing-flow 1、proxy-region-matcher 1、proxy-session-and-region 1、recharge-card-fixed-scroll 1、recharge-ui 6。第 5 轮两项 UI 复跑仍失败。该历史结论继续保留；本轮没有证明它们已解决，也没有重写第 5 轮证据。

离线启动器仅继承有限环境变量并注入合成 session key，Node guard 阻止真实 .env* 读取及 net/tls/dgram 连接。它不是操作系统、Chromium/native addon 或独立子进程的完整网络沙箱；跨轮累计 blocked-read 日志不视为本轮独立证据。归档前有限凭证形态扫描未匹配，并非完整无秘密证明。

## 4. 仍未闭合的资金风险

| 优先级 | 剩余方向 | 当前边界 |
|---|---|---|
| P1 | 支付结果持久恢复与回收联动 | 内存 cardHandled 不能替代持久 pending/manual 状态；回调失败后的普通 in_use 卡仍可能被其他入口清理 |
| P1 | releaseStaleAssetLocks | 目前对 gptapi 未结算任务有保护；普通 payment owner 尚无同等支付状态保护 |
| P1 | releaseCardsByOwner 与 server 清理 | 即使 owner 精确，仍仅依据正常状态清理，未根据 payment_state 判定可回收；server 三处调用需与持久恢复一并收紧 |
| P1 | 租约代际和旧进程继续提交 | 相同 owner 重入/ABA 没有 generation/fencing；数据库 CAS 不阻止失锁旧进程继续向外部支付系统提交 |
| P1 | 真实数据库故障与全量欠账 | MySQL 并发、死锁、断连、COMMIT 不明、崩溃恢复未验收；历史全量 40 FAIL 未解决 |
| P2 | 跨资产释放和全系统复核 | 两个 runtime UPDATE 不是跨资产事务；主站、TG、NewAPI、WAF/权限和运行版本另行核验 |

静态复查时 reserveCard 和 reserveAssetRow 的 card 分支都要求 in_use=0；不能声称这两个入口本身直接抢占超时的 in_use 卡。reserveAssetRow 的 phone 分支允许 stale 条件。银行卡超时清理风险来自单独的 releaseStaleAssetLocks 等回收入口。下一轮先设计“支付提交证据持久化→确认未扣款/成功/未知→有依据地结算或隔离→回收”的状态闭环，覆盖超时、批量和崩溃清理；不得靠缩短超时或无条件重试处理结果不明。

## 5. 包装、备份和 Git 完整性

KC 是独立服务。静态 Dockerfile 的 COPY . . 会包含本轮四个 runtime 文件，KC .dockerignore 没有排除它们；Verify Dockerfile 不复制 KC。未构建镜像、未核验生产 host compose 或实际镜像内容，Vercel/Verify 发布成功也不能证明 KC 已上线。本轮未接触 /opt/kc-pay-gpt 的 .env、host docker-compose.yml、data/、debug_screenshots/、product_files/ 或 mysql_data。

基线分支 main，HEAD 与 origin/main 同为 75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8，归档前重新 fetch 成功且 behind=0。原有 551 条展开 dirty 状态记录在归档前全部保留。另观察到 js/engagement-runtime-loader.js 的范围外改动，保留并单独记录，不纳入本轮 delta，不推断改动来源。状态记录的保留不等于已保存整个工作区所有文件的历史字节。

修改前 7 份逐文件 dirty 字节快照位于 /tmp/kc-round6-owner-cas-20261108-before，清单及读回核验保存在证据目录。它们不是完整工作区/数据库备份，也未创建备份 commit 或 stash；/tmp 保留期限无保证。归档包含本轮精确 delta、临时副本逆向恢复与正向重放结果、原始日志、源码 SHA256、语法和包装边界。源码哈希不追认为已提交候选版本。

证据目录：docs/security-audit-evidence/2026-11-08-card-store-round6/。final-integrity.json 记录归档后 HEAD、remote、origin/main、index、staging、551 条原状态记录、9 个源码哈希和第 5 轮历史证据哈希的复核。evidence-manifest.json 收录报告和除自身外的证据文件哈希，它不是签名或不可篡改证据。

| 系统/能力 | 状态 |
|---|---|
| KC 本轮定向离线验证 | PASS：710 项 |
| KC 全量 | 历史 FAIL：1672 PASS / 40 FAIL；本轮重跑 NOT RUN |
| 真实 MySQL/支付/恢复验收 | NOT RUN |
| KC 生产独立产物 | NOT RUN；本地修复未上线 |
| 主站/Vercel、Verify/TG、NewAPI、WAF/生产权限 | NOT RUN |
| 提交、推送、PR、部署、SQL、游客购买启用 | NOT RUN |
''')
(OUT/'README.md').write_text('''# 第 6 轮 KC 银行卡锁归属证据

报告：docs/security-card-store-hardening-round6-2026-11-08.md。

- baseline-and-boundaries.json、两个 expanded 状态清单：Git/dirty 基线、隔离和 NOT RUN 边界，以及本轮范围外改动的记录。
- backup-manifests/、backup-verification.json：7 份逐文件 dirty 快照清单和读回核验；快照字节仍在记录的 /tmp 路径，不是完整工作区或数据库备份。
- delta/、delta-recovery-verification.json：7 个已存在文件和 2 个新测试的本轮精确增量；仅在临时字节副本逆向恢复并正向重放核对哈希，未 restore 工作区。
- raw/、raw-provenance.json、verification-results.json：原始失败、中间和最终日志；4 个最终调用合计 710 PASS / 0 FAIL；历史第 5 轮全量 40 FAIL 保留，本轮未重跑。
- source-manifest.json：归档时 dirty 源码哈希，不是干净发布候选，也不是原测试执行瞬间不可变证明。
- raw/syntax-results.json、whitespace-results.json：9 个 JS 语法结果、逐文件 delta 空白检查的真实退出码。
- packaging-boundary.json：只验证静态 KC Docker 包含关系；未构建镜像、未验收任何生产运行版本。
- log-pattern-scan.json：复制日志前有限形态扫描，不是完整无秘密证明，不输出匹配值。
- final-integrity.json、evidence-manifest.json：归档后的本地完整性检查与文件哈希；不是签名证据。

源码与调用测试的初始/中间版本未全部快照化，命令和退出码部分来自会话记录，详见 raw-provenance.json。离线状态模型不代替真实 MySQL、实际扣款、崩溃恢复或生产验收。

未暂存、未提交、未推送、未创建 PR、未部署、未执行 SQL、未连接真实数据库或进行真实支付；本地修复尚未上线。未闭环的支付持久恢复、超时/批量清理和相同 owner 重入风险见报告。
''')
shutil.copyfile(Path(__file__),OUT/'archive-procedure.py')

# No source or historical evidence may be modified by archiving.
source_after={rel:digest(ROOT/rel) for rel in source_paths}
historical_after={rel:digest(ROOT/rel) for rel in historical_before}
status_after=command(['git','status','--porcelain','--untracked-files=all'])['stdout']
missing_after=sorted(set(original_status.splitlines())-set(status_after.splitlines()))
checks={
 'head_unchanged':git('rev-parse','HEAD')==EXPECTED_HEAD,
 'origin_main_unchanged':git('rev-parse','origin/main')==EXPECTED_HEAD,
 'branch_unchanged':git('branch','--show-current')=='main',
 'origin_unchanged':git('remote','get-url','origin')=='https://github.com/zaoyoe/Zaoyoe-Studio.git',
 'index_sha256_unchanged':digest(index_path())==EXPECTED_INDEX,
 'staging_empty':git('diff','--cached','--name-only')=='',
 'baseline_status_rows_retained':not missing_after,
 'round6_source_bytes_unchanged_during_archive':source_after==source_before,
 'round5_historical_evidence_bytes_unchanged_during_archive':historical_after==historical_before,
 'snapshots_still_readable_and_matching':all(digest(BACKUP/e['path'])==e['sha256'] for e in snapshots),
 'unattributed_file_unchanged_during_archive':all(digest(ROOT/rel)==sha for rel,sha in unattributed_hashes.items()),
}
assert all(checks.values()),checks
save('final-integrity.json',{'status':'PASS','checks':checks,'head':EXPECTED_HEAD,'origin_main':EXPECTED_HEAD,'index_sha256':EXPECTED_INDEX,'baseline_expanded_status_rows':len(original_status.splitlines()),'pre_archive_expanded_status_rows':len(status_before.splitlines()),'status_rows_after_archive_before_final_metadata':len(status_after.splitlines()),'missing_baseline_rows':missing_after,'scope':'The row counts use --untracked-files=all. Baseline status rows do not prove all workspace bytes were snapshotted. final metadata and evidence manifest create further untracked rows.','round6_source_before':source_before,'round6_source_after':source_after,'historical_round5_file_sha256':historical_before,'unattributed_preserved_file_sha256':unattributed_hashes,'not_executed':['git add','git commit','git push','PR creation','deployment','SQL','reset/restore/clean/rebase/branch switch']})
manifest_files=[REPORT,*sorted(OUT.rglob('*'))]
save('evidence-manifest.json',{'scope':'SHA256 inventory excludes this manifest itself; no cryptographic signature or immutability claim.','files':[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':digest(p)} for p in manifest_files if p.is_file() and p.name!='evidence-manifest.json']})
print(json.dumps({'report':str(REPORT),'evidence':str(OUT),'final_focused_passed':710,'failed':0,'backup_files_verified':len(backup_checks),'delta_reverse_and_forward':'PASS','raw_logs':len(logs),'history_preserved_files':len(historical_before),'integrity_checks':checks},ensure_ascii=False))
