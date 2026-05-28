const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'supabase/auth-email-templates');
const DASHBOARD_CONFIG_PATH = path.join(TEMPLATE_DIR, 'dashboard-config.json');
const REQUIRED_TEMPLATES = Object.freeze([
    'confirm-signup.html.tpl',
    'magic-link.html.tpl',
    'reset-password.html.tpl',
    'change-email.html.tpl'
]);
const REQUIRED_REDIRECT_URLS = Object.freeze([
    'https://www.fatherkey.com/auth-callback.html',
    'https://www.fatherkey.com/reset-password.html',
    'https://zaoyoe.xyz/auth-callback.html',
    'https://zaoyoe.xyz/reset-password.html',
    'https://www.zaoyoe.xyz/auth-callback.html',
    'https://www.zaoyoe.xyz/reset-password.html'
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

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function inspectDashboardConfig() {
    if (!fs.existsSync(DASHBOARD_CONFIG_PATH)) {
        return [
            buildCheck(
                'dashboard-config:exists',
                false,
                'dashboard-config.json is missing',
                { path: 'supabase/auth-email-templates/dashboard-config.json' }
            )
        ];
    }

    const config = readJsonFile(DASHBOARD_CONFIG_PATH);
    const checks = [
        buildCheck(
            'dashboard-config:site-url',
            config.siteUrl === 'https://www.fatherkey.com',
            'dashboard config pins the canonical CN Site URL'
        )
    ];

    const redirectUrls = Array.isArray(config.additionalRedirectUrls) ? config.additionalRedirectUrls : [];
    checks.push(buildCheck(
        'dashboard-config:dual-site-redirects',
        REQUIRED_REDIRECT_URLS.every((url) => redirectUrls.includes(url)),
        'dashboard config includes CN and international auth redirect URLs'
    ));

    const templates = Array.isArray(config.emailTemplates) ? config.emailTemplates : [];
    const templateFiles = templates.map((template) => String(template?.file || '').trim()).filter(Boolean);
    checks.push(buildCheck(
        'dashboard-config:template-files',
        REQUIRED_TEMPLATES.every((templateName) => templateFiles.includes(templateName)),
        'dashboard config maps every required email template file'
    ));
    checks.push(buildCheck(
        'dashboard-config:template-subjects',
        templates.length >= REQUIRED_TEMPLATES.length
            && templates.every((template) => String(template?.subject || '').includes('Zaoyoe')),
        'dashboard config includes branded subjects for every email template'
    ));
    checks.push(buildCheck(
        'dashboard-config:template-variables',
        templates.every((template) => (
            Array.isArray(template?.requiredVariables)
                && template.requiredVariables.includes('{{ .ConfirmationURL }}')
        )),
        'dashboard config keeps the Supabase ConfirmationURL variable required'
    ));
    checks.push(buildCheck(
        'dashboard-config:optional-smtp',
        config.customSmtp?.optional === true
            && /Supabase default/i.test(String(config.customSmtp?.fallback || '')),
        'dashboard config keeps Custom SMTP optional with Supabase delivery fallback'
    ));
    checks.push(buildCheck(
        'dashboard-config:optional-custom-domain',
        config.customDomain?.optional === true
            && /Supabase/i.test(String(config.customDomain?.fallback || '')),
        'dashboard config keeps Supabase Custom Domain optional'
    ));

    return checks;
}

function runReadiness() {
    const checks = [];

    checks.push(...inspectDashboardConfig());

    for (const templateName of REQUIRED_TEMPLATES) {
        checks.push(inspectTemplate(templateName));
    }

    const authRuntime = readRepoFile('supabase-auth-functions.js');
    checks.push(buildCheck(
        'auth:reset-current-origin',
        authRuntime.includes("redirectTo: buildAuthRedirectUrl('/reset-password.html')")
            && authRuntime.includes("hostname === 'zaoyoe.xyz' || hostname === 'www.zaoyoe.xyz'"),
        'password reset redirect uses the current site family'
    ));
    checks.push(buildCheck(
        'auth:oauth-current-origin',
        authRuntime.includes("const redirectTo = buildAuthRedirectUrl('/auth-callback.html');"),
        'Google OAuth redirect uses the current site family'
    ));

    const checklist = readRepoFile('docs/auth-branding-supabase-checklist.md');
    checks.push(buildCheck(
        'docs:dual-site-redirects',
        REQUIRED_REDIRECT_URLS.every((url) => checklist.includes(url)),
        'checklist includes CN and international auth redirect URLs'
    ));
    checks.push(buildCheck(
        'docs:dashboard-config',
        checklist.includes('supabase/auth-email-templates/dashboard-config.json'),
        'checklist points operators to the machine-readable dashboard config'
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
    REQUIRED_REDIRECT_URLS,
    REQUIRED_TEMPLATES,
    formatHumanReport,
    inspectDashboardConfig,
    inspectTemplate,
    parseArgs,
    runReadiness
};
