const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('mobile profile security inputs only request iOS focus after a tap gesture', () => {
    const source = readRepoFile('supabase-auth-functions.js');
    const touchStartMatch = source.match(/input\.addEventListener\('touchstart'[\s\S]*?\}, \{ passive: true \}\);/);
    const touchMoveMatch = source.match(/input\.addEventListener\('touchmove'[\s\S]*?\}, \{ passive: false \}\);/);

    assert.ok(touchStartMatch, 'profile modal inputs should bind a touchstart handler');
    assert.ok(touchMoveMatch, 'profile modal inputs should bind a touchmove handler');

    assert.equal(
        touchStartMatch[0].includes('markProfileModalFocusTransfer(input)'),
        false,
        'touchstart should not pre-arm keyboard layout for scroll gestures over inputs'
    );

    assert.ok(
        touchMoveMatch[0].indexOf("gesture.mode = 'scroll';") <
            touchMoveMatch[0].indexOf('document.activeElement !== input'),
        'touchmove should classify scroll gestures before checking active input focus'
    );

    assert.equal(
        source.includes('const movedDistance = Math.hypot(endX - gesture.startX, endY - gesture.startY);'),
        true,
        'touchend should measure finger movement before requesting focus'
    );
    assert.equal(
        source.includes('const scrollMoved = scrollHost ? Math.abs(scrollHost.scrollTop - gesture.startScrollTop) : 0;'),
        true,
        'touchend should reject focus when the modal scroller moved'
    );
    assert.equal(
        source.includes("const isTap = gesture.mode === 'pending' && movedDistance < 8 && scrollMoved < 3;"),
        true,
        'programmatic input focus should be gated to tap-sized gestures'
    );
    assert.match(
        source,
        /if \(isProfileModalIOSMode\(\) && isTap && document\.activeElement !== input\) \{[\s\S]*?markProfileModalFocusTransfer\(input\);[\s\S]*?input\.focus/,
        'iOS fallback focus should only run after the tap guard passes'
    );
});
