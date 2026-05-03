const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('gallery manage edit action gives immediate loading feedback', () => {
    const adminStudioSource = readRepoFile('admin-studio.js');
    const adminStudioCss = readRepoFile('admin-studio.css');

    const scriptMarkers = [
        'function setAdminPromptEditFeedback(promptId = \'\', active = false)',
        'card.classList.toggle(\'admin-card--editing\', active);',
        'button.classList.add(\'is-loading\');',
        'button.innerHTML = \'<i class="fas fa-spinner fa-spin"></i>\';',
        'hoverEdit.setAttribute(\'data-prompt-edit-id\', String(prompt.id || \'\'));',
        'editBtn.setAttribute(\'data-prompt-edit-id\', String(prompt.id || \'\'));',
        'setAdminPromptEditFeedback(normalizedId, true);',
        'setAdminPromptEditFeedback(normalizedId, false);'
    ];

    for (const marker of scriptMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.admin-card.admin-card--editing',
        '.hover-action-btn.is-loading',
        '.admin-action-btn.is-loading',
        'cursor: progress;'
    ];

    for (const marker of cssMarkers) {
        assert.equal(adminStudioCss.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }
});

test('admin studio delegated actions share visible pressed and running feedback', () => {
    const adminStudioSource = readRepoFile('admin-studio.js');
    const adminStudioCss = readRepoFile('admin-studio.css');

    const scriptMarkers = [
        'function pulseAdminStudioDelegatedAction(actionEl)',
        "actionEl.classList.add('is-pressed', 'is-click-feedback');",
        "case 'gallery-open-prompt-comments':",
        "runAdminStudioActionFeedback(actionEl, () => openAdminStudioPromptCommentsContext({",
        "case 'gallery-open-prompt-analytics':",
        "runAdminStudioActionFeedback(actionEl, () => openAdminStudioPromptAnalyticsContext(",
        "case 'gallery-add-prompt-homepage':",
        "runAdminStudioActionFeedback(actionEl, () => window.addPromptToHomepagePromptsSection?.(",
        "case 'settings-open-points-catalog':",
        "runAdminStudioActionFeedback(actionEl, async () => {"
    ];

    for (const marker of scriptMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const cssMarkers = [
        ':where(button,',
        '[data-admin-action].is-click-feedback',
        '[data-admin-action].is-pressed:not([data-action-feedback-state])',
        '[data-admin-action].is-running:not([data-action-feedback-state])',
        '@keyframes adminDelegatedActionClickFeedback'
    ];

    for (const marker of cssMarkers) {
        assert.equal(adminStudioCss.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }
});
