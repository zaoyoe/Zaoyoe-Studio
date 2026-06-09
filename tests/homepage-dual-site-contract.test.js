const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminHomepagePath = path.resolve(__dirname, '../admin-homepage.js');
const indexPath = path.resolve(__dirname, '../index.html');
const siteLayoutRuntimePath = path.resolve(__dirname, '../js/site-layout-runtime.js');
const sharedSiteLayoutPath = path.resolve(__dirname, '../server/api-handlers/_site-layout.js');
const framerHomePath = path.resolve(__dirname, '../js/framer_home.js');
const framerHomeCssPath = path.resolve(__dirname, '../css/framer_home.css');
const framerHomeCriticalCssPath = path.resolve(__dirname, '../css/framer_home_critical.css');
const adminStudioPageCssPath = path.resolve(__dirname, '../css/admin-studio-page.css');
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
    assert.equal(layouts.cn.support_channels.find((channel) => channel.id === 'telegram')?.target_url, DEFAULT_FOOTER_CONTACTS.telegram_url);
    assert.deepEqual(layouts.cn.support_channels.find((channel) => channel.id === 'telegram')?.placements, ['nav', 'mobile_nav', 'footer_brand']);
    assert.equal(layouts.cn.support_channels.find((channel) => channel.id === 'sponsor')?.target_url, 'https://cn.example/support');
    assert.equal(layouts.intl.support_channels.find((channel) => channel.id === 'telegram')?.target_url, 'https://t.me/intl_support');
    assert.equal(layouts.intl.support_channels.find((channel) => channel.id === 'email')?.target_email, DEFAULT_FOOTER_CONTACTS.contact_email);
});

test('site layout support channels sanitize unsafe values and keep social icon presets', () => {
    const {
        normalizeSiteLayouts
    } = require(sharedSiteLayoutPath);

    const layouts = normalizeSiteLayouts({
        cn: {
            support_channels: [
                {
                    id: 'WeChat Main',
                    name: '微信客服',
                    short_name: '微信',
                    icon: 'wechat',
                    action: 'copy',
                    copy_text: 'fatherkey-wechat',
                    target_url: 'javascript:alert(1)',
                    placements: ['nav', 'mobile_nav', 'footer_brand', 'unknown']
                },
                {
                    id: 'qq',
                    name: 'QQ',
                    icon: 'qq',
                    action: 'link',
                    target_url: 'https://qm.qq.com/example',
                    placements: ['footer_brand']
                },
                {
                    id: 'chat',
                    name: '在线客服',
                    icon: 'support_bot',
                    action: 'chat',
                    placements: ['nav']
                },
                {
                    id: 'plain-link',
                    name: '无图标链接',
                    icon: 'none',
                    action: 'link',
                    target_url: '/privacy.html',
                    placements: ['footer_about']
                },
                {
                    id: 'WeChat Detail',
                    name: '微信二维码',
                    icon: 'wechat',
                    action: 'detail',
                    target_url: 'javascript:alert(1)',
                    copy_text: 'fatherkey-wechat',
                    detail_title: '扫码添加微信',
                    detail_body: '添加时请备注订单号',
                    detail_image_url: '/assets/support/wechat.png',
                    detail_copy_label: '复制微信号',
                    detail_link_label: '打开资料',
                    placements: ['home_support', 'footer_resources']
                }
            ]
        }
    });

    const wechat = layouts.cn.support_channels.find((channel) => channel.id === 'wechat-main');
    const qq = layouts.cn.support_channels.find((channel) => channel.id === 'qq');
    const chat = layouts.cn.support_channels.find((channel) => channel.id === 'chat');
    const plainLink = layouts.cn.support_channels.find((channel) => channel.id === 'plain-link');
    const detail = layouts.cn.support_channels.find((channel) => channel.id === 'wechat-detail');

    assert.equal(wechat.icon, 'wechat');
    assert.equal(wechat.action, 'copy');
    assert.equal(wechat.target_url, '');
    assert.deepEqual(wechat.placements, ['nav', 'mobile_nav', 'footer_brand']);
    assert.equal(qq.icon, 'qq');
    assert.equal(qq.target_url, 'https://qm.qq.com/example');
    assert.equal(chat.action, 'chat');
    assert.equal(plainLink.icon, 'none');
    assert.deepEqual(plainLink.placements, ['footer_about']);
    assert.equal(detail.action, 'detail');
    assert.equal(detail.target_url, '');
    assert.equal(detail.copy_text, 'fatherkey-wechat');
    assert.equal(detail.detail_title, '扫码添加微信');
    assert.equal(detail.detail_body, '添加时请备注订单号');
    assert.equal(detail.detail_image_url, '/assets/support/wechat.png');
    assert.equal(detail.detail_copy_label, '复制微信号');
    assert.equal(detail.detail_link_label, '打开资料');
    assert.deepEqual(detail.placements, ['footer_resources']);
});

