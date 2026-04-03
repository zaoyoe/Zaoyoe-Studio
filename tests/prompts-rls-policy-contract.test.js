const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompts schema restricts writes to service role only', () => {
    const promptsSchemaSource = readRepoFile('supabase/prompts-schema.sql');
    const rootSchemaSource = readRepoFile('supabase/schema.sql');

    assert.equal(
        promptsSchemaSource.includes('CREATE POLICY "Authenticated insert"'),
        false,
        'supabase/prompts-schema.sql should not grant prompts inserts to all authenticated users'
    );
    assert.equal(
        promptsSchemaSource.includes('CREATE POLICY "Authenticated update"'),
        false,
        'supabase/prompts-schema.sql should not grant prompts updates to all authenticated users'
    );
    assert.match(
        promptsSchemaSource,
        /CREATE POLICY "Service role can manage prompts\." ON prompts[\s\S]+WITH CHECK \(auth\.role\(\) = 'service_role'\);/,
        'supabase/prompts-schema.sql should define a service-role-only prompts write policy'
    );
    assert.match(
        rootSchemaSource,
        /create policy "Service role can manage prompts\."[\s\S]+with check \( auth\.role\(\) = 'service_role' \);/i,
        'supabase/schema.sql should define a service-role-only prompts write policy with an explicit WITH CHECK clause'
    );
});

test('prompts RLS hardening migration removes legacy authenticated write policies', () => {
    const migrationSource = readRepoFile('supabase/migrations/20260402_harden_prompts_rls.sql');

    assert.match(
        migrationSource,
        /DROP POLICY IF EXISTS "Authenticated insert" ON public\.prompts;/,
        'prompts hardening migration should drop the legacy authenticated insert policy'
    );
    assert.match(
        migrationSource,
        /DROP POLICY IF EXISTS "Authenticated update" ON public\.prompts;/,
        'prompts hardening migration should drop the legacy authenticated update policy'
    );
    assert.match(
        migrationSource,
        /CREATE POLICY "Service role can manage prompts\."[\s\S]+WITH CHECK \(auth\.role\(\) = 'service_role'\);/,
        'prompts hardening migration should recreate the service-role-only prompts write policy'
    );
});
