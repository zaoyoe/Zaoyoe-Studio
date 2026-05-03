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

    const bodyStart = source.indexOf('{', start);
    assert.notEqual(bodyStart, -1, `Expected to find function body for ${functionName}`);

    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;

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

    throw new Error(`Failed to extract ${functionName}`);
}

function loadPromptPoetryLanguageRuntime() {
    const source = readRepoFile('prompts-poetry.js');
    const script = [
        'function getCurrentLanguage() { return "en"; }',
        extractFunction(source, 'containsPromptCjkText'),
        extractFunction(source, 'countPromptTextMatches'),
        extractFunction(source, 'isPromptMostlyCjkText'),
        extractFunction(source, 'shouldUsePromptEnglishUnavailableFallback'),
        extractFunction(source, 'getPromptFieldFallback'),
        extractFunction(source, 'resolvePromptLocalizedDataText'),
        'globalThis.__exports = { isPromptMostlyCjkText, resolvePromptLocalizedDataText };'
    ].join('\n\n');

    const context = {
        window: {
            i18n: {
                t(key) {
                    return key === 'gallery.promptUnavailable'
                        ? 'Prompt content is not available in English.'
                        : '';
                }
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(script, context);
    return context.__exports;
}

function loadAdminStudioLanguageRuntime() {
    const source = readRepoFile('admin-studio.js');
    const script = [
        extractFunction(source, 'countAdminPromptTextMatches'),
        extractFunction(source, 'isAdminPromptMostlyCjkText'),
        'globalThis.__exports = { isAdminPromptMostlyCjkText };'
    ].join('\n\n');

    const context = {};
    vm.createContext(context);
    vm.runInContext(script, context);
    return context.__exports;
}

test('prompt detail allows English prompts that include deliberate Chinese on-image labels', () => {
    const { isPromptMostlyCjkText, resolvePromptLocalizedDataText } = loadPromptPoetryLanguageRuntime();
    const mixedEnglishPrompt = [
        'Create a high-resolution anime princess character profile sheet in a soft pastel pink shoujo aesthetic.',
        'Use decorative profile modules and keep all layout text readable.',
        'Top-left section title: “甜美女主” with small English label “Sweet Girl”.',
        'Left section: “角色档案”, “性格标签”, and “兴趣爱好”.',
        'Bottom row: “表情展示” with mini portraits labelled Sweet Smile, Cheerful, Focused, Playful Wink, Caring.',
        'High-resolution polished anime illustration, glossy highlights, soft depth of field, delicate fabric textures.'
    ].join('\n');
    const mostlyChinesePrompt = [
        '创作一张高精度粉色少女角色档案页，整体为梦幻花房草药温室场景。',
        '画面需要包含角色档案、性格标签、兴趣爱好、细节展示和表情展示。',
        '服装是粉色草莓花仙子公主裙，搭配蕾丝、蝴蝶结、花朵、透明丝带和柔和高光。',
        'anime princess character profile sheet, soft pastel pink shoujo aesthetic'
    ].join('\n');

    assert.equal(isPromptMostlyCjkText(mixedEnglishPrompt), false);
    assert.equal(resolvePromptLocalizedDataText(mixedEnglishPrompt, 'prompt_text'), mixedEnglishPrompt);
    assert.equal(isPromptMostlyCjkText(mostlyChinesePrompt), true);
    assert.equal(
        resolvePromptLocalizedDataText(mostlyChinesePrompt, 'prompt_text'),
        'Prompt content is not available in English.'
    );
});

test('admin save language signal seeds mixed English prompt text as English coverage', () => {
    const { isAdminPromptMostlyCjkText } = loadAdminStudioLanguageRuntime();
    const adminSource = readRepoFile('admin-studio.js');
    const adminHtml = readRepoFile('admin-studio.html');
    const promptsHtml = readRepoFile('prompts.html');

    assert.equal(isAdminPromptMostlyCjkText('Create a poster with title “甜美女主” and profile module labels.'), false);
    assert.equal(isAdminPromptMostlyCjkText('创作粉色角色档案页，包含角色档案、性格标签和兴趣爱好。anime poster'), true);
    assert.equal(adminSource.includes('const promptTextLooksChinese = isAdminPromptMostlyCjkText(promptData.prompt || \'\');'), true);
    assert.equal(adminHtml.includes('promptLangSignal=20260503_PROMPT_LANG_SIGNAL_1'), true);
    assert.equal(promptsHtml.includes('promptLangSignal=20260503_PROMPT_LANG_SIGNAL_1'), true);
});
