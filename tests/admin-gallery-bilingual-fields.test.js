const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('gallery admin form exposes explicit bilingual editing controls', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const adminStyles = readRepoFile('admin-studio.css');

    const htmlMarkers = [
        'id="promptBilingualToggleBtn"',
        'id="promptBilingualToggleLabel"',
        'id="promptBilingualFields"',
        'id="promptTitleZh"',
        'id="promptTitleEn"',
        'id="promptDescriptionZh"',
        'id="promptDescriptionEn"',
        'id="promptTextZh"',
        'id="promptTextEn"',
        '主字段仍按当前工作流保存；这里用于显式校对和覆盖 `zh / en` 双语文案，避免继续黑盒翻译。'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const styleMarkers = [
        '.gallery-bilingual-panel',
        '.gallery-bilingual-toggle',
        '.gallery-bilingual-toggle.is-active',
        '.gallery-bilingual-fields',
        '.gallery-bilingual-grid',
        '.gallery-bilingual-grid .form-group--full',
        '.admin-card-badges',
        '.admin-card-badge--global',
        '.admin-card-badge--lang.is-ready',
        '.admin-card-subtitle',
        '.admin-card-site-metrics',
        '.admin-card-site-metric',
        '.admin-card-site-metric.is-current'
    ];

    for (const marker of styleMarkers) {
        assert.equal(adminStyles.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }
});

test('gallery admin runtime populates and saves bilingual fields explicitly', () => {
    const adminSource = readRepoFile('admin-studio.js');

    const requiredMarkers = [
        'function setPromptBilingualFieldsOpen(open)',
        'function initPromptBilingualFieldToggle()',
        'function hasPromptBilingualContent(data = {})',
        'function populatePromptBilingualFields(data = {})',
        'function collectPromptBilingualFieldValues()',
        'function resetPromptBilingualFields()',
        'function getPromptLanguageCoverage(prompt = {})',
        'function normalizePromptSiteMetrics(prompt = {})',
        'function buildPromptSiteMetricElement(siteLabel, siteMetrics, currentSite = \'all\')',
        "document.getElementById('promptText').value = data.prompt_text || data.prompt || data.prompt_suggestion_en || data.prompt_suggestion_zh || '';",
        "document.getElementById('promptDescription').value = data.description || data.description_en || data.description_zh || '';",
        "document.getElementById('promptTitleZh').value = data.title_zh || '';",
        "document.getElementById('promptTextEn').value = data.prompt_text_en || '';",
        "setPromptBilingualFieldsOpen(hasPromptBilingualContent({",
        "globalBadge.textContent = 'Global Asset';",
        "zhBadge.textContent = 'ZH';",
        "enBadge.textContent = 'EN';",
        "subtitle.className = 'admin-card-subtitle';",
        "metrics.className = 'admin-card-site-metrics';",
        "metricCounts.textContent = `解锁 ${siteMetrics.unlock_count} · 评论 ${siteMetrics.comment_count}`;",
        'const bilingualValues = collectPromptBilingualFieldValues();',
        'promptData.title_en = promptData.title_en || analysisResult.title_en || analysisResult.title || title;',
        'const promptPayload = {',
        "title_en: promptData.title_en || '',",
        "prompt_text_zh: promptData.prompt_text_zh || ''",
        "action: 'update',",
        "action: 'create',",
        'await mutateAdminPrompt({',
        'resetPromptBilingualFields();'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(adminSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }
});
