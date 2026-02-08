/**
 * Batch Thumbnail Generation Script (Node.js)
 * 
 * 运行方法：
 * node scripts/batch-generate-thumbnails-node.js
 * 
 * 需要先安装依赖：
 * npm install sharp @supabase/supabase-js @aws-sdk/client-s3 dotenv
 */

// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');
const http = require('http');

// Configuration
const SUPABASE_URL = 'https://mmkugdibsaeoevliebzk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lwkiF-sQ80z8e9oMcejFPQ_j7oezjcF';

// R2 Configuration from .env.local
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'zaoyoeimages';
const R2_PUBLIC_URL = 'https://cdn.zaoyoe.com';

const THUMB_WIDTH = 400;
const THUMB_QUALITY = 80;
const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES = 1000;

// Initialize clients
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let s3Client = null;

// Statistics
let stats = {
    total: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    uploaded: 0
};

// Download image from URL
function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;

        client.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

// Generate thumbnail using Sharp
async function generateThumbnail(imageBuffer) {
    const metadata = await sharp(imageBuffer).metadata();

    // Skip if already small
    if (metadata.width && metadata.width <= THUMB_WIDTH) {
        return null;
    }

    return sharp(imageBuffer)
        .resize(THUMB_WIDTH, null, {
            withoutEnlargement: true,
            fit: 'inside'
        })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer();
}

// Upload to R2
async function uploadToR2(buffer, filename) {
    const key = `prompts/thumb/${filename}`;

    await s3Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: 'image/webp'
    }));

    return `${R2_PUBLIC_URL}/${key}`;
}

// Check if thumbnail already exists
async function thumbnailExists(filename) {
    const thumbUrl = `${R2_PUBLIC_URL}/prompts/thumb/${filename}`;

    return new Promise((resolve) => {
        https.get(thumbUrl, { method: 'HEAD' }, (res) => {
            resolve(res.statusCode === 200);
        }).on('error', () => resolve(false));
    });
}

// Main function
async function main() {
    console.log('🚀 批量生成缩略图 (Node.js 版本)\n');

    // Check R2 credentials
    if (!R2_ACCESS_KEY || !R2_SECRET_KEY) {
        console.error('❌ 请设置 R2 环境变量:');
        console.error('   export R2_ENDPOINT="your-endpoint"');
        console.error('   export R2_ACCESS_KEY="your-access-key"');
        console.error('   export R2_SECRET_KEY="your-secret-key"');
        console.error('\n或者编辑此脚本填写凭证');
        process.exit(1);
    }

    // Initialize S3 client
    s3Client = new S3Client({
        region: 'auto',
        endpoint: R2_ENDPOINT,
        credentials: {
            accessKeyId: R2_ACCESS_KEY,
            secretAccessKey: R2_SECRET_KEY
        }
    });

    // Fetch all prompts
    console.log('📥 正在获取提示词列表...');
    const { data: prompts, error } = await supabase
        .from('prompts')
        .select('id, title, images')
        .order('id', { ascending: false });

    if (error) {
        console.error('❌ 获取提示词失败:', error);
        process.exit(1);
    }

    // Collect all R2 image URLs
    const imagesToProcess = [];

    for (const prompt of prompts) {
        if (!prompt.images || !Array.isArray(prompt.images)) continue;

        for (const url of prompt.images) {
            if (url && url.includes('cdn.zaoyoe.com/prompts/') && !url.includes('/thumb/')) {
                imagesToProcess.push({
                    promptId: prompt.id,
                    promptTitle: prompt.title,
                    originalUrl: url,
                    filename: url.split('/').pop()
                });
            }
        }
    }

    stats.total = imagesToProcess.length;
    console.log(`📊 发现 ${stats.total} 张图片需要处理\n`);

    if (stats.total === 0) {
        console.log('✅ 所有图片都已有缩略图，无需处理');
        return;
    }

    // Process in batches
    for (let i = 0; i < imagesToProcess.length; i += BATCH_SIZE) {
        const batch = imagesToProcess.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(imagesToProcess.length / BATCH_SIZE);

        console.log(`📦 处理批次 ${batchNum}/${totalBatches}...`);

        await Promise.all(batch.map(async (item) => {
            try {
                stats.processed++;

                // Check if thumbnail already exists
                const exists = await thumbnailExists(item.filename);
                if (exists) {
                    console.log(`  [${stats.processed}/${stats.total}] ⏭️ ${item.filename} (已存在)`);
                    stats.skipped++;
                    return;
                }

                // Download original image
                const imageBuffer = await downloadImage(item.originalUrl);

                // Generate thumbnail
                const thumbBuffer = await generateThumbnail(imageBuffer);

                if (!thumbBuffer) {
                    console.log(`  [${stats.processed}/${stats.total}] ⏭️ ${item.filename} (太小)`);
                    stats.skipped++;
                    return;
                }

                // Upload to R2
                await uploadToR2(thumbBuffer, item.filename);
                console.log(`  [${stats.processed}/${stats.total}] ✅ ${item.filename}`);
                stats.uploaded++;

            } catch (err) {
                console.error(`  [${stats.processed}/${stats.total}] ❌ ${item.filename}: ${err.message}`);
                stats.failed++;
            }
        }));

        // Delay between batches
        if (i + BATCH_SIZE < imagesToProcess.length) {
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
        }
    }

    // Final report
    console.log('\n═══════════════════════════════════════');
    console.log('📊 批量生成缩略图完成！');
    console.log('═══════════════════════════════════════');
    console.log(`   总计: ${stats.total} 张图片`);
    console.log(`   上传成功: ${stats.uploaded} 张`);
    console.log(`   跳过: ${stats.skipped} 张`);
    console.log(`   失败: ${stats.failed} 张`);
    console.log('═══════════════════════════════════════');
}

main().catch(console.error);
