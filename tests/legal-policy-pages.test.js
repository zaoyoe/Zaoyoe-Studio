const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const pageNames = ['terms.html', 'privacy.html', 'refund-policy.html'];
const pages = Object.fromEntries(pageNames.map((name) => [
    name,
    fs.readFileSync(path.join(repoRoot, name), 'utf8')
]));

test('legal pages use site-aware branding and cross-link all policies', () => {
    for (const [name, source] of Object.entries(pages)) {
        assert.match(source, /Zaoyoe Studio/);
        assert.match(source, /早鸟工作室/);
        assert.match(source, /data-legal-brand-name/);
        assert.match(source, /js\/legal-policy-page\.js\?v=20260730_LEGAL_SITE_BRAND_1/);
        assert.match(source, /href="\/terms\.html"/);
        assert.match(source, /href="\/privacy\.html"/);
        assert.match(source, /href="\/refund-policy\.html"/);
        assert.match(source, /mailto:zaoyoe@gmail\.com/);
        assert.doesNotMatch(source, /MeiGen|meigen\.ai|support@meigen|郑州市金水区美镜/);
        assert.match(source, /css\/privacy-page\.css\?v=20260730_LEGAL_POLICIES_1/);
        assert.ok(source.includes('<svg viewBox="0 0 100 100"'), `${name} should show the Zaoyoe mark`);
    }
});

test('all legal pages include the shared desktop and mobile site navigation', () => {
    for (const [name, source] of Object.entries(pages)) {
        assert.match(source, /<nav class="framer-nav">/, `${name} should include the desktop navigation`);
        assert.match(source, /<div class="mobile-menu">/, `${name} should include the mobile navigation`);
        assert.match(source, /id="auth-container"/, `${name} should include the navigation account mount`);
        assert.match(source, /href="\/prompts\.html"/, `${name} should link to prompts`);
        assert.match(source, /href="\/verify\.html"/, `${name} should link to verify`);
        assert.match(source, /href="\/shop\.html"/, `${name} should link to the shop`);
        assert.match(source, /href="\/guestbook\.html"/, `${name} should link to the guestbook`);
        assert.match(source, /css\/framer_home\.css/, `${name} should load the shared navigation styles`);
        assert.match(source, /js\/framer-nav-runtime\.js/, `${name} should load the shared navigation runtime`);
    }
});

test('legal policy brand runtime maps Fatherkey and Zaoyoe domains correctly', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'js/legal-policy-page.js'), 'utf8');

    function renderFor(hostname, search = '') {
        const brandNodes = Array.from({ length: 3 }, () => ({ textContent: 'Zaoyoe Studio' }));
        const homeLink = {
            ariaLabel: '',
            setAttribute(name, value) {
                if (name === 'aria-label') this.ariaLabel = value;
            }
        };
        const description = {
            dataset: { legalDescription: '隐私政策说明。' },
            content: '',
            setAttribute(name, value) {
                if (name === 'content') this.content = value;
            }
        };
        const root = {
            brand: '',
            setAttribute(name, value) {
                if (name === 'data-legal-brand') this.brand = value;
            }
        };
        const document = {
            title: '隐私政策 - Zaoyoe Studio',
            documentElement: root,
            querySelectorAll(selector) {
                if (selector === '[data-legal-brand-name]') return brandNodes;
                if (selector === '[data-legal-brand-home-link]') return [homeLink];
                return [];
            },
            querySelector(selector) {
                if (selector === 'h1') return { textContent: '隐私政策' };
                if (selector === 'meta[name="description"][data-legal-description]') return description;
                return null;
            }
        };
        const window = { document, location: { hostname, search } };

        vm.runInNewContext(source, { window, globalThis: window, URLSearchParams });
        return { brandNodes, homeLink, description, root, title: document.title };
    }

    const fatherkey = renderFor('www.fatherkey.com');
    assert.equal(fatherkey.root.brand, 'cn');
    assert.deepEqual(fatherkey.brandNodes.map((node) => node.textContent), ['Fatherkey', 'Fatherkey', 'Fatherkey']);
    assert.equal(fatherkey.homeLink.ariaLabel, '返回 Fatherkey 首页');
    assert.equal(fatherkey.title, '隐私政策 - Fatherkey');
    assert.equal(fatherkey.description.content, 'Fatherkey 隐私政策说明。');

    const zaoyoe = renderFor('zaoyoe.xyz');
    assert.equal(zaoyoe.root.brand, 'intl');
    assert.deepEqual(zaoyoe.brandNodes.map((node) => node.textContent), ['Zaoyoe Studio', 'Zaoyoe Studio', 'Zaoyoe Studio']);
    assert.equal(zaoyoe.homeLink.ariaLabel, '返回 Zaoyoe Studio 首页');
    assert.equal(zaoyoe.title, '隐私政策 - Zaoyoe Studio');
});

