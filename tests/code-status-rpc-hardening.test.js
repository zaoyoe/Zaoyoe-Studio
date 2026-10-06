const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(__dirname, '../supabase/migrations/20261006_harden_code_status_rpc.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

test('support code status uses a separate minimized RPC and preserves the admin lookup RPC', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_check_support_code_status\(\s*p_code VARCHAR\s*\)/s);
    assert.match(migration, /SECURITY DEFINER\s+SET search_path = public, pg_temp/s);
    assert.match(migration, /v_input TEXT := UPPER\(TRIM\(COALESCE\(p_code, ''\)\)\)/);
    assert.match(migration, /v_input !~ '\^ZY-\[A-Z0-9\]\+\(-\[A-Z0-9\]\+\)\+\$'/);
    assert.match(migration, /v_input !~ '\[A-Z\]'/);
    assert.match(migration, /'package_name'/);
    assert.match(migration, /'points'/);
    assert.doesNotMatch(migration, /'external_order_id'/);
    assert.doesNotMatch(migration, /'used_by'/);
    assert.doesNotMatch(migration, /'revoked_by'/);
    assert.doesNotMatch(migration, /'batch_id'/);
    assert.match(
        migration,
        /REVOKE ALL ON FUNCTION public\.fn_check_support_code_status\(VARCHAR\) FROM PUBLIC, anon, authenticated;\s*GRANT EXECUTE ON FUNCTION public\.fn_check_support_code_status\(VARCHAR\) TO service_role;/s
    );
    assert.match(
        migration,
        /REVOKE ALL ON FUNCTION public\.fn_check_code_status\(VARCHAR\) FROM PUBLIC, anon, authenticated;\s*GRANT EXECUTE ON FUNCTION public\.fn_check_code_status\(VARCHAR\) TO service_role;/s
    );
    assert.doesNotMatch(
        migration,
        /CREATE OR REPLACE FUNCTION public\.fn_check_code_status\(/,
        'the admin RPC must not be narrowed by the support migration'
    );
});
