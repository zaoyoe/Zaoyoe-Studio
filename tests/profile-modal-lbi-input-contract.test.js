const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('profile modal inputs reuse login modal LBI floating notch border structure and logic', () => {
    const templateSource = readRepoFile(path.join('js', 'profile-modal-template.js'));
    const labelInputSource = readRepoFile(path.join('js', 'label-input.js'));
    const i18nSource = readRepoFile(path.join('js', 'i18n.js'));
    const profileModalCss = readRepoFile(path.join('css', 'profile-modal.css'));
    const styleCss = readRepoFile('style.css');

    // 1. Template structure checks
    assert.match(
        templateSource,
        /function buildProfileLbiField\(/,
        'profile modal template should define buildProfileLbiField helper'
    );

    // Verify all 8 security inputs use buildProfileLbiField and proper IDs
    const expectedFieldIds = [
        'desktop_oldPassword',
        'desktop_newPassword',
        'desktop_phoneNumberInput',
        'desktop_phoneCodeInput',
        'mobile_oldPassword',
        'mobile_newPassword',
        'mobile_phoneNumberInput',
        'mobile_phoneCodeInput'
    ];

    for (const fieldId of expectedFieldIds) {
        assert.ok(
            templateSource.includes(`id: '${fieldId}'`),
            `profile modal template should configure ${fieldId} using buildProfileLbiField`
        );
    }

    // Verify inputs do NOT contain native placeholder or data-i18n-placeholder attributes in security panels
    assert.equal(
        templateSource.includes('placeholder="当前密码"'),
        false,
        'security inputs should not have hardcoded placeholder="当前密码" attribute'
    );
    assert.equal(
        templateSource.includes('placeholder="新密码 (至少6位)"'),
        false,
        'security inputs should not have hardcoded placeholder="新密码" attribute'
    );
    assert.equal(
        templateSource.includes('data-i18n-placeholder="security.currentPassword"'),
        false,
        'security inputs should not carry data-i18n-placeholder="security.currentPassword"'
    );
    assert.equal(
        templateSource.includes('data-i18n-placeholder="security.newPassword"'),
        false,
        'security inputs should not carry data-i18n-placeholder="security.newPassword"'
    );

    // 2. CSS theme variables & focus border color parity
    for (const cssContent of [profileModalCss, styleCss]) {
        assert.ok(
            cssContent.includes('--lbi-border: rgba(255, 255, 255, 0.22);'),
            'dark theme should define soft white border rgba(255, 255, 255, 0.22)'
        );
        assert.ok(
            cssContent.includes('--lbi-border-focus: rgba(255, 255, 255, 0.42);'),
            'dark theme should define soft white focus border rgba(255, 255, 255, 0.42)'
        );
        assert.ok(
            cssContent.includes('--lbi-border: rgba(148, 163, 184, 0.45);'),
            'light theme should define subtle grey border rgba(148, 163, 184, 0.45)'
        );
        assert.ok(
            cssContent.includes('--lbi-border-focus: rgba(15, 23, 42, 0.45);'),
            'light theme should define graphite dark grey focus border rgba(15, 23, 42, 0.45)'
        );

        // Verify transparent input overrides
        assert.match(
            cssContent,
            /#profileModal \.lbi-box input[\s\S]*background:\s*transparent !important;[\s\S]*border:\s*none !important;[\s\S]*box-shadow:\s*none !important;/s,
            'profile modal LBI input box must have transparent background and no native border'
        );

        // Verify focus override: no blue glow, no border
        assert.match(
            cssContent,
            /#profileModal \.lbi-box input:focus[\s\S]*border:\s*none !important;[\s\S]*box-shadow:\s*none !important;[\s\S]*background:\s*transparent !important;/s,
            'profile modal LBI input focus must not introduce border or box-shadow glow'
        );

        // Verify placeholder transparency
        assert.match(
            cssContent,
            /#profileModal \.lbi-box input::placeholder[\s\S]*color:\s*transparent !important;[\s\S]*opacity:\s*0 !important;/s,
            'profile modal LBI placeholder must be completely transparent to avoid overlap'
        );

        // Verify letter hop animation
        assert.match(
            cssContent,
            /#profileModal \.lbi\[data-focus="true"\] \.lbi-label span\s*\{[\s\S]*animation:\s*lbi-hop 460ms/s,
            'focused label letters should run the sequential hopping animation'
        );

        // Verify eye button styles
        assert.match(
            cssContent,
            /#profileModal \.lbi-eye/s,
            'profile modal should style the password toggle eye button'
        );
    }

    // 3. LabelInput runtime parity
    assert.match(
        labelInputSource,
        /const eye = root\.querySelector\('\.lbi-eye'\);[\s\S]*if \(eye && !eye\._lbiBound\) \{[\s\S]*eye\._lbiBound = true;/s,
        'bindLbiField should bind click handler to pre-rendered eye toggle buttons'
    );

    assert.match(
        labelInputSource,
        /if \(input\.placeholder\) \{[\s\S]*input\.removeAttribute\('placeholder'\);[\s\S]*\}/s,
        'updateLbiField should strip native placeholder from LBI input elements'
    );

    // 4. i18n safety: do not inject placeholder into LBI inputs
    assert.match(
        i18nSource,
        /if \(el\.closest\('\.lbi'\) \|\| el\.closest\('\.lbi-box'\)\) \{[\s\S]*el\.removeAttribute\('placeholder'\);[\s\S]*return;[\s\S]*\}/s,
        'i18n applyTranslations should avoid populating placeholder on LBI fields'
    );
});
