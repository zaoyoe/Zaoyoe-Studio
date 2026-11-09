const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SPOTLIGHT_JS = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'prompt-spotlight.js'),
    'utf8'
);
const DOCK_JS = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'magnifying-dock.js'),
    'utf8'
);
const DOCK_CSS = fs.readFileSync(
    path.resolve(__dirname, '..', 'css', 'magnifying-dock.css'),
    'utf8'
);
const PROMPTS_HTML = fs.readFileSync(
    path.resolve(__dirname, '..', 'prompts.html'),
    'utf8'
);
const SHOP_HTML = fs.readFileSync(
    path.resolve(__dirname, '..', 'shop.html'),
    'utf8'
);

function createMockEnvironment() {
    class FakeClassList {
        constructor() {
            this.set = new Set();
        }
        add(...tokens) {
            tokens.forEach((t) => this.set.add(t));
        }
        remove(...tokens) {
            tokens.forEach((t) => this.set.delete(t));
        }
        contains(token) {
            return this.set.has(token);
        }
        toggle(token, force) {
            const has = this.set.has(token);
            const next = force !== undefined ? Boolean(force) : !has;
            if (next) this.set.add(token);
            else this.set.delete(token);
            return next;
        }
    }

    class FakeElement {
        constructor(tagName) {
            this.tagName = tagName.toUpperCase();
            this.classList = new FakeClassList();
            this.children = [];
            this.listeners = new Map();
            this.dataset = {};
            this.attributes = new Map();
            this.value = '';
            this.hidden = false;
            this.style = {};
            this._innerHTML = '';
        }
        set innerHTML(val) {
            this._innerHTML = val;
            const backdrop = new FakeElement('div');
            backdrop.setAttribute('id', 'promptSpotlightBackdrop');
            backdrop.classList.add('prompt-spotlight-backdrop');
            const capsule = new FakeElement('div');
            capsule.setAttribute('id', 'promptSpotlightCapsule');
            capsule.classList.add('prompt-spotlight-capsule');
            capsule.classList.add('gdock');
            const input = new FakeElement('input');
            input.setAttribute('id', 'promptSpotlightInput');
            input.classList.add('prompt-spotlight-input');
            const phMatch = val.match(/placeholder="([^"]+)"/);
            if (phMatch) {
                input.placeholder = phMatch[1];
                input.setAttribute('placeholder', phMatch[1]);
            }
            const ariaMatch = val.match(/aria-label="([^"]+)"/);
            if (ariaMatch) {
                capsule.setAttribute('aria-label', ariaMatch[1]);
            }
            const actionBtn = new FakeElement('button');
            actionBtn.setAttribute('id', 'promptSpotlightActionBtn');
            actionBtn.classList.add('prompt-spotlight-action-btn');
            const clear = actionBtn;
            const esc = new FakeElement('button');
            esc.setAttribute('id', 'promptSpotlightEsc');
            esc.classList.add('prompt-spotlight-esc');

            docElements.set('promptSpotlightOverlay', this);
            docElements.set('promptSpotlightBackdrop', backdrop);
            docElements.set('promptSpotlightCapsule', capsule);
            docElements.set('promptSpotlightInput', input);
            docElements.set('promptSpotlightActionBtn', actionBtn);
            docElements.set('promptSpotlightClear', clear);
            docElements.set('promptSpotlightEsc', esc);
        }
        get innerHTML() {
            return this._innerHTML;
        }
        closest(selector) {
            return this;
        }
        setAttribute(name, val) {
            this.attributes.set(name, String(val));
        }
        getAttribute(name) {
            return this.attributes.get(name) || null;
        }
        removeAttribute(name) {
            this.attributes.delete(name);
        }
        addEventListener(evt, fn) {
            if (!this.listeners.has(evt)) this.listeners.set(evt, []);
            this.listeners.get(evt).push(fn);
        }
        dispatchEvent(evt) {
            const fns = this.listeners.get(evt.type) || [];
            fns.forEach((fn) => fn(evt));
            return true;
        }
        appendChild(child) {
            this.children.push(child);
            return child;
        }
        getBoundingClientRect() {
            return { top: 0, bottom: 64, left: 0, right: 1200, width: 1200, height: 64 };
        }
        querySelector(selector) {
            if (selector.includes('backdrop')) return docElements.get('promptSpotlightBackdrop') || null;
            if (selector.includes('capsule')) return docElements.get('promptSpotlightCapsule') || null;
            if (selector.includes('input')) return docElements.get('promptSpotlightInput') || null;
            if (selector.includes('action-btn') || selector.includes('clear')) return docElements.get('promptSpotlightActionBtn') || docElements.get('promptSpotlightClear') || null;
            if (selector.includes('esc')) return docElements.get('promptSpotlightEsc') || null;
            return null;
        }
        focus() {}
        select() {}
        blur() {}
    }

    const docElements = new Map();
    const fakeBody = new FakeElement('body');
    const fakeNav = new FakeElement('nav');
    fakeNav.classList.add('framer-nav');
    const fakeGallerySearch = new FakeElement('input');
    fakeGallerySearch.setAttribute('id', 'gallerySearch');
    const fakeListSearchInput = new FakeElement('input');
    fakeListSearchInput.setAttribute('id', 'listSearchInput');

    docElements.set('gallerySearch', fakeGallerySearch);
    docElements.set('listSearchInput', fakeListSearchInput);

    const fakeDocument = {
        body: fakeBody,
        createElement(tag) {
            return new FakeElement(tag);
        },
        getElementById(id) {
            return docElements.get(id) || null;
        },
        querySelector(selector) {
            if (selector === '.framer-nav') return fakeNav;
            if (selector === '#gallerySearch') return fakeGallerySearch;
            if (selector === '#listSearchInput') return fakeListSearchInput;
            if (selector === '#promptSpotlightOverlay' || selector === '.prompt-spotlight-overlay') {
                return docElements.get('promptSpotlightOverlay') || null;
            }
            if (selector === '#promptSpotlightInput' || selector === '.prompt-spotlight-input') {
                return docElements.get('promptSpotlightInput') || null;
            }
            if (selector === '#promptSpotlightActionBtn' || selector === '.prompt-spotlight-action-btn' || selector === '#promptSpotlightClear' || selector === '.prompt-spotlight-clear') {
                return docElements.get('promptSpotlightActionBtn') || docElements.get('promptSpotlightClear') || null;
            }
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.prompt-card') return [];
            return [];
        },
        addEventListener(evt, fn) {
            fakeBody.addEventListener(evt, fn);
        }
    };

    class FakeEvent {
        constructor(type, opts = {}) {
            this.type = type;
            this.bubbles = Boolean(opts.bubbles);
        }
        preventDefault() {}
        stopPropagation() {}
    }

    class FakeCustomEvent {
        constructor(type, opts = {}) {
            this.type = type;
            this.detail = opts.detail;
        }
    }

    const pendingTimers = [];
    let timerSeq = 0;
    const mockSetTimeout = (fn, delay = 0) => {
        const id = ++timerSeq;
        pendingTimers.push({ id, fn, delay });
        return id;
    };
    const mockClearTimeout = (id) => {
        const idx = pendingTimers.findIndex((t) => t.id === id);
        if (idx !== -1) pendingTimers.splice(idx, 1);
    };
    const flushTimers = () => {
        const current = pendingTimers.splice(0);
        current.forEach((t) => t.fn());
    };

    const sandbox = {
        window: {
            location: { pathname: '/prompts.html' },
            scrollY: 0,
            addEventListener: (evt, fn) => fakeBody.addEventListener(evt, fn),
            dispatchEvent: (evt) => fakeBody.dispatchEvent(evt),
            setTimeout: mockSetTimeout,
            clearTimeout: mockClearTimeout,
            Event: FakeEvent,
            CustomEvent: FakeCustomEvent
        },
        document: fakeDocument,
        setTimeout: mockSetTimeout,
        clearTimeout: mockClearTimeout,
        requestAnimationFrame: (fn) => mockSetTimeout(fn, 16),
        Event: FakeEvent,
        CustomEvent: FakeCustomEvent,
        console
    };
    sandbox.window.document = fakeDocument;
    sandbox.global = sandbox.window;
    sandbox.globalThis = sandbox.window;

    return { sandbox, fakeNav, fakeBody, fakeGallerySearch, fakeListSearchInput, docElements, flushTimers };
}

