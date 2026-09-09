const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
    path.join(
        __dirname,
        '..',
        'supabase/migrations/20260909_add_newapi_support_gateway.sql'
    ),
    'utf8'
);

test('legacy browser chat policies cannot create or read NewAPI support rows', () => {
    assert.match(
        migration,
        /DROP POLICY IF EXISTS "Users can insert their own chat messages" ON public\.chat_messages;/
    );
    assert.match(
        migration,
        /CREATE POLICY "Users can insert their own chat messages"[\s\S]*COALESCE\(product, 'legacy'\) = 'legacy'/
    );
    assert.match(
        migration,
        /CREATE POLICY "Users can read their own chat messages"[\s\S]*COALESCE\(product, 'legacy'\) = 'legacy'/
    );
    assert.match(
        migration,
        /ALTER TABLE public\.newapi_support_conversations ENABLE ROW LEVEL SECURITY;/
    );
    assert.match(
        migration,
        /ON public\.chat_messages \(product, session_id, client_message_id\)/
    );
});
