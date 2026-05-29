const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminHomepagePath = path.resolve(__dirname, '../admin-homepage.js');
const indexPath = path.resolve(__dirname, '../index.html');
const siteLayoutRuntimePath = path.resolve(__dirname, '../js/site-layout-runtime.js');
const sharedSiteLayoutPath = path.resolve(__dirname, '../server/api-handlers/_site-layout.js');
const framerHomePath = path.resolve(__dirname, '../js/framer_home.js');
const prefetchHomePath = path.resolve(__dirname, '../js/prefetch-home.js');
const homepageContractPath = path.resolve(__dirname, '../js/homepage-contract.js');
const guestbookRuntimePath = path.resolve(__dirname, '../supabase-guestbook-functions.js');
const migrationPath = path.resolve(__dirname, '../supabase/migrations/20260331_homepage_config_dual_site_bootstrap.sql');
const homepageP1MigrationPath = path.resolve(__dirname, '../supabase/migrations/20260411_homepage_p1_schedule_templates_and_runtime_rpc.sql');
const homepageContextHandlerPath = path.resolve(__dirname, '../server/api-handlers/admin/homepage/context.js');
const adminApiPath = path.resolve(__dirname, '../api/admin.js');
const siteLayoutPublicPages = [
    'index.html',
    'shop.html',
    'verify.html',
    'prompts.html',
    'guestbook.html',
    'privacy.html',
    'reset-password.html'
];

