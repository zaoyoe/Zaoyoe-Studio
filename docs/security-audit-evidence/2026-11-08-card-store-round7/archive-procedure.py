from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import json, hashlib, difflib, shutil, subprocess, tempfile, re

ROOT=Path('/Volumes/chao/AI/xianyu_profit_calculator')
OUT=ROOT/'docs/security-audit-evidence/2026-11-08-card-store-round7'
BASE=Path('/tmp/kc-round7-payment-hold-20261108-before')
ROUND6=Path('/tmp/kc-round7-regression-before-20261108')
assert not OUT.exists(), 'Archive already exists; inspect and back up before editing'

def sha(data):return hashlib.sha256(data).hexdigest()
def h(path):return sha(Path(path).read_bytes())
def command(args,cwd=ROOT):
 p=subprocess.run(args,cwd=cwd,capture_output=True,text=True)
 return dict(command=args,cwd=str(cwd),exit=p.returncode,stdout=p.stdout,stderr=p.stderr)
def put(name,obj):
 p=OUT/name;p.parent.mkdir(parents=True,exist_ok=True)
 p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def copy(src,name):
 p=OUT/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(Path(src).read_bytes())

manifest=json.loads((BASE/'manifest.json').read_text())
assert command(['git','rev-list','--count','HEAD..origin/main'])['stdout'].strip()=='0'
assert command(['git','rev-parse','HEAD'])['stdout'].strip()==manifest['head']
assert command(['git','remote','get-url','origin'])['stdout'].strip()=='https://github.com/zaoyoe/Zaoyoe-Studio.git'
assert not command(['git','diff','--cached','--name-only'])['stdout']
assert h(ROOT/command(['git','rev-parse','--git-path','index'])['stdout'].strip())==manifest['index_sha256']
originals={v['path']:dict(path=BASE/v['path'],expected=v['sha256']) for v in manifest['snapshots']}
for name,item in manifest['round7_additional_snapshots'].items():originals[name]=dict(path=Path(item['backup']),expected=item['sha256'])
rm=json.loads((ROUND6/'manifest.json').read_text())
for v in rm['snapshots']:originals[v['path']]=dict(path=ROUND6/v['path'],expected=v['sha256'])
new=['tests/security-round7-kc-payment-hold.test.js']
changed=list(originals)+new
backup_records=[]
for name,v in originals.items():
 actual=h(v['path']);assert actual==v['expected'],name
 backup_records.append(dict(path=name,snapshot_absolute_path=str(v['path']),sha256=actual,bytes=v['path'].stat().st_size,verified=True))
resume=json.loads(Path('/tmp/kc-round7-resume-20261108/manifest.json').read_text())
resume_records=[]
for name,expected in resume.items():
 p=Path('/tmp/kc-round7-resume-20261108')/name
 assert h(p)==expected,name
 resume_records.append(dict(path=name,snapshot_absolute_path=str(p),sha256=expected,verified=True))
historical=[]
for name,expected in manifest['round6_historical_hashes'].items():
 actual=h(ROOT/name);assert actual==expected,name
 historical.append(dict(path=name,expected_sha256=expected,actual_sha256=actual,matches=True))
status=command(['git','status','--porcelain=v1','--untracked-files=all'])['stdout']
baseline=(BASE/'baseline-status.txt').read_text()
assert set(baseline.splitlines()).issubset(set(status.splitlines()))
outside_hash=h(ROOT/'js/engagement-runtime-loader.js')
outside_handoff_hash='45aa0934ef57290f023fcf5d4b6f416d3a6b0c621e48fefb90a20631a9e0ff7d'

OUT.mkdir(parents=True)
(OUT/'.gitignore').write_text('# Preserve this round\'s original or explicitly redacted offline logs.\n!logs/*.log\n!delta/*.patch\n')
copy(__file__,Path('archive-procedure.py'))
copy(BASE/'manifest.json',Path('backup-manifests/initial.json'))
copy('/tmp/kc-round7-resume-20261108/manifest.json',Path('backup-manifests/resume.json'))
copy(ROUND6/'manifest.json',Path('backup-manifests/round6-fixture-before.json'))
copy(BASE/'baseline-status.txt',Path('baseline-status-expanded.txt'))
(OUT/'status-before-archive-expanded.txt').write_text(status)
put(Path('backup-verification.json'),dict(scope='Ten per-file dirty byte snapshots and two intermediate resume snapshots; not a complete workspace or database backup. /tmp retention is not guaranteed. No backup commit or stash. Exact round-only delta archived separately.',originals=backup_records,intermediate_resume_snapshots=resume_records))
put(Path('baseline-and-boundaries.json'),dict(round_date='2026-11-08',archived_at=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),head=manifest['head'],origin_main=manifest['origin_main'],branch='main',origin='https://github.com/zaoyoe/Zaoyoe-Studio.git',behind=0,initial_status_rows=len(baseline.splitlines()),before_archive_status_rows=len(status.splitlines()),initial_status_rows_retained=True,expected_index_sha256=manifest['index_sha256'],outside_scope=dict(path='js/engagement-runtime-loader.js',sha256=h(ROOT/'js/engagement-runtime-loader.js'),handoff_expected_sha256=outside_handoff_hash,matches_handoff=outside_hash==outside_handoff_hash,status='REVIEW',source_attribution='Not determined; file not modified or reverted by this archive procedure.',round6_historical_review_not_reclassified=True),boundary='Current dirty working tree, not a committed or deployable candidate. No staged changes, commit, push, PR, deploy, SQL, live database, real payment or production worker operation.'))

