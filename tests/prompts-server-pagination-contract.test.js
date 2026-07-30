const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('public prompt gallery uses bounded keyset pages and capped retries', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsHtml = readRepoFile('prompts.html');

    [
        'const PROMPT_SUPABASE_PAGE_SIZE = 40;',
        'const PROMPT_SUPABASE_SEARCH_RESULT_LIMIT = 80;',
        'const PROMPT_SUPABASE_MAX_AUTO_RETRIES = 2;',
        'const PROMPT_SUPABASE_RETRY_BASE_DELAY_MS = 1400;',
        "function buildPromptSupabaseSummaryQuery(selectFields, cursor = null) {",
        ".order('created_at', { ascending: false })",
        ".order('id', { ascending: false })",
        '.limit(PROMPT_SUPABASE_PAGE_SIZE);',
        'created_at.lt.${cursor.createdAt}',
        'id.lt.${cursor.id}',
        'async function loadNextPromptSupabasePage() {',
        'function appendPromptDataset(nextPrompts = []) {',
        'function appendPromptGalleryPageItems(items = []) {',
        'function retryPromptSupabasePageLoad() {',
        "window.supabaseClient.rpc('search_public_prompts'",
        'function discardPromptSupabaseSearchOnlyItems() {',
        'async function hydrateFeaturedBannerDescription(featured = {}) {',
        "setPromptGalleryLoadStatus('error'",
        'attempt > PROMPT_SUPABASE_MAX_AUTO_RETRIES',
        'PROMPT_SUPABASE_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1))'
    ].forEach((marker) => {
        assert.equal(promptsSource.includes(marker), true, `prompts runtime should include ${marker}`);
    });

    assert.equal(
        promptsSource.includes(".order('created_at', { ascending: false });"),
        false,
        'first paint must not retain the old unbounded table query'
    );
    assert.equal(
        promptsHtml.includes('id="promptGalleryLoadStatus"')
            && promptsHtml.includes('id="promptGalleryLoadRetry"'),
        true,
        'gallery should expose a recoverable load-error state'
    );
    assert.equal(
        promptsHtml.includes('serverPaging=20260729_PROMPTS_SERVER_PAGING_1'),
        true,
        'pagination runtime and styles should be cache-busted together'
    );
});

test('prompt gallery migration limits public rows and indexes the keyset cursor', () => {
    const migrationSource = readRepoFile('supabase/migrations/20260729_optimize_public_prompt_gallery_pagination.sql');

    assert.equal(
        (migrationSource.match(/^BEGIN;$/gm) || []).length >= 7,
        true,
        'live migration should split DDL, backfill, indexes, and policy publication into short transactions'
    );
    assert.match(
        migrationSource,
        /SET LOCAL lock_timeout = '15s';[\s\S]*LOCK TABLE public\.prompts IN ACCESS EXCLUSIVE MODE;/,
        'prompt DDL should acquire the table lock first and stop waiting after a bounded interval'
    );
    assert.match(
        migrationSource,
        /WITH desired_gallery_values AS MATERIALIZED[\s\S]*IS DISTINCT FROM desired\.gallery_search_text/,
        'migration reruns should avoid rewriting already synchronized prompt rows'
    );

    assert.match(
        migrationSource,
        /ADD COLUMN IF NOT EXISTS gallery_status TEXT NOT NULL DEFAULT 'published'/,
        'migration should materialize gallery visibility instead of filtering JSON in every request'
    );
    assert.match(
        migrationSource,
        /CREATE TRIGGER trigger_sync_prompt_gallery_status[\s\S]*BEFORE INSERT OR UPDATE OF[\s\S]*ai_tags/,
        'gallery visibility and search text should stay synchronized with prompt writes'
    );
    assert.match(
        migrationSource,
        /CREATE POLICY "Published prompts are publicly readable"[\s\S]*USING \(gallery_status = 'published'\);/,
        'anonymous and authenticated users should only read published prompts'
    );
    assert.match(
        migrationSource,
        /CREATE INDEX IF NOT EXISTS idx_prompts_public_gallery_cursor[\s\S]*created_at DESC, id DESC[\s\S]*WHERE gallery_status = 'published'/,
        'public keyset pages should use a matching partial index'
    );
    assert.match(
        migrationSource,
        /CREATE INDEX IF NOT EXISTS idx_prompts_public_gallery_search[\s\S]*gallery_search_text extensions\.gin_trgm_ops/,
        'public search should use an indexed materialized search document'
    );
    assert.match(
        migrationSource,
        /CREATE OR REPLACE FUNCTION public\.search_public_prompts[\s\S]*SECURITY INVOKER[\s\S]*LIMIT LEAST/,
        'public search RPC should preserve RLS and cap result size'
    );
});