test('homepage admin runtime prefers site rows and invalidates site-specific caches', () => {
    const source = fs.readFileSync(adminHomepagePath, 'utf8');

    assert.match(source, /return \`\$\{HOMEPAGE_PREFETCH_CACHE_KEY\}_\$\{normalizeHomepageSite\(site\)\}\`;/);
    assert.match(source, /return \`\$\{HOMEPAGE_CONFIG_LAST_UPDATED_KEY\}_\$\{normalizeHomepageSite\(site\)\}\`;/);
    assert.match(source, /const requestSite = normalizeHomepageSite\(site\);/);
    assert.match(source, /const result = await fetchHomepageConfigRows\(requestSite\);/);
    assert.match(source, /isCurrentHomepageConfigRequest\(requestSite, requestId\)/);
    assert.match(source, /const rows = Array\.isArray\(result\.rows\) \? result\.rows : \[\];/);
    assert.match(source, /\/api\/admin\/homepage\/config/);
    assert.match(source, /include_draft', '1'/);
    assert.match(source, /return normalizeHomepageSite\(filter\);/);
    assert.match(source, /action: 'save_draft'/);
    assert.match(source, /action: 'publish'/);
    assert.match(source, /action: 'rollback'/);
    assert.match(source, /const VIS_TO_SECTION = \{ hero: 'hero', prompts: 'prompts', gallery: 'prompts', shop: 'shop', gongyi: 'gongyi', verify: 'verify', guestbook: 'guestbook', ticker: 'ticker' \};/);
    assert.doesNotMatch(source, /filter === 'all' \? 'cn' : filter/);
    assert.doesNotMatch(source, /zaoyoe_\$\{cacheSite\}_cache_v1_homepage_config/);
});

test('homepage frontend runtime reads and writes site-specific prefetch payloads', () => {
    const framerSource = fs.readFileSync(framerHomePath, 'utf8');
    const prefetchSource = fs.readFileSync(prefetchHomePath, 'utf8');
    const guestbookSource = fs.readFileSync(guestbookRuntimePath, 'utf8');
    const contractSource = fs.readFileSync(homepageContractPath, 'utf8');

    assert.match(framerSource, /\.rpc\('fn_get_homepage_config'/);
    assert.match(framerSource, /async fetchVisiblePromptPool\(options = \{\}\)/);
    assert.match(framerSource, /const \{ preferStaticFirst = false \} = options;/);
    assert.match(framerSource, /\.from\('prompts'\)\s*\.select\(HOMEPAGE_PROMPT_LIVE_SELECT\)\s*\.order\('updated_at', \{ ascending: false \}\)\s*\.limit\(80\)/);
    assert.match(framerSource, /filterHomeVisiblePrompts\(data\)/);
    assert.match(framerSource, /const HOMEPAGE_PROMPT_POOL_LAST_UPDATED_KEY = 'homepage_prompt_pool_last_updated_at';/);
    assert.match(framerSource, /const isFreshPromptPool = !promptPoolUpdatedAt \|\| \(prefetch\.timestamp \|\| 0\) >= promptPoolUpdatedAt;/);
    assert.match(framerSource, /function buildHomepagePromptRenderSignature\(prompts = \[\]\)/);
    assert.match(framerSource, /schedulePromptPoolLiveSync\(options = \{\}\)/);
    assert.match(framerSource, /async syncPromptPoolFromLiveSourceInBackground\(options = \{\}\)/);
    assert.match(framerSource, /this\.schedulePromptPoolLiveSync\(\{ reason: 'prefetch-cache' \}\);/);
    assert.match(framerSource, /prompt\?\.image_url/);
    assert.match(framerSource, /prompt\?\.cover_image/);
    assert.match(framerSource, /function readHomepagePrefetchCache\(site = getHomepageRuntimeSite\(\)\)/);
    assert.match(framerSource, /sessionStorage\.setItem\(getHomepagePrefetchCacheKey\(site\), JSON\.stringify\(/);
    assert.match(framerSource, /this\.sectionOrder = HomepageContract\?\.sortSectionsByDisplayOrder\?\.\(data\)/);
    assert.match(framerSource, /prompt\?\.supabaseId \?\? prompt\?\.id/);
    assert.match(framerSource, /this\.findFeaturedPromptRecord\(promptPool, item\) \|\| this\.buildFeaturedPromptFallback\(item\)/);
    assert.match(framerSource, /const columnCount = Math\.min\(5, Math\.max\(1, prompts\.length \|\| 1\)\);/);
    assert.match(framerSource, /class="masonry-container" data-columns="\$\{columnCount\}"/);
    assert.match(framerSource, /this\.buildGongyiData\(this\.config\.gongyi \|\| \{\}\)/);
    assert.doesNotMatch(framerSource, /config\.featured_items\?\.length > 0\) \{\s+return config\.featured_items[\s\S]*\.slice\(0, config\.max_items \|\| 24\);/);
    assert.match(framerSource, /sv\.isVisible\('prompts'\)/);
    assert.doesNotMatch(framerSource, /sv\.isVisible\('gallery'\)/);
    assert.doesNotMatch(framerSource, /sessionStorage\.getItem\(HOMEPAGE_PREFETCH_CACHE_KEY\)/);

    assert.match(prefetchSource, /\.rpc\('fn_get_homepage_config'/);
    assert.match(prefetchSource, /async function fetchVisiblePromptPool\(\)/);
    assert.match(prefetchSource, /\.from\('prompts'\)\s*\.select\(HOMEPAGE_PROMPT_LIVE_SELECT\)\s*\.order\('updated_at', \{ ascending: false \}\)\s*\.limit\(80\)/);
    assert.match(prefetchSource, /filterVisibleHomepagePrompts\(data\)/);
    assert.match(prefetchSource, /const HOMEPAGE_PROMPT_POOL_LAST_UPDATED_KEY = 'homepage_prompt_pool_last_updated_at';/);
    assert.match(prefetchSource, /prompt\?\.image_url/);
    assert.match(prefetchSource, /prompt\?\.cover_image/);
    assert.match(prefetchSource, /sessionStorage\.setItem\(getHomepagePrefetchCacheKey\(currentSite\), JSON\.stringify\(/);
    assert.match(prefetchSource, /cacheKind = promptPoolSource === 'live' \? 'complete' : 'partial'/);
    assert.match(prefetchSource, /prompt\?\.supabaseId \?\? prompt\?\.id/);
    assert.match(prefetchSource, /findFeaturedPromptRecord\(promptPool, item\) \|\| buildFeaturedPromptFallback\(item\)/);
    assert.match(prefetchSource, /getSectionExperimentValue\('prompts', config, 'featured_items', null\)/);
    assert.doesNotMatch(prefetchSource, /config\.featured_items\.length > 0\) \{\s+return config\.featured_items[\s\S]*\.slice\(0, Number\(config\.max_items\) \|\| 24\);/);
    assert.match(prefetchSource, /gongyi: buildGongyiData\(config\.gongyi \|\| \{\}\)/);
    assert.match(prefetchSource, /config\.verify \|\| \{\}/);
    assert.match(prefetchSource, /screenshot: config\.screenshot_path \|\| '\/assets\/verify-preview\.png'/);
    assert.doesNotMatch(prefetchSource, /sessionStorage\.getItem\(HOMEPAGE_PREFETCH_CACHE_KEY\)/);

    assert.match(contractSource, /global\.HomepageContract = \{/);
    assert.match(contractSource, /gallery: 'prompts'/);
    assert.match(contractSource, /MANAGED_SECTION_ORDER = Object\.freeze\(\['hero', 'prompts', 'shop', 'gongyi', 'verify', 'guestbook', 'ticker'\]\)/);
    assert.match(contractSource, /EXPERIMENT_FIELD_RULES = Object\.freeze\(\{/);
    assert.match(contractSource, /function normalizeSectionExperiments\(section, value\)/);
    assert.match(contractSource, /next\.experiments = normalizeSectionExperiments\(normalizedSection, source\.experiments\);/);

    assert.match(guestbookSource, /const siteCacheKey = `homepage_prefetch_\$\{currentSite\}`;/);
    assert.match(guestbookSource, /sessionStorage\.setItem\(siteCacheKey, JSON\.stringify\(parsed\)\);/);
    assert.doesNotMatch(guestbookSource, /sessionStorage\.getItem\('homepage_prefetch'\)/);
});

test('homepage section visibility runtime now derives homepage sections from homepage_config', () => {
    const adminHomepageSource = fs.readFileSync(adminHomepagePath, 'utf8');
    const sectionVisibilitySource = fs.readFileSync(path.resolve(__dirname, '../js/section-visibility.js'), 'utf8');

    assert.match(adminHomepageSource, /async function saveHomepageSectionVisibility\(section, checked, site\)/);
    assert.match(adminHomepageSource, /const result = await saveHomepageDraftRow\(\{/);
    assert.match(adminHomepageSource, /is_visible: checked/);
    assert.doesNotMatch(adminHomepageSource, /rpc\('get_all_system_config'\)/);
    assert.doesNotMatch(adminHomepageSource, /rpc\('update_system_config'/);

    assert.match(sectionVisibilitySource, /const HOMEPAGE_SECTION_MAP = \{/);
    assert.match(sectionVisibilitySource, /\.rpc\('fn_get_homepage_config'/);
    assert.match(sectionVisibilitySource, /p_include_hidden: true/);
    assert.doesNotMatch(sectionVisibilitySource, /rpc\('get_all_system_config'\)/);
    assert.match(sectionVisibilitySource, /gongyi: 'gongyi'/);
    assert.match(sectionVisibilitySource, /ticker: 'ticker'/);
    assert.match(sectionVisibilitySource, /normalized === 'gallery'/);
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

test('site layout footer contacts stay scoped per site and sanitize unsafe values', () => {
    const {
        DEFAULT_FOOTER_CONTACTS,
        normalizeSiteLayouts
    } = require(sharedSiteLayoutPath);

    const layouts = normalizeSiteLayouts({
        cn: {
            root_page_key: 'home',
            logo_target_mode: 'follow_root',
            footer_contacts: {
                support_url: 'https://cn.example/support',
                telegram_url: 'javascript:alert(1)',
                telegram_group_url: 'https://t.me/+cn_support',
                contact_email: 'cn@example.com'
            }
        },
        intl: {
            root_page_key: 'shop',
            logo_target_mode: 'follow_root',
            footer_contacts: {
                support_url: 'https://intl.example/support',
                telegram_url: 'https://t.me/intl_support',
                telegram_group_url: 'not-a-url',
                contact_email: 'bad-email'
            }
        }
    });

    assert.equal(layouts.cn.footer_contacts.support_url, 'https://cn.example/support');
    assert.equal(layouts.cn.footer_contacts.telegram_url, DEFAULT_FOOTER_CONTACTS.telegram_url);
    assert.equal(layouts.cn.footer_contacts.telegram_group_url, 'https://t.me/+cn_support');
    assert.equal(layouts.cn.footer_contacts.contact_email, 'cn@example.com');
    assert.equal(layouts.intl.footer_contacts.support_url, 'https://intl.example/support');
    assert.equal(layouts.intl.footer_contacts.telegram_url, 'https://t.me/intl_support');
    assert.equal(layouts.intl.footer_contacts.telegram_group_url, DEFAULT_FOOTER_CONTACTS.telegram_group_url);
    assert.equal(layouts.intl.footer_contacts.contact_email, DEFAULT_FOOTER_CONTACTS.contact_email);
    assert.notEqual(layouts.cn.footer_contacts.support_url, layouts.intl.footer_contacts.support_url);
});

test('homepage footer exposes site layout contact hooks and removes resource status link', () => {
    const source = fs.readFileSync(indexPath, 'utf8');

    [
        'data-site-layout-contact="support"',
        'data-site-layout-contact="telegram"',
        'data-site-layout-contact="telegram_group"',
        'data-site-layout-contact="email"'
    ].forEach((marker) => {
        assert.match(source, new RegExp(marker), `index.html should expose ${marker}`);
    });

    assert.doesNotMatch(source, /data-i18n="footer\.resources\.status"/);
    assert.doesNotMatch(source, /https:\/\/status\.fatherkey\.com/);
});

test('public contact links opt into site layout replacement across routed pages', () => {
    siteLayoutPublicPages.forEach((relativePath) => {
        const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
        const anchors = Array.from(source.matchAll(/<a\b[\s\S]*?>/gi)).map((match) => match[0]);

        anchors.forEach((anchor) => {
            if (anchor.includes('https://t.me/zaoyoe')) {
                assert.match(anchor, /data-site-layout-contact="telegram"/, `${relativePath} TG link should be site-managed`);
            }
            if (anchor.includes('https://t.me/+I86eX5sPF1c0OTc1')) {
                assert.match(anchor, /data-site-layout-contact="telegram_group"/, `${relativePath} TG group link should be site-managed`);
            }
            if (anchor.includes('https://afdian.com/a/zaoyoe')) {
                assert.match(anchor, /data-site-layout-contact="support"/, `${relativePath} support link should be site-managed`);
            }
            if (anchor.includes('mailto:zaoyoe@gmail.com')) {
                assert.match(anchor, /data-site-layout-contact="email"/, `${relativePath} email link should be site-managed`);
            }
        });
    });
});

test('site layout admin editor and runtime wire footer contacts without stale cache lock-in', () => {
    const adminSource = fs.readFileSync(adminHomepagePath, 'utf8');
    const runtimeSource = fs.readFileSync(siteLayoutRuntimePath, 'utf8');
    const framerHomeSource = fs.readFileSync(framerHomePath, 'utf8');
    const framerNavSource = fs.readFileSync(path.resolve(__dirname, '../js/framer-nav-runtime.js'), 'utf8');

    [
        'id="hp-site-layout-support-url"',
        'id="hp-site-layout-telegram-url"',
        'id="hp-site-layout-telegram-group-url"',
        'id="hp-site-layout-contact-email"',
        'footer_contacts: footerContacts'
    ].forEach((marker) => {
        assert.equal(adminSource.includes(marker), true, `admin-homepage.js should contain ${marker}`);
    });

    assert.match(runtimeSource, /function applyFooterContacts\(layout\)/);
    assert.match(runtimeSource, /document\.querySelectorAll\('\[data-site-layout-contact\]'\)/);
    assert.match(runtimeSource, /document\.querySelectorAll\('a\[href\]'\)\.forEach\(\(anchor\) =>/);
    assert.match(runtimeSource, /href === DEFAULT_FOOTER_CONTACTS\.telegram_group_url/);
    assert.match(runtimeSource, /new MutationObserver\(\(mutations\) =>/);
    assert.match(runtimeSource, /Array\.from\(mutation\.addedNodes \|\| \[\]\)\.some\(hasLayoutManagedNode\)/);
    assert.match(runtimeSource, /if \(cachedLayouts\) \{[\s\S]*ensureAppliedWithCurrentDom\(cachedLayouts\);[\s\S]*\}[\s\S]*fetchLayoutsFromPublicApi\(\)/);
    assert.match(runtimeSource, /saveLayoutsToCache\(layouts\);[\s\S]*ensureAppliedWithCurrentDom\(layouts\);/);
    assert.match(framerHomeSource, /data-site-layout-contact="telegram_group"/);
    assert.match(framerNavSource, /data-site-layout-contact="telegram_group"/);
});

test('homepage P1 context handler and migration wire templates, schedules, analytics, and runtime overlay', () => {
    const contextSource = fs.readFileSync(homepageContextHandlerPath, 'utf8');
    const adminApiSource = fs.readFileSync(adminApiPath, 'utf8');
    const migration = fs.readFileSync(homepageP1MigrationPath, 'utf8');

    assert.match(adminApiSource, /const homepageContextHandler = require\('\.\.\/server\/api-handlers\/admin\/homepage\/context'\);/);
    assert.match(adminApiSource, /'homepage\/context': homepageContextHandler/);

    assert.match(contextSource, /HOMEPAGE_ANALYTICS_EVENT_NAMES = Object\.freeze\(\[/);
    assert.match(contextSource, /'homepage_prompt_click'/);
    assert.match(contextSource, /'homepage_gongyi_click'/);
    assert.match(contextSource, /'homepage_verify_click'/);
    assert.match(contextSource, /'homepage_ticker_click'/);
    assert.match(contextSource, /'homepage_experiment_impression'/);
    assert.match(contextSource, /action === 'save_template'/);
    assert.match(contextSource, /action === 'apply_template'/);
    assert.match(contextSource, /action === 'schedule_publish'/);
    assert.match(contextSource, /action === 'cancel_schedule'/);
    assert.match(contextSource, /action === 'save_experiment'/);
    assert.match(contextSource, /action === 'apply_recommendation'/);
    assert.match(contextSource, /action === 'apply_theme_pack'/);
    assert.match(contextSource, /buildHomepageThemePackList\(site, templates = \[\]\)/);
    assert.match(contextSource, /homepage_site_templates/);
    assert.match(contextSource, /homepage_site_schedules/);

    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.homepage_site_templates/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.homepage_site_schedules/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_get_homepage_config/);
    assert.match(migration, /active_schedule AS \(/);
    assert.match(migration, /jsonb_each\(COALESCE\(payload -> 'sections', '\{\}'::jsonb\)\)/);
    assert.match(migration, /COALESCE\(\(ss\.section_payload ->> 'display_order'\)::INT, hc\.display_order\)/);
});