# Exact delta is relative to earliest per-file dirty snapshots, not HEAD.
patch=''
for name in changed:
 before=originals[name]['path'].read_text().splitlines(keepends=True) if name in originals else []
 after=(ROOT/name).read_text().splitlines(keepends=True)
 delta=''.join(difflib.unified_diff(before,after,fromfile='a/'+name if name in originals else '/dev/null',tofile='b/'+name))
 assert delta,name
 patch+=delta
patch_file=OUT/'delta/round7-working-tree-delta.patch';patch_file.parent.mkdir();patch_file.write_text(patch)
tmp=Path(tempfile.mkdtemp(prefix='kc-round7-delta-recovery-'))
for name in changed:
 p=tmp/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((ROOT/name).read_bytes())
reverse=command(['patch','-p1','-R','--batch','--fuzz=0','-i',str(patch_file)],tmp)
assert reverse['exit']==0,'Reverse patch failure'
restored=[dict(path=name,expected_sha256=v['expected'],actual_sha256=h(tmp/name),matches=h(tmp/name)==v['expected']) for name,v in originals.items()]
assert all(x['matches'] for x in restored)
removed=[dict(path=name,absent_after_reverse=not (tmp/name).exists()) for name in new];assert all(x['absent_after_reverse'] for x in removed)
forward=command(['patch','-p1','--batch','--fuzz=0','-i',str(patch_file)],tmp)
assert forward['exit']==0,'Forward patch failure'
replayed=[dict(path=name,expected_sha256=h(ROOT/name),actual_sha256=h(tmp/name),matches=h(ROOT/name)==h(tmp/name)) for name in changed]
assert all(x['matches'] for x in replayed)
put(Path('delta-recovery-verification.json'),dict(scope='Eleven round-only file deltas. Reverse and forward patch in temporary byte copies only; workspace and Git index untouched.',temporary_copy=str(tmp),reverse_command=reverse,restored_snapshots=restored,new_files_removed=removed,forward_command=forward,replayed_files=replayed))

# Preserve raw originals in /tmp and archive explicitly labelled redacted copies where needed.
scan=json.loads(Path('/tmp/kc-round7-log-scan-before-archive.json').read_text())
patterns=scan['finite_patterns'];provenance=[]
for entry in scan['results']:
 p=Path(entry['path']);raw=p.read_bytes();text=raw.decode('utf-8');initial_counts={k:len(re.findall(pattern,text)) for k,pattern in patterns.items()}
 replacements={}
 for key,pattern in patterns.items():text,n=re.subn(pattern,'[REDACTED_'+key.upper()+']',text);replacements[key]=n
 altered=any(replacements.values());data=text.encode('utf-8') if altered else raw
 target=OUT/'logs'/p.name;target.parent.mkdir(exist_ok=True);target.write_bytes(data)
 remaining={k:len(re.findall(pattern,data.decode('utf-8'))) for k,pattern in patterns.items()}
 assert not any(remaining.values()),p.name
 provenance.append(dict(original_absolute_path=str(p),original_sha256=sha(raw),original_bytes=len(raw),archive_relative_path=str(target.relative_to(OUT)),archive_sha256=sha(data),archive_bytes=len(data),kind='redacted-copy' if altered else 'byte-identical-original',original_pattern_counts=initial_counts,redaction_counts=replacements,post_redaction_pattern_counts=remaining))
put(Path('log-provenance.json'),dict(boundary='Finite regex heuristic, not proof of absence of secrets. No matched values printed. Redacted copies are not byte-original logs. Originals remain in /tmp with recorded hashes; retention not guaranteed.',patterns=patterns,files=provenance))
copy('/tmp/kc-round7-log-scan-before-archive.json',Path('log-scan-before-archive.json'))
for filename in ['kc-round7-regression-plan.json','kc-round7-regression-results.json','kc-round7-extra-regression-plan.json','kc-round7-extra-regression-results.json','kc-round7-syntax-results.json']:
 copy('/tmp/'+filename,Path('runs')/filename)
