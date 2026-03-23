const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const authSource = fs.readFileSync(
    path.resolve(__dirname, '../supabase-auth-functions.js'),
    'utf8'
);
const injectAuthSource = fs.readFileSync(
    path.resolve(__dirname, '../inject-auth.js'),
    'utf8'
);
const zhLocale = fs.readFileSync(
    path.resolve(__dirname, '../lang/zh.json'),
    'utf8'
);
const enLocale = fs.readFileSync(
    path.resolve(__dirname, '../lang/en.json'),
    'utf8'
);

test('frontend auth flow no longer persists passwords in localStorage', () => {
    assert.equal(authSource.includes("localStorage.setItem('saved_passwords'"), false);
    assert.equal(authSource.includes("localStorage.setItem('remembered_credentials'"), false);
    assert.equal(authSource.includes('password: btoa(password)'), false);
    assert.equal(authSource.includes('btoa(password)'), false);
});

test('frontend auth flow uses the backend login-security endpoint and email-only remember state', () => {
    assert.match(authSource, /\/api\/auth\/login-security/);
    assert.match(authSource, /zaoyoe_remembered_login_email_v1/);
    assert.equal(authSource.includes('remembered_credentials'), true);
    assert.match(injectAuthSource, /记住邮箱/);
});

test('login locale strings describe email-only remembering and IP abuse blocking', () => {
    assert.match(zhLocale, /"rememberMe": "记住邮箱"/);
    assert.match(zhLocale, /"ipBlocked": "当前网络请求过于频繁/);
    assert.match(enLocale, /"rememberMe": "Remember email"/);
    assert.match(enLocale, /"ipBlocked": "Too many requests were sent from this network/);
});
