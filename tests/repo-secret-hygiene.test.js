const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const HARD_CODED_SUPABASE_HOST = 'mmkugdibsaeoevliebzk.supabase.co';
const SECONDARY_SUPABASE_HOST = 'kbclpfztfjgqikzsydfy.supabase.co';
const LEAKED_BATCH_API_KEY = 'cdk_=_vgb6#kJqYeu-mzD5%@6dQ8vVc4OB@-';
const LEAKED_R2_ACCESS_KEY = '9ab75a0b5d14dcb9b63dd0da8b5d177a';
const LEAKED_R2_SECRET_KEY = '403a94052676fb998160bc696feb746d85e313dbe8401f6616d58cf4e9d0afae';
const SECRET_HYGIENE_TARGETS = [
    'deploy-r2-edge-function.sh',
    'R2_AVATAR_DEPLOYMENT.md',
    'R2_EDGE_FUNCTION_DEPLOYMENT.md',
    'supabase/functions/DEPLOY.md',
    'supabase/functions/upload-to-r2/README.md',
    'supabase/configure_verify.sql',
    'scripts/optimize-shop-images.js',
    'scripts/fix-missing-thumbnails.js',
    'scripts/migrate-shop-images.js',
    'scripts/migrate-prompts-bilingual.js',
    'scripts/batch-generate-thumbnails-node.js',
    'scripts/batch-translate-prompts.js',
    'scripts/update-prompt-4-translation.js',
    'scripts/update-supabase-r2-urls.js',
    'check_schema.js',
    'sync-ai-tags-to-supabase.js',
    'test-rpc2.js',
    'update_title.js'
];

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

function listTracked(relativePath) {
    try {
        return execFileSync('git', ['ls-files', relativePath], {
            cwd: REPO_ROOT,
            encoding: 'utf8'
        })
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
    } catch (_) {
        return [];
    }
}

test('real environment files stay ignored and untracked', { skip: !ensureGitRepo() }, () => {
    const gitignore = readRepoFile('.gitignore');

    assert.match(gitignore, /^\.env\.local$/m, '.gitignore should ignore .env.local');
    assert.match(gitignore, /^server\/\.env\.production$/m, '.gitignore should ignore server/.env.production');
    assert.match(gitignore, /^supabase\/\.temp\/$/m, '.gitignore should ignore Supabase CLI temp metadata');
    assert.equal(isTracked('.env.local'), false, '.env.local must not be tracked by git');
    assert.equal(isTracked('server/.env.production'), false, 'server/.env.production must not be tracked by git');
    assert.deepEqual(listTracked('supabase/.temp'), [], 'supabase/.temp metadata must not be tracked by git');
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

test('operational scripts and deployment docs do not ship leaked secrets or real project refs', () => {
    for (const relativePath of SECRET_HYGIENE_TARGETS) {
        const content = readRepoFile(relativePath);
        assert.doesNotMatch(content, new RegExp(HARD_CODED_SUPABASE_HOST.replaceAll('.', '\\.')), `${relativePath} should not pin the real Supabase project host`);
        assert.doesNotMatch(content, new RegExp(SECONDARY_SUPABASE_HOST.replaceAll('.', '\\.')), `${relativePath} should not pin a historical Supabase project host`);
        assert.doesNotMatch(content, new RegExp(LEAKED_BATCH_API_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${relativePath} should not embed a real Batch API key`);
        assert.doesNotMatch(content, new RegExp(LEAKED_R2_ACCESS_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${relativePath} should not embed a real R2 access key`);
        assert.doesNotMatch(content, new RegExp(LEAKED_R2_SECRET_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${relativePath} should not embed a real R2 secret key`);
        assert.doesNotMatch(content, /eyJhbGciOiJIUzI1Ni/, `${relativePath} should not embed JWT credentials`);
    }
});
