const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const externalPolicy = require('../api/_lib/engagement-external-policy');

const ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('external engagement embed can mount the robot runtime on gongyi pages', () => {
    const embed = readRepoFile('js/engagement-external-embed.js');

    assert.match(embed, /20260505_GONGYI_EXTERNAL_ENGAGEMENT_1/);
    assert.match(embed, /DEFAULT_PAGE_ID\s*=\s*'gongyi'/);
    assert.match(embed, /CHAT_WIDGET_LOADER_SRC\s*=\s*'js\/chat-widget-loader\.js\?v=20260514_CHAT_WIDGET_ADMIN_FIRST_OPEN_1&siteAssetCdn=20260510_SITE_ASSET_CDN_1'/);
    assert.match(embed, /CHAT_WIDGET_STYLE_SRC\s*=\s*'css\/chat-widget\.css\?v=20260507_CHAT_WIDGET_ADAPTIVE_BUBBLE_1'/);
    assert.match(embed, /data-page-id|pageId/);
    assert.match(embed, /data-api-origin|apiOrigin/);
    assert.match(embed, /data-asset-base|assetBase/);
    assert.match(embed, /externalHost:\s*true/);
    assert.match(embed, /installSupabaseStub/);
    assert.match(embed, /installSiteConfig/);
    assert.match(embed, /getAssetCdnOriginForSite/);
    assert.match(embed, /normalizeAssetUrlForCurrentSite/);
    assert.match(embed, /cdn\.zaoyoe\.xyz/);
    assert.match(embed, /document\.documentElement\.dataset\.engagementPageId\s*=\s*config\.pageId/);
    assert.match(embed, /global\.ZaoyoeExternalEngagementConfig\s*=\s*config/);
    assert.match(embed, /global\.ZaoyoeEngagementExternalConfig\s*=\s*config/);
    assert.match(embed, /script\.dataset\.assetBase\s*=\s*config\.assetBase/);
    assert.match(embed, /global\.ZaoyoeChatWidgetBootstrap\?\.warm\?\.\(\)/);
    assert.match(embed, /global\.ZaoyoeChatWidgetBootstrap\?\.open\?\.\(\)/);
});

test('chat widget loader resolves assets from external embed asset base', () => {
    const loader = readRepoFile('js/chat-widget-loader.js');

    assert.match(loader, /getExternalEngagementConfig/);
    assert.match(loader, /getLoaderAssetBase/);
    assert.match(loader, /resolveAssetUrl/);
    assert.match(loader, /script\?\.dataset\.assetBase/);
    assert.match(loader, /CHAT_WIDGET_STYLE_SRC\s*=\s*'css\/chat-widget\.css\?v=20260507_CHAT_WIDGET_ADAPTIVE_BUBBLE_1'/);
    assert.match(loader, /ensureFullChatWidgetStylesheet/);
    assert.match(loader, /config\.externalHost\s*===\s*true/);
    assert.match(loader, /String\(config\.pageId\s*\|\|\s*config\.page_id\s*\|\|\s*''\)\.trim\(\)\s*===\s*'gongyi'/);
    assert.match(loader, /const resolvedSrc = resolveAssetUrl\(src\)/);
    assert.match(loader, /script\.src\s*=\s*resolvedSrc/);
});

