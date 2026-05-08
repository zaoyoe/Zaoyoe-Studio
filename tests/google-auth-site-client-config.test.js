const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.resolve(__dirname, '../supabase-auth-functions.js'),
    'utf8'
);

test('google auth flow resolves client ids dynamically per site', () => {
    assert.match(source, /function resolveGoogleAuthConfig\(/);
    assert.match(source, /window\.getZaoyoeGoogleAuthConfig/);
    assert.match(source, /function resolveGoogleClientId\(/);
    assert.match(source, /const clientId = resolveGoogleClientId\(\);/);
    assert.doesNotMatch(source, /const GOOGLE_CLIENT_ID =/);
});
