const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const HARD_CODED_SUPABASE_HOST = 'mmkugdibsaeoevliebzk.supabase.co';

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function ensureGitRepo() {
    return fs.existsSync(path.join(REPO_ROOT, '.git'));
}

function isTracked(relativePath) {
    try {
        execFileSync('git', ['ls-files', '--error-unmatch', relativePath], {
            cwd: REPO_ROOT,
            stdio: 'ignore'
        });
        return true;
    } catch (_) {
        return false;
    }
}

test('real environment files stay ignored and untracked', { skip: !ensureGitRepo() }, () => {
    const gitignore = readRepoFile('.gitignore');

    assert.match(gitignore, /^\.env\.local$/m, '.gitignore should ignore .env.local');
    assert.match(gitignore, /^server\/\.env\.production$/m, '.gitignore should ignore server/.env.production');
    assert.equal(isTracked('.env.local'), false, '.env.local must not be tracked by git');
    assert.equal(isTracked('server/.env.production'), false, 'server/.env.production must not be tracked by git');
});

test('tracked env templates exist without pointing at the production Supabase host', { skip: !ensureGitRepo() }, () => {
    for (const relativePath of ['.env.local.example', 'server/.env.example', 'server/.env.production.example']) {
        assert.equal(isTracked(relativePath), true, `${relativePath} should be committed as a template`);
    }

    const serverExample = readRepoFile('server/.env.example');
    const productionExample = readRepoFile('server/.env.production.example');

    assert.doesNotMatch(
        serverExample,
        new RegExp(HARD_CODED_SUPABASE_HOST.replaceAll('.', '\\.')),
        'server/.env.example should not pin the real Supabase project host'
    );
    assert.doesNotMatch(
        productionExample,
        new RegExp(HARD_CODED_SUPABASE_HOST.replaceAll('.', '\\.')),
        'server/.env.production.example should not pin the real Supabase project host'
    );
    assert.match(serverExample, /SUPABASE_URL=https:\/\/your-project-ref\.supabase\.co/);
});

test('payment rollout runbook references the guarded preflight command', () => {
    const rolloutDoc = readRepoFile(path.join('docs', 'supabase-payment-hardening-rollout.md'));
    assert.match(
        rolloutDoc,
        /npm run preflight:payment-rollout -- --env-file server\/\.env\.production/,
        'runbook should point operators at the combined guarded preflight command'
    );
    assert.match(
        rolloutDoc,
        /npm run rollout:payment -- --env-file server\/\.env\.production --set incremental/,
        'runbook should document the guarded migration rollout planner'
    );
    assert.match(
        rolloutDoc,
        /npm run smoke:payment -- --env-file server\/\.env\.production/,
        'runbook should document the automated payment smoke command'
    );
});
