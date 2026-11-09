const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const asset = (html, name) => html.match(new RegExp(`(?:src|href)=["'](?:\\./)?((?:css|js)/${name.replaceAll('.', '\\.')}\\?[^"']+)["']`))?.[1];

test('every public page with shared glass loads the same foreground entry and stylesheet', () => {
  const reference = read('index.html');
  const styles = asset(reference, 'desktop-nav-glass.css');
  const script = asset(reference, 'desktop-nav-glass.mjs');
  assert.ok(styles && script);
  const pages = fs.readdirSync(root).filter(file => file.endsWith('.html') && !file.startsWith('._'));
  const checked = [];
  for (const file of pages) {
    const html = read(file);
    if (!/class=["'][^"']*\bframer-nav\b|js\/(?:magnifying-dock\.js|desktop-nav-glass\.mjs)/.test(html)) continue;
    assert.equal(asset(html, 'desktop-nav-glass.css'), styles, `${file}: shared styles`);
    assert.equal(asset(html, 'desktop-nav-glass.mjs'), script, `${file}: foreground runtime`);
    checked.push(file);
  }
  for (const file of ['google-2fa-tutorial.html', 'model-standards.html', 'reset-password.html', 'workbench.html']) {
    assert.ok(checked.includes(file), `${file}: page without Dock must still participate`);
  }
});

test('foreground styles are available without loading the Dock and keep first-layer priority', () => {
  const shared = read('css/desktop-nav-glass.css');
  const dock = read('css/magnifying-dock.css');
  assert.equal(shared.match(/@layer\s+([\w-]+)/)?.[1], 'glass-foreground');
  assert.equal(dock.match(/@layer\s+([\w-]+)/)?.[1], 'glass-foreground');
  assert.match(shared, /@layer glass-foreground\s*\{[\s\S]*?\[data-glass-ink\]\s*\{/);
  assert.doesNotMatch(dock, /@layer glass-foreground\s*\{/);
});

test('dynamically inserted Dock uses the same stylesheet revision as initial page loads', () => {
  const initial = asset(read('index.html'), 'magnifying-dock.css');
  assert.ok(initial);
  const dynamic = read('js/magnifying-dock.js').match(/href\s*=\s*["'](?:\.\/)?([^"']*css\/magnifying-dock\.css\?[^"']+)["']/)?.[1];
  assert.equal(dynamic, initial);
});
