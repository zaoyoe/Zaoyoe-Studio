from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import hashlib, json, re, subprocess

ROOT = Path('/Volumes/chao/AI/xianyu_profit_calculator')
ARC = ROOT / 'docs/security-audit-evidence/2026-11-08-card-store-round7'
REPORT = ROOT / 'docs/security-card-store-hardening-round7-2026-11-08.md'
FINAL = ARC / 'final-integrity.json'
MANIFEST = ARC / 'evidence-manifest.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text())


def git(*args):
    p = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, check=True)
    return p.stdout.decode()


def write_new(path, data):
    assert not path.exists(), f'Already exists: {path}'
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


assert not FINAL.exists() and not MANIFEST.exists()
source = load(ARC / 'source-manifest.json')
history = load(ARC / 'historical-round6-integrity.json')
boundary = load(ARC / 'baseline-and-boundaries.json')
verification = load(ARC / 'verification-results.json')
provenance = load(ARC / 'log-provenance.json')
backup = load(ARC / 'backup-verification.json')
recovery = load(ARC / 'delta-recovery-verification.json')

source_checks = [dict(path=e['path'], expected_sha256=e['sha256'],
                      observed_sha256=sha(ROOT / e['path'])) for e in source['files']]
history_checks = [dict(path=e['path'], expected_sha256=e['expected_sha256'],
                       observed_sha256=sha(ROOT / e['path'])) for e in history['files']]
assert len(source_checks) == 35 and len(history_checks) == 43
assert all(e['expected_sha256'] == e['observed_sha256'] for e in source_checks + history_checks)

backup_checks = []
for group in ['originals', 'intermediate_resume_snapshots']:
    for e in backup[group]:
        observed = sha(Path(e['snapshot_absolute_path']))
        assert observed == e['sha256']
        backup_checks.append(dict(path=e['path'], group=group,
                                  snapshot_absolute_path=e['snapshot_absolute_path'],
                                  sha256=observed, matches=True))
assert len(backup_checks) == 12
ignore_backup = load(ARC / 'finalization-backup-verification.json')
assert sha(Path(ignore_backup['backup_absolute_path'])) == ignore_backup['before_sha256']
assert sha(ROOT / ignore_backup['path']) == ignore_backup['after_sha256']
assert recovery['reverse_command']['exit'] == recovery['forward_command']['exit'] == 0
assert all(e['matches'] for e in recovery['restored_snapshots'] + recovery['replayed_files'])

log_checks = []
for e in provenance['files']:
    p = ARC / e['archive_relative_path']
    assert sha(p) == e['archive_sha256']
    log_checks.append(dict(path=e['archive_relative_path'], sha256=sha(p), kind=e['kind']))
assert len(log_checks) == 10

results = []
for f in ['kc-round7-regression-results.json', 'kc-round7-extra-regression-results.json']:
    results.extend(load(ARC / 'runs' / f))
result_map = {e['value']['id']: e['value'] for e in results if e['status'] == 'fulfilled'}
counts = []
all_files = []
for run in verification['final_runs']:
    assert run['exit_code'] == result_map[run['id']]['exitCode'] == 0
    text = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', (ARC / run['log']).read_text())
    if run['id'] == 'native-regression-fixture-fixed':
        observed_pass = int(re.findall(r'(?m)^[#ℹ]\s+pass\s+(\d+)\s*$', text)[-1])
        observed_fail = int(re.findall(r'(?m)^[#ℹ]\s+fail\s+(\d+)\s*$', text)[-1])
        observed_tests = int(re.findall(r'(?m)^[#ℹ]\s+tests\s+(\d+)\s*$', text)[-1])
        assert observed_tests == observed_pass + observed_fail
    else:
        observed_pass = int(re.findall(r'(?m)^\s*Tests\s+(\d+) passed\s+\(\d+\)', text)[-1])
        assert not re.search(r'(?m)^\s*Tests\s+[^\n]*\d+ failed', text)
        observed_fail = 0
        observed_files = int(re.findall(r'(?m)^\s*Test Files\s+(\d+) passed\s+\(\d+\)', text)[-1])
        assert observed_files == len(run['files'])
    assert observed_pass == run['pass_count'] and observed_fail == run['fail_count']
    all_files.extend(run['files'])
    counts.append(dict(id=run['id'], pass_count=observed_pass, fail_count=observed_fail,
                       files=len(run['files']), log=run['log'], exit_code=0))
