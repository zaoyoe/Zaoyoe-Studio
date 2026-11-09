const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const capabilities = require('../js/ai-media-model-capabilities');
const media = require('../server/api-handlers/_bblabu-media');
const { executeOpenAiCompatibleImageGeneration } = require('../server/api-handlers/_ai-image-models');

const baseUrl = 'https://api.bblabu.cn/v1';
const resolve = model => capabilities.resolve({ baseUrl, model });
const gif = Buffer.from('47494638396101000100800000ff00000000ff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f90400140000002c00000000010001000002024c01003b', 'hex');
const imageTask = (metadata = {}) => ({ id: 'gif-task', site: 'cn', user_id: 'user', mode: 'text', billing_mode: 'points', status: 'running', model: 'gpt-image-2.6', ratio: '1:1', resolution: '1k', quantity: 1, prompt: 'A moving red dot', metadata });
const config = { baseUrl, apiKey: 'test-key', model: 'sd7-seedance-2.0-720p' };
function videoTask(saved = false) {
    return { id: 'video-task', mode: 'video', model: config.model, prompt: 'A moving red dot', quantity: 1, ratio: '16:9', resolution: '720p', created_at: new Date().toISOString(), metadata: {
        duration: 5, provider_base_url: baseUrl,
        ...(saved ? { provider_async: { submitted_at: new Date().toISOString(), provider_base_url: baseUrl, credential_fingerprint: createHash('sha256').update(config.apiKey).digest('hex') } } : {})
    }, ...(saved ? { provider_task_id: 'saved/video-id' } : {}) };
}
const response = (payload, status = 200) => ({ response: { ok: status < 400, status }, payload });
function videoOptions(task, request, save = true) {
    return { task, config, profile: resolve(task.model), request, extractData: p => p.data?.url ? [p.data] : p.url ? [{ url: p.url }] : [], saveHandle: async (id, metadata) => {
        if (!save) return null;
        task.provider_task_id = id;
        task.metadata.provider_async = metadata;
        return task;
    } };
}

