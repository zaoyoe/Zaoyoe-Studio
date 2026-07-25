const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('prompt gallery defaults to refresh-level random ordering and supports aggregate hotness sorting', () => {
    const html = read('prompts.html');
    const runtime = read('prompts-poetry.js');
    const styles = read('prompts-poetry.css');
    const migration = read('supabase/migrations/20260725_prompt_gallery_hotness_sort.sql');

    assert.match(html, /data-prompt-sort="random"[^>]*aria-pressed="true"/);
    assert.match(html, /data-prompt-sort="hot"[^>]*aria-pressed="false"/);
    assert.match(runtime, /let currentPromptSort = 'random';/);
    assert.match(runtime, /const promptRandomOrderKeys = new Map\(\);/);
    assert.match(runtime, /function getPromptRandomOrderKey/);
    assert.match(runtime, /function applyPromptSort/);
    assert.match(runtime, /function applyPromptGalleryFiltersAndSort/);
    assert.match(runtime, /rpc\('fn_public_prompt_hotness'/);
    assert.match(runtime, /if \(promptHotnessMetrics\.size === 0\) \{[\s\S]*?currentPromptSort = 'random';/);
    assert.match(runtime, /async function setPromptSort[\s\S]*?await loadPromptHotnessMetrics\(\);[\s\S]*?renderCurrentPage\(\{ preserveScroll: true \}\);/);
    assert.doesNotMatch(runtime, /loadPromptHotnessMetrics\(\{ forceRefresh: previousSort !== 'hot' \}\)/);
    assert.match(runtime, /schedulePromptIdleTask\('hotness-prefetch', \(\) => loadPromptHotnessMetrics\(\)/);
    assert.match(runtime, /sortFilter\.addEventListener\('pointerenter', warmHotness/);
    assert.doesNotMatch(runtime, /instantEntrance/);
    assert.match(styles, /\.prompt-card\.card-visible\s*\{[\s\S]*?transition:\s*opacity 0\.8s ease, transform 0\.8s ease;/);
    assert.match(html, /sortSwitch=20260725_PROMPT_SORT_SWITCH_ENTRY_2/);

    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.prompt_favorites/);
    assert.match(migration, /UNIQUE \(user_id, prompt_id, site\)/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_public_prompt_hotness/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.prompt_hotness_metrics/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.prompt_card_clicks/);
    assert.match(migration, /PRIMARY KEY \(prompt_id, site, session_key\)/);
    assert.match(migration, /CREATE TRIGGER trigger_sync_prompt_favorite_hotness/);
    assert.match(migration, /CREATE TRIGGER trigger_sync_prompt_comment_hotness/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_record_prompt_card_click/);
    assert.match(migration, /NOT EXISTS \([\s\S]*?FROM public\.prompts p WHERE p\.id::TEXT = v_prompt_id/);
    assert.match(migration, /WHERE NOT EXISTS \(SELECT 1 FROM public\.prompt_hotness_metrics\)/);
    assert.match(migration, /COALESCE\(m\.favorite_count, 0\) \* 12/);
    assert.match(migration, /COALESCE\(m\.comment_count, 0\) \* 6/);
    assert.match(migration, /COALESCE\(m\.click_count, 0\)/);
    assert.match(migration, /event_name = 'prompt_view'/);
    assert.match(runtime, /function recordPromptCardClick/);
    assert.match(runtime, /function getPromptCardClickSessionId/);
    assert.match(runtime, /rpc\('fn_record_prompt_card_click'/);
    assert.match(runtime, /p_session_id: sessionId/);
    assert.match(migration, /ON CONFLICT \(prompt_id, site, session_key\) DO NOTHING/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_public_prompt_hotness\(TEXT\) TO anon, authenticated, service_role/);
});

test('prompt favorites use persistent prompt ids and sync private user state to Supabase', () => {
    const runtime = read('prompts-poetry.js');
    const migration = read('supabase/migrations/20260725_prompt_gallery_hotness_sort.sql');

    assert.match(runtime, /const PROMPT_FAVORITES_USER_STORAGE_PREFIX = 'promptFavoritesStable:user:';/);
    assert.match(runtime, /function migrateLegacyPromptFavorites/);
    assert.match(runtime, /function getPromptFavoriteIdForItem[\s\S]*?if \(persistentId\) return normalizePromptFavoriteId\(persistentId\);/);
    assert.match(runtime, /async function syncPromptFavoriteToSupabase/);
    assert.match(runtime, /\.from\('prompt_favorites'\)/);
    assert.match(runtime, /async function hydratePromptFavoriteCloudState/);
    assert.match(migration, /USING \(auth\.uid\(\) = user_id\)/);
    assert.doesNotMatch(migration, /CREATE POLICY[^;]*USING \(true\)/s);
});
