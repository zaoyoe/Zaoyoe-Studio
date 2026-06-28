const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('ai image video schema migration widens task and result constraints', () => {
    const migration = readRepoFile('supabase/migrations/20260628_ai_image_video_constraints.sql');
    const coreSchema = readRepoFile('supabase/migrations/20260621_ai_image_workbench_core.sql');

    for (const source of [migration, coreSchema]) {
        assert.match(source, /ai_image_tasks_mode_check[\s\S]*'video'/);
        assert.match(source, /ai_image_tasks_resolution_check[\s\S]*'720p'/);
        assert.match(source, /ai_image_results_resolution_check[\s\S]*'720p'/);
        assert.match(source, /ai_image_api_usage_request_type_check[\s\S]*'video'/);
        assert.match(source, /ai_image_api_usage_resolution_check[\s\S]*'1080p'/);
    }

    assert.match(migration, /ALTER TABLE public\.ai_image_tasks DROP CONSTRAINT IF EXISTS/);
    assert.match(migration, /ALTER TABLE public\.ai_image_tasks[\s\S]*CHECK \(mode IN \('text', 'image', 'video', 'reverse', 'chat', 'agent'\)\)/);
    assert.match(migration, /ALTER TABLE public\.ai_image_tasks[\s\S]*CHECK \(resolution IS NULL OR resolution IN \('1k', '2k', '4k', '480p', '720p', '1080p'\)\)/);
});