for filename in ['run.py','preload.cjs']:copy('/tmp/security-test-isolation-20261108/'+filename,Path('isolation')/filename)

plans=json.loads(Path('/tmp/kc-round7-regression-plan.json').read_text())
extra=json.loads(Path('/tmp/kc-round7-extra-regression-plan.json').read_text())
node_files=extra[0]['command'][2:]
selectors=plans[1]['command'][3:]
missing=[name for name in selectors if not (ROOT/'services/kc-pay-gpt'/name).exists()]
assert missing==['test/chatgpt-protocol-first.test.js']
service_files=['services/kc-pay-gpt/'+name for name in selectors if name not in missing]
chatgpt_files=['services/kc-pay-gpt/'+name for name in extra[1]['command'][3:]]
assert len(node_files)==9 and len(service_files)==15 and len(chatgpt_files)==2
assert len(set(node_files+service_files+chatgpt_files))==26

def node_totals(filename):
 text=Path('/tmp',filename).read_text()
 result={key:int(re.search(r'^[ℹ#] '+key+r' (\d+)\s*$',text,re.M).group(1)) for key in ['tests','pass','fail','skipped']}
 return result
native=node_totals('kc-round7-native-regression-fixture-fixed.log');assert native=={'tests':477,'pass':477,'fail':0,'skipped':0}
assert 'Tests  506 passed (506)' in Path('/tmp/kc-round7-kc-regression.log').read_text()
assert 'Tests  18 passed (18)' in Path('/tmp/kc-round7-chatgpt-regression.log').read_text()
records=[dict(id='native-regression-fixture-fixed',pass_count=477,fail_count=0,exit_code=0,files=node_files,log='logs/kc-round7-native-regression-fixture-fixed.log'),dict(id='kc-regression',pass_count=506,fail_count=0,exit_code=0,files=service_files,log='logs/kc-round7-kc-regression.log'),dict(id='chatgpt-regression',pass_count=18,fail_count=0,exit_code=0,files=chatgpt_files,log='logs/kc-round7-chatgpt-regression.log')]
for path in ['/tmp/kc-round7-regression-results.json','/tmp/kc-round7-extra-regression-results.json']:
 for item in json.loads(Path(path).read_text()):assert item['status']=='fulfilled' and item['value']['exitCode']==(1 if item['value']['id']=='native-regression' else 0)
history=[dict(log=name,pass_count=p,fail_count=f,exit_code=e,reason=reason) for name,p,f,e,reason in [
 ('kc-round7-initial-vitest.log',149,27,1,'Existing service test expectations before adaptation to persistent-hold API; historical failure preserved.'),
 ('kc-round7-vitest-adapted.log',174,2,1,'Intermediate service test adaptation; historical failure preserved.'),
 ('kc-round7-vitest-helper-fix.log',176,0,0,'Adapted six-file intermediate regression; overlaps final tests.'),
 ('kc-round7-fault-vitest-first.log',192,2,1,'New full-module protocol test fixture used incorrect require base; corrected createRequire URL.'),
 ('kc-round7-fault-vitest-path-fix.log',194,0,0,'Corrected protocol test require base; overlaps final tests.'),
 ('kc-round7-model-first.log',163,0,0,'Initial round7 offline store model; overlaps final tests.'),
 ('kc-round7-native-regression.log',462,15,1,'Round6 offline SQL parser did not enforce new status IN predicates; added IN parsing without deleting assertions.')]]
put(Path('verification-results.json'),dict(status='PASS',scope='Final targeted offline tests only. Not a KC full-suite result, live MySQL, payment or production verification.',final_runs=records,final_unique_actual_test_files=26,final_pass_count=1001,final_fail_count=0,missing_selector=dict(requested='test/chatgpt-protocol-first.test.js',actual_execution='NOT RUN: file does not exist; Vitest silently ignored selector. Two existing ChatGPT files subsequently executed separately.'),intermediate_runs=history,early_command_provenance='Exact early shell invocations were not completely retained; counts and exit codes from preserved logs and prior session record. Do not reconstruct a claimed shell transcript.',prior_round6='710 targeted PASS historical record unchanged',prior_kc_full_suite=dict(files=71,pass_count=1672,fail_count=40,exit_code=1,this_round='NOT RUN'),not_run=['Real MySQL concurrency/deadlock/disconnect/ambiguous COMMIT/crash recovery','Real payments and provider idempotency','KC production artifact and worker','Main site, TG, NewAPI, WAF and production permissions'],isolation='Clean synthetic test environment and Node fs/net/tls/dgram guards. Not an OS/native addon/Chromium/independent-child-process sandbox. ChatGPT logs include Sentinel network failure; no broad external-network absence claim.'))

