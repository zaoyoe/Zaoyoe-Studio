const fs = require('node:fs');
const path = require('node:path');

const {
    applyStaticAssetVersion,
    resolveStaticAssetVersion
} = require('./static-asset-versioner');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATIC_OUTPUT_DIR = '.vercel-static';
const PRIVATE_SOURCE_DIRS = new Set([
    '.git',
    '.github',
    '.vercel',
    '.vercel-static',
    '.wrangler',
    'api',
    'cloud-functions',
    'docs',
    'functions',
    'node_modules',
    'scripts',
    'server',
    'services',
    'supabase',
    'tests',
    'tools'
]);
const PRIVATE_ROOT_FILES = new Set([
    '.gitignore',
    '.vercelignore',
    'package-lock.json',
    'package.json',
    'railway.toml',
    'redeploy-trigger.txt'
]);
const PRIVATE_ROOT_TOOL_FILES = new Set([
    'analyze-images-ai.js',
    'browser-sync-ai-tags.js',
    'check_schema.js',
    'expand_css.js',
    'expand_css2.js',
    'extract-colors.js',
    'move_modules.js',
    'sync-ai-tags-to-supabase.js',
    'update_title.js'
]);
const PRIVATE_EXTENSIONS = new Set([
    '.bak',
    '.backup',
    '.key',
    '.log',
    '.md',
    '.p12',
    '.pem',
    '.py',
    '.sh',
    '.sql',
    '.tmp',
    '.toml'
]);
const PRIVATE_PATTERN_EXTENSIONS = new Set(['.css', '.html', '.js']);
const PRIVATE_BASENAME_PATTERNS = [
    /preview/i,
    /^debug/i,
    /(?:^|[-_])debug(?:[-_.]|$)/i,
    /(?:^|[-_])smoke(?:[-_.]|$)/i,
    /(?:^|[-_])test(?:[-_.]|$)/i,
    /(?:^|[-_])old(?:[-_.]|$)/i,
    /(?:^|[-_])migrate(?:[-_.]|$)/i
];

function normalizeRelativePath(relativePath = '') {
    return String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function isPrivateBasename(basename = '') {
    return PRIVATE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename));
}

function shouldCopyStaticAsset(relativePath = '') {
    const normalized = normalizeRelativePath(relativePath);
    const parts = normalized.split('/').filter(Boolean);
    const basename = parts.at(-1) || '';

    if (!normalized || basename === '.DS_Store') {
        return false;
    }

    if (PRIVATE_SOURCE_DIRS.has(parts[0])) {
        return false;
    }

    if (parts.length === 1 && (PRIVATE_ROOT_FILES.has(basename) || PRIVATE_ROOT_TOOL_FILES.has(basename))) {
        return false;
    }

    if (basename.startsWith('.env') || basename.endsWith('.env')) {
        return false;
    }

    const extension = path.extname(basename).toLowerCase();

    if (PRIVATE_EXTENSIONS.has(extension)) {
        return false;
    }

    return !(PRIVATE_PATTERN_EXTENSIONS.has(extension) && isPrivateBasename(basename));
}

function copyStaticAsset(sourceRoot, outputRoot, relativePath) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const targetPath = path.join(outputRoot, relativePath);

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
}

function copyStaticDirectory(sourceRoot, outputRoot, currentRelativePath = '') {
    const sourceDir = path.join(sourceRoot, currentRelativePath);

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const relativePath = path.join(currentRelativePath, entry.name);
        const normalized = normalizeRelativePath(relativePath);

        if (!shouldCopyStaticAsset(normalized)) {
            continue;
        }

        if (entry.isDirectory()) {
            copyStaticDirectory(sourceRoot, outputRoot, normalized);
            continue;
        }

        if (entry.isFile()) {
            copyStaticAsset(sourceRoot, outputRoot, normalized);
        }
    }
}

function buildStaticOutput({ rootDir = REPO_ROOT, outputDir = DEFAULT_STATIC_OUTPUT_DIR } = {}) {
    const normalizedRoot = path.resolve(rootDir);
    const outputRoot = path.resolve(normalizedRoot, outputDir);

    fs.rmSync(outputRoot, { recursive: true, force: true });
    fs.mkdirSync(outputRoot, { recursive: true });
    copyStaticDirectory(normalizedRoot, outputRoot);

    return {
        outputRoot,
        files: collectOutputFiles(outputRoot)
    };
}

function collectOutputFiles(outputRoot) {
    const files = [];

    function walk(currentDir, prefix = '') {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const relativePath = normalizeRelativePath(path.join(prefix, entry.name));
            const absolutePath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                walk(absolutePath, relativePath);
            } else if (entry.isFile()) {
                files.push(relativePath);
            }
        }
    }

    walk(outputRoot);
    return files.sort();
}

function runVercelBuild(argv = process.argv.slice(2), env = process.env, rootDir = REPO_ROOT) {
    const dryRun = argv.includes('--check') || argv.includes('--dry-run');
    const version = resolveStaticAssetVersion(env, rootDir);
    const versionResult = applyStaticAssetVersion({ rootDir, version, dryRun });
    const verb = dryRun ? 'would update' : 'updated';

    console.log(`[static-asset-versioner] ${verb} ${versionResult.replacements} asset references in ${versionResult.changedFiles.length} files to ${versionResult.version}`);

    if (dryRun) {
        return { versionResult, outputResult: null, dryRun };
    }

    const outputResult = buildStaticOutput({ rootDir });
    console.log(`[vercel-build] wrote ${outputResult.files.length} static files to ${path.relative(rootDir, outputResult.outputRoot)}`);

    return { versionResult, outputResult, dryRun };
}

if (require.main === module) {
    runVercelBuild();
}

module.exports = {
    buildStaticOutput,
    collectOutputFiles,
    runVercelBuild,
    shouldCopyStaticAsset
};
