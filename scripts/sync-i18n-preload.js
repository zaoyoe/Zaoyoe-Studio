#!/usr/bin/env node
'use strict';

// Keep only translations used by static public HTML in the parser-time bootstrap.
// The full dictionaries remain the source for interactive and dynamically loaded UI.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const start = '    // BEGIN GENERATED FIRST-PAINT STRINGS';
const end = '    // END GENERATED FIRST-PAINT STRINGS';

function firstPaintStrings() {
    const english = JSON.parse(fs.readFileSync(path.join(root, 'lang/en.json'), 'utf8'));
    const keys = new Set();
    for (const name of fs.readdirSync(root)) {
        if (!name.endsWith('.html') || name === 'index_old.html' || name.startsWith('test')) continue;
        const html = fs.readFileSync(path.join(root, name), 'utf8');
        if (!/src=["'][^"']*js\/i18n\.js\?/.test(html)) continue;
        for (const match of html.matchAll(/\bdata-i18n(?:-placeholder|-title)?=["']([^"']+)["']/g)) keys.add(match[1]);
    }
    return Object.fromEntries([...keys].sort().flatMap(key => {
        const value = key.split('.').reduce((parent, part) => parent?.[part], english);
        return typeof value === 'string' ? [[key, value]] : [];
    }));
}

function generatedSource(source) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    if (from < 0 || to < 0) throw new Error('Missing i18n bootstrap generation markers');
    return source.slice(0, from) + start + '\n    const strings = ' + JSON.stringify(firstPaintStrings()) + ';\n' + source.slice(to);
}

if (require.main === module) {
    const file = path.join(root, 'js/i18n-preload.js');
    const source = fs.readFileSync(file, 'utf8');
    const next = generatedSource(source);
    if (process.argv.includes('--check')) {
        if (source !== next) {
            console.error('First-paint translations are stale. Run node scripts/sync-i18n-preload.js');
            process.exitCode = 1;
        }
    } else fs.writeFileSync(file, next);
}
module.exports = { firstPaintStrings, generatedSource };
