const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('hero entry center-first behavior is bound before the deferred homepage runtime', () => {
    const homepage = readRepoFile('index.html');
    const bootstrapPath = './js/home-hero-liquid-bootstrap.js?v=20260518_HOME_DARK_HERO_BOOT_1&entryClick=20260727_HOME_HERO_EARLY_ENTRY_CLICK_1';

    assert.ok(homepage.indexOf(bootstrapPath) > 0, 'homepage should cache-bust the early hero entry bootstrap');
    assert.ok(
        homepage.indexOf(bootstrapPath) < homepage.indexOf('class="hero-carousel fade-in-up visible"'),
        'early hero entry bootstrap should execute before entry card markup is parsed'
    );
    assert.doesNotMatch(
        homepage,
        new RegExp(`${bootstrapPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+defer`),
        'early hero entry bootstrap must not be deferred'
    );
});

test('an off-center entry click is centered and preserved for runtime hydration', () => {
    const bootstrapSource = readRepoFile('js/home-hero-liquid-bootstrap.js');
    let clickHandler = null;
    let scrollRequest = null;
    const root = { dataset: {} };
    const hero = { dataset: {} };
    const carousel = {
        scrollLeft: 120,
        closest(selector) {
            return selector === '.hero-section' ? hero : null;
        },
        getBoundingClientRect() {
            return { left: 0, width: 390 };
        },
        querySelectorAll() {
            return cards;
        },
        scrollTo(options) {
            scrollRequest = options;
        }
    };
    function createCard(href, left) {
        const attributes = new Map([['href', href]]);
        return {
            closest(selector) {
                if (selector === '.hero-carousel .entry-card') return this;
                if (selector === '.hero-carousel') return carousel;
                return null;
            },
            getAttribute(name) {
                return attributes.get(name) || null;
            },
            setAttribute(name, value) {
                attributes.set(name, String(value));
            },
            removeAttribute(name) {
                attributes.delete(name);
            },
            getBoundingClientRect() {
                return { left, width: 140 };
            }
        };
    }
    const cards = [
        createCard('/prompts.html', -31),
        createCard('/shop.html', 125),
        createCard('/verify.html', 281)
    ];
    const target = cards[2];
    const document = {
        documentElement: root,
        currentScript: {
            closest() {
                return {
                    querySelector() {
                        return null;
                    }
                };
            }
        },
        addEventListener(type, handler, capture) {
            if (type === 'click' && capture === true) clickHandler = handler;
        },
        getElementById() {
            return null;
        }
    };
    const window = {};

    vm.runInNewContext(bootstrapSource, { document, window, Array, Date, Math, String });
    assert.equal(typeof clickHandler, 'function', 'bootstrap should bind its capture click handler immediately');

    let prevented = false;
    let stopped = false;
    clickHandler({
        target,
        button: 0,
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault() {
            prevented = true;
        },
        stopPropagation() {
            stopped = true;
        }
    });

    assert.equal(prevented, true, 'first off-center click should not navigate');
    assert.equal(stopped, true, 'deferred delegates should not process the same early click');
    assert.equal(scrollRequest.left, 276);
    assert.equal(scrollRequest.behavior, 'smooth');
    assert.equal(target.getAttribute('data-home-early-center-requested'), '1');
    assert.equal(hero.dataset.homeHeroEarlyEntryIndex, '2');
    assert.equal(hero.dataset.homeHeroEarlyEntryHref, '/verify.html');
});

test('carousel hydration restores and then clears an early entry request', () => {
    const runtime = readRepoFile('js/framer_home.js');
    const start = runtime.indexOf('const getEarlyRequestedCardIndex = () => {');
    const end = runtime.indexOf('// Track scroll activity for thumb glow effect', start);
    const hydrationSegment = runtime.slice(start, end);

    assert.notEqual(start, -1, 'carousel runtime should read the early click request');
    assert.match(hydrationSegment, /data-home-early-center-requested/);
    assert.match(hydrationSegment, /homeHeroEarlyEntryHref/);
    assert.match(hydrationSegment, /homeHeroEarlyEntryIndex/);
    assert.match(hydrationSegment, /requestedCard\.offsetLeft/);
    assert.match(hydrationSegment, /applyInitialCenter\(\);[\s\S]*clearEarlyRequestedCard\(\);/);
    assert.match(runtime, /heroSection\.dataset\.homeHeroEntryRuntimeReady = '1';/);
});
