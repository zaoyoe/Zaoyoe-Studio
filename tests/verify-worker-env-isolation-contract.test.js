'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const compose = fs.readFileSync(path.join(root, 'deploy/kvm4/docker-compose.verify-server.yml'), 'utf8');
const tgEnvExample = fs.readFileSync(path.join(root, 'server/.env.tg.example'), 'utf8');

function serviceBlock(name) {
    const marker = `  ${name}:\n`;
    const start = compose.indexOf(marker);
    assert.notEqual(start, -1, `missing Compose service ${name}`);
    const contentStart = start + marker.length;
    const nextService = compose.slice(contentStart).search(/^  [a-z0-9-]+:\s*$/m);
    return compose.slice(contentStart, nextService === -1 ? undefined : contentStart + nextService);
}

function environmentBlock(service) {
    const match = service.match(/^    environment:\s*\n((?:^      .*\n|^\n)*)/m);
    assert.ok(match, 'service must define an explicit environment block');
    return match[1];
}

const requiredSecretNames = [
    'TG_REDEMPTION_CODE_PEPPER',
    'TG_REDEMPTION_CODE_ENCRYPTION_KEY',
    'TG_PURCHASE_ZPAY_KEY',
    'GRAMIX_API_KEY'
];

test('shared verify workers explicitly mask Telegram and Gramix secrets from the host env file', () => {
    for (const name of requiredSecretNames) {
        assert.match(tgEnvExample, new RegExp(`^${name}=`, 'm'), `${name} must remain documented in the TG env template`);
    }
    const documentedSecrets = Array.from(tgEnvExample.matchAll(/^((?:TG|GRAMIX)_[A-Z0-9_]*(?:KEY|PEPPER|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)=/gm), (match) => match[1]);
    const isolatedSecrets = new Set([...requiredSecretNames, ...documentedSecrets]);

    for (const serviceName of ['ai-image-worker', 'prompt-import-worker']) {
        const service = serviceBlock(serviceName);
        const environment = environmentBlock(service);
        assert.match(service, /env_file:\s*\n\s*- \.\/\.env/, `${serviceName} should retain its existing shared application configuration`);
        assert.match(environment, /^      TG_REDEMPTION_ENABLED: "false"$/m);
        assert.match(environment, /^      TG_FULFILLMENT_ENABLED: "false"$/m);
        assert.match(environment, /^      TG_PURCHASE_ENABLED: "false"$/m);
        for (const name of isolatedSecrets) {
            assert.match(environment, new RegExp(`^      ${name}: ""$`, 'm'), `${serviceName} must override ${name} with an empty value`);
        }
    }
});

test('verify-server retains TG configuration from the shared env file', () => {
    const service = serviceBlock('verify-server');
    assert.match(service, /env_file:\s*\n\s*- \.\/\.env/);
    const environment = environmentBlock(service);
    assert.doesNotMatch(environment, /^      (?:TG_|GRAMIX_)/m);
});
