from pathlib import Path
import collections, datetime, difflib, hashlib, json, re, shutil, subprocess, tempfile

ROOT = Path('/Volumes/chao/AI/xianyu_profit_calculator')
EVIDENCE = ROOT / 'docs/security-audit-evidence/2026-11-08-card-store-round5'
REPORT = ROOT / 'docs/security-card-store-hardening-round5-2026-11-08.md'
BACKUP = Path('/tmp/kc-round5-owner-locks-20261108-before')
REVIEW_BACKUP = Path('/tmp/kc-round5-final-review-before')
ISOLATION = Path('/tmp/security-test-isolation-20261108')
RUNTIME = 'services/kc-pay-gpt/mysql-store.js'
FIXTURE = 'services/kc-pay-gpt/test/gpt-outsourcing-store.test.js'
NEW_TEST = 'tests/security-round5-kc-owner-locks.test.js'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def clean(text):
    return re.sub(r'\x1b\[[0-9;]*m', '', text)


assert not EVIDENCE.exists(), 'Refusing to replace existing round-5 evidence'
assert not REPORT.exists(), 'Refusing to replace existing round-5 report'
assert git('rev-list', '--count', 'HEAD..origin/main') == '0'
assert git('branch', '--show-current') == 'main'
assert git('rev-parse', 'HEAD') == '75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8'
assert git('remote', 'get-url', 'origin') == 'https://github.com/zaoyoe/Zaoyoe-Studio.git'
assert not git('diff', '--cached', '--name-only')
status_before = subprocess.check_output(['git', 'status', '--porcelain=v1', '--untracked-files=all'], cwd=ROOT)
initial_status = (BACKUP / 'status-before.txt').read_bytes()
assert not (set(initial_status.splitlines()) - set(status_before.splitlines()))
initial_index = Path(git('rev-parse', '--git-path', 'index'))
if not initial_index.is_absolute():
    initial_index = ROOT / initial_index
index_sha = sha(initial_index.read_bytes())

original_sources = {rel: (BACKUP / rel).read_bytes() for rel in (RUNTIME, FIXTURE)}
source_bytes = {rel: (ROOT / rel).read_bytes() for rel in (RUNTIME, FIXTURE, NEW_TEST)}
expected_source_hashes = {
    RUNTIME: 'edd981d433ecc3da800a6803c1a201ca822cebd0a5cceb2faa7fc261ccec28df',
    FIXTURE: '7ae006a5872cd8feeb20495203efe12b52816f081d4e7fdb4e600b013507e36a',
    NEW_TEST: '39190f24f952590ca39ca3b8ca05a2e33db312ded95c37d26acbdc9820436e04',
}
assert {rel: sha(data) for rel, data in source_bytes.items()} == expected_source_hashes

logs = {
    'owner-locks-initial-interrupted.tap': '/tmp/kc-round5-owner-locks-before.tap',
    'owner-locks-before-37.tap': '/tmp/kc-round5-owner-locks-before-complete.tap',
    'owner-locks-after-37.tap': '/tmp/kc-round5-owner-locks-after.tap',
    'native-regression-144.tap': '/tmp/kc-round5-native-regression.tap',
    'baseline-final-44.tap': '/tmp/kc-round5-baseline-final.tap',
    'native-final-151.tap': '/tmp/kc-round5-native-final.tap',
    'kc-regression-306.log': '/tmp/kc-round5-kc-regression.log',
    'kc-full.log': '/tmp/kc-round5-full.log',
    'ui-new-failures-rerun.log': '/tmp/kc-round5-ui-new-failures-rerun.log',
}
# Only counts are emitted if a likely credential shape is detected. Do not write
# the matched value to output, metadata or the evidence directory.
credential_shapes = {
    'userinfo_url': re.compile(rb'(?i)\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@'),
    'jwt': re.compile(rb'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'),
    'private_key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
}
scan_results = []
for destination, source in logs.items():
    data = Path(source).read_bytes()
    counts = {name: len(pattern.findall(data)) for name, pattern in credential_shapes.items()}
    assert not any(counts.values()), f'Credential-shape review required for {destination}: {counts}'
    scan_results.append({'path': 'raw/' + destination, 'pattern_counts': counts})

EVIDENCE.mkdir()
for name in ['raw', 'backup-manifests', 'delta']:
    (EVIDENCE / name).mkdir()
