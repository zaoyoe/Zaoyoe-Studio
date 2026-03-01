/**
 * Optimize Shop Product Images
 * 
 * Converts shop product images to WebP format with proper compression
 * while maintaining good quality (600px width).
 * 
 * Usage: node scripts/optimize-shop-images.js
 */

const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');
const http = require('http');

// Configuration
const SUPABASE_URL = 'https://auth.zaoyoe.com';
const SUPABASE_ANON_KEY = 'sb_publishable_lwkiF-sQ80z8e9oMcejFPQ_j7oezjcF';

// R2 Configuration (hardcoded for Node v24 compatibility)
const R2_ENDPOINT = 'https://cd39b0e86720cb61b47d9d23da7bb0b6.r2.cloudflarestorage.com';
const R2_ACCESS_KEY = '9ab75a0b5d14dcb9b63dd0da8b5d177a';
const R2_SECRET_KEY = '403a94052676fb998160bc696feb746d85e313dbe8401f6616d58cf4e9d0afae';
const R2_BUCKET = 'zaoyoeimages';
const R2_PUBLIC_URL = 'https://cdn.zaoyoe.com';

// Image settings - higher quality for shop images
const MAX_WIDTH = 600;
const QUALITY = 85;

// Initialize clients
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const s3Client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY
    }
});

// Statistics
let stats = {
    total: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    optimized: 0
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
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

// Optimize image - resize and convert to WebP
async function optimizeImage(imageBuffer) {
    const metadata = await sharp(imageBuffer).metadata();

    // Check if already small enough
    const needsResize = metadata.width && metadata.width > MAX_WIDTH;

    let pipeline = sharp(imageBuffer);

    if (needsResize) {
        pipeline = pipeline.resize(MAX_WIDTH, null, {
            withoutEnlargement: true,
            fit: 'inside'
        });
    }

    return pipeline.webp({ quality: QUALITY }).toBuffer();
}

// Upload to R2
async function uploadToR2(buffer, filename) {
    const key = `products/${filename}`;

    await s3Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: 'image/webp'
    }));

    return `${R2_PUBLIC_URL}/${key}`;
}

// Main function
async function main() {
    console.log('🚀 优化商城商品图片\n');
    console.log(`   目标宽度: ${MAX_WIDTH}px`);
    console.log(`   WebP 质量: ${QUALITY}`);
    console.log('');

    // Fetch all products with image URLs
    console.log('📥 正在获取商品列表...');
    const { data: products, error } = await supabase
        .from('shop_products')
        .select('id, name, icon_url')
        .not('icon_url', 'is', null);

    if (error) {
        console.error('❌ 获取商品失败:', error);
        process.exit(1);
    }

    // Filter products with R2 URLs that need optimization (non-WebP)
    const productsToOptimize = products.filter(p => {
        if (!p.icon_url) return false;
        if (!p.icon_url.startsWith('http')) return false; // Skip Font Awesome icons
        if (p.icon_url.endsWith('.webp')) return false; // Already WebP
        return true;
    });

    stats.total = productsToOptimize.length;
    console.log(`📊 发现 ${stats.total} 个商品需要优化\n`);

    if (stats.total === 0) {
        console.log('✅ 所有商品图片都已优化');
        return;
    }

    // Process each product
    for (const product of productsToOptimize) {
        stats.processed++;
        console.log(`[${stats.processed}/${stats.total}] ${product.name}`);
        console.log(`   原始: ${product.icon_url.substring(0, 60)}...`);

        try {
            // Download original image
            const imageBuffer = await downloadImage(product.icon_url);
            const originalSize = imageBuffer.length;

            // Optimize image
            const optimizedBuffer = await optimizeImage(imageBuffer);
            const newSize = optimizedBuffer.length;

            // Generate new filename
            const newFilename = `${product.id}_optimized.webp`;

            // Upload to R2
            const newUrl = await uploadToR2(optimizedBuffer, newFilename);

            // Update database
            const { error: updateError } = await supabase
                .from('shop_products')
                .update({ icon_url: newUrl })
                .eq('id', product.id);

            if (updateError) {
                throw updateError;
            }

            const savings = ((1 - newSize / originalSize) * 100).toFixed(1);
            console.log(`   ✅ ${(originalSize / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB (节省 ${savings}%)`);
            console.log(`   新URL: ${newUrl}`);
            stats.optimized++;

        } catch (err) {
            console.log(`   ❌ 失败: ${err.message}`);
            stats.failed++;
        }

        console.log('');
    }

    // Final report
    console.log('═══════════════════════════════════════');
    console.log('📊 商城图片优化完成！');
    console.log('═══════════════════════════════════════');
    console.log(`   总计: ${stats.total} 个商品`);
    console.log(`   优化成功: ${stats.optimized} 个`);
    console.log(`   跳过: ${stats.skipped} 个`);
    console.log(`   失败: ${stats.failed} 个`);
    console.log('═══════════════════════════════════════');
}

main().catch(console.error);
