const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const collector = require(path.resolve(__dirname, '../integrations/meigen-gallery-collector/meigen-gallery-collector.user.js'));

test('Meigen browser collector exports import-compatible payload helpers', () => {
    assert.equal(collector.SOURCE, 'meigen');
    assert.equal(typeof collector.collectMeigenGalleryItems, 'function');
    assert.equal(typeof collector.buildPayload, 'function');
    assert.equal(typeof collector.runCollector, 'function');
    assert.equal(typeof collector.parseFavoriteCount, 'function');
    assert.equal(typeof collector.mergeCollectedItems, 'function');
    assert.equal(typeof collector._private.extractPromptText, 'function');
    assert.equal(typeof collector._private.getOriginalWorkUrl, 'function');
    assert.equal(typeof collector._private.cleanPromptText, 'function');
    assert.equal(typeof collector._private.isOriginalWorkStatusUrl, 'function');
    assert.equal(typeof collector._private.getAuthorName, 'function');
    assert.equal(typeof collector._private.getOriginalStatusId, 'function');
    assert.equal(typeof collector._private.buildOriginalWorkUrlFromHandleAndStatusId, 'function');
    assert.equal(typeof collector._private.getStatusIdFromImageUrl, 'function');
    assert.equal(typeof collector._private.expandTweetImageSequence, 'function');
    assert.equal(typeof collector._private.buildMeigenDetailUrlFromStatusId, 'function');
    assert.equal(typeof collector._private.getNodeDocumentOrderScore, 'function');
    assert.equal(typeof collector._private.itemMatchesFavoriteRange, 'function');
    assert.equal(typeof collector._private.collectStructuredItemCandidates, 'function');
    assert.equal(typeof collector._private.getBestStructuredCandidate, 'function');
    assert.equal(typeof collector._private.isLikelyUnboundMeigenCommunityImageUrl, 'function');
    assert.equal(typeof collector._private.isImageUrlTrustedForStatus, 'function');
    assert.equal(typeof collector._private.isUnresolvablePlaceholderItem, 'function');
    assert.equal(typeof collector._private.getMeigenGenerationImageIdentity, 'function');
});

test('Meigen browser collector parses favorite counts for admin range filtering', () => {
    assert.equal(collector.parseFavoriteCount('收藏 128'), 128);
    assert.equal(collector.parseFavoriteCount('1.2k bookmarks'), 1200);
    assert.equal(collector.parseFavoriteCount('2.5万 收藏'), 25000);
});

test('Meigen browser collector filters items by favorite range', () => {
    assert.equal(collector._private.itemMatchesFavoriteRange({ favorite_count: 99 }, { minFavorites: 100 }), false);
    assert.equal(collector._private.itemMatchesFavoriteRange({ favorite_count: 100 }, { minFavorites: 100 }), true);
    assert.equal(collector._private.itemMatchesFavoriteRange({ favorite_count: 401 }, { maxFavorites: 400 }), false);
    assert.equal(collector._private.itemMatchesFavoriteRange({ favorite_count: 250 }, { minFavorites: 100, maxFavorites: 400 }), true);
});

test('Meigen browser collector skips cards without detail, prompt, or source identity', () => {
    assert.equal(collector._private.isUnresolvablePlaceholderItem({
        detailUrl: '',
        promptText: '',
        originalWorkUrl: '',
        imageUrls: ['https://images.meigen.ai/generations/2026-07/community_f3f4d562-4dca-4229-834e-b424b8c3ad1e.png']
    }), true);
    assert.equal(collector._private.isUnresolvablePlaceholderItem({
        detailUrl: 'https://www.meigen.ai/prompt/community_example',
        promptText: '',
        originalWorkUrl: '',
        imageUrls: ['https://images.meigen.ai/generations/2026-07/community_example.png']
    }), false);
});

test('Meigen browser collector dedupes direct and proxied community generation images', () => {
    const direct = 'https://images.meigen.ai/generations/2026-07/community_b232f212-3458-435e-bfb5-2cd370cca19a.png';
    const proxied = 'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/generations/2026-07/community_b232f212-3458-435e-bfb5-2cd370cca19a.png';
    const items = collector.mergeCollectedItems([{
        source: 'meigen',
        source_item_id: 'community-b232',
        source_page_url: 'https://www.meigen.ai/prompt/community_b232f212-3458-435e-bfb5-2cd370cca19a',
        prompt_text: 'A complete community generation prompt.',
        image_sources: [{ url: proxied }, { url: direct }]
    }]);

    assert.equal(items.length, 1);
    assert.deepEqual(items[0].image_sources, [{ url: direct }]);
});

test('Meigen browser collector merges multiple images into one prompt item', () => {
    const items = collector.mergeCollectedItems([
        {
            source: 'meigen',
            source_item_id: 'a',
            source_page_url: 'https://www.meigen.ai/prompt/a',
            original_work_url: 'https://x.com/example/status/1',
            author_name: 'Example',
            author_handle: '@example',
            favorite_count: 10,
            prompt_text: 'A glass apple city',
            image_sources: [{ url: 'https://cdn.example.com/a.jpg' }]
        },
        {
            source: 'meigen',
            source_item_id: 'a-2',
            source_page_url: 'https://www.meigen.ai/prompt/a',
            original_work_url: '',
            author_name: '',
            author_handle: '',
            favorite_count: 28,
            prompt_text: '',
            image_sources: [
                { url: 'https://cdn.example.com/a.jpg' },
                { url: 'https://cdn.example.com/b.webp' }
            ]
        }
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].prompt_text, 'A glass apple city');
    assert.equal(items[0].original_work_url, 'https://x.com/example/status/1');
    assert.equal(items[0].author_handle, '@example');
    assert.equal(items[0].favorite_count, 28);
    assert.deepEqual(items[0].image_sources, [
        { url: 'https://cdn.example.com/a.jpg' },
        { url: 'https://cdn.example.com/b.webp' }
    ]);
});

test('Meigen browser collector merges detail data back into list item by source item id', () => {
    const items = collector.mergeCollectedItems([
        {
            source: 'meigen',
            source_item_id: 'meigen-list-1',
            source_page_url: '',
            original_work_url: '',
            author_name: '',
            author_handle: '@Taaruk_',
            favorite_count: 0,
            prompt_text: '',
            image_sources: [{ url: 'https://cdn.example.com/list-thumb.jpg' }]
        },
        {
            source: 'meigen',
            source_item_id: 'meigen-list-1',
            source_page_url: 'https://www.meigen.ai/prompt/2018204485517287451',
            original_work_url: 'https://x.com/Taaruk_/status/2018204485517287451',
            author_name: 'Taaruk',
            author_handle: '@Taaruk_',
            favorite_count: 12,
            prompt_text: 'A detailed food photography prompt captured from the right prompt sidebar.',
            expected_image_count: 4,
            image_sources: [
                { url: 'https://cdn.example.com/detail-1.jpg' },
                { url: 'https://cdn.example.com/detail-2.jpg' },
                { url: 'https://cdn.example.com/detail-3.jpg' },
                { url: 'https://cdn.example.com/detail-4.jpg' }
            ]
        }
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].source_item_id, 'meigen-list-1');
    assert.equal(items[0].source_page_url, 'https://www.meigen.ai/prompt/2018204485517287451');
    assert.equal(items[0].prompt_text, 'A detailed food photography prompt captured from the right prompt sidebar.');
    assert.equal(items[0].image_sources.length, 4);
});

test('Meigen browser collector lets authoritative detail count shrink list image guesses', () => {
    const items = collector.mergeCollectedItems([
        {
            source: 'meigen',
            source_item_id: 'meigen-single',
            source_page_url: 'https://www.meigen.ai/prompt/2018204485517287451',
            original_work_url: 'https://x.com/bananababydoll/status/2018204485517287451',
            author_name: 'babydoll',
            author_handle: '@bananababydoll',
            favorite_count: 192,
            prompt_text: 'List preview prompt',
            expected_image_count: 4,
            image_sources: [
                { url: 'https://cdn.example.com/list-0.jpg' },
                { url: 'https://cdn.example.com/list-1.jpg' },
                { url: 'https://cdn.example.com/list-2.jpg' },
                { url: 'https://cdn.example.com/list-3.jpg' }
            ]
        },
        {
            source: 'meigen',
            source_item_id: 'meigen-single',
            source_page_url: 'https://www.meigen.ai/prompt/2018204485517287451',
            original_work_url: 'https://x.com/bananababydoll/status/2018204485517287451',
            author_name: 'babydoll',
            author_handle: '@bananababydoll',
            favorite_count: 193,
            prompt_text: 'Detail prompt from right sidebar',
            expected_image_count: 1,
            detail_image_count_authoritative: true,
            image_sources: [
                { url: 'https://cdn.example.com/detail-only.jpg' }
            ]
        }
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].expected_image_count, 1);
    assert.equal(items[0].detail_image_count_authoritative, true);
    assert.deepEqual(items[0].image_sources, [
        { url: 'https://cdn.example.com/detail-only.jpg' }
    ]);
});

test('Meigen browser collector keeps list candidates when detail carousel is incomplete', () => {
    const items = collector.mergeCollectedItems([
        {
            source: 'meigen',
            source_item_id: 'meigen-carousel',
            source_page_url: 'https://www.meigen.ai/prompt/2027911721860616479',
            original_work_url: 'https://x.com/Taaruk_/status/2027911721860616479',
            author_name: 'Taaruk',
            author_handle: '@Taaruk_',
            favorite_count: 191,
            prompt_text: 'List prompt',
            expected_image_count: 4,
            image_sources: [
                { url: 'https://cdn.example.com/list-0.jpg' },
                { url: 'https://cdn.example.com/list-1.jpg' },
                { url: 'https://cdn.example.com/list-2.jpg' },
                { url: 'https://cdn.example.com/list-3.jpg' }
            ]
        },
        {
            source: 'meigen',
            source_item_id: 'meigen-carousel',
            source_page_url: 'https://www.meigen.ai/prompt/2027911721860616479',
            original_work_url: 'https://x.com/Taaruk_/status/2027911721860616479',
            author_name: 'Taaruk',
            author_handle: '@Taaruk_',
            favorite_count: 191,
            prompt_text: 'Detail prompt',
            expected_image_count: 4,
            detail_image_count_authoritative: false,
            image_sources: [
                { url: 'https://cdn.example.com/detail-0.jpg' }
            ]
        }
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].expected_image_count, 4);
    assert.equal(items[0].detail_image_count_authoritative, false);
    assert.deepEqual(items[0].image_sources, [
        { url: 'https://cdn.example.com/list-0.jpg' },
        { url: 'https://cdn.example.com/list-1.jpg' },
        { url: 'https://cdn.example.com/list-2.jpg' },
        { url: 'https://cdn.example.com/list-3.jpg' }
    ]);
});

test('Meigen browser collector lets authoritative detail count shrink list image guesses without detail images', () => {
    const items = collector.mergeCollectedItems([
        {
            source: 'meigen',
            source_item_id: 'meigen-count',
            source_page_url: 'https://www.meigen.ai/prompt/2051006164377460820',
            original_work_url: 'https://x.com/Ciri_ai/status/2051006164377460820',
            author_name: 'Ciri',
            author_handle: '@Ciri_ai',
            favorite_count: 1900,
            prompt_text: 'Low-angle aesthetic portrait of a subject standing under a bright blue sky.',
            expected_image_count: 4,
            image_sources: [
                { url: 'https://images.meigen.ai/tweets/2051006164377460820/0.jpg' },
                { url: 'https://images.meigen.ai/tweets/2051006164377460820/1.jpg' },
                { url: 'https://images.meigen.ai/tweets/2051006164377460820/2.jpg' },
                { url: 'https://images.meigen.ai/tweets/2051006164377460820/3.jpg' }
            ]
        },
        {
            source: 'meigen',
            source_item_id: 'meigen-count',
            source_page_url: 'https://www.meigen.ai/prompt/2051006164377460820',
            original_work_url: 'https://x.com/Ciri_ai/status/2051006164377460820',
            author_name: 'Ciri',
            author_handle: '@Ciri_ai',
            favorite_count: 1900,
            prompt_text: 'Low-angle aesthetic portrait of a subject standing under a bright blue sky.',
            expected_image_count: 1,
            detail_expected_count_authoritative: true,
            detail_image_count_authoritative: false,
            image_sources: []
        }
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].expected_image_count, 1);
    assert.equal(items[0].detail_expected_count_authoritative, true);
    assert.deepEqual(items[0].image_sources, [
        { url: 'https://images.meigen.ai/tweets/2051006164377460820/0.jpg' }
    ]);
});

test('Meigen browser collector payload matches Gallery Import queue shape', () => {
    const payload = collector.buildPayload([
        {
            source: 'meigen',
            source_item_id: 'missing-source',
            source_page_url: 'https://www.meigen.ai/prompt/missing-source',
            original_work_url: '',
            author_name: '',
            author_handle: '',
            favorite_count: 0,
            prompt_text: '',
            image_sources: [{ url: 'https://cdn.example.com/needs-review.jpg' }]
        }
    ]);

    assert.equal(payload.source, 'meigen');
    assert.match(payload.collector_version, /^2026-07-\d{2}\.\d+$/);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].prompt_text, '');
    assert.equal(payload.items[0].image_sources.length, 1);
    assert.equal(payload.items[0].original_work_url, '');
    assert.equal(payload.items[0].author_handle, '');
});

