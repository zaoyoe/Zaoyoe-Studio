const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('profile-modal-loader.js guarantees shared LBI floating notch input styles and runtime across all subpages', () => {
    const loaderSource = readRepoFile(path.join('js', 'profile-modal-loader.js'));

    // 1. Loader defines LBI asset constants
    assert.match(
        loaderSource,
        /const LABEL_INPUT_STYLE_HREF = 'css\/label-input\.css\?v=[^']+';/,
        'loader must define LABEL_INPUT_STYLE_HREF'
    );
    assert.match(
        loaderSource,
        /const LABEL_INPUT_SRC = 'js\/label-input\.js\?v=[^']+';/,
        'loader must define LABEL_INPUT_SRC'
    );

    // 2. Loader defines ensureLabelInputStyles and ensureLabelInputRuntime
    assert.match(
        loaderSource,
        /function ensureLabelInputStyles\(\)\s*\{/,
        'loader must define ensureLabelInputStyles function'
    );
    assert.match(
        loaderSource,
        /function ensureLabelInputRuntime\(\)\s*\{/,
        'loader must define ensureLabelInputRuntime function'
    );
    assert.match(
        loaderSource,
        /function syncProfileModalLbi\(\)\s*\{/,
        'loader must define syncProfileModalLbi helper'
    );

    // 3. ensureProfileModalTemplate loads LBI assets alongside template
    assert.match(
        loaderSource,
        /ensureLabelInputStyles\(\)/,
        'ensureProfileModalTemplate must ensure LBI stylesheet'
    );
    assert.match(
        loaderSource,
        /ensureLabelInputRuntime\(\)/,
        'ensureProfileModalTemplate must ensure LBI runtime'
    );

    // 4. Warmup includes LBI styles and runtime
    assert.match(
        loaderSource,
        /ensureLabelInputStyles\(\)\.catch/,
        'warmup must warm LBI styles'
    );
    assert.match(
        loaderSource,
        /ensureLabelInputRuntime\(\)\.catch/,
        'warmup must warm LBI runtime'
    );
});

test('prompts.html and guestbook.html load shared label-input stylesheet and script', () => {
    const promptsHtml = readRepoFile('prompts.html');
    const guestbookHtml = readRepoFile('guestbook.html');

    // prompts.html
    assert.match(
        promptsHtml,
        /<link[^>]+href="css\/label-input\.css[^"]*"[^>]*>/,
        'prompts.html must load css/label-input.css'
    );
    assert.match(
        promptsHtml,
        /<script[^>]+src="js\/label-input\.js[^"]*"[^>]*><\/script>/,
        'prompts.html must load js/label-input.js'
    );

    // guestbook.html
    assert.match(
        guestbookHtml,
        /<link[^>]+href="(\.\/)?css\/label-input\.css[^"]*"[^>]*>/,
        'guestbook.html must load css/label-input.css'
    );
    assert.match(
        guestbookHtml,
        /<script[^>]+src="(\.\/)?js\/label-input\.js[^"]*"[^>]*><\/script>/,
        'guestbook.html must load js/label-input.js'
    );
});

test('supabase-auth-functions.js resyncs LBI on profile modal open', () => {
    const authSource = readRepoFile('supabase-auth-functions.js');

    assert.match(
        authSource,
        /window\.LabelInput\?\.scan\?\.\(\);[\s\S]*document\.querySelectorAll\('#profileModal \.lbi'\)\.forEach/,
        'openProfileModal animation frame must sync LBI fields'
    );
});
