const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function extractFunction(source, functionName) {
    const asyncMarker = `async function ${functionName}(`;
    const plainMarker = `function ${functionName}(`;
    const start = source.indexOf(asyncMarker) !== -1
        ? source.indexOf(asyncMarker)
        : source.indexOf(plainMarker);
    assert.notEqual(start, -1, `Expected to find ${functionName}`);

    const bodyStart = source.indexOf('{', start);
    assert.notEqual(bodyStart, -1, `Expected function body for ${functionName}`);

    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (inSingle) {
            if (char === '\'') inSingle = false;
            continue;
        }

        if (inDouble) {
            if (char === '"') inDouble = false;
            continue;
        }

        if (inTemplate) {
            if (char === '`') inTemplate = false;
            continue;
        }

        if (char === '\'') {
            inSingle = true;
            continue;
        }

        if (char === '"') {
            inDouble = true;
            continue;
        }

        if (char === '`') {
            inTemplate = true;
            continue;
        }

        if (char === '{') {
            depth += 1;
            continue;
        }

        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Failed to extract function ${functionName}`);
}

test('admin runtime prefers the admin studio cookie session before bearer fallback across client and server helpers', () => {
    const adminApiSource = readRepoFile('js/admin-api-auth.js');
    const adminAccessSource = readRepoFile('js/admin-access.js');
    const adminAiSource = readRepoFile('js/admin-ai.js');
    const adminConfigSource = readRepoFile('admin-config.js');
    const paymentsSource = readRepoFile('js/admin-payments.js');
    const adminServerSource = readRepoFile('api/_lib/admin.js');

    assert.equal(
        adminAccessSource.includes('function hasActiveAdminStudioSession(userId = \'\') {'),
        true,
        'js/admin-access.js should expose the cached admin studio session status helper'
    );
    assert.equal(
        adminApiSource.includes('function hasActiveAdminStudioSession() {'),
        true,
        'js/admin-api-auth.js should detect active admin studio cookie sessions before adding bearer tokens'
    );
    assert.equal(
        adminAiSource.includes('window.AdminApi?.buildRequestInit'),
        true,
        'js/admin-ai.js should reuse the shared admin request init so AI admin routes also prefer cookie sessions'
    );
    assert.equal(
        adminConfigSource.includes('window.AdminApi?.buildRequestInit'),
        true,
        'admin-config.js should reuse the shared admin request init for settings routes'
    );
    assert.equal(
        paymentsSource.includes('window.AdminApi?.buildRequestInit'),
        true,
        'js/admin-payments.js should reuse the shared admin request init for admin payment routes'
    );

    const getAuthenticatedUserSource = extractFunction(adminServerSource, 'getAuthenticatedUser');
    const cookieLookupIndex = getAuthenticatedUserSource.indexOf('cookiePayload = await getAdminStudioCookiePayload(req);');
    const bearerIndex = getAuthenticatedUserSource.indexOf('const token = getBearerToken(req);');
    assert.notEqual(cookieLookupIndex, -1, 'api/_lib/admin.js should load the admin studio cookie payload');
    assert.notEqual(bearerIndex, -1, 'api/_lib/admin.js should still support bearer fallback');
    assert.ok(
        cookieLookupIndex < bearerIndex,
        'api/_lib/admin.js should attempt admin studio cookie auth before bearer fallback'
    );
});

test('high-risk admin actions retain audit log coverage across settings, refunds, bans, and batch deletes', () => {
    const markers = [
        ['server/api-handlers/admin/settings/codex-config.js', "actionType: 'admin.codex_config.upsert'"],
        ['server/api-handlers/admin/settings/gemini-key.js', "actionType: 'admin.gemini_key.upsert'"],
        ['server/api-handlers/admin/settings/payment-channels.js', "actionType: 'admin.payment_channels.upsert'"],
        ['server/api-handlers/admin/settings/payment-channels.js', "actionType: 'admin.payment_channels.secret.delete'"],
        ['server/api-handlers/admin/settings/ops-alerts.js', "actionType: 'admin.ops_alerts.upsert'"],
        ['server/api-handlers/admin/settings/ops-alerts.js', 'temporary_mute_until'],
        ['server/api-handlers/admin/payments/shop-refund.js', "actionType: 'shop.order.refund'"],
        ['server/api-handlers/admin/users/blocks.js', "actionType: 'BAN_USER'"],
        ['server/api-handlers/admin/users/blocks.js', "actionType: 'UNBAN_USER'"],
        ['server/api-handlers/admin/prompts/manage.js', "actionType: ids.length > 1 ? 'prompt.delete_many' : 'prompt.delete'"],
        ['server/api-handlers/admin/shop/mutate.js', "actionType: 'shop.product.batch_delete'"],
        ['server/api-handlers/admin/shop/mutate.js', "actionType: 'shop.inventory.batch_delete'"],
        ['server/api-handlers/admin/points/manage.js', "actionType: 'batch.delete'"],
        ['server/api-handlers/admin/comments/moderate.js', "actionType: 'comments.delete'"]
    ];

    for (const [relativePath, marker] of markers) {
        const source = readRepoFile(relativePath);
        assert.equal(source.includes('writeAdminAuditLog({'), true, `${relativePath} should write admin audit logs`);
        assert.equal(source.includes(marker), true, `${relativePath} should contain ${marker}`);
    }
});