test('Meigen browser collector reads prompt and source from structured page data', () => {
    const prompt = 'A cinematic portrait in a neon glass garden, 85mm lens, soft rim light';
    const sourceUrl = 'https://x.com/example/status/1934567890123456789';
    const scriptNode = {
        textContent: JSON.stringify({
            props: {
                pageProps: {
                    prompt: {
                        promptText: prompt,
                        sourceUrl
                    }
                }
            }
        })
    };
    const scope = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/123',
        querySelectorAll(selector) {
            return String(selector).includes('script') ? [scriptNode] : [];
        },
        innerText: '',
        textContent: ''
    };

    assert.equal(collector._private.extractPromptText(scope), prompt);
    assert.equal(collector._private.getOriginalWorkUrl(scope), sourceUrl);
});

test('Meigen browser collector fills prompt and carousel images from page data cache', () => {
    const prompt = 'Create a premium modern tech product promotional social media poster with dramatic rim light and glass reflections.';
    const sourceUrl = 'https://x.com/Sheldon056/status/2074697587756806354';
    const detailUrl = 'https://www.meigen.ai/prompt/abc123';
    const scriptNode = {
        textContent: JSON.stringify({
            props: {
                pageProps: {
                    work: {
                        id: 'abc123',
                        detailUrl,
                        promptText: prompt,
                        sourceUrl,
                        author: {
                            displayName: 'Duet | AI',
                            username: 'Sheldon056'
                        },
                        images: [
                            { url: 'https://cdn.example.com/art-1.jpg' },
                            { url: 'https://cdn.example.com/art-2.jpg' },
                            { url: 'https://cdn.example.com/art-3.jpg' },
                            { url: 'https://cdn.example.com/art-4.jpg' }
                        ],
                        related: [
                            { images: [{ url: 'https://cdn.example.com/related-1.jpg' }] }
                        ]
                    }
                }
            }
        })
    };
    const image = {
        currentSrc: 'https://cdn.example.com/art-1.jpg',
        src: 'https://cdn.example.com/art-1.jpg',
        width: 1024,
        height: 1024,
        naturalWidth: 1024,
        naturalHeight: 1024,
        className: '',
        id: '',
        parentElement: null,
        getAttribute(name) {
            return name === 'src' ? this.src : '';
        },
        getBoundingClientRect() {
            return { width: 1024, height: 1024, top: 20, left: 20 };
        },
        closest() {
            return null;
        }
    };
    const scope = {
        dataset: {},
        baseURI: detailUrl,
        innerText: '1 / 4\nDuet | AI\n@Sheldon056\n复制 Prompt',
        textContent: '',
        querySelector() {
            return null;
        },
        querySelectorAll(selector) {
            if (String(selector).includes('script')) return [scriptNode];
            if (selector === 'img' || selector === 'img, source') return [image];
            return [];
        }
    };

    const items = collector.collectMeigenGalleryItems(scope, {
        baseUrl: detailUrl,
        expectedDetailUrl: detailUrl,
        detailOnly: true,
        expectedImageUrls: ['https://cdn.example.com/art-1.jpg'],
        expectedAuthorHandle: '@Sheldon056'
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].prompt_text, prompt);
    assert.equal(items[0].original_work_url, sourceUrl);
    assert.equal(items[0].author_name, 'Duet | AI');
    assert.equal(items[0].author_handle, '@Sheldon056');
    assert.equal(items[0].expected_image_count, 4);
    assert.deepEqual(items[0].image_sources, [
        { url: 'https://cdn.example.com/art-1.jpg' },
        { url: 'https://cdn.example.com/art-2.jpg' },
        { url: 'https://cdn.example.com/art-3.jpg' },
        { url: 'https://cdn.example.com/art-4.jpg' }
    ]);
});

test('Meigen browser collector matches current structured item and ignores related page data', () => {
    const currentPrompt = 'An editorial cyberpunk fashion portrait with silver fabric, rain reflections, and a clean studio background.';
    const currentUrl = 'https://www.meigen.ai/prompt/current123';
    const scriptNode = {
        textContent: JSON.stringify({
            props: {
                pageProps: {
                    feed: [
                        {
                            id: 'other123',
                            detailUrl: 'https://www.meigen.ai/prompt/other123',
                            promptText: 'A different prompt that should not win matching.',
                            sourceUrl: 'https://x.com/other/status/2074697587756806000',
                            images: [
                                { url: 'https://cdn.example.com/other-1.jpg' },
                                { url: 'https://cdn.example.com/other-2.jpg' }
                            ]
                        },
                        {
                            id: 'current123',
                            detailUrl: currentUrl,
                            promptText: currentPrompt,
                            sourceUrl: 'https://x.com/harboriis/status/2074697587756806354',
                            author: {
                                displayName: 'Harbor',
                                handle: '@harboriis'
                            },
                            generatedImages: [
                                { url: 'https://cdn.example.com/current-1.jpg' },
                                { url: 'https://cdn.example.com/current-2.jpg' },
                                { url: 'https://cdn.example.com/current-3.jpg' }
                            ],
                            moreRelatedContent: [
                                { imageUrl: 'https://cdn.example.com/related-should-not-import.jpg' }
                            ]
                        }
                    ]
                }
            }
        })
    };
    const scope = {
        dataset: {},
        baseURI: currentUrl,
        innerText: '1 / 3\nHarbor\n@harboriis',
        textContent: '',
        querySelector() {
            return null;
        },
        querySelectorAll(selector) {
            if (String(selector).includes('script')) return [scriptNode];
            if (selector === 'img' || selector === 'img, source') return [];
            return [];
        }
    };

    const best = collector._private.getBestStructuredCandidate(scope, {
        baseUrl: currentUrl,
        expectedDetailUrl: currentUrl,
        expectedAuthorHandle: '@harboriis',
        detailOnly: true
    });

    assert.equal(best.promptText, currentPrompt);
    assert.deepEqual(best.imageUrls, [
        'https://cdn.example.com/current-1.jpg',
        'https://cdn.example.com/current-2.jpg',
        'https://cdn.example.com/current-3.jpg'
    ]);
});

test('Meigen browser collector removes UI action text from prompts', () => {
    const prompt = [
        'Ultra-realistic premium product advertisement of a cappuccino coffee bottle, centered composition, studio light',
        '展开',
        '更多相关内容',
        '使用 Prompt',
        '用作参考图'
    ].join('\n');

    assert.equal(
        collector._private.cleanPromptText(prompt),
        'Ultra-realistic premium product advertisement of a cappuccino coffee bottle, centered composition, studio light'
    );
});

test('Meigen browser collector only accepts original X status urls', () => {
    assert.equal(collector._private.isOriginalWorkStatusUrl('https://x.com/Taaruk_/status/1934567890123456789'), true);
    assert.equal(collector._private.isOriginalWorkStatusUrl('https://twitter.com/Taaruk_/status/1934567890123456789'), true);
    assert.equal(collector._private.isOriginalWorkStatusUrl('https://x.com/Taaruk_'), false);
    assert.equal(collector._private.isOriginalWorkStatusUrl('https://x.com/intent/post?text=hello'), false);
});

test('Meigen browser collector filters avatars and tiny icons from image sources', () => {
    function createImage({ src, width, height, className = '' }) {
        return {
            currentSrc: src,
            src,
            width,
            height,
            naturalWidth: width,
            naturalHeight: height,
            className,
            id: '',
            parentElement: null,
            getAttribute(name) {
                if (name === 'src') return src;
                if (name === 'width') return String(width);
                if (name === 'height') return String(height);
                return '';
            },
            closest() {
                return null;
            }
        };
    }

    const artwork = createImage({
        src: 'https://cdn.example.com/artwork.jpg',
        width: 1024,
        height: 768
    });
    const avatar = createImage({
        src: 'https://cdn.example.com/avatar.jpg',
        width: 96,
        height: 96,
        className: 'author-avatar'
    });
    const icon = createImage({
        src: 'https://cdn.example.com/icon.png',
        width: 32,
        height: 32,
        className: 'toolbar-icon'
    });
    const scope = {
        baseURI: 'https://www.meigen.ai/prompt/123',
        querySelectorAll(selector) {
            if (selector === 'img, source') return [artwork, avatar, icon];
            return [];
        }
    };

    assert.deepEqual(collector.collectImageUrls(scope), ['https://cdn.example.com/artwork.jpg']);
});

test('Meigen browser collector reads X status url from hover X controls', () => {
    const statusUrl = 'https://x.com/harboriis/status/1934567890123456789';
    const xButton = {
        href: '',
        textContent: '在 X 上查看',
        getAttribute(name) {
            if (name === 'aria-label') return '在 X 上查看';
            if (name === 'onclick') return `window.open("${statusUrl}")`;
            return '';
        }
    };
    const scope = {
        baseURI: 'https://www.meigen.ai/prompt/harboriis',
        querySelectorAll(selector) {
            if (String(selector).includes('button')) return [xButton];
            return [];
        }
    };

    assert.equal(collector._private.getOriginalWorkUrl(scope), statusUrl);
});

test('Meigen browser collector reads encoded X status url from share controls', () => {
    const statusUrl = 'https://x.com/itsjessiababy/status/2074697587756806354';
    const encodedButton = {
        href: `https://x.com/intent/post?text=${encodeURIComponent(statusUrl)}`,
        outerHTML: `<a href="https://x.com/intent/post?text=${encodeURIComponent(statusUrl)}">X</a>`,
        textContent: '在 X 上查看',
        getAttribute(name) {
            if (name === 'href') return this.href;
            if (name === 'aria-label') return '在 X 上查看';
            return '';
        }
    };
    const scope = {
        baseURI: 'https://www.meigen.ai/prompt/2074697587756806354',
        querySelectorAll(selector) {
            if (String(selector).includes('a[href]')) return [encodedButton];
            return [];
        }
    };

    assert.equal(collector._private.getOriginalWorkUrl(scope), statusUrl);
});

test('Meigen browser collector reads detail author name and handle from author block', () => {
    const authorBlock = {
        dataset: {},
        innerText: 'Harboriis\n@harboriis\n207\n复制Prompt',
        textContent: 'Harboriis\n@harboriis\n207\n复制Prompt',
        className: '',
        id: '',
        getAttribute() {
            return '';
        },
        parentElement: null,
        querySelectorAll(selector) {
            if (String(selector).includes('span')) return [this];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    assert.equal(collector._private.getAuthorName(authorBlock), 'Harboriis');
    assert.equal(collector._private.getAuthorHandle(authorBlock, ''), '@harboriis');
});

test('Meigen browser collector reads detail author nickname from top lines near handle', () => {
    const scope = {
        dataset: {},
        innerText: [
            'Avelyrah',
            '@itsjessiababy',
            '205',
            '复制Prompt',
            '提示词',
            'Ultra realistic professional business portrait based on the attached image.'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (String(selector).includes('span') || String(selector).includes('div')) return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    assert.equal(collector._private.getAuthorHandle(scope, ''), '@itsjessiababy');
    assert.equal(collector._private.getAuthorName(scope, '@itsjessiababy'), 'Avelyrah');
});

test('Meigen browser collector reads detail nickname before metadata without a visible handle', () => {
    const scope = {
        dataset: {},
        innerText: [
            'Luiz Eduardo da Costa Gomes',
            'GPT Image',
            '收藏',
            '复制Prompt',
            '提示词',
            'NO texto principal escreva: megafilmespro'
        ].join('\n'),
        textContent: '',
        querySelectorAll() {
            return [];
        },
        querySelector() {
            return null;
        }
    };

    assert.equal(collector._private.getAuthorName(scope, '@user_9782b976'), 'Luiz Eduardo da Costa Gomes');
});

test('Meigen browser collector does not use card prompt text as hover nickname', () => {
    const scope = {
        dataset: {},
        innerText: [
            '0 收藏',
            '从参考图开始创作 角色 创建并复用 AI 角色',
            'NO texto principal escreva: megafilmespro'
        ].join('\n'),
        textContent: '',
        querySelectorAll() {
            return [];
        },
        querySelector() {
            return null;
        }
    };

    assert.equal(collector._private.getAuthorName(scope, '@user_9782b976'), '');
});

test('Meigen browser collector reads prompt from detail prompt section without action text', () => {
    const prompt = 'Create a premium modern tech product promotional social media poster for [BRAND NAME]. Modern futuristic tech advertising design.';
    const scope = {
        dataset: {},
        innerText: [
            'Duet | AI',
            '@Sheldon056',
            '收藏',
            '复制Prompt',
            '提示词',
            prompt,
            '展开',
            '更多相关内容',
            '使用 Prompt'
        ].join('\n'),
        textContent: '',
        querySelectorAll() {
            return [];
        }
    };

    assert.equal(collector._private.extractPromptText(scope), prompt);
});

test('Meigen browser collector reads visible detail prompt before expand/copy succeeds', () => {
    const visiblePrompt = 'Editorial minimalist portrait of a stylish young man sitting comfortably on the floor wearing an oversized charcoal hoodie, cream trousers, white sneakers, holding a smartphone for a selfie. Behind him, a giant black-and-white doodle character hugs him tightly while leaning into...';
    const scope = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/social-media',
        innerText: [
            'social media',
            '17',
            '复制Prompt',
            '提示词',
            visiblePrompt,
            '展开',
            '更多相关内容',
            '使用 Prompt',
            '用作参考图'
        ].join('\n'),
        textContent: '',
        querySelectorAll() {
            return [];
        }
    };

    assert.equal(collector._private.extractPromptText(scope), visiblePrompt);
});

test('Meigen browser collector reads right sidebar JSON-style prompt below label', () => {
    const prompt = '{ "subject": { "primary": "Vibrant orange slices", "action": "Falling through the air toward rising milk", "secondary": "Thick, glossy white milk splash forming arcs and crown-like curves", "details": "Milk droplets frozen mid-air with creamy texture" }, "environment": {...';
    const scope = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/fruit-splash',
        innerText: [
            'Sharon Riley ↗',
            '@Just_sharon7',
            '186',
            '复制Prompt',
            '提示词',
            prompt,
            '展开',
            '更多相关内容'
        ].join('\n'),
        textContent: '',
        querySelectorAll() {
            return [];
        }
    };

    assert.equal(collector._private.extractPromptText(scope), prompt);
});

test('Meigen browser collector rejects creator lists as prompt text', () => {
    const creatorList = [
        'Lab',
        '@iamaiistudio',
        '使用创意',
        '9',
        'Алексей Колесов',
        '使用创意',
        '15',
        '𝗦𝗮𝗻𝗶𝗮',
        '@saniaspeaks_',
        '使用创意',
        '218',
        'Taaruk',
        '@Taaruk_',
        '使用创意',
        '1.5K',
        'K',
        '@ChillaiKalan__',
        '使用创意',
        '203',
        'Harboriis',
        '@harboriis',
        '使用创意'
    ].join('\n');
    const scope = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/',
        innerText: creatorList,
        textContent: '',
        querySelectorAll() {
            return [];
        }
    };

    assert.equal(collector._private.cleanPromptText(creatorList), '');
    assert.equal(collector._private.extractPromptText(scope), '');
});

test('Meigen browser collector rejects Meigen marketing copy as prompt text', () => {
    const marketingCopy = 'Free GPT Image 2 and Nano Banana prompts + Seedance 2.0 video prompts. Copy, paste, generate — no prompt engineering needed.';
    const scope = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/',
        innerText: [
            '0 收藏',
            marketingCopy,
            'Sgt Sref'
        ].join('\n'),
        textContent: '',
        querySelectorAll() {
            return [];
        }
    };

    assert.equal(collector._private.cleanPromptText(marketingCopy), '');
    assert.equal(collector._private.extractPromptText(scope), '');
});

