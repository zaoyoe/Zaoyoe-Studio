const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'supabase/auth-email-templates');
const REQUIRED_TEMPLATES = Object.freeze([
    'confirm-signup.html.tpl',
    'magic-link.html.tpl',
    'reset-password.html.tpl',
    'change-email.html.tpl'
]);

function parseArgs(argv = []) {
    const options = {
        json: false,
        failOnMissing: false
    };

    for (const rawValue of argv) {
        const value = String(rawValue || '').trim();
        if (value === '--json') {
            options.json = true;
        } else if (value === '--fail-on-missing') {
            options.failOnMissing = true;
        }
    }

    return options;
}

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function buildCheck(key, ok, message, detail = {}) {
    return {
        key,
        ok: ok === true,
        message,
        ...detail
    };
}

function inspectTemplate(templateName) {
    const relativePath = `supabase/auth-email-templates/${templateName}`;
    const absolutePath = path.join(REPO_ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) {
        return buildCheck(
            `template:${templateName}`,
            false,
            `${templateName} is missing`,
            { path: relativePath }
        );
    }

    const source = fs.readFileSync(absolutePath, 'utf8');
    const failures = [];
    if (!source.includes('Zaoyoe')) {
        failures.push('missing Zaoyoe brand text');
    }
    if (!source.includes('{{ .ConfirmationURL }}')) {
        failures.push('missing Supabase ConfirmationURL variable');
    }
    if (/supabase\.co|r2\.dev/i.test(source)) {
        failures.push('hard-coded infrastructure domain');
    }

    return buildCheck(
        `template:${templateName}`,
        failures.length === 0,
        failures.length ? failures.join('; ') : `${templateName} is brand-ready`,
        { path: relativePath }
    );
}

function runReadiness() {
    const checks = [];

    for (const templateName of REQUIRED_TEMPLATES) {
        checks.push(inspectTemplate(templateName));
    }

    const authRuntime = readRepoFile('supabase-auth-functions.js');
    checks.push(buildCheck(
        'auth:reset-current-origin',
        authRuntime.includes("redirectTo: window.location.origin + '/reset-password.html'"),
        'password reset redirect uses the current site origin'
    ));
    checks.push(buildCheck(
        'auth:oauth-current-origin',
        authRuntime.includes('const redirectTo = `${window.location.origin}/auth-callback.html`;'),
        'Google OAuth redirect uses the current site origin'
    ));

    const checklist = readRepoFile('docs/auth-branding-supabase-checklist.md');
    checks.push(buildCheck(
        'docs:dual-site-redirects',
        checklist.includes('https://www.zaoyoe.com/reset-password.html')
            && checklist.includes('https://zaoyoe.xyz/reset-password.html')
            && checklist.includes('https://www.zaoyoe.com/auth-callback.html')
            && checklist.includes('https://zaoyoe.xyz/auth-callback.html'),
        'checklist includes CN and international auth redirect URLs'
    ));
    checks.push(buildCheck(
        'docs:optional-custom-domain',
        /Custom Domain[\s\S]*not a frontend runtime dependency/i.test(checklist)
            && /Supabase default delivery remains the fallback/i.test(checklist),
        'checklist keeps SMTP and Custom Domain optional'
    ));

    const failed = checks.filter((check) => check.ok !== true);
    return {
        checked_at: new Date().toISOString(),
        templates: REQUIRED_TEMPLATES,
        checks,
        ok: failed.length === 0,
        findings: failed.map((check) => ({
            severity: 'high',
            key: check.key,
            message: check.message,
            path: check.path || ''
        }))
    };
}

function formatHumanReport(summary = {}) {
    const lines = [
        'Auth Branding Readiness',
        '',
        `checked_at: ${summary.checked_at || ''}`,
        ''
    ];

    for (const check of summary.checks || []) {
        lines.push(`${check.ok ? '[OK]' : '[FAIL]'} ${check.key}: ${check.message}`);
    }

    lines.push('');
    if (!summary.findings?.length) {
        lines.push('findings: none');
    } else {
        lines.push('findings:');
        for (const finding of summary.findings) {
            lines.push(`- [${finding.severity}] ${finding.key}: ${finding.message}`);
        }
    }
    lines.push('');
    lines.push(`result: ${summary.ok ? 'PASS' : 'FAIL'}`);
    return lines.join('\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const summary = runReadiness();
    console.log(options.json ? JSON.stringify(summary, null, 2) : formatHumanReport(summary));
    if (options.failOnMissing && !summary.ok) {
        process.exitCode = 2;
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}

module.exports = {
    REQUIRED_TEMPLATES,
    formatHumanReport,
    inspectTemplate,
    parseArgs,
    runReadiness
};
