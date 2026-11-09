'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const sha = '75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8';
const otherSha = 'a'.repeat(40);

function mockExecutable(directory, name, source) {
    fs.writeFileSync(path.join(directory, name), `#!${process.execPath}\n${source}`, { mode: 0o755 });
}

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-maintenance-test-'));
    t.after(() => fs.rmSync(root, { force: true, recursive: true }));
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(path.join(repo, 'scripts/install-kvm4-security-maintenance.sh'), path.join(root, 'scripts/install-kvm4-security-maintenance.sh'));
    const artifacts = 'deploy/kvm4/security-maintenance';
    fs.mkdirSync(path.join(root, artifacts), { recursive: true });
    fs.cpSync(path.join(repo, artifacts), path.join(root, artifacts), { recursive: true });
    const committed = path.join(root, 'committed');
    fs.cpSync(path.join(root, artifacts), committed, { recursive: true });
    // Different worktree bytes must never reach the remote upload.
    fs.appendFileSync(path.join(root, artifacts, 'zaoyoe-cdk-shredder'), '\n# UNREVIEWED_WORKTREE\n');
    fs.appendFileSync(path.join(committed, 'zaoyoe-cdk-shredder'), '\n# COMMITTED_ARTIFACT\n');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(root, 'operations.jsonl');
    const common = `const fs=require('node:fs'); const args=process.argv.slice(2); const e=process.env; fs.appendFileSync(e.MOCK_LOG,JSON.stringify({tool:require('node:path').basename(process.argv[1]),args})+'\\n');\n`;
    mockExecutable(bin, 'git', common + `
const cmd=args.join(' ');
if(cmd==='remote') console.log(e.MOCK_REMOTES||'origin');
else if(cmd==='config --get-all remote.origin.url') console.log(e.MOCK_ORIGIN||'https://github.com/zaoyoe/Zaoyoe-Studio.git');
else if(cmd==='symbolic-ref --quiet --short HEAD') {if(e.MOCK_DETACHED)process.exit(1); console.log(e.MOCK_BRANCH||'main');}
else if(cmd==='status --porcelain --untracked-files=all') {if(e.MOCK_DIRTY) console.log('?? pending-source.js');}
else if(cmd==='fetch origin main') {if(e.MOCK_FETCH_FAIL)process.exit(1);}
else if(cmd==='rev-parse HEAD') console.log(e.MOCK_HEAD||e.MOCK_SHA);
else if(cmd==='rev-parse refs/remotes/origin/main') console.log(e.MOCK_MAIN||e.MOCK_SHA);
else if(args[0]==='show') {if(e.MOCK_SHOW_FAIL)process.exit(1); process.stdout.write(fs.readFileSync(require('node:path').join(e.MOCK_COMMITTED,require('node:path').basename(args[1]))));}
else process.exit(99);
`);
    mockExecutable(bin, 'cat', common + `
if(args[0]==='/opt/zaoyoe-verify-server/.current-release') console.log(e.MOCK_REMOTE_RELEASE||e.MOCK_SHA);
else process.exit(99);
`);
    mockExecutable(bin, 'systemctl', common + `
if(args[0]==='is-active') process.exit(e.MOCK_ACTIVE===args[2]?0:3);
if(args[0]==='is-enabled') process.exit(e.MOCK_ENABLED===args[2]?0:1);
if(args[0]==='daemon-reload') process.exit(0);
process.exit(99);
`);
    mockExecutable(bin, 'ssh', common + `
const input=fs.readFileSync(0,'utf8');
if(!input) process.exit(0); // chmod is logged, never executed on the host
const run=require('node:child_process').spawnSync('/bin/bash',['-s','--',e.MOCK_SHA],{input,env:e,encoding:'utf8'});
process.stdout.write(run.stdout||''); process.stderr.write(run.stderr||''); process.exit(run.status??99);
`);
    mockExecutable(bin, 'scp', common + `
for(const source of args.filter(a=>a.endsWith('.service')||a.endsWith('.timer')||a.endsWith('/zaoyoe-cdk-shredder')||a.endsWith('/zaoyoe-db-security-audit'))) {
fs.appendFileSync(e.MOCK_LOG,JSON.stringify({tool:'uploaded',source,content:fs.readFileSync(source,'utf8')})+'\\n');
}
`);
    fs.writeFileSync(path.join(root, 'fake-key'), 'test key placeholder');
    const env = { PATH: `${bin}:${process.env.PATH}`, HOME: root, TMPDIR: os.tmpdir(),
        MOCK_LOG: log, MOCK_SHA: sha, MOCK_COMMITTED: committed };
    return {
        run(overrides = {}, extra = []) {
            const result = spawnSync('/bin/bash', [path.join(root, 'scripts/install-kvm4-security-maintenance.sh'),
                '--expected-commit', sha, '--key', path.join(root, 'fake-key'), ...extra], {
                cwd: root, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10000
            });
            const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
            return { ...result, calls };
        }
    };
}

