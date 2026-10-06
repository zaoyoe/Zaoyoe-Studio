const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const preloadScriptPath = path.resolve(__dirname, '../js/section-visibility-preload.js');
const preloadScriptSource = fs.readFileSync(preloadScriptPath, 'utf8');
const htmlFilesWithSharedNav = [
    'index.html',
    'shop.html',
    'prompts.html',
    'verify.html',
    'guestbook.html',
    'privacy.html',
    'reset-password.html'
];

function createDocumentMock() {
    const nodes = new Map();
    const head = {
        appendChild(node) {
            node.parentNode = head;
            if (node.id) {
                nodes.set(node.id, node);
            }
            return node;
        },
        removeChild(node) {
            if (node?.id) {
                nodes.delete(node.id);
            }
            node.parentNode = null;
            return node;
        }
    };

    return {
        head,
        body: {
            appendChild(node) {
                return head.appendChild(node);
            }
        },
        documentElement: {
            appendChild(node) {
                return head.appendChild(node);
            }
        },
        createElement(tagName) {
            return {
                tagName: String(tagName || '').toUpperCase(),
                id: '',
                type: '',
                textContent: '',
                parentNode: null,
                remove() {
                    if (this.parentNode && typeof this.parentNode.removeChild === 'function') {
                        this.parentNode.removeChild(this);
                    }
                }
            };
        },
        getElementById(id) {
            return nodes.get(id) || null;
        }
    };
}

function executePreloadScript({ url = 'https://zaoyoe.xyz/shop.html', cacheConfig = null } = {}) {
    const document = createDocumentMock();
    const location = new URL(url);
    const localStorage = {
        getItem(key) {
            const site = key.replace(/^zaoyoe_section_vis_/, '');
            const expectedSite = location.searchParams.get('site')
                || (location.hostname.includes('zaoyoe.xyz') ? 'intl' : 'cn');

            if (cacheConfig && site === expectedSite) {
                return JSON.stringify(cacheConfig);
            }
            return null;
        }
    };
    const windowObject = {
        location,
        localStorage,
        document,
        console
    };
    const context = vm.createContext({
        window: windowObject,
        document,
        localStorage,
        console,
        URL,
        URLSearchParams,
        globalThis: windowObject
    });

    vm.runInContext(preloadScriptSource, context);

    return {
        document,
        windowObject
    };
}

test('section visibility preload injects hidden nav rules from cached intl visibility config', () => {
    const { document, windowObject } = executePreloadScript({
        url: 'https://zaoyoe.xyz/shop.html',
        cacheConfig: {
            prompts: false,
            gongyi: false,
            shop: true,
            verify: true,
            guestbook: false,
            hero: true,
            ticker: true,
            footer: true
        }
    });

    const styleElement = document.getElementById('section-visibility-preload-style');

    assert.ok(styleElement);
    assert.equal(windowObject.SectionVisibilityPreload.detectSite(), 'intl');
    assert.match(styleElement.textContent, /\/prompts\.html/);
    assert.match(styleElement.textContent, /sub2api\.fatherkey\.com/);
    assert.match(styleElement.textContent, /sub2api\.zaoyoe\.xyz/);
    assert.match(styleElement.textContent, /\/guestbook\.html/);
    assert.match(styleElement.textContent, /data-submenu="prompts-mobile"/);
    assert.doesNotMatch(styleElement.textContent, /\.nav-menu a\[href="\/verify\.html"\]/);
});

test('section visibility preload removes the injected style when every section is visible again', () => {
    const { document, windowObject } = executePreloadScript({
        url: 'http://127.0.0.1:8000/shop.html?site=intl',
        cacheConfig: {
            prompts: false,
            gongyi: true,
            shop: true,
            verify: true,
            guestbook: true,
            hero: true,
            ticker: true,
            footer: true
        }
    });

    assert.ok(document.getElementById('section-visibility-preload-style'));

    windowObject.SectionVisibilityPreload.applyConfig({
        prompts: true,
        gongyi: true,
        shop: true,
        verify: true,
        guestbook: true,
        hero: true,
        ticker: true,
        footer: true
    });

    assert.equal(document.getElementById('section-visibility-preload-style'), null);
});

test('shared-nav public pages include the section visibility preload before first paint', () => {
    htmlFilesWithSharedNav.forEach((fileName) => {
        const source = fs.readFileSync(path.resolve(__dirname, '..', fileName), 'utf8');
        assert.match(
            source,
            /<script src="\.\/js\/section-visibility-preload\.js\?v=20260528_GONGYI_SITE_AWARE_1"><\/script>/
        );
        assert.match(
            source,
            /<script src="\/api\/runtime\/section-visibility-preload" async><\/script>/
        );
    });
});

test('section visibility preload injects hidden hero entry rules when a section like verify is disabled', () => {
    const { document } = executePreloadScript({
        url: 'https://www.fatherkey.com/',
        cacheConfig: {
            hero: true,
            prompts: true,
            shop: true,
            gongyi: true,
            verify: false,
            guestbook: true,
            ticker: true,
            footer: true
        }
    });

    const styleElement = document.getElementById('section-visibility-preload-style');
    assert.ok(styleElement, 'preload style element should be created');

    const css = styleElement.textContent;
    assert.match(css, /\.hero-carousel a\.entry-card\[href="\/verify\.html"\]/, 'should hide verify card by href');
    assert.match(css, /\.hero-carousel \.entry-card\[data-home-entry-section="verify"\]/, 'should hide verify card by section');
    assert.match(css, /\.hero-carousel \.entry-card\[data-home-entry-id="verify"\]/, 'should hide verify card by entry id');
    assert.match(css, /\.hero-section\[data-home-static-hero="1"\]:not\(\[data-render-signature\]\) \.hero-carousel-track/, 'should adjust static hero track');
    assert.match(css, /grid-auto-flow:\s*column !important;/, 'should switch to auto-flowing columns for remaining visible cards');
});