test('privacy policy explains AI workbench data and third-party processing', () => {
    const source = pages['privacy.html'];
    assert.match(source, /AI 工作台内容/);
    assert.match(source, /AI 计费与接口信息/);
    assert.match(source, /模型提供商、API 中转服务或相关技术合作方/);
    assert.match(source, /请勿提交密码、证件、银行卡、商业秘密/);
});

test('terms cover AI inputs, outputs, billing, moderation, and user API keys', () => {
    const source = pages['terms.html'];
    assert.match(source, /1\.1 服务内容/);
    assert.match(source, /1\.2 协议生效/);
    assert.match(source, /来自 X 等公开分享渠道/);
    assert.match(source, /提示词缩略图及详情页中标注内容来源、原作者名称和账号 ID/);
    assert.match(source, /“查看原贴”入口/);
    assert.match(source, /系统保存的原始发布页面/);
    assert.match(source, /当前免费提供提示词文本的查看和复制，无需购买积分/);
    assert.match(source, /自有 API Key 模式/);
    assert.match(source, /AI 输出具有随机性/);
    assert.match(source, /自动或人工方式审核请求/);
    assert.match(source, /除非您主动使用明确的公开投稿或发布功能/);
    assert.match(source, /积分是用于计量和兑换站内数字服务的虚拟权益/);
});

test('legal policies describe the implemented prompt source attribution flow truthfully', () => {
    const terms = pages['terms.html'];
    const privacy = pages['privacy.html'];

    for (const source of [terms, privacy]) {
        assert.match(source, /原作者名称和账号 ID/);
        assert.match(source, /“查看原贴”入口/);
        assert.match(source, /原始发布页面/);
        assert.match(source, /公开发布不当然表示相关内容属于公有领域/);
        assert.match(source, /不就第三方提示词收取授权费用/);
        assert.match(source, /不表示本站拥有或向用户授予相关知识产权许可/);
        assert.match(source, /用于个人或商业创作前/);
        assert.match(source, /自行判断并取得必要授权/);
        assert.match(source, /提示词文本的免费查看和复制/);
        assert.match(source, /展示图片、完整提示词卡片/);
        assert.doesNotMatch(source, /购买积分、解锁提示词/);
        assert.doesNotMatch(source, /不主动复制、搬运/);
    }

    assert.match(privacy, /公开来源与作者署名信息/);
    assert.match(privacy, /原始发布链接、原作者公开名称、公开账号 ID/);
    assert.doesNotMatch(privacy, /提示词解锁/);
});

test('refund policy distinguishes platform points from third-party API charges', () => {
    const source = pages['refund-policy.html'];
    assert.match(source, /明确拒绝或未执行/);
    assert.match(source, /部分结果/);
    assert.match(source, /自有 API Key 模式/);
    assert.match(source, /重复扣款/);
    assert.match(source, /AI 输出具有随机性/);
});

test('sitemap publishes all three legal pages', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'sitemap.xml'), 'utf8');
    assert.match(source, /https:\/\/www\.fatherkey\.com\/terms\.html/);
    assert.match(source, /https:\/\/www\.fatherkey\.com\/privacy\.html/);
    assert.match(source, /https:\/\/www\.fatherkey\.com\/refund-policy\.html/);
});
