const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

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

test('NewAPI admin actions expand the nonce contract and keep inbox ordering current', () => {
    const adminMigration = fs.readFileSync(
        path.join(
            REPO_ROOT,
            'supabase/migrations/20260909133000_extend_newapi_support_admin_actions.sql'
        ),
        'utf8'
    );

    for (const action of [
        'admin_conversations',
        'admin_messages',
        'admin_send_message'
    ]) {
        assert.match(adminMigration, new RegExp(`'${action}'`));
    }
    assert.match(
        adminMigration,
        /CREATE OR REPLACE FUNCTION public\.touch_newapi_support_conversation_on_message\(\)[\s\S]*SECURITY DEFINER/
    );
    assert.match(
        adminMigration,
        /AFTER INSERT ON public\.chat_messages[\s\S]*EXECUTE FUNCTION public\.touch_newapi_support_conversation_on_message\(\)/
    );
    assert.match(
        adminMigration,
        /WHERE product = 'newapi'[\s\S]*AND session_id = NEW\.session_id/
    );
});

test('NewAPI administrator unread state records the latest message author', () => {
    const unreadMigration = fs.readFileSync(
        path.join(
            REPO_ROOT,
            'supabase/migrations/20260909140000_add_newapi_support_unread_state.sql'
        ),
        'utf8'
    );

    assert.match(
        unreadMigration,
        /ADD COLUMN IF NOT EXISTS last_message_is_admin boolean/
    );
    assert.match(
        unreadMigration,
        /last_message_is_admin = \([\s\S]*message\.is_admin/
    );
    assert.match(
        unreadMigration,
        /AFTER INSERT ON public\.chat_messages[\s\S]*EXECUTE FUNCTION public\.touch_newapi_support_conversation_on_message\(\)/
    );
});
