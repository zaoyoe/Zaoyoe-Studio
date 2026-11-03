const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const indexHtmlPath = path.join(rootDir, 'index.html');
const adminStudioHtmlPath = path.join(rootDir, 'admin-studio.html');
const adminHomepageJsPath = path.join(rootDir, 'admin-homepage.js');
const framerHomeJsPath = path.join(rootDir, 'js', 'framer_home.js');
const heroBootstrapJsPath = path.join(rootDir, 'js', 'home-hero-liquid-bootstrap.js');
const homepageContractJsPath = path.join(rootDir, 'js', 'homepage-contract.js');
const sharedHomepageJsPath = path.join(rootDir, 'server', 'api-handlers', 'admin', 'homepage', '_shared.js');
const framerHomeCssPath = path.join(rootDir, 'css', 'framer_home.css');

test('index.html hero defaults to stream-color 3 (orange) and does not contain palette-switch buttons', () => {
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
    assert.match(indexHtml, /<section id="hero-section" class="hero-section"[^>]*data-stream-color="3"/);
    assert.doesNotMatch(indexHtml, /class="palette-switch"/);
    assert.doesNotMatch(indexHtml, /COLOR 01/);
    assert.doesNotMatch(indexHtml, /COLOR 02/);
    assert.doesNotMatch(indexHtml, /COLOR 03/);
});

test('admin-studio.html exposes stream color selector in Hero content config', () => {
    const adminHtml = fs.readFileSync(adminStudioHtmlPath, 'utf8');
    assert.match(adminHtml, /id="hp-hero-stream-color"/);
    assert.match(adminHtml, /<option value="3"[^>]*selected>橙色（暖阳橙 · 默认）<\/option>/);
    assert.match(adminHtml, /<option value="2">翠绿色（科技绿）<\/option>/);
    assert.match(adminHtml, /<option value="1">蓝色（经典蓝）<\/option>/);
});

test('admin-homepage.js wires hp-hero-stream-color for loading, saving, and section summary', () => {
    const adminJs = fs.readFileSync(adminHomepageJsPath, 'utf8');
    assert.match(adminJs, /setSelectValue\('hp-hero-stream-color',\s*String\(content\.stream_color/);
    assert.match(adminJs, /content\.stream_color\s*=\s*parseInt\(getSelectValue\('hp-hero-stream-color'\)/);
    assert.match(adminJs, /label:\s*'流光颜色'/);
});

test('homepage contract and server shared normalizer preserve stream_color', () => {
    const contractJs = fs.readFileSync(homepageContractJsPath, 'utf8');
    const sharedJs = fs.readFileSync(sharedHomepageJsPath, 'utf8');
    assert.match(contractJs, /next\.stream_color\s*=\s*sanitizeInteger\(source\.stream_color/);
    assert.match(sharedJs, /next\.stream_color\s*=\s*sanitizeInteger\(source\.stream_color/);
});

test('home-hero-liquid-bootstrap.js defaults to palette 3 (orange)', () => {
    const bootstrapJs = fs.readFileSync(heroBootstrapJsPath, 'utf8');
    assert.match(bootstrapJs, /selectedPalette\s*=\s*\(rawPalette >= 1 && rawPalette <= 3\) \? rawPalette : 3/);
});

test('framer_home.js removes palette switch buttons and defaults hero stream color to 3', () => {
    const framerJs = fs.readFileSync(framerHomeJsPath, 'utf8');
    assert.doesNotMatch(framerJs, /class="palette-switch"/);
    assert.match(framerJs, /stream_color:\s*Number\(config\.stream_color \|\| config\.palette \|\| 3\) \|\| 3/);
});

test('framer_home.css hides palette-switch if present', () => {
    const css = fs.readFileSync(framerHomeCssPath, 'utf8');
    assert.match(css, /\.palette-switch\s*\{\s*display:\s*none !important;\s*\}/);
});

test('hero liquid shader starts with 30s flowing time offset to reveal rich ribbons immediately', () => {
    const bootstrapJs = fs.readFileSync(heroBootstrapJsPath, 'utf8');
    const framerJs = fs.readFileSync(framerHomeJsPath, 'utf8');
    assert.match(bootstrapJs, /INITIAL_TIME_OFFSET\s*=\s*30\.0/);
    assert.match(framerJs, /INITIAL_TIME_OFFSET\s*=\s*30\.0/);
});