test('homepage footer exposes site layout contact hooks and removes resource status link', () => {
    const source = fs.readFileSync(indexPath, 'utf8');

    [
        'data-site-layout-contact="support"',
        'data-site-layout-contact="telegram"',
        'data-site-layout-contact="telegram_group"',
        'data-site-layout-contact="email"',
        'data-site-layout-support-list="footer_brand"',
        'data-site-layout-support-list="footer_resources"',
        'data-site-layout-support-list="footer_about"',
        'data-site-layout-support-list="footer_bottom"',
        'data-site-layout-support-list="mobile_nav"'
    ].forEach((marker) => {
        assert.match(source, new RegExp(marker), `index.html should expose ${marker}`);
    });

    assert.match(source, /class="index-footer-email" data-site-layout-contact="email"[\s\S]*?<i class="fas fa-envelope"/);
    assert.doesNotMatch(source, /data-site-layout-support-list="home_support"/);
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
    const framerHomeCssSource = fs.readFileSync(framerHomeCssPath, 'utf8');
    const framerHomeCriticalCssSource = fs.readFileSync(framerHomeCriticalCssPath, 'utf8');
    const adminStudioPageCssSource = fs.readFileSync(adminStudioPageCssPath, 'utf8');
    const framerNavSource = fs.readFileSync(path.resolve(__dirname, '../js/framer-nav-runtime.js'), 'utf8');

    [
        'data-hp-section="support"',
        'data-hp-view="support"',
        'id="hp-support-channels-host"',
        '站点入口',
        'const HOMEPAGE_SUPPORT_ICON_PRESETS',
        "{ value: 'none', label: '无'",
        "{ value: 'wechat', label: '微信 / WeChat'",
        "{ value: 'qq', label: 'QQ'",
        "{ value: 'detail', label: '打开详情弹窗'",
        '由站点入口统一维护',
        '新增入口',
        '保存站点入口',
        'data-homepage-support-field="icon"',
        'data-homepage-support-field="detail_title"',
        'data-homepage-support-field="detail_body"',
        'data-homepage-support-field="detail_image_url"',
        'data-homepage-support-action-field="detail"',
        'data-homepage-support-details hidden',
        'data-homepage-action="toggle-support-channel-details"',
        'function toggleHomepageSupportChannelDetails',
        'hp-support-checkmark',
        'hp-support-field-wide',
        'function reindexHomepageSupportChannelOrders',
        'reindexHomepageSupportChannelOrders(mutatedChannels)',
        'data-homepage-custom-select',
        'footer_contacts: footerContacts',
        'support_channels: supportChannels'
    ].forEach((marker) => {
        assert.equal((marker.startsWith('data-hp-') || marker.startsWith('id="hp-support')) ? fs.readFileSync(path.resolve(__dirname, '../admin-studio.html'), 'utf8').includes(marker) : adminSource.includes(marker), true, `admin support editor should contain ${marker}`);
    });

    assert.doesNotMatch(adminSource, /id="hp-site-layout-(?:support-url|telegram-url|telegram-group-url|contact-email)"/);
    assert.doesNotMatch(adminSource, /Footer 联系方式按站点独立生效/);
    assert.match(runtimeSource, /function applyFooterContacts\(layout\)/);
    assert.match(runtimeSource, /function applySupportChannels\(layout\)/);
    assert.match(runtimeSource, /function getSupportListRenderSignature\(channels, placement\)/);
    assert.match(runtimeSource, /element\.dataset\.siteLayoutSupportSignature === signature/);
    assert.match(runtimeSource, /none:\s*\{ noIcon:\s*true, label:\s*'无' \}/);
    assert.match(runtimeSource, /if \(preset\.noIcon\) \{[\s\S]*?return null;/);
    assert.match(runtimeSource, /function pruneLegacySupportContactNodes\(element\)/);
    assert.match(runtimeSource, /element\.querySelectorAll\('\[data-site-layout-contact\]'\)\.forEach/);
    assert.match(runtimeSource, /applyLogoTargets\(layout\);[\s\S]*?applySupportChannels\(layout\);[\s\S]*?applyFooterContacts\(layout\);/);
    assert.match(runtimeSource, /document\.querySelectorAll\('a\[href\]'\)\.forEach\(\(anchor\) => \{[\s\S]*?if \(anchor\.dataset\.siteLayoutSupportAction\) \{[\s\S]*?return;/);
    assert.match(runtimeSource, /function isSupportListRenderMutation\(mutation\)/);
    assert.match(runtimeSource, /!isSupportListRenderMutation\(mutation\)[\s\S]*?Array\.from\(mutation\.addedNodes \|\| \[\]\)\.some\(hasLayoutManagedNode\)/);
    assert.match(runtimeSource, /function legacyCopySupportText\(value\)/);
    assert.match(runtimeSource, /function tryLegacyCopySupportText\(value\)/);
    assert.match(runtimeSource, /function shouldPreferLegacySupportCopy\(\)/);
    assert.doesNotMatch(runtimeSource, /function showManualSupportCopy/);
    assert.doesNotMatch(runtimeSource, /copy-manual-/);
    assert.doesNotMatch(runtimeSource, /<textarea data-site-layout-support-detail-copy-value/);
    assert.match(runtimeSource, /const isIOS = \/iP\(ad\|hone\|od\)\/\.test\(ua\)/);
    assert.match(runtimeSource, /const isTouchBrowser = Number\(navigator\.maxTouchPoints \|\| 0\) > 0[\s\S]*?global\.matchMedia\?\.\('\(pointer: coarse\)'\)\?\.matches === true;/);
    assert.match(runtimeSource, /node\.style\.left = '0';[\s\S]*?node\.style\.opacity = '0\.01';/);
    assert.match(runtimeSource, /if \(shouldPreferLegacySupportCopy\(\)\) \{[\s\S]*?tryLegacyCopySupportText\(value\);[\s\S]*?return Promise\.resolve\(\);[\s\S]*?navigator\.clipboard\.writeText\(value\)\.catch\(\(\) => Promise\.reject\(legacyError\)\);/);
    assert.match(runtimeSource, /navigator\.clipboard\.writeText\(value\)\.catch\(\(\) => legacyCopySupportText\(value\)\)/);
    assert.match(runtimeSource, /function showSupportFeedback\(message, variant = 'success'\)/);
    assert.match(runtimeSource, /siteLayoutSupportFeedbackToast/);
    assert.match(runtimeSource, /function openSupportDetailDialog\(link\)/);
    assert.match(runtimeSource, /siteLayoutSupportDetailDialog/);
    assert.match(runtimeSource, /data-site-layout-support-detail-copy/);
    assert.match(runtimeSource, /action === 'copy' \|\| action === 'chat' \|\| action === 'detail'/);
    assert.match(runtimeSource, /function getSupportLinkLabelElement\(link\)/);
    assert.match(runtimeSource, /function getSupportLinkInlineFeedbackElement\(link\)/);
    assert.match(runtimeSource, /function setSupportLinkInlineFeedback\(link, message\)/);
    assert.match(runtimeSource, /function clearSupportLinkInlineFeedback\(link\)/);
    assert.match(runtimeSource, /function restoreSupportLinkOriginalLabel\(link\)/);
    assert.match(runtimeSource, /function getSupportActionTarget\(event\)/);
    assert.match(runtimeSource, /function handleSupportActionEvent\(event, options = \{\}\)/);
    assert.match(runtimeSource, /function shouldHandleSupportActionEarly\(action\)/);
    assert.match(runtimeSource, /function shouldHandleSupportActionOnPointerUp\(_action\)/);
    assert.match(runtimeSource, /function shouldHandleSupportActionOnPointerUp\(_action\) \{[\s\S]*?Let ordinary links and mailto anchors keep native click navigation as a fallback\.[\s\S]*?return false;/);
    assert.doesNotMatch(runtimeSource, /return action === 'link' \|\| action === 'email';/);
    assert.match(runtimeSource, /function handleSupportPointerDownEvent\(event\)/);
    assert.match(runtimeSource, /function handleSupportPointerUpEvent\(event\)/);
    assert.match(runtimeSource, /function activateSupportHref\(link, href, event\)/);
    assert.match(runtimeSource, /document\.addEventListener\('pointerdown', handleSupportPointerDownEvent, true\);/);
    assert.match(runtimeSource, /document\.addEventListener\('pointerup', handleSupportPointerUpEvent, true\);/);
    assert.match(runtimeSource, /document\.addEventListener\('pointercancel', clearPendingSupportPointerActivation, true\);/);
    assert.match(runtimeSource, /document\.addEventListener\('click', \(event\) => handleSupportActionEvent\(event\), true\);/);
    assert.match(runtimeSource, /function openSupportLink\(link, event, options = \{\}\)/);
    assert.match(runtimeSource, /global\.open\?\.\(href, target, 'noopener,noreferrer'\)/);
    assert.match(runtimeSource, /const supportFeedbackStateByKey = new Map\(\);/);
    assert.match(runtimeSource, /function rememberSupportLinkFeedback\(link, state, message\)/);
    assert.match(runtimeSource, /function restoreSupportLinkFeedback\(link\)/);
    assert.match(runtimeSource, /restoreSupportLinkFeedback\(anchor\);/);
    assert.match(runtimeSource, /setSupportLinkFeedback\(link, 'opening', getSupportFeedbackText\('link-short'\)\)/);
    assert.match(runtimeSource, /setSupportLinkFeedback\(link, 'opening', getSupportFeedbackText\('email-short'\)\)/);
    assert.doesNotMatch(runtimeSource, /setSupportLinkFeedback\(link, 'opening', getSupportFeedbackText\('copy-pending-short', copyValue\)\)/);
    assert.match(runtimeSource, /setSupportLinkFeedback\(link, 'copied', getSupportFeedbackText\('copy-success-short', copyValue\)\)/);
    assert.match(runtimeSource, /catch\(\(error\) => \{[\s\S]*?error\?\.message === '没有可复制的内容'[\s\S]*?setSupportLinkFeedback\(link, 'copied', getSupportFeedbackText\('copy-success-short', copyValue\)\);[\s\S]*?\}\);/);
    assert.doesNotMatch(runtimeSource, /showSupportFeedback\(getSupportFeedbackText\('copy-pending'/);
    assert.doesNotMatch(runtimeSource, /showSupportFeedback\(message, 'success'\)/);
    assert.match(runtimeSource, /delete target\.dataset\.siteLayoutSupportFeedback;[\s\S]*?setSupportLinkInlineFeedback\(target, message\);/);
    assert.match(runtimeSource, /restoreSupportLinkOriginalLabel\(target\);/);
    assert.match(runtimeSource, /feedback\.className = 'site-support-inline-feedback';/);
    assert.match(runtimeSource, /link\.classList\.add\('site-layout-support-link--inline-feedback-active'\);/);
    assert.match(runtimeSource, /link\.classList\.remove\('site-layout-support-link--inline-feedback-active'\);/);
    assert.match(runtimeSource, /link\.__siteLayoutSupportOriginalAriaLabel = link\.getAttribute\('aria-label'\) \|\| '';/);
    assert.match(runtimeSource, /link\.__siteLayoutSupportOriginalTitle = link\.getAttribute\('title'\) \|\| '';/);
    assert.match(runtimeSource, /link\.setAttribute\('aria-label', text\);[\s\S]*?link\.removeAttribute\('title'\);/);
    assert.doesNotMatch(runtimeSource, /link\.title = text;/);
    assert.doesNotMatch(runtimeSource, /anchor\.title = channel\.description;/);
    assert.doesNotMatch(runtimeSource, /anchor\.title = channel\.description \|\| label;/);
    assert.match(runtimeSource, /anchor\.dataset\.siteLayoutSupportTitle = '';/);
    assert.match(runtimeSource, /if \(label\) \{[\s\S]*?label\.textContent = link\.__siteLayoutSupportOriginalLabel \|\| '';[\s\S]*?link\.removeAttribute\('title'\);[\s\S]*?\} else \{/);
    assert.match(runtimeSource, /anchor\.dataset\.siteLayoutSupportLabel = label;/);
    assert.doesNotMatch(runtimeSource, /const fallbackTitle = link\.dataset\.siteLayoutSupportTitle \|\| fallbackLabel;/);
    assert.doesNotMatch(runtimeSource, /link\.title = link\.__siteLayoutSupportOriginalTitle \|\| fallbackTitle;/);
    assert.match(runtimeSource, /const fallbackLabel = link\.dataset\.siteLayoutSupportLabel \|\| '';/);
    assert.match(runtimeSource, /global\.clearTimeout\(target\.__siteLayoutSupportFeedbackTimer\);[\s\S]*?restoreSupportLinkOriginalLabel\(target\);/);
    assert.match(runtimeSource, /supportIconPresets: SUPPORT_ICON_PRESETS/);
    assert.match(runtimeSource, /detail_image_url: channel\.detail_image_url \|\| ''/);
    assert.match(runtimeSource, /ZaoyoeChatWidgetBootstrap\?\.open/);
    assert.match(runtimeSource, /document\.querySelectorAll\('\[data-site-layout-contact\]'\)/);
    assert.match(runtimeSource, /document\.querySelectorAll\('a\[href\]'\)\.forEach\(\(anchor\) =>/);
    assert.match(runtimeSource, /href === DEFAULT_FOOTER_CONTACTS\.telegram_group_url/);
    assert.match(runtimeSource, /new MutationObserver\(\(mutations\) =>/);
    assert.match(runtimeSource, /Array\.from\(mutation\.addedNodes \|\| \[\]\)\.some\(hasLayoutManagedNode\)/);
    assert.match(runtimeSource, /if \(cachedLayouts\) \{[\s\S]*ensureAppliedWithCurrentDom\(cachedLayouts\);[\s\S]*\}[\s\S]*fetchLayoutsFromPublicApi\(\)/);
    assert.match(runtimeSource, /saveLayoutsToCache\(layouts\);[\s\S]*ensureAppliedWithCurrentDom\(layouts\);/);
    assert.match(framerHomeSource, /data-site-layout-contact="telegram_group"/);
    assert.match(framerHomeSource, /dropdown\.dataset\.siteLayoutSupportList = 'nav';/);
    assert.match(framerHomeCssSource, /\.site-layout-support-toast/);
    assert.match(framerHomeCssSource, /\.site-layout-support-toast\s*\{[\s\S]*?z-index:\s*100140;/);
    assert.match(framerHomeCssSource, /\.site-layout-support-detail-dialog/);
    assert.match(framerHomeCssSource, /\.site-layout-support-detail-dialog\s*\{[\s\S]*?z-index:\s*100150;/);
    assert.match(framerHomeCssSource, /\.site-layout-support-detail-dialog__copy code \{[\s\S]*?font-size:\s*13px;/);
    assert.doesNotMatch(framerHomeCssSource, /\.site-layout-support-detail-dialog__copy textarea/);
    assert.match(framerHomeCssSource, /\.footer-social a\.site-layout-support-link:hover/);
    assert.doesNotMatch(framerHomeCssSource, /\.footer-home-support/);
    assert.match(framerHomeCssSource, /\.footer-social a \{[\s\S]*?width:\s*30px;[\s\S]*?height:\s*30px;[\s\S]*?font-size:\s*14px;/);
    assert.match(framerHomeCssSource, /\.footer-social a \.site-support-icon \{[\s\S]*?font-size:\s*14px;/);
    assert.match(framerHomeCssSource, /\.nav-dropdown-portal a\.site-layout-support-link \{[\s\S]*display: flex;[\s\S]*?border-radius:\s*0;[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*10px 18px;/);
    assert.match(framerHomeCssSource, /\.nav-dropdown-portal\[data-site-layout-support-list="nav"\] \{[\s\S]*?min-width:\s*116px;/);
    assert.match(framerHomeCssSource, /\.nav-dropdown-portal\[data-site-layout-support-list="nav"\] a\.site-layout-support-link \{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?gap:\s*0;[\s\S]*?padding:\s*10px 22px;/);
    assert.match(framerHomeCssSource, /\.nav-dropdown-portal\[data-site-layout-support-list="nav"\] a\.site-layout-support-link \.site-support-icon \{[\s\S]*?display:\s*none;/);
    assert.match(framerHomeCssSource, /\.nav-dropdown-portal a:hover,[\s\S]*?\.nav-dropdown-portal a:focus-visible \{[\s\S]*?background-color:\s*rgba\(255, 255, 255, 0\.08\);[\s\S]*?transform:\s*translateY\(1px\);/);
    assert.match(framerHomeCssSource, /\.nav-dropdown-portal a\.site-layout-support-link:hover/);
    assert.match(framerHomeCssSource, /\.nav-dropdown-portal a\.site-layout-support-link:hover,[\s\S]*?background-color:\s*rgba\(255, 255, 255, 0\.08\) !important;[\s\S]*?transform:\s*translateY\(1px\);[\s\S]*?box-shadow:\s*none;/);
    assert.match(framerHomeCssSource, /html\[data-theme="light"\] \.nav-dropdown-portal a\.site-layout-support-link:hover,[\s\S]*?background-color:\s*rgba\(15, 23, 42, 0\.08\) !important;[\s\S]*?transform:\s*translateY\(1px\);[\s\S]*?box-shadow:\s*none;/);
    assert.match(framerHomeCssSource, /\.nav-dropdown-portal a\.site-layout-support-link:active/);
    assert.match(framerHomeCssSource, /\.footer-support-links \.site-layout-support-link:hover,[\s\S]*?\.footer-bottom-support-links \.site-layout-support-link:focus-visible \{[\s\S]*?color:\s*var\(--text-primary\);[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;[\s\S]*?transform:\s*none;/);
    assert.match(framerHomeCssSource, /\.footer-support-links \.site-layout-support-link:active,[\s\S]*?\.footer-bottom-support-links \.site-layout-support-link:active \{[\s\S]*?transform:\s*none;[\s\S]*?box-shadow:\s*none;/);
    assert.match(framerHomeCssSource, /\.footer-social a:hover \{[^}]*transform:\s*none;[^}]*box-shadow:\s*0 0 0 4px rgba\(42, 171, 238, 0\.08\), 0 10px 22px rgba\(42, 171, 238, 0\.12\);[^}]*\}/);
    assert.doesNotMatch(framerHomeCssSource, /\.footer-social a:hover \{[^}]*transform:\s*scale/);
    assert.match(framerHomeCssSource, /html\[data-theme="light"\] \.footer-social a\.site-layout-support-link:hover,[\s\S]*?box-shadow:\s*0 0 0 4px rgba\(15, 23, 42, 0\.045\), 0 10px 22px rgba\(15, 23, 42, 0\.08\);[\s\S]*?transform:\s*none;/);
    assert.match(framerHomeCssSource, /\.footer-social a\.site-layout-support-link--inline-feedback-active \{[\s\S]*?width:\s*auto;[\s\S]*?min-width:\s*70px;[\s\S]*?border-radius:\s*999px;[\s\S]*?transition:\s*none;[\s\S]*?pointer-events:\s*none;/);
    assert.match(framerHomeCssSource, /\.footer-social a\.site-layout-support-link--inline-feedback-active \.site-support-icon \{[\s\S]*?display:\s*none;/);
    assert.match(framerHomeCssSource, /\.footer-support-links \.site-layout-support-link \.site-support-inline-feedback,[\s\S]*?\.footer-bottom-support-links \.site-layout-support-link \.site-support-inline-feedback \{[\s\S]*?min-width:\s*56px;[\s\S]*?min-height:\s*26px;[\s\S]*?padding:\s*0 9px;[\s\S]*?border-radius:\s*999px;[\s\S]*?pointer-events:\s*none;/);
    assert.match(framerHomeCssSource, /\.footer-support-links \.site-layout-support-link\.site-layout-support-link--inline-feedback-active:hover,[\s\S]*?\.footer-social a\.site-layout-support-link--inline-feedback-active:active \{[\s\S]*?box-shadow:\s*none;[\s\S]*?transform:\s*none !important;/);
    assert.match(framerHomeCssSource, /html\[data-theme="light"\] \.footer-support-links \.site-layout-support-link--inline-feedback-active:hover,[\s\S]*?\.footer-bottom-support-links \.site-layout-support-link--inline-feedback-active:active \{[\s\S]*?background:\s*transparent !important;[\s\S]*?box-shadow:\s*none;[\s\S]*?transform:\s*none !important;/);
    assert.match(framerHomeCssSource, /html\[data-theme="light"\] \.footer-support-links \.site-layout-support-link--inline-feedback-active \.site-support-inline-feedback,[\s\S]*?\.footer-bottom-support-links \.site-layout-support-link--inline-feedback-active \.site-support-inline-feedback \{[\s\S]*?background:\s*rgba\(22, 163, 74, 0\.1\);/);
    assert.match(framerHomeCssSource, /\.footer-support-links \.site-layout-support-link\.site-layout-support-link--inline-feedback-active \.site-support-icon,[\s\S]*?\.footer-bottom-support-links \.site-layout-support-link\.site-layout-support-link--inline-feedback-active > span:not\(\.site-support-inline-feedback\) \{[\s\S]*?opacity:\s*0;/);
    assert.match(framerHomeCssSource, /\.footer-social a \.site-support-inline-feedback \{[\s\S]*?white-space:\s*nowrap;/);
    assert.doesNotMatch(framerHomeCriticalCssSource, /\.nav-dropdown-portal a\.site-layout-support-link:hover/);
    assert.doesNotMatch(framerHomeCriticalCssSource, /html\[data-theme="light"\] \.nav-dropdown-portal a\.site-layout-support-link:hover/);
    assert.doesNotMatch(framerHomeCssSource, /\.site-layout-support-link\[data-site-layout-support-feedback\]/);
    assert.match(adminStudioPageCssSource, /#module-homepage \.hp-support-enabled-toggle input,[\s\S]*?#module-homepage \.hp-support-placement input \{[\s\S]*?appearance:\s*none;/);
    assert.match(adminStudioPageCssSource, /#module-homepage \.hp-support-checkmark::after \{/);
    assert.match(adminStudioPageCssSource, /#module-homepage \.hp-ops-form-grid\.hp-support-channel-grid \{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(150px, 1fr\)\) !important;/);
    assert.match(adminStudioPageCssSource, /#module-homepage \.hp-ops-form-grid\.hp-support-detail-grid \{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(150px, 1fr\)\) !important;/);
    assert.match(adminStudioPageCssSource, /@media \(max-width:\s*900px\) \{[\s\S]*?#module-homepage \.hp-ops-form-grid\.hp-support-channel-grid,[\s\S]*?#module-homepage \.hp-ops-form-grid\.hp-support-detail-grid \{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\) !important;/);
    assert.match(adminStudioPageCssSource, /#module-homepage \.hp-support-channel-card__details\[hidden\] \{[\s\S]*?display:\s*none !important;/);
    assert.match(adminStudioPageCssSource, /#module-homepage \.hp-support-channel-card__toggle\[aria-expanded="true"\] i \{[\s\S]*?transform:\s*rotate\(180deg\);/);
    assert.match(adminStudioPageCssSource, /--hp-support-admin-blue:\s*var\(--admin-studio-ui-blue, #769dca\);/);
    assert.match(adminStudioPageCssSource, /--hp-support-admin-blue-rgb:\s*var\(--admin-studio-ui-blue-rgb, 118, 157, 202\);/);
    assert.match(adminStudioPageCssSource, /#module-homepage \.hp-support-channel-grid > \.hp-support-enabled-toggle \{[\s\S]*?align-self:\s*end;/);
    assert.match(adminStudioPageCssSource, /#module-homepage \.hp-support-enabled-toggle input:checked \+ \.hp-support-checkmark,[\s\S]*?background:\s*var\(--admin-studio-ui-blue, #769dca\);/);
    assert.match(adminStudioPageCssSource, /#module-homepage \.hp-support-channel-card \.hp-custom-select__option:hover,[\s\S]*?color:\s*var\(--hp-support-admin-blue\);/);
    assert.doesNotMatch(adminStudioPageCssSource, /#module-homepage \.hp-support-(?:enabled-toggle|placement)[\s\S]{0,260}accent-color/);
    assert.doesNotMatch(framerHomeCssSource, /content: attr\(data-site-layout-support-feedback\);/);
    assert.doesNotMatch(framerHomeCssSource, /\.footer-social a\.site-layout-support-link\[data-site-layout-support-feedback\]::after/);
    assert.match(framerNavSource, /data-site-layout-contact="telegram_group"/);
    assert.match(framerNavSource, /dropdown\.dataset\.siteLayoutSupportList = 'nav';/);
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
