/**
 * Generate thumbnails for specific missing homepage images
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: false });

const sharp = require('sharp');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');

function readFirstEnv(names = [], fallback = '') {
    for (const name of names) {
        const value = String(process.env[name] || '').trim();
        if (value) return value;
    }
    return fallback;
}

function requireEnv(label, names = []) {
    const value = readFirstEnv(names);
    if (!value) {
        throw new Error(`Missing required environment variable for ${label}: ${names.join(' / ')}`);
    }
    return value;
}

// R2 Configuration (from .env.local)
const R2_ENDPOINT = requireEnv('R2 endpoint', ['R2_ENDPOINT']);
const R2_ACCESS_KEY = requireEnv('R2 access key', ['R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY']);
const R2_SECRET_KEY = requireEnv('R2 secret key', ['R2_SECRET_ACCESS_KEY', 'R2_SECRET_KEY']);
const R2_BUCKET = requireEnv('R2 bucket', ['R2_BUCKET_NAME']);
const R2_PUBLIC_URL = readFirstEnv(['R2_PUBLIC_URL'], 'https://cdn.zaoyoe.com');

const s3Client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY
    }
});

// 10 missing homepage images
const missing = [
    '3D_chibi_style______1_1.webp',
    'Q_______6_1.webp',
    '_____16_1.webp',
    '_____21_1.webp',
    'Small_body__Lion_heart_7_1.webp',
    '_____12_1.webp',
    '_____13_1.webp',
    'Capture_the_romance_4_1.webp',
    '_____14_1.webp',
    '_____15_1.webp'
];

function downloadImage(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

async function process() {
    console.log('🚀 为 10 张主页图片生成缩略图...\n');

    let success = 0, failed = 0;

    for (const filename of missing) {
        const url = `${R2_PUBLIC_URL}/prompts/${filename}`;
        console.log(`[${success + failed + 1}/10] ${filename}`);

        try {
            const buffer = await downloadImage(url);
            const thumb = await sharp(buffer)
                .resize(800, null, { withoutEnlargement: true, fit: 'inside' })
                .webp({ quality: 85 })
                .toBuffer();

            await s3Client.send(new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: 'prompts/thumb/' + filename,
                Body: thumb,
                ContentType: 'image/webp'
            }));
            console.log('  ✅ 上传成功');
            success++;
        } catch (e) {
            console.log('  ❌ 失败:', e.message);
            failed++;
        }
    }

    console.log('\n═══════════════════════════════════════');
    console.log('📊 完成！');
    console.log(`   成功: ${success}`);
    console.log(`   失败: ${failed}`);
    console.log('═══════════════════════════════════════');
}

process();