test('PromptSpotlight contract: initialization, navigation auto-hide upward and restore', () => {
    const { sandbox, fakeNav, fakeBody } = createMockEnvironment();

    vm.createContext(sandbox);
    vm.runInContext(SPOTLIGHT_JS, sandbox);

    const PromptSpotlight = sandbox.window.PromptSpotlight;
    assert.ok(PromptSpotlight, 'PromptSpotlight should be exposed on window');
    assert.equal(typeof PromptSpotlight.open, 'function');
    assert.equal(typeof PromptSpotlight.close, 'function');
    assert.equal(typeof PromptSpotlight.toggle, 'function');
    assert.equal(typeof PromptSpotlight.isOpen, 'function');

    // Initially closed, nav is visible (does not have nav-hidden)
    assert.equal(PromptSpotlight.isOpen(), false);
    assert.equal(fakeNav.classList.contains('nav-hidden'), false);

    // Open Spotlight
    PromptSpotlight.open();
    assert.equal(PromptSpotlight.isOpen(), true);

    // Nav must slide upward and disappear (both nav-hidden and spotlight-nav-hidden applied)
    assert.ok(fakeNav.classList.contains('nav-hidden'), 'nav should have nav-hidden added');
    assert.ok(fakeNav.classList.contains('spotlight-nav-hidden'), 'nav should have spotlight-nav-hidden added');
    assert.ok(fakeBody.classList.contains('prompt-spotlight-active'), 'body should have prompt-spotlight-active');

    // Close Spotlight
    PromptSpotlight.close();
    assert.equal(PromptSpotlight.isOpen(), false);

    // Nav should be restored (nav-hidden and spotlight-nav-hidden removed)
    assert.equal(fakeNav.classList.contains('spotlight-nav-hidden'), false);
    assert.equal(fakeNav.classList.contains('nav-hidden'), false);
    assert.equal(fakeBody.classList.contains('prompt-spotlight-active'), false);
});

