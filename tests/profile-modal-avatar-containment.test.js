const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function readCssRule(source, selector) {
    const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\}`);
    return source.match(pattern)?.[1] || '';
}

test('profile modal avatar cannot render broken image text outside the circle', () => {
    const template = readRepoFile('js/profile-modal-template.js');
    const styles = readRepoFile('css/profile-modal.css');

    assert.match(
        template,
        /<img id="profileModalAvatarMobile" class="auth-display-none" alt="" aria-hidden="true"\s+decoding="async">/,
        'profile avatar image should start hidden and use an empty alt because the button already has a label'
    );
    assert.equal(
        template.includes('id="profileModalAvatarMobile" src=""'),
        false,
        'profile avatar image should not ship with an empty src that can render broken image text'
    );

    const avatarButtonRule = readCssRule(styles, '#profileModal .profile-mobile-hero-avatar');
    assert.ok(avatarButtonRule.includes('position: relative;'), 'avatar fallback should be positioned against the avatar button');
    assert.ok(avatarButtonRule.includes('box-sizing: border-box;'), 'avatar border should not increase the fixed avatar footprint');
    assert.ok(avatarButtonRule.includes('min-width: 72px;'), 'avatar button should keep a fixed mobile width');
    assert.ok(avatarButtonRule.includes('max-width: 72px;'), 'avatar button should not expand beyond the circle');
    assert.ok(avatarButtonRule.includes('line-height: 0;'), 'avatar button should not expose broken-image text metrics');

    const hiddenImageRule = readCssRule(styles, '#profileModal #profileModalAvatarMobile.auth-display-none');
    assert.ok(hiddenImageRule.includes('display: none !important;'), 'profile modal should hide its own initial avatar image');

    const avatarImageRule = readCssRule(styles, '#profileModal #profileModalAvatarMobile');
    assert.ok(avatarImageRule.includes('max-width: 100%;'), 'avatar image should stay inside the circular button');
    assert.ok(avatarImageRule.includes('max-height: 100%;'), 'avatar image should stay inside the circular button');
    assert.ok(avatarImageRule.includes('color: transparent;'), 'broken image alt text should not be painted');
    assert.ok(avatarImageRule.includes('font-size: 0;'), 'broken image alt text should not affect sizing');
});

test('profile modal scroll surface keeps cards centered without a wide scrollbar gutter', () => {
    const styles = readRepoFile('css/profile-modal.css');

    assert.match(
        styles,
        /#profileModal \.modal-content\.profile-modal \{[\s\S]*width: min\(400px, 90vw\);[\s\S]*box-sizing: border-box;[\s\S]*margin: auto;/,
        'profile modal shell should keep its measured width centered'
    );
    const topbarShellRule = readCssRule(styles, '#profileModal .profile-mobile-topbar-shell');
    assert.ok(
        topbarShellRule.includes('box-sizing: border-box;'),
        'profile modal tab shell should include padding in its width so the tabs stay centered'
    );

    const scrollRule = readCssRule(styles, '#profileModal .profile-modal-scroll');
    assert.ok(scrollRule.includes('box-sizing: border-box;'), 'profile modal scroll padding should not expand the inner surface');
    assert.ok(scrollRule.includes('scrollbar-gutter: auto;'), 'profile modal should not reserve a wide double scrollbar gutter');
    assert.ok(
        scrollRule.includes('scrollbar-width: none !important;'),
        'profile modal scrollbars should not consume layout width inside the centered modal'
    );
    assert.equal(
        scrollRule.includes('scrollbar-gutter: stable both-edges;'),
        false,
        'profile modal should not leave a thick gutter beside the visible scrollbar'
    );
    assert.match(
        styles,
        /#profileModal::-webkit-scrollbar,\s*#profileModal \.profile-modal-scroll::-webkit-scrollbar,\s*#profileModal \.modal-content\.profile-modal::-webkit-scrollbar \{[\s\S]*width: 0 !important;[\s\S]*height: 0 !important;/,
        'profile modal WebKit scrollbars should not reserve a visible track'
    );

    assert.match(
        styles,
        /#profileModal \.profile-mobile-hero-card,\s*#profileModal \.profile-mobile-card,\s*#profileModal \.mobile-security-section \{[\s\S]*box-sizing: border-box;[\s\S]*width: 100%;/,
        'profile modal cards should include padding and borders in their 100% width'
    );
    assert.match(
        styles,
        /@media \(min-width: 769px\) \{[\s\S]*#profileModal \.profile-modal-scroll \{[\s\S]*width: 100%;[\s\S]*margin: 0;[\s\S]*padding: 0 !important;/,
        'desktop profile modal scroller should use the same centered content box as the tab shell and cards'
    );
    assert.equal(
        styles.includes('width: calc(100% + 24px);'),
        false,
        'desktop profile modal should not widen its scroll surface to hide a scrollbar gutter'
    );
    assert.equal(
        styles.includes('margin: 0 -12px;'),
        false,
        'desktop profile modal should not offset its scroll surface with negative margins'
    );
});

test('mobile profile modal shell uses a taller viewport height', () => {
    const styles = readRepoFile('css/profile-modal.css');

    assert.match(
        styles,
        /@media \(max-width: 768px\) \{[\s\S]*#profileModal \.modal-content\.profile-modal \{[\s\S]*height: min\(82svh, calc\(var\(--profile-modal-overlay-height, 100dvh\) - 56px\)\) !important;[\s\S]*max-height: calc\(var\(--profile-modal-overlay-height, 100dvh\) - 48px\) !important;/,
        'mobile profile modal should reserve a taller viewport-driven shell'
    );
    assert.match(
        styles,
        /#profileModal\.active:not\(\.keyboard-active\):not\(\.ios-focus-lock\) \{[\s\S]*align-items: center !important;[\s\S]*justify-content: center !important;/,
        'mobile profile modal should stay vertically centered when no keyboard is active'
    );
    assert.match(
        styles,
        /#profileModal\.active:not\(\.keyboard-active\):not\(\.ios-focus-lock\) \.modal-content\.profile-modal,[\s\S]*#profileModal\.active:not\(\.keyboard-active\):not\(\.ios-focus-lock\):focus-within \.modal-content\.profile-modal \{[\s\S]*top: 0 !important;[\s\S]*height: min\(82svh, calc\(var\(--profile-modal-overlay-height, 100dvh\) - 56px\)\) !important;[\s\S]*margin: auto !important;/,
        'active and focus-within profile modal states should not fall back to bottom-biased positioning'
    );
    assert.equal(
        styles.includes('max-height: min(90svh, calc(100% - 128px)) !important;'),
        false,
        'mobile profile modal should no longer be capped by the short natural-height rule'
    );
});