sources=set(changed+node_files+service_files+chatgpt_files+['services/kc-pay-gpt/stripe-payment.js','services/kc-pay-gpt/grok-native-payment.js','services/kc-pay-gpt/package.json','services/kc-pay-gpt/package-lock.json','services/kc-pay-gpt/Dockerfile','services/kc-pay-gpt/.dockerignore'])
put(Path('source-manifest.json'),dict(head_reference=manifest['head'],source='Current dirty working tree, not a committed release candidate. Hashes captured after final tests; only documentation/evidence archiving followed.',round_changed_files=changed,earliest_snapshot_comparison='Ten existing files use earliest verified dirty snapshots; round7 root test is new. Round5 and round6 tests were already untracked before this round.',files=[dict(path=name,bytes=(ROOT/name).stat().st_size,sha256=h(ROOT/name),changed_this_round=name in changed,tested_this_round=name in node_files+service_files+chatgpt_files) for name in sorted(sources)]))
pack=['services/kc-pay-gpt/Dockerfile','services/kc-pay-gpt/.dockerignore']
put(Path('packaging-boundary.json'),dict(status='STATIC REVIEW ONLY',runtime_files=changed[:3],docker_copy='services/kc-pay-gpt/Dockerfile uses COPY . .; .dockerignore does not exclude the three changed runtime files.',files=[dict(path=name,sha256=h(ROOT/name)) for name in pack],image_build='NOT RUN',production_artifact='NOT RUN',boundary='KC is independently deployed to /opt/kc-pay-gpt. Vercel or Verify success would not demonstrate KC inclusion. No protected host env, compose or data touched. No schema migration or SQL. Protocol callback is optional; current production caller passes the gate, not a guarantee for future callers.'))
ws=command(['git','diff','--check','--',*changed]);assert ws['exit']==0
put(Path('whitespace-results.json'),dict(tracked_worktree_check=ws,boundary='git diff --check excludes untracked files. Delta roundtrip separately verifies all eleven paths including untracked tests; no empty-tree git apply result is treated as evidence.'))
put(Path('historical-round6-integrity.json'),dict(count=len(historical),unchanged=True,files=historical,boundary='Round6 report/archive unchanged; its historical outside-scope REVIEW remains unchanged.'))
(OUT/'README.md').write_text('''# 第七轮证据索引

本地 KC 支付保护与重复付款防护；报告见 ../../security-card-store-hardening-round7-2026-11-08.md。

- verification-results.json：最终 26 个实际测试文件，1001 PASS / 0 FAIL；中间失败与缺失 selector 单列，禁止重复相加。
- runs/：已保留的命令计划、结果与 11 文件语法检查。
- logs/ 与 log-provenance.json：无匹配日志按原字节复制；有敏感形态匹配的日志是脱敏副本，原始哈希和替换数量单列。有限扫描不能证明没有秘密。
- backup-manifests/、backup-verification.json、delta/、delta-recovery-verification.json：10 个既有 dirty 文件的修改前快照读回验证，另 1 个新增测试；补丁仅含本轮增量，已在临时副本逆向恢复、正向重放。快照原件在 /tmp，不是完整工作区或数据库备份。
- source-manifest.json：本轮与验收涉及源码哈希；dirty 来源，不是发布候选。
- isolation/：环境清理和 Node 层保护程序；不是操作系统完整隔离。
- packaging-boundary.json：KC Docker 输入的静态检查；未构建、未上线。
- historical-round6-integrity.json、final-integrity.json：43 个第六轮历史文件及当前范围完整性核验。
- evidence-manifest.json：报告及除自身外证据文件哈希，避免自引用；不等于签名或不可篡改存档。

未提交、未推送、未创建 PR、未部署、未执行 SQL、未连接真实数据库、未实际付款或启动生产 worker。本轮不能验收主站、TG、NewAPI、WAF 或生产恢复。
''')
print(json.dumps(dict(archive=str(OUT),changed_files=len(changed),verified_original_snapshots=len(originals),verified_historical_files=len(historical),final_test_files=26,final_passes=1001,logs_archived=len(provenance),redacted_copies=sum(x['kind']=='redacted-copy' for x in provenance),delta_reverse_exit=reverse['exit'],delta_forward_exit=forward['exit']),ensure_ascii=False))