test('PromptSpotlight contract: typing does not trigger search; Enter or action button triggers in-place search; resets query on next open', () => {
    const { sandbox, fakeGallerySearch, flushTimers } = createMockEnvironment();

    fakeGallerySearch.value = 'Cyberpunk';

    vm.createContext(sandbox);
    vm.runInContext(SPOTLIGHT_JS, sandbox);

    const PromptSpotlight = sandbox.window.PromptSpotlight;
    PromptSpotlight.open();

    const spotlightInput = sandbox.document.querySelector('.prompt-spotlight-input');
    const actionBtn = sandbox.document.querySelector('.prompt-spotlight-action-btn');
    assert.ok(spotlightInput, 'Spotlight input should exist');
    assert.ok(actionBtn, 'Spotlight action/search button should exist');
    assert.equal(spotlightInput.value, '', 'Spotlight should open fresh and empty without retaining stale query');
    assert.equal(actionBtn.classList.contains('has-query'), false, 'action button should not have has-query class when empty');

    // 1. User types in spotlight: should NOT dispatch input or trigger search immediately
    let dispatchedEvents = [];
    fakeGallerySearch.addEventListener('input', (e) => dispatchedEvents.push(e));

    spotlightInput.value = 'Anime girl';
    spotlightInput.dispatchEvent(new sandbox.window.Event('input', { bubbles: true }));

    assert.equal(dispatchedEvents.length, 0, 'typing should not dispatch input event to gallerySearch');
    assert.equal(fakeGallerySearch.value, 'Cyberpunk', 'gallerySearch should not update until search is triggered');
    assert.equal(actionBtn.classList.contains('has-query'), true, 'action button should have has-query class after typing');

    // 2. Trigger search via action button click
    actionBtn.dispatchEvent(new sandbox.window.Event('click', { bubbles: true }));

    assert.equal(fakeGallerySearch.value, 'Anime girl', 'gallerySearch value should be updated on search');
    assert.equal(PromptSpotlight.isSearching(), true, 'PromptSpotlight should enter isSearching state');

    // 3. Settle and upward dismiss
    flushTimers();
    flushTimers();
    assert.equal(PromptSpotlight.isOpen(), false);

    // 4. Re-open Spotlight: previous query must be cleared
    PromptSpotlight.open();
    assert.equal(spotlightInput.value, '', 'reopening spotlight must not retain the previous search query');
    assert.equal(actionBtn.classList.contains('has-query'), false, 'action button must be reset to inactive on reopen');
    PromptSpotlight.close();
});

test('PromptSpotlight contract: top search box #gallerySearch does not summon spotlight', () => {
    const { sandbox, fakeGallerySearch } = createMockEnvironment();

    vm.createContext(sandbox);
    vm.runInContext(SPOTLIGHT_JS, sandbox);

    const PromptSpotlight = sandbox.window.PromptSpotlight;
    assert.equal(PromptSpotlight.isOpen(), false);

    // Clicking or focusing #gallerySearch directly should NOT open the floating spotlight capsule
    fakeGallerySearch.dispatchEvent(new sandbox.window.Event('click', { bubbles: true }));
    assert.equal(PromptSpotlight.isOpen(), false, 'click on gallerySearch must not open spotlight');

    fakeGallerySearch.dispatchEvent(new sandbox.window.Event('focus', { bubbles: true }));
    assert.equal(PromptSpotlight.isOpen(), false, 'focus on gallerySearch must not open spotlight');
});

