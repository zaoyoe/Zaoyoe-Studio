#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const integrationDir = __dirname;

function parseArgs(argv = []) {
    const options = {
        targetDir: '',
        dryRun: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--target') {
            options.targetDir = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--dry-run') {
            options.dryRun = true;
            continue;
        }

        if (!options.targetDir && !value.startsWith('-')) {
            options.targetDir = value;
        }
    }

    return options;
}

function assertFileExists(filePath, label) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`${label} not found: ${filePath}`);
    }
}

function copyBridgeFile(fileName, targetDir, { dryRun = false } = {}) {
    const sourcePath = path.join(integrationDir, fileName);
    const targetPath = path.join(targetDir, fileName);
    assertFileExists(sourcePath, `Bridge source ${fileName}`);

    if (!dryRun) {
        fs.copyFileSync(sourcePath, targetPath);
    }

    return targetPath;
}

function buildRouterMountSnippet() {
    return [
        '',
        '',
        '# Zaoyoe marketplace bridge. Added by install-bridge.js.',
        'try:',
        '    from zaoyoe_bridge import router as zaoyoe_bridge_router',
        '    app.include_router(zaoyoe_bridge_router)',
        'except Exception as exc:',
        '    print(f"[zaoyoe-bridge] failed to mount router: {exc}")',
        ''
    ].join('\n');
}

function patchReplyServer(replyServerPath, { dryRun = false } = {}) {
    assertFileExists(replyServerPath, 'reply_server.py');
    const source = fs.readFileSync(replyServerPath, 'utf8');

    if (!/\bapp\s*=\s*FastAPI\b/.test(source) && !/\bFastAPI\s*\(/.test(source)) {
        throw new Error(`reply_server.py does not look like a FastAPI app: ${replyServerPath}`);
    }

    if (source.includes('zaoyoe_bridge_router') || source.includes('zaoyoe_bridge import router')) {
        return {
            changed: false,
            backupPath: '',
            message: 'reply_server.py already mounts zaoyoe_bridge'
        };
    }

    const backupPath = `${replyServerPath}.zaoyoe.bak`;
    const patched = `${source.replace(/\s*$/, '')}${buildRouterMountSnippet()}`;

    if (!dryRun) {
        if (!fs.existsSync(backupPath)) {
            fs.copyFileSync(replyServerPath, backupPath);
        }
        fs.writeFileSync(replyServerPath, patched, 'utf8');
    }

    return {
        changed: true,
        backupPath,
        message: 'reply_server.py patched'
    };
}

function installBridge({ targetDir = '', dryRun = false } = {}) {
    const resolvedTargetDir = path.resolve(process.cwd(), String(targetDir || '').trim());
    if (!targetDir) {
        throw new Error('Target xianyu-auto-reply-fix directory is required');
    }
    if (!fs.existsSync(resolvedTargetDir) || !fs.statSync(resolvedTargetDir).isDirectory()) {
        throw new Error(`Target directory not found: ${resolvedTargetDir}`);
    }

    const replyServerPath = path.join(resolvedTargetDir, 'reply_server.py');
    const copiedFiles = [
        copyBridgeFile('zaoyoe_bridge.py', resolvedTargetDir, { dryRun }),
        copyBridgeFile('zaoyoe_sender_example.py', resolvedTargetDir, { dryRun })
    ];
    const patchResult = patchReplyServer(replyServerPath, { dryRun });

    return {
        success: true,
        dry_run: dryRun,
        target_dir: resolvedTargetDir,
        copied_files: copiedFiles,
        reply_server: {
            path: replyServerPath,
            ...patchResult
        },
        next_steps: [
            'Restart xianyu-auto-reply-fix',
            'Open /zaoyoe/health on its FastAPI port',
            'Run marketplace:xianyu:bridge with --bot-orders-url and --bot-send-message-url'
        ]
    };
}

function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    const result = installBridge(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error?.message || error}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    buildRouterMountSnippet,
    installBridge,
    main,
    parseArgs,
    patchReplyServer
};