const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEPLOY_TEXT_EXTENSIONS = new Set(['.html', '.js', '.css']);
const PUBLIC_SOURCE_DIRS = ['js', 'css'];
const SAME_SITE_HOSTS = new Set(['www.zaoyoe.com', 'zaoyoe.com']);
const ROOT_TOOL_SCRIPTS = new Set([
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
const STATIC_ASSET_URL_RE = /(?<url>(?:https?:\/\/|\/\/|(?:\.{1,2}\/|\/)?)(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/)*[A-Za-z0-9._~!$&'()*+,;=:@%-]+\.(?:js|css)\?[^"'`\s<>)\\]*?\bv=)(?<version>[^&"'`\s<>)\\]*)/g;

function normalizeStaticAssetVersion(rawVersion) {
    const version = String(rawVersion || '')
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, '')
        .slice(0, 40);

    if (!version) {
        throw new Error('Static asset version is empty after normalization');
    }

    return version;
}

function resolveStaticAssetVersion(env = process.env, rootDir = REPO_ROOT) {
    if (env.STATIC_ASSET_VERSION) {
        return normalizeStaticAssetVersion(env.STATIC_ASSET_VERSION);
    }

    const commitSha = env.VERCEL_GIT_COMMIT_SHA
        || execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });

    return normalizeStaticAssetVersion(commitSha).slice(0, 12);
}

function shouldSkipPublicTextFile(relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    const basename = path.basename(normalized);

    if (normalized.startsWith('.git/') || normalized.startsWith('.vercel/') || normalized.startsWith('node_modules/')) {
        return true;
    }

    if (ROOT_TOOL_SCRIPTS.has(basename)) {
        return true;
    }

    return [
        /preview/i,
        /^debug/i,
        /(?:^|[-_])debug(?:[-_.]|$)/i,
        /(?:^|[-_])smoke(?:[-_.]|$)/i,
        /(?:^|[-_])test(?:[-_.]|$)/i,
        /(?:^|[-_])old(?:[-_.]|$)/i,
        /(?:^|[-_])migrate(?:[-_.]|$)/i
    ].some((pattern) => pattern.test(basename));
}

function collectFilesInDirectory(rootDir, directory, files) {
    const absoluteDir = path.join(rootDir, directory);
    if (!fs.existsSync(absoluteDir)) {
        return;
    }

    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
        const relativePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectFilesInDirectory(rootDir, relativePath, files);
            continue;
        }

        if (entry.isFile() && DEPLOY_TEXT_EXTENSIONS.has(path.extname(entry.name)) && !shouldSkipPublicTextFile(relativePath)) {
            files.push(relativePath);
        }
    }
}

function collectDeployTextFiles(rootDir = REPO_ROOT) {
    const files = [];

    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        if (entry.isFile() && DEPLOY_TEXT_EXTENSIONS.has(path.extname(entry.name)) && !shouldSkipPublicTextFile(entry.name)) {
            files.push(entry.name);
        }
    }

    for (const directory of PUBLIC_SOURCE_DIRS) {
        collectFilesInDirectory(rootDir, directory, files);
    }

    return [...new Set(files)].sort();
}

function isSameSiteAbsoluteUrl(urlPrefix) {
    if (!/^(?:https?:)?\/\//i.test(urlPrefix)) {
        return true;
    }

    try {
        const url = new URL(urlPrefix.startsWith('//') ? `https:${urlPrefix}x` : `${urlPrefix}x`);
        return SAME_SITE_HOSTS.has(url.hostname);
    } catch {
        return false;
    }
}

function shouldRewriteStaticAssetUrl(urlPrefix) {
    if (!isSameSiteAbsoluteUrl(urlPrefix)) {
        return false;
    }

    try {
        const url = new URL(`${urlPrefix}x`, 'https://www.zaoyoe.com/');
        return /\.(?:js|css)$/i.test(url.pathname) && !url.pathname.startsWith('/api/');
    } catch {
        return false;
    }
}

function rewriteStaticAssetVersionsInText(source, version) {
    const normalizedVersion = normalizeStaticAssetVersion(version);
    let replacements = 0;

    const text = String(source).replace(STATIC_ASSET_URL_RE, (match, ...args) => {
        const groups = args.at(-1);
        const urlPrefix = groups?.url || '';
        const currentVersion = groups?.version || '';

        if (!shouldRewriteStaticAssetUrl(urlPrefix) || currentVersion === normalizedVersion) {
            return match;
        }

        replacements += 1;
        return `${urlPrefix}${normalizedVersion}`;
    });

    return { text, replacements };
}

function applyStaticAssetVersion({ rootDir = REPO_ROOT, version = resolveStaticAssetVersion(process.env, rootDir), dryRun = false } = {}) {
    const files = collectDeployTextFiles(rootDir);
    const changedFiles = [];
    let replacements = 0;

    for (const relativePath of files) {
        const absolutePath = path.join(rootDir, relativePath);
        const source = fs.readFileSync(absolutePath, 'utf8');
        const result = rewriteStaticAssetVersionsInText(source, version);

        if (result.replacements === 0) {
            continue;
        }

        replacements += result.replacements;
        changedFiles.push(relativePath);

        if (!dryRun) {
            fs.writeFileSync(absolutePath, result.text);
        }
    }

    return { version, filesScanned: files.length, changedFiles, replacements, dryRun };
}

function main(argv = process.argv.slice(2), env = process.env, rootDir = REPO_ROOT) {
    const dryRun = argv.includes('--check') || argv.includes('--dry-run');
    const version = resolveStaticAssetVersion(env, rootDir);
    const result = applyStaticAssetVersion({ rootDir, version, dryRun });
    const verb = dryRun ? 'would update' : 'updated';

    console.log(`[static-asset-versioner] ${verb} ${result.replacements} asset references in ${result.changedFiles.length} files to ${result.version}`);

    return result;
}

if (require.main === module) {
    main();
}

module.exports = {
    applyStaticAssetVersion,
    collectDeployTextFiles,
    normalizeStaticAssetVersion,
    resolveStaticAssetVersion,
    rewriteStaticAssetVersionsInText,
    shouldRewriteStaticAssetUrl
};