test('magnifying-dock.js contract: delegates search to PromptSpotlight on prompts page', () => {
    assert.match(DOCK_JS, /PromptSpotlight/);
    assert.match(DOCK_JS, /PromptSpotlight\.toggle\(\)|PromptSpotlight\.open\(\)/);
});

test('magnifying-dock.css contract: includes liquid glass styles and nav upward slide rule', () => {
    assert.match(DOCK_CSS, /\.prompt-spotlight-capsule\.gdock/);
    assert.match(DOCK_CSS, /border-radius:\s*999px/);
    assert.match(DOCK_CSS, /body\.prompt-spotlight-active \.framer-nav/);
    assert.match(DOCK_CSS, /transform:\s*translateY\(calc\(-100% - 40px\)\)/);
    assert.match(DOCK_CSS, /body\.prompt-spotlight-active \.nav-search-wrapper/);
    assert.match(DOCK_CSS, /cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/);
    assert.match(DOCK_CSS, /is-dismissing-up/);
});

test('PromptSpotlight contract: in-place search on Enter with loading and upward dismissal', () => {
    const { sandbox, fakeGallerySearch, flushTimers } = createMockEnvironment();
    vm.createContext(sandbox);
    vm.runInContext(SPOTLIGHT_JS, sandbox);

    const PromptSpotlight = sandbox.window.PromptSpotlight;
    PromptSpotlight.open();

    const spotlightInput = sandbox.document.querySelector('.prompt-spotlight-input');
    spotlightInput.value = 'Sci-Fi';

    assert.equal(typeof PromptSpotlight.triggerInPlaceSearch, 'function');
    PromptSpotlight.triggerInPlaceSearch();

    // 1. In-place search starts and enters loading state
    assert.equal(PromptSpotlight.isSearching(), true);
    const capsule = sandbox.document.getElementById('promptSpotlightCapsule');
    assert.ok(capsule.classList.contains('is-searching'), 'capsule should enter is-searching state');

    // 2. Settle timer completes, triggers upward dismissal
    flushTimers();
    assert.ok(capsule.classList.contains('is-dismissing-up'), 'capsule should enter is-dismissing-up');

    // 3. Upward animation completes and closes
    flushTimers();
    assert.equal(PromptSpotlight.isOpen(), false);
    assert.equal(PromptSpotlight.isSearching(), false);
});

test('prompts.html contract: includes prompt-spotlight script', () => {
    assert.match(PROMPTS_HTML, /prompt-spotlight\.js/);
});