test('Meigen browser collector reads compact visible prompt when label and text collapse into one line', () => {
    const prompt = 'Editorial minimalist portrait of a stylish young man sitting comfortably on the floor wearing an oversized charcoal hoodie, cream trousers, white sneakers, holding a smartphone for a selfie.';
    const scope = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/social-media',
        innerText: `social media 17 复制Prompt 提示词 ${prompt} 展开 更多相关内容`,
        textContent: '',
        querySelectorAll() {
            return [];
        }
    };

    assert.equal(collector._private.extractPromptText(scope), prompt);
});

test('Meigen browser collector merges split detail image and prompt regions', () => {
    const prompt = 'Editorial minimalist portrait of a stylish young man sitting comfortably on the floor wearing an oversized charcoal hoodie, cream trousers, white sneakers.';
    function createImage(src) {
        return {
            currentSrc: src,
            src,
            width: 1024,
            height: 1024,
            naturalWidth: 1024,
            naturalHeight: 1024,
            className: '',
            id: '',
            parentElement: null,
            getAttribute(name) {
                return name === 'src' ? src : '';
            },
            getBoundingClientRect() {
                return { width: 1024, height: 1024, top: 20, left: 20 };
            },
            closest() {
                return null;
            }
        };
    }
    const dialog = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/social-media',
        innerText: '1 / 2',
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'img' || selector === 'img, source') {
                return [
                    createImage('https://cdn.example.com/social-1.jpg'),
                    createImage('https://cdn.example.com/social-2.jpg')
                ];
            }
            return [];
        },
        querySelector() {
            return null;
        }
    };
    const main = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/social-media',
        innerText: [
            'social media',
            '17',
            '复制Prompt',
            '提示词',
            prompt,
            '展开',
            '更多相关内容'
        ].join('\n'),
        textContent: '',
        querySelectorAll() {
            return [];
        },
        querySelector() {
            return null;
        }
    };
    const documentRef = {
        baseURI: 'https://www.meigen.ai/prompt/social-media',
        body: main,
        querySelector(selector) {
            if (selector === '[role="dialog"]') return dialog;
            if (selector === 'main') return main;
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };

    const items = collector.collectMeigenGalleryItems(documentRef, {
        baseUrl: 'https://www.meigen.ai/prompt/social-media',
        detailOnly: true
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].prompt_text, prompt);
    assert.deepEqual(items[0].image_sources, [
        { url: 'https://cdn.example.com/social-1.jpg' },
        { url: 'https://cdn.example.com/social-2.jpg' }
    ]);
});

test('Meigen browser collector prefers detail author profile link text over prompt text', () => {
    const authorLink = {
        href: 'https://x.com/Sheldon056',
        innerText: 'Duet | AI ↗',
        textContent: 'Duet | AI ↗',
        getAttribute(name) {
            if (name === 'href') return 'https://x.com/Sheldon056';
            return '';
        }
    };
    const handleNode = {
        innerText: '@Sheldon056',
        textContent: '@Sheldon056',
        parentElement: null
    };
    const scope = {
        dataset: {},
        innerText: [
            'Duet | AI ↗',
            '@Sheldon056',
            '复制Prompt',
            '提示词',
            'Create a premium modern tech product promotional social media poster for [BRAND NAME].'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'a[href]') return [authorLink];
            if (String(selector).includes('span')) return [authorLink, handleNode];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    assert.equal(collector._private.getAuthorHandle(scope, ''), '@Sheldon056');
    assert.equal(collector._private.getAuthorName(scope, '@Sheldon056'), 'Duet | AI');
});

test('Meigen browser collector can build X original status url from author handle and detail id', () => {
    const scope = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/2074697587756806354',
        querySelectorAll() {
            return [];
        },
        getAttribute() {
            return '';
        }
    };

    assert.equal(
        collector._private.getOriginalStatusId(scope, '', {
            expectedDetailUrl: 'https://www.meigen.ai/prompt/2074697587756806354'
        }),
        '2074697587756806354'
    );
    assert.equal(
        collector._private.buildOriginalWorkUrlFromHandleAndStatusId('@Sheldon056', '2074697587756806354'),
        'https://x.com/Sheldon056/status/2074697587756806354'
    );
});

test('Meigen browser collector derives detail and source urls from tweet image paths', () => {
    const imageUrl = 'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2008777683455656087/0.jpg';
    assert.equal(collector._private.getStatusIdFromImageUrl(imageUrl), '2008777683455656087');
    assert.equal(
        collector._private.buildMeigenDetailUrlFromStatusId('2008777683455656087', 'https://www.meigen.ai/'),
        'https://www.meigen.ai/prompt/2008777683455656087'
    );

    const image = {
        currentSrc: imageUrl,
        src: imageUrl,
        width: 1024,
        height: 1024,
        naturalWidth: 1024,
        naturalHeight: 1024,
        className: '',
        id: '',
        parentElement: null,
        getAttribute(name) {
            if (name === 'src') return imageUrl;
            if (name === 'width') return '1024';
            if (name === 'height') return '1024';
            return '';
        },
        getBoundingClientRect() {
            return { width: 1024, height: 1024, top: 20, left: 20 };
        },
        closest() {
            return null;
        }
    };
    const card = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/',
        innerText: 'Harboriis\n@harboriis\n收藏 203',
        textContent: '',
        className: 'prompt-card',
        parentElement: null,
        matches(selector) {
            return String(selector).includes('[class*="card" i]');
        },
        querySelectorAll(selector) {
            if (selector === 'img, source' || selector === 'img') return [image];
            if (selector === 'a[href]') return [];
            return [];
        },
        querySelector() {
            return null;
        },
        getBoundingClientRect() {
            return { width: 320, height: 420, top: 20, left: 20 };
        }
    };
    image.parentElement = card;
    const root = {
        baseURI: 'https://www.meigen.ai/',
        querySelectorAll(selector) {
            if (selector === 'img') return [image];
            return [];
        }
    };

    const items = collector.collectMeigenGalleryItems(root, { baseUrl: 'https://www.meigen.ai/' });

    assert.equal(items.length, 1);
    assert.equal(items[0].source_page_url, 'https://www.meigen.ai/prompt/2008777683455656087');
    assert.equal(items[0].original_work_url, 'https://x.com/harboriis/status/2008777683455656087');
});

test('Meigen browser collector expands tweet image sequence to expected carousel count', () => {
    const firstImage = 'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2074663255927316488/0.jpg';
    assert.deepEqual(
        collector._private.expandTweetImageSequence([firstImage], 4),
        [
            firstImage,
            'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2074663255927316488/1.jpg',
            'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2074663255927316488/2.jpg',
            'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2074663255927316488/3.jpg'
        ]
    );

    function createImage(src) {
        return {
            currentSrc: src,
            src,
            width: 1024,
            height: 1024,
            naturalWidth: 1024,
            naturalHeight: 1024,
            className: '',
            id: '',
            parentElement: null,
            getAttribute(name) {
                return name === 'src' ? src : '';
            },
            getBoundingClientRect() {
                return { width: 1024, height: 1024, top: 20, left: 20 };
            },
            closest() {
                return null;
            }
        };
    }
    const image = createImage(firstImage);
    const countNode = {
        innerText: '1 / 4',
        textContent: '1 / 4',
        getAttribute() {
            return '';
        },
        getBoundingClientRect() {
            return { width: 40, height: 20, top: 10, left: 10 };
        }
    };
    const detail = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/2074663255927316488',
        innerText: [
            '1 / 4',
            'CyberTotal',
            '@CyberTotal2026',
            '复制Prompt',
            '提示词',
            '主題： 朝光の白 主体： 木枠の大きなガラス戸の前で、庭から差し込む朝日を受けながら外を眺める成人女性の後ろ姿。'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'img' || selector === 'img, source') return [image];
            if (selector === '*') return [countNode];
            if (selector === 'a[href]') return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    const items = collector.collectMeigenGalleryItems(detail, {
        baseUrl: 'https://www.meigen.ai/prompt/2074663255927316488',
        expectedDetailUrl: 'https://www.meigen.ai/prompt/2074663255927316488',
        detailOnly: true
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].expected_image_count, 4);
    assert.equal(items[0].image_sources.length, 4);
    assert.equal(items[0].image_sources[3].url, 'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2074663255927316488/3.jpg');
});

test('Meigen browser collector expands encoded tweet image sequence to expected count', () => {
    const encodedFirst = 'https://www.meigen.ai/_next/image?url=https%3A%2F%2Fimages.meigen.ai%2Fcdn-cgi%2Fimage%2Fformat%3Dauto%2Cquality%3D85%2Cwidth%3D640%2Cfit%3Dscale-down%2Ftweets%2F2074697587756806354%2F0.jpg&w=640&q=75';
    const encodedThird = 'https://www.meigen.ai/_next/image?url=https%3A%2F%2Fimages.meigen.ai%2Fcdn-cgi%2Fimage%2Fformat%3Dauto%2Cquality%3D85%2Cwidth%3D640%2Cfit%3Dscale-down%2Ftweets%2F2074697587756806354%2F2.jpg&w=640&q=75';
    const expanded = collector._private.expandTweetImageSequence([encodedFirst, encodedThird], 4);

    assert.equal(expanded.length, 4);
    assert.match(expanded[0], /2074697587756806354%2F0\.jpg|2074697587756806354\/0\.jpg/);
    assert.equal(expanded[1], 'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2074697587756806354/1.jpg');
    assert.match(expanded[2], /2074697587756806354%2F2\.jpg|2074697587756806354\/2\.jpg/);
    assert.equal(expanded[3], 'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2074697587756806354/3.jpg');
});

test('Meigen browser collector does not expand tweet image sequence from prompt text fractions', () => {
    const imageUrl = 'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2032256273782358153/0.jpg';
    const image = {
        currentSrc: imageUrl,
        src: imageUrl,
        width: 1024,
        height: 1024,
        naturalWidth: 1024,
        naturalHeight: 1024,
        className: '',
        id: '',
        parentElement: null,
        getAttribute(name) {
            return name === 'src' ? imageUrl : '';
        },
        getBoundingClientRect() {
            return { width: 1024, height: 1024, top: 20, left: 20 };
        },
        closest() {
            return null;
        }
    };
    const detail = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/2032256273782358153',
        innerText: [
            'simeon-sanai',
            '@Naiknelofar788',
            '复制Prompt',
            '提示词',
            'Create one single-image poster. Keep section marker 1 / 3 inside the prompt text, but it is not a carousel count.'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'img' || selector === 'img, source') return [image];
            if (selector === '*') return [];
            if (selector === 'a[href]') return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    const items = collector.collectMeigenGalleryItems(detail, {
        baseUrl: 'https://www.meigen.ai/prompt/2032256273782358153',
        expectedDetailUrl: 'https://www.meigen.ai/prompt/2032256273782358153',
        detailOnly: true
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].image_sources.length, 1);
});

