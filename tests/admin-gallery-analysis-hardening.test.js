const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function extractFunction(source, functionName) {
    const marker = `function ${functionName}(`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `Expected to find ${marker}`);

    const paramsStart = source.indexOf('(', start);
    assert.notEqual(paramsStart, -1, `Expected to find parameter list for ${functionName}`);

    let paramsDepth = 0;
    let paramsEnd = -1;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;

    for (let index = paramsStart; index < source.length; index += 1) {
        const char = source[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (inSingle) {
            if (char === '\'') inSingle = false;
            continue;
        }

        if (inDouble) {
            if (char === '"') inDouble = false;
            continue;
        }

        if (inTemplate) {
            if (char === '`') inTemplate = false;
            continue;
        }

        if (char === '\'') {
            inSingle = true;
            continue;
        }

        if (char === '"') {
            inDouble = true;
            continue;
        }

        if (char === '`') {
            inTemplate = true;
            continue;
        }

        if (char === '(') {
            paramsDepth += 1;
            continue;
        }

        if (char === ')') {
            paramsDepth -= 1;
            if (paramsDepth === 0) {
                paramsEnd = index;
                break;
            }
        }
    }

    assert.notEqual(paramsEnd, -1, `Expected to find parameter terminator for ${functionName}`);

    const bodyStart = source.indexOf('{', paramsEnd);
    assert.notEqual(bodyStart, -1, `Expected to find function body for ${functionName}`);

    let depth = 0;
    inSingle = false;
    inDouble = false;
    inTemplate = false;
    escaped = false;

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (inSingle) {
            if (char === '\'') inSingle = false;
            continue;
        }

        if (inDouble) {
            if (char === '"') inDouble = false;
            continue;
        }

        if (inTemplate) {
            if (char === '`') inTemplate = false;
            continue;
        }

        if (char === '\'') {
            inSingle = true;
            continue;
        }

        if (char === '"') {
            inDouble = true;
            continue;
        }

        if (char === '`') {
            inTemplate = true;
            continue;
        }

        if (char === '{') {
            depth += 1;
            continue;
        }

        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Failed to extract function ${functionName}`);
}

test('gallery analysis toast keeps upstream HTML errors as plain text', () => {
    const source = readRepoFile('admin-studio.js');
    const normalizeFeedbackStateSource = extractFunction(source, 'normalizeAdminStudioFeedbackState');
    const setToastContentSource = extractFunction(source, 'setToastContent');

    const context = {
        document: {
            createElement(tag) {
                return {
                    tagName: tag,
                    className: '',
                    textContent: '',
                    children: [],
                    append(...nodes) {
                        this.children.push(...nodes);
                    }
                };
            }
        }
    };

    vm.runInNewContext(`${normalizeFeedbackStateSource}; ${setToastContentSource}; globalThis.setToastContent = setToastContent;`, context);

    const toast = {
        className: '',
        children: [],
        replaceChildren(...nodes) {
            this.children = nodes;
        }
    };

    context.setToastContent(toast, '<h1>Bad gateway Error code 502</h1>', 'error');

    assert.equal(toast.className, 'toast error');
    assert.equal(toast.children.length, 2);
    assert.equal(toast.children[0].tagName, 'i');
    assert.equal(toast.children[1].tagName, 'div');
    assert.equal(toast.children[1].children[0].tagName, 'span');
    assert.equal(toast.children[1].children[0].textContent, '<h1>Bad gateway Error code 502</h1>');
});

test('gallery analysis retry helper only retries gateway-like failures', () => {
    const source = readRepoFile('admin-studio.js');
    const retryHelperSource = extractFunction(source, 'isRetryableVisionError');

    const context = {};
    vm.runInNewContext(`
        const ADMIN_VISION_RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);
        ${retryHelperSource}
        globalThis.isRetryableVisionError = isRetryableVisionError;
    `, context);

    assert.equal(context.isRetryableVisionError({ status: 502, message: 'Bad gateway' }), true);
    assert.equal(context.isRetryableVisionError({ status: 503, message: 'Service unavailable' }), true);
    assert.equal(context.isRetryableVisionError({ status: 400, message: 'Bad request' }), false);
    assert.equal(context.isRetryableVisionError({ status: 200, message: 'timed out upstream' }), true);
});

test('gallery analysis payload is slimmed and single-image analysis is normalized', () => {
    const source = readRepoFile('admin-studio.js');
    const callAdminVisionSource = extractFunction(source, 'callAdminVision');
    const createImageGridSource = extractFunction(source, 'createImageGrid');

    assert.match(callAdminVisionSource, /ADMIN_VISION_ANALYSIS_MAX_OUTPUT_TOKENS/);
    assert.doesNotMatch(callAdminVisionSource, /"prompt_suggestion_en"/);
    assert.match(callAdminVisionSource, /"objects": \{\s+"en": \["6-10 visible objects or subjects"\]/);
    assert.match(callAdminVisionSource, /"useCase"/);
    assert.match(callAdminVisionSource, /"commercial"/);
    assert.match(callAdminVisionSource, /"difficulty": "beginner \| intermediate \| advanced"/);
    assert.match(createImageGridSource, /return normalizeImageForAnalysis\(images\[0\]\);/);
});

test('manage batch analysis also completes bilingual fields and verifies persisted results', () => {
    const source = readRepoFile('admin-studio.js');
    const html = readRepoFile('admin-studio.html');
    const batchSource = extractFunction(source, 'executeBatchReanalyze');

    assert.match(html, /批量分析并补全双语/);
    assert.match(html, /仅补全双语/);
    assert.match(batchSource, /reanalyzeSinglePrompt\(prompt, writableSite\)/);
    assert.match(batchSource, /completePromptBilingualFields\(savedPrompt, writableSite, \{\s+mode: 'full'/);
    assert.match(batchSource, /getGalleryImportMissingAnalysisLabels\(verifiedPrompt\)/);
    assert.match(batchSource, /getGalleryImportMissingBilingualLabels\(verifiedPrompt\)/);
    assert.match(batchSource, /分析失败/);
    assert.match(batchSource, /双语失败/);
    assert.match(batchSource, /保存确认失败/);
});

test('vercel admin function gets an explicit longer max duration', () => {
    const config = JSON.parse(readRepoFile('vercel.json'));

    assert.equal(config.functions['api/admin.js'].maxDuration, 60);
});

test('vercel admin function includes the prompt image palette runtime dependency', () => {
    const config = JSON.parse(readRepoFile('vercel.json'));
    const vercelIgnore = readRepoFile('.vercelignore');
    const includeFiles = String(config.functions?.['api/admin.js']?.includeFiles || '');

    assert.equal(includeFiles.includes('server/prompt-*.js'), true);
    assert.match(vercelIgnore, /!server\/prompt-image-palette\.js/);
});

test('vercel admin function traces the prompt video poster runtime and FFmpeg dependency', () => {
    const config = JSON.parse(readRepoFile('vercel.json'));
    const packageJson = JSON.parse(readRepoFile('package.json'));
    const includeFiles = String(config.functions?.['api/admin.js']?.includeFiles || '');
    const posterRuntime = readRepoFile('server/prompt-video-poster.js');

    assert.equal(includeFiles.includes('server/prompt-*.js'), true);
    assert.equal(packageJson.dependencies?.['@ffmpeg-installer/ffmpeg'], '^1.1.0');
    assert.match(posterRuntime, /require\('@ffmpeg-installer\/ffmpeg'\)\.path/);
});

test('vercel recovery readiness functions include non-runtime audit assets', () => {
    const config = JSON.parse(readRepoFile('vercel.json'));
    const vercelIgnore = readRepoFile('.vercelignore');
    const requiredGlobParts = [
        'api/_lib/*.js',
        'api/public.js',
        'docs/*.md',
        'js/runtime-supabase-config.js',
        'scripts/*.js',
        'server/api-handlers/**/*.js',
        'supabase/migrations/*.sql'
    ];

    for (const functionName of ['api/admin.js', 'api/public.js']) {
        const includeFiles = String(config.functions?.[functionName]?.includeFiles || '');
        assert.equal(
            includeFiles.length <= 256,
            true,
            `${functionName} includeFiles should remain compatible with Vercel's functions schema`
        );
        for (const globPart of requiredGlobParts) {
            assert.equal(
                includeFiles.includes(globPart),
                true,
                `${functionName} should include ${globPart} for deployed readiness checks`
            );
        }
    }

    assert.equal(config.outputDirectory, '.vercel-static');
    assert.match(vercelIgnore, /!server\/api-handlers\/\*\*/);
    assert.match(vercelIgnore, /!scripts\/\*\.js/);
    assert.match(vercelIgnore, /!docs\/\*\.md/);
    assert.match(vercelIgnore, /!supabase\/migrations\/\*\.sql/);
});