test('magnifying-dock contract: shared desktop optics replace legacy search filters and keep readable controls', () => {
    // Search, Dock and notifications no longer warm independent SVG maps.
    const desktopJS = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'desktop-nav-glass.mjs'), 'utf8');
    const desktopCSS = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'desktop-nav-glass.css'), 'utf8');
    assert.doesNotMatch(DOCK_JS + DOCK_CSS + SPOTLIGHT_JS, /gdock-(?:spotlight-|chat-)?refract-(?:filter|map)|drawLiquidGlassRefraction/);
    assert.match(desktopJS, /vendor\/glasswork\/lens\.js/);
    assert.match(desktopJS, /\.gdock, \.chat-widget-fab \.message-preview/);
    assert.match(desktopCSS, /blur\(7px\)/);
    assert.match(desktopCSS, /\.gdock > \.gdock-glass\s*\{\s*display:\s*none\s*!important/);
    assert.match(desktopCSS, /backdrop-filter:\s*var\(--dng-filter\) var\(--desktop-glass-lens,/);

    // 2. High-contrast button styling for clear readability over any background
    assert.match(DOCK_CSS, /\.prompt-spotlight-esc/);
    assert.match(DOCK_CSS, /\.prompt-spotlight-action-btn/);
    assert.match(DOCK_CSS, /\.prompt-spotlight-clear/);
    assert.match(DOCK_CSS, /rgba\(15,\s*23,\s*42/);

    // 3. prompts-poetry.js preserves scroll when spotlight is active
    const PROMPTS_POETRY_JS = fs.readFileSync(
        path.resolve(__dirname, '..', 'prompts-poetry.js'),
        'utf8'
    );
    assert.match(PROMPTS_POETRY_JS, /prompt-spotlight-active/);
    assert.match(PROMPTS_POETRY_JS, /shouldForcePromptPageTop/);
});

test('PromptSpotlight & Dock search reset contract: dynamic morph to resetSearch and 1-click in-place restore', () => {
    const { sandbox, fakeGallerySearch } = createMockEnvironment();

    let renderGalleryCalls = [];
    sandbox.window.renderGallery = (filter, reset, options) => {
        renderGalleryCalls.push({ filter, reset, options });
    };

    vm.createContext(sandbox);
    vm.runInContext(SPOTLIGHT_JS, sandbox);

    const PromptSpotlight = sandbox.window.PromptSpotlight;
    assert.equal(typeof PromptSpotlight.resetSearch, 'function');

    // Simulate search filter active
    fakeGallerySearch.value = '帽子';
    PromptSpotlight.setQuery('帽子');

    let searchChangeEvents = [];
    sandbox.window.addEventListener('prompt-search-change', (e) => {
        searchChangeEvents.push(e.detail);
    });

    // Call resetSearch()
    PromptSpotlight.resetSearch();

    assert.equal(fakeGallerySearch.value, '', 'gallerySearch should be cleared');
    assert.equal(renderGalleryCalls.length, 1);
    assert.equal(renderGalleryCalls[0].filter, 'all');
    assert.equal(renderGalleryCalls[0].options.preserveScroll, true, 'must preserve scroll position in place');
    assert.equal(searchChangeEvents.length, 1);
    assert.equal(searchChangeEvents[0].active, false, 'dispatches prompt-search-change active:false');

    // Verify DOCK_JS icon and dynamic state logic
    assert.match(DOCK_JS, /searchReset:/, 'DOCK_JS must include searchReset icon');
    assert.match(DOCK_JS, /清除搜索 \(恢复全部\)/, 'DOCK_JS must update tooltip to 清除搜索 (恢复全部)');
    assert.match(DOCK_JS, /searchFiltered/, 'DOCK_JS must toggle searchFiltered attribute');
    assert.match(DOCK_JS, /PromptSpotlight\.resetSearch\(\)/, 'DOCK_JS must call PromptSpotlight.resetSearch()');

    // Verify DOCK_CSS styles for reset button: only dot is blue, icon retains natural theme color
    assert.match(DOCK_CSS, /\.gdock-item\[data-search-filtered="true"\] \.gdock-dot\[data-on="true"\]/);
    assert.match(DOCK_CSS, /background:\s*#38bdf8/);
    assert.doesNotMatch(DOCK_CSS, /\.gdock-item\[data-search-filtered="true"\]\s*\{\s*color:\s*#38bdf8/);
});

test('ShopSpotlight & Dock contract: spotlight search on shop, dynamic morph to resetSearch and 1-click in-place restore', () => {
    // 1. shop.html includes prompt-spotlight.js
    assert.match(SHOP_HTML, /prompt-spotlight\.js/);

    const { sandbox, fakeListSearchInput, flushTimers } = createMockEnvironment();
    sandbox.window.location.pathname = '/shop.html';
    sandbox.document.body.classList.add('shop-page');

    let shopQueryState = '';
    sandbox.window.ShopListLayout = {
        getSearchQuery: () => shopQueryState,
        setSearchQuery: (q) => {
            shopQueryState = q;
            fakeListSearchInput.value = q;
        },
        resetSearch: () => {
            shopQueryState = '';
            fakeListSearchInput.value = '';
        }
    };

    vm.createContext(sandbox);
    vm.runInContext(SPOTLIGHT_JS, sandbox);

    const Spotlight = sandbox.window.ShopSpotlight;
    assert.ok(Spotlight, 'ShopSpotlight should be exposed on window');
    assert.equal(typeof Spotlight.open, 'function');
    assert.equal(typeof Spotlight.detectContext, 'function');
    assert.equal(Spotlight.detectContext(), 'shop', 'detectContext() should return shop on shop page');

    Spotlight.open();
    const input = sandbox.document.querySelector('.prompt-spotlight-input');
    const capsule = sandbox.document.getElementById('promptSpotlightCapsule');
    assert.ok(input);
    assert.equal(input.placeholder, '搜索商品...');
    assert.equal(capsule.getAttribute('aria-label'), '商品搜索');

    // Enter search query
    input.value = 'Claude';
    let shopEvents = [];
    sandbox.window.addEventListener('shop-search-change', (e) => {
        shopEvents.push(e.detail);
    });

    Spotlight.triggerInPlaceSearch();
    assert.equal(Spotlight.isSearching(), true);
    assert.equal(fakeListSearchInput.value, 'Claude');
    assert.equal(shopQueryState, 'Claude');
    assert.equal(shopEvents.length, 1);
    assert.equal(shopEvents[0].active, true);
    assert.equal(shopEvents[0].query, 'Claude');

    // Upward dismiss
    flushTimers();
    flushTimers();
    assert.equal(Spotlight.isOpen(), false);

    // Call resetSearch()
    Spotlight.resetSearch();
    assert.equal(fakeListSearchInput.value, '', 'listSearchInput should be cleared on reset');
    assert.equal(shopQueryState, '');
    assert.equal(shopEvents.length, 2);
    assert.equal(shopEvents[1].active, false);

    // Verify DOCK_JS includes shop spotlight and reset logic
    assert.match(DOCK_JS, /isShopSearchActive/);
    assert.match(DOCK_JS, /listSearchInput/);
});

test('PromptSpotlight focus hygiene contract: zero purple glow and zero focus outline on spotlight input', () => {
    const STYLE_CSS = fs.readFileSync(path.resolve(__dirname, '..', 'style.css'), 'utf8');
    // Ensure style.css form focus rule excludes prompt-spotlight-input
    assert.match(STYLE_CSS, /input\[type="text"\]:not\(\.prompt-spotlight-input\):focus/);

    // Ensure magnifying-dock.css explicitly overrides all focus states
    assert.match(DOCK_CSS, /\.prompt-spotlight-input:focus/);
    assert.match(DOCK_CSS, /\.prompt-spotlight-input:focus-visible/);
});

test('PromptSpotlight bold caret contract: 2.5px pill bar, glowing drop-shadow, and transparent native caret', () => {
    // Ensure magnifying-dock.css defines .prompt-spotlight-caret with width: 2.5px, border-radius, and box-shadow
    assert.match(DOCK_CSS, /\.prompt-spotlight-caret\s*\{[\s\S]*?width:\s*2\.5px/);
    assert.match(DOCK_CSS, /\.prompt-spotlight-caret\s*\{[\s\S]*?box-shadow:/);
    assert.match(DOCK_CSS, /\.prompt-spotlight-caret\.is-blinking/);
    assert.match(DOCK_CSS, /\.prompt-spotlight-input-wrap\.has-custom-caret[\s\S]*?caret-color:\s*transparent/);

    // Ensure prompt-spotlight.js mounts custom caret and measurer
    assert.match(SPOTLIGHT_JS, /prompt-spotlight-caret/);
    assert.match(SPOTLIGHT_JS, /prompt-spotlight-measurer/);
    assert.match(SPOTLIGHT_JS, /updateCaretPosition/);
});

test('PromptSpotlight GPU & scroll performance contract: unmount compositor layers when closed, dirty-check scroll sync', () => {
    // Ensure magnifying-dock.css hides closed overlay with display: none and turns off backdrop-filter
    assert.match(DOCK_CSS, /\.prompt-spotlight-overlay\s*\{[\s\S]*?display:\s*none/);
    assert.match(DOCK_CSS, /\.prompt-spotlight-overlay\.is-open,\s*\.prompt-spotlight-overlay\.is-dismissing-up\s*\{[\s\S]*?display:\s*flex/);
    assert.match(DOCK_CSS, /\.prompt-spotlight-overlay:not\(\.is-open\):not\(\.is-dismissing-up\)[\s\S]*?\.gdock-glass\s*\{[\s\S]*?backdrop-filter:\s*none\s*!important/);

    // Ensure prompt-spotlight.js restores display: flex on open and hides with display: none on close
    assert.match(SPOTLIGHT_JS, /overlayEl\.style\.display\s*=\s*['"]flex['"]/);
    assert.match(SPOTLIGHT_JS, /overlayEl\.style\.display\s*=\s*['"]none['"]/);

    // Ensure magnifying-dock.js guards scroll DOM writes with dirty checks
    assert.match(DOCK_JS, /searchBtn\.dataset\.active\s*!==\s*activeStr/);
    assert.match(DOCK_JS, /searchBtn\.dataset\.searchFiltered\s*!==\s*filteredStr/);
});

test('Verify dock, widget layout & 2FA tutorial precautions contract', () => {
    const VERIFY_WIDGET_JS = fs.readFileSync(path.resolve(__dirname, '..', 'verify-widget.js'), 'utf8');
    const TUTORIAL_HTML = fs.readFileSync(path.resolve(__dirname, '..', 'google-2fa-tutorial.html'), 'utf8');
    const TUTORIAL_CSS = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'tutorial-page.css'), 'utf8');
    const VERIFY_WIDGET_CSS = fs.readFileSync(path.resolve(__dirname, '..', 'verify-widget.css'), 'utf8');

    // 1. magnifying-dock.js in verify page
    assert.match(DOCK_JS, /label:\s*["']钱包["']/);
    assert.doesNotMatch(DOCK_JS, /label:\s*["']积分钱包["']/);
    assert.match(DOCK_JS, /key:\s*["']guide["'][\s\S]*?window\.location\.href\s*=\s*["']\/google-2fa-tutorial\.html["']/);
    assert.match(DOCK_JS, /key:\s*["']support["'][\s\S]*?openCustomerSupport\(\)/);

    // 2. Task history opens in a native modal, separate from the single-column form.
    assert.match(VERIFY_WIDGET_JS, /<dialog class="verify-history-card verify-history-dialog glass-ring" id="verifyHistoryCard" aria-labelledby="verifyHistoryTitle">/);
    assert.match(VERIFY_WIDGET_JS, /dialog\.showModal\(\)/);
    assert.match(VERIFY_WIDGET_JS, /data-verify-action="close-history"/);
    assert.match(DOCK_JS, /window\.ZaoyoeVerifyFocusHistory\?\.\(\)/);
    assert.doesNotMatch(VERIFY_WIDGET_JS, /<aside class="verify-guide-card" id="help"/);
    assert.match(VERIFY_WIDGET_CSS, /\.verify-history-dialog:not\(\[open\]\)/);

    // 2.1 verify-widget.js submit mode tabs removed from page & handled by dock
    assert.doesNotMatch(VERIFY_WIDGET_JS, /<div class="verify-submit-mode-tabs"/);
    assert.match(VERIFY_WIDGET_JS, /window\.toggleVerifySubmitMode = toggleSubmitMode/);
    assert.match(DOCK_JS, /toggleVerifySubmitMode/);

    // 2.2 verify-widget.js mode selector: only shown when both extract and full exist
    assert.match(VERIFY_WIDGET_JS, /id="verifyModeField"\$\{\(showExtractMode && showFullMode\) \? '' : ' hidden'\}/);
    assert.match(VERIFY_WIDGET_JS, /showModeSelector = showExtractMode && showFullMode/);
    assert.match(VERIFY_WIDGET_CSS, /\.verify-widget #verifyModeField\[hidden\]/);

    // 2.3 verify-widget.js price prompt: removed from form
    assert.doesNotMatch(VERIFY_WIDGET_JS, /<div class="verify-form-meta">/);
    assert.doesNotMatch(VERIFY_WIDGET_JS, /class="verify-bulk-contact"/);

    // 3. google-2fa-tutorial.html precautions section
    assert.match(TUTORIAL_HTML, /<section class="tutorial-section tutorial-notice-section" id="section-notice">/);
    assert.match(TUTORIAL_HTML, /注意事项/);
    assert.match(TUTORIAL_HTML, /家庭组必须退出/);
    assert.match(TUTORIAL_HTML, /确保该账号不存在其它可用的 pro 权限订阅/);
    assert.match(TUTORIAL_HTML, /账号建议/);
    assert.match(TUTORIAL_HTML, /建议使用老号，新号极其容易封控/);
    assert.match(TUTORIAL_HTML, /我们不会保存您的任何账户信息和资料/);
    assert.match(TUTORIAL_HTML, /为了账户安全，订阅完成后建议修改 2FA 码/);
    assert.match(TUTORIAL_HTML, /移除 jio/);
    assert.match(TUTORIAL_HTML, /如需删除不必要的谷歌服务，例如 jio 的 pro 订阅，可点击下面链接选择要移除的订阅。/);
    assert.doesNotMatch(TUTORIAL_HTML, /选择要移除的任务/);
    assert.match(TUTORIAL_HTML, /http:\/\/myaccount\.google\.com\/deleteservices/);

    // 4. tutorial-page.css styles
    assert.match(TUTORIAL_CSS, /\.tutorial-notice-card/);
    assert.match(TUTORIAL_CSS, /\.tutorial-notice-badge/);
    assert.match(TUTORIAL_CSS, /\.tutorial-notice-grid/);
    assert.match(TUTORIAL_CSS, /\.tutorial-notice-item/);
    assert.match(TUTORIAL_CSS, /\.tutorial-notice-link/);

    // 5. verify.html hides the affixed customer service robot FAB
    const VERIFY_HTML = fs.readFileSync(path.resolve(__dirname, '..', 'verify.html'), 'utf8');
    const VERIFY_PAGE_CSS = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'verify-page.css'), 'utf8');
    const CHAT_WIDGET_CSS = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'chat-widget.css'), 'utf8');
    assert.match(VERIFY_HTML, /<body class="verify-page">/);
    assert.match(VERIFY_PAGE_CSS, /\.chat-widget-fab[\s\S]*?display:\s*none\s*!important/);
    assert.match(CHAT_WIDGET_CSS, /body\.verify-page\s+\.chat-widget-fab[\s\S]*?display:\s*none\s*!important/);

    // 6. index.html hides the affixed customer service robot FAB
    const INDEX_HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
    const INDEX_PAGE_CSS = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'index-page.css'), 'utf8');
    assert.match(INDEX_HTML, /<body class="home-page">/);
    assert.match(INDEX_PAGE_CSS, /\.chat-widget-fab[\s\S]*?display:\s*none\s*!important/);
    assert.match(CHAT_WIDGET_CSS, /body\.home-page\s+\.chat-widget-fab[\s\S]*?display:\s*none\s*!important/);
});

test('magnifying-dock mobile contract: shared theme material with desktop isolation', () => {
    const mobileLayer = DOCK_CSS.slice(DOCK_CSS.indexOf('@layer mobile-glass'));
    assert.match(mobileLayer, /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\),\s*\(max-width:\s*768px\)\s*and\s*\(pointer:\s*coarse\)/);
    assert.match(DOCK_CSS, /bottom:\s*calc\(34px\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\)/);
    assert.match(DOCK_CSS, /max-width:\s*calc\(100vw\s*-\s*20px\)/);
    for (const selector of ['.gdock-glass', '.avatar-dropdown', '.nav-dropdown-portal', '.nav-support-dropdown', '.mobile-menu', '.chat-widget-fab .message-preview']) {
        assert.ok(mobileLayer.includes(selector), `${selector} must use the shared mobile material`);
    }
    // The mobile navbar reuses production material; only its rim is narrowed.
    assert.ok(!mobileLayer.includes('.framer-nav'), 'navbar must keep production styles outside the shared mobile material');
    const mobileModule = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'mobile-glass.mjs'), 'utf8');
    assert.doesNotMatch(mobileModule, /\.framer-nav/);
    assert.match(DOCK_CSS, /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\),\s*\(max-width:\s*768px\)\s*and\s*\(pointer:\s*coarse\)\s*\{\s*\.framer-nav\.scrolled\s*\{/);
    assert.match(DOCK_CSS, /box-shadow:\s*inset 0 0 0 0\.5px var\(--mobile-nav-rim-color\)/);
    assert.match(mobileLayer, /--mg-blur:\s*6px/);
    assert.match(mobileLayer, /--mg-strength:\s*0\.78/);
    assert.match(mobileLayer, /--mg-refraction:\s*1\.1/);
    assert.match(mobileLayer, /--mg-dispersion:\s*0\.40/);
    assert.match(mobileLayer, /-webkit-backdrop-filter:\s*blur\(var\(--mg-blur\)\)/);
    assert.match(mobileLayer, /backdrop-filter:\s*blur\(var\(--mg-blur\)\)/);
    assert.doesNotMatch(mobileLayer, /url\(|--glass-lens|plus-lighter/);
    assert.match(mobileLayer, /prefers-reduced-transparency:\s*reduce/);
    assert.match(mobileLayer, /@supports not/);
    // The retired desktop renderer no longer lives in magnifying-dock.js.
    // Its replacement uses the exact complement of the mobile media boundary.
    const desktopJS = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'desktop-nav-glass.mjs'), 'utf8');
    const desktopCSS = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'desktop-nav-glass.css'), 'utf8');
    assert.match(desktopJS, /active = !mobile\.matches;/);
    assert.match(desktopJS, /\(hover: none\) and \(pointer: coarse\), \(max-width: 768px\) and \(pointer: coarse\)/);
    assert.match(desktopCSS, /@media not \(pointer: coarse\), \(hover: hover\) and \(width > 768px\)/);
    assert.match(DOCK_JS, /mobileGlassController\?\.stop\(\)/);
    assert.match(DOCK_JS, /dockCluster\.removeAttribute\("data-refract"\)/);
    assert.doesNotMatch(DOCK_JS, /import\(\s*["'][^"']*vendor\/glasswork\/(?:refract|lens)\.js/);
});
