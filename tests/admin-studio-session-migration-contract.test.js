'use strict';
// Static release contract only: this file never connects to or executes SQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sql = fs.readFileSync(require.resolve('../supabase/migrations/20261108041927_admin_studio_revocable_sessions.sql'), 'utf8');
const names = ['admin_auth_session_active', 'admin_studio_session_active', 'admin_studio_session_create', 'admin_studio_session_revoke', 'admin_studio_session_discard'];
function definition(schema, name) {
    const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
    assert.ok(match, `${schema}.${name} must exist`); return match[0];
}
test('grant and revocation tables have no direct browser or service-role table ACL and keep RLS enabled', () => {
    assert.match(sql, /^BEGIN;$/m); assert.match(sql, /\nCOMMIT;\s*$/);
    for (const table of ['admin_studio_sessions', 'admin_studio_revoked_sources']) assert.match(sql, new RegExp(`ALTER TABLE private\\.${table} ENABLE ROW LEVEL SECURITY;`));
    assert.match(sql, /REVOKE ALL ON private\.admin_studio_sessions, private\.admin_studio_revoked_sources\s+FROM PUBLIC, anon, authenticated, service_role;/);
    assert.doesNotMatch(sql, /CREATE POLICY|GRANT\s+(?:SELECT|ALL|INSERT|UPDATE|DELETE)\s+ON\b/i);
});
test('all privileged functions are private with fixed search_path and public wrappers use invoker rights', () => {
    assert.equal([...sql.matchAll(/CREATE OR REPLACE FUNCTION /g)].length, 10);
    for (const name of names) {
        const internal = definition('private', name), wrapper = definition('public', name);
        assert.match(internal, /SECURITY DEFINER SET search_path = ''/);
        assert.match(wrapper, /SECURITY INVOKER SET search_path = ''/);
        assert.match(wrapper, new RegExp(`SELECT private\\.${name}\\(`));
        assert.doesNotMatch(wrapper, /SECURITY DEFINER/);
    }
});
test('both function layers revoke browser execution and grant the exact signatures only to service_role', () => {
    const revoke = sql.match(/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC, anon, authenticated;/)?.[0];
    const grant = sql.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/)?.[0];
    assert.ok(revoke); assert.ok(grant);
    const signatures = {
        admin_auth_session_active: 'uuid,uuid', admin_studio_session_active: 'uuid,uuid,timestamptz',
        admin_studio_session_create: 'uuid,uuid,uuid,timestamptz', admin_studio_session_revoke: 'uuid,uuid,uuid', admin_studio_session_discard: 'uuid,uuid'
    };
    for (const schema of ['private', 'public']) for (const name of names) {
        const signature = `${schema}.${name}(${signatures[name]})`; assert.ok(revoke.includes(signature)); assert.ok(grant.includes(signature));
    }
    assert.match(sql, /GRANT USAGE ON SCHEMA private TO service_role;/);
    assert.doesNotMatch(sql, /GRANT[^;]*TO\s+(?:PUBLIC|anon|authenticated)\b/i);
});
test('issuance and source revocation serialize on the same user-owned Auth session and preserve a tombstone', () => {
    const create = definition('private', 'admin_studio_session_create'), revoke = definition('private', 'admin_studio_session_revoke');
    assert.match(create, /FROM auth\.sessions s WHERE s\.id = p_source_session_id AND s\.user_id = p_user_id FOR UPDATE;/);
    assert.match(revoke, /FROM auth\.sessions s WHERE s\.id = source_id AND s\.user_id = p_user_id FOR UPDATE;/);
    assert.ok(create.indexOf('FOR UPDATE;') < create.indexOf('NOT private.admin_auth_session_active('));
    assert.match(create, /IF NOT FOUND OR NOT private\.admin_auth_session_active/);
    assert.ok(revoke.indexOf('FOR UPDATE;') < revoke.indexOf('INSERT INTO private.admin_studio_revoked_sources'));
    assert.match(revoke, /WHERE g\.id = p_id AND g\.user_id = p_user_id/);
    assert.match(revoke, /ON CONFLICT \(source_session_id\) DO NOTHING/);
    assert.match(revoke, /WHERE user_id = p_user_id AND source_session_id = source_id/);
    assert.doesNotMatch(sql, /DELETE FROM private\.admin_studio_revoked_sources/);
});
test('session validation uses live Auth state, revocation and actual clock time with volatile snapshots', () => {
    const source = definition('private', 'admin_auth_session_active'), grant = definition('private', 'admin_studio_session_active');
    for (const fn of [source, grant]) assert.match(fn, /LANGUAGE sql VOLATILE/);
    assert.match(source, /s\.id = p_source_session_id AND s\.user_id = p_user_id/);
    assert.match(source, /s\.not_after IS NULL OR s\.not_after > clock_timestamp\(\)/);
    assert.match(source, /NOT EXISTS \(SELECT 1 FROM private\.admin_studio_revoked_sources/);
    assert.match(grant, /g\.id = p_id AND g\.user_id = p_user_id/);
    assert.match(grant, /g\.expires_at = p_expires_at AND g\.expires_at > clock_timestamp\(\) AND g\.revoked_at IS NULL/);
    assert.match(grant, /private\.admin_auth_session_active\(g\.user_id, g\.source_session_id\)/);
    assert.match(sql, /CHECK \(expires_at > created_at AND expires_at <= created_at \+ interval '1 hour'\)/);
});
