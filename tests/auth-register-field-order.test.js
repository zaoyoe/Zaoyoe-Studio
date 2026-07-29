const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const injectAuthSource = fs.readFileSync(path.resolve(__dirname, '../inject-auth.js'), 'utf8');

test('registration renders password before verification code', () => {
    const registerFormStart = injectAuthSource.indexOf('<form id="registerForm"');
    const registerFormEnd = injectAuthSource.indexOf('</form>', registerFormStart);
    const registerFormSource = injectAuthSource.slice(registerFormStart, registerFormEnd);
    const usernameIndex = registerFormSource.indexOf("id: 'reg-username'");
    const emailIndex = registerFormSource.indexOf("id: 'reg-email'");
    const passwordIndex = registerFormSource.indexOf("id: 'reg-password'");
    const codeIndex = registerFormSource.indexOf("id: 'reg-code'");

    assert.notEqual(registerFormStart, -1, 'register form should exist');
    assert.notEqual(registerFormEnd, -1, 'register form should close');
    assert.ok(usernameIndex < emailIndex, 'username should render before email');
    assert.ok(emailIndex < passwordIndex, 'email should render before password');
    assert.ok(passwordIndex < codeIndex, 'password should render before verification code');
});