test('Meigen browser collector treats detail pages without a top-left carousel count as one image', () => {
    const statusId = '2051006164377460820';
    const firstImage = `https://images.meigen.ai/tweets/${statusId}/0.jpg`;
    const scriptNode = {
        textContent: JSON.stringify({
            props: {
                pageProps: {
                    prompt: {
                        id: statusId,
                        detailUrl: `https://www.meigen.ai/prompt/${statusId}`,
                        sourceUrl: `https://x.com/Ciri_ai/status/${statusId}`,
                        promptText: 'Low-angle aesthetic portrait of a subject standing under a bright blue sky filled with soft fluffy clouds.',
                        author: { name: 'Ciri', handle: '@Ciri_ai' },
                        images: [
                            firstImage,
                            `https://images.meigen.ai/tweets/${statusId}/1.jpg`,
                            `https://images.meigen.ai/tweets/${statusId}/2.jpg`,
                            `https://images.meigen.ai/tweets/${statusId}/3.jpg`
                        ]
                    }
                }
            }
        })
    };
    const image = {
        currentSrc: firstImage,
        src: firstImage,
        width: 1024,
        height: 1024,
        naturalWidth: 1024,
        naturalHeight: 1024,
        className: '',
        id: '',
        parentElement: null,
        getAttribute(name) {
            return name === 'src' ? firstImage : '';
        },
        getBoundingClientRect() {
            return { width: 1024, height: 1024, top: 20, left: 20 };
        },
        closest() {
            return null;
        }
    };
    const detail = {
        dataset: {},
        baseURI: `https://www.meigen.ai/prompt/${statusId}`,
        innerText: [
            'Ciri',
            '@Ciri_ai',
            '复制Prompt',
            '提示词',
            'Low-angle aesthetic portrait of a subject standing under a bright blue sky filled with soft fluffy clouds.'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (String(selector).includes('script')) return [scriptNode];
            if (selector === 'img' || selector === 'img, source') return [image];
            if (selector === '*') return [];
            if (selector === 'a[href]') return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    const items = collector.collectMeigenGalleryItems(detail, {
        baseUrl: `https://www.meigen.ai/prompt/${statusId}`,
        expectedDetailUrl: `https://www.meigen.ai/prompt/${statusId}`,
        detailOnly: true
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].expected_image_count, 1);
    assert.equal(items[0].detail_expected_count_authoritative, true);
    assert.deepEqual(items[0].image_sources, [{ url: firstImage }]);
});

test('Meigen browser collector ignores structured related images without trusted carousel count', () => {
    const imageUrl = 'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2008777683455656087/0.jpg';
    const scriptNode = {
        textContent: JSON.stringify({
            props: {
                pageProps: {
                    prompt: {
                        id: '2008777683455656087',
                        prompt: 'A stylish young man sitting confidently on raw concrete steps inside a dense urban housing complex during golden hour.',
                        images: [
                            imageUrl,
                            'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2008777683455656087/1.jpg',
                            'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2008777683455656087/2.jpg',
                            'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2008777683455656087/3.jpg'
                        ],
                        author: { name: 'Harboriis', handle: '@harboriis' }
                    }
                }
            }
        })
    };
    const image = {
        currentSrc: imageUrl,
        src: imageUrl,
        width: 1024,
        height: 1024,
        naturalWidth: 1024,
        naturalHeight: 1024,
        className: '',
        id: '',
        parentElement: null,
        getAttribute(name) {
            return name === 'src' ? imageUrl : '';
        },
        getBoundingClientRect() {
            return { width: 1024, height: 1024, top: 20, left: 20 };
        },
        closest() {
            return null;
        }
    };
    const detail = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/2008777683455656087',
        innerText: [
            'Harboriis',
            '@harboriis',
            '复制Prompt',
            '提示词',
            'A stylish young man sitting confidently on raw concrete steps inside a dense urban housing complex during golden hour.'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (String(selector).includes('script')) return [scriptNode];
            if (selector === 'img' || selector === 'img, source') return [image];
            if (selector === '*') return [];
            if (selector === 'a[href]') return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    const items = collector.collectMeigenGalleryItems(detail, {
        baseUrl: 'https://www.meigen.ai/prompt/2008777683455656087',
        expectedDetailUrl: 'https://www.meigen.ai/prompt/2008777683455656087',
        detailOnly: true
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].expected_image_count, 1);
    assert.equal(items[0].detail_image_count_authoritative, true);
    assert.equal(items[0].image_sources.length, 1);
});

test('Meigen browser collector disables global structured cache when detail opts out', () => {
    const previousEntries = global.__FatherKeyMeigenStructuredEntries;
    const imageUrl = 'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2032256273782358153/0.jpg';
    global.__FatherKeyMeigenStructuredEntries = [{
        kind: 'fetch',
        data: {
            prompt: {
                id: '2032256273782358153',
                prompt: 'Create an exaggerated stylized 3D caricature character portrait.',
                images: [
                    imageUrl,
                    'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2032256273782358153/1.jpg',
                    'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2032256273782358153/2.jpg',
                    'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2032256273782358153/3.jpg'
                ],
                author: { name: 'simeon-sanai', handle: '@Naiknelofar788' }
            }
        }
    }];

    try {
        const image = {
            currentSrc: imageUrl,
            src: imageUrl,
            width: 1024,
            height: 1024,
            naturalWidth: 1024,
            naturalHeight: 1024,
            className: '',
            id: '',
            parentElement: null,
            getAttribute(name) {
                return name === 'src' ? imageUrl : '';
            },
            getBoundingClientRect() {
                return { width: 1024, height: 1024, top: 20, left: 20 };
            },
            closest() {
                return null;
            }
        };
        const detail = {
            dataset: {},
            baseURI: 'https://www.meigen.ai/prompt/2032256273782358153',
            innerText: [
                'simeon-sanai',
                '@Naiknelofar788',
                '复制Prompt',
                '提示词',
                'Create an exaggerated stylized 3D caricature character portrait.'
            ].join('\n'),
            textContent: '',
            querySelectorAll(selector) {
                if (selector === 'img' || selector === 'img, source') return [image];
                if (selector === '*') return [];
                if (selector === 'a[href]') return [];
                return [];
            },
            querySelector() {
                return null;
            }
        };

        const items = collector.collectMeigenGalleryItems(detail, {
            baseUrl: 'https://www.meigen.ai/prompt/2032256273782358153',
            expectedDetailUrl: 'https://www.meigen.ai/prompt/2032256273782358153',
            detailOnly: true,
            structuredEntries: []
        });

        assert.equal(items.length, 1);
        assert.equal(items[0].expected_image_count, 1);
        assert.equal(items[0].image_sources.length, 1);
    } finally {
        if (previousEntries === undefined) {
            delete global.__FatherKeyMeigenStructuredEntries;
        } else {
            global.__FatherKeyMeigenStructuredEntries = previousEntries;
        }
    }
});

test('Meigen browser collector does not mark incomplete carousel images authoritative', () => {
    const imageUrl = 'https://cdn.example.com/non-sequence-main.jpg';
    const image = {
        currentSrc: imageUrl,
        src: imageUrl,
        width: 1024,
        height: 1024,
        naturalWidth: 1024,
        naturalHeight: 1024,
        className: '',
        id: '',
        parentElement: null,
        getAttribute(name) {
            return name === 'src' ? imageUrl : '';
        },
        getBoundingClientRect() {
            return { width: 1024, height: 1024, top: 20, left: 20 };
        },
        closest() {
            return null;
        }
    };
    const countNode = {
        innerText: '1 / 4',
        textContent: '1 / 4',
        parentElement: null,
        getAttribute() {
            return '';
        }
    };
    const detail = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/2027911721860616479',
        innerText: [
            '1 / 4',
            'Taaruk',
            '@Taaruk_',
            '复制Prompt',
            '提示词',
            'Ultra-realistic premium product advertisement of a cappuccino coffee bottle.'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'img' || selector === 'img, source') return [image];
            if (selector === '*') return [countNode];
            if (selector === 'a[href]') return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };
    countNode.parentElement = detail;

    const items = collector.collectMeigenGalleryItems(detail, {
        baseUrl: 'https://www.meigen.ai/prompt/2027911721860616479',
        expectedDetailUrl: 'https://www.meigen.ai/prompt/2027911721860616479',
        detailOnly: true,
        structuredEntries: []
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].expected_image_count, 4);
    assert.equal(items[0].image_sources.length, 1);
    assert.equal(items[0].detail_image_count_authoritative, false);
});

test('Meigen browser collector trusts top-left carousel count over structured image list', () => {
    const imageUrl = 'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2025163854469341484/0.jpg';
    const scriptNode = {
        textContent: JSON.stringify({
            props: {
                pageProps: {
                    prompt: {
                        id: '2025163854469341484',
                        prompt: 'Hands holding a shampoo bottle with lather.',
                        images: [
                            imageUrl,
                            'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2025163854469341484/1.jpg',
                            'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2025163854469341484/2.jpg',
                            'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2025163854469341484/3.jpg'
                        ],
                        author: { name: 'Maercih', handle: '@Maercihh' }
                    }
                }
            }
        })
    };
    const countNode = {
        innerText: '1 / 2',
        textContent: '1 / 2',
        parentElement: null,
        getAttribute() {
            return '';
        }
    };
    const image = {
        currentSrc: imageUrl,
        src: imageUrl,
        width: 1024,
        height: 1024,
        naturalWidth: 1024,
        naturalHeight: 1024,
        className: '',
        id: '',
        parentElement: null,
        getAttribute(name) {
            return name === 'src' ? imageUrl : '';
        },
        getBoundingClientRect() {
            return { width: 1024, height: 1024, top: 20, left: 20 };
        },
        closest() {
            return null;
        }
    };
    const detail = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/2025163854469341484',
        innerText: [
            '1 / 2',
            'Maercih',
            '@Maercihh',
            '复制Prompt',
            '提示词',
            'Hands holding a shampoo bottle with lather.'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (String(selector).includes('script')) return [scriptNode];
            if (selector === 'img' || selector === 'img, source') return [image];
            if (selector === '*') return [countNode];
            if (selector === 'a[href]') return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };
    countNode.parentElement = detail;

    const items = collector.collectMeigenGalleryItems(detail, {
        baseUrl: 'https://www.meigen.ai/prompt/2025163854469341484',
        expectedDetailUrl: 'https://www.meigen.ai/prompt/2025163854469341484',
        detailOnly: true
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].expected_image_count, 2);
    assert.deepEqual(items[0].image_sources.map((entry) => entry.url), [
        'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2025163854469341484/0.jpg',
        'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2025163854469341484/1.jpg'
    ]);
});

test('Meigen browser collector fills source url and author name from detail-only page', () => {
    const statusUrl = 'https://x.com/itsjessiababy/status/2074697587756806354';
    const link = {
        href: `https://x.com/share?url=${encodeURIComponent(statusUrl)}`,
        textContent: '在 X 上查看',
        outerHTML: `<a href="https://x.com/share?url=${encodeURIComponent(statusUrl)}">在 X 上查看</a>`,
        getAttribute(name) {
            if (name === 'href') return this.href;
            if (name === 'aria-label') return '在 X 上查看';
            return '';
        }
    };
    const scope = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/2074697587756806354',
        innerText: [
            '1 / 1',
            'Avelyrah',
            '@itsjessiababy',
            '205',
            '复制Prompt',
            '提示词',
            'Ultra realistic professional business portrait based on the attached image. Keep facial structure accurate.'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'a[href]' || String(selector).includes('[href]')) return [link];
            if (selector === 'img' || selector === 'img, source') return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    const items = collector.collectMeigenGalleryItems(scope, {
        baseUrl: 'https://www.meigen.ai/prompt/2074697587756806354',
        detailOnly: true
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].original_work_url, statusUrl);
    assert.equal(items[0].author_name, 'Avelyrah');
    assert.equal(items[0].author_handle, '@itsjessiababy');
});

test('Meigen browser collector rejects engagement text as author nickname', () => {
    assert.equal(collector._private.normalizeAuthorName('81 likes · 4.9K views'), '');
    assert.equal(collector._private.normalizeAuthorName('2.1K views'), '');
    assert.equal(collector._private.normalizeAuthorName('{'), '');
    assert.equal(collector._private.normalizeAuthorName('2026-02-06T03:44:06+00:00'), '');
    assert.equal(collector._private.normalizeAuthorName('Design an extraordinary detailed masterpiece vertical social media advertisement'), '');
    assert.equal(collector._private.normalizeAuthorName('鱼眼广角深夜街头海报，16:9 横版——采用极限运动摄影机级别的鱼眼广角镜头，贴地仰拍构图，画面带明显桶形畸变'), '');
    assert.equal(collector._private.normalizeAuthorName('Nanobanana Pro Prompt by @YaseenK7212 | MeiGen'), '');
    assert.equal(collector._private.normalizeAuthorName('GPT Image Prompt by @you1873118 | MeiGen'), '');
    assert.equal(collector._private.normalizeAuthorName('Related creations'), '');
    assert.equal(collector._private.normalizeAuthorName('Nanobanana'), '');
    assert.equal(collector._private.normalizeAuthorName('GPT Image'), '');
    assert.equal(collector._private.normalizeAuthorName('Model: GPT Image'), '');
    assert.equal(collector._private.normalizeAuthorName('Duet | AI'), 'Duet | AI');
    assert.equal(collector._private.normalizeAuthorName('WebPage'), '');
    assert.equal(collector._private.normalizeAuthorName('Prompt アトリエ｜AI画像プロンプト'), 'Prompt アトリエ｜AI画像プロンプト');
});

test('Meigen browser collector reads nickname above handle and ignores related fallback below', () => {
    const scope = {
        dataset: {},
        innerText: [
            'K ↗',
            '@ChillaiKalan__',
            'Nanobanana',
            '7',
            '复制Prompt',
            '提示词',
            'A professional editorial fashion photograph of a young woman.',
            'Related creations'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (String(selector).includes('span') || String(selector).includes('div')) return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    assert.equal(collector._private.getAuthorHandle(scope, ''), '@ChillaiKalan__');
    assert.equal(collector._private.getAuthorName(scope, '@ChillaiKalan__'), 'K');
});

test('Meigen browser collector reads Vigo detail nickname above handle and rejects prompt fallback', () => {
    const scope = {
        dataset: {},
        innerText: [
            'Vigo Zhao ↗',
            '@VigoCreativeAI',
            'other',
            '5',
            '复制Prompt',
            '提示词',
            '',
            '鱼眼广角深夜街头海报，16:9 横版——采用极限运动摄影机级别的鱼眼广角镜头，贴地仰拍构图，画面带明显桶形畸变，人物微微前倾像要探出画面'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (String(selector).includes('span') || String(selector).includes('div')) return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    assert.equal(collector._private.getAuthorHandle(scope, ''), '@VigoCreativeAI');
    assert.equal(collector._private.getAuthorName(scope, '@VigoCreativeAI'), 'Vigo Zhao');
});

test('Meigen browser collector prefers visible hover nickname and id over structured fallback', () => {
    const statusId = '2013316513701216688';
    const imageUrl = `https://images.meigen.ai/tweets/${statusId}/0.jpg`;
    const originalUrl = `https://x.com/john_my07/status/${statusId}`;
    const detailUrl = `https://www.meigen.ai/prompt/${statusId}`;
    const profileLink = {
        href: 'https://x.com/john_my07',
        innerText: 'Johnn',
        textContent: 'Johnn',
        getAttribute(name) {
            return name === 'href' ? this.href : '';
        }
    };
    const sourceLink = {
        href: originalUrl,
        innerText: '在 X 上查看',
        textContent: '在 X 上查看',
        getAttribute(name) {
            return name === 'href' ? this.href : '';
        }
    };
    const detailLink = {
        href: detailUrl,
        innerText: '',
        textContent: '',
        getAttribute(name) {
            return name === 'href' ? this.href : '';
        }
    };
    const image = {
        currentSrc: imageUrl,
        src: imageUrl,
        width: 900,
        height: 1200,
        naturalWidth: 900,
        naturalHeight: 1200,
        parentElement: null,
        getAttribute(name) {
            return name === 'src' ? imageUrl : '';
        },
        getBoundingClientRect() {
            return { width: 450, height: 600, top: 20, left: 20 };
        },
        closest(selector) {
            return selector === 'a[href]' ? detailLink : null;
        }
    };
    const card = {
        dataset: {
            authorName: 'Johnn',
            authorHandle: '@john_my07',
            authorIdentitySource: 'hover'
        },
        baseURI: 'https://www.meigen.ai/',
        tagName: 'div',
        className: 'prompt-card',
        innerText: [
            'A detailed high-end fashion studio prompt.',
            'Johnn',
            '@john_my07',
            '10'
        ].join('\n'),
        textContent: '',
        parentElement: null,
        getAttribute() {
            return '';
        },
        matches(selector) {
            return String(selector).includes('[class*="card" i]');
        },
        getBoundingClientRect() {
            return { width: 450, height: 720, top: 20, left: 20 };
        },
        querySelectorAll(selector) {
            if (selector === 'img' || selector === 'img, source') return [image];
            if (String(selector).includes('a[href]')) return [detailLink, profileLink, sourceLink];
            return [];
        },
        querySelector() {
            return null;
        }
    };
    image.parentElement = card;

    const items = collector.collectMeigenGalleryItems({
        baseURI: 'https://www.meigen.ai/',
        querySelectorAll(selector) {
            if (selector === 'img') return [image];
            if (selector === '[role="dialog"], main') return [];
            return [];
        }
    }, {
        baseUrl: 'https://www.meigen.ai/',
        structuredEntries: [{
            data: {
                id: statusId,
                detailUrl,
                sourceUrl: originalUrl,
                promptText: 'A detailed high-end fashion studio prompt.',
                author: {
                    displayName: 'Wrong structured author',
                    username: 'john_my07'
                },
                images: [imageUrl]
            }
        }]
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].author_name, 'Johnn');
    assert.equal(items[0].author_handle, '@john_my07');
    assert.equal(items[0].author_identity_source, 'hover');
});

test('Meigen browser collector preserves hover author when detail merge disagrees', () => {
    const statusId = '2013316513701216688';
    const items = collector.mergeCollectedItems([
        {
            source: 'meigen',
            source_item_id: statusId,
            source_page_url: `https://www.meigen.ai/prompt/${statusId}`,
            original_work_url: `https://x.com/john_my07/status/${statusId}`,
            author_name: 'Johnn',
            author_handle: '@john_my07',
            author_identity_source: 'hover',
            prompt_text: '',
            image_sources: [{ url: `https://images.meigen.ai/tweets/${statusId}/0.jpg` }]
        },
        {
            source: 'meigen',
            source_item_id: statusId,
            source_page_url: `https://www.meigen.ai/prompt/${statusId}`,
            original_work_url: '',
            author_name: 'Taaruk',
            author_handle: '@Taaruk_',
            author_identity_source: 'detail',
            prompt_text: 'A complete detailed studio fashion prompt.',
            image_sources: []
        }
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].author_name, 'Johnn');
    assert.equal(items[0].author_handle, '@john_my07');
    assert.equal(items[0].author_identity_source, 'hover');
});

test('Meigen browser collector does not use lines below handle as author nickname', () => {
    const scope = {
        dataset: {},
        innerText: [
            '@Diplomeme',
            'GPT Image',
            '195',
            '复制Prompt',
            '提示词',
            'Ultra-realistic 3D miniature diorama.',
            'Related creations'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (String(selector).includes('span') || String(selector).includes('div')) return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    assert.equal(collector._private.getAuthorName(scope, '@Diplomeme'), '');
});

test('Meigen browser collector detects fixed-length prompt previews without ellipsis', () => {
    assert.equal(collector._private.isCollapsedPromptText('A'.repeat(159)), false);
    assert.equal(collector._private.isCollapsedPromptText('A'.repeat(160)), true);
    assert.equal(collector._private.isCollapsedPromptText('A complete prompt…'), true);
});

test('Meigen browser collector lets copied detail prompt override hard-truncated preview prompt', () => {
    const previewPrompt = 'A'.repeat(160);
    const completePrompt = `${previewPrompt} with complete lighting, composition, wardrobe, camera, and rendering instructions.`;
    const items = collector.mergeCollectedItems([
        {
            source: 'meigen',
            source_item_id: 'preview-hard-cutoff',
            source_page_url: 'https://www.meigen.ai/prompt/2017096425860215040',
            prompt_text: previewPrompt,
            image_sources: [{ url: 'https://images.meigen.ai/tweets/2017096425860215040/0.jpg' }]
        },
        {
            source: 'meigen',
            source_item_id: 'copied-detail',
            source_page_url: 'https://www.meigen.ai/prompt/2017096425860215040',
            prompt_text: completePrompt,
            prompt_complete: true,
            image_sources: [{ url: 'https://images.meigen.ai/tweets/2017096425860215040/1.jpg' }]
        }
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].prompt_text, completePrompt);
    assert.equal(items[0].prompt_complete, true);
});

test('Meigen browser collector lets complete detail prompt override collapsed preview prompt', () => {
    const completePrompt = 'Create a premium modern tech product promotional social media poster for [BRAND NAME]. TOPIC: [PRODUCT NAME] STYLE & ART DIRECTION: Modern futuristic tech advertising design.';
    const items = collector.mergeCollectedItems([
        {
            source: 'meigen',
            source_item_id: 'preview',
            source_page_url: 'https://www.meigen.ai/prompt/2074697587756806354',
            original_work_url: 'https://x.com/Sheldon056/status/2074697587756806354',
            author_name: '81 likes · 4.9K views',
            author_handle: '@Sheldon056',
            favorite_count: 81,
            prompt_text: 'Create a premium modern tech product promotional social m...',
            image_sources: [{ url: 'https://cdn.example.com/one.jpg' }]
        },
        {
            source: 'meigen',
            source_item_id: 'detail',
            source_page_url: 'https://www.meigen.ai/prompt/2074697587756806354',
            original_work_url: '',
            author_name: 'Duet | AI',
            author_handle: '@Sheldon056',
            favorite_count: 0,
            prompt_text: completePrompt,
            image_sources: [{ url: 'https://cdn.example.com/two.jpg' }]
        }
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].prompt_text, completePrompt);
    assert.equal(items[0].author_name, 'Duet | AI');
    assert.deepEqual(items[0].image_sources, [
        { url: 'https://cdn.example.com/one.jpg' },
        { url: 'https://cdn.example.com/two.jpg' }
    ]);
});

test('Meigen browser collector merges prompt-only detail data into existing image item', () => {
    const items = collector.mergeCollectedItems([
        {
            source: 'meigen',
            source_item_id: 'preview',
            source_page_url: 'https://www.meigen.ai/prompt/2074697587756806354',
            original_work_url: '',
            author_name: '',
            author_handle: '',
            favorite_count: 205,
            prompt_text: '',
            image_sources: [
                { url: 'https://cdn.example.com/main.jpg' },
                { url: 'https://cdn.example.com/related-should-drop.jpg' }
            ]
        },
        {
            source: 'meigen',
            source_item_id: 'detail',
            source_page_url: 'https://www.meigen.ai/prompt/2074697587756806354',
            original_work_url: 'https://x.com/ChillaiKalan__/status/2074697587756806354',
            author_name: 'K',
            author_handle: '@ChillaiKalan__',
            favorite_count: 0,
            prompt_text: 'Ultra realistic professional business portrait based on the attached image. Keep the subject facial structure accurate.',
            expected_image_count: 1,
            image_sources: []
        }
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].prompt_text, 'Ultra realistic professional business portrait based on the attached image. Keep the subject facial structure accurate.');
    assert.equal(items[0].author_name, 'K');
    assert.equal(items[0].author_handle, '@ChillaiKalan__');
    assert.equal(items[0].original_work_url, 'https://x.com/ChillaiKalan__/status/2074697587756806354');
    assert.deepEqual(items[0].image_sources, [
        { url: 'https://cdn.example.com/main.jpg' }
    ]);
});

test('Meigen browser collector limits detail artwork images to carousel count and skips related content', () => {
    function createImage({ src, width = 1024, height = 1024, text = '', related = false }) {
        const parent = {
            innerText: related ? '更多相关内容' : text,
            textContent: related ? '更多相关内容' : text,
            className: '',
            parentElement: null,
            getAttribute() {
                return '';
            }
        };
        return {
            currentSrc: src,
            src,
            width,
            height,
            naturalWidth: width,
            naturalHeight: height,
            className: '',
            id: '',
            parentElement: parent,
            getAttribute(name) {
                if (name === 'src') return src;
                return '';
            },
            getBoundingClientRect() {
                return { width, height, left: 20 };
            },
            closest() {
                return null;
            }
        };
    }

    const images = [
        createImage({ src: 'https://cdn.example.com/main-1.jpg' }),
        createImage({ src: 'https://cdn.example.com/main-2.jpg' }),
        createImage({ src: 'https://cdn.example.com/main-3.jpg' }),
        createImage({ src: 'https://cdn.example.com/main-4.jpg' }),
        createImage({ src: 'https://cdn.example.com/related-1.jpg', related: true }),
        createImage({ src: 'https://cdn.example.com/related-2.jpg', related: true })
    ];
    const countNode = {
        innerText: '1 / 4',
        textContent: '1 / 4',
        parentElement: null,
        getAttribute() {
            return '';
        }
    };
    const scope = {
        baseURI: 'https://www.meigen.ai/prompt/2074697587756806354',
        innerText: '1 / 4\nDuet | AI\n@Sheldon056\n提示词\nCreate a premium modern tech product promotional social media poster.',
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'img') return images;
            if (selector === 'img, source') return images;
            if (selector === '*') return [countNode];
            return [];
        }
    };
    countNode.parentElement = scope;

    assert.deepEqual(collector._private.collectDetailArtworkImageUrls(scope), [
        'https://cdn.example.com/main-1.jpg',
        'https://cdn.example.com/main-2.jpg',
        'https://cdn.example.com/main-3.jpg',
        'https://cdn.example.com/main-4.jpg'
    ]);
});

test('Meigen browser collector skips author avatar and images after related heading in detail panel', () => {
    function createImage({ src, width = 1024, height = 1024, parentElement = null, top = 100 }) {
        return {
            currentSrc: src,
            src,
            width,
            height,
            naturalWidth: width,
            naturalHeight: height,
            className: '',
            id: '',
            parentElement,
            getAttribute(name) {
                if (name === 'src') return src;
                return '';
            },
            getBoundingClientRect() {
                return { width, height, top, left: 20 };
            },
            closest() {
                return null;
            }
        };
    }

    const authorPanel = {
        innerText: 'FL⭕RA\n@Flora_Janer8\n复制Prompt\n提示词',
        textContent: 'FL⭕RA\n@Flora_Janer8\n复制Prompt\n提示词',
        className: '',
        parentElement: null,
        getAttribute() {
            return '';
        }
    };
    const relatedHeading = {
        innerText: '更多相关内容',
        textContent: '更多相关内容',
        previousElementSibling: null,
        parentElement: null,
        getAttribute() {
            return '';
        }
    };
    const relatedCard = {
        innerText: 'Related card',
        textContent: 'Related card',
        previousElementSibling: relatedHeading,
        parentElement: null,
        getAttribute() {
            return '';
        }
    };
    const images = [
        createImage({ src: 'https://images.meigen.ai/tweets/2021300975248736723/0.jpg', top: 100 }),
        createImage({ src: 'https://images.meigen.ai/tweets/2021300975248736723/1.jpg', top: 200 }),
        createImage({ src: 'https://images.meigen.ai/tweets/2021300975248736723/2.jpg', top: 300 }),
        createImage({ src: 'https://images.meigen.ai/tweets/2021300975248736723/3.jpg', top: 400 }),
        createImage({ src: 'https://images.meigen.ai/profiles/flora-avatar.jpg', width: 96, height: 96, parentElement: authorPanel, top: 20 }),
        createImage({ src: 'https://images.meigen.ai/tweets/2029999999999999999/0.jpg', parentElement: relatedCard, top: 900 })
    ];
    const countNode = {
        innerText: '1 / 4',
        textContent: '1 / 4',
        parentElement: null,
        getAttribute() {
            return '';
        }
    };
    const scope = {
        baseURI: 'https://www.meigen.ai/prompt/2021300975248736723',
        innerText: '1 / 4\nFL⭕RA\n@Flora_Janer8\n提示词\nA detailed fashion studio photograph.\n更多相关内容',
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'img') return images;
            if (selector === 'img, source') return images;
            if (selector === '*') return [countNode, relatedHeading, relatedCard];
            return [];
        }
    };
    countNode.parentElement = scope;
    authorPanel.parentElement = scope;
    relatedHeading.parentElement = scope;
    relatedCard.parentElement = scope;

    assert.deepEqual(collector._private.collectDetailArtworkImageUrls(scope), [
        'https://images.meigen.ai/tweets/2021300975248736723/0.jpg',
        'https://images.meigen.ai/tweets/2021300975248736723/1.jpg',
        'https://images.meigen.ai/tweets/2021300975248736723/2.jpg',
        'https://images.meigen.ai/tweets/2021300975248736723/3.jpg'
    ]);
});

test('Meigen browser collector limits detail images by carousel count even when more page images exist', () => {
    function createImage({ src, width = 1024, height = 1024, top = 100 }) {
        return {
            currentSrc: src,
            src,
            width,
            height,
            naturalWidth: width,
            naturalHeight: height,
            className: '',
            id: '',
            parentElement: null,
            getAttribute(name) {
                return name === 'src' ? src : '';
            },
            getBoundingClientRect() {
                return { width, height, top, left: 20 };
            },
            closest() {
                return null;
            }
        };
    }

    const images = Array.from({ length: 12 }, (_, index) => createImage({
        src: `https://cdn.example.com/image-${index + 1}.jpg`,
        top: 100 + index
    }));
    const countNode = {
        innerText: '1 / 2',
        textContent: '1 / 2',
        parentElement: null,
        getAttribute() {
            return '';
        }
    };
    const scope = {
        baseURI: 'https://www.meigen.ai/prompt/2074697587756806354',
        innerText: '1 / 2\n提示词\nUltra realistic professional business portrait based on the attached image.',
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'img') return images;
            if (selector === 'img, source') return images;
            if (selector === '*') return [countNode];
            return [];
        }
    };
    countNode.parentElement = scope;

    const urls = collector._private.collectDetailArtworkImageUrls(scope);
    assert.equal(urls.length, 2);
    assert.deepEqual(urls, [
        'https://cdn.example.com/image-1.jpg',
        'https://cdn.example.com/image-2.jpg'
    ]);
});

test('Meigen browser collector fills carousel image count after duplicate main thumbnail', () => {
    function createImage({ src, top }) {
        return {
            currentSrc: src,
            src,
            width: 1024,
            height: 1024,
            naturalWidth: 1024,
            naturalHeight: 1024,
            className: '',
            id: '',
            parentElement: null,
            getAttribute(name) {
                return name === 'src' ? src : '';
            },
            getBoundingClientRect() {
                return { width: 1024, height: 1024, top, left: 20 };
            },
            closest() {
                return null;
            }
        };
    }

    const images = [
        createImage({ src: 'https://cdn.example.com/art-1.jpg', top: 90 }),
        createImage({ src: 'https://cdn.example.com/art-1.jpg', top: 420 }),
        createImage({ src: 'https://cdn.example.com/art-2.jpg', top: 520 }),
        createImage({ src: 'https://cdn.example.com/art-3.jpg', top: 620 }),
        createImage({ src: 'https://cdn.example.com/related-1.jpg', top: 900 })
    ];
    const countNode = {
        innerText: '1 / 3',
        textContent: '1 / 3',
        parentElement: null,
        getAttribute() {
            return '';
        }
    };
    const scope = {
        baseURI: 'https://www.meigen.ai/prompt/2074697587756806354',
        innerText: '1 / 3\nAI-Shamus\n@im_shahid7\n提示词\nUNIVERSAL FMCG HERO AD PROMPT V2.0 with detailed product photography direction.',
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'img') return images;
            if (selector === 'img, source') return images;
            if (selector === '*') return [countNode];
            return [];
        }
    };
    countNode.parentElement = scope;

    const urls = collector._private.collectDetailArtworkImageUrls(scope);
    assert.deepEqual(urls, [
        'https://cdn.example.com/art-1.jpg',
        'https://cdn.example.com/art-2.jpg',
        'https://cdn.example.com/art-3.jpg'
    ]);
});

