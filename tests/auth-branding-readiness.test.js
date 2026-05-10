const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    REQUIRED_TEMPLATES,
    formatHumanReport,
    parseArgs,
    runReadiness
} = require('../scripts/auth-branding-readiness');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('auth branding readiness parseArgs supports json and fail-on-missing', () => {
    assert.deepEqual(parseArgs(['--json', '--fail-on-missing']), {
        json: true,
        failOnMissing: true
    });
});

test('auth email templates are brand-ready and infrastructure-domain free', () => {
    assert.deepEqual(REQUIRED_TEMPLATES, [
        'confirm-signup.html.tpl',
        'magic-link.html.tpl',
        'reset-password.html.tpl',
        'change-email.html.tpl'
    ]);

    for (const templateName of REQUIRED_TEMPLATES) {
        const source = readRepoFile(`supabase/auth-email-templates/${templateName}`);
        assert.match(source, /Zaoyoe/);
        assert.match(source, /\{\{ \.ConfirmationURL \}\}/);
        assert.doesNotMatch(source, /supabase\.co|r2\.dev/i);
    }
});

test('auth branding readiness keeps custom smtp and custom domain optional', () => {
    const summary = runReadiness();
    const packageJson = JSON.parse(readRepoFile('package.json'));
    const checklist = readRepoFile('docs/auth-branding-supabase-checklist.md');

    assert.equal(summary.ok, true);
    assert.equal(summary.findings.length, 0);
    assert.equal(
        packageJson.scripts['readiness:auth-branding'],
        'node scripts/auth-branding-readiness.js --fail-on-missing'
    );
    assert.match(checklist, /Supabase default delivery remains the fallback/);
    assert.match(checklist, /not a frontend runtime dependency/);
    assert.match(checklist, /https:\/\/www\.zaoyoe\.com\/reset-password\.html/);
    assert.match(checklist, /https:\/\/zaoyoe\.xyz\/reset-password\.html/);
});

test('auth branding readiness report is human-readable', () => {
    const output = formatHumanReport({
        checked_at: '2026-05-10T00:00:00.000Z',
        checks: [
            { key: 'template:reset-password.html.tpl', ok: true, message: 'brand-ready' }
        ],
        findings: [],
        ok: true
    });

    assert.match(output, /Auth Branding Readiness/);
    assert.match(output, /\[OK\] template:reset-password\.html\.tpl/);
    assert.match(output, /findings: none/);
    assert.match(output, /result: PASS/);
});
