#!/usr/bin/env node

/**
 * 使用 Cloudflare R2 HTTP API 上传优化后的图片
 * 使用 Bearer Token 认证
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

// 从环境变量读取配置
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'zaoyoeimages';
const INPUT_DIR = path.join(__dirname, '../assets/prompts-optimized');

// 验证环境变量
if (!ACCOUNT_ID || !API_TOKEN) {
    console.error('❌ 错误：缺少必要的环境变量');
    console.error('请确保 .env.local 文件包含：');
    console.error('  - CLOUDFLARE_ACCOUNT_ID');
    console.error('  - CLOUDFLARE_API_TOKEN');
    process.exit(1);
}

console.log('🚀 开始上传图片到 Cloudflare R2 (HTTP API)...\n');
console.log(`📂 输入目录: ${INPUT_DIR}`);
console.log(`📦 存储桶: ${BUCKET_NAME}`);
console.log(`🔑 Account ID: ${ACCOUNT_ID.substring(0, 8)}...`);
console.log('');

/**
 * 使用 Cloudflare R2 API 上传文件
 */
async function uploadFile(filePath, fileName) {
    return new Promise(async (resolve, reject) => {
        try {
            const objectKey = `prompts/${fileName}`;
            const fileBuffer = await readFile(filePath);

            // Cloudflare R2 API endpoint (使用 S3-compatible API)
            const hostname = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
            const apiPath = `/${BUCKET_NAME}/${objectKey}`;

            const options = {
                hostname: hostname,
                port: 443,
                path: apiPath,
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${API_TOKEN}`,
                    'Content-Type': getMimeType(fileName),
                    'Content-Length': fileBuffer.length
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200 || res.statusCode === 201) {
                        resolve(true);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(fileBuffer);
            req.end();

        } catch (error) {
            reject(error);
        }
    });
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

            try {
                await uploadFile(filePath, fileName);
                successCount++;
                console.log(`   ✅ 成功\n`);
            } catch (error) {
                failCount++;
                console.error(`   ❌ 失败: ${error.message}\n`);
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('📊 上传完成！\n');
        console.log(`✅ 成功: ${successCount}张`);
        console.log(`❌ 失败: ${failCount}张`);
        console.log('='.repeat(60));

        if (successCount > 0) {
            console.log('\n🌐 访问您的图片:');
            console.log(`   https://cdn.fatherkey.com/prompts/[文件名]`);
            console.log('\n💡 提示: 第一次上传后可能需要几分钟才能通过公共URL访问');
            console.log('💡 下一步: 配置自定义域名以获得更好的性能和稳定性');
        }

    } catch (error) {
        console.error('❌ 上传过程出错:', error.message);
        process.exit(1);
    }
}

// 执行上传
uploadAllImages();