function assertBlockedBeforeRemote(result, pattern) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
    assert.equal(result.calls.some(c => ['ssh', 'scp'].includes(c.tool)), false);
}

test('maintenance dry-run states its limits and performs no git or remote operations', t => {
    const result = fixture(t).run({ MOCK_DIRTY: '1' }, ['--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /artifact presence and shell syntax only/);
    assert.match(result.stdout, /readiness: NOT CHECKED/);
    assert.deepEqual(result.calls, []);
});

test('maintenance rejects malformed commit before invoking remote tools', t => {
    assertBlockedBeforeRemote(fixture(t).run({}, ['--expected-commit', 'main']), /full lowercase SHA/);
});

for (const [name, env, pattern] of [
    ['feature branch', { MOCK_BRANCH: 'codex/security' }, /requires main/],
    ['detached checkout', { MOCK_DETACHED: '1' }, /requires main/],
    ['untracked source', { MOCK_DIRTY: '1' }, /clean checkout/],
    ['noncanonical origin', { MOCK_ORIGIN: 'git@github.com:zaoyoe/Zaoyoe-Studio.git' }, /canonical HTTPS/],
    ['split remotes', { MOCK_REMOTES: 'origin\nhttps-origin' }, /single canonical/],
    ['candidate mismatch', { MOCK_HEAD: otherSha }, /HEAD does not match/],
    ['main moved', { MOCK_MAIN: otherSha }, /not latest origin\/main/],
    ['fetch failure', { MOCK_FETCH_FAIL: '1' }, /(?:)/],
    ['missing committed artifact', { MOCK_SHOW_FAIL: '1' }, /(?:)/]
]) {
    test(`maintenance blocks ${name} before SSH or upload`, t => {
        assertBlockedBeforeRemote(fixture(t).run(env), pattern);
    });
}

for (const [name, env, pattern] of [
    ['different deployed release', { MOCK_REMOTE_RELEASE: otherSha }, /release does not match/],
    ['active maintenance service', { MOCK_ACTIVE: 'zaoyoe-cdk-shredder.service' }, /active maintenance unit/],
    ['enabled cleanup timer', { MOCK_ENABLED: 'zaoyoe-cdk-shredder.timer' }, /enabled maintenance timer/]
]) {
    test(`maintenance refuses ${name} before overwriting units`, t => {
        const result = fixture(t).run(env);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, pattern);
        assert.equal(result.calls.some(c => c.tool === 'scp'), false);
    });
}

test('maintenance uploads the matching committed bytes and never starts or enables jobs', t => {
    const result = fixture(t).run();
    assert.equal(result.status, 0, result.stderr);
    const uploads = result.calls.filter(c => c.tool === 'uploaded');
    assert.equal(uploads.length, 6);
    const wrapper = uploads.find(c => c.source.endsWith('/zaoyoe-cdk-shredder'));
    assert.match(wrapper.content, /COMMITTED_ARTIFACT/);
    assert.doesNotMatch(wrapper.content, /UNREVIEWED_WORKTREE/);
    assert.equal(result.calls.some(c => c.tool === 'systemctl' && ['enable', 'start', 'restart'].includes(c.args[0])), false);
    assert.equal(result.calls.filter(c => c.tool === 'systemctl' && c.args[0] === 'daemon-reload').length, 1);
    assert.match(result.stdout, /Timers were not enabled or started/);
});
