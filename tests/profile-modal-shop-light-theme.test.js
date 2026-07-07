const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop profile security reuses the homepage light-theme profile modal contract', () => {
    const profileModalStyles = readRepoFile(path.join('css', 'profile-modal.css'));
    const loaderSource = readRepoFile(path.join('js', 'profile-modal-loader.js'));
    const shopSource = readRepoFile('shop.html');

    assert.equal(
        profileModalStyles.includes('20260707_PROFILE_MODAL_DARK_INPUT_GRAY_1'),
        true,
        'profile modal stylesheet should carry the dark input gray cache marker'
    );

    assert.match(
        profileModalStyles,
        /#profileModal \.profile-mobile-inline-input,[\s\S]*#profileModal \.security-input\.glass-input \{[\s\S]*border: 1px solid rgba\(255, 255, 255, 0\.12\);[\s\S]*background: rgba\(31, 31, 31, 0\.94\) !important;/s,
        'dark profile inputs should use the shared gray-black base'
    );
    assert.match(
        profileModalStyles,
        /#profileModal \.profile-mobile-inline-input:focus,[\s\S]*#profileModal \.security-input\.glass-input:focus \{[\s\S]*background: rgba\(42, 42, 42, 0\.98\) !important;/s,
        'focused dark profile inputs should stay in the gray family'
    );

    for (const selector of [
        'html:not([data-theme="dark"]) #profileModal .profile-security-desktop-item:hover',
        'html:not([data-theme="dark"]) #profileModal .profile-security-desktop-indicator',
        'html:not([data-theme="dark"]) #profileModal .security-input::placeholder',
        'html:not([data-theme="dark"]) #profileModal .security-input::-webkit-input-placeholder'
    ]) {
        assert.equal(
            profileModalStyles.includes(selector),
            true,
            `css/profile-modal.css should style ${selector} for non-dark public pages`
        );
    }

    assert.match(
        profileModalStyles,
        /html:not\(\[data-theme="dark"\]\) #profileModal :is\(\s+\.mobile-security-section,\s+\.profile-security-desktop-content\s+\) \{[\s\S]*background: rgba\(255, 255, 255, 0\.98\);[\s\S]*border-color: rgba\(148, 163, 184, 0\.18\);/s,
        'security panels should use the same light surface material as the homepage modal'
    );
    assert.match(
        profileModalStyles,
        /html:not\(\[data-theme="dark"\]\) #profileModal :is\(\s+\.security-input,\s+\.security-input\.glass-input\s+\) \{[\s\S]*background: #ffffff !important;[\s\S]*color: #0f172a !important;/s,
        'security inputs should be explicitly readable on light shop surfaces'
    );
    assert.match(
        profileModalStyles,
        /@media \(max-width: 768px\) \{[\s\S]*html:not\(\[data-theme="dark"\]\) #profileModal \.mobile-security-section \{[\s\S]*background: rgba\(255, 255, 255, 0\.98\) !important;[\s\S]*border: 1px solid rgba\(148, 163, 184, 0\.18\) !important;/s,
        'mobile security sections should override legacy narrow-window dark rules with light-theme important styles'
    );
    assert.match(
        profileModalStyles,
        /html:not\(\[data-theme="dark"\]\) #profileModal \.mobile-security-layout \.security-mobile-code-btn \{[\s\S]*background: rgba\(248, 250, 252, 0\.98\) !important;[\s\S]*color: #334155 !important;/s,
        'mobile security code buttons should also override legacy dark important styles'
    );

    assert.equal(
        loaderSource.includes('css/profile-modal.css?v=20260707_PROFILE_MODAL_DARK_INPUT_GRAY_1'),
        true,
        'profile modal loader should cache-bust the light-theme security stylesheet'
    );
    assert.equal(
        shopSource.includes('./js/profile-modal-loader.js?v=20260707_PROFILE_MODAL_DARK_INPUT_GRAY_1'),
        true,
        'shop.html should load the updated shared profile modal bootstrap'
    );
});
