const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_POSTER_SEEK_SECONDS = 0.1;
const DEFAULT_POSTER_TIMEOUT_MS = 30000;
const DEFAULT_MAX_POSTER_BYTES = 20 * 1024 * 1024;

function resolveFfmpegPath(env = process.env) {
    const configuredPath = String(env?.FFMPEG_PATH || '').trim();
    if (configuredPath) return configuredPath;
    return require('@ffmpeg-installer/ffmpeg').path;
}

function runFfmpegPosterExtraction(inputPath, {
    seekSeconds = DEFAULT_POSTER_SEEK_SECONDS,
    timeoutMs = DEFAULT_POSTER_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_POSTER_BYTES,
    env = process.env
} = {}) {
    const normalizedSeek = Math.max(0, Number(seekSeconds) || 0);
    const args = [
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', String(normalizedSeek),
        '-i', inputPath,
        '-frames:v', '1',
        '-an',
        '-f', 'image2pipe',
        '-c:v', 'png',
        'pipe:1'
    ];

    return new Promise((resolve, reject) => {
        const child = spawn(resolveFfmpegPath(env), args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const output = [];
        const errors = [];
        let outputBytes = 0;
        let settled = false;

        const finish = (error, frameBuffer = null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(frameBuffer);
        };
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            finish(new Error('Video poster extraction timed out'));
        }, Math.max(1000, Number(timeoutMs) || DEFAULT_POSTER_TIMEOUT_MS));

        child.stdout.on('data', (chunk) => {
            outputBytes += chunk.length;
            if (outputBytes > Math.max(1024, Number(maxBytes) || DEFAULT_MAX_POSTER_BYTES)) {
                child.kill('SIGKILL');
                finish(new Error('Extracted video poster exceeds the size limit'));
                return;
            }
            output.push(chunk);
        });
        child.stderr.on('data', (chunk) => {
            if (errors.reduce((total, entry) => total + entry.length, 0) < 8192) errors.push(chunk);
        });
        child.once('error', (error) => finish(new Error(`Unable to start FFmpeg: ${error.message}`)));
        child.once('close', (code) => {
            if (settled) return;
            if (code !== 0 || !outputBytes) {
                const detail = Buffer.concat(errors).toString('utf8').trim();
                finish(new Error(detail || `FFmpeg exited with code ${code}`));
                return;
            }
            finish(null, Buffer.concat(output));
        });
    });
}

async function extractVideoPosterFrame(input, options = {}) {
    const inputBuffer = Buffer.isBuffer(input) ? input : null;
    const inputUrl = inputBuffer ? '' : String(input || '').trim();
    if (!inputBuffer?.length && !inputUrl) {
        throw new Error('Video poster extraction requires a video buffer or URL');
    }
    if (!inputBuffer) return runFfmpegPosterExtraction(inputUrl, options);

    const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fatherkey-video-poster-'));
    const inputPath = path.join(temporaryDirectory, 'input-video');
    try {
        await fs.promises.writeFile(inputPath, inputBuffer);
        return await runFfmpegPosterExtraction(inputPath, options);
    } finally {
        await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
    }
}

module.exports = {
    DEFAULT_POSTER_SEEK_SECONDS,
    resolveFfmpegPath,
    extractVideoPosterFrame
};
