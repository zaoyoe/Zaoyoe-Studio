#!/usr/bin/env node

/**
 * 使用 AWS SDK 上传优化后的图片到 Cloudflare R2
 * 使用 S3-compatible API
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

// 从环境变量读取配置
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const ENDPOINT = process.env.R2_ENDPOINT;
const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'zaoyoeimages';
const INPUT_DIR = path.join(__dirname, '../assets/prompts-optimized');

// 验证环境变量
if (!ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !ENDPOINT) {
    console.error('❌ 错误：缺少必要的环境变量');
    console.error('请确保 .env.local 文件包含：');
    console.error('  - R2_ACCESS_KEY_ID');
    console.error('  - R2_SECRET_ACCESS_KEY');
    console.error('  - R2_ENDPOINT');
    process.exit(1);
}

console.log('🚀 开始上传图片到 Cloudflare R2 (S3 API)...\n');
console.log(`📂 输入目录: ${INPUT_DIR}`);
console.log(`📦 存储桶: ${BUCKET_NAME}`);
console.log(`🔗 Endpoint: ${ENDPOINT}`);
console.log(`🔑 Access Key: ${ACCESS_KEY_ID.substring(0, 8)}...`);
console.log('');

// 创建 S3 客户端
const s3Client = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
    },
});

/**
 * 上传单个文件
 */
async function uploadFile(filePath, fileName) {
    try {
        const fileContent = await readFile(filePath);
        const objectKey = `prompts/${fileName}`;

        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: objectKey,
            Body: fileContent,
            ContentType: getMimeType(fileName),
        });

        await s3Client.send(command);
        return true;
    } catch (error) {
        console.error(`   错误详情: ${error.message}`);
        return false;
    }
}

/**
 * 获取文件的 MIME 类型
 */
function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
        '.webp': 'image/webp',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

async function uploadAllImages() {
    try {
        // 检查输入目录
        const files = await readdir(INPUT_DIR);
        const imageFiles = files.filter(f =>
            f.toLowerCase().endsWith('.webp') ||
            f.toLowerCase().endsWith('.jpg') ||
            f.toLowerCase().endsWith('.png')
        );

        if (imageFiles.length === 0) {
            console.error('❌ 未找到图片文件');
            return;
        }

        console.log(`📊 找到 ${imageFiles.length} 张图片\n`);

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < imageFiles.length; i++) {
            const fileName = imageFiles[i];
            const filePath = path.join(INPUT_DIR, fileName);
            const fileStats = await stat(filePath);
            const fileSizeKB = (fileStats.size / 1024).toFixed(2);

            console.log(`[${i + 1}/${imageFiles.length}] 上传: ${fileName} (${fileSizeKB}KB)`);

            const success = await uploadFile(filePath, fileName);

            if (success) {
                successCount++;
                console.log(`   ✅ 成功\n`);
            } else {
                failCount++;
                console.log(`   ❌ 失败\n`);
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('📊 上传完成！\n');
        console.log(`✅ 成功: ${successCount}张`);
        console.log(`❌ 失败: ${failCount}张`);
        console.log('='.repeat(60));

        if (successCount > 0) {
            console.log('\n🌐 访问您的图片:');
            console.log(`   https://cdn.zaoyoe.com/prompts/[文件名]`);
            console.log('\n💡 提示: 图片已成功上传并可通过公共URL访问');
            console.log('💡 下一步: 配置自定义域名以获得更好的性能和稳定性');
        }

    } catch (error) {
        console.error('❌ 上传过程出错:', error.message);
        process.exit(1);
    }
}

// 执行上传
uploadAllImages();
