const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('engagement auth CTA resolves to register modal flows', () => {
    const chatWidget = readRepoFile('js/components/ChatWidget.js');
    const authRuntime = readRepoFile('supabase-auth-functions.js');
    const engagementAdmin = readRepoFile('js/admin-engagement.js');

    assert.match(chatWidget, /normalizeEngagementAuthView\(view = ''\)/);
    assert.match(chatWidget, /getEngagementAuthViewFromActionUrl\(actionUrl = '', fallbackLabel = '', metadata = \{\}\)/);
    assert.match(chatWidget, /openEngagementAuthView\(view = '', targetUrl = null\)/);
    assert.match(chatWidget, /window\.requestLoginModalOpen\(authView\)/);
    assert.match(chatWidget, /getEngagementAuthViewFromLabel\(fallbackLabel\)/);
    assert.match(chatWidget, /window\.sessionStorage\?\.setItem\('openLoginModalView', authView\)/);

    assert.match(authRuntime, /const pendingLoginModalViewKey = 'openLoginModalView'/);
    assert.match(authRuntime, /sessionStorage\.setItem\(pendingLoginModalViewKey, normalizedView\)/);
    assert.match(authRuntime, /const pendingLoginModalView = sessionStorage\.getItem\('openLoginModalView'\)/);
    assert.match(authRuntime, /requestLoginModalOpen\(pendingLoginModalView \|\| 'login'\)/);

    assert.match(engagementAdmin, /id:\s*'visitor_register_prompt'[\s\S]*actionUrl:\s*'auth:\/\/register'/);
});
