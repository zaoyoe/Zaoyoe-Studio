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
    const setToastContentSource = extractFunction(source, 'setToastContent');

    const context = {
        document: {
            createElement(tag) {
                return {
                    tagName: tag,
                    className: '',
                    textContent: ''
                };
            }
        }
    };

    vm.runInNewContext(`${setToastContentSource}; globalThis.setToastContent = setToastContent;`, context);

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
    assert.equal(toast.children[1].tagName, 'span');
    assert.equal(toast.children[1].textContent, '<h1>Bad gateway Error code 502</h1>');
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

test('vercel admin function gets an explicit longer max duration', () => {
    const config = JSON.parse(readRepoFile('vercel.json'));

    assert.equal(config.functions['api/admin.js'].maxDuration, 60);
});