assert len(all_files) == len(set(all_files)) == verification['final_unique_actual_test_files'] == 26
assert sum(r['pass_count'] for r in counts) == verification['final_pass_count'] == 1001
assert sum(r['fail_count'] for r in counts) == verification['final_fail_count'] == 0
syntax = load(ARC / 'runs/kc-round7-syntax-results.json')
assert len(syntax) == 11 and all(e['status'] == 'fulfilled' and e['value']['exitCode'] == 0 for e in syntax)

patch = (ARC / 'delta/round7-working-tree-delta.patch').read_text()
added = 0
issues = []
current = ''
line_number = 0
for line in patch.splitlines():
    if line.startswith('+++ '):
        current = line[4:].removeprefix('b/')
        continue
    match = re.match(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@', line)
    if match:
        line_number = int(match.group(1))
        continue
    if line.startswith('+'):
        added += 1
        content = line[1:]
        if content.endswith((' ', '\t')):
            issues.append(dict(path=current, line=line_number, issue='trailing whitespace'))
        if content.startswith(' ') and re.match(r'^ *\t', content):
            issues.append(dict(path=current, line=line_number, issue='space before indentation tab'))
        line_number += 1
    elif line.startswith(' '):
        line_number += 1
assert added == 632 and not issues

head = git('rev-parse', 'HEAD').strip()
origin_main = git('rev-parse', 'origin/main').strip()
branch = git('branch', '--show-current').strip()
behind = int(git('rev-list', '--count', 'HEAD..origin/main').strip())
remote_names = git('remote').splitlines()
remote_url = git('remote', 'get-url', 'origin').strip()
push_url = git('remote', 'get-url', '--push', 'origin').strip()
index_path = Path(git('rev-parse', '--git-path', 'index').strip())
if not index_path.is_absolute():
    index_path = ROOT / index_path
index_sha = sha(index_path)
assert head == origin_main == boundary['head'] and branch == 'main' and behind == 0
assert remote_names == ['origin'] and remote_url == push_url == 'https://github.com/zaoyoe/Zaoyoe-Studio.git'
assert index_sha == boundary['expected_index_sha256']
assert not git('diff', '--cached', '--name-only').strip()
outside = boundary['outside_scope']
outside_observed = sha(ROOT / outside['path'])
assert outside_observed == outside['sha256']
assert outside_observed != outside['handoff_expected_sha256']

# Only these new files are written. Existing report, source, historical evidence and index stay untouched.
write_new(FINAL, {})
write_new(MANIFEST, {})
status = git('status', '--porcelain=v1', '--untracked-files=all').splitlines()
baseline = (ARC / 'baseline-status-expanded.txt').read_text().splitlines()
missing = sorted(set(baseline) - set(status))
assert len(baseline) == 603 and not missing
visible = set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0'))
archive_paths = sorted([REPORT] + [p for p in ARC.rglob('*') if p.is_file()])
hidden = [p.relative_to(ROOT).as_posix() for p in archive_paths if p.relative_to(ROOT).as_posix() not in visible]
assert not hidden
for name in ['README.md', 'verification-results.json', 'source-manifest.json',
             'whitespace-results.json', 'backup-verification.json', 'delta-recovery-verification.json',
             'packaging-boundary.json', 'historical-round6-integrity.json', 'final-integrity.json',
             'evidence-manifest.json', 'log-provenance.json', 'finalization-backup-verification.json']:
    assert (ARC / name).is_file()

final = {
    'checked_at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
    'status': 'REVIEW',
    'scope': 'Round7 local finalization. Scoped checks pass; entire workspace byte consistency remains REVIEW, not a deployable release candidate.',
    'source_integrity': {'status': 'PASS', 'count': len(source_checks), 'files': source_checks},
    'historical_round6_integrity': {'status': 'PASS', 'count': len(history_checks), 'files': history_checks},
    'dirty_baseline_retention': {'status': 'PASS', 'baseline_rows': len(baseline),
                               'observed_rows': len(status), 'missing_rows': missing,
                               'boundary': 'Git porcelain-row retention only; not a complete historical byte baseline or full workspace backup.'},
    'git': {'status': 'PASS', 'head': head, 'origin_main': origin_main, 'branch': branch,
            'origin_fetch_url': remote_url, 'origin_push_url': push_url, 'remote_names': remote_names,
            'behind_origin_main': behind, 'index_sha256': index_sha, 'index_matches_baseline': True,
            'staged_changes_empty': True, 'dirty': True,
            'freshness': 'git fetch origin main succeeded before finalization; no destructive Git operation.'},
    'outside_scope': {'status': 'REVIEW', 'path': outside['path'], 'observed_sha256': outside_observed,
                      'archive_observation_sha256': outside['sha256'],
                      'matches_archive_observation': True,
                      'handoff_expected_sha256': outside['handoff_expected_sha256'],
                      'matches_handoff': False, 'source_attribution': 'Not determined.',
                      'boundary': 'Not edited, reverted or included in the round7 delta. Prior historical REVIEW remains unchanged.'},
    'test_result_consistency': {'status': 'PASS', 'final_runs': counts, 'actual_unique_files': 26,
                                'pass_count': 1001, 'fail_count': 0, 'syntax_files': 11,
                                'method': 'Reconciled archived summary lines, recorded execution exit codes and current source hashes. No runtime tests rerun during finalization.',
                                'historical_kc_full_suite': verification['prior_kc_full_suite']},
    'added_line_whitespace': {'status': 'PASS', 'added_lines_checked': added, 'issues': issues,
                              'scope': 'Added lines in the exact 11-file round7 delta, including untracked test files. No assertion about preexisting whitespace.'},
    'backup_readback': {'status': 'PASS', 'snapshots': backup_checks,
                        'finalization_ignore_backup': ignore_backup,
                        'boundary': 'Per-file temporary backups only; retention not guaranteed. Not a stash, backup commit, full workspace or database backup.'},
    'roundtrip_evidence': {'status': 'PASS', 'record': 'delta-recovery-verification.json',
                           'restored_snapshots': len(recovery['restored_snapshots']),
                           'replayed_files': len(recovery['replayed_files']),
                           'method': 'Reconciled existing zero-fuzz reverse/forward temporary-copy results; not rerun.'},
    'archive_log_integrity': {'status': 'PASS', 'files': log_checks,
                              'boundary': 'Explicitly redacted copies remain labeled; finite heuristic scanning is not proof of absence of secrets.'},
    'archive_visibility': {'status': 'PASS', 'report_and_archive_files_checked': len(archive_paths),
                           'hidden_files': hidden, 'archived_logs_visible': 10,
                           'correction': 'Added !logs/ to the round7 .gitignore after verified byte backup. Earlier archive-procedure.py preserved as historical execution.'},
    'not_run': ['git staging/commit/push/PR/merge', 'deployment or production configuration/worker changes',
                'SQL or live database connections', 'real payments', 'KC full-suite rerun',
                'live MySQL concurrency/deadlock/connection-loss/commit-ambiguity/crash-recovery acceptance',
                'new main-site/TG/NewAPI/WAF production acceptance'],
    'manifest_boundary': 'evidence-manifest.json hashes the report and all archive files except itself; hashes are not signatures or tamper-proof archival.'
}
FINAL.write_text(json.dumps(final, ensure_ascii=False, indent=2) + '\n')
entries = [dict(path=p.relative_to(ROOT).as_posix(), bytes=p.stat().st_size, sha256=sha(p))
           for p in archive_paths if p != MANIFEST]
manifest = {
    'generated_at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
    'status': 'HASHED', 'root': str(ROOT), 'file_count': len(entries),
    'excluded': [MANIFEST.relative_to(ROOT).as_posix()],
    'scope': 'Round7 report plus archive files excluding this manifest itself. Not a commit, signature, full workspace or production evidence.',
    'files': entries
}
MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
assert all(sha(ROOT / e['path']) == e['sha256'] and (ROOT / e['path']).stat().st_size == e['bytes'] for e in entries)
assert sha(index_path) == index_sha and not git('diff', '--cached', '--name-only').strip()
print(json.dumps({'result': 'SCOPED_CHECKS_PASS_WORKSPACE_REVIEW', 'source_files': len(source_checks),
                  'historical_files_unchanged': len(history_checks), 'baseline_rows_retained': len(baseline),
                  'final_test_count': 1001, 'actual_test_files': 26, 'added_lines_whitespace_checked': added,
                  'manifest_entries_verified': len(entries), 'archive_files_hidden': len(hidden),
                  'index_unchanged': True, 'staged_changes': 0,
                  'final_integrity': str(FINAL), 'evidence_manifest': str(MANIFEST)}, ensure_ascii=False))