test('chat widget runtime can fetch engagement feed and events from an external API origin', () => {
    const widget = readRepoFile('js/components/ChatWidget.js');

    assert.match(widget, /ZaoyoeExternalEngagementConfig\?\.pageId/);
    assert.match(widget, /ZaoyoeEngagementExternalConfig\?\.pageId/);
    assert.match(widget, /document\.documentElement\?\.dataset\?\.engagementPageId/);
    assert.match(widget, /'gongyi'/);
    assert.match(widget, /getEngagementExternalConfig\(\)/);
    assert.match(widget, /getEngagementApiOrigin\(\)/);
    assert.match(widget, /resolveEngagementApiUrl\(pathname = ''\)/);
    assert.match(widget, /getEngagementFetchCredentials\(\)/);
    assert.match(widget, /credentials:\s*this\.getEngagementFetchCredentials\(\)/);
    assert.match(widget, /externalSite\s*=\s*String\(this\.getEngagementExternalConfig\(\)\.site/);
    assert.match(widget, /external_host:\s*this\.getEngagementExternalConfig\(\)\.externalHost\s*===\s*true/);
    assert.match(widget, /page_origin:\s*String\(window\.location\?\.origin/);
    assert.match(widget, /page_host:\s*String\(window\.location\?\.host/);
    assert.match(widget, /external_api_origin:\s*this\.getEngagementApiOrigin\(\)/);
});

test('public engagement API allows controlled CORS for external gongyi host', () => {
    const handler = readRepoFile('server/api-handlers/public/engagement.js');

    assert.match(handler, /engagement-external-policy/);
    assert.match(handler, /EXTERNAL_EMBED_POLICY_CONFIG_KEY/);
    assert.match(handler, /fetchEngagementCorsPolicy/);
    assert.match(handler, /normalizeExternalEmbedPolicy/);
    assert.match(handler, /policy\.allowed_origins/);
    assert.match(handler, /policy\.allow_local_preview && isLocalPreviewOrigin/);
    assert.match(handler, /Access-Control-Allow-Origin/);
    assert.match(handler, /Access-Control-Allow-Methods', 'GET,POST,OPTIONS'/);
    assert.match(handler, /Access-Control-Allow-Headers', 'Content-Type,Authorization'/);
    assert.match(handler, /handleEngagementOptions/);
    assert.match(handler, /req\.method === 'OPTIONS'/);
    assert.match(handler, /res\.statusCode = 204/);
});

test('external engagement policy builds deployable snippets and diagnostics', () => {
    const policy = externalPolicy.normalizeExternalEmbedPolicy({
        allowed_origins: 'https://gongyi.zaoyoe.com\nhttps://custom.example.com',
        api_origin: 'https://www.zaoyoe.com/api/../',
        asset_base: 'https://cdn.zaoyoe.com/assets',
        default_page_id: 'gongyi',
        default_site: 'cn'
    });

    assert.equal(policy.enabled, true);
    assert.deepEqual(policy.allowed_origins, ['https://gongyi.zaoyoe.com', 'https://custom.example.com']);
    assert.equal(policy.api_origin, 'https://www.zaoyoe.com');
    assert.equal(policy.asset_base, 'https://cdn.zaoyoe.com/assets/');

    const snippet = externalPolicy.buildExternalEmbedSnippet(policy);
    assert.match(snippet, /engagement-external-embed\.js\?v=20260505_GONGYI_EXTERNAL_ENGAGEMENT_1/);
    assert.match(snippet, /data-page-id="gongyi"/);
    assert.match(snippet, /data-api-origin="https:\/\/www\.zaoyoe\.com"/);
    assert.match(snippet, /data-asset-base="https:\/\/cdn\.zaoyoe\.com\/assets\/"/);

    const diagnostics = externalPolicy.buildExternalEmbedDiagnostics(policy);
    assert.equal(diagnostics.status, 'ready');
    assert.equal(diagnostics.has_gongyi_origin, true);
    assert.match(diagnostics.preflight_url, /\/api\/engagement\/feed\?/);
});

test('admin studio exposes external embed governance and deployment controls', () => {
    const adminApi = readRepoFile('api/admin.js');
    const externalHandler = readRepoFile('server/api-handlers/admin/engagement/external.js');
    const overview = readRepoFile('server/api-handlers/admin/engagement/overview.js');
    const engagementJs = readRepoFile('js/admin-engagement.js');
    const engagementCss = readRepoFile('css/admin-engagement.css');

    assert.match(adminApi, /engagementExternalHandler/);
    assert.match(adminApi, /'engagement\/external': engagementExternalHandler/);
    assert.match(externalHandler, /engagement-external-policy/);
    assert.match(externalHandler, /config_key: CONFIG_KEY/);
    assert.match(externalHandler, /buildExternalEmbedSnippet/);
    assert.match(externalHandler, /buildExternalEmbedDiagnostics/);
    assert.match(externalHandler, /engagement\.external\.policy\.update/);
    assert.match(overview, /buildExternalDeploymentAnalytics/);
    assert.match(overview, /buildExternalDeploymentTroubleshooting/);
    assert.match(overview, /runOverviewTask/);
    assert.match(overview, /OVERVIEW_TASK_TIMEOUT_MS/);
    assert.match(overview, /OVERVIEW_AUTH_TIMEOUT_MS/);
    assert.match(overview, /admin_auth/);
    assert.match(overview, /statusCode:\s*Number\(error\.statusCode/);
    assert.match(overview, /客服系统鉴权超时/);
    assert.match(overview, /overview_health: overviewHealth/);
    assert.match(overview, /api_origin_breakdown/);
    assert.match(overview, /recommended_actions/);
    assert.match(overview, /external_embed: buildExternalEmbedOverview\(externalEmbed, eventRows\)/);
    assert.match(engagementJs, /renderExternalEmbedPanel/);
    assert.match(engagementJs, /collectExternalEmbedFormPayload/);
    assert.match(engagementJs, /copyExternalEmbedSnippet/);
    assert.match(engagementJs, /data-engagement-action="submit-external-embed"/);
    assert.match(engagementJs, /engagement-external-submit-btn/);
    assert.match(engagementJs, /data-engagement-action="copy-external-embed-snippet"/);
    assert.match(engagementJs, /engagement-rule-form engagement-management-form engagement-external-form/);
    assert.match(engagementJs, /API中转嵌入代码/);
    assert.match(engagementJs, /排障与回流观测/);
    assert.match(engagementJs, /异常诊断/);
    assert.match(engagementJs, /engagement-external-troubleshoot/);
    assert.match(engagementJs, /真实部署回流/);
    assert.match(engagementJs, /engagement-external-observability/);
    assert.match(engagementCss, /\.engagement-external-grid/);
    assert.match(engagementCss, /\.engagement-external-form/);
    assert.match(engagementCss, /\.engagement-external-submit-btn/);
    assert.match(engagementCss, /\.engagement-external-details/);
    assert.match(engagementCss, /\.engagement-external-troubleshoot/);
    assert.match(engagementCss, /\.engagement-external-observability/);
    assert.match(engagementCss, /html\[data-theme="dark"\] \.engagement-external-deploy/);
});