(EVIDENCE / 'baseline-status-expanded.txt').write_bytes(initial_status)
(EVIDENCE / 'status-before-archive-expanded.txt').write_bytes(status_before)
(EVIDENCE / '.gitignore').write_text('# Preserve original security regression logs for a future reviewed release.\n!raw/*.log\n')
for destination, source in logs.items():
    shutil.copyfile(source, EVIDENCE / 'raw' / destination)
for name, source in {
    'kc-full-command.json': Path('/tmp/kc-round5-full-command.json'),
    'ui-new-failures-command.json': Path('/tmp/kc-round5-ui-new-failures-command.json'),
    'syntax-results.json': Path('/tmp/kc-round5-syntax-results.json'),
    'run.py': ISOLATION / 'run.py',
    'preload.cjs': ISOLATION / 'preload.cjs',
}.items():
    shutil.copyfile(source, EVIDENCE / 'raw' / name)
for dest, source in {
    'initial.json': BACKUP / 'manifest.json',
    'baseline.json': BACKUP / 'baseline.json',
    'review-tests.json': REVIEW_BACKUP / 'manifest.json',
}.items():
    shutil.copyfile(source, EVIDENCE / 'backup-manifests' / dest)

backup_results = []
for backup_root in [BACKUP, REVIEW_BACKUP]:
    entries = json.loads((backup_root / 'manifest.json').read_text())
    for entry in entries:
        path = backup_root / entry['path']
        data = path.read_bytes()
        matched = sha(data) == entry['sha256'] and len(data) == entry['bytes']
        assert matched, f'Backup mismatch: {path}'
        backup_results.append({
            'path': str(path), 'expected_sha256': entry['sha256'],
            'observed_sha256': sha(data), 'expected_bytes': entry['bytes'],
            'observed_bytes': len(data), 'readback_matches_preexisting_manifest': matched,
        })
write_json(EVIDENCE / 'backup-verification.json', {
    'scope': 'Three per-file dirty snapshots, not a full-workspace or database backup.',
    'verified_entries': backup_results,
})

patches = []
whitespace_results = []
for rel in [RUNTIME, FIXTURE, NEW_TEST]:
    before = original_sources.get(rel, b'')
    after = source_bytes[rel]
    patch = ''.join(difflib.unified_diff(before.decode().splitlines(keepends=True),
        after.decode().splitlines(keepends=True), fromfile='a/' + rel if rel in original_sources else '/dev/null',
        tofile='b/' + rel))
    assert patch
    patch_name = 'round5-' + Path(rel).name + '.patch'
    (EVIDENCE / 'delta' / patch_name).write_text(patch)
    patches.append(patch)
    compare = str(BACKUP / rel) if rel in original_sources else '/dev/null'
    command = ['git', 'diff', '--no-index', '--check', '--', compare, rel]
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    assert result.returncode == 1 and not result.stdout and not result.stderr
    whitespace_results.append({'command': command, 'exit_code_observed': result.returncode,
        'stdout': result.stdout, 'stderr': result.stderr,
        'interpretation': 'No whitespace diagnostics. --no-index exits 1 because different content exists; not exit 0.'})
