(function meigenGalleryCollectorBootstrap(global) {
    'use strict';

    const VERSION = '2026-07-11.63';
    const SOURCE = 'meigen';
    const MAX_ITEMS = 200;
    const MAX_IMAGES_PER_ITEM = 24;
    const MAX_TWEET_IMAGES = 4;
    const IMAGE_URL_PATTERN = /\.(?:avif|webp|png|jpe?g|gif)(?:[?#].*)?$/i;
    const ACTION_PROMPT_LINE_PATTERN = /^(展开|收起|更多相关内容|相关内容|使用\s*Prompt|用作参考图|复制提示词|复制\s*Prompt|下载图片|下载|Download|Copy Prompt|Use Prompt|Use as reference image|More related content)$/i;
    const PROMPT_SECTION_LABEL_PATTERN = /^(提示词|Prompt)$/i;
    const RELATED_CONTEXT_PATTERN = /(更多相关内容|相关内容|相关推荐|猜你喜欢|More related content|Related|Recommendations)/i;
    const NON_ART_IMAGE_CONTEXT_PATTERN = /(avatar|profile|user-avatar|author-avatar|icon|logo|emoji|badge|button|toolbar|header|footer)/i;
    const NON_ART_IMAGE_URL_PATTERN = /(avatar|profile|user-avatar|author-avatar|icon|logo|emoji|badge|gallery-card-(?:front|back)|placeholder|sprite)/i;
    const ORIGINAL_WORK_URL_PATTERN = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^"'<\s)]+\/status\/\d{5,}[^"'<\s)]*/ig;
    const AUTHOR_HANDLE_PATTERN = /@([a-zA-Z0-9_]{1,20})\b/;
    const AUTHOR_TITLE_NOISE_PATTERN = /\b(?:prompt|prompts)\s+by\s+@?[a-zA-Z0-9_]{1,20}\b|\|\s*MeiGen\b/i;
    const AUTHOR_LINE_NOISE_PATTERN = /^(?:Related creations?|More related content|相关内容|更多相关内容|Nanobanana|Nano Banana|GPT Image|Gemini|Imagen|Seedream|Midjourney|Sora|DALL[·\s-]?E|复制\s*Prompt|Copy\s*Prompt|提示词|Prompt|展开|Show more|More)$/i;
    const LONG_NUMERIC_ID_PATTERN = /\b\d{12,25}\b/;
    const ENGAGEMENT_TEXT_PATTERN = /\b(?:likes?|views?|bookmarks?|favorites?|收藏|喜欢|浏览|观看|点赞)\b/i;
    const DETAIL_PAGE_PATH_PATTERN = /\/(?:prompt|prompts|post|posts|works?|gallery)\/[a-zA-Z0-9_-]{5,}/i;
    const DETAIL_CAROUSEL_COUNT_PATTERN = /^\s*\d{1,2}\s*\/\s*(\d{1,2})\s*$/;
    const PROMPT_PREVIEW_HARD_LIMIT = 160;
    const MIN_ARTWORK_SIDE = 180;
    const MIN_ARTWORK_AREA = 42000;
    const STRUCTURED_PROMPT_KEY_PATTERN = /prompt|positivePrompt|fullPrompt|promptText|inputPrompt|copyText|description|caption/i;
    const STRUCTURED_IMAGE_KEY_PATTERN = /images?|imageUrls?|image_urls?|media|generatedImages?|outputs?|photos?|pictures?|src|url/i;
    const STRUCTURED_AUTHOR_HANDLE_KEY_PATTERN = /authorHandle|authorId|handle|username|screenName|twitterUsername|xUsername|userName/i;
    const STRUCTURED_AUTHOR_NAME_KEY_PATTERN = /authorName|creatorName|displayName|nickname|screenName|name/i;
    const STRUCTURED_SKIP_IMAGE_CONTEXT_PATTERN = /(avatar|profile|icon|logo|emoji|badge|author|creator|user|related|recommend)/i;
    const ITEM_SCOPE_SELECTOR = [
        'article',
        '[role="article"]',
        'li',
        '[data-id]',
        '[data-item-id]',
        '[data-prompt-id]',
        '[class*="card" i]',
        '[class*="item" i]',
        '[class*="post" i]',
        '[class*="pin" i]'
    ].join(',');

    function normalizeText(value = '', maxLength = 20000) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .slice(0, maxLength);
    }

    function getBaseUrl() {
        return global.location?.href || 'https://www.meigen.ai/';
    }

    function getScopeBaseUrl(scope, fallback = getBaseUrl()) {
        return scope?.baseURI
            || scope?.ownerDocument?.baseURI
            || scope?.location?.href
            || scope?.URL
            || fallback;
    }

    function toAbsoluteUrl(value = '', baseUrl = getBaseUrl()) {
        const raw = normalizeText(value, 4000);
        if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return '';

        try {
            const url = new URL(raw, baseUrl);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
            return url.toString();
        } catch (_) {
            return '';
        }
    }

    function normalizeImageUrl(value = '', baseUrl = getBaseUrl()) {
        const url = toAbsoluteUrl(value, baseUrl);
        if (!url) return '';
        try {
            const parsed = new URL(url);
            if (parsed.hash && !IMAGE_URL_PATTERN.test(parsed.pathname)) return '';
            if (NON_ART_IMAGE_URL_PATTERN.test(parsed.pathname)) return '';
            if (!IMAGE_URL_PATTERN.test(parsed.pathname) && !/image|img|cdn|media|assets|uploads/i.test(url)) {
                return '';
            }
            return parsed.toString();
        } catch (_) {
            return '';
        }
    }

    function getNodeLabel(node) {
        return normalizeText([
            node?.getAttribute?.('alt'),
            node?.getAttribute?.('title'),
            node?.getAttribute?.('aria-label'),
            node?.className,
            node?.id,
            node?.src,
            node?.currentSrc
        ].filter(Boolean).join(' '), 1200);
    }

    function getNodeDimensions(node) {
        const rect = typeof node?.getBoundingClientRect === 'function'
            ? node.getBoundingClientRect()
            : {};
        const width = Number(node?.naturalWidth || node?.videoWidth || node?.width || node?.getAttribute?.('width') || rect.width || 0);
        const height = Number(node?.naturalHeight || node?.videoHeight || node?.height || node?.getAttribute?.('height') || rect.height || 0);
        return {
            width: Number.isFinite(width) ? width : 0,
            height: Number.isFinite(height) ? height : 0
        };
    }

    function hasRelatedContext(node, stopNode = null) {
        let current = node?.parentElement || null;
        for (let depth = 0; current && depth < 8 && current !== stopNode; depth += 1) {
            const label = getNodeLabel(current);
            if (NON_ART_IMAGE_CONTEXT_PATTERN.test(label)) return true;
            const text = normalizeText(current.innerText || current.textContent || '', 1000);
            if (RELATED_CONTEXT_PATTERN.test(text) && text.length < 900) return true;
            current = current.parentElement;
        }
        return false;
    }

    function isLikelyArtworkImageNode(node, scope = null) {
        if (!node) return true;
        const label = getNodeLabel(node);
        if (NON_ART_IMAGE_CONTEXT_PATTERN.test(label)) return false;
        if (hasRelatedContext(node, scope)) return false;

        const { width, height } = getNodeDimensions(node);
        if (!width || !height) return true;
        const largestSide = Math.max(width, height);
        const area = width * height;
        return largestSide >= MIN_ARTWORK_SIDE && area >= MIN_ARTWORK_AREA;
    }

    function uniqueBy(items = [], keyFn = (value) => value) {
        const seen = new Set();
        const result = [];
        for (const item of items) {
            const key = keyFn(item);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            result.push(item);
        }
        return result;
    }

    function getTweetImageIdentity(value = '') {
        const info = getTweetImageSequenceInfo(value);
        if (!info?.statusId || !Number.isFinite(info.index)) return '';
        return `tweet:${info.statusId}:${info.index}:${String(info.suffix || '').toLowerCase()}`;
    }

    function getMeigenGenerationImageIdentity(value = '') {
        const decoded = decodeUrlishText(value).toLowerCase();
        const match = decoded.match(/\/generations\/(?:[^/?#\s]+\/)*(community_[a-z0-9-]+)\.(?:avif|webp|png|jpe?g)/i);
        return match?.[1] ? `generation:${match[1]}` : '';
    }

    function scoreImageUrlQuality(value = '') {
        const text = String(value || '');
        let score = text.length;
        if (/\/cdn-cgi\/image\//i.test(text)) score -= 1000;
        if (/images\.meigen\.ai\/tweets\//i.test(text)) score += 120;
        if (/\bwidth=\d+/i.test(text)) score -= 40;
        return score;
    }

    function dedupeImageUrlsByArtwork(urls = [], limit = MAX_IMAGES_PER_ITEM) {
        const byKey = new Map();
        for (const url of (Array.isArray(urls) ? urls : [])) {
            const normalized = String(url || '').trim();
            if (!normalized) continue;
            const key = getTweetImageIdentity(normalized)
                || getMeigenGenerationImageIdentity(normalized)
                || normalized.toLowerCase();
            const current = byKey.get(key);
            if (!current || scoreImageUrlQuality(normalized) > scoreImageUrlQuality(current)) {
                byKey.set(key, normalized);
            }
        }
        return Array.from(byKey.values()).slice(0, limit);
    }

    function parseSrcset(value = '') {
        return String(value || '')
            .split(',')
            .map((entry) => entry.trim().split(/\s+/)[0])
            .filter(Boolean);
    }

    function collectImageUrls(scope, options = {}) {
        if (!scope?.querySelectorAll) return [];
        const baseUrl = options.baseUrl || getScopeBaseUrl(scope);
        if (isDetailCollectionScope(scope, options)) {
            return collectDetailArtworkImageUrls(scope, { baseUrl });
        }

        const candidates = [];

        scope.querySelectorAll('img, source').forEach((node) => {
            const candidateNode = node.closest?.('picture')?.querySelector?.('img') || node;
            if (!isLikelyArtworkImageNode(candidateNode, scope)) return;
            [
                node.currentSrc,
                node.src,
                node.getAttribute?.('src'),
                node.getAttribute?.('data-src'),
                node.getAttribute?.('data-original'),
                node.getAttribute?.('data-lazy-src'),
                node.getAttribute?.('data-url')
            ].forEach((value) => candidates.push(value));

            [
                node.srcset,
                node.getAttribute?.('srcset'),
                node.getAttribute?.('data-srcset')
            ].forEach((value) => {
                parseSrcset(value).forEach((url) => candidates.push(url));
            });
        });

        scope.querySelectorAll('a[href]').forEach((link) => {
            const href = link.getAttribute('href');
            if (IMAGE_URL_PATTERN.test(String(href || '').split('?')[0])
                && isLikelyArtworkImageNode(link.querySelector?.('img') || link, scope)) {
                candidates.push(href);
            }
        });

        if (global.getComputedStyle) {
            [scope, ...Array.from(scope.querySelectorAll?.('*') || []).slice(0, 250)].forEach((node) => {
                if (!isLikelyArtworkImageNode(node, scope)) return;
                const background = global.getComputedStyle(node).backgroundImage || '';
                const match = background.match(/url\(["']?(.+?)["']?\)/i);
                if (match) candidates.push(match[1]);
            });
        }

        return uniqueBy(
            candidates.map((url) => normalizeImageUrl(url, baseUrl)).filter(Boolean),
            (url) => url.toLowerCase()
        ).slice(0, MAX_IMAGES_PER_ITEM);
    }

    function isInsideRelatedSection(node) {
        if (hasRelatedHeadingBefore(node)) return true;
        let current = node?.parentElement || null;
        for (let depth = 0; current && depth < 10; depth += 1) {
            const text = normalizeText(current.innerText || current.textContent || '', 1200);
            const firstLine = text.split(/\n+/).map((line) => normalizeText(line, 160)).find(Boolean) || '';
            if (RELATED_CONTEXT_PATTERN.test(firstLine)) return true;
            if (RELATED_CONTEXT_PATTERN.test(text) && text.length < 1800) return true;
            current = current.parentElement;
        }
        return false;
    }

    function hasRelatedHeadingBefore(node) {
        let current = node;
        for (let depth = 0; current && depth < 8; depth += 1) {
            let sibling = current.previousElementSibling || null;
            for (let siblingDepth = 0; sibling && siblingDepth < 8; siblingDepth += 1) {
                const text = normalizeText(sibling.innerText || sibling.textContent || '', 240);
                if (RELATED_CONTEXT_PATTERN.test(text)) return true;
                sibling = sibling.previousElementSibling || null;
            }
            current = current.parentElement;
        }
        return false;
    }

    function isInsideAuthorSidebar(node) {
        let current = node?.parentElement || null;
        for (let depth = 0; current && depth < 8; depth += 1) {
            const text = normalizeText(current.innerText || current.textContent || '', 800);
            if (/@[a-zA-Z0-9_]{1,20}\b/.test(text) && /(提示词|Prompt)/i.test(text) && text.length < 1200) return true;
            if (RELATED_CONTEXT_PATTERN.test(text) && text.length < 900) return true;
            current = current.parentElement;
        }
        return false;
    }

    function getImageRectArea(node) {
        const { width, height } = getNodeDimensions(node);
        return width * height;
    }

    function getImageX(node) {
        const rect = typeof node?.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : {};
        return Number(rect.left || 0);
    }

    function getNodeTop(node) {
        const rect = typeof node?.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : {};
        const scrollY = node?.ownerDocument?.defaultView?.scrollY || global.scrollY || 0;
        return Number(rect.top || 0) + scrollY;
    }

    function getNodeDocumentOrderScore(node) {
        const rect = typeof node?.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : {};
        const scrollY = node?.ownerDocument?.defaultView?.scrollY || global.scrollY || 0;
        const scrollX = node?.ownerDocument?.defaultView?.scrollX || global.scrollX || 0;
        const top = Number(rect.top || 0) + scrollY;
        const left = Number(rect.left || 0) + scrollX;
        return (top * 100000) + left;
    }

    function isPageShellScope(scope) {
        if (!scope) return false;
        if (scope === global.document || scope.nodeType === 9) return true;
        const tagName = String(scope.tagName || scope.nodeName || '').toLowerCase();
        if (['html', 'body', 'main'].includes(tagName)) return true;
        const role = normalizeText(scope.getAttribute?.('role') || '', 80).toLowerCase();
        return role === 'main';
    }

    function isDetailPageUrl(value = '') {
        try {
            const parsed = new URL(value || getBaseUrl(), getBaseUrl());
            return DETAIL_PAGE_PATH_PATTERN.test(parsed.pathname);
        } catch (_) {
            return false;
        }
    }

    function isDetailCollectionScope(scope, options = {}) {
        return Boolean(
            options.detailOnly
            || options.expectedDetailUrl
            || isDetailPageUrl(options.baseUrl || getScopeBaseUrl(scope))
            || isLikelyOpenDetailView(scope)
        );
    }

    function isLikelyOpenDetailView(scope) {
        if (!scope?.querySelectorAll) return false;
        if (scope !== global.document && scope.nodeType !== 9) return false;
        if (getDetailArtworkExpectedCount(scope) <= 0) return false;
        const text = normalizeText(scope.innerText || scope.textContent || '', 5000);
        return AUTHOR_HANDLE_PATTERN.test(text)
            && /(提示词|Prompt|复制\s*(Prompt|提示词)|Copy\s*Prompt)/i.test(text)
            && Array.from(scope.querySelectorAll('[role="dialog"], dialog, [aria-modal="true"]') || []).length > 0;
    }

    function getCarouselCountMatch(value = '') {
        const lines = normalizeText(value, 2000)
            .split(/\n+/)
            .map((line) => normalizeText(line, 80))
            .filter(Boolean);
        for (const line of lines) {
            const match = line.match(DETAIL_CAROUSEL_COUNT_PATTERN);
            if (!match) continue;
            const count = Number.parseInt(match[1] || '', 10);
            if (Number.isFinite(count) && count > 0) {
                return { text: line, count: Math.min(count, MAX_IMAGES_PER_ITEM) };
            }
        }
        for (const line of lines) {
            if (line.length > 80) continue;
            const match = line.match(/\b\d{1,2}\s*\/\s*(\d{1,2})\b/);
            if (!match) continue;
            const count = Number.parseInt(match[1] || '', 10);
            if (Number.isFinite(count) && count > 0) {
                return { text: match[0], count: Math.min(count, MAX_IMAGES_PER_ITEM) };
            }
        }
        return null;
    }

    function getDetailCarouselCountEntries(scope) {
        if (!scope?.querySelectorAll) return [];
        return uniqueBy(
            [scope, ...Array.from(scope.querySelectorAll('*') || []).slice(0, 600)].filter(Boolean),
            (node) => node
        )
            .map((node) => {
                const text = normalizeText([
                    node.getAttribute?.('aria-label'),
                    node.getAttribute?.('title'),
                    node.innerText,
                    node.textContent
                ].filter(Boolean).join('\n'), 2000);
                const match = getCarouselCountMatch(text);
                return match ? {
                    node,
                    count: match.count,
                    textLength: text.length,
                    order: getNodeDocumentOrderScore(node)
                } : null;
            })
            .filter(Boolean)
            .sort((a, b) => (a.textLength - b.textLength) || (a.order - b.order));
    }

    function getTrustedDetailArtworkExpectedCount(scope) {
        const countEntry = getDetailCarouselCountEntries(scope)
            .find((entry) => {
                if (Number(entry?.textLength || 0) > 80) return false;
                const statusId = extractLongNumericId(getScopeBaseUrl(scope));
                return !statusId || Number(entry?.count || 0) <= MAX_TWEET_IMAGES;
            });
        return countEntry?.count || 0;
    }

    function getDetailArtworkExpectedCount(scope) {
        const countEntry = getDetailCarouselCountEntries(scope)[0];
        if (countEntry?.count) return countEntry.count;
        return 0;
    }

    function normalizeExpectedDetailImageCount(value = 0) {
        const count = Number.parseInt(String(value || ''), 10);
        if (!Number.isFinite(count) || count <= 0) return 0;
        return Math.min(count, MAX_IMAGES_PER_ITEM);
    }

    function isLikelyDetailArtworkImageNode(node, scope = null) {
        if (!node) return true;
        const label = getNodeLabel(node);
        if (NON_ART_IMAGE_CONTEXT_PATTERN.test(label)) return false;
        if (hasRelatedContext(node, scope)) return false;

        const { width, height } = getNodeDimensions(node);
        if (!width || !height) return true;
        const largestSide = Math.max(width, height);
        const area = width * height;
        return largestSide >= 72 && area >= 5000;
    }

    function getDetailArtworkImageEntries(root, stopScope = root) {
        if (!root?.querySelectorAll) return [];
        return Array.from(root.querySelectorAll('img'))
            .filter((node) => isLikelyDetailArtworkImageNode(node, stopScope))
            .filter((node) => !isInsideAuthorSidebar(node))
            .filter((node) => !isInsideRelatedSection(node))
            .map((node) => ({
                node,
                area: getImageRectArea(node),
                top: getNodeTop(node),
                x: getImageX(node),
                order: getNodeDocumentOrderScore(node)
            }))
            .filter((entry) => entry.area > 0);
    }

    function findDetailArtworkRoot(scope, expectedCount = 0) {
        const countEntries = getDetailCarouselCountEntries(scope);
        for (const entry of countEntries) {
            let current = entry.node;
            for (let depth = 0; current && depth < 9; depth += 1) {
                if (current.querySelectorAll) {
                    const imageEntries = getDetailArtworkImageEntries(current, current);
                    const text = normalizeText(current.innerText || current.textContent || '', 1600);
                    const includesRelated = RELATED_CONTEXT_PATTERN.test(text);
                    if (imageEntries.length >= expectedCount
                        && imageEntries.length <= expectedCount + 2
                        && !includesRelated) {
                        return current;
                    }
                }
                if (current === scope) break;
                current = current.parentElement;
            }
        }

        const allImages = getDetailArtworkImageEntries(scope, scope)
            .sort((a, b) => a.order - b.order);
        if (allImages.length <= expectedCount) return scope;
        return scope;
    }

    function getImageUrlCandidatesFromEntry(entry, baseUrl = getBaseUrl()) {
        const candidates = [];
        [
            entry?.node?.currentSrc,
            entry?.node?.src,
            entry?.node?.getAttribute?.('src'),
            entry?.node?.getAttribute?.('data-src'),
            entry?.node?.getAttribute?.('data-original'),
            entry?.node?.getAttribute?.('data-lazy-src'),
            entry?.node?.getAttribute?.('data-url')
        ].forEach((value) => candidates.push(value));
        [
            entry?.node?.srcset,
            entry?.node?.getAttribute?.('srcset'),
            entry?.node?.getAttribute?.('data-srcset')
        ].forEach((value) => {
            parseSrcset(value).forEach((url) => candidates.push(url));
        });
        return candidates
            .map((url) => normalizeImageUrl(url, baseUrl))
            .filter(Boolean);
    }

    function collectUniqueDetailImageUrls(entries = [], expectedCount = MAX_IMAGES_PER_ITEM, baseUrl = getBaseUrl()) {
        const urls = [];
        const seen = new Set();
        for (const entry of entries) {
            for (const url of getImageUrlCandidatesFromEntry(entry, baseUrl)) {
                const key = url.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                urls.push(url);
                if (urls.length >= expectedCount) return urls;
            }
        }
        return urls;
    }

    function collectDetailArtworkImageUrls(scope, options = {}) {
        if (!scope?.querySelectorAll) return [];
        const baseUrl = options.baseUrl || getScopeBaseUrl(scope);
        const expectedCount = getTrustedDetailArtworkExpectedCount(scope);
        if (expectedCount <= 0) {
            const scopeText = normalizeText(scope.innerText || scope.textContent || '', 2000);
            const hasPromptMarker = /(提示词|Prompt|复制\s*(Prompt|提示词)|Copy\s*Prompt)/i.test(scopeText);
            if (RELATED_CONTEXT_PATTERN.test(scopeText) && !hasPromptMarker) return [];
            const largestImage = getDetailArtworkImageEntries(scope, scope)
                .sort((a, b) => (b.area - a.area) || (a.order - b.order))
                .slice(0, 1);
            return collectUniqueDetailImageUrls(largestImage, 1, baseUrl);
        }
        const artworkRoot = findDetailArtworkRoot(scope, expectedCount);
        if (!artworkRoot) return [];

        let imageNodes = getDetailArtworkImageEntries(artworkRoot, artworkRoot)
            .sort((a, b) => a.order - b.order);
        if (expectedCount === 1 && imageNodes.length > 1) {
            imageNodes = [...imageNodes]
                .sort((a, b) => (b.area - a.area) || (a.order - b.order))
                .slice(0, 1);
        }

        let urls = collectUniqueDetailImageUrls(imageNodes, expectedCount, baseUrl);
        if (urls.length < expectedCount && artworkRoot !== scope) {
            const fallbackNodes = getDetailArtworkImageEntries(scope, scope)
                .sort((a, b) => a.order - b.order);
            urls = uniqueBy([
                ...urls,
                ...collectUniqueDetailImageUrls(fallbackNodes, expectedCount, baseUrl)
            ], (url) => url.toLowerCase()).slice(0, expectedCount);
        }
        return urls.slice(0, expectedCount);
    }

    function parseFavoriteCount(text = '') {
        const sourceText = normalizeText(text, 6000);
        const patterns = [
            /([\d.,]+)\s*([kKmM万千]?)\s*(?:收藏|喜欢|点赞|赞|bookmarks?|favorites?|likes?)/i,
            /(?:收藏|喜欢|点赞|赞|bookmarks?|favorites?|likes?)\D{0,12}([\d.,]+)\s*([kKmM万千]?)/i
        ];

        for (const pattern of patterns) {
            const match = sourceText.match(pattern);
            if (!match) continue;
            const number = Number.parseFloat(String(match[1] || '').replace(/,/g, ''));
            if (!Number.isFinite(number)) continue;
            const unit = String(match[2] || '').toLowerCase();
            const multiplier = unit === '万'
                ? 10000
                : (unit === '千' || unit === 'k' ? 1000 : (unit === 'm' ? 1000000 : 1));
            return Math.max(0, Math.round(number * multiplier));
        }

        return 0;
    }

    function getDatasetValue(scope, keys = []) {
        if (!scope) return '';
        for (const key of keys) {
            const value = scope.dataset?.[key];
            if (value) return normalizeText(value);
            const attr = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
            const attrValue = scope.getAttribute?.(`data-${attr}`);
            if (attrValue) return normalizeText(attrValue);
        }
        return '';
    }

    function decodeStructuredText(value = '') {
        return normalizeText(String(value || '')
            .replace(/\\u002f/gi, '/')
            .replace(/\\\//g, '/'), 40000);
    }

    function getStructuredScriptNodes(scope) {
        if (!scope?.querySelectorAll) return [];
        return Array.from(scope.querySelectorAll([
            'script#__NEXT_DATA__',
            'script[type="application/json"]',
            'script[type="application/ld+json"]'
        ].join(',')));
    }

    function findStructuredValue(scope, keyPattern, valuePattern = null) {
        const scripts = getStructuredScriptNodes(scope);
        const seen = new Set();

        function visit(value, key = '') {
            if (value == null) return '';
            if (typeof value === 'string') {
                const text = normalizeText(value, 20000);
                if (text.length >= 12
                    && (!keyPattern || keyPattern.test(key))
                    && (!valuePattern || valuePattern.test(text))) {
                    return text;
                }
                return '';
            }
            if (typeof value !== 'object' || seen.has(value)) return '';
            seen.add(value);

            if (Array.isArray(value)) {
                for (const entry of value) {
                    const found = visit(entry, key);
                    if (found) return found;
                }
                return '';
            }

            for (const [entryKey, entryValue] of Object.entries(value)) {
                const found = visit(entryValue, entryKey);
                if (found) return found;
            }
            return '';
        }

        for (const node of scripts) {
            const raw = decodeStructuredText(node.textContent || '');
            if (!raw) continue;
            try {
                const found = visit(JSON.parse(raw));
                if (found) return found;
            } catch (_) {
                if (valuePattern) {
                    const match = raw.match(valuePattern);
                    if (match) return normalizeText(match[0], 4000);
                }
            }
        }
        return '';
    }

    function getExternalStructuredEntries(options = {}) {
        if (Object.prototype.hasOwnProperty.call(options, 'structuredEntries')) {
            return Array.isArray(options.structuredEntries) ? options.structuredEntries.filter(Boolean) : [];
        }
        const globalEntries = Array.isArray(global.__FatherKeyMeigenStructuredEntries)
            ? global.__FatherKeyMeigenStructuredEntries
            : [];
        return globalEntries.filter(Boolean);
    }

    function normalizeStructuredEntry(entry, baseUrl = getBaseUrl()) {
        if (!entry) return null;
        if (typeof entry === 'string') {
            return {
                kind: 'text',
                url: '',
                text: decodeStructuredText(entry)
            };
        }
        return {
            kind: normalizeText(entry.kind || entry.type || 'external', 80),
            url: toAbsoluteUrl(entry.url || entry.href || '', baseUrl),
            text: decodeStructuredText(entry.text || entry.raw || entry.body || ''),
            data: entry.data && typeof entry.data === 'object' ? entry.data : null
        };
    }

    function getStructuredEntries(scope, options = {}) {
        const baseUrl = options.baseUrl || getScopeBaseUrl(scope);
        const scriptEntries = getStructuredScriptNodes(scope).map((node) => normalizeStructuredEntry({
            kind: 'script',
            url: node.src || node.getAttribute?.('src') || '',
            text: node.textContent || ''
        }, baseUrl));
        const externalEntries = getExternalStructuredEntries(options)
            .map((entry) => normalizeStructuredEntry(entry, baseUrl));
        return [...scriptEntries, ...externalEntries]
            .filter((entry) => entry && (entry.text || entry.data));
    }

    function parseStructuredJsonText(text = '') {
        const raw = decodeStructuredText(text);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    }

    function collectNextFlightRoots(text = '') {
        const raw = decodeStructuredText(text);
        if (!raw || !/(?:__next_f|self\.__next_f|next_f\.push)/i.test(raw)) return [];
        const roots = [];
        const pushPattern = /(?:self\.)?__next_f\.push\((\[[\s\S]*?\])\)/g;
        for (const match of raw.matchAll(pushPattern)) {
            const parsed = parseStructuredJsonText(match[1]);
            if (parsed) roots.push(parsed);
        }
        return roots;
    }

    function getStructuredRoots(scope, options = {}) {
        const roots = [];
        for (const entry of getStructuredEntries(scope, options)) {
            if (entry.data) roots.push(entry.data);
            const parsed = parseStructuredJsonText(entry.text);
            if (parsed) roots.push(parsed);
            roots.push(...collectNextFlightRoots(entry.text));
            if (entry.text && !parsed) {
                roots.push({ __fatherKeyRawText: entry.text, __fatherKeySourceUrl: entry.url || '' });
            }
        }
        return roots;
    }

    function collectStructuredStrings(value, options = {}) {
        const results = [];
        const seen = new Set();
        const maxDepth = Number(options.maxDepth || 12);
        const maxStrings = Number(options.maxStrings || 500);

        function visit(node, keyPath = [], depth = 0) {
            if (results.length >= maxStrings || depth > maxDepth || node == null) return;
            if (typeof node === 'string' || typeof node === 'number') {
                const text = decodeStructuredText(node);
                if (text) {
                    results.push({
                        key: keyPath[keyPath.length - 1] || '',
                        path: keyPath.join('.'),
                        text
                    });
                }
                return;
            }
            if (typeof node !== 'object' || seen.has(node)) return;
            seen.add(node);
            if (Array.isArray(node)) {
                node.forEach((entry, index) => visit(entry, [...keyPath, String(index)], depth + 1));
                return;
            }
            Object.entries(node).forEach(([key, entry]) => visit(entry, [...keyPath, key], depth + 1));
        }

        visit(value);
        return results;
    }

    function extractStructuredPrompt(value) {
        const candidates = collectStructuredStrings(value)
            .filter((entry) => STRUCTURED_PROMPT_KEY_PATTERN.test(entry.path) || /prompt/i.test(entry.text.slice(0, 80)))
            .map((entry) => {
                const text = cleanPromptText(entry.text);
                if (!isUsablePromptText(text)) return null;
                let score = text.length;
                if (/prompt/i.test(entry.path)) score += 300;
                if (/positive|full|copy|input/i.test(entry.path)) score += 120;
                if (/description|caption|text/i.test(entry.path)) score += 40;
                if (/related|recommend/i.test(entry.path)) score -= 200;
                return { text, score };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score);
        return candidates[0]?.text || '';
    }

    function collectStructuredImageUrls(value, baseUrl = getBaseUrl(), limit = MAX_IMAGES_PER_ITEM) {
        const urls = [];
        const seen = new Set();
        for (const entry of collectStructuredStrings(value, { maxStrings: 900 })) {
            if (!STRUCTURED_IMAGE_KEY_PATTERN.test(entry.path) && !IMAGE_URL_PATTERN.test(entry.text.split('?')[0])) {
                continue;
            }
            if (/(related|recommend)/i.test(entry.path)) {
                continue;
            }
            if (STRUCTURED_SKIP_IMAGE_CONTEXT_PATTERN.test(entry.path) && !/generated|outputs?|artwork/i.test(entry.path)) {
                continue;
            }
            const rawUrl = normalizeText(entry.text, 4000);
            if (!looksLikeExplicitUrl(rawUrl)) continue;
            const url = normalizeImageUrl(rawUrl, baseUrl);
            if (!url) continue;
            const key = url.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            urls.push(url);
            if (urls.length >= limit) break;
        }
        return urls;
    }

    function extractStructuredOriginalWorkUrl(value, baseUrl = getBaseUrl()) {
        for (const entry of collectStructuredStrings(value, { maxStrings: 700 })) {
            if (!/(url|href|link|source|twitter|tweet|status|original|x)/i.test(entry.path + entry.text)) continue;
            const urls = extractOriginalWorkUrlsFromText(entry.text, baseUrl);
            if (urls[0]) return urls[0];
        }
        return '';
    }

    function looksLikeExplicitUrl(value = '') {
        const text = normalizeText(value, 2000);
        return /^(?:https?:)?\/\//i.test(text)
            || /^\/(?:prompt|prompts|post|posts|works?|gallery)\//i.test(text)
            || /^\.\.?\//.test(text);
    }

    function extractStructuredDetailUrl(value, baseUrl = getBaseUrl()) {
        for (const entry of collectStructuredStrings(value, { maxStrings: 700 })) {
            if (!looksLikeExplicitUrl(entry.text)) continue;
            const url = toAbsoluteUrl(entry.text, baseUrl);
            if (url && isDetailPageUrl(url)) return url;
        }
        return '';
    }

    function extractStructuredAuthorHandle(value) {
        const preferred = collectStructuredStrings(value, { maxStrings: 500 })
            .filter((entry) => STRUCTURED_AUTHOR_HANDLE_KEY_PATTERN.test(entry.path))
            .map((entry) => normalizeAuthorHandle(entry.text))
            .find(Boolean);
        if (preferred) return preferred;
        const fromProfile = collectStructuredStrings(value, { maxStrings: 500 })
            .map((entry) => getAuthorHandleFromUrl(entry.text))
            .find(Boolean);
        if (fromProfile) return fromProfile;
        return '';
    }

    function extractStructuredAuthorName(value, expectedHandle = '') {
        const strings = collectStructuredStrings(value, { maxStrings: 500 });
        const expected = normalizeAuthorHandle(expectedHandle);
        const handleEntry = expected
            ? strings.find((entry) => normalizeAuthorHandle(entry.text).toLowerCase() === expected.toLowerCase())
            : null;
        if (handleEntry) {
            const pathPrefix = handleEntry.path.split('.').slice(0, -1).join('.');
            const nearName = strings
                .filter((entry) => entry.path.startsWith(pathPrefix))
                .map((entry) => normalizeAuthorName(entry.text))
                .find(Boolean);
            if (nearName) return nearName;
        }
        return strings
            .filter((entry) => STRUCTURED_AUTHOR_NAME_KEY_PATTERN.test(entry.path))
            .map((entry) => normalizeAuthorName(entry.text))
            .find(Boolean) || '';
    }

    function extractStructuredFavoriteCount(value) {
        const favoriteText = collectStructuredStrings(value, { maxStrings: 500 })
            .filter((entry) => /favorite|bookmark|like|收藏|喜欢|点赞/i.test(entry.path + entry.text))
            .map((entry) => entry.text)
            .join(' ');
        return parseFavoriteCount(favoriteText);
    }

    function extractStructuredSourceItemId(value) {
        const entry = collectStructuredStrings(value, { maxStrings: 500 })
            .find((candidate) => /(sourceItemId|itemId|promptId|postId|workId|tweetId|statusId|id|slug)$/i.test(candidate.path)
                && normalizeText(candidate.text, 120).length >= 3);
        return entry ? normalizeText(entry.text, 160) : '';
    }

    function getStructuredIdentityCounts(value, baseUrl = getBaseUrl()) {
        const detailUrls = new Set();
        const originalUrls = new Set();
        for (const entry of collectStructuredStrings(value, { maxStrings: 900 })) {
            const detailUrl = looksLikeExplicitUrl(entry.text)
                ? toAbsoluteUrl(entry.text, baseUrl)
                : '';
            if (detailUrl && isDetailPageUrl(detailUrl)) {
                detailUrls.add(normalizeComparableUrl(detailUrl));
            }
            extractOriginalWorkUrlsFromText(entry.text, baseUrl)
                .forEach((url) => originalUrls.add(normalizeComparableUrl(url)));
        }
        return {
            detailUrls: detailUrls.size,
            originalUrls: originalUrls.size
        };
    }

    function buildStructuredCandidate(value, baseUrl = getBaseUrl(), path = '') {
        if (!value || typeof value !== 'object') return null;
        const identityCounts = getStructuredIdentityCounts(value, baseUrl);
        if (identityCounts.detailUrls > 1 || identityCounts.originalUrls > 1) return null;
        const originalWorkUrl = extractStructuredOriginalWorkUrl(value, baseUrl);
        const authorHandle = extractStructuredAuthorHandle(value) || getAuthorHandleFromUrl(originalWorkUrl);
        const promptText = extractStructuredPrompt(value);
        const imageUrls = collectStructuredImageUrls(value, baseUrl);
        const detailUrl = extractStructuredDetailUrl(value, baseUrl);
        const authorName = extractStructuredAuthorName(value, authorHandle);
        const sourceItemId = extractStructuredSourceItemId(value);
        const favoriteCount = extractStructuredFavoriteCount(value);
        const imageStatusId = getStatusIdFromImageUrls(imageUrls);
        const statusId = extractLongNumericId(originalWorkUrl) || extractLongNumericId(sourceItemId) || imageStatusId;
        const quality = [
            promptText,
            imageUrls.length ? imageUrls[0] : '',
            originalWorkUrl,
            detailUrl,
            authorHandle,
            authorName
        ].filter(Boolean).length;
        if (quality < 2) return null;
        if (imageUrls.length > MAX_IMAGES_PER_ITEM && !promptText && !originalWorkUrl) return null;
        return {
            path,
            sourceItemId,
            detailUrl,
            originalWorkUrl,
            statusId,
            authorHandle,
            authorName,
            favoriteCount,
            promptText,
            imageUrls
        };
    }

    function collectStructuredItemCandidates(scope, options = {}) {
        const baseUrl = options.baseUrl || getScopeBaseUrl(scope);
        const candidates = [];
        const seenObjects = new Set();

        function visit(value, keyPath = [], depth = 0) {
            if (depth > 12 || value == null) return;
            if (typeof value !== 'object') return;
            if (seenObjects.has(value)) return;
            seenObjects.add(value);
            const candidate = buildStructuredCandidate(value, baseUrl, keyPath.join('.'));
            if (candidate) candidates.push(candidate);
            if (Array.isArray(value)) {
                value.forEach((entry, index) => visit(entry, [...keyPath, String(index)], depth + 1));
                return;
            }
            Object.entries(value).forEach(([key, entry]) => visit(entry, [...keyPath, key], depth + 1));
        }

        getStructuredRoots(scope, options).forEach((root, index) => visit(root, [`root${index}`]));
        return mergeStructuredCandidates(candidates);
    }

    function mergeStructuredCandidates(candidates = []) {
        const grouped = new Map();
        for (const candidate of candidates) {
            const key = candidate.originalWorkUrl
                || candidate.detailUrl
                || candidate.statusId
                || candidate.sourceItemId
                || candidate.promptText;
            if (!key) continue;
            const current = grouped.get(key);
            if (!current) {
                grouped.set(key, {
                    ...candidate,
                    imageUrls: dedupeImageUrlsByArtwork(candidate.imageUrls || [])
                });
                continue;
            }
            current.promptText = preferDetailValue(current.promptText, candidate.promptText);
            current.originalWorkUrl = current.originalWorkUrl || candidate.originalWorkUrl || '';
            current.detailUrl = current.detailUrl || candidate.detailUrl || '';
            current.statusId = current.statusId || candidate.statusId || '';
            current.authorHandle = current.authorHandle || candidate.authorHandle || '';
            current.authorName = current.authorName || candidate.authorName || '';
            current.favoriteCount = Math.max(current.favoriteCount || 0, candidate.favoriteCount || 0);
            current.imageUrls = dedupeImageUrlsByArtwork([
                ...(current.imageUrls || []),
                ...(candidate.imageUrls || [])
            ], MAX_IMAGES_PER_ITEM);
        }
        return Array.from(grouped.values());
    }

    function normalizeComparableUrl(value = '', baseUrl = getBaseUrl()) {
        const url = toAbsoluteUrl(value, baseUrl);
        if (!url) return '';
        try {
            const parsed = new URL(url);
            parsed.hash = '';
            return parsed.toString().replace(/\/$/, '').toLowerCase();
        } catch (_) {
            return url.toLowerCase();
        }
    }

    function sameDetailUrl(left = '', right = '') {
        const a = normalizeComparableUrl(left);
        const b = normalizeComparableUrl(right);
        if (!a || !b) return false;
        if (a === b) return true;
        try {
            const leftUrl = new URL(a);
            const rightUrl = new URL(b);
            return leftUrl.hostname === rightUrl.hostname
                && leftUrl.pathname.replace(/\/$/, '') === rightUrl.pathname.replace(/\/$/, '');
        } catch (_) {
            return false;
        }
    }

    function getDetailLinkUrls(scope, baseUrl = getScopeBaseUrl(scope)) {
        if (!scope?.querySelectorAll) return [];
        return uniqueBy(
            [
                scope,
                ...Array.from(scope.querySelectorAll('a[href]') || [])
            ]
                .map((link) => toAbsoluteUrl(link.href || link.getAttribute?.('href') || '', baseUrl))
                .filter((url) => url && isDetailPageUrl(url)),
            (url) => normalizeComparableUrl(url)
        );
    }

    function imageUrlMatches(left = '', right = '') {
        const a = normalizeComparableUrl(left);
        const b = normalizeComparableUrl(right);
        if (!a || !b) return false;
        if (a === b) return true;
        try {
            const leftUrl = new URL(a);
            const rightUrl = new URL(b);
            return leftUrl.pathname === rightUrl.pathname
                && leftUrl.pathname.split('/').pop() === rightUrl.pathname.split('/').pop();
        } catch (_) {
            return false;
        }
    }

    function scoreStructuredCandidate(candidate = {}, context = {}) {
        let score = 0;
        const expectedDetailUrl = context.expectedDetailUrl || context.detailUrl || '';
        const expectedOriginalUrl = context.expectedOriginalWorkUrl || context.originalWorkUrl || '';
        const expectedStatusId = extractLongNumericId(expectedOriginalUrl);
        const candidateStatusId = candidate.statusId || extractLongNumericId(candidate.originalWorkUrl);
        const expectedHandle = normalizeAuthorHandle(context.expectedAuthorHandle || context.authorHandle || '');
        const candidateHandle = normalizeAuthorHandle(candidate.authorHandle || '');
        const expectedImages = Array.isArray(context.expectedImageUrls) ? context.expectedImageUrls : [];

        if (expectedDetailUrl && candidate.detailUrl) {
            if (sameDetailUrl(expectedDetailUrl, candidate.detailUrl)) score += 120;
            else score -= 120;
        }
        if (expectedStatusId && candidateStatusId) {
            if (expectedStatusId === candidateStatusId) score += 110;
            else score -= 140;
        }
        if (expectedOriginalUrl && candidate.originalWorkUrl) {
            if (normalizeComparableUrl(expectedOriginalUrl) === normalizeComparableUrl(candidate.originalWorkUrl)) score += 110;
            else if (expectedStatusId && candidateStatusId && expectedStatusId !== candidateStatusId) score -= 140;
        }
        if (expectedHandle && candidateHandle) {
            score += expectedHandle.toLowerCase() === candidateHandle.toLowerCase() ? 45 : -35;
        }
        if (expectedImages.length && Array.isArray(candidate.imageUrls)) {
            const matchedImages = candidate.imageUrls.filter((url) => expectedImages.some((expected) => imageUrlMatches(url, expected)));
            score += matchedImages.length * 55;
        }
        if (context.sourceItemId && candidate.sourceItemId && String(context.sourceItemId) === String(candidate.sourceItemId)) score += 70;
        if (candidate.promptText) score += 25;
        if ((candidate.imageUrls || []).length) score += Math.min(30, candidate.imageUrls.length * 6);
        if (candidate.originalWorkUrl) score += 15;
        if (candidate.authorName || candidate.authorHandle) score += 8;
        if (context.detailOnly && candidate.promptText && (candidate.imageUrls || []).length) score += 20;
        return score;
    }

    function getBestStructuredCandidate(scope, options = {}) {
        const candidates = collectStructuredItemCandidates(scope, options);
        if (!candidates.length) return null;
        const scored = candidates
            .map((candidate) => ({
                candidate,
                score: scoreStructuredCandidate(candidate, options)
            }))
            .sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (!best) return null;
        if (best.score >= 45) return best.candidate;
        if (options.detailOnly && candidates.length === 1 && best.score >= 0) return best.candidate;
        return null;
    }

    function cleanPromptText(value = '') {
        const lines = normalizeText(value, 20000)
            .split(/\n+/)
            .map((line) => normalizeText(line))
            .filter(Boolean);
        const kept = [];
        for (const line of lines) {
            if (!kept.length && PROMPT_SECTION_LABEL_PATTERN.test(line)) continue;
            const labelPrefixMatch = !kept.length
                ? line.match(/^(提示词|Prompt)\s*[:：]\s*(.{12,})$/i)
                : null;
            const effectiveLine = labelPrefixMatch ? normalizeText(labelPrefixMatch[2]) : line;
            if (!effectiveLine) continue;
            if (ACTION_PROMPT_LINE_PATTERN.test(line)) break;
            if (/^(作者|Author|收藏|图片|Image|链接|Link)\b/i.test(line)) break;
            kept.push(effectiveLine);
        }
        const cleaned = kept.join('\n').trim();
        return isLikelyNonPromptListText(cleaned) ? '' : cleaned;
    }

    function isLikelyNonPromptListText(value = '') {
        const text = normalizeText(value, 5000);
        if (!text) return false;
        const lines = text.split(/\n+/).map((line) => normalizeText(line, 160)).filter(Boolean);
        const handleCount = (text.match(/@[a-zA-Z0-9_]{1,20}\b/g) || []).length;
        const creativeActionCount = (text.match(/使用创意|Use\s+creative|Use\s+Prompt/gi) || []).length;
        const numericLineCount = lines.filter((line) => /^\d+(?:[,.]\d+)?(?:[kK万千])?$/.test(line)).length;
        if (/^Free\s+GPT\s+Image\b/i.test(text) && /no\s+prompt\s+engineering/i.test(text)) return true;
        if (creativeActionCount >= 2 && handleCount >= 2) return true;
        if (handleCount >= 3 && numericLineCount >= 2) return true;
        if (/^(Lab|最热|最新|热门|推荐)$/i.test(lines[0] || '') && handleCount >= 2 && creativeActionCount >= 1) return true;
        return false;
    }

    function isUsablePromptText(value = '') {
        const text = cleanPromptText(value);
        return text.length >= 12 && !/^https?:\/\//i.test(text) && !isLikelyNonPromptListText(text);
    }

    function decodeUrlishText(value = '') {
        let text = decodeStructuredText(value);
        for (let index = 0; index < 3; index += 1) {
            try {
                const decoded = decodeURIComponent(text);
                if (!decoded || decoded === text) break;
                text = decoded;
            } catch (_) {
                break;
            }
        }
        return text
            .replace(/\\u0026/gi, '&')
            .replace(/&amp;/gi, '&');
    }

    function extractOriginalWorkUrlsFromText(value = '', baseUrl = getBaseUrl()) {
        const raw = decodeUrlishText(value);
        const urls = [];
        for (const match of raw.matchAll(ORIGINAL_WORK_URL_PATTERN)) {
            const url = toAbsoluteUrl(match[0], baseUrl);
            if (isOriginalWorkStatusUrl(url)) urls.push(url);
        }
        const queryUrlMatches = raw.match(/(?:url|u|text|target|redirect|href)=([^"'&<>\s)]+)/ig) || [];
        for (const entry of queryUrlMatches) {
            const encoded = entry.split('=').slice(1).join('=');
            const url = toAbsoluteUrl(decodeUrlishText(encoded), baseUrl);
            if (isOriginalWorkStatusUrl(url)) urls.push(url);
        }
        return urls;
    }

    function getNodeUrlCandidates(node, baseUrl = getBaseUrl()) {
        if (!node) return [];
        const values = [
            node.href,
            node.getAttribute?.('href'),
            node.getAttribute?.('data-url'),
            node.getAttribute?.('data-href'),
            node.getAttribute?.('data-link'),
            node.getAttribute?.('data-share-url'),
            node.getAttribute?.('aria-label'),
            node.getAttribute?.('title'),
            node.getAttribute?.('onclick'),
            node.outerHTML,
            node.textContent
        ];
        return values.flatMap((value) => extractOriginalWorkUrlsFromText(value, baseUrl));
    }

    function getPromptCopyAttributeText(node) {
        if (!node) return '';
        const value = getDatasetValue(node, [
            'prompt',
            'promptText',
            'clipboardText',
            'copyText',
            'textPrompt'
        ]) || [
            'data-clipboard-text',
            'data-copy-text',
            'aria-label',
            'title'
        ].map((name) => node.getAttribute?.(name)).find(Boolean);
        return isUsablePromptText(value) ? cleanPromptText(value) : '';
    }

    function extractPromptFromCopyControls(scope) {
        if (!scope?.querySelectorAll) return '';
        const nodes = Array.from(scope.querySelectorAll([
            '[data-prompt]',
            '[data-prompt-text]',
            '[data-clipboard-text]',
            '[data-copy-text]',
            'button',
            '[role="button"]'
        ].join(',')));
        for (const node of nodes) {
            const label = normalizeText([
                node.getAttribute?.('aria-label'),
                node.getAttribute?.('title'),
                node.innerText,
                node.textContent
            ].filter(Boolean).join(' '), 300);
            if (label && !/(复制\s*(Prompt|提示词)|Copy\s*Prompt)/i.test(label)) continue;
            const text = getPromptCopyAttributeText(node);
            if (text) return text;
        }
        return '';
    }

    function extractPromptFromLabeledSection(scope) {
        const text = normalizeText(scope?.innerText || scope?.textContent || '', 10000);
        if (!text) return '';
        const lines = text
            .split(/\n+/)
            .map((line) => normalizeText(line))
            .filter(Boolean);
        for (let index = 0; index < lines.length; index += 1) {
            if (!PROMPT_SECTION_LABEL_PATTERN.test(lines[index])) continue;
            const sectionLines = [];
            for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
                const line = lines[cursor];
                if (ACTION_PROMPT_LINE_PATTERN.test(line)) break;
                if (/^(作者|Author|收藏|图片|Image|链接|Link)\b/i.test(line)) break;
                sectionLines.push(line);
            }
            const cleaned = cleanPromptText(sectionLines.join('\n'));
            if (cleaned.length >= 12) return cleaned;
        }
        return '';
    }

    function extractPromptFromLooseVisibleText(scope) {
        const text = normalizeText(scope?.innerText || scope?.textContent || '', 16000);
        if (!text) return '';

        const labeledBlocks = [
            /(?:^|\n)\s*提示词\s*[:：]?\s*([\s\S]{12,4000}?)(?=\n\s*(?:展开|收起|更多相关内容|相关内容|使用\s*Prompt|用作参考图|下载图片|复制\s*Prompt|Copy\s*Prompt)\s*(?:\n|$)|$)/i,
            /(?:^|\n)\s*Prompt\s*[:：]?\s*([\s\S]{12,4000}?)(?=\n\s*(?:展开|收起|更多相关内容|相关内容|Use\s*Prompt|Use as reference image|Download|Copy\s*Prompt)\s*(?:\n|$)|$)/i
        ];

        for (const pattern of labeledBlocks) {
            const match = text.match(pattern);
            const prompt = cleanPromptText(match?.[1] || '');
            if (isUsablePromptText(prompt)) return prompt;
        }

        const compact = text.replace(/\s+/g, ' ').trim();
        const compactPatterns = [
            /提示词\s*[:：]?\s*([\s\S]{12,4000}?)(?=\s+(?:展开|收起|更多相关内容|相关内容|使用\s*Prompt|用作参考图|下载图片|复制\s*Prompt)(?:\s|$)|$)/i,
            /\bPrompt\s*[:：]\s*([\s\S]{12,4000}?)(?=\s+(?:展开|收起|更多相关内容|相关内容|Use\s*Prompt|Use as reference image|Download|Copy\s*Prompt)(?:\s|$)|$)/i
        ];
        for (const pattern of compactPatterns) {
            const match = compact.match(pattern);
            const prompt = cleanPromptText(match?.[1] || '');
            if (isUsablePromptText(prompt)) return prompt;
        }

        return '';
    }

    function extractPromptText(scope) {
        if (!scope?.querySelectorAll) return '';
        const datasetPrompt = getDatasetValue(scope, [
            'prompt',
            'promptText',
            'clipboardText',
            'copyText',
            'textPrompt'
        ]);
        if (datasetPrompt.length >= 12) return cleanPromptText(datasetPrompt);

        const richNodes = scope.querySelectorAll([
            '[data-prompt]',
            '[data-prompt-text]',
            '[data-clipboard-text]',
            '[data-copy-text]',
            'textarea',
            'pre',
            'code'
        ].join(','));
        for (const node of richNodes) {
            const value = getDatasetValue(node, ['prompt', 'promptText', 'clipboardText', 'copyText'])
                || node.value
                || node.textContent;
            const text = normalizeText(value);
            const cleaned = cleanPromptText(text);
            if (cleaned.length >= 12) return cleaned;
        }

        const copyControlPrompt = extractPromptFromCopyControls(scope);
        if (copyControlPrompt) return copyControlPrompt;

        if (!isDetailCollectionScope(scope)) {
            const structuredPrompt = findStructuredValue(scope, /prompt|positivePrompt|fullPrompt|promptText|description|caption/i);
            if (structuredPrompt) return cleanPromptText(structuredPrompt);
        }

        const sectionPrompt = extractPromptFromLabeledSection(scope);
        if (sectionPrompt) return sectionPrompt;

        const looseVisiblePrompt = extractPromptFromLooseVisibleText(scope);
        if (looseVisiblePrompt) return looseVisiblePrompt;

        const structuredPrompt = findStructuredValue(scope, /prompt|positivePrompt|fullPrompt|promptText|description|caption/i);
        if (structuredPrompt) return cleanPromptText(structuredPrompt);

        const text = normalizeText(scope.innerText || scope.textContent || '', 6000);
        const labeled = text.match(/(?:Prompt|提示词)\s*[:：]\s*([\s\S]{12,2000})/i);
        if (labeled) {
            return cleanPromptText(labeled[1]);
        }

        const longLine = text
            .split(/\n+/)
            .map((line) => normalizeText(line))
            .find((line) => line.length >= 60 && !/^https?:\/\//i.test(line) && !ACTION_PROMPT_LINE_PATTERN.test(line));
        return isLikelyNonPromptListText(longLine) ? '' : (longLine || '');
    }

    function isOriginalWorkStatusUrl(url = '') {
        try {
            const parsed = new URL(url);
            if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(parsed.hostname)) return false;
            const parts = parsed.pathname.split('/').filter(Boolean);
            if (parts.length >= 3 && /^status$/i.test(parts[1]) && /^\d{5,}$/.test(parts[2])) return true;
            if (parts.length >= 4 && parts[0] === 'i' && parts[1] === 'web' && /^status$/i.test(parts[2]) && /^\d{5,}$/.test(parts[3])) return true;
            return false;
        } catch (_) {
            return false;
        }
    }

    function getDetailUrl(scope, options = {}) {
        if (!scope?.querySelectorAll) return '';
        const baseUrl = options.baseUrl || getScopeBaseUrl(scope);
        const current = toAbsoluteUrl(baseUrl || global.location?.href || '');
        const currentHost = (() => {
            try {
                return new URL(current).hostname;
            } catch (_) {
                return '';
            }
        })();

        const links = Array.from(scope.querySelectorAll('a[href]'))
            .map((link) => toAbsoluteUrl(link.getAttribute('href'), baseUrl))
            .filter(Boolean)
            .filter((url) => {
                try {
                    const parsed = new URL(url);
                    return parsed.hostname === currentHost
                        && parsed.pathname !== '/'
                        && !IMAGE_URL_PATTERN.test(parsed.pathname);
                } catch (_) {
                    return false;
                }
            });

        return links[0] || (current && new URL(current).pathname !== '/' ? current : '');
    }

    function getOriginalWorkUrl(scope, options = {}) {
        if (!scope?.querySelectorAll) return '';
        const baseUrl = options.baseUrl || getScopeBaseUrl(scope);
        const links = Array.from(scope.querySelectorAll([
            'a[href]',
            'button',
            '[role="button"]',
            '[aria-label]',
            '[title]',
            '[data-url]',
            '[data-href]',
            '[data-link]',
            '[data-share-url]'
        ].join(',')))
            .flatMap((node) => getNodeUrlCandidates(node, baseUrl))
            .filter((url) => isOriginalWorkStatusUrl(url));
        if (links[0]) return links[0];

        const structuredUrl = findStructuredValue(
            scope,
            /url|href|link|source|twitter|x|sameAs/i,
            /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^"'<\s)]+/i
        );
        const absoluteStructuredUrl = toAbsoluteUrl(structuredUrl, baseUrl);
        return isOriginalWorkStatusUrl(absoluteStructuredUrl) ? absoluteStructuredUrl : '';
    }

    function safeHostname(url = '') {
        try {
            return new URL(url).hostname;
        } catch (_) {
            return '';
        }
    }

    function normalizeAuthorHandle(value = '') {
        const match = normalizeText(value, 200).match(AUTHOR_HANDLE_PATTERN) || normalizeText(value, 200).match(/^([a-zA-Z0-9_]{1,20})$/);
        return match?.[1] ? `@${match[1]}` : '';
    }

    function getAuthorHandleFromUrl(value = '') {
        const url = toAbsoluteUrl(value);
        if (!url) return '';
        try {
            const parsed = new URL(url);
            if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(parsed.hostname)) return '';
            const parts = parsed.pathname.split('/').filter(Boolean);
            const first = parts[0] || '';
            if (!first || ['i', 'intent', 'share', 'home', 'search'].includes(first.toLowerCase())) return '';
            return normalizeAuthorHandle(first);
        } catch (_) {
            return '';
        }
    }

    function isAuthorProfileUrl(value = '', expectedHandle = '') {
        const handle = getAuthorHandleFromUrl(value);
        if (!handle) return false;
        if (isOriginalWorkStatusUrl(value)) return false;
        const expected = normalizeAuthorHandle(expectedHandle);
        return !expected || handle.toLowerCase() === expected.toLowerCase();
    }

    function getAuthorProfileLinks(scope, expectedHandle = '') {
        if (!scope?.querySelectorAll) return [];
        return Array.from(scope.querySelectorAll('a[href]'))
            .filter((link) => isAuthorProfileUrl(link.href || link.getAttribute?.('href') || '', expectedHandle));
    }

    function getAuthorHandle(scope, originalWorkUrl = '') {
        const explicit = getDatasetValue(scope, ['authorHandle', 'authorId', 'handle']);
        const normalizedExplicit = normalizeAuthorHandle(explicit);
        if (normalizedExplicit) return normalizedExplicit;
        try {
            const parts = new URL(originalWorkUrl).pathname.split('/').filter(Boolean);
            if (parts[0] && !['i', 'intent', 'share'].includes(parts[0].toLowerCase())) {
                return `@${parts[0].replace(/^@/, '')}`;
            }
        } catch (_) {
            // Fall back to the visible author block below.
        }
        const profileLink = getAuthorProfileLinks(scope)[0];
        const fromProfile = getAuthorHandleFromUrl(profileLink?.href || profileLink?.getAttribute?.('href') || '');
        if (fromProfile) return fromProfile;
        const fromText = normalizeText(scope?.innerText || scope?.textContent || '', 4000).match(AUTHOR_HANDLE_PATTERN);
        if (fromText?.[1]) return `@${fromText[1]}`;
        return '';
    }

    function getAuthorName(scope, expectedHandle = '') {
        const explicit = getDatasetValue(scope, ['authorName', 'creatorName', 'nickname']);
        if (explicit) return normalizeAuthorName(explicit);
        const fromProfileLink = getAuthorNameFromProfileLink(scope, expectedHandle);
        if (fromProfileLink) return fromProfileLink;
        const fromAuthorBlock = getAuthorNameNearHandle(scope, expectedHandle);
        if (fromAuthorBlock) return fromAuthorBlock;
        const fromTopLines = getAuthorNameFromTopLines(scope, expectedHandle);
        if (fromTopLines) return fromTopLines;
        const structured = findStructuredValue(scope, /authorName|creatorName|displayName|nickname|screenName/i);
        if (structured) {
            const cleanedStructured = normalizeAuthorName(structured);
            if (cleanedStructured) return cleanedStructured;
        }
        const selectors = [
            '[data-author-name]',
            '[data-creator-name]',
            '[data-nickname]',
            '[class*="author" i] [class*="name" i]',
            '[class*="creator" i] [class*="name" i]',
            '[class*="nickname" i]',
            '[aria-label*="author" i]'
        ];
        for (const selector of selectors) {
            const authorNode = scope.querySelector?.(selector);
            const text = normalizeAuthorName(authorNode?.innerText || authorNode?.textContent || authorNode?.getAttribute?.('aria-label') || '');
            if (text) return text;
        }
        return '';
    }

    function getAuthorNameFromProfileLink(scope, expectedHandle = '') {
        const links = getAuthorProfileLinks(scope, expectedHandle);
        for (const link of links) {
            const text = normalizeAuthorName(link.innerText || link.textContent || link.getAttribute?.('aria-label') || '');
            if (text) return text;
        }
        return '';
    }

    function getVisibleLines(node, maxLength = 900) {
        return normalizeText(node?.innerText || node?.textContent || '', maxLength)
            .split(/\n+/)
            .map((line) => normalizeText(line, 160))
            .filter(Boolean);
    }

    function lineMatchesAuthorHandle(line = '', expectedHandle = '') {
        const expected = normalizeAuthorHandle(expectedHandle);
        if (expected) return normalizeAuthorHandle(line).toLowerCase() === expected.toLowerCase();
        return AUTHOR_HANDLE_PATTERN.test(line);
    }

    function getAuthorNameFromLines(lines = [], expectedHandle = '') {
        const handleIndex = lines.findIndex((line) => lineMatchesAuthorHandle(line, expectedHandle));
        if (handleIndex < 0) return '';
        const candidates = [
            ...lines.slice(Math.max(0, handleIndex - 3), handleIndex).reverse()
        ];
        for (const line of candidates) {
            const name = normalizeAuthorName(line);
            if (name) return name;
        }
        return '';
    }

    function getAuthorNameFromTopLines(scope, expectedHandle = '') {
        const lines = getVisibleLines(scope, 2400);
        const handleIndex = lines.findIndex((line) => lineMatchesAuthorHandle(line, expectedHandle));
        if (handleIndex >= 0) {
            const start = Math.max(0, handleIndex - 5);
            for (let index = handleIndex - 1; index >= start; index -= 1) {
                const name = normalizeAuthorName(lines[index]);
                if (name) return name;
            }
            return '';
        }
        const detailMetadataIndex = lines.findIndex((line) => /^(?:\d+\s*)?(?:收藏|喜欢|点赞)$|^(?:复制\s*(?:Prompt|提示词)|Copy\s*Prompt)$/i.test(line));
        if (detailMetadataIndex <= 0) return '';
        for (let index = 0; index < detailMetadataIndex; index += 1) {
            const name = normalizeAuthorName(lines[index]);
            if (name) return name;
        }
        return '';
    }

    function getAuthorNameNearHandle(scope, expectedHandle = '') {
        if (!scope?.querySelectorAll) return '';
        const nodes = Array.from(scope.querySelectorAll('a, button, span, div, p, h1, h2, h3, strong'));
        for (const node of nodes) {
            const nodeText = normalizeText(node.innerText || node.textContent || '', 400);
            if (!lineMatchesAuthorHandle(nodeText, expectedHandle) && !AUTHOR_HANDLE_PATTERN.test(nodeText)) continue;
            let current = node;
            for (let depth = 0; current && depth < 4; depth += 1) {
                const name = getAuthorNameFromLines(getVisibleLines(current, 900), expectedHandle);
                if (name) return name;
                current = current.parentElement;
            }
        }
        return '';
    }

    function normalizeAuthorName(value = '') {
        const lines = normalizeText(value, 400)
            .split(/\n+/)
            .map((line) => normalizeText(line, 160))
            .filter(Boolean)
            .map((line) => line.replace(/[↗→]+/g, '').trim())
            .filter(Boolean)
            .filter((line) => !line.startsWith('@'))
            .filter((line) => !/^(Web\s*Page|WebPage)$/i.test(line))
            .filter((line) => !AUTHOR_LINE_NOISE_PATTERN.test(line))
            .filter((line) => !/^(?:Model|模型)\s*[:：]\s*[^\n]{1,48}$/i.test(line))
            .filter((line) => !ACTION_PROMPT_LINE_PATTERN.test(line))
            .filter((line) => !/^(Prompt|提示词|收藏|喜欢|点赞|作品|图片|Image|Author|作者)\s*[:：]?$/i.test(line))
            .filter((line) => !/^\d+$/.test(line))
            .filter((line) => !/^[\s{}[\](),.:;'"`]+$/.test(line))
            .filter((line) => !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(line))
            .filter((line) => !/^https?:\/\//i.test(line))
            .filter((line) => !ENGAGEMENT_TEXT_PATTERN.test(line))
            .filter((line) => !AUTHOR_TITLE_NOISE_PATTERN.test(line))
            .filter((line) => line.length <= 48)
            .filter((line) => !(line.length > 40 && /\b(create|design|masterpiece|premium|product|poster|advertising|advertisement|composition|cinematic|realistic|futuristic|style)\b/i.test(line)));
        return lines[0] || '';
    }

    function isCollapsedPromptText(value = '') {
        const text = normalizeText(value, 800);
        return /(\.\.\.|…)\s*$/.test(text) || text.length === PROMPT_PREVIEW_HARD_LIMIT;
    }

    function preferDetailValue(currentValue = '', nextValue = '') {
        const current = normalizeText(currentValue);
        const next = normalizeText(nextValue);
        if (!next) return current;
        if (!current) return next;
        if (isCollapsedPromptText(current) && next.length > current.length) return next;
        if (next.length > current.length && current.length < 160) return next;
        return current;
    }

    function extractLongNumericId(value = '') {
        const match = normalizeText(value, 4000).match(LONG_NUMERIC_ID_PATTERN);
        return match?.[0] || '';
    }

    function getOriginalStatusId(scope, detailUrl = '', options = {}) {
        const explicit = getDatasetValue(scope, [
            'statusId',
            'tweetId',
            'twitterId',
            'xStatusId',
            'originalWorkId',
            'postId'
        ]);
        const explicitId = extractLongNumericId(explicit);
        if (explicitId) return explicitId;

        const urls = [
            detailUrl,
            options.expectedDetailUrl,
            options.baseUrl,
            getScopeBaseUrl(scope)
        ].filter(Boolean);
        for (const url of urls) {
            const id = extractLongNumericId(url);
            if (id) return id;
        }
        const raw = decodeUrlishText([
            scope?.innerText,
            scope?.textContent,
            Array.from(scope?.querySelectorAll?.('[href], [data-url], [data-href], [onclick], [aria-label], [title]') || [])
                .map((node) => [
                    node.href,
                    node.getAttribute?.('href'),
                    node.getAttribute?.('data-url'),
                    node.getAttribute?.('data-href'),
                    node.getAttribute?.('onclick'),
                    node.getAttribute?.('aria-label'),
                    node.getAttribute?.('title')
                ].filter(Boolean).join(' '))
                .join(' ')
        ].filter(Boolean).join(' '));
        const idFromText = extractLongNumericId(raw);
        if (idFromText) return idFromText;
        return '';
    }

    function buildOriginalWorkUrlFromHandleAndStatusId(authorHandle = '', statusId = '') {
        const handle = normalizeAuthorHandle(authorHandle);
        const id = extractLongNumericId(statusId);
        if (!handle || !id) return '';
        return `https://x.com/${handle.replace(/^@/, '')}/status/${id}`;
    }

    function getCachedHoverAuthorIdentity(...values) {
        const cache = global.__FatherKeyMeigenHoverAuthors;
        if (!(cache instanceof Map)) return null;
        const keys = values.flatMap((value) => {
            const text = normalizeText(value, 4000);
            return [text, extractLongNumericId(text)].filter(Boolean);
        });
        for (const key of keys) {
            const cached = cache.get(String(key).toLowerCase());
            const name = normalizeAuthorName(cached?.name || '');
            const handle = normalizeAuthorHandle(cached?.handle || '');
            if (name && handle) return { name, handle };
        }
        return null;
    }

    function getStatusIdFromImageUrl(value = '') {
        const text = decodeUrlishText(value);
        const match = text.match(/\/tweets\/(\d{12,25})(?:\/|$)/i);
        return match?.[1] || '';
    }

    function getStatusIdFromImageUrls(imageUrls = []) {
        for (const url of Array.isArray(imageUrls) ? imageUrls : []) {
            const id = getStatusIdFromImageUrl(url);
            if (id) return id;
        }
        return '';
    }

    function isLikelyUnboundMeigenCommunityImageUrl(value = '') {
        const decoded = decodeUrlishText(value).toLowerCase();
        return /(?:^|\/\/)images\.meigen\.ai\/generations\/[^?#\s]+\/community_[^/?#\s]+\.(?:avif|webp|png|jpe?g)/i.test(decoded)
            || /\/generations\/[^?#\s]+\/community_[^/?#\s]+\.(?:avif|webp|png|jpe?g)/i.test(decoded);
    }

    function isCommunityDetailUrl(value = '') {
        try {
            const parsed = new URL(String(value || ''), getBaseUrl());
            return /\/prompt\/community_[a-z0-9-]+\/?$/i.test(parsed.pathname);
        } catch (_) {
            return /\/prompt\/community_[a-z0-9-]+/i.test(String(value || ''));
        }
    }

    function isImageUrlTrustedForStatus(value = '', targetStatusId = '') {
        const target = extractLongNumericId(targetStatusId);
        if (!target) return true;
        const imageStatusId = getStatusIdFromImageUrl(value);
        if (imageStatusId) return imageStatusId === target;
        return !isLikelyUnboundMeigenCommunityImageUrl(value);
    }

    function getTargetStatusIdForDetail({
        expectedDetailUrl = '',
        detailUrl = '',
        originalWorkUrl = '',
        baseUrl = '',
        options = {}
    } = {}) {
        return extractLongNumericId(expectedDetailUrl)
            || extractLongNumericId(detailUrl)
            || extractLongNumericId(options.expectedDetailUrl || '')
            || extractLongNumericId(options.expectedOriginalWorkUrl || '')
            || extractLongNumericId(originalWorkUrl)
            || extractLongNumericId(baseUrl);
    }

    function filterDetailImageUrlsByStatus(imageUrls = [], targetStatusId = '') {
        if (!targetStatusId || !Array.isArray(imageUrls) || !imageUrls.length) return imageUrls;
        return imageUrls.filter((url) => isImageUrlTrustedForStatus(url, targetStatusId));
    }

    function filterDetailImageUrlsByIdentity(imageUrls = [], {
        detailUrl = '',
        targetStatusId = ''
    } = {}) {
        if (!Array.isArray(imageUrls) || !imageUrls.length) return [];
        if (isCommunityDetailUrl(detailUrl)) {
            return imageUrls.filter((url) => !getStatusIdFromImageUrl(url));
        }
        return filterDetailImageUrlsByStatus(imageUrls, targetStatusId);
    }

    function getTweetImageSequenceInfo(value = '') {
        const decoded = decodeUrlishText(value);
        const directMatch = decoded.match(/(https?:\/\/[^\s"'<>?)]*?\/tweets\/(\d{12,25})\/)(\d+)(\.[a-z0-9]+)(?:[?#][^\s"'<>)]*)?/i);
        if (directMatch) {
            return {
                prefix: directMatch[1],
                statusId: directMatch[2],
                index: Number.parseInt(directMatch[3] || '0', 10),
                suffix: directMatch[4],
                url: `${directMatch[1]}${directMatch[3]}${directMatch[4]}`
            };
        }
        const relativeMatch = decoded.match(/(\/tweets\/(\d{12,25})\/)(\d+)(\.[a-z0-9]+)(?:[?#][^\s"'<>)]*)?/i);
        if (!relativeMatch) return null;
        return {
            prefix: relativeMatch[1],
            statusId: relativeMatch[2],
            index: Number.parseInt(relativeMatch[3] || '0', 10),
            suffix: relativeMatch[4],
            url: `${relativeMatch[1]}${relativeMatch[3]}${relativeMatch[4]}`
        };
    }

    function expandTweetImageSequence(imageUrls = [], expectedCount = 0) {
        const limit = Number(expectedCount || 0);
        if (!Array.isArray(imageUrls) || imageUrls.length >= limit || limit <= 1) return imageUrls;
        const sequenceEntries = imageUrls
            .map((url) => ({ url, info: getTweetImageSequenceInfo(url) }))
            .filter((entry) => entry.info && Number.isFinite(entry.info.index));
        if (!sequenceEntries.length) return imageUrls;
        const seed = sequenceEntries[0].info;
        const byIndex = new Map();
        for (const entry of sequenceEntries) {
            if (entry.info.statusId !== seed.statusId) continue;
            if (entry.info.index < 0 || entry.info.index >= limit) continue;
            if (!byIndex.has(entry.info.index)) byIndex.set(entry.info.index, entry.url);
        }
        const ordered = [];
        for (let index = 0; index < Math.min(limit, MAX_IMAGES_PER_ITEM); index += 1) {
            ordered.push(byIndex.get(index) || `${seed.prefix}${index}${seed.suffix}`);
        }
        const nonSequenceUrls = imageUrls.filter((url) => !getTweetImageSequenceInfo(url));
        return uniqueBy([...ordered, ...nonSequenceUrls], (url) => String(url || '').toLowerCase())
            .slice(0, limit);
    }

    function buildMeigenDetailUrlFromStatusId(statusId = '', baseUrl = getBaseUrl()) {
        const id = extractLongNumericId(statusId);
        if (!id) return '';
        try {
            const parsed = new URL(baseUrl || getBaseUrl(), getBaseUrl());
            const host = parsed.hostname.toLowerCase();
            const origin = host === 'www.meigen.ai' || host === 'meigen.ai'
                ? parsed.origin
                : 'https://www.meigen.ai';
            return `${origin}/prompt/${id}`;
        } catch (_) {
            return `https://www.meigen.ai/prompt/${id}`;
        }
    }

    function getRawArtworkImageNodeCount(scope, options = {}) {
        if (!scope?.querySelectorAll) return 0;
        return Array.from(scope.querySelectorAll('img') || [])
            .filter((node) => isLikelyArtworkImageNode(node, scope))
            .length;
    }

    function isLikelyListContainerScope(scope, options = {}) {
        if (!scope?.querySelectorAll) return false;
        if (isDetailCollectionScope(scope, options)) return false;
        if (isPageShellScope(scope)) return true;

        const baseUrl = options.baseUrl || getScopeBaseUrl(scope);
        const imageNodeCount = getRawArtworkImageNodeCount(scope, options);
        const detailLinkCount = getDetailLinkUrls(scope, baseUrl).length;
        const text = normalizeText(scope.innerText || scope.textContent || '', 3200);
        const rect = typeof scope.getBoundingClientRect === 'function' ? scope.getBoundingClientRect() : {};
        const width = Number(rect.width || 0);

        if (detailLinkCount > 1) return true;
        if (detailLinkCount !== 1 && imageNodeCount >= 3) return true;
        if (detailLinkCount !== 1 && imageNodeCount >= 2 && width >= 640) return true;
        if (detailLinkCount !== 1 && imageNodeCount >= 2 && text.length >= 1600) return true;
        return false;
    }

    function isViableListItemScope(scope, options = {}) {
        if (!scope?.querySelectorAll) return false;
        if (isPageShellScope(scope)) return false;
        if (isLikelyListContainerScope(scope, options)) return false;
        const baseUrl = options.baseUrl || getScopeBaseUrl(scope);
        return getRawArtworkImageNodeCount(scope, options) > 0
            || getDetailLinkUrls(scope, baseUrl).length > 0;
    }

    function scoreListItemScope(scope, options = {}) {
        if (!isViableListItemScope(scope, options)) return -Infinity;
        const baseUrl = options.baseUrl || getScopeBaseUrl(scope);
        const text = normalizeText(scope.innerText || scope.textContent || '', 2600);
        const imageNodeCount = getRawArtworkImageNodeCount(scope, options);
        const detailLinkCount = getDetailLinkUrls(scope, baseUrl).length;
        const tagName = String(scope.tagName || scope.nodeName || '').toLowerCase();
        let score = 0;

        if (scope.matches?.(ITEM_SCOPE_SELECTOR)) score += 28;
        if (detailLinkCount === 1) score += 70;
        else if (detailLinkCount <= 0) score += 5;
        if (imageNodeCount >= 1 && imageNodeCount <= 4) score += 35 + imageNodeCount;
        if (text.length >= 12) score += 30;
        if (text.length >= 60) score += 12;
        if (text.length > 1800) score -= 20;
        if (parseFavoriteCount(text) > 0) score += 18;
        if (AUTHOR_HANDLE_PATTERN.test(text)) score += 8;
        if (tagName === 'a' && text.length < 12) score -= 18;
        return score;
    }

    function findItemScopeFromImage(image, options = {}) {
        const linkScope = image.closest?.('a[href]');
        const candidates = [];
        let node = image;
        for (let depth = 0; node && depth < 7; depth += 1) {
            const score = scoreListItemScope(node, options);
            if (Number.isFinite(score)) {
                candidates.push({ scope: node, score, depth });
            }
            if (node.matches?.(ITEM_SCOPE_SELECTOR) && score >= 90) {
                return node;
            }
            if (isLikelyListContainerScope(node, options)) break;
            node = node.parentElement;
        }
        if (linkScope && !candidates.some((entry) => entry.scope === linkScope)) {
            const score = scoreListItemScope(linkScope, options);
            if (Number.isFinite(score)) candidates.push({ scope: linkScope, score, depth: 0 });
        }
        candidates.sort((a, b) => (b.score - a.score) || (b.depth - a.depth));
        return candidates[0]?.scope || linkScope || image.parentElement || image;
    }

    function getCandidateScopes(root, options = {}) {
        const documentRef = root?.querySelectorAll ? root : global.document;
        if (!documentRef?.querySelectorAll) return [];

        if (isDetailCollectionScope(documentRef, options)) {
            const detailScopes = [
                documentRef.querySelector?.('[role="dialog"]'),
                documentRef.querySelector?.('main'),
                documentRef.body,
                documentRef
            ].filter(Boolean);
            return uniqueBy(detailScopes, (scope) => {
                if (!scope.__fatherKeyCollectorId) {
                    scope.__fatherKeyCollectorId = Math.random().toString(36).slice(2);
                }
                return scope.__fatherKeyCollectorId;
            }).map((scope) => {
                const imageCount = collectImageUrls(scope, options).length;
                const promptText = extractPromptText(scope);
                const originalWorkUrl = getOriginalWorkUrl(scope, options);
                const authorHandle = getAuthorHandle(scope, originalWorkUrl);
                const structuredCandidate = getBestStructuredCandidate(scope, options);
                const score = (promptText ? 120 : 0)
                    + (originalWorkUrl ? 45 : 0)
                    + (authorHandle ? 30 : 0)
                    + (structuredCandidate?.promptText ? 80 : 0)
                    + (structuredCandidate?.imageUrls?.length ? 35 : 0)
                    + Math.min(30, imageCount * 6)
                    - (RELATED_CONTEXT_PATTERN.test(normalizeText(scope.innerText || scope.textContent || '', 1600)) ? 15 : 0);
                return {
                    scope,
                    score,
                    hasData: Boolean(imageCount || promptText || originalWorkUrl || authorHandle || structuredCandidate)
                };
            })
                .filter((entry) => entry.hasData)
                .sort((a, b) => b.score - a.score)
                .map((entry) => entry.scope)
                .slice(0, 4);
        }

        const scopes = [];
        documentRef.querySelectorAll('img').forEach((image) => {
            const scope = findItemScopeFromImage(image, options);
            if (scope) scopes.push(scope);
        });

        return uniqueBy(scopes, (scope) => {
            if (!scope.__fatherKeyCollectorId) {
                scope.__fatherKeyCollectorId = Math.random().toString(36).slice(2);
            }
            return scope.__fatherKeyCollectorId;
        })
            .filter((scope) => !isLikelyListContainerScope(scope, options))
            .sort((a, b) => getNodeDocumentOrderScore(a) - getNodeDocumentOrderScore(b))
            .slice(0, MAX_ITEMS);
    }

    function normalizeFavoriteRange(options = {}) {
        const min = Number.parseInt(String(options.minFavorites ?? options.min_favorites ?? ''), 10);
        const max = Number.parseInt(String(options.maxFavorites ?? options.max_favorites ?? ''), 10);
        return {
            min: Number.isFinite(min) && min > 0 ? min : 0,
            max: Number.isFinite(max) && max > 0 ? max : 0
        };
    }

    function itemMatchesFavoriteRange(item = {}, options = {}) {
        const { min, max } = normalizeFavoriteRange(options);
        const count = Number(item.favorite_count || 0);
        if (min > 0 && count < min) return false;
        if (max > 0 && count > max) return false;
        return true;
    }

    function isUnresolvablePlaceholderItem({
        detailUrl = '',
        promptText = '',
        originalWorkUrl = '',
        imageUrls = []
    } = {}) {
        return !String(detailUrl || '').trim()
            && !String(promptText || '').trim()
            && !String(originalWorkUrl || '').trim()
            && Array.isArray(imageUrls)
            && imageUrls.length > 0
            && imageUrls.every((url) => isLikelyUnboundMeigenCommunityImageUrl(url));
    }

    function buildSourceItemId(scope, detailUrl, imageUrls, index, fallbackId = '') {
        const explicit = getDatasetValue(scope, ['id', 'itemId', 'promptId', 'postId']);
        if (explicit) return explicit;
        if (fallbackId) return fallbackId;
        const source = detailUrl || imageUrls[0] || `${SOURCE}-${index}`;
        let hash = 0;
        for (let i = 0; i < source.length; i += 1) {
            hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
        }
        return `${SOURCE}-${Math.abs(hash)}`;
    }

    function normalizeCollectedItem(scope, index = 0, options = {}) {
        const baseUrl = options.baseUrl || getScopeBaseUrl(scope);
        const expectedDetailUrl = toAbsoluteUrl(options.expectedDetailUrl || '', baseUrl);
        const detailContext = Boolean(expectedDetailUrl || isDetailPageUrl(options.baseUrl || getScopeBaseUrl(scope)));
        const scopeDetailUrl = expectedDetailUrl || getDetailUrl(scope, options) || '';
        const initialImageUrls = collectImageUrls(scope, options);
        const initialImageStatusId = getStatusIdFromImageUrls(initialImageUrls);
        const initialOriginalWorkUrl = getOriginalWorkUrl(scope, options);
        const initialAuthorHandle = getAuthorHandle(scope, initialOriginalWorkUrl);
        const structuredCandidate = getBestStructuredCandidate(scope, {
            ...options,
            baseUrl,
            expectedDetailUrl: scopeDetailUrl || options.expectedDetailUrl || '',
            detailUrl: scopeDetailUrl,
            expectedOriginalWorkUrl: initialOriginalWorkUrl || '',
            expectedImageUrls: initialImageUrls,
            expectedAuthorHandle: initialAuthorHandle,
            detailOnly: Boolean(options.detailOnly || expectedDetailUrl || isDetailPageUrl(baseUrl))
        });
        let detailUrl = scopeDetailUrl || structuredCandidate?.detailUrl || '';
        const communityDetail = isCommunityDetailUrl(expectedDetailUrl || detailUrl);
        const optionExpectedDetailCount = detailContext
            ? normalizeExpectedDetailImageCount(options.expectedDetailImageCount || options.detailExpectedCount || 0)
            : 0;
        const trustedDetailExpectedCount = detailContext
            ? (getTrustedDetailArtworkExpectedCount(scope) || optionExpectedDetailCount)
            : 0;
        const explicitExpectedCount = detailContext
            ? (trustedDetailExpectedCount || 1)
            : getDetailArtworkExpectedCount(scope);
        const sequenceExpectedCount = trustedDetailExpectedCount;
        let originalWorkUrl = initialOriginalWorkUrl || structuredCandidate?.originalWorkUrl || '';
        const candidateStatusId = communityDetail
            ? ''
            : (structuredCandidate?.statusId
                || getStatusIdFromImageUrls(structuredCandidate?.imageUrls || [])
                || extractLongNumericId(originalWorkUrl));
        const targetStatusId = getTargetStatusIdForDetail({
            expectedDetailUrl,
            detailUrl,
            originalWorkUrl,
            baseUrl,
            options
        }) || candidateStatusId;
        const structuredImageUrls = detailContext && explicitExpectedCount <= 0
            ? []
            : filterDetailImageUrlsByIdentity(structuredCandidate?.imageUrls || [], {
                detailUrl: expectedDetailUrl || detailUrl,
                targetStatusId
            });
        const combinedImageUrls = dedupeImageUrlsByArtwork([
            ...initialImageUrls,
            ...structuredImageUrls
        ], MAX_IMAGES_PER_ITEM);
        const inferredListExpectedCount = !detailContext && targetStatusId
            ? Math.max(0, ...combinedImageUrls
                .map((url) => getTweetImageSequenceInfo(url))
                .filter((info) => info?.statusId === targetStatusId && Number.isFinite(info.index))
                .map((info) => info.index + 1))
            : 0;
        const expectedCount = explicitExpectedCount
            || (detailContext ? 0 : Math.min(MAX_IMAGES_PER_ITEM, inferredListExpectedCount || structuredImageUrls.length || 0));
        const imageLimit = expectedCount > 0 ? expectedCount : (detailContext ? 1 : MAX_IMAGES_PER_ITEM);
        let imageUrls = combinedImageUrls.slice(0, imageLimit);
        imageUrls = dedupeImageUrlsByArtwork(expandTweetImageSequence(imageUrls, sequenceExpectedCount), imageLimit);
        imageUrls = filterDetailImageUrlsByIdentity(imageUrls, {
            detailUrl: expectedDetailUrl || detailUrl,
            targetStatusId
        });
        const filteredImageStatusId = getStatusIdFromImageUrls(imageUrls);
        const imageStatusId = filteredImageStatusId
            || (!targetStatusId || initialImageStatusId === targetStatusId ? initialImageStatusId : '');
        if (!detailUrl && imageStatusId && !options.detailOnly) {
            detailUrl = buildMeigenDetailUrlFromStatusId(imageStatusId, baseUrl);
        }

        if (expectedDetailUrl && detailUrl && !sameDetailUrl(detailUrl, expectedDetailUrl)) return null;
        const visiblePromptText = extractPromptText(scope);
        const structuredPromptText = structuredCandidate?.promptText || '';
        const structuredMatchesDetail = Boolean(
            structuredPromptText
            && detailUrl
            && structuredCandidate?.detailUrl
            && sameDetailUrl(detailUrl, structuredCandidate.detailUrl)
        );
        const promptText = detailContext
            ? (visiblePromptText || (structuredMatchesDetail ? structuredPromptText : ''))
            : (structuredMatchesDetail
                ? structuredPromptText
                : preferDetailValue(visiblePromptText, structuredPromptText));
        const hoverAuthor = getCachedHoverAuthorIdentity(
            scopeDetailUrl,
            detailUrl,
            originalWorkUrl,
            targetStatusId,
            structuredCandidate?.sourceItemId
        );
        const authorHandle = hoverAuthor?.handle
            || initialAuthorHandle
            || getAuthorHandle(scope, originalWorkUrl)
            || structuredCandidate?.authorHandle
            || '';
        if (!originalWorkUrl) {
            const statusId = structuredCandidate?.statusId || getOriginalStatusId(scope, detailUrl, options) || imageStatusId;
            originalWorkUrl = buildOriginalWorkUrlFromHandleAndStatusId(
                authorHandle,
                statusId
            );
        }
        const visibleAuthorName = normalizeAuthorName(getAuthorName(scope, authorHandle));
        const authorName = hoverAuthor?.name
            || visibleAuthorName
            || normalizeAuthorName(structuredCandidate?.authorName || '');
        if (isUnresolvablePlaceholderItem({ detailUrl, promptText, originalWorkUrl, imageUrls })) return null;
        if (!imageUrls.length && !detailContext && !communityDetail) return null;
        if (!imageUrls.length && !promptText && !originalWorkUrl && !authorName && !authorHandle) return null;
        const imageCountIsComplete = expectedCount > 0
            ? imageUrls.length >= expectedCount
            : Boolean(detailContext && imageUrls.length);
        const authoritativeExpectedCount = expectedCount
            || (detailContext && imageUrls.length ? imageUrls.length : 0);

        return {
            source: SOURCE,
            source_item_id: buildSourceItemId(scope, detailUrl, imageUrls, index, structuredCandidate?.sourceItemId || ''),
            source_page_url: detailUrl,
            original_work_url: originalWorkUrl,
            author_name: authorName,
            author_handle: authorHandle,
            author_identity_source: hoverAuthor?.name
                ? 'hover'
                : (visibleAuthorName ? (detailContext ? 'detail' : 'hover') : 'structured'),
            favorite_count: Number(options.detailFavoriteCount || options.expectedFavoriteCount || 0) > 0
                ? Number(options.detailFavoriteCount || options.expectedFavoriteCount || 0)
                : Math.max(
                    parseFavoriteCount(scope.innerText || scope.textContent || ''),
                    Number(structuredCandidate?.favoriteCount || 0)
                ),
            prompt_text: promptText,
            expected_image_count: authoritativeExpectedCount,
            detail_expected_count_authoritative: Boolean(detailContext && authoritativeExpectedCount > 0),
            detail_image_count_authoritative: Boolean(detailContext && authoritativeExpectedCount > 0 && imageCountIsComplete),
            image_sources: imageUrls.map((url) => ({ url }))
        };
    }

    function mergeCollectedItems(items = []) {
        const grouped = new Map();
        for (const item of items) {
            if (!item) continue;
            const itemImages = Array.isArray(item.image_sources) ? item.image_sources : [];
            const promptKey = normalizeText(item.prompt_text || '').toLowerCase();
            const key = item.source_page_url || item.original_work_url || promptKey || item.source_item_id;
            if (!key) continue;
            const current = grouped.get(key)
                || Array.from(grouped.values()).find((entry) => {
                    return item.source_item_id
                        && entry.source_item_id
                        && String(entry.source_item_id) === String(item.source_item_id);
                });
            if (!current) {
                const expectedCount = Number(item.expected_image_count || 0);
                grouped.set(key, {
                    ...item,
                    image_sources: dedupeImageUrlsByArtwork(itemImages.map((entry) => entry?.url), expectedCount > 0 ? expectedCount : MAX_IMAGES_PER_ITEM)
                        .map((url) => ({ url }))
                        .slice(0, expectedCount > 0 ? expectedCount : MAX_IMAGES_PER_ITEM)
                });
                continue;
            }

            if (item.prompt_complete && item.prompt_text) {
                current.prompt_text = item.prompt_text;
                current.prompt_complete = true;
            } else if (!current.prompt_complete) {
                current.prompt_text = preferDetailValue(current.prompt_text, item.prompt_text);
            }
            current.source_page_url = current.source_page_url || item.source_page_url || '';
            current.original_work_url = current.original_work_url || item.original_work_url || '';
            const currentAuthorName = normalizeAuthorName(current.author_name);
            const itemAuthorName = normalizeAuthorName(item.author_name);
            const currentAuthorSource = String(current.author_identity_source || '');
            const itemAuthorSource = String(item.author_identity_source || '');
            if (itemAuthorSource === 'hover' && currentAuthorSource !== 'hover') {
                current.author_name = itemAuthorName;
                current.author_handle = item.author_handle || current.author_handle || '';
                current.author_identity_source = 'hover';
            } else if (!currentAuthorName || (currentAuthorSource !== 'hover' && itemAuthorName)) {
                current.author_name = itemAuthorName || currentAuthorName;
                current.author_identity_source = itemAuthorName ? itemAuthorSource : currentAuthorSource;
            }
            if (current.author_identity_source !== 'hover') {
                current.author_handle = current.author_handle || item.author_handle || '';
            }
            current.favorite_count = Math.max(current.favorite_count || 0, item.favorite_count || 0);
            const itemExpectedCount = Number(item.expected_image_count || 0);
            const currentExpectedCount = Number(current.expected_image_count || 0);
            const detailCountIsAuthoritative = Boolean(item.detail_image_count_authoritative && itemExpectedCount > 0);
            const detailExpectedCountIsAuthoritative = Boolean(item.detail_expected_count_authoritative && itemExpectedCount > 0);
            current.expected_image_count = detailCountIsAuthoritative || detailExpectedCountIsAuthoritative ? itemExpectedCount : Math.max(
                currentExpectedCount,
                itemExpectedCount
            );
            current.detail_expected_count_authoritative = Boolean(current.detail_expected_count_authoritative || detailExpectedCountIsAuthoritative);
            current.detail_image_count_authoritative = Boolean(current.detail_image_count_authoritative || detailCountIsAuthoritative);
            const imageLimit = current.expected_image_count > 0 ? current.expected_image_count : MAX_IMAGES_PER_ITEM;
            const mergedImageSources = detailCountIsAuthoritative
                ? [...itemImages, ...(Array.isArray(current.image_sources) ? current.image_sources : [])]
                : [...(Array.isArray(current.image_sources) ? current.image_sources : []), ...itemImages];
            current.image_sources = dedupeImageUrlsByArtwork(
                expandTweetImageSequence(
                    mergedImageSources.map((entry) => entry?.url),
                    current.expected_image_count
                ),
                imageLimit
            ).map((url) => ({ url }));
        }
        return Array.from(grouped.values()).slice(0, MAX_ITEMS);
    }

    function collectMeigenGalleryItems(root = global.document, options = {}) {
        return mergeCollectedItems(
            getCandidateScopes(root, options)
                .map((scope, index) => normalizeCollectedItem(scope, index, options))
                .filter(Boolean)
                .filter((item) => itemMatchesFavoriteRange(item, options))
        );
    }

    function buildPayload(items = collectMeigenGalleryItems(), options = {}) {
        const pageUrl = options.pageUrl || options.baseUrl || global.location?.href || '';
        return {
            source: SOURCE,
            collector_version: VERSION,
            page_url: toAbsoluteUrl(pageUrl),
            collected_at: new Date().toISOString(),
            items
        };
    }

    function downloadPayload(payload) {
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const anchor = global.document.createElement('a');
        anchor.href = url;
        anchor.download = `meigen-gallery-import-${stamp}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return json;
    }

    async function copyPayload(json) {
        try {
            await global.navigator?.clipboard?.writeText(json);
            return true;
        } catch (_) {
            return false;
        }
    }

    async function runCollector() {
        const payload = buildPayload();
        const json = downloadPayload(payload);
        const copied = await copyPayload(json);
        const missingPromptCount = payload.items.filter((item) => !normalizeText(item.prompt_text)).length;
        const message = [
            `已采集 ${payload.items.length} 条`,
            missingPromptCount ? `${missingPromptCount} 条需要补提示词` : '',
            copied ? '结果已复制并下载' : '结果已下载'
        ].filter(Boolean).join('，');
        global.alert?.(message || '没有采集到可导入内容');
        return payload;
    }

    const api = {
        VERSION,
        SOURCE,
        parseFavoriteCount,
        collectImageUrls,
        collectMeigenGalleryItems,
        mergeCollectedItems,
        buildPayload,
        runCollector,
        _private: {
            normalizeText,
            getScopeBaseUrl,
            normalizeImageUrl,
            cleanPromptText,
            mergeCollectedItems,
            collectDetailArtworkImageUrls,
            getNodeDocumentOrderScore,
            itemMatchesFavoriteRange,
            isUnresolvablePlaceholderItem,
            extractPromptText,
            getOriginalWorkUrl,
            isOriginalWorkStatusUrl,
            getOriginalStatusId,
            buildOriginalWorkUrlFromHandleAndStatusId,
            getStatusIdFromImageUrl,
            getMeigenGenerationImageIdentity,
            dedupeImageUrlsByArtwork,
            expandTweetImageSequence,
            buildMeigenDetailUrlFromStatusId,
            getTrustedDetailArtworkExpectedCount,
            getAuthorHandle,
            getAuthorName,
            normalizeAuthorName,
            isCollapsedPromptText,
            collectStructuredItemCandidates,
            collectStructuredImageUrls,
            getBestStructuredCandidate,
            getStructuredIdentityCounts,
            filterDetailImageUrlsByStatus,
            isLikelyUnboundMeigenCommunityImageUrl,
            isCommunityDetailUrl,
            isImageUrlTrustedForStatus,
            filterDetailImageUrlsByIdentity,
            isLikelyListContainerScope
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
        return;
    }

    global.FatherKeyMeigenCollector = api;
    if (!global.__FatherKeyMeigenCollectorNoAutoRun) {
        void runCollector();
    }
})(typeof window !== 'undefined' ? window : globalThis);
