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

test('gallery preview grid exposes click-to-preview affordances and delegated crop controls', () => {
    const adminSource = readRepoFile('admin-studio.js');
    const adminCss = readRepoFile('admin-studio.css');

    assert.equal(
        adminSource.includes('renderPreviewGridItems(\n                currentEditingPromptImageUrls.map((url) => ({ url })),'),
        true,
        'edit prompt should reuse the shared preview grid renderer for existing images'
    );
    assert.equal(
        adminSource.includes('data-admin-action="ai-crop-preview"'),
        true,
        'preview grid should render explicit crop controls'
    );
    assert.equal(
        adminSource.includes("case 'ai-crop-preview':"),
        true,
        'delegated click handling should support crop controls'
    );
    assert.equal(
        adminSource.includes("openLightbox(previewItem.querySelector('img')?.src);"),
        true,
        'preview items should open the lightbox when clicked'
    );
    assert.equal(
        adminCss.includes('.preview-item:focus-visible'),
        true,
        'preview items should expose a visible keyboard focus style'
    );
    assert.equal(
        adminCss.includes('.preview-item .preview-action-btn'),
        true,
        'preview items should style explicit preview actions'
    );
});

test('removeFile keeps edit-mode retained image urls in sync with preview removals', () => {
    const adminSource = readRepoFile('admin-studio.js');
    const previewGrid = { innerHTML: '' };
    let updateAnalyzeButtonCalls = 0;

    const script = [
        'let currentMode = "edit";',
        'let uploadedFiles = [{ dataUrl: "data:a" }, { dataUrl: "data:b" }];',
        'let currentEditingPromptImageUrls = ["https://example.com/a.webp", "https://example.com/b.webp"];',
        extractFunction(adminSource, 'buildPreviewGridMarkup'),
        extractFunction(adminSource, 'renderPreviewGridItems'),
        extractFunction(adminSource, 'renderPreviews'),
        extractFunction(adminSource, 'removeFile'),
        'globalThis.__previewExports = { removeFile, getUploadedFiles: () => uploadedFiles, getEditingUrls: () => currentEditingPromptImageUrls };'
    ].join('\n\n');

    const context = {
        document: {
            getElementById(id) {
                if (id === 'previewGrid') {
                    return previewGrid;
                }
                return null;
            }
        },
        updateAnalyzeButton() {
            updateAnalyzeButtonCalls += 1;
        },
        globalThis: null
    };

    context.globalThis = context;
    vm.runInNewContext(script, context);

    context.__previewExports.removeFile(0);
    const uploadedFiles = JSON.parse(JSON.stringify(context.__previewExports.getUploadedFiles()));
    const editingUrls = JSON.parse(JSON.stringify(context.__previewExports.getEditingUrls()));

    assert.deepEqual(
        uploadedFiles,
        [{ dataUrl: 'data:b' }],
        'removeFile should delete the uploaded preview entry'
    );
    assert.deepEqual(
        editingUrls,
        ['https://example.com/b.webp'],
        'removeFile should keep retained edit-mode urls aligned with remaining previews'
    );
    assert.equal(
        previewGrid.innerHTML.includes('data-admin-action="ai-crop-preview"'),
        true,
        'rendered previews should preserve explicit crop controls after removal'
    );
    assert.equal(updateAnalyzeButtonCalls, 1, 'removeFile should still refresh analyze button state');
});
