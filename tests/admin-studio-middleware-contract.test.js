const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const middlewarePath = path.resolve(__dirname, '../middleware.js');
const packageJsonPath = path.resolve(__dirname, '../package.json');

test('admin studio middleware uses explicit Vercel next() pass-through', () => {
    const source = fs.readFileSync(middlewarePath, 'utf8');

    assert.match(source, /import\s+\{\s*next\s*\}\s+from\s+['"]@vercel\/functions['"]/);
    assert.match(source, /return\s+import\(['"]\.\/api\/_lib\/admin-studio-access\.mjs['"]\)/);
    assert.match(source, /return\s+next\(\);/);
    assert.match(source, /Response\.redirect\(redirectUrl,\s*307\)/);
});

test('@vercel/functions is declared for middleware runtime compatibility', () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencyVersion = packageJson?.dependencies?.['@vercel/functions']
        || packageJson?.devDependencies?.['@vercel/functions'];

    assert.equal(typeof dependencyVersion, 'string');
    assert.notEqual(dependencyVersion.trim(), '');
});
