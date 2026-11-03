'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const verifierPath = path.resolve(__dirname, '../scripts/verify-supplier-p2g-baseline.js');
const verifier = fs.readFileSync(verifierPath, 'utf8');

test('supplier P2G verifier is pinned to the isolated container and context', () => {
    assert.match(verifier, /const DOCKER_CONTEXT = 'colima-p2g';/);
    assert.match(verifier, /const CONTAINER = 'supabase_db_shop-supplier-p2g-baseline-20261102';/);
    assert.match(verifier, /const VOLUME = 'supabase_db_shop-supplier-p2g-baseline-20261102';/);
    assert.match(verifier, /const HOST_PORT = '55453';/);
    assert.match(verifier, /docker', \['--context', DOCKER_CONTEXT/);
});

test('supplier P2G verifier is read-only and keeps dangerous writes out', () => {
    assert.match(verifier, /BEGIN TRANSACTION READ ONLY/);
    assert.match(verifier, /ROLLBACK;/);
    assert.doesNotMatch(verifier, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\s/iu);
    assert.match(verifier, /import_shop_supplier_draft_v2/);
    assert.match(verifier, /anonExecute/);
    assert.match(verifier, /authenticatedExecute/);
});

