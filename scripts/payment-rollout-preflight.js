const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        allowNonProduction: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--allow-non-production') {
            options.allowNonProduction = true;
            continue;
        }

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
        }
    }

    return options;
}

function runNodeScript(scriptRelativePath, args = []) {
    const scriptPath = path.resolve(__dirname, scriptRelativePath);
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
        cwd: path.resolve(__dirname, '..'),
        encoding: 'utf8'
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    return result.status ?? 1;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const sharedArgs = ['--env-file', options.envFile];

    console.log('=== Payment Rollout Preflight ===');
    console.log(`env file: ${options.envFile}`);
    console.log('');

    const checkArgs = [...sharedArgs, '--validate-supabase', '--validate-payment-schema'];
    if (options.allowNonProduction) {
        checkArgs.push('--allow-non-production');
    }

    console.log('--- Environment / Supabase access check ---');
    const envStatus = runNodeScript('./check-prod-env.js', checkArgs);
    console.log('');

    console.log('--- Payment site anomaly scan ---');
    const scanStatus = runNodeScript('./scan-payment-site-values.js', [
        ...sharedArgs,
        '--fail-on-anomaly'
    ]);
    console.log('');

    if (envStatus !== 0 || scanStatus !== 0) {
        console.log('Preflight result: FAIL');
        process.exitCode = 1;
        return;
    }

    console.log('Preflight result: PASS');
}

if (require.main === module) {
    main();
}

module.exports = {
    parseArgs
};
