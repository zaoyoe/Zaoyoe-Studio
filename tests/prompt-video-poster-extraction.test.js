const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const { resolveFfmpegPath, extractVideoPosterFrame } = require('../server/prompt-video-poster');

test('video poster extraction produces a decodable frame from an uploaded video buffer', async () => {
    const ffmpegPath = resolveFfmpegPath();
    const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fatherkey-poster-test-'));
    const fixturePath = path.join(fixtureDirectory, 'tail-index.mp4');
    try {
        const generated = spawnSync(ffmpegPath, [
            '-hide_banner',
            '-loglevel', 'error',
            '-f', 'lavfi',
            '-i', 'color=c=red:s=320x240:d=0.5',
            '-c:v', 'libx264',
            fixturePath
        ], {
            encoding: null,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 30000
        });
        assert.equal(generated.status, 0, String(generated.stderr || 'FFmpeg fixture generation failed'));
        const uploadedVideoBuffer = fs.readFileSync(fixturePath);
        assert.ok(uploadedVideoBuffer.length > 0);

        const frame = await extractVideoPosterFrame(uploadedVideoBuffer, { seekSeconds: 0 });
        const metadata = await sharp(frame).metadata();
        assert.equal(metadata.format, 'png');
        assert.equal(metadata.width, 320);
        assert.equal(metadata.height, 240);
    } finally {
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
    }
});
