const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function sliceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `Expected ${startMarker}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `Expected ${endMarker}`);
    return source.slice(start, end);
}

test('points leaderboard avatars use escaped urls and local initials fallback', () => {
    const panelSource = readRepoFile('js/admin-analytics-panel-loaders.js');
    const cssSource = readRepoFile('admin-studio.css');
    const htmlSource = readRepoFile('admin-studio.html');
    const avatarRenderer = sliceBetween(
        panelSource,
        'function renderPointsLeaderboardAvatar(user = {}) {',
        'async function loadPointsStats'
    );
    const leaderboardLoader = sliceBetween(
        panelSource,
        'async function loadPointsLeaderboard() {',
        'async function loadRedemptionFunnel'
    );

    for (const marker of [
        'function normalizeAnalyticsAvatarImageUrl(value = \'\') {',
        'function getAnalyticsAvatarInitials(label = \'\') {',
        'function bindPointsLeaderboardAvatarFallbacks(container = null) {',
        '/^(https?:|blob:|\\/|\\.\\.?\\/)/i.test(raw)',
        'data-analytics-avatar-fallback',
        'leaderboard-avatar-shell--fallback',
        'referrerpolicy="no-referrer"',
        'src="${escapeHtml(avatarUrl)}"'
    ]) {
        assert.equal(panelSource.includes(marker), true, `panel loader should contain ${marker}`);
    }

    assert.equal(
        avatarRenderer.includes('api.dicebear.com'),
        false,
        'points leaderboard avatar fallback should not depend on an external avatar service'
    );
    assert.equal(
        leaderboardLoader.includes('bindPointsLeaderboardAvatarFallbacks(container);'),
        true,
        'points leaderboard should bind delegated avatar error fallback before rendering rows'
    );
    assert.equal(
        leaderboardLoader.includes('${renderPointsLeaderboardAvatar(user)}'),
        true,
        'points leaderboard rows should render through the hardened avatar helper'
    );

    for (const marker of [
        '#pointsLeaderboard .leaderboard-avatar-shell {',
        '#pointsLeaderboard .leaderboard-avatar-image {',
        '#pointsLeaderboard .leaderboard-avatar-shell--fallback .leaderboard-avatar-image {'
    ]) {
        assert.equal(cssSource.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    assert.equal(
        htmlSource.includes('admin-studio.css?v=20260420_POINTS_LEADERBOARD_AVATAR_1'),
        true,
        'admin-studio.html should bump the stylesheet version for immutable cache safety'
    );
    assert.equal(
        htmlSource.includes('js/admin-analytics-panel-loaders.js?v=20260420_POINTS_LEADERBOARD_AVATAR_1'),
        true,
        'admin-studio.html should bump the panel loader version for immutable cache safety'
    );
});
