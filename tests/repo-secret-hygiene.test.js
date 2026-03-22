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
        /npm run verify:payment-rollout -- --env-file server\/\.env\.production --fail-on-finding/,
        'runbook should document the post-rollout verification command'
    );
    assert.match(
        rolloutDoc,
        /npm run smoke:payment -- --env-file server\/\.env\.production/,
        'runbook should document the automated payment smoke command'
    );
});

test('security workflow always runs on pull requests and exercises the guarded rollout planner', () => {
    const workflow = readRepoFile(path.join('.github', 'workflows', 'security-tests.yml'));

    const pullRequestSection = workflow.split(/\nworkflow_dispatch:/)[0];
    assert.match(pullRequestSection, /\n\s*pull_request:\n/, 'security workflow should trigger on all pull requests');

    const normalizedLines = pullRequestSection.split('\n');
    const pullRequestLineIndex = normalizedLines.findIndex((line) => /^\s*pull_request:\s*$/.test(line));
    assert.notEqual(pullRequestLineIndex, -1, 'pull_request trigger should be present');

    const linesAfterPullRequest = normalizedLines.slice(pullRequestLineIndex + 1);
    const nextTopLevelIndex = linesAfterPullRequest.findIndex((line) => line.trim() && !/^\s/.test(line));
    const pullRequestBlock = nextTopLevelIndex === -1
        ? linesAfterPullRequest
        : linesAfterPullRequest.slice(0, nextTopLevelIndex);

    assert.equal(
        pullRequestBlock.some((line) => /^\s+paths:\s*$/.test(line)),
        false,
        'pull_request trigger should not be path-filtered, otherwise required checks can stay pending'
    );
    assert.match(
        workflow,
        /npm run rollout:payment -- --env-file server\/\.env\.example --set incremental --project-ref ci-demo-ref --db-url postgresql:\/\/example\.invalid\/postgres/,
        'security workflow should run the guarded rollout planner smoke check'
    );
});
