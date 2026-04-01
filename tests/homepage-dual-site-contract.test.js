const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminHomepagePath = path.resolve(__dirname, '../admin-homepage.js');
const framerHomePath = path.resolve(__dirname, '../js/framer_home.js');
const prefetchHomePath = path.resolve(__dirname, '../js/prefetch-home.js');
const guestbookRuntimePath = path.resolve(__dirname, '../supabase-guestbook-functions.js');
const migrationPath = path.resolve(__dirname, '../supabase/migrations/20260331_homepage_config_dual_site_bootstrap.sql');

test('homepage admin runtime prefers site rows and invalidates site-specific caches', () => {
    const source = fs.readFileSync(adminHomepagePath, 'utf8');

    assert.match(source, /return \`\$\{HOMEPAGE_PREFETCH_CACHE_KEY\}_\$\{normalizeHomepageSite\(site\)\}\`;/);
    assert.match(source, /return \`\$\{HOMEPAGE_CONFIG_LAST_UPDATED_KEY\}_\$\{normalizeHomepageSite\(site\)\}\`;/);
    assert.match(source, /const result = await fetchHomepageConfigRows\(getHomepageReadSite\(\)\);/);
    assert.match(source, /const rows = Array\.isArray\(result\.rows\) \? result\.rows : \[\];/);
    assert.match(source, /\/api\/admin\/homepage\/config/);
    assert.doesNotMatch(source, /supabaseClient\s*\.from\('homepage_config'\)/);
    assert.doesNotMatch(source, /zaoyoe_\$\{cacheSite\}_cache_v1_homepage_config/);
});

test('homepage frontend runtime reads and writes site-specific prefetch payloads', () => {
    const framerSource = fs.readFileSync(framerHomePath, 'utf8');
    const prefetchSource = fs.readFileSync(prefetchHomePath, 'utf8');
    const guestbookSource = fs.readFileSync(guestbookRuntimePath, 'utf8');

    assert.match(framerSource, /\.rpc\('fn_get_homepage_config'/);
    assert.match(framerSource, /function readHomepagePrefetchCache\(site = getHomepageRuntimeSite\(\)\)/);
    assert.match(framerSource, /sessionStorage\.setItem\(getHomepagePrefetchCacheKey\(site\), JSON\.stringify\(/);
    assert.match(framerSource, /data\.forEach\(item => \{/);
    assert.doesNotMatch(framerSource, /sessionStorage\.getItem\(HOMEPAGE_PREFETCH_CACHE_KEY\)/);

    assert.match(prefetchSource, /\.rpc\('fn_get_homepage_config'/);
    assert.match(prefetchSource, /sessionStorage\.setItem\(getHomepagePrefetchCacheKey\(currentSite\), JSON\.stringify\(/);
    assert.doesNotMatch(prefetchSource, /sessionStorage\.getItem\(HOMEPAGE_PREFETCH_CACHE_KEY\)/);

    assert.match(guestbookSource, /const siteCacheKey = `homepage_prefetch_\$\{currentSite\}`;/);
    assert.match(guestbookSource, /sessionStorage\.setItem\(siteCacheKey, JSON\.stringify\(parsed\)\);/);
    assert.doesNotMatch(guestbookSource, /sessionStorage\.getItem\('homepage_prefetch'\)/);
});

test('homepage section visibility runtime now derives homepage sections from homepage_config', () => {
    const adminHomepageSource = fs.readFileSync(adminHomepagePath, 'utf8');
    const sectionVisibilitySource = fs.readFileSync(path.resolve(__dirname, '../js/section-visibility.js'), 'utf8');

    assert.match(adminHomepageSource, /const VIS_TO_SECTION = \{ hero: 'hero', gallery: 'prompts', shop: 'shop', verify: 'verify', guestbook: 'guestbook', footer: 'footer' \};/);
    assert.match(adminHomepageSource, /async function saveHomepageSectionVisibility\(section, checked, site\)/);
    assert.match(adminHomepageSource, /const result = await updateHomepageConfigRow\(\{/);
    assert.match(adminHomepageSource, /is_visible: checked/);
    assert.doesNotMatch(adminHomepageSource, /rpc\('get_all_system_config'\)/);
    assert.doesNotMatch(adminHomepageSource, /rpc\('update_system_config'/);

    assert.match(sectionVisibilitySource, /const HOMEPAGE_SECTION_MAP = \{/);
    assert.match(sectionVisibilitySource, /\.rpc\('fn_get_homepage_config'/);
    assert.match(sectionVisibilitySource, /p_include_hidden: true/);
    assert.doesNotMatch(sectionVisibilitySource, /rpc\('get_all_system_config'\)/);
    assert.match(sectionVisibilitySource, /footer: 'footer'/);
});

test('homepage schema migration bootstraps dual-site rows and site-aware public function', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');

    assert.match(migration, /ADD COLUMN IF NOT EXISTS site VARCHAR\(10\)/);
    assert.match(migration, /DROP CONSTRAINT IF EXISTS homepage_config_section_key/);
    assert.match(migration, /INSERT INTO public\.homepage_config \(/);
    assert.match(migration, /'intl'/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_homepage_config_site_section/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_get_homepage_config\(p_site VARCHAR DEFAULT 'cn'/);

    const dropConstraintIndex = migration.indexOf('DROP CONSTRAINT IF EXISTS homepage_config_section_key');
    const insertIntlIndex = migration.indexOf('INSERT INTO public.homepage_config');
    assert.notEqual(dropConstraintIndex, -1);
    assert.notEqual(insertIntlIndex, -1);
    assert.ok(dropConstraintIndex < insertIntlIndex, 'legacy section uniqueness must be removed before inserting intl rows');
});

test('homepage footer migration copies footer visibility into homepage_config rows', () => {
    const footerMigration = fs.readFileSync(
        path.resolve(__dirname, '../supabase/migrations/20260331_homepage_footer_visibility_to_homepage_config.sql'),
        'utf8'
    );

    assert.match(footerMigration, /INSERT INTO public\.homepage_config/);
    assert.match(footerMigration, /'footer'/);
    assert.match(footerMigration, /config_value -> 'cn' ->> 'footer'/);
    assert.match(footerMigration, /config_value -> 'intl' ->> 'footer'/);
    assert.match(footerMigration, /ON CONFLICT \(site, section\) DO NOTHING/);
});

test('homepage public rpc migration supports hidden sections for visibility consumers', () => {
    const rpcMigration = fs.readFileSync(
        path.resolve(__dirname, '../supabase/migrations/20260331_extend_homepage_public_rpc_for_hidden_sections.sql'),
        'utf8'
    );

    assert.match(rpcMigration, /p_include_hidden BOOLEAN DEFAULT false/);
    assert.match(rpcMigration, /AND \(p_include_hidden OR hc\.is_visible = true\)/);
    assert.match(rpcMigration, /CREATE OR REPLACE FUNCTION public\.fn_get_homepage_config/);
});
