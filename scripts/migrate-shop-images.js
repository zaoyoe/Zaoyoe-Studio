#!/usr/bin/env node

/**
 * 商品图片迁移脚本
 * 将现有商品图片从 Supabase Storage 迁移到 Cloudflare R2
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// 加载环境变量
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

// R2 配置
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'zaoyoeimages';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://cdn.zaoyoe.com';

// Supabase 配置 (anon key 是公开的)
const SUPABASE_URL = 'https://mmkugdibsaeoevliebzk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ta3VnZGlic2Flb2V2bGllYnprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzAyNjU5NTIsImV4cCI6MjA0NTg0MTk1Mn0.P2cU_WekPHK-hSU7cwnCEpXVfYSeZgL4jfs4w2t8uFQ';

// 验证 R2 环境变量
if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT) {
    console.error('❌ 缺少 R2 环境变量');
    console.error('请确保 .env.local 包含: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT');
    process.exit(1);
}

// 创建客户端
const s3Client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * 下载图片
 */
async function downloadImage(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

/**
 * 上传到 R2
 */
async function uploadToR2(buffer, fileName, contentType) {
    const objectKey = `products/${fileName}`;

    const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000',
    });

    await s3Client.send(command);
    return `${R2_PUBLIC_URL}/${objectKey}`;
}

/**
 * 获取文件扩展名和 Content-Type
 */
function getContentType(url) {
    if (url.includes('.webp')) return 'image/webp';
    if (url.includes('.png')) return 'image/png';
    if (url.includes('.jpg') || url.includes('.jpeg')) return 'image/jpeg';
    if (url.includes('.gif')) return 'image/gif';
    return 'image/webp'; // 默认
}

/**
 * 主函数
 */
async function main() {
    console.log('🚀 开始迁移商品图片到 R2...\n');

    // 1. 获取所有商品
    const { data: products, error } = await supabase
        .from('shop_products')
        .select('id, name, icon_url')
        .not('icon_url', 'is', null);

    if (error) {
        console.error('❌ 获取商品失败:', error.message);
        process.exit(1);
    }

    console.log(`📦 找到 ${products.length} 个商品\n`);

    // 2. 筛选需要迁移的商品（排除已经在 R2 的和 FontAwesome 图标）
    const toMigrate = products.filter(p => {
        if (!p.icon_url) return false;
        if (p.icon_url.startsWith('fa')) return false; // FontAwesome 图标
        if (p.icon_url.includes('r2.dev')) return false; // 已在 R2
        if (p.icon_url.startsWith('http')) return true; // HTTP URL 需要迁移
        return false;
    });

    console.log(`📤 需要迁移: ${toMigrate.length} 个商品图片\n`);

    if (toMigrate.length === 0) {
        console.log('✅ 所有图片已经在 R2，无需迁移！');
        return;
    }

    // 3. 逐个迁移
    let success = 0;
    let failed = 0;

    for (const product of toMigrate) {
        const productId = product.id;
        const oldUrl = product.icon_url;

        try {
            console.log(`⏳ 迁移: ${product.name}`);
            console.log(`   原URL: ${oldUrl}`);

            // 下载
            const buffer = await downloadImage(oldUrl);

            // 生成新文件名
            const ext = oldUrl.includes('.webp') ? 'webp' :
                oldUrl.includes('.png') ? 'png' :
                    oldUrl.includes('.jpg') ? 'jpg' : 'webp';
            const fileName = `product_${productId}.${ext}`;
            const contentType = getContentType(oldUrl);

            // 上传到 R2
            const newUrl = await uploadToR2(buffer, fileName, contentType);

            // 更新数据库
            const { error: updateError } = await supabase
                .from('shop_products')
                .update({ icon_url: newUrl })
                .eq('id', productId);

            if (updateError) {
                throw new Error(`数据库更新失败: ${updateError.message}`);
            }

            console.log(`   ✅ 成功: ${newUrl}\n`);
            success++;

        } catch (err) {
            console.error(`   ❌ 失败: ${err.message}\n`);
            failed++;
        }
    }

    console.log('='.repeat(50));
    console.log(`📊 迁移完成！`);
    console.log(`   ✅ 成功: ${success}`);
    console.log(`   ❌ 失败: ${failed}`);
}

main().catch(console.error);