test('Meigen browser collector does not use page-wide fallback for detail artwork without carousel count', () => {
    function createImage(src) {
        return {
            currentSrc: src,
            src,
            width: 1024,
            height: 1024,
            naturalWidth: 1024,
            naturalHeight: 1024,
            className: '',
            id: '',
            parentElement: null,
            getAttribute(name) {
                return name === 'src' ? src : '';
            },
            getBoundingClientRect() {
                return { width: 1024, height: 1024, top: 20, left: 20 };
            },
            closest() {
                return null;
            }
        };
    }

    const scope = {
        baseURI: 'https://www.meigen.ai/prompt/2074697587756806354',
        innerText: 'Duet | AI\n@Sheldon056\n更多相关内容',
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'img' || selector === 'img, source') {
                return [
                    createImage('https://cdn.example.com/related-1.jpg'),
                    createImage('https://cdn.example.com/related-2.jpg')
                ];
            }
            return [];
        }
    };

    assert.deepEqual(collector.collectImageUrls(scope, { detailOnly: true }), []);
});

test('Meigen browser collector drops stale tweet images from another detail item', () => {
    const staleImageUrl = 'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2011898760650170378/0.jpg';
    const image = {
        currentSrc: staleImageUrl,
        src: staleImageUrl,
        width: 1024,
        height: 1024,
        naturalWidth: 1024,
        naturalHeight: 1024,
        className: '',
        id: '',
        parentElement: null,
        getAttribute(name) {
            return name === 'src' ? staleImageUrl : '';
        },
        getBoundingClientRect() {
            return { width: 1024, height: 1024, top: 20, left: 20 };
        },
        closest() {
            return null;
        }
    };
    const detail = {
        dataset: {},
        baseURI: 'https://www.meigen.ai/prompt/2074440823308161305',
        innerText: [
            'serein ｜买美股上币安',
            '@you1873118',
            '复制Prompt',
            '提示词',
            '成年亚洲女性剑士，清冷漂亮的五官，长黑发，略带湿发感与凌乱碎发，头发被高速气流吹起。'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'img' || selector === 'img, source') return [image];
            if (selector === '*') return [];
            if (selector === 'a[href]') return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    const items = collector.collectMeigenGalleryItems(detail, {
        baseUrl: 'https://www.meigen.ai/prompt/2074440823308161305',
        expectedDetailUrl: 'https://www.meigen.ai/prompt/2074440823308161305',
        detailOnly: true,
        structuredEntries: []
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].prompt_text.includes('成年亚洲女性剑士'), true);
    assert.deepEqual(items[0].image_sources, []);
    assert.equal(items[0].detail_image_count_authoritative, false);
});

test('Meigen browser collector rejects unbound community generation images for status-bound works', () => {
    const statusId = '2011898760650170378';
    const communityImage = 'https://images.meigen.ai/generations/2026-07/community_d8b94f82-4888-4dfe-8840-79d21ad15b06.png';
    const matchingTweetImage = `https://images.meigen.ai/tweets/${statusId}/0.jpg`;
    const otherTweetImage = 'https://images.meigen.ai/tweets/2074382159834443858/0.jpg';

    assert.equal(collector._private.isLikelyUnboundMeigenCommunityImageUrl(communityImage), true);
    assert.equal(collector._private.isImageUrlTrustedForStatus(communityImage, statusId), false);
    assert.equal(collector._private.isImageUrlTrustedForStatus(communityImage, ''), true);
    assert.equal(collector._private.isImageUrlTrustedForStatus(matchingTweetImage, statusId), true);
    assert.equal(collector._private.isImageUrlTrustedForStatus(otherTweetImage, statusId), false);
    assert.deepEqual(
        collector._private.filterDetailImageUrlsByStatus([communityImage, otherTweetImage, matchingTweetImage], statusId),
        [matchingTweetImage]
    );
});

test('Meigen browser collector rejects structured text masquerading as image URLs', () => {
    const imageUrl = 'https://images.meigen.ai/tweets/2052602437530243303/0.jpg';
    assert.deepEqual(
        collector._private.collectStructuredImageUrls({
            image: 'image',
            model: 'GPT Image',
            imagePrompt: 'High-end fashion editorial photography with cinematic image lighting',
            images: [imageUrl]
        }, 'https://www.meigen.ai/prompt/2052602437530243303'),
        [imageUrl]
    );
});

test('Meigen browser collector rejects impossible tweet carousel counts', () => {
    const countNode = {
        innerText: '1 / 17',
        textContent: '1 / 17',
        parentElement: null,
        getAttribute() {
            return '';
        }
    };
    const scope = {
        baseURI: 'https://www.meigen.ai/prompt/2052602437530243303',
        innerText: '1 / 17',
        textContent: '1 / 17',
        querySelectorAll(selector) {
            return selector === '*' ? [countNode] : [];
        }
    };
    countNode.parentElement = scope;
    assert.equal(collector._private.getTrustedDetailArtworkExpectedCount(scope), 0);
});

test('Meigen browser collector rejects neighboring tweet images for community prompts', () => {
    const communityDetailUrl = 'https://www.meigen.ai/prompt/community_b232f212-3458-435e-bfb5-2cd370cca19a';
    const neighboringTweetImage = 'https://images.meigen.ai/tweets/2017096425860215040/0.jpg';
    const communityImage = 'https://images.meigen.ai/generations/2026-07/community_e81718e1-cea7-4f31-9235-17ce802de5b7.png';

    assert.equal(collector._private.isCommunityDetailUrl(communityDetailUrl), true);
    assert.deepEqual(
        collector._private.filterDetailImageUrlsByIdentity(
            [neighboringTweetImage, communityImage],
            { detailUrl: communityDetailUrl }
        ),
        [communityImage]
    );
});

test('Meigen browser collector does not mark community generation placeholders authoritative for X detail pages', () => {
    const statusId = '2011898760650170378';
    const communityImage = 'https://images.meigen.ai/generations/2026-07/community_d8b94f82-4888-4dfe-8840-79d21ad15b06.png';
    const image = {
        currentSrc: communityImage,
        src: communityImage,
        width: 1024,
        height: 1024,
        naturalWidth: 1024,
        naturalHeight: 1024,
        className: '',
        id: '',
        parentElement: null,
        getAttribute(name) {
            return name === 'src' ? communityImage : '';
        },
        getBoundingClientRect() {
            return { width: 1024, height: 1024, top: 20, left: 20 };
        },
        closest() {
            return null;
        }
    };
    const countNode = {
        innerText: '1 / 1',
        textContent: '1 / 1',
        parentElement: null,
        getAttribute() {
            return '';
        }
    };
    const detail = {
        dataset: {},
        baseURI: `https://www.meigen.ai/prompt/${statusId}`,
        innerText: [
            '1 / 1',
            'TechieSA',
            '@TechieBySA',
            '复制Prompt',
            '提示词',
            'Ultra-realistic full body portrait with clean studio lighting and detailed wardrobe instructions.'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'img' || selector === 'img, source') return [image];
            if (selector === '*') return [countNode];
            if (selector === 'a[href]') return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };
    countNode.parentElement = detail;

    const items = collector.collectMeigenGalleryItems(detail, {
        baseUrl: `https://www.meigen.ai/prompt/${statusId}`,
        expectedDetailUrl: `https://www.meigen.ai/prompt/${statusId}`,
        detailOnly: true,
        structuredEntries: []
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].expected_image_count, 1);
    assert.deepEqual(items[0].image_sources, []);
    assert.equal(items[0].detail_image_count_authoritative, false);
});

test('Meigen browser collector keeps gallery items in visual top-to-bottom order', () => {
    function createScope({ src, top, text }) {
        const scope = {
            dataset: {},
            baseURI: 'https://www.meigen.ai/',
            innerText: text,
            textContent: text,
            className: 'card',
            id: '',
            parentElement: null,
            getAttribute() {
                return '';
            },
            matches(selector) {
                return String(selector).includes('[class*="card" i]');
            },
            getBoundingClientRect() {
                return { width: 260, height: 260, top, left: 20 };
            },
            querySelectorAll(selector) {
                if (selector === 'img, source' || selector === 'img') return [image];
                return [];
            },
            querySelector() {
                return null;
            }
        };
        const image = {
            currentSrc: src,
            src,
            width: 640,
            height: 640,
            naturalWidth: 640,
            naturalHeight: 640,
            className: '',
            id: '',
            parentElement: scope,
            getAttribute(name) {
                return name === 'src' ? src : '';
            },
            matches() {
                return false;
            },
            closest() {
                return null;
            },
            getBoundingClientRect() {
                return { width: 640, height: 640, top, left: 20 };
            }
        };
        return { scope, image };
    }

    const bottom = createScope({
        src: 'https://cdn.example.com/bottom.jpg',
        top: 500,
        text: '收藏 300\nBottom prompt text with enough detail to keep'
    });
    const top = createScope({
        src: 'https://cdn.example.com/top.jpg',
        top: 100,
        text: '收藏 300\nTop prompt text with enough detail to keep'
    });
    const documentRef = {
        baseURI: 'https://www.meigen.ai/',
        querySelectorAll(selector) {
            if (selector === 'img') return [bottom.image, top.image];
            if (selector === '[role="dialog"], main') return [];
            return [];
        }
    };

    const items = collector.collectMeigenGalleryItems(documentRef, { minFavorites: 100 });
    assert.equal(items.length, 2);
    assert.equal(items[0].image_sources[0].url, 'https://cdn.example.com/top.jpg');
    assert.equal(items[1].image_sources[0].url, 'https://cdn.example.com/bottom.jpg');
});

test('Meigen browser collector does not treat gallery list carousel text as a single detail item', () => {
    function createCard({ src, top, text }) {
        const card = {
            dataset: {},
            baseURI: 'https://www.meigen.ai/',
            innerText: text,
            textContent: text,
            className: 'card',
            id: '',
            parentElement: null,
            getAttribute() {
                return '';
            },
            matches(selector) {
                return String(selector).includes('[class*="card" i]');
            },
            getBoundingClientRect() {
                return { width: 260, height: 260, top, left: 20 };
            },
            querySelectorAll(selector) {
                if (selector === 'img, source' || selector === 'img') return [image];
                return [];
            },
            querySelector() {
                return null;
            }
        };
        const image = {
            currentSrc: src,
            src,
            width: 640,
            height: 640,
            naturalWidth: 640,
            naturalHeight: 640,
            className: '',
            id: '',
            parentElement: card,
            getAttribute(name) {
                return name === 'src' ? src : '';
            },
            matches() {
                return false;
            },
            closest() {
                return null;
            },
            getBoundingClientRect() {
                return { width: 640, height: 640, top, left: 20 };
            }
        };
        return { card, image };
    }

    const cards = [
        createCard({ src: 'https://cdn.example.com/one.jpg', top: 100, text: '收藏 300\n1 / 2\nPrompt one with enough detail for import' }),
        createCard({ src: 'https://cdn.example.com/two.jpg', top: 360, text: '收藏 280\nPrompt two with enough detail for import' }),
        createCard({ src: 'https://cdn.example.com/three.jpg', top: 620, text: '收藏 260\nPrompt three with enough detail for import' })
    ];
    const documentRef = {
        baseURI: 'https://www.meigen.ai/',
        querySelectorAll(selector) {
            if (selector === 'img') return cards.map((entry) => entry.image);
            if (selector === '[role="dialog"], main') return [];
            if (String(selector).includes('[role="dialog"]')) return [];
            return [];
        }
    };

    const items = collector.collectMeigenGalleryItems(documentRef, { minFavorites: 1 });
    assert.equal(items.length, 3);
    assert.deepEqual(items.map((item) => item.image_sources[0].url), [
        'https://cdn.example.com/one.jpg',
        'https://cdn.example.com/two.jpg',
        'https://cdn.example.com/three.jpg'
    ]);
});

test('Meigen browser collector keeps repeated-cover cards separate by detail link', () => {
    const previousEntries = global.__FatherKeyMeigenStructuredEntries;
    const coverUrl = 'https://cdn.example.com/shared-look-up-cover.jpg';
    const works = [
        {
            id: '2015236449755676732',
            detailUrl: 'https://www.meigen.ai/prompt/2015236449755676732',
            sourceUrl: 'https://x.com/Goodmanprotocol/status/2015236449755676732',
            promptText: 'Prompt alpha detail text for a Cheetos grid advertisement with product placement.',
            author: { displayName: 'Alpha Creator', username: 'alpha_creator' }
        },
        {
            id: '2045387100842070500',
            detailUrl: 'https://www.meigen.ai/prompt/2045387100842070500',
            sourceUrl: 'https://x.com/flora_ai/status/2045387100842070500',
            promptText: 'Prompt beta detail text for a high-fashion studio photograph with olive styling.',
            author: { displayName: 'FLORA', username: 'flora_ai' }
        },
        {
            id: '2074697587756806354',
            detailUrl: 'https://www.meigen.ai/prompt/2074697587756806354',
            sourceUrl: 'https://x.com/SgtSref/status/2074697587756806354',
            promptText: 'Prompt gamma detail text for a reference-image creative workflow and selected color cards.',
            author: { displayName: 'Sgt Sref', username: 'SgtSref' }
        }
    ];

    global.__FatherKeyMeigenStructuredEntries = [{
        kind: 'cache',
        data: {
            feed: works.map((work) => ({
                ...work,
                images: [coverUrl]
            }))
        }
    }];

    function createCard(work, index) {
        const xLink = {
            tagName: 'a',
            href: work.sourceUrl,
            innerText: '在 X 上查看',
            textContent: '在 X 上查看',
            parentElement: null,
            getAttribute(name) {
                return name === 'href' ? this.href : '';
            },
            querySelectorAll() {
                return [];
            }
        };
        const detailLink = {
            tagName: 'a',
            href: work.detailUrl,
            innerText: '',
            textContent: '',
            parentElement: null,
            getAttribute(name) {
                return name === 'href' ? this.href : '';
            },
            querySelectorAll(selector) {
                if (selector === 'img' || selector === 'img, source') return [image];
                return [];
            },
            querySelector() {
                return image;
            }
        };
        const card = {
            dataset: {},
            tagName: 'div',
            baseURI: 'https://www.meigen.ai/',
            innerText: `1900 收藏\n${work.promptText}\n${work.author.displayName}`,
            textContent: `1900 收藏\n${work.promptText}\n${work.author.displayName}`,
            className: 'prompt-card',
            id: '',
            parentElement: null,
            getAttribute() {
                return '';
            },
            matches(selector) {
                return String(selector).includes('[class*="card" i]');
            },
            getBoundingClientRect() {
                return { width: 500, height: 620, top: 100 + (index * 40), left: 30 + (index * 520) };
            },
            querySelectorAll(selector) {
                if (selector === 'img' || selector === 'img, source') return [image];
                if (selector === 'a[href]' || String(selector).includes('a[href]')) return [detailLink, xLink];
                return [];
            },
            querySelector() {
                return null;
            }
        };
        const image = {
            currentSrc: coverUrl,
            src: coverUrl,
            width: 1024,
            height: 1024,
            naturalWidth: 1024,
            naturalHeight: 1024,
            className: '',
            id: '',
            parentElement: detailLink,
            getAttribute(name) {
                return name === 'src' ? coverUrl : '';
            },
            matches() {
                return false;
            },
            closest(selector) {
                if (selector === 'a[href]') return detailLink;
                return null;
            },
            getBoundingClientRect() {
                return { width: 500, height: 500, top: 100 + (index * 40), left: 30 + (index * 520) };
            }
        };
        detailLink.parentElement = card;
        xLink.parentElement = card;
        return { card, image, detailLink, xLink };
    }

    try {
        const entries = works.map((work, index) => createCard(work, index));
        const listContainer = {
            dataset: {},
            tagName: 'div',
            baseURI: 'https://www.meigen.ai/',
            innerText: entries.map((entry) => entry.card.innerText).join('\n'),
            textContent: entries.map((entry) => entry.card.textContent).join('\n'),
            className: 'feed-item-list',
            parentElement: null,
            getAttribute() {
                return '';
            },
            matches(selector) {
                return String(selector).includes('[class*="item" i]');
            },
            getBoundingClientRect() {
                return { width: 1600, height: 720, top: 80, left: 20 };
            },
            querySelectorAll(selector) {
                if (selector === 'img' || selector === 'img, source') return entries.map((entry) => entry.image);
                if (selector === 'a[href]' || String(selector).includes('a[href]')) {
                    return entries.flatMap((entry) => [entry.detailLink, entry.xLink]);
                }
                return [];
            },
            querySelector() {
                return null;
            }
        };
        entries.forEach((entry) => {
            entry.card.parentElement = listContainer;
        });
        const documentRef = {
            baseURI: 'https://www.meigen.ai/',
            querySelectorAll(selector) {
                if (selector === 'img') return entries.map((entry) => entry.image);
                if (selector === '[role="dialog"], main') return [];
                return [];
            }
        };

        assert.equal(collector._private.isLikelyListContainerScope(listContainer, { baseUrl: 'https://www.meigen.ai/' }), true);

        const items = collector.collectMeigenGalleryItems(documentRef, { baseUrl: 'https://www.meigen.ai/', minFavorites: 1 });
        assert.equal(items.length, 3);
        assert.deepEqual(items.map((item) => item.source_page_url), works.map((work) => work.detailUrl));
        assert.deepEqual(items.map((item) => item.prompt_text), works.map((work) => work.promptText));
        assert.deepEqual(items.map((item) => item.author_name), works.map((work) => work.author.displayName));
        assert.deepEqual(items.map((item) => item.image_sources.length), [1, 1, 1]);
    } finally {
        if (previousEntries === undefined) {
            delete global.__FatherKeyMeigenStructuredEntries;
        } else {
            global.__FatherKeyMeigenStructuredEntries = previousEntries;
        }
    }
});

test('Meigen browser collector filters list structured images to each item status id', () => {
    const previousEntries = global.__FatherKeyMeigenStructuredEntries;
    const works = [
        {
            id: '2015236449755676732',
            detailUrl: 'https://www.meigen.ai/prompt/2015236449755676732',
            sourceUrl: 'https://x.com/MissCat_AI/status/2015236449755676732',
            images: [
                'https://images.meigen.ai/tweets/2015236449755676732/0.jpg',
                'https://www.meigen.ai/image',
                'https://images.meigen.ai/tweets/2021118417227657409/0.jpg',
                'https://images.meigen.ai/tweets/2021118417227657409/1.jpg'
            ],
            promptText: 'Prompt for perfume product image with black bottle and grid composition.'
        },
        {
            id: '2021118417227657409',
            detailUrl: 'https://www.meigen.ai/prompt/2021118417227657409',
            sourceUrl: 'https://x.com/Strength04_X/status/2021118417227657409',
            images: [
                'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2021118417227657409/0.jpg',
                'https://images.meigen.ai/tweets/2021118417227657409/0.jpg',
                'https://images.meigen.ai/tweets/2021118417227657409/1.jpg'
            ],
            promptText: 'Prompt for ultra-realistic cinematic fashion photography with female model.'
        },
        {
            id: '2016154222765527482',
            detailUrl: 'https://www.meigen.ai/prompt/2016154222765527482',
            sourceUrl: 'https://x.com/2abhisheknaks/status/2016154222765527482',
            images: [
                'https://images.meigen.ai/cdn-cgi/image/format=auto,quality=85,width=640,fit=scale-down/tweets/2016154222765527482/0.jpg',
                'https://images.meigen.ai/tweets/2016154222765527482/0.jpg',
                'https://images.meigen.ai/tweets/2016154222765527482/1.jpg'
            ],
            promptText: 'Prompt for photorealistic young woman sitting on a stool in sportswear.'
        }
    ];

    global.__FatherKeyMeigenStructuredEntries = [{
        kind: 'cache',
        data: {
            feed: works
        }
    }];

    function createCard(work, index) {
        const detailLink = {
            href: work.detailUrl,
            parentElement: null,
            getAttribute(name) {
                return name === 'href' ? this.href : '';
            },
            querySelectorAll(selector) {
                if (selector === 'img' || selector === 'img, source') return [image];
                return [];
            },
            querySelector() {
                return image;
            }
        };
        const xLink = {
            href: work.sourceUrl,
            parentElement: null,
            getAttribute(name) {
                return name === 'href' ? this.href : '';
            },
            querySelectorAll() {
                return [];
            }
        };
        const card = {
            dataset: {},
            tagName: 'div',
            baseURI: 'https://www.meigen.ai/',
            innerText: `0 收藏\n${work.promptText}`,
            textContent: `0 收藏\n${work.promptText}`,
            className: 'prompt-card',
            id: '',
            parentElement: null,
            getAttribute() {
                return '';
            },
            matches(selector) {
                return String(selector).includes('[class*="card" i]');
            },
            getBoundingClientRect() {
                return { width: 500, height: 620, top: 100, left: 30 + (index * 520) };
            },
            querySelectorAll(selector) {
                if (selector === 'img' || selector === 'img, source') return [image];
                if (selector === 'a[href]' || String(selector).includes('a[href]')) return [detailLink, xLink];
                return [];
            },
            querySelector() {
                return null;
            }
        };
        const image = {
            currentSrc: work.images[0],
            src: work.images[0],
            width: 1024,
            height: 1024,
            naturalWidth: 1024,
            naturalHeight: 1024,
            className: '',
            id: '',
            parentElement: detailLink,
            getAttribute(name) {
                return name === 'src' ? work.images[0] : '';
            },
            matches() {
                return false;
            },
            closest(selector) {
                if (selector === 'a[href]') return detailLink;
                return null;
            },
            getBoundingClientRect() {
                return { width: 500, height: 500, top: 100, left: 30 + (index * 520) };
            }
        };
        detailLink.parentElement = card;
        xLink.parentElement = card;
        return { card, image, detailLink, xLink };
    }

    try {
        const entries = works.map((work, index) => createCard(work, index));
        const documentRef = {
            baseURI: 'https://www.meigen.ai/',
            querySelectorAll(selector) {
                if (selector === 'img') return entries.map((entry) => entry.image);
                if (selector === '[role="dialog"], main') return [];
                return [];
            }
        };

        const items = collector.collectMeigenGalleryItems(documentRef, { baseUrl: 'https://www.meigen.ai/' });
        assert.equal(items.length, 3);
        assert.deepEqual(items.map((item) => item.image_sources.map((entry) => entry.url)), [
            ['https://images.meigen.ai/tweets/2015236449755676732/0.jpg'],
            [
                'https://images.meigen.ai/tweets/2021118417227657409/0.jpg',
                'https://images.meigen.ai/tweets/2021118417227657409/1.jpg'
            ],
            [
                'https://images.meigen.ai/tweets/2016154222765527482/0.jpg',
                'https://images.meigen.ai/tweets/2016154222765527482/1.jpg'
            ]
        ]);
        assert.deepEqual(items.map((item) => item.expected_image_count), [1, 2, 2]);
    } finally {
        if (previousEntries === undefined) {
            delete global.__FatherKeyMeigenStructuredEntries;
        } else {
            global.__FatherKeyMeigenStructuredEntries = previousEntries;
        }
    }
});

test('Meigen browser collector ignores UI placeholder images from structured detail data', () => {
    const previousEntries = global.__FatherKeyMeigenStructuredEntries;
    const statusId = '2021300975248736723';
    global.__FatherKeyMeigenStructuredEntries = [{
        kind: 'cache',
        data: {
            prompt: {
                id: statusId,
                detailUrl: `https://www.meigen.ai/prompt/${statusId}`,
                sourceUrl: `https://x.com/Flora_Janer8/status/${statusId}`,
                promptText: 'A complete fashion studio photograph prompt with velvet saree, cinematic lighting, detailed texture, and production-ready camera direction.',
                images: [
                    'https://www.meigen.ai/images/gallery-card-back.jpg',
                    'https://www.meigen.ai/images/gallery-card-front.jpg',
                    `https://images.meigen.ai/tweets/${statusId}/0.jpg`,
                    `https://www.meigen.ai/prompt/${statusId}#image`
                ]
            }
        }
    }];

    const card = {
        dataset: {},
        tagName: 'div',
        baseURI: 'https://www.meigen.ai/',
        innerText: '0 收藏\nA complete fashion studio photograph prompt with velvet saree',
        textContent: '0 收藏\nA complete fashion studio photograph prompt with velvet saree',
        className: 'prompt-card',
        id: '',
        parentElement: null,
        getAttribute() {
            return '';
        },
        matches(selector) {
            return String(selector).includes('[class*="card" i]');
        },
        getBoundingClientRect() {
            return { width: 500, height: 620, top: 100, left: 30 };
        },
        querySelectorAll(selector) {
            if (selector === 'img' || selector === 'img, source') return [image];
            if (selector === 'a[href]' || String(selector).includes('a[href]')) return [detailLink, xLink];
            return [];
        },
        querySelector() {
            return null;
        }
    };
    const detailLink = {
        href: `https://www.meigen.ai/prompt/${statusId}`,
        parentElement: card,
        getAttribute(name) {
            return name === 'href' ? this.href : '';
        },
        querySelectorAll(selector) {
            if (selector === 'img' || selector === 'img, source') return [image];
            return [];
        },
        querySelector() {
            return image;
        }
    };
    const xLink = {
        href: `https://x.com/Flora_Janer8/status/${statusId}`,
        parentElement: card,
        getAttribute(name) {
            return name === 'href' ? this.href : '';
        },
        querySelectorAll() {
            return [];
        }
    };
    const image = {
        currentSrc: `https://images.meigen.ai/tweets/${statusId}/0.jpg`,
        src: `https://images.meigen.ai/tweets/${statusId}/0.jpg`,
        width: 1024,
        height: 1024,
        naturalWidth: 1024,
        naturalHeight: 1024,
        className: '',
        id: '',
        parentElement: detailLink,
        getAttribute(name) {
            return name === 'src' ? this.src : '';
        },
        matches() {
            return false;
        },
        closest(selector) {
            if (selector === 'a[href]') return detailLink;
            return null;
        },
        getBoundingClientRect() {
            return { width: 500, height: 500, top: 100, left: 30 };
        }
    };
    const documentRef = {
        baseURI: 'https://www.meigen.ai/',
        querySelectorAll(selector) {
            if (selector === 'img') return [image];
            if (selector === '[role="dialog"], main') return [];
            return [];
        }
    };

    try {
        const items = collector.collectMeigenGalleryItems(documentRef, { baseUrl: 'https://www.meigen.ai/' });
        assert.equal(items.length, 1);
        assert.deepEqual(items[0].image_sources.map((entry) => entry.url), [
            `https://images.meigen.ai/tweets/${statusId}/0.jpg`
        ]);
        assert.equal(items[0].expected_image_count, 1);
    } finally {
        if (previousEntries === undefined) {
            delete global.__FatherKeyMeigenStructuredEntries;
        } else {
            global.__FatherKeyMeigenStructuredEntries = previousEntries;
        }
    }
});


test('Meigen browser collector accepts externally detected detail carousel count', () => {
    const statusId = '2021300975248736723';
    const imageUrl = `https://images.meigen.ai/tweets/${statusId}/0.jpg`;
    const image = {
        currentSrc: imageUrl,
        src: imageUrl,
        width: 1024,
        height: 1024,
        naturalWidth: 1024,
        naturalHeight: 1024,
        className: '',
        id: '',
        parentElement: null,
        getAttribute(name) {
            return name === 'src' ? imageUrl : '';
        },
        getBoundingClientRect() {
            return { width: 1024, height: 1024, top: 40, left: 20 };
        },
        closest() {
            return null;
        }
    };
    const detail = {
        dataset: {},
        baseURI: `https://www.meigen.ai/prompt/${statusId}`,
        innerText: [
            'FLORA',
            '@Flora_Janer8',
            'Nanobanana',
            '217',
            '复制Prompt',
            '提示词',
            'A detailed high-fashion studio photograph of a woman in a luxurious olive green velvet saree.'
        ].join('\n'),
        textContent: '',
        querySelectorAll(selector) {
            if (selector === 'img' || selector === 'img, source') return [image];
            if (selector === '*') return [];
            if (selector === 'a[href]') return [];
            return [];
        },
        querySelector() {
            return null;
        }
    };

    const items = collector.collectMeigenGalleryItems(detail, {
        baseUrl: `https://www.meigen.ai/prompt/${statusId}`,
        expectedDetailUrl: `https://www.meigen.ai/prompt/${statusId}`,
        expectedDetailImageCount: 4,
        detailFavoriteCount: 217,
        detailOnly: true
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].expected_image_count, 4);
    assert.equal(items[0].favorite_count, 217);
    assert.equal(items[0].detail_expected_count_authoritative, true);
    assert.deepEqual(items[0].image_sources.map((entry) => entry.url), [
        `https://images.meigen.ai/tweets/${statusId}/0.jpg`,
        `https://images.meigen.ai/tweets/${statusId}/1.jpg`,
        `https://images.meigen.ai/tweets/${statusId}/2.jpg`,
        `https://images.meigen.ai/tweets/${statusId}/3.jpg`
    ]);
});

test('Meigen browser collector expands detail tweet image sequence from trusted count', () => {
    const statusId = '2016201701254951241';
    const expanded = collector._private.expandTweetImageSequence([
        `https://images.meigen.ai/tweets/${statusId}/0.jpg`
    ], 3);

    assert.deepEqual(expanded, [
        `https://images.meigen.ai/tweets/${statusId}/0.jpg`,
        `https://images.meigen.ai/tweets/${statusId}/1.jpg`,
        `https://images.meigen.ai/tweets/${statusId}/2.jpg`
    ]);
});

test('Meigen browser collector expands merged list image when detail count is authoritative', () => {
    const statusId = '2016201701254951241';
    const items = collector.mergeCollectedItems([
        {
            source: 'meigen',
            source_item_id: `meigen-${statusId}`,
            source_page_url: `https://www.meigen.ai/prompt/${statusId}`,
            original_work_url: `https://x.com/YaseenK7212/status/${statusId}`,
            author_name: 'Nanobanana Pro Prompt by @YaseenK7212 | MeiGen',
            author_handle: '@YaseenK7212',
            favorite_count: 175,
            prompt_text: '',
            image_sources: [{ url: `https://images.meigen.ai/tweets/${statusId}/0.jpg` }]
        },
        {
            source: 'meigen',
            source_item_id: `meigen-${statusId}`,
            source_page_url: `https://www.meigen.ai/prompt/${statusId}`,
            original_work_url: '',
            author_name: 'Yaseen Khan Gul',
            author_handle: '@YaseenK7212',
            favorite_count: 175,
            prompt_text: 'A complete detailed high-end fashion editorial prompt with cinematic lighting, styling, identity lock, camera, lens, and production direction.',
            expected_image_count: 3,
            detail_expected_count_authoritative: true,
            detail_image_count_authoritative: false,
            image_sources: []
        }
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].author_name, 'Yaseen Khan Gul');
    assert.equal(items[0].expected_image_count, 3);
    assert.deepEqual(items[0].image_sources.map((entry) => entry.url), [
        `https://images.meigen.ai/tweets/${statusId}/0.jpg`,
        `https://images.meigen.ai/tweets/${statusId}/1.jpg`,
        `https://images.meigen.ai/tweets/${statusId}/2.jpg`
    ]);
});

test('Meigen browser collector does not keep prompt text as author when detail nickname exists', () => {
    const statusId = '2074761009437286783';
    const items = collector.mergeCollectedItems([
        {
            source: 'meigen',
            source_item_id: statusId,
            source_page_url: `https://www.meigen.ai/prompt/${statusId}`,
            original_work_url: `https://x.com/VigoCreativeAI/status/${statusId}`,
            author_name: '鱼眼广角深夜街头海报，16:9 横版——采用极限运动摄影机级别的鱼眼广角镜头，贴地仰拍构图，画面带明显桶形畸变',
            author_handle: '@VigoCreativeAI',
            favorite_count: 5,
            prompt_text: 'Create an ultra-vibrant commercial poster for M&M’s chocolate candies, featuring a highly realistic mini M&M’s tube package.',
            image_sources: [{ url: `https://images.meigen.ai/tweets/${statusId}/0.jpg` }]
        },
        {
            source: 'meigen',
            source_item_id: statusId,
            source_page_url: `https://www.meigen.ai/prompt/${statusId}`,
            original_work_url: '',
            author_name: 'Vigo Zhao',
            author_handle: '@VigoCreativeAI',
            favorite_count: 5,
            prompt_text: '',
            expected_image_count: 4,
            detail_expected_count_authoritative: true,
            detail_image_count_authoritative: false,
            image_sources: []
        }
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].author_name, 'Vigo Zhao');
    assert.equal(items[0].expected_image_count, 4);
    assert.deepEqual(items[0].image_sources.map((entry) => entry.url), [
        `https://images.meigen.ai/tweets/${statusId}/0.jpg`,
        `https://images.meigen.ai/tweets/${statusId}/1.jpg`,
        `https://images.meigen.ai/tweets/${statusId}/2.jpg`,
        `https://images.meigen.ai/tweets/${statusId}/3.jpg`
    ]);
});
