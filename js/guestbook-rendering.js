/* Guestbook-only rendering helpers; no navigation or glass styling is changed here. */
(function (root) {
    'use strict';

    function planMasonryBatch(columnHeights, columnCounts, itemHeights, columnGaps) {
        const heights = columnHeights.slice();
        const counts = columnCounts.slice();
        return itemHeights.map(height => {
            let shortest = 0;
            for (let index = 1; index < heights.length; index += 1) {
                // Match offsetHeight's integer comparison, including the original item-count tie break.
                const candidateHeight = Math.round(heights[index]);
                const shortestHeight = Math.round(heights[shortest]);
                if (candidateHeight < shortestHeight
                    || (candidateHeight === shortestHeight && counts[index] < counts[shortest])) {
                    shortest = index;
                }
            }
            heights[shortest] += height + (counts[shortest] ? columnGaps[shortest] : 0);
            counts[shortest] += 1;
            return shortest;
        });
    }

    function appendMasonryBatch(container, columns, elements) {
        if (!elements.length) return;
        const document = container.ownerDocument;
        const targets = columns.length ? columns : [container];
        if (targets.length === 1) {
            const fragment = document.createDocumentFragment();
            elements.forEach(element => fragment.appendChild(element));
            targets[0].appendChild(fragment);
            return;
        }

        // Read existing geometry together before any new cards enter the live columns.
        const heights = targets.map(column => column.getBoundingClientRect().height);
        const counts = targets.map(column => column.childElementCount);
        const gaps = targets.map(column => parseFloat(root.getComputedStyle(column).rowGap) || 0);
        const width = targets[0].getBoundingClientRect().width;
        const measurement = document.createElement('div');
        measurement.className = 'masonry-column guestbook-masonry-measure';
        measurement.style.setProperty('--guestbook-measure-width', `${width}px`);
        measurement.setAttribute('aria-hidden', 'true');
        const staging = document.createDocumentFragment();
        elements.forEach(element => staging.appendChild(element));
        measurement.appendChild(staging);
        container.appendChild(measurement);

        try {
            // One layout for the whole batch at its final column width, including card margins.
            const itemHeights = elements.map(element => element.getBoundingClientRect().height);
            const assignments = planMasonryBatch(heights, counts, itemHeights, gaps);
            const fragments = targets.map(() => document.createDocumentFragment());
            elements.forEach((element, index) => fragments[assignments[index]].appendChild(element));
            targets.forEach((column, index) => {
                if (fragments[index].childNodes.length) column.appendChild(fragments[index]);
            });
        } finally {
            measurement.remove();
        }
    }

    function messageSignature(message, language) {
        // Snapshot the rendered data, so in-place realtime updates also invalidate the old card.
        return JSON.stringify([language || '', message]);
    }

    const api = { planMasonryBatch, appendMasonryBatch, messageSignature };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GuestbookRendering = api;
})(typeof window === 'object' ? window : globalThis);