test('BBLABU video and unreviewed catalogue stay scoped to the documented HTTPS channel', () => {
    for (const host of ['api.bblabu.ai', 'api.bblabu.cn', 'api.bblabu.chat']) assert.equal(capabilities.isBblabu(`https://${host}/v1`), true);
    for (const url of ['http://api.bblabu.cn/v1', 'https://api.bblabu.cn.evil.com/v1', 'https://user:pass@api.bblabu.cn/v1', 'https://api.bblabu.cn:8443/v1', 'https://api.openai.com/v1']) assert.equal(capabilities.resolve({ baseUrl: url, model: 'sd7-seedance-2.0-720p' }), null);
    assert.throws(() => capabilities.normalizeInput({}, resolve('unreviewed-model')), { code: 'ai_media_model_under_review' });
    assert.throws(() => capabilities.normalizeInput({}, resolve('gpt-image-2.5-flare-4k')), { code: 'ai_media_model_under_review' });
});
test('Image 2.6 GIF capability and task metadata follow the model across upstreams', () => {
    for (const baseUrl of ['https://api.bblabu.cn/v1', 'https://new.fatherkey.com/v1', 'https://relay.example.com/v1', '']) {
        const profile = capabilities.resolve({ baseUrl, model: 'gpt-image-2.6' });
        assert.deepEqual(profile.formats, ['png', 'jpeg', 'webp', 'gif']);
        assert.deepEqual(profile.gif, { frameCount: [2, 64, 9], frameDurationMs: [20, 2000, 200] });
        const input = capabilities.normalizeInput({ outputFormat: 'gif', frameCount: 12, frameDurationMs: 240 }, profile);
        const metadata = capabilities.taskMetadata(input);
        assert.equal(metadata.media_capability.channel, baseUrl.includes('bblabu') ? 'bblabu' : 'openai-compatible');
        assert.equal(metadata.media_capability.version, profile.version);
        assert.deepEqual(capabilities.imageParameters(imageTask(metadata), profile), { output_format: 'gif', frame_count: 12, frame_duration_ms: 240 });
        if (!baseUrl.includes('bblabu')) assert.doesNotMatch(profile.description, /BBLABU/);
    }
    assert.equal(capabilities.resolve({ model: ' GPT-IMAGE-2.6 ' }).id, 'GPT-IMAGE-2.6');
    for (const model of ['gpt-image-2', 'gpt-image-2.5', 'gpt-image-2.60', 'other-gpt-image-2.6', 'sd7-seedance-2.0-720p']) {
        assert.equal(capabilities.resolve({ baseUrl: 'https://relay.example.com/v1', model }), null);
    }
});
for (const p of capabilities.list().filter(p => p.execution === 'ready')) {
    test(`${p.id}: default request obeys the declared channel contract`, () => {
        const profile = resolve(p.id);
        if (p.kind === 'image') return assert.equal(capabilities.normalizeInput({}, profile).outputFormat, 'png');
        const input = capabilities.normalizeInput({}, profile);
        const request = capabilities.videoRequest({ model: p.id, mode: 'video', quantity: 1, prompt: 'motion', metadata: capabilities.taskMetadata(input) }, profile);
        assert.equal(request.model, p.id);
        assert.equal(request.n, 1);
        assert.equal(request.duration, p.duration_default);
        if (p.resolution_control) assert.equal(request.resolution, p.wireResolutions[p.resolution_default]);
        assert.equal('generate_audio' in request, p.generate_audio);
        assert.equal('watermark' in request, p.watermark);
    });
}
test('GIF validation accepts boundary values and excludes animation controls for still outputs', () => {
    const profile = resolve('gpt-image-2.6');
    for (const [frameCount, frameDurationMs] of [[2, 20], [64, 2000]]) {
        const input = capabilities.normalizeInput({ outputFormat: 'gif', frameCount, frameDurationMs, quantity: 10 }, profile);
        const metadata = capabilities.taskMetadata(input);
        assert.deepEqual(capabilities.imageParameters(imageTask(metadata), profile), { output_format: 'gif', frame_count: frameCount, frame_duration_ms: frameDurationMs });
    }
    assert.deepEqual(capabilities.imageParameters(imageTask({ output_format: 'png', frame_count: 500, frame_duration_ms: 1 }), profile), { output_format: 'png' });
    assert.deepEqual(capabilities.imageParameters(imageTask({ output_format: 'gif' }), profile), { output_format: 'gif', frame_count: 9, frame_duration_ms: 200 });
    for (const body of [{ outputFormat: 'gif', frameCount: 1 }, { outputFormat: 'gif', frameCount: 65 }, { outputFormat: 'gif', frameDurationMs: 19 }, { outputFormat: 'gif', frameDurationMs: 2001 }, { outputFormat: 'gif', frameCount: 2.5 }, { outputFormat: 'mp4' }, { quantity: 11 }, { maskUrl: 'https://cdn.example.com/mask.png' }]) assert.throws(() => capabilities.normalizeInput(body, profile), { statusCode: 400 });
});
test('BBLABU reference validation rejects unsafe URLs and excess images', () => {
    for (const url of ['http://cdn.example.com/a.png', 'https://127.0.0.1/a', 'https://10.2.3.4/a', 'https://169.254.169.254/a', 'https://[::1]/a', 'https://host.local/a', 'https://user:pass@cdn.example.com/a']) assert.throws(() => capabilities.normalizeInput({ referenceImageUrl: url }, resolve('gpt-image-2.6')));
    assert.throws(() => capabilities.normalizeInput({ referenceImages: Array.from({ length: 10 }, (_, i) => `https://cdn.example.com/${i}.png`) }, resolve('gpt-image-2.6')), { code: 'reference_image_limit_exceeded' });
});
test('MiniMax first frames omit aspect ratio, audio needs visual references and material limits apply', () => {
    const profile = resolve('mm5-minimax-h3');
    const task = { model: profile.id, quantity: 1, metadata: { first_image_url: 'https://cdn.example.com/first.png' } };
    const fields = capabilities.videoRequest(task, profile);
    assert.equal('aspect_ratio' in fields, false);
    assert.equal(fields.resolution, '768P');
    assert.throws(() => capabilities.normalizeInput({ referenceAudios: ['https://cdn.example.com/a.mp3'] }, profile), /参考音频须搭配/);
    assert.throws(() => capabilities.normalizeInput({ lastImageUrl: 'https://cdn.example.com/last.png' }, profile), /尾帧必须/);
    assert.throws(() => capabilities.normalizeInput({ firstImageUrl: task.metadata.first_image_url, referenceImages: ['https://cdn.example.com/ref.png'] }, profile), /不能与普通参考/);
    const input = capabilities.normalizeInput({ referenceVideos: ['https://cdn.example.com/v.mp4'], referenceAudios: ['https://cdn.example.com/a.mp3'] }, profile);
    assert.equal(input.referenceAudios.length, 1);
    assert.throws(() => capabilities.normalizeInput({ referenceImages: Array.from({ length: 9 }, (_, i) => `https://cdn.example.com/${i}.png`), referenceVideos: Array(3).fill('https://cdn.example.com/v.mp4'), referenceAudios: ['https://cdn.example.com/a.mp3'] }, profile), /总数超过/);
});
test('Seedance combined duration includes fractional material seconds and survives task replay', () => {
    const profile = resolve('sd14-seedance-2.0');
    assert.throws(() => capabilities.normalizeInput({ duration: 5, referenceVideos: ['https://cdn.example.com/v.mp4'] }, profile), /须填写时长/);
    assert.throws(() => capabilities.normalizeInput({ duration: 5, referenceVideos: [{ url: 'https://cdn.example.com/v.mp4', duration: 20.1 }] }, profile), /25 秒/);
    for (const duration of [0, -1, Infinity, 'garbage']) assert.throws(() => capabilities.normalizeInput({ referenceVideos: [{ url: 'https://cdn.example.com/v.mp4', duration }] }, profile));
    const input = capabilities.normalizeInput({ duration: 5, referenceVideos: [{ url: 'https://cdn.example.com/1.mp4', duration: 10.5 }, { url: 'https://cdn.example.com/2.mp4', duration: 9.5 }] }, profile);
    const task = { mode: 'video', quantity: 1, model: profile.id, metadata: { duration: 5, ...capabilities.taskMetadata(input) } };
    assert.deepEqual(capabilities.videoRequest(task, profile).reference_videos, input.referenceVideos);
});
test('animated image inspection detects MIME from bytes and keeps every frame', async () => {
    const bytes = Buffer.from(gif);
    const info = await media.inspectImage(bytes);
    assert.equal(info.mimeType, 'image/gif');
    assert.equal(info.width, 1);
    assert.equal(info.height, 1);
    assert.deepEqual(info.metadata, { output_format: 'gif', animated: true, frame_count: 2, frame_durations_ms: [100, 200], loop: 0 });
    assert.deepEqual(bytes, gif);
    await assert.rejects(media.inspectImage(Buffer.from('<html>upstream error</html>')), { code: 'ai_image_result_invalid_media' });
    await assert.rejects(media.inspectImage(Buffer.from('GIF89a')), { code: 'ai_image_result_invalid_media' });
});
for (const providerBaseUrl of [baseUrl, 'https://new.fatherkey.com/v1', 'https://relay.example.com/v1']) {
for (const mode of ['text', 'image']) {
for (const format of ['gif', 'png']) {
    test(`GPT Image 2.6 ${providerBaseUrl} ${mode} ${format}: serializes output controls and preserves animation`, async () => {
        const requests = [];
        const uploads = [];
        const task = { ...imageTask({ output_format: format, frame_count: 2, frame_duration_ms: 100, quality: 'high' }), mode, ...(mode === 'image' ? { reference_image_url: 'https://cdn.example.com/ref.png' } : {}) };
        const execution = await executeOpenAiCompatibleImageGeneration(task, {
            env: { AI_IMAGE_API_KEY: 'test-key', AI_IMAGE_API_BASE_URL: providerBaseUrl, AI_IMAGE_QUALITY: 'high', AI_IMAGE_REFERENCE_IMAGE_HOSTS: 'cdn.example.com' },
            fetchImpl: async (url, options = {}) => {
                if (url === task.reference_image_url) return new Response(gif, { headers: { 'content-type': 'image/gif' } });
                requests.push({ url, options });
                return new Response(JSON.stringify({ data: [{ b64_json: gif.toString('base64'), mime_type: 'image/png' }] }));
            },
            resolveHostname: async () => ['93.184.216.34'],
            uploadImageBuffer: async (bytes, options) => { uploads.push({ bytes, options }); return { image_url: 'https://cdn.example.com/result.gif', original_image_url: 'https://cdn.example.com/result.gif', storage_path: 'result.gif' }; }
        });
        assert.equal(requests.length, 1);
        const body = mode === 'text' ? JSON.parse(requests[0].options.body) : Object.fromEntries(requests[0].options.body.entries());
        assert.equal(body.model, 'gpt-image-2.6');
        assert.equal(body.output_format, format);
        if (format === 'gif') {
            assert.equal(Number(body.frame_count), 2);
            assert.equal(Number(body.frame_duration_ms), 100);
        } else {
            assert.equal('frame_count' in body, false);
            assert.equal('frame_duration_ms' in body, false);
        }
        assert.equal('quality' in body, false);
        assert.equal(requests[0].url, `${providerBaseUrl}${mode === 'image' ? '/images/edits' : '/images/generations'}`);
        assert.equal(uploads[0].options.mimeType, 'image/gif');
        assert.deepEqual(uploads[0].bytes, gif);
        assert.equal(execution.images[0].metadata.frame_count, 2);
        assert.equal(execution.images[0].mime_type, 'image/gif');
        assert.deepEqual(execution.deferredOriginalUploads, []);
        assert.equal(Object.hasOwn(execution.images[0], 'deferredOriginalUpload'), false);
    });
}
}
}
test('video submission saves the upstream handle before returning pending', async () => {
    const task = videoTask();
    let calls = 0;
    await assert.rejects(media.requestVideo(videoOptions(task, async (url, options) => {
        calls++;
        assert.equal(url, `${baseUrl}/videos`);
        assert.equal(options.method, 'POST');
        return response({ id: 'upstream-id', status: 'queued' });
    })), error => error.code === 'ai_video_provider_pending' && error.metadata.provider_task_id === 'upstream-id');
    assert.equal(calls, 1);
    assert.equal(task.provider_task_id, 'upstream-id');
    assert.equal(task.metadata.provider_async.credential_fingerprint, createHash('sha256').update(config.apiKey).digest('hex'));
});
test('video persistence failure is explicit and never makes a second upstream call', async () => {
    let calls = 0;
    await assert.rejects(media.requestVideo(videoOptions(videoTask(), async () => { calls++; return response({ id: 'saved-id', status: 'queued' }); }, false)), { code: 'ai_video_handle_persist_failed' });
    assert.equal(calls, 1);
});
test('restarted video uses GET on the saved ID and falls back to content only at completion', async () => {
    const task = videoTask(true);
    const requests = [];
    const run = payload => media.requestVideo(videoOptions(task, async (url, options) => { requests.push({ url, method: options.method }); return response(payload); }));
    await assert.rejects(run({ status: 'processing', url: 'https://cdn.example.com/preview.mp4' }), { code: 'ai_video_provider_pending' });
    const result = await run({ status: 'completed' });
    assert.equal(result.data[0].url, `${baseUrl}/videos/saved%2Fvideo-id/content`);
    assert.ok(requests.every(r => r.method === 'GET'));
    assert.ok(requests.every(r => r.url.endsWith('/videos/saved%2Fvideo-id')));
});
for (const status of [408, 429, 500, 503]) test(`video query HTTP ${status} keeps the existing handle pending`, async () => {
    const task = videoTask(true);
    await assert.rejects(media.requestVideo(videoOptions(task, async () => response({}, status))), { code: 'ai_video_provider_pending' });
    assert.equal(task.provider_task_id, 'saved/video-id');
});
test('video network failure is pending; provider failure and missing handle are terminal', async () => {
    await assert.rejects(media.requestVideo(videoOptions(videoTask(true), async () => { throw new Error('timeout'); })), { code: 'ai_video_provider_pending' });
    await assert.rejects(media.requestVideo(videoOptions(videoTask(true), async () => response({ status: 'failed' }))), { code: 'ai_video_provider_failed' });
    await assert.rejects(media.requestVideo(videoOptions(videoTask(), async () => response({ status: 'pending' }))), { code: 'ai_video_provider_missing_id' });
    await assert.rejects(media.requestVideo(videoOptions(videoTask(true), async () => response({}, 401))), { code: 'ai_video_provider_query_failed' });
});
test('video identity and two hour deadline reject before network access', async () => {
    for (const changed of [{ baseUrl: 'https://api.bblabu.ai/v1' }, { model: 'other-model' }, { apiKey: 'new-key' }]) {
        const options = videoOptions(videoTask(true), async () => assert.fail('network must not be called'));
        options.config = { ...config, ...changed };
        await assert.rejects(media.requestVideo(options), { code: 'ai_video_provider_identity_changed', statusCode: 409 });
    }
    const task = videoTask(true);
    task.metadata.provider_async.submitted_at = new Date(Date.now() - media.VIDEO_DEADLINE_MS - 1).toISOString();
    await assert.rejects(media.requestVideo(videoOptions(task, async () => assert.fail('network must not be called'))), { code: 'ai_video_provider_deadline' });
});
