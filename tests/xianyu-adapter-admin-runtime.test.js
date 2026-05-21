const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildXianyuAdapterConfigFromAdmin,
    loadXianyuAdminAdapterConfig,
    resolveWebsiteBaseUrl
} = require('../adapters/xianyu/admin-runtime');

function createMarketplaceConfig(overrides = {}) {
    return {
        enabled: true,
        default_channel_key: 'website',
        inventory_mode: 'shared',
        channels: [
            {
                key: 'website',
                type: 'website',
                label: '网站',
                enabled: true,
                inventory_mode: 'shared',
                delivery_mode: 'manual',
                accounts: []
            },
            {
                key: 'xianyu',
                type: 'xianyu',
                label: '闲鱼',
                enabled: true,
                inventory_mode: 'shared',
                delivery_mode: 'auto',
                default_account_key: 'main',
                multi_account: true,
                product_mappings: [
                    {
                        label: '后台商品映射',
                        xianyu_item_id: 'xy-admin-item-1',
                        product_id: '11111111-1111-4111-8111-111111111111'
                    }
                ],
                accounts: [
                    {
                        key: 'main',
                        label: '主号',
                        enabled: true,
                        secret_names: ['ingest_token']
                    },
                    {
                        key: 'backup-1',
                        label: '备用号',
                        enabled: true,
                        secret_names: ['ingest_token']
                    }
                ],
                ...overrides.xianyu
            }
        ],
        ...overrides.root
    };
}

test('xianyu admin runtime builds adapter config from Admin Studio registry', () => {
    const config = buildXianyuAdapterConfigFromAdmin({
        marketplaceConfig: createMarketplaceConfig(),
        accountKey: 'backup-1',
        websiteBaseUrl: 'https://www.zaoyoe.com/',
        site: 'intl',
        dryRun: true
    });

    assert.equal(config.website_base_url, 'https://www.zaoyoe.com');
    assert.equal(config.channel, 'xianyu');
    assert.equal(config.account, 'backup-1');
    assert.equal(config.account_label, '备用号');
    assert.equal(config.site, 'intl');
    assert.equal(config.dry_run, true);
    assert.equal(config.product_mappings.length, 1);
    assert.equal(config.product_mappings[0].xianyu_item_id, 'xy-admin-item-1');
});

test('xianyu admin runtime loads ingest token only when submit mode needs it', async () => {
    const secretReads = [];
    const config = await loadXianyuAdminAdapterConfig({
        accountKey: 'main',
        websiteBaseUrl: 'https://www.zaoyoe.com',
        includeSecret: true,
        supabase: {},
        async loadMarketplaceConfig() {
            return createMarketplaceConfig();
        },
        async getStoredSecret(_supabase, secretKey) {
            secretReads.push(secretKey);
            return {
                value: 'stored-admin-token'
            };
        }
    });

    assert.deepEqual(secretReads, ['marketplace__xianyu__main__ingest_token']);
    assert.equal(config.ingest_token, 'stored-admin-token');
});

test('xianyu admin runtime fails clearly when selected account is disabled', () => {
    assert.throws(
        () => buildXianyuAdapterConfigFromAdmin({
            marketplaceConfig: createMarketplaceConfig({
                xianyu: {
                    accounts: [
                        {
                            key: 'main',
                            label: '主号',
                            enabled: false
                        }
                    ]
                }
            }),
            accountKey: 'main',
            websiteBaseUrl: 'https://www.zaoyoe.com'
        }),
        /闲鱼账号已停用/
    );
});

test('xianyu admin runtime can infer website base URL from environment', () => {
    assert.equal(
        resolveWebsiteBaseUrl({}, {
            APP_BASE_URL: 'https://www.zaoyoe.com/'
        }),
        'https://www.zaoyoe.com'
    );
});
