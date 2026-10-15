'use strict';

// This probe observes rendering only. It does not select answers or submit a challenge.
async function inspectCaptchaContent(frame, promptEn = '') {
    if (!frame) return { ready: true, reason: 'no_image_frame' };
    return frame.evaluate(promptEn => {
        const visible = el => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none'
                && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
        };
        const inToolbar = el => el.closest('.challenge-toolbar, .button-submit, .refresh, .reload, .logo, button');
        const pending = reason => ({ ready: false, reason });
        for (const el of document.querySelectorAll('.skeleton, .challenge-loading, .loading, .spinner, [aria-busy="true"], [role="progressbar"]')) {
            if (visible(el) && !inToolbar(el)) return pending('loading_indicator');
        }

        // A CSS url() is only a source declaration. Decode it before counting it as loaded.
        const cache = window.__kcCaptchaImageReadiness || (window.__kcCaptchaImageReadiness = new Map());
        const backgroundLoaded = url => {
            if (!cache.has(url)) {
                const image = new Image();
                const entry = { loaded: false, failed: false, image };
                cache.set(url, entry);
                image.onload = () => { entry.loaded = image.naturalWidth > 0; };
                image.onerror = () => { entry.failed = true; };
                image.src = url;
                if (image.complete && image.naturalWidth > 0) entry.loaded = true;
            }
            return cache.get(url).loaded;
        };
        const backgrounds = el => Array.from(getComputedStyle(el).backgroundImage.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g), match => match[2]);
        const imageStatus = img => Boolean(img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);

        // Empty/gray canvases and small central spinners have no material in their outer area.
        const canvasHasContent = (canvas, region = null, reference = false) => {
            try {
                const box = canvas.getBoundingClientRect();
                // Some renderers put the header and toolbar in the same tall canvas.
                // Their colors must not make an empty answer area look ready.
                const view = region || (box.height > box.width * 1.2
                    ? { left: box.left, top: box.top + box.height * 0.24, width: box.width, height: box.height * 0.60 }
                    : box);
                const x = Math.max(0, (view.left - box.left) / box.width * canvas.width);
                const y = Math.max(0, (view.top - box.top) / box.height * canvas.height);
                const w = Math.min(canvas.width - x, view.width / box.width * canvas.width);
                const h = Math.min(canvas.height - y, view.height / box.height * canvas.height);
                if (w < 10 || h < 10) return false;
                const sample = document.createElement('canvas');
                sample.width = 40;
                sample.height = 40;
                const ctx = sample.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(canvas, x, y, w, h, 0, 0, 40, 40);
                const data = ctx.getImageData(0, 0, 40, 40).data;
                const bins = new Map();
                const pixels = [];
                let count = 0;
                for (let sy = 2; sy < 38; sy++) {
                    for (let sx = 2; sx < 38; sx++) {
                        // Exclude the region occupied by a loading spinner.
                        if (sx >= 15 && sx <= 24 && sy >= 15 && sy <= 24) continue;
                        const i = (sy * 40 + sx) * 4;
                        if (data[i + 3] < 30) continue;
                        const bin = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
                        bins.set(bin, (bins.get(bin) || 0) + 1);
                        if (reference) pixels.push([data[i], data[i + 1], data[i + 2]]);
                        count++;
                    }
                }
                const dominant = Math.max(0, ...bins.values());
                if (reference) {
                    // The reference loader has a gray background, a slightly lighter
                    // inset and three white dots. Those two gray tones are not an image.
                    // Require actual contrast outside the central loading dots; retain
                    // support for monochrome photos/shapes rather than requiring color.
                    const dominantBin = Array.from(bins).find(([, n]) => n === dominant)?.[0];
                    if (!dominantBin) return false;
                    const base = dominantBin.split(',').map(n => Number(n) * 16 + 8);
                    const contrasting = pixels.filter(pixel => pixel.some((channel, i) => Math.abs(channel - base[i]) > 32)).length;
                    if (contrasting / count <= 0.03) return false;
                }
                return count > 100 && bins.size >= 2 && (count - dominant) / count > 0.03;
            } catch (_) {
                // A tainted or not-yet-rendered canvas is not evidence of a loaded image.
                return false;
            }
        };
        const canvases = Array.from(document.querySelectorAll('canvas')).filter(el => {
            const rect = el.getBoundingClientRect();
            return visible(el) && !inToolbar(el) && rect.width >= 50 && rect.height >= 50;
        });
        const canvasGridStatus = canvas => {
            // Canvas-only photo grids expose no img/task-cell nodes. Recognize regular
            // white gutters, then check each material region, including a blank last tile.
            try {
                const sample = document.createElement('canvas');
                sample.width = 180; sample.height = 180;
                const ctx = sample.getContext('2d', { willReadFrequently: true });
                const top = canvas.height > canvas.width * 1.2 ? canvas.height * 0.24 : 0;
                const height = top ? canvas.height * 0.60 : canvas.height;
                ctx.drawImage(canvas, 0, top, canvas.width, height, 0, 0, 180, 180);
                const data = ctx.getImageData(0, 0, 180, 180).data;
                const material = (x, y) => {
                    const i = (y * 180 + x) * 4;
                    return data[i + 3] > 30 && !(data[i] >= 230 && data[i + 1] >= 230 && data[i + 2] >= 230);
                };
                const bands = axis => {
                    const runs = [];
                    let start = null;
                    for (let a = 0; a <= 180; a++) {
                        let hits = 0;
                        if (a < 180) for (let b = 0; b < 180; b++) hits += axis === 'x' ? material(a, b) : material(b, a);
                        if (hits >= 18 && start === null) start = a;
                        if (hits < 18 && start !== null) { runs.push([start, a]); start = null; }
                    }
                    return runs.filter(([from, to]) => to - from >= 20);
                };
                const columns = bands('x');
                const rows = bands('y');
                if (![3, 4].includes(rows.length) || columns.length !== rows.length) return null;
                const lengths = [...rows, ...columns].map(([a, b]) => b - a);
                if (Math.min(...lengths) / Math.max(...lengths) < 0.6) return null;
                let loaded = 0;
                for (const [x1, x2] of columns) for (const [y1, y2] of rows) {
                    let hits = 0;
                    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) hits += material(x, y);
                    if (hits / ((x2 - x1) * (y2 - y1)) > 0.03) loaded++;
                }
                const total = rows.length * columns.length;
                return { ready: loaded === total, reason: loaded === total ? 'canvas_grid_ready' : 'canvas_grid_incomplete', loaded, total };
            } catch (_) { return null; }
        };
        const inside = (outer, inner) => inner.left >= outer.left - 1 && inner.top >= outer.top - 1
            && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;
        const hasMaterial = (el, reference = false) => {
            const nodes = [el, ...el.querySelectorAll('*')].filter(visible);
            const images = nodes.filter(node => node.tagName === 'IMG');
            const urls = nodes.flatMap(backgrounds);
            if (!images.every(imageStatus) || !urls.every(backgroundLoaded)) return false;
            const rect = el.getBoundingClientRect();
            const children = canvases.filter(c => inside(rect, c.getBoundingClientRect()));
            if (children.length) return children.every(c => canvasHasContent(c, null, reference));
            if (images.length || urls.length) return true;
            const canvas = canvases.find(c => inside(c.getBoundingClientRect(), rect));
            return canvas ? canvasHasContent(canvas, rect, reference) : false;
        };

        const promptNode = document.querySelector('#prompt-question, .prompt-text, h2') || document.querySelector('.prompt-text-container');
        const prompt = (promptNode?.textContent || promptEn || '').replace(/\s+/g, ' ').trim().toLowerCase();
        // Count/example challenges can put their examples below the answer. Only
        // prompts referring to the header item/place require the top-right fallback.
        const requiresHeaderReference = /\b(?:item|object|container|place)\s+(?:shown|provided)\b|\b(?:take|bring|wear|belongs?)\s+(?:inside|into|in|to)\s+(?:the\s+)?place\b/.test(prompt);

        // Reference renderers vary: named wrappers, header images and canvas-only
        // challenges. Check them before any grid-ready return, including when the
        // reference placeholder has not received an img/background source yet.
        const references = Array.from(document.querySelectorAll('.prompt-image, .challenge-example, .reference-image, .example-image')).filter(visible);
        if (requiresHeaderReference) {
            const headerNodes = document.querySelectorAll('.challenge-header .image, .challenge-header .image-wrapper, .challenge-header img, .challenge-header canvas, .challenge-header [style*="background"], .prompt-text-container .image, .prompt-text-container img, .prompt-text-container canvas');
            for (const el of headerNodes) {
                const rect = el.getBoundingClientRect();
                if (visible(el) && !inToolbar(el) && rect.width >= 32 && rect.height >= 32
                    && rect.width <= window.innerWidth * 0.45 && rect.height <= window.innerWidth * 0.5
                    && (!promptNode || (el !== promptNode && !el.contains(promptNode) && !promptNode.contains(el)))
                    && !references.includes(el)) references.push(el);
            }
        }
        if (references.some(el => !hasMaterial(el, true))) return pending('reference_image_loading');
        if (requiresHeaderReference && !references.length) {
            // Some hCaptcha renderers paint the full panel into one canvas. The
            // reference sits in the upper-right header, outside the answer region
            // sampled by the generic canvas probe. The two regions must be ready.
            const promptBox = promptNode?.getBoundingClientRect();
            const panel = canvases.find(canvas => {
                const box = canvas.getBoundingClientRect();
                return box.width >= 200 && box.height >= box.width * 1.05
                    && (!promptBox || inside(box, promptBox));
            });
            if (!panel) return pending('reference_image_missing');
            const box = panel.getBoundingClientRect();
            const referenceBox = { left: box.left + box.width * 0.80, top: box.top + box.width * 0.02, width: box.width * 0.18, height: box.width * 0.18 };
            if (!canvasHasContent(panel, referenceBox, true)) return pending('reference_image_loading');
            const answerBox = { left: box.left, top: box.top + box.height * 0.24, width: box.width, height: box.height * 0.60 };
            if (!canvasHasContent(panel, answerBox)) return pending('canvas_incomplete');
        }
        let cells = Array.from(document.querySelectorAll('.task-image, [data-cy="task-image"]')).filter(visible);
        if (!cells.length) cells = Array.from(document.querySelectorAll('.task-cell, .task-grid .task')).filter(visible);
        if (cells.length >= 4) {
            const loaded = cells.filter(el => hasMaterial(el)).length;
            return { ready: loaded === cells.length, reason: loaded === cells.length ? 'grid_ready' : 'grid_incomplete', loaded, total: cells.length };
        }

        const images = Array.from(document.querySelectorAll('img')).filter(el => visible(el) && !inToolbar(el));
        const imageNodes = Array.from(document.querySelectorAll('.image, .challenge-image, .task-image-single, [style*="background"]'))
            .filter(el => visible(el) && !inToolbar(el));
        const urls = imageNodes.flatMap(backgrounds);
        if (images.some(img => !imageStatus(img)) || urls.some(url => !backgroundLoaded(url))) return pending('image_loading');
        if (/select.*(?:images?|pictures?|animals?|vehicles?)/.test(prompt)) {
            for (const canvas of canvases) {
                const grid = canvasGridStatus(canvas);
                if (grid && !grid.ready) return grid;
            }
        }
        if (canvases.some(canvas => !canvasHasContent(canvas))) return pending('canvas_incomplete');
        const inReference = el => el.closest('.challenge-header, .prompt-image, .challenge-example, .reference-image, .example-image')
            || references.some(reference => reference === el || reference.contains(el));
        const answerImages = images.filter(img => !inReference(img));
        const answerUrls = imageNodes.filter(el => !inReference(el)).flatMap(backgrounds);
        const answerCanvases = canvases.filter(canvas => !inReference(canvas));
        if (answerImages.length || answerUrls.length || answerCanvases.length) return { ready: true, reason: 'materials_ready' };
        // Prompt text alone cannot prove the answer image exists.
        return pending('waiting_for_answer_material');
    }, promptEn).catch(() => ({ ready: false, reason: 'frame_unavailable' }));
}

async function waitForCaptchaContentReady(frame, maxWaitMs = 2500, promptEn = '') {
    const deadline = Date.now() + maxWaitMs;
    let stableChecks = 0;
    let status = { ready: false, reason: 'waiting_for_frame' };
    while (Date.now() < deadline) {
        status = await inspectCaptchaContent(frame, promptEn);
        stableChecks = status.ready ? stableChecks + 1 : 0;
        if (stableChecks >= 2) return status;
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    return { ...status, ready: false };
}

module.exports = { inspectCaptchaContent, waitForCaptchaContentReady };
