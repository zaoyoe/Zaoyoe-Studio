const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function classList(...initial) {
    const values = new Set(initial);
    return {
        add: (...names) => names.forEach(name => values.add(name)),
        remove: (...names) => names.forEach(name => values.delete(name)),
        contains: name => values.has(name)
    };
}

// Run the actual scroll handlers from both entrypoints with controlled scroll,
// animation frames and lock mutations, without booting unrelated page features.
function createNavHarness(entrypoint, initialY = 0) {
    const source = fs.readFileSync(path.join(__dirname, '..', entrypoint), 'utf8');
    const home = entrypoint.endsWith('framer_home.js');
    const start = home
        ? source.indexOf("const nav = document.querySelector('.framer-nav');", source.indexOf('  initInteractions() {'))
        : source.indexOf('let lastScrollY =', source.indexOf('if (!nav.dataset.scrollBound) {'));
    const end = source.indexOf(home ? '// Mobile menu toggle' : "nav.dataset.scrollBound = '1';", start);
    assert.ok(start >= 0 && end > start, `Scroll binding exists in ${entrypoint}`);
    const frames = [];
    const observers = [];
    const listeners = new Map();
    const nav = { classList: classList('framer-nav'), querySelector: () => null };
    const body = { classList: classList(), style: {}, dataset: {} };
    const document = {
        body,
        documentElement: { scrollHeight: 10000 },
        querySelector: () => nav,
        querySelectorAll: () => [],
        getElementById: () => null
    };
    const window = {
        scrollY: initialY,
        pageYOffset: initialY,
        innerHeight: 800,
        iOSScrollLock: { isLocked: false, savedScrollY: 0 },
        addEventListener: (name, listener) => listeners.set(name, listener),
        requestAnimationFrame: callback => frames.push(callback),
        MutationObserver: class {
            constructor(callback) { this.callback = callback; }
            observe() { observers.push(this.callback); }
        }
    };
    const context = { window, global: window, document, nav };
    vm.runInNewContext(source.slice(start, end), context, { filename: entrypoint });
    function flush() {
        for (let i = 0; frames.length && i < 20; i++) frames.splice(0).forEach(callback => callback());
        assert.equal(frames.length, 0, 'Animation frames settle');
    }
    flush();
    return {
        nav, window, body,
        scroll(y) {
            window.scrollY = window.pageYOffset = y;
            listeners.get('scroll')();
            flush();
        },
        mutateBody() {
            observers.forEach(callback => callback());
            flush();
        },
        openModal({ fixed = false } = {}) {
            window.iOSScrollLock.savedScrollY = window.scrollY;
            window.iOSScrollLock.isLocked = true;
            body.classList.add('auth-sheet-open');
            if (fixed) {
                body.style.position = 'fixed';
                body.style.top = `${-window.scrollY}px`;
                window.scrollY = window.pageYOffset = 0;
            }
            this.mutateBody();
        },
        closeModal() {
            const saved = window.iOSScrollLock.savedScrollY;
            body.style.position = '';
            body.style.top = '';
            body.classList.remove('auth-sheet-open');
            window.iOSScrollLock.isLocked = false;
            window.scrollY = window.pageYOffset = saved;
            this.mutateBody();
        },
        hidden: () => nav.classList.contains('nav-hidden')
    };
}

for (const entrypoint of ['js/framer_home.js', 'js/framer-nav-runtime.js']) {
    test(`${entrypoint}: unlocked scroll ignores a previous modal's saved position`, () => {
        const h = createNavHarness(entrypoint, 810);
        h.window.iOSScrollLock.savedScrollY = 810;
        h.scroll(1600);
        assert.equal(h.hidden(), true, 'New downward scroll still hides the nav');
        h.scroll(1550);
        assert.equal(h.hidden(), false, 'Real upward scroll reveals the nav');
        h.scroll(0);
        assert.equal(h.nav.classList.contains('scrolled'), false, 'Top layout follows real scrollY');
    });

    test(`${entrypoint}: login open/close remains stable at changing page positions`, () => {
        const h = createNavHarness(entrypoint, 810);
        for (let cycle = 0; cycle < 6; cycle++) {
            const y = 810 + cycle * 740;
            h.scroll(y + 40);
            h.scroll(y);
            assert.equal(h.hidden(), false);
            h.openModal({ fixed: cycle % 2 === 0 });
            h.closeModal();
            assert.equal(h.hidden(), false, `Nav returns after login cycle ${cycle + 1}`);
            h.scroll(y - 40);
            assert.equal(h.hidden(), false, 'Upward scroll continues working after unlock');
        }
        h.scroll(0);
        assert.equal(h.hidden(), false);
        assert.equal(h.nav.classList.contains('scrolled'), false);
    });

    test(`${entrypoint}: modal restoration is not counted as downward travel`, () => {
        const h = createNavHarness(entrypoint, 810);
        h.openModal({ fixed: true });
        // Layout or modal navigation may restore a different position. It is
        // still restoration, not a 740px downward gesture by the user.
        h.window.iOSScrollLock.savedScrollY = 1550;
        h.closeModal();
        assert.equal(h.hidden(), false);
        h.scroll(2029);
        assert.equal(h.hidden(), false, 'Downward buffer starts at the restored position');
        h.scroll(2030);
        assert.equal(h.hidden(), true, 'Normal 480px hide behavior resumes');
    });

    test(`${entrypoint}: class-only modals resume without a window scroll event`, () => {
        const h = createNavHarness(entrypoint, 810);
        h.body.classList.add('has-active-modal');
        h.mutateBody();
        h.scroll(1550);
        h.body.classList.remove('has-active-modal');
        h.mutateBody();
        assert.equal(h.hidden(), false);
        h.scroll(2029);
        assert.equal(h.hidden(), false);
        h.scroll(2030);
        assert.equal(h.hidden(), true);
    });

    test(`${entrypoint}: nested locks keep the modal baseline until the final close`, () => {
        const h = createNavHarness(entrypoint, 810);
        h.openModal();
        h.body.classList.add('has-active-modal');
        h.closeModal();
        h.scroll(1550);
        assert.equal(h.hidden(), false);
        h.body.classList.remove('has-active-modal');
        h.mutateBody();
        assert.equal(h.hidden(), false);
        h.scroll(2029);
        assert.equal(h.hidden(), false);
    });

    test(`${entrypoint}: normal scroll thresholds and expanded menu visibility are preserved`, () => {
        const h = createNavHarness(entrypoint);
        h.scroll(24);
        assert.equal(h.nav.classList.contains('scrolled'), false);
        h.scroll(25);
        assert.equal(h.nav.classList.contains('scrolled'), true);
        h.scroll(503);
        assert.equal(h.hidden(), false);
        h.scroll(504);
        assert.equal(h.hidden(), true);
        h.scroll(496);
        assert.equal(h.hidden(), false, '8px upward gesture reveals the nav');
        h.body.classList.add('mobile-menu-open');
        h.scroll(1600);
        assert.equal(h.hidden(), false, 'Expanded mobile menu keeps its navbar visible');
        h.body.classList.remove('mobile-menu-open');
        h.scroll(0);
        assert.equal(h.hidden(), false);
        assert.equal(h.nav.classList.contains('scrolled'), false);
    });
}
