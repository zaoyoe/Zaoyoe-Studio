const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('mobile related-mode return smoothly reveals detail content after geometry settles', () => {
    const promptsStyles = readRepoFile('prompts-poetry.css');
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsHtml = readRepoFile('prompts.html');

    assert.match(
        promptsStyles,
        /@media \(max-width: 768px\) \{[\s\S]*?\.modal-inner\.comment-mode-returning \.modal-image-col\s*\{[\s\S]*?flex:\s*0 0 40%;[\s\S]*?height:\s*40%;[\s\S]*?max-height:\s*none;[\s\S]*?transition:\s*none;[\s\S]*?\.modal-inner\.comment-mode-returning \.modal-content-col\s*\{[\s\S]*?flex:\s*0 0 60%;[\s\S]*?height:\s*60%;[\s\S]*?position:\s*static;[\s\S]*?backdrop-filter:\s*none;[\s\S]*?-webkit-backdrop-filter:\s*none;[\s\S]*?transition:\s*none;/,
        'mobile return should establish the final image and content geometry immediately so the image background stays fixed'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner\.comment-mode-returning \.modal-content-col\s*\{[\s\S]*?position:\s*static;/,
        'the returning content column should stop acting as the positioning container while its flex geometry changes'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner \.modal-image-col > #modalImg\s*\{[\s\S]*?inset:\s*0 !important;[\s\S]*?top:\s*0 !important;[\s\S]*?left:\s*0 !important;[\s\S]*?transform:\s*scale\(1\);[\s\S]*?transform-origin:\s*center center !important;/,
        'all mobile modal image states should share the same top-left positioning origin'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner\.comment-mode \.modal-image-col > #modalImg\s*\{[\s\S]*?inset:\s*0 !important;[\s\S]*?top:\s*0 !important;[\s\S]*?left:\s*0 !important;[\s\S]*?transform:\s*scale\(1\.08\) !important;[\s\S]*?transform-origin:\s*center center !important;/,
        'the related-mode image should zoom around the center without switching to percentage positioning'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner\.comment-mode-returning \.modal-image-col > #modalImg\s*\{[\s\S]*?object-fit:\s*contain !important;[\s\S]*?filter:\s*none !important;[\s\S]*?opacity:\s*1 !important;[\s\S]*?transition:\s*none;[\s\S]*?animation:\s*promptDetailReturnImageScale 480ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both;/,
        'the returning image should animate only its center scale on the fixed background'
    );
    assert.match(
        promptsStyles,
        /@keyframes promptDetailReturnImageScale\s*\{[\s\S]*?transform:\s*scale\(0\.75\);[\s\S]*?transform:\s*scale\(1\);/,
        'the returning mobile image should begin at seventy-five percent of its final size'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner\.comment-mode \.modal-image-col::after\s*\{[\s\S]*?linear-gradient\(180deg,[\s\S]*?rgba\(7, 15, 30, 0\.08\) 0%,[\s\S]*?rgba\(7, 15, 30, 0\.14\) 24%,[\s\S]*?rgba\(7, 15, 30, 0\.28\) 48%,[\s\S]*?rgba\(7, 15, 30, 0\.5\) 68%,[\s\S]*?rgba\(7, 15, 30, 0\.76\) 84%,[\s\S]*?rgba\(7, 15, 30, 0\.96\) 100%\);/,
        'dark mobile side modes should use one continuous gradient that meets the dark content surface'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner\.comment-mode \.modal-image-col > #modalImg\s*\{[\s\S]*?filter:\s*blur\(2px\) saturate\(0\.98\) brightness\(0\.82\);[\s\S]*?opacity:\s*0\.9;/,
        'dark comment and related modes should keep the image recognizable beneath the gradient'
    );
    assert.match(
        promptsStyles,
        /html\[data-theme="light"\] \.modal-inner\.comment-mode \.modal-image-col::after,[\s\S]*?linear-gradient\(180deg,[\s\S]*?rgba\(248, 250, 252, 0\.06\) 0%,[\s\S]*?rgba\(248, 250, 252, 0\.12\) 24%,[\s\S]*?rgba\(248, 250, 252, 0\.26\) 48%,[\s\S]*?rgba\(248, 250, 252, 0\.5\) 68%,[\s\S]*?rgba\(248, 250, 252, 0\.78\) 84%,[\s\S]*?rgba\(248, 250, 252, 0\.98\) 100%\);/,
        'light mobile side modes should use one continuous multi-stop gradient without a layered breakpoint'
    );
    assert.match(
        promptsStyles,
        /html\[data-theme="light"\] \.modal-inner\.comment-mode \.modal-image-col > #modalImg,[\s\S]*?filter:\s*blur\(2px\) saturate\(1\.02\) brightness\(1\.04\);[\s\S]*?opacity:\s*0\.9;/,
        'light comment and related modes should share the same mild image treatment'
    );
    assert.equal(
        /\.modal-inner(?:\.comment-mode-returning|\.comment-mode)? \.modal-image-col > #modalImg\s*\{[^}]*translate(?:3d|X|Y)?\(/.test(promptsStyles),
        false,
        'mobile side-mode image selectors should never reintroduce translated percentage centering'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner\.comment-mode-returning \.modal-header\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*calc\(40% \+ 24px\);[\s\S]*?left:\s*24px;[\s\S]*?right:\s*24px;[\s\S]*?opacity:\s*0;[\s\S]*?visibility:\s*hidden;[\s\S]*?transform:\s*none;[\s\S]*?transition:\s*none;/,
        'mobile return should pin and hide the complete title container before its reveal animation'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner\.comment-mode-returning \.modal-title-large\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*none;/,
        'the title should not run a second opacity layer inside the hidden animated container'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner\.comment-mode-returning \.prompt-area\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?left:\s*24px;[\s\S]*?right:\s*24px;[\s\S]*?bottom:\s*16px;[\s\S]*?max-height:\s*none;[\s\S]*?opacity:\s*0;[\s\S]*?visibility:\s*hidden;[\s\S]*?margin:\s*0 !important;[\s\S]*?padding:\s*14px 20px 16px;[\s\S]*?transition:\s*none;/,
        'mobile return should pin the complete prompt card and prevent padding growth from pulling it upward'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner\.comment-mode-returning\.comment-mode-title-revealing \.modal-header\s*\{[\s\S]*?visibility:\s*visible;[\s\S]*?animation:\s*promptDetailReturnContentSettle 480ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both;/,
        'the complete title container should use the shared prompt-card animation and image zoom curve'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner\.comment-mode-returning\.comment-mode-title-revealing \.prompt-area\s*\{[\s\S]*?visibility:\s*visible;[\s\S]*?animation:\s*promptDetailReturnContentSettle 480ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both;/,
        'the prompt card should use the exact same shared animation without stagger'
    );
    assert.match(
        promptsStyles,
        /@keyframes promptDetailReturnContentSettle\s*\{[\s\S]*?opacity:\s*0\.82;[\s\S]*?translate3d\(0, -24px, 0\);[\s\S]*?opacity:\s*1;[\s\S]*?translate3d\(0, 0, 0\);/,
        'the title and prompt card should share one visible downward fade instead of flashing independently'
    );
    assert.equal(
        promptsSource.includes('const PROMPT_MOBILE_SIDE_MODE_RETURN_CLEANUP_MS = 620;')
            && !promptsSource.includes('PROMPT_MOBILE_SIDE_MODE_RETURN_REVEAL_DELAY_MS'),
        true,
        'mobile content should not retain a delayed reveal timeline'
    );
    assert.equal(
        promptsSource.includes('startPromptModalReturnImageFreeze')
            || promptsSource.includes('modal-return-image-freeze')
            || promptsStyles.includes('.modal-return-image-freeze')
            || promptsStyles.includes('.modal-image-col--return-settling'),
        false,
        'mobile return should render one real image layer instead of cross-fading a cloned compositor layer'
    );
    assert.match(
        promptsSource,
        /if \(isMobileLayout\) \{\s*revealPromptDetailContent\(\);\s*\} else \{\s*requestAnimationFrame\(revealPromptDetailContent\);/,
        'mobile content should start with the image return while desktop keeps its existing next-frame reveal'
    );
    assert.match(
        promptsSource,
        /openPromptModal\(getPromptStableOpenId\(relatedPrompt\), \{ animateRelatedSelection: true \}\);/,
        'selecting a recommended related prompt should request the shared detail reveal animation'
    );
    assert.match(
        promptsSource,
        /const shouldAnimateRelatedSelection = options\.animateRelatedSelection === true[\s\S]*?modal\?\.classList\.contains\('active'\)[\s\S]*?modalInner\?\.classList\.contains\('related-mode'\);/,
        'the shared animation should only run for an active mobile related-prompt selection'
    );
    assert.match(
        promptsSource,
        /if \(shouldAnimateRelatedSelection\) \{\s*modalInner\?\.classList\.add\('comment-mode-returning'\);\s*\}[\s\S]*?setPromptModalPromptContent\(promptText, item\);\s*if \(shouldAnimateRelatedSelection\) \{\s*startPromptDetailReturnReveal\(modalInner, \{ isMobileLayout: true \}\);\s*\}/,
        'the recommended prompt should populate its content before starting the same pinned reveal state'
    );
    assert.equal(
        promptsSource.includes('promptCommentModeTitleRevealTimer'),
        false,
        'mobile return should no longer keep a separate reveal timer'
    );
    assert.equal(
        promptsHtml.includes('relatedReturnReveal=20260715_PROMPT_RELATED_RETURN_REVEAL_25'),
        true,
        'the prompt stylesheet should be cache-busted for the related return reveal fix'
    );
    assert.equal(
        promptsHtml.includes('relatedSelectionReveal=20260715_PROMPT_RELATED_SELECTION_REVEAL_1'),
        true,
        'the prompt script should be cache-busted for the related selection reveal'
    );
    assert.equal(
        promptsHtml.includes('sideModeHeaderMask=20260715_PROMPT_SIDE_MODE_HEADER_MASK_1'),
        true,
        'the prompt stylesheet should be cache-busted for the shared side-mode header mask'
    );
});
