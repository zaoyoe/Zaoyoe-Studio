'use strict';

// Limit bytes as they arrive, including decoded/chunked responses whose
// Content-Length is absent or does not describe the decoded body size.
function readError(code) {
    return Object.assign(new Error('Upstream response could not be read safely'), { code });
}
function abortError() {
    return Object.assign(new Error('Upstream response read was aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
}
function cancel(stream) {
    try { Promise.resolve(stream?.cancel?.()).catch(() => {}); } catch (_) {}
}
async function readBoundedResponseText(response, { maxBytes, signal } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('A positive response byte limit is required');
    if (signal?.aborted) { cancel(response?.body); throw abortError(); }
    const declared = response?.headers?.get?.('content-length');
    if (typeof declared === 'string' && /^\d+$/.test(declared) && BigInt(declared) > BigInt(maxBytes)) {
        cancel(response?.body);
        throw readError('upstream_response_too_large');
    }
    // Do not fall back to text()/json(): they allocate the entire body first.
    if (!response?.body) return '';
    if (typeof response.body.getReader !== 'function') {
        cancel(response.body);
        throw readError('upstream_response_stream_required');
    }
    const reader = response.body.getReader();
    let rejectAbort;
    const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => { rejectAbort(abortError()); cancel(reader); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    try {
        const reading = (async () => {
            const buffer = Buffer.allocUnsafe(maxBytes);
            let size = 0;
            while (true) {
                const { value, done } = await reader.read();
                if (signal?.aborted) throw abortError();
                if (done) break;
                if (!(value instanceof Uint8Array)) throw readError('upstream_response_invalid_chunk');
                if (value.byteLength > maxBytes - size) throw readError('upstream_response_too_large');
                buffer.set(value, size);
                size += value.byteLength;
            }
            return buffer.subarray(0, size).toString('utf8');
        })();
        return await Promise.race([reading, aborted]);
    } catch (error) {
        cancel(reader);
        throw error;
    } finally {
        signal?.removeEventListener('abort', onAbort);
        try { reader.releaseLock(); } catch (_) {}
    }
}

module.exports = { readBoundedResponseText };
