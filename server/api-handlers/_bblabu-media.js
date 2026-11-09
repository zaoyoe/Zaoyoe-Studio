const { createHash } = require('node:crypto');
const capabilities = require('../../js/ai-media-model-capabilities');

const VIDEO_DEADLINE_MS = 7200 * 1000;
const SUCCESS = new Set(['completed', 'succeeded', 'success']);
const FAILURE = new Set(['failed', 'failure', 'cancelled', 'canceled']);
function mediaError(message, code, statusCode = 502) {
    return Object.assign(new Error(message), { code, statusCode });
}
function videoStartedAt(task) {
    return Date.parse(task.metadata?.provider_async?.submitted_at || task.started_at || task.created_at) || Date.now();
}
function isResumableVideo(task) {
    return task.mode === 'video' && capabilities.isBblabu(task.metadata?.provider_base_url)
        && Boolean(task.provider_task_id || task.metadata?.provider_task_id);
}
function videoExpired(task, now = Date.now()) { return now - videoStartedAt(task) >= VIDEO_DEADLINE_MS; }
function pending(task, message = '视频仍在生成，稍后继续查询') {
    const error = mediaError(message, 'ai_video_provider_pending', 202);
    error.metadata = { provider_task_id: task.provider_task_id || task.metadata?.provider_task_id, next_poll_at: new Date(Date.now() + 8000).toISOString() };
    return error;
}

function credentialFingerprint(config) {
    return createHash('sha256').update(String(config.apiKey || '')).digest('hex');
}
function assertVideoIdentity(task, config) {
    if (!isResumableVideo(task)) return;
    const saved = task.metadata?.provider_async || {};
    const savedBase = String(saved.provider_base_url || task.metadata?.provider_base_url || '').replace(/\/+$/, '');
    if (savedBase !== String(config.baseUrl || '').replace(/\/+$/, '')
        || task.model !== config.model || !saved.credential_fingerprint
        || saved.credential_fingerprint !== credentialFingerprint(config)) {
        throw mediaError('视频任务的供应商地址、模型或凭据已变更，请恢复原配置后查询原任务', 'ai_video_provider_identity_changed', 409);
    }
}
function retryableResultError(error) {
    if (['ai_video_storage_not_configured', 'ai_video_result_url_not_video', 'ai_video_result_url_empty'].includes(error?.code)) return false;
    const status = Number(error?.statusCode || error?.status || 0);
    return !status || status === 408 || status === 429 || status >= 500;
}

// Decode metadata only; persist the exact upstream bytes, including every animation frame.
async function inspectImage(buffer) {
    const sharp = require('sharp');
    const signature = buffer.subarray(0, 12);
    const supported = signature.subarray(0, 6).toString() === 'GIF89a' || signature.subarray(0, 6).toString() === 'GIF87a'
        || signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        || (signature[0] === 255 && signature[1] === 216 && signature[2] === 255)
        || (signature.subarray(0, 4).toString() === 'RIFF' && signature.subarray(8, 12).toString() === 'WEBP');
    if (!supported) throw mediaError('上游返回的内容不是受支持的图片', 'ai_image_result_invalid_media');
    let info;
    try { info = await sharp(buffer, { animated: true, limitInputPixels: 268402689 }).metadata(); }
    catch (_) { throw mediaError('上游图片内容无法解码', 'ai_image_result_invalid_media'); }
    const mimeType = { gif: 'image/gif', png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[info.format];
    if (!mimeType || !info.width || !info.height) throw mediaError('上游图片元数据无效', 'ai_image_result_invalid_media');
    return { mimeType, width: info.width, height: info.pageHeight || info.height,
        metadata: { output_format: info.format, animated: (info.pages || 1) > 1, frame_count: info.pages || 1,
            frame_durations_ms: info.delay || [], loop: info.loop ?? null } };
}

// One bounded network operation per worker invocation. Never re-POST a saved handle.
async function requestVideo({ task, config, profile, request, saveHandle, extractData }) {
    assertVideoIdentity(task, config);
    if (videoExpired(task)) throw mediaError('视频任务已达到上游两小时截止时间', 'ai_video_provider_deadline', 504);
    let id = task.provider_task_id || task.metadata?.provider_task_id || '';
    let payload;
    let response;
    const started = Date.now();
    if (!id) {
        ({ response, payload } = await request(`${config.baseUrl}/videos`, {
            method: 'POST', body: JSON.stringify(capabilities.videoRequest(task, profile))
        }));
        if (!response.ok) throw mediaError(payload?.error?.message || `视频提交失败（${response.status}）`, 'ai_video_provider_submit_failed');
        id = String(payload?.id || payload?.task_id || payload?.data?.id || payload?.data?.task_id || '');
        if (id) {
            const saved = await saveHandle(id, {
                source: 'bblabu-videos', provider_base_url: config.baseUrl,
                credential_fingerprint: credentialFingerprint(config), submitted_at: new Date(started).toISOString(), status: payload.status || payload.data?.status || 'pending'
            });
            if (saved) { task.provider_task_id = id; }
            if (!saved) throw mediaError('已提交上游，但任务 ID 保存失败；请保留任务记录排查', 'ai_video_handle_persist_failed');
        }
    } else {
        try {
            ({ response, payload } = await request(`${config.baseUrl}/videos/${encodeURIComponent(id)}`, { method: 'GET' }));
        } catch (_) { throw pending(task, '视频查询暂时失败，将使用同一任务 ID 继续查询'); }
        if (!response.ok) {
            if (response.status === 429 || response.status >= 500 || response.status === 408) throw pending(task);
            throw mediaError(`视频查询失败（${response.status}）`, 'ai_video_provider_query_failed');
        }
    }
    const status = String(payload?.status || payload?.data?.status || '').toLowerCase();
    if (FAILURE.has(status)) throw mediaError(payload?.error?.message || '上游视频生成失败', 'ai_video_provider_failed');
    const data = extractData(payload);
    if (!SUCCESS.has(status)) {
        // Synchronous URL responses may omit a status; pending responses never imply completion.
        if (!(data.length && !status)) {
            if (!id) throw mediaError('上游未返回任务 ID', 'ai_video_provider_missing_id');
            throw pending(task);
        }
    }
    if (!data.length && id && SUCCESS.has(status)) data.push({ url: `${config.baseUrl}/videos/${encodeURIComponent(id)}/content`, mime_type: 'video/mp4' });
    if (!data.length) throw mediaError('上游视频结果为空', 'ai_video_empty_result');
    return { data, providerTaskId: id, providerTaskIds: id ? [id] : [], requestedCount: 1, attempts: 1,
        upstreamMs: Date.now() - started, submitEndpoint: '/videos', asyncPollAttempts: id ? 1 : 0 };
}
module.exports = { assertVideoIdentity, retryableResultError, inspectImage, requestVideo, isResumableVideo, videoExpired, pending, VIDEO_DEADLINE_MS };
