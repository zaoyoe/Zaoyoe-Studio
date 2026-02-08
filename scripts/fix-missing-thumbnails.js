/**
 * Generate thumbnails for specific missing homepage images
 */

const sharp = require('sharp');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');

// R2 Configuration (from .env.local)
const R2_ENDPOINT = 'https://cd39b0e86720cb61b47d9d23da7bb0b6.r2.cloudflarestorage.com';
const R2_ACCESS_KEY = '9ab75a0b5d14dcb9b63dd0da8b5d177a';
const R2_SECRET_KEY = '403a94052676fb998160bc696feb746d85e313dbe8401f6616d58cf4e9d0afae';

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
        const url = 'https://cdn.zaoyoe.com/prompts/' + filename;
        console.log(`[${success + failed + 1}/10] ${filename}`);

        try {
            const buffer = await downloadImage(url);
            const thumb = await sharp(buffer)
                .resize(400, null, { withoutEnlargement: true, fit: 'inside' })
                .webp({ quality: 80 })
                .toBuffer();

            await s3Client.send(new PutObjectCommand({
                Bucket: 'zaoyoeimages',
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