combined_patch = EVIDENCE / 'delta/round5-working-tree-delta.patch'
combined_patch.write_text(''.join(patches))
with tempfile.TemporaryDirectory(prefix='kc-round5-recovery-check-') as directory:
    recovery_root = Path(directory)
    for rel, data in source_bytes.items():
        destination = recovery_root / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    result = subprocess.run(['git', 'apply', '--no-index', '--reverse', str(combined_patch)],
        cwd=recovery_root, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    recovered = []
    for rel, original in original_sources.items():
        data = (recovery_root / rel).read_bytes()
        assert data == original
        recovered.append({'path': rel, 'sha256': sha(data), 'matches_initial_backup': True})
    assert not (recovery_root / NEW_TEST).exists()
write_json(EVIDENCE / 'delta-recovery-verification.json', {
    'method': 'Reverse the archived round-only patch against byte copies in a temporary directory; never apply it to the workspace.',
    'git_apply_reverse_exit_code': result.returncode, 'recovered_files': recovered,
    'new_test_removed_from_temporary_copy_only': True,
    'scope': 'Only the three round-5 code/test files; no full workspace or production recovery claim.',
})
write_json(EVIDENCE / 'whitespace-results.json', whitespace_results)
write_json(EVIDENCE / 'log-pattern-scan.json', {
    'scope': 'Limited shape scan of copied logs, not a proof that every secret format is absent.', 'results': scan_results})

current_full = clean(Path('/tmp/kc-round5-full.log').read_text())
failures = []
for line in current_full.splitlines():
    match = re.match(r'^ FAIL\s+(test/\S+\.test\.js) > (.*)$', line)
    if match:
        failures.append({'file': match[1], 'full_name': re.sub(r'\s+', ' ', match[2].replace(' > ', ' ')).strip()})
assert len(failures) == 40
assert 'Test Files  8 failed | 63 passed (71)' in current_full
assert 'Tests  40 failed | 1672 passed (1712)' in current_full
historical_path = ROOT / 'docs/security-audit-evidence/2026-11-08-card-store-round2/raw/security-round2-kc-full-results.json'
historical_bytes = historical_path.read_bytes()
historical = json.loads(historical_bytes)
old_failures = []
for suite in historical['testResults']:
    file = 'test/' + suite['name'].split('/test/')[-1]
    for assertion in suite['assertionResults']:
        if assertion['status'] == 'failed':
            old_failures.append({'file': file, 'full_name': re.sub(r'\s+', ' ', assertion['fullName']).strip()})
key = lambda entry: (entry['file'], entry['full_name'])
current_keys = {key(entry) for entry in failures}
previous_keys = {key(entry) for entry in old_failures}
repeat = current_keys & previous_keys
new = current_keys - previous_keys
no_longer_failed = previous_keys - current_keys
assert (len(repeat), len(new), len(no_longer_failed)) == (36, 4, 36)
classification = []
for file, full_name in sorted(new):
    item = {'file': file, 'full_name': full_name}
    if file.startswith('test/proxy-'):
        item.update({'classification': 'ISOLATION_BLOCKED', 'observed_error': 'TEST_NETWORK_CONNECT_BLOCKED',
                     'scope': 'MySQL connection' if 'region-matcher' in file else 'loopback HTTP request'})
    else:
        item.update({'classification': 'UI_ASSERTION_FAILED', 'focused_rerun': 'FAIL',
                     'causality': 'Newly observed against round-2 results; not attributed to the round-5 store patch.'})
    classification.append(item)
write_json(EVIDENCE / 'full-regression-comparison.json', {
    'method': 'Parse FAIL lines in preserved current Vitest human output; compare file + whitespace-normalized fullName with the archived round-2 JSON. Current output is not a JSON reporter result.',
    'historical_source': str(historical_path.relative_to(ROOT)), 'historical_source_sha256': sha(historical_bytes),
    'historical': {'files': 71, 'tests': 1693, 'passed': 1620, 'failed': 72, 'skipped': 1, 'exit_code_observed': 1},
    'current': {'files': 71, 'passed_files': 63, 'failed_files': 8, 'tests': 1712, 'passed': 1672, 'failed': 40, 'skipped': 0, 'duration_seconds': 562.76, 'exit_code_observed': 1},
    'failed_by_file': dict(collections.Counter(entry['file'] for entry in failures)),
    'repeated_failures': [dict(file=file, full_name=name) for file, name in sorted(repeat)],
    'newly_observed_failures': classification,
    'historical_failures_not_in_current_failure_set': [dict(file=file, full_name=name) for file, name in sorted(no_longer_failed)],
    'historical_record_policy': 'Original 72 FAIL/1 SKIP preserved. A later result neither rewrites the historical run nor establishes why each result changed.',
})

launcher = str(ISOLATION / 'run.py')
base_store = str(BACKUP / RUNTIME)
native_command = ['node', '--test', '--test-reporter=tap', NEW_TEST,
    'tests/security-round4-kc-local-settlement.test.js', 'tests/security-round3-kc-activation-atomic.test.js',
    'tests/security-round2-kc-activation.test.js']
kc_command = ['node', './node_modules/vitest/vitest.mjs', 'run',
    'test/gpt-outsourcing-store.test.js', 'test/gpt-outsourcing-worker.test.js',
    'test/gpt-outsourcing-recovery.test.js', 'test/gpt-outsourcing.test.js',
    'test/mysql-card-cooldown.test.js', 'test/recharge-routing.test.js', 'test/task-safety.test.js',
    'test/local-preview-recovery.test.js', 'test/task-diagnostics.test.js', '--no-file-parallelism', '--maxWorkers=1']
results = [
    {'name': 'initial-interrupted', 'log': 'raw/owner-locks-initial-interrupted.tap', 'status': 'INTERRUPTED', 'exit_code_observed': 1,
     'complete_counts': None, 'note': 'Initial harness awaited an event the baseline never reached; interrupted. No complete baseline claim.'},
    {'name': 'baseline-before-37', 'log': 'raw/owner-locks-before-37.tap', 'status': 'FAIL', 'tests': 37, 'passed': 7, 'failed': 30, 'exit_code_observed': 1,
     'baseline_store': base_store, 'test_snapshot': str(REVIEW_BACKUP / NEW_TEST)},
    {'name': 'after-37', 'log': 'raw/owner-locks-after-37.tap', 'status': 'PASS', 'tests': 37, 'passed': 37, 'failed': 0, 'exit_code_observed': 0,
     'test_snapshot': str(REVIEW_BACKUP / NEW_TEST)},
    {'name': 'native-intermediate', 'log': 'raw/native-regression-144.tap', 'status': 'PASS', 'tests': 144, 'passed': 144, 'failed': 0, 'exit_code_observed': 0},
    {'name': 'baseline-final-44', 'log': 'raw/baseline-final-44.tap', 'status': 'FAIL', 'tests': 44, 'passed': 7, 'failed': 37, 'skipped': 0, 'exit_code_observed': 1,
     'command': ['node', '--test', '--test-reporter=tap', NEW_TEST], 'baseline_store': base_store},
    {'name': 'native-final', 'log': 'raw/native-final-151.tap', 'status': 'PASS', 'tests': 151, 'passed': 151, 'failed': 0, 'skipped': 0, 'exit_code_observed': 0,
     'command': native_command},
    {'name': 'kc-focused-final', 'log': 'raw/kc-regression-306.log', 'status': 'PASS', 'files': 9, 'tests': 306, 'passed': 306, 'failed': 0, 'skipped': 0, 'exit_code_observed': 0,
     'cwd': str(ROOT / 'services/kc-pay-gpt'), 'command': kc_command},
    {'name': 'kc-full', 'log': 'raw/kc-full.log', 'status': 'FAIL', 'files': 71, 'tests': 1712, 'passed': 1672, 'failed': 40, 'skipped': 0, 'exit_code_observed': 1,
     'command_metadata': 'raw/kc-full-command.json'},
    {'name': 'ui-two-failures-rerun', 'log': 'raw/ui-new-failures-rerun.log', 'status': 'FAIL', 'files': 1, 'tests': 18, 'passed': 0, 'failed': 2, 'skipped': 16, 'exit_code_observed': 1,
     'command_metadata': 'raw/ui-new-failures-command.json', 'note': 'Only two assertions selected; does not supersede the full run.'},
]
for entry in results:
    log = clean((EVIDENCE / entry['log']).read_text())
    if entry['name'] in ['baseline-before-37', 'after-37', 'native-intermediate', 'baseline-final-44', 'native-final']:
        for field, label in [('tests', 'tests'), ('passed', 'pass'), ('failed', 'fail')]:
            assert re.search(rf'^# {label} {entry[field]}$', log, re.M)
write_json(EVIDENCE / 'verification-results.json', {
    'launcher': launcher, 'default_cwd': str(ROOT), 'results': results,
    'final_focused_total': {'passed': 457, 'failed': 0, 'components': ['native-final', 'kc-focused-final']},
    'counting_boundary': '457 is the sum of two final focused invocations. Baselines, intermediate runs, full regression and UI rerun are not added to it; full regression includes tests also run in the focused set.',
    'syntax': {'files': 3, 'exit_code_observed': [0, 0, 0], 'metadata': 'raw/syntax-results.json'},
    'provenance': 'Raw outputs copied byte-for-byte. Metadata/commands for earlier runs reconstructed from the session record; full and UI wrapper command JSON retained. No claim that tests were run against a clean, committed release candidate.',
})
write_json(EVIDENCE / 'raw-provenance.json', {
    'copies': [{'source': source, 'destination': 'raw/' + destination,
                'source_sha256': sha(Path(source).read_bytes()), 'archived_sha256': sha((EVIDENCE / 'raw' / destination).read_bytes()),
                'byte_for_byte': Path(source).read_bytes() == (EVIDENCE / 'raw' / destination).read_bytes()}
                for destination, source in logs.items()],
    'recorded_at_archive_time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope': 'Archive timestamp is not a test execution timestamp. Initial interrupted and failing outputs retained. Historical round-2/round-4 files not edited.',
})
write_json(EVIDENCE / 'source-manifest.json', {
    'binding': 'Hashes of uncommitted working-tree files at archive time; not hashes attested by a clean test-run candidate.',
    'files': [{'path': rel, 'bytes': len(data), 'sha256': sha(data)} for rel, data in source_bytes.items()],
    'supporting_runtime_and_packaging_files': [{'path': rel, 'sha256': sha((ROOT / rel).read_bytes())} for rel in [
        'services/kc-pay-gpt/server.js', 'services/kc-pay-gpt/payment-retry.js',
        'services/kc-pay-gpt/Dockerfile', 'services/kc-pay-gpt/.dockerignore',
        'services/kc-pay-gpt/docker-compose.yml', 'deploy/kvm4/verify-server.Dockerfile']],
})
write_json(EVIDENCE / 'packaging-boundary.json', {
    'kc': {'status': 'STATIC_REVIEW_ONLY', 'source': 'services/kc-pay-gpt', 'Dockerfile': 'services/kc-pay-gpt/Dockerfile',
           'copy': {'line': 43, 'instruction': 'COPY . .'}, 'startup': {'line': 58, 'instruction': 'CMD ["node", "server.js"]'},
           'dockerignore_excludes_changed_runtime_file': False,
           'host_compose_verified': False, 'docker_build': 'NOT RUN', 'production_image_verified': False},
    'verify': {'Dockerfile': 'deploy/kvm4/verify-server.Dockerfile', 'copies_kc_source': False,
               'implication': 'A Vercel/Verify deployment alone would not establish that KC changes reached production.'},
    'protected_production_paths': ['/opt/kc-pay-gpt/.env', '/opt/kc-pay-gpt/docker-compose.yml', '/opt/kc-pay-gpt/data/',
                                   '/opt/kc-pay-gpt/debug_screenshots/', '/opt/kc-pay-gpt/product_files/', 'mysql_data volume'],
    'deployment': 'NOT RUN',
})
write_json(EVIDENCE / 'baseline-and-boundaries.json', {
    'branch': git('branch', '--show-current'), 'head': git('rev-parse', 'HEAD'), 'origin_main': git('rev-parse', 'origin/main'),
    'behind': int(git('rev-list', '--count', 'HEAD..origin/main')), 'remote': git('remote', 'get-url', 'origin'),
    'latest_fetch': 'Successful git fetch origin main observed in this continuation before archive writes.',
    'initial_status_entries_expanded': len(initial_status.splitlines()), 'pre_archive_status_entries_expanded': len(status_before.splitlines()),
    'initial_status_rows_missing_before_archive': [],
    'additional_pre_archive_rows': sorted(row.decode() for row in set(status_before.splitlines()) - set(initial_status.splitlines())),
    'index_sha256_before_archive': index_sha, 'staged_diff_before_archive': git('diff', '--cached', '--name-only'),
    'release_candidate': False, 'backup_scope': 'Per-file dirty snapshots only, not a complete dirty checkout backup.',
    'isolation': {'launcher': 'raw/run.py', 'node_guard': 'raw/preload.cjs',
                  'environment': 'Only PATH/TMPDIR/LANG/TZ inherited; synthetic session test key. No real .env reads performed.',
                  'guard': 'Node filesystem .env reads and TCP/TLS/dgram connections blocked, including loopback.',
                  'limits': 'Not an OS sandbox; not proof of complete Chromium/native-addon/independent-subprocess isolation. Cross-round accumulated blocked-reads logs not copied as round-specific evidence.'},
    'not_run': ['SQL execution', 'real database connections and InnoDB verification', 'real payment', 'Docker build',
                'production configuration changes', 'SSH', 'production worker start', 'git stage/commit/push/PR/merge',
                'deployment', 'main-site/TG/WAF/newAPI production acceptance'],
})

REPORT.write_text('''# 第 5 轮安全加固：KC 银行卡归属释放与 CDK/task 锁顺序

日期：2026-11-08。覆盖 KC 本地代码与离线验证；主站、TG 和线上防火墙本轮没有新增验收。全部改动未提交，未推送、未创建 PR、未部署，线上尚未生效。未执行 SQL、未连接真实数据库、未做真实支付，也未启用游客购买或启动生产 worker。

## 1. 本轮结论

按任务批量释放银行卡原来使用 `locked_by = ? OR locked_by LIKE %key%`，可能把相近任务、前后缀或其他命名空间的锁一起释放。本轮改为只释放合法原始 jobKey 对应的 `payment_<jobKey>`，使用二进制精确比较，同时保留 `in_use = 1 AND status = '正常'` 条件。非法输入不执行 SQL；不靠 trim、截断或清洗去猜旧锁，历史裸 key、provider/debug 锁及人工复核资产保留待核验。

本地准入/结算已采用 CDK→task；此前 retirement/provider 路径先锁 task 再锁 CDK，存在相反的锁定顺序。本轮增加 `lockActivationTaskCdkFirst` 并接入 retirement、provider save/reserve/finalize。先用不加锁的 task 查询定位 CDK，锁 CDK 后再锁定并重读 task；job_key、id 或 cdk_code 绑定变化就抛出 `ACTIVATION_TASK_BINDING_CHANGED` 并回滚，不能继续锁第二张 CDK。

以上收紧的是具体释放入口及四条事务路径，不是全部资产释放已经闭环；未证明真实数据库中不存在其他死锁或并发风险。

## 2. 代码范围和行为

- `services/kc-pay-gpt/mysql-store.js`：增加 CDK-first helper；retirement 按最新 task 证据决定是否释放；provider reserve 校验 CDK 存在、active、used_at 和最新 task 归属；save/reserve/finalize 同步锁顺序。
- `services/kc-pay-gpt/mysql-store.js`：`releaseCardsByOwner` 仅接受 1–48 个 ASCII 字母、数字、下划线、连字符组成的字符串 jobKey，精确匹配 `payment_<jobKey>`。大小写、尾空格、相近 key、provider/历史命名空间均不能扩大释放范围。
- `services/kc-pay-gpt/test/gpt-outsourcing-store.test.js`：有效 CDK fixture 增加 `is_active: 1`，使原有成功路径符合新的准入前提。
- `tests/security-round5-kc-owner-locks.test.js`：新增 44 项，用真实 store 模块及 VM 注入的离线 mysql2 状态模型，覆盖精确释放、四路径锁顺序、等待 CDK 时未提前持有 task 锁、task 绑定变化/删除、fresh payment/provider/recovery 证据、缺失/停用 CDK、legacy hold、回滚和连接释放。

三个 server 清理调用静态复查均传入 `task.jobKey`。payment-retry 的标准付款 owner 是 `payment_<jobKey>`；其历史/调试 fallback 命名不被本轮批量释放猜测兼容。保留 legacy hold 入口；缺失 CDK 不能授权正常结算或释放资产。未增加自动死锁重试或 COMMIT 结果不明时的自动重试。

## 3. 验证结果

| 验证 | 结果 | 完成退出码 |
|---|---|---|
| 最终 44 项对修改前 dirty store | 7 PASS / 37 FAIL | 1 |
| 最终原生定向回归（第 2–5 轮） | 151 PASS / 0 FAIL | 0 |
| KC 九文件定向回归 | 306 PASS / 0 FAIL | 0 |
| 本轮最终定向合计 | **457 PASS / 0 FAIL** | 两次均 0 |
| KC 全量 71 文件 | **1672 PASS / 40 FAIL / 0 SKIP**；63 文件通过、8 文件失败，共 1712 项 | **1** |
| 新观察到的两项 UI 动画失败复跑 | 2 FAIL / 16 SKIP；只选择两项断言，无通过项 | 1 |
| 三个修改/新增 JS 的语法检查 | 三个均通过 | 三个均 0 |
| 逐文件备份增量的空白检查 | 无空白诊断；`--no-index --check` 有差异退出 1，不能记为 0 | 三个均 1 |

457 只合计两个最终定向调用，不叠加 baseline、中间结果、全量或 UI 复跑；KC 全量包含部分已经定向执行的测试。定向通过不能替代全量通过。

初次 baseline harness 等待旧实现不会触发的事件而被中断，退出 1，没有完整计数；原日志保留。随后 37 项 baseline 为 7 PASS / 30 FAIL，修复后 37 PASS，原生中间回归为 144 PASS；最后补齐 7 项才得到最终 44 项 baseline 和 151 项定向结果。各阶段日志分开归档，不能混作同一次运行。

### 3.1 全量失败与历史记录分别保留

与第 2 轮历史 1693 项（1620 PASS / 72 FAIL / 1 SKIP，退出 1）按文件和规范化 fullName 对照：本次 40 个失败中有 36 个重复失败，4 个为本次新观察到。历史原记录不修改，测试数量和运行条件存在差别，不能据此把全部变化归因于本轮修改。

| 本次失败文件 | 失败数 |
|---|---:|
| checkout-debug-server | 26 |
| gpt-outsourcing-admin | 2 |
| grok-commerce | 2 |
| pricing-flow | 1 |
| proxy-region-matcher | 1 |
| proxy-session-and-region | 1 |
| recharge-card-fixed-scroll | 1 |
| recharge-ui | 6 |

4 个新观察到的失败：

- proxy-region-matcher 选择数据库代理池：`TEST_NETWORK_CONNECT_BLOCKED`，Node guard 阻止 MySQL 连接。
- proxy-session-and-region 的 CONNECT relay 重试：同一 guard 阻止 loopback HTTP 请求。两项均作为隔离受限保留失败，不放松 guard 或连接真实数据库来消红；未验证对应功能在真实目标可正常工作。
- recharge-ui 的 native-height mobile card：单帧移动约 153.7px，断言要求小于 50px。
- recharge-ui 的 intermediate viewport heights：反向移动帧数为 2，断言要求 0。两项单独复跑仍失败，复跑未改源码或断言；该静态页面测试不导入 mysql-store，但当前证据不足以确定根因或把失败归因于本轮 patch。

历史另 36 个失败所在的 billing-form、claude-navigation、claude-payment-flow、grok-native-flow、local-preview-recovery、recharge-routing 六个文件本次通过。此为后续运行的结果，不追认历史为 PASS。机器对照列表保存在 `full-regression-comparison.json`。

## 4. 离线模型和生产证据边界

本轮测试执行真实 store 代码，用可控状态模型模拟 mysql2、事务写入、暂停 CDK 锁获取及 task 证据变化。这验证程序调用顺序和受控交错下的决策；不能替代真实 InnoDB 行锁/间隙锁、隔离级别、死锁、断连、COMMIT 不明或崩溃恢复验证。

launcher 仅继承 PATH/TMPDIR/LANG/TZ，使用合成 Session key；Node preload 阻止真实 `.env*` 文件读取和 TCP/TLS/dgram 连接，包括 loopback。它是 Node API guard，不是操作系统沙箱，也不是完整 Chromium/native addon/独立子进程网络隔离证明。跨轮累计 blocked-reads 日志未复制为本轮独立证据。

日志原样复制。命令、退出码及计数部分依据会话记录整理，保留 full/UI wrapper 元数据。`source-manifest.json` 是归档时 dirty 工作区的源码哈希；没有追认“测试绑定了干净候选提交”。本轮仅保留逐文件修改前备份和可逆 delta，不是完整工作区/数据库备份，不能用于声称满足发布备份门槛。

## 5. 独立 KC 产物边界

KC Dockerfile 第 43 行 `COPY . .`、第 58 行启动 `node server.js`；`.dockerignore` 不排除本轮 mysql-store runtime 文件。以上只是静态包含关系；生产 host compose、Docker build 和实际镜像本轮均未核验。

Verify Dockerfile 不复制 KC 源码，所以未来 Vercel / Verify 发布成功不能证明 KC 修复上线。KC 必须独立核验对应源码/产物和健康状态，并保留 `/opt/kc-pay-gpt/.env`、host compose、data、debug_screenshots、product_files 及 mysql_data。主站、TG、NewAPI、WAF 和生产权限本轮均为 NOT RUN。

## 6. 后续风险与优先级

| 优先级 | 待处理项 | 当前证据边界 |
|---|---|---|
| P1 | `releaseCard(cardId)` 仍按 ID 释放，无 owner 条件 | payment-retry 有三处调用；两处传入的第二参数当前函数不接收。需追踪迟到 finally/旧任务释放新锁等路径，本轮未修复 |
| P1 | `releaseRuntimeAssets` / `releaseAssetById` 的同类释放归属 | 仍需逐入口审计，不能用精确批量释放的通过结果覆盖 |
| P1 | 真实隔离 MySQL 并发、死锁、断连、COMMIT 不明和恢复 | NOT RUN；执行 SQL 需用户另有明确授权 |
| P1 | KC 全量回归欠账 | 当前 40 FAIL 保留；2 项隔离阻止、2 项新增 UI 失败与 36 项重复失败分别记录 |
| P2 | 测试中的外部代理凭证形态 URL | 静态发现待核验/脱敏；未测试有效性，未确认泄露，不在报告复制值 |
| P2 | 多实例共享限流、CVV/产品凭证全面加密、消息字段统一脱敏、持久 pending 恢复 | 本轮没有完成，不据局部修复声称闭环 |
| REVIEW | 主站/TG/WAF 与生产运行版本、权限 | 本轮无新增验收证据 |

P1/P2 表示继续处理的优先级，不代表已经证明生产可利用或发生损失。下一轮先追踪按 ID 释放的所有调用及失败恢复，再设计带归属/租约的受约束释放和离线交错验证；不要直接用宽泛自动重试掩盖资金结果不明。

## 7. 证据与 Git 状态

证据目录：`docs/security-audit-evidence/2026-11-08-card-store-round5/`，保存逐文件备份清单与读回核验、本轮精确 delta 及临时副本逆向恢复核验、原始失败/中断/通过日志、命令、计数、源码哈希、隔离工具、全量失败对照及包装边界。

基线分支为 main，HEAD 与 origin/main 同为 `75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`，fetch 成功且 behind 为 0。本轮前 510 条展开 dirty 状态在归档前全部保留，新增两条为 fixture 修改和第 5 轮新测试；归档自身会增加文档路径。未暂存、未提交、未推送、未创建 PR，未执行 reset/restore/clean/rebase/分支切换。最终状态见 `final-integrity.json`。

| 系统 / 链路 | 本轮状态 |
|---|---|
| KC 最终本地定向验证 | PASS，限 457 项 |
| KC 全量 | FAIL，1672 PASS / 40 FAIL |
| KC 生产独立产物 | NOT RUN；修复未上线 |
| Vercel production | NOT RUN |
| KVM4 Verify Server / TG worker | NOT RUN |
| KVM4 Sub2API / NewAPI | NOT RUN |
| WAF / 生产数据库 / 权限核验 | NOT RUN |
| SQL / 真实交易 / 游客购买启用 | NOT RUN |
''')
(EVIDENCE / 'README.md').write_text('''# 第 5 轮 KC 归属释放与锁顺序证据

报告：`docs/security-card-store-hardening-round5-2026-11-08.md`。

- `baseline-and-boundaries.json` 和两个 expanded status 清单：Git 基线、dirty 状态、隔离与 NOT RUN 边界。
- `backup-manifests/`、`backup-verification.json`：三份逐文件 dirty 快照哈希及读回结果。原快照留在 JSON 指向的 /tmp 路径；不是完整工作区/数据库备份。
- `delta/` 和 `delta-recovery-verification.json`：对本轮修改前文件的精确增量；在临时字节副本逆向恢复并核对修改前哈希。不是 HEAD 到当前完整发布清单。
- `raw/`、`raw-provenance.json`、`verification-results.json`：原始中断、失败、中间通过、最终通过、命令和退出码。最终定向 151 + 306 = 457 PASS；全量为 1672 PASS / 40 FAIL，退出 1；UI 两项复跑仍 FAIL。
- `full-regression-comparison.json`：与第 2 轮历史失败按文件/fullName 对照，36 重复、4 新观察；不改历史结果。
- `source-manifest.json`：归档时未提交源码哈希，不追认干净候选提交。
- `whitespace-results.json`：无空白诊断，no-index 有差异退出 1，不能报成退出 0。
- `packaging-boundary.json`：仅静态 KC Docker 包含关系，线上镜像/host compose 未核验。
- `log-pattern-scan.json`：有限的凭证形态扫描，不是完整无秘密证明。
- `final-integrity.json`：归档后复核原状态行保留、源码/历史证据哈希、Git HEAD/index/staging 和备份。
- `evidence-manifest.json`：除自身外的归档文件与报告哈希；不自称不可篡改的签名证据。

未执行提交、推送、PR、部署、SQL、真实数据库连接、真实支付或生产配置变更；线上未生效。未闭环风险见报告第 6 节。
''')
shutil.copyfile(Path(__file__), EVIDENCE / 'archive-procedure.py')
print(json.dumps({'evidence': str(EVIDENCE), 'report': str(REPORT),
                  'focused_passed': 457, 'kc_full': {'passed': 1672, 'failed': 40},
                  'backup_entries_verified': len(backup_results), 'round_delta_reverse_recovery': 'PASS',
                  'raw_log_copies': len(logs), 'status_rows_preserved_before_archive': len(initial_status.splitlines())}, ensure_ascii=False))
