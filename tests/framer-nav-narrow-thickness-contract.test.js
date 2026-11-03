const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

test('framer-nav has narrow-window thickness override with smooth resize transitions', () => {
    const criticalCss = fs.readFileSync(path.resolve(__dirname, '../css/framer_home_critical.css'), 'utf8');
    const framerCss = fs.readFileSync(path.resolve(__dirname, '../css/framer_home.css'), 'utf8');

    // 1. Critical stylesheet size budgets
    assert.ok(criticalCss.length < 37000, `critical css size (${criticalCss.length}) must be < 37000 bytes`);
    assert.ok(zlib.gzipSync(criticalCss).length < 8000, `critical css gzip (${zlib.gzipSync(criticalCss).length}) must be < 8000 bytes`);

    // 2. Wide window thickness baseline (7px padding, 40px auth slot, 55px total)
    assert.match(criticalCss, /--nav-vertical-padding:\s*7px;/);
    assert.match(criticalCss, /--nav-auth-slot-size:\s*40px;/);
    assert.match(framerCss, /--nav-vertical-padding:\s*7px;/);
    assert.match(framerCss, /--nav-auth-slot-size:\s*40px;/);

    // 3. Narrow window thickness override (5px padding, 38px auth slot, 49px total)
    assert.match(criticalCss, /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?--nav-vertical-padding:\s*5px;[\s\S]*?--nav-auth-slot-size:\s*38px;/);
    assert.match(framerCss, /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?--nav-vertical-padding:\s*5px;[\s\S]*?--nav-auth-slot-size:\s*38px;/);

    // 4. Soft transitions on container padding and auth slot dimensions
    assert.match(framerCss, /\.nav-container\s*\{[\s\S]*?transition:\s*padding\s+0\.35s/);
    assert.match(framerCss, /#auth-container[\s\S]*?transition:\s*[\s\S]*?width\s+0\.35s[\s\S]*?height\s+0\.35s/);

    // 5. Light theme homepage navbar: dark glass at top, white glass on scroll with smooth transitions
    assert.match(criticalCss, /html\[data-theme="light"\] body\.home-page \.framer-nav:not\(\.scrolled\)[\s\S]*?background-color:\s*rgba\(0,\s*0,\s*0,\s*0\.65\);/);
    assert.match(framerCss, /html\[data-theme="light"\] body\.home-page \.framer-nav:not\(\.scrolled\)[\s\S]*?background-color:\s*rgba\(0,\s*0,\s*0,\s*0\.65\);/);
    assert.match(criticalCss, /html\[data-theme="light"\] \.framer-nav\.scrolled[\s\S]*?background-color:\s*rgba\(255,\s*255,\s*255,\s*0\.88\);/);
    assert.match(framerCss, /html\[data-theme="light"\] \.framer-nav\.scrolled[\s\S]*?background-color:\s*rgba\(255,\s*255,\s*255,\s*0\.88\);/);
    assert.match(framerCss, /\.nav-logo svg path\s*\{[\s\S]*?transition:\s*fill\s+0\.4s ease-out;/);
    assert.match(framerCss, /\.nav-menu a\s*\{[\s\S]*?transition:\s*color\s+0\.4s ease-out;/);
    assert.match(framerCss, /\.nav-hamburger span\s*\{[\s\S]*?transition:\s*background-color\s+0\.4s ease-out/);

    // 6. Navigation refresh stability (prevents white border flash and unready shrink/expand transition on refresh)
    assert.match(criticalCss, /\.framer-nav\s*\{[\s\S]*?border:\s*1px solid transparent;[\s\S]*?border-bottom:\s*1px solid var\(--border-subtle\);/);
    assert.match(framerCss, /\.framer-nav\s*\{[\s\S]*?border:\s*1px solid transparent;[\s\S]*?border-bottom:\s*1px solid var\(--border-subtle\);/);
    assert.match(criticalCss, /\.framer-nav:not\(\.nav-ready\)[\s\S]*?transition:\s*none !important;/);
    assert.match(framerCss, /\.framer-nav:not\(\.nav-ready\)[\s\S]*?transition:\s*none !important;/);

    // 7. Scrolled capsule clustering: menu gap and container padding contract on scroll with smooth transitions
    assert.match(framerCss, /\.nav-menu\s*\{[\s\S]*?transition:\s*[\s\S]*?gap\s+0\.45s/);
    assert.match(framerCss, /\.framer-nav\.scrolled \.nav-menu\s*\{[\s\S]*?gap:\s*28px;/);
    assert.match(framerCss, /\.framer-nav\.scrolled \.nav-container\s*\{[\s\S]*?padding:\s*var\(--nav-vertical-padding\)\s+var\(--spacing-lg\);/);
    assert.match(framerCss, /\.framer-nav\.scrolled\s*\{[\s\S]*?border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.22\);/);

    // 8. Narrow window scrolled capsule inward gathering (prevents outward bounce and gathers inward on scroll)
    assert.match(criticalCss, /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.framer-nav\.scrolled \.nav-container\s*\{[\s\S]*?padding:\s*var\(--nav-vertical-padding\)\s+var\(--spacing-lg\);/);
    assert.match(framerCss, /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.framer-nav\.scrolled \.nav-container\s*\{[\s\S]*?padding:\s*var\(--nav-vertical-padding\)\s+var\(--spacing-lg\);/);

    // 9. Three-stage navigation display contract:
    //    Stage 1: Top stretched (unscrolled)
    //    Stage 2: Scrolled floating capsule (scrolled)
    //    Stage 3: Auto-hide on downward scroll past threshold, reveal on upward scroll, restore at top
    assert.match(criticalCss, /\.framer-nav\.nav-hidden[\s\S]*?transform:\s*translateY\(calc\(-100%\s*-\s*40px\)\);/);
    assert.match(framerCss, /\.framer-nav\.nav-hidden[\s\S]*?transform:\s*translateY\(calc\(-100%\s*-\s*40px\)\);/);
    assert.match(criticalCss, /\.framer-nav:has\(\.nav-hamburger\.active\)\.nav-hidden[\s\S]*?transform:\s*translateY\(0\);/);
    assert.match(framerCss, /\.framer-nav:has\(\.nav-hamburger\.active\)\.nav-hidden[\s\S]*?transform:\s*translateY\(0\);/);

    const framerHomeJs = fs.readFileSync(path.resolve(__dirname, '../js/framer_home.js'), 'utf8');
    const framerNavRuntimeJs = fs.readFileSync(path.resolve(__dirname, '../js/framer-nav-runtime.js'), 'utf8');

    assert.match(framerHomeJs, /SCROLL_CAPSULE_THRESHOLD\s*=\s*24;/);
    assert.match(framerHomeJs, /SCROLL_HIDE_BUFFER\s*=\s*480;/);
    assert.match(framerHomeJs, /nav\.classList\.add\('nav-hidden'\);/);
    assert.match(framerHomeJs, /nav\.classList\.remove\('nav-hidden'\);/);

    assert.match(framerNavRuntimeJs, /SCROLL_CAPSULE_THRESHOLD\s*=\s*24;/);
    assert.match(framerNavRuntimeJs, /SCROLL_HIDE_BUFFER\s*=\s*480;/);
    assert.match(framerNavRuntimeJs, /nav\.classList\.add\('nav-hidden'\);/);
    assert.match(framerNavRuntimeJs, /nav\.classList\.remove\('nav-hidden'\);/);
});
