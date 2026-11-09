const test = require('node:test');
const assert = require('node:assert/strict');
const { planMasonryBatch, appendMasonryBatch, messageSignature } = require('../js/guestbook-rendering');

test('masonry balances unequal cards and counts the actual gap after the first item', () => {
    assert.deepEqual(planMasonryBatch([0, 0, 0], [0, 0, 0], [100, 200, 50, 80, 20, 90], [12, 12, 12]), [0, 1, 2, 2, 0, 0]);
    assert.deepEqual(planMasonryBatch([100, 105], [1, 1], [1, 1, 1], [12, 0]), [0, 1, 1]);
});

test('masonry uses item count to break integer-height ties just like offsetHeight', () => {
    assert.deepEqual(planMasonryBatch([100.1, 100.4], [3, 1], [0, 0], [0, 0]), [1, 1]);
    assert.deepEqual(planMasonryBatch([100.6, 100.4], [0, 5], [10], [0, 0]), [1]);
});

test('masonry preserves its input snapshots and accepts an empty batch', () => {
    const heights = Object.freeze([50, 50]);
    const counts = Object.freeze([1, 1]);
    assert.deepEqual(planMasonryBatch(heights, counts, [], [12, 12]), []);
    assert.deepEqual(planMasonryBatch(heights, counts, [10, 10], [12, 12]), [0, 1]);
});

test('single-column batches are inserted without geometry reads or measurement nodes', () => {
    const elements = [{ id: 'a' }, { id: 'b' }];
    const children = [];
    const container = {
        ownerDocument: { createDocumentFragment: () => ({ appendChild: child => children.push(child) }) },
        appendChild(fragment) { this.fragment = fragment; },
        getBoundingClientRect() { throw new Error('single-column geometry read'); }
    };
    appendMasonryBatch(container, [container], elements);
    assert.deepEqual(children, elements);
    assert.ok(container.fragment);
});

test('an empty batch does not touch the DOM', () => {
    appendMasonryBatch(null, [], []);
});

test('card signatures detect nested in-place comment and language changes', () => {
    const message = { id: 'a', comments: [{ id: 'c', content: 'before' }] };
    const signature = messageSignature(message, 'zh');
    assert.equal(signature, messageSignature(structuredClone(message), 'zh'));
    message.comments[0].content = 'after';
    assert.notEqual(signature, messageSignature(message, 'zh'));
    assert.notEqual(messageSignature(message, 'zh'), messageSignature(message, 'en'));
});
