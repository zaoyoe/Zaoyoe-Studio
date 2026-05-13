const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    loadSiteScopedConfig,
    saveSiteScopedConfig
} = require('../server/api-handlers/_engagement-site-config');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function createSystemConfigStub(initialValue = null) {
    const state = {
        value: initialValue,
        upserts: []
    };

    return {
        state,
        from(table) {
            assert.equal(table, 'system_config');
            return {
                select() { return this; },
                eq(_field, value) {
                    this.key = value;
                    return this;
                },
                async maybeSingle() {
                    return {
                        data: state.value == null ? null : { config_value: state.value },
                        error: null
                    };
                },
                async upsert(payload) {
                    state.value = payload.config_value;
                    state.upserts.push(payload);
                    return { error: null };
                }
            };
        }
    };
}

test('engagement site config helper resolves and stores per-site values', async () => {
    const supabase = createSystemConfigStub({
        __site_scoped: true,
        default: { entry_label: 'CN quick help' },
        sites: {
            intl: { entry_label: 'INTL quick help' }
        }
    });

    const intlValue = await loadSiteScopedConfig(
        supabase,
        'engagement_support_entry_center',
        'intl',
        (value) => value,
        {}
    );
    assert.deepEqual(intlValue, { entry_label: 'INTL quick help' });

    await saveSiteScopedConfig({
        supabase,
        key: 'engagement_support_entry_center',
        site: 'cn',
        value: { entry_label: 'CN updated' },
        description: 'test',
        userId: 'admin-1'
    });

    assert.equal(supabase.state.value.__site_scoped, true);
    assert.deepEqual(supabase.state.value.default, { entry_label: 'CN quick help' });
    assert.deepEqual(supabase.state.value.sites.cn, { entry_label: 'CN updated' });
    assert.deepEqual(supabase.state.value.sites.intl, { entry_label: 'INTL quick help' });
});

test('admin engagement config centers pass site context through reads and writes', () => {
    const adminJs = readRepoFile('js/admin-engagement.js');
    const assetsHandler = readRepoFile('server/api-handlers/admin/engagement/assets.js');
    const entryHandler = readRepoFile('server/api-handlers/admin/engagement/entry.js');
    const scenesHandler = readRepoFile('server/api-handlers/admin/engagement/scenes.js');
    const externalHandler = readRepoFile('server/api-handlers/admin/engagement/external.js');
    const segmentsHandler = readRepoFile('server/api-handlers/admin/engagement/segments.js');

    assert.match(adminJs, /function getCurrentConcreteSite/);
    assert.match(adminJs, /buildAdminUrl\('engagement\/segments', \{\s*site: getCurrentConcreteSite\(\)/);
    assert.match(adminJs, /buildAdminUrl\('engagement\/assets', \{\s*site: getCurrentConcreteSite\(\)/);
    assert.match(adminJs, /buildAdminUrl\('engagement\/entry', \{\s*site: getCurrentConcreteSite\(\)/);
    assert.match(adminJs, /buildAdminUrl\('engagement\/scenes', \{\s*site: getCurrentConcreteSite\(\)/);
    assert.match(adminJs, /buildAdminUrl\('engagement\/external', \{\s*site: getCurrentConcreteSite\(\)/);

    [assetsHandler, entryHandler, scenesHandler, externalHandler, segmentsHandler].forEach((source) => {
        assert.match(source, /loadSiteScopedConfig/);
        assert.match(source, /saveSiteScopedConfig/);
        assert.match(source, /resolveEngagementConfigRequestSite/);
    });
});

test('public engagement feed resolves visual centers by request site', () => {
    const publicHandler = readRepoFile('server/api-handlers/public/engagement.js');

    assert.match(publicHandler, /fetchAssetStyleConfig\(supabase, context\.site\)/);
    assert.match(publicHandler, /fetchSupportEntryConfig\(supabase, context\.site\)/);
    assert.match(publicHandler, /fetchPageSceneConfig\(supabase, context\.site\)/);
    assert.match(publicHandler, /fetchAudienceSegments\(supabase, site\)/);
    assert.match(publicHandler, /fetchEngagementCorsPolicy\(supabase, policySite\)/);
});

test('engagement segmentation and tag automation are site-scoped', () => {
    const migration = readRepoFile('supabase/migrations/20260513_site_scope_engagement_config.sql');
    const userTagsHelper = readRepoFile('api/_lib/user-tags.js');
    const segmentsHandler = readRepoFile('server/api-handlers/admin/engagement/segments.js');
    const overviewHandler = readRepoFile('server/api-handlers/admin/engagement/overview.js');

    assert.match(migration, /ADD COLUMN IF NOT EXISTS site TEXT NOT NULL DEFAULT 'all'/);
    assert.match(migration, /DROP CONSTRAINT IF EXISTS engagement_segments_key_key/);
    assert.match(migration, /idx_engagement_segments_site_key/);
    assert.match(migration, /PRIMARY KEY \(user_id, site\)/);
    assert.match(migration, /ON CONFLICT \(user_id, site\) DO UPDATE/);
    assert.match(migration, /'engagement_user_tag_center'/);

    assert.match(userTagsHelper, /resolveSiteScopedUserTagCenterConfig/);
    assert.match(userTagsHelper, /options\.site \|\| options\.site_id/);
    assert.match(segmentsHandler, /TAG_CENTER_CONFIG_KEY/);
    assert.match(segmentsHandler, /saveSiteScopedConfig/);
    assert.match(segmentsHandler, /listSegments\(supabase, site\)/);
    assert.match(overviewHandler, /fetchTagCenterConfig\(supabase, normalizedSite\)/);
    assert.match(overviewHandler, /applyOverviewSiteFilter\(supabase[\s\S]*engagement_segments/);
});
