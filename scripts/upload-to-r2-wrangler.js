#!/usr/bin/env node

/**
 * 使用 Wrangler CLI 上传优化后的图片到 Cloudflare R2
 * 使用 Bearer Token 认证
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const execAsync = promisify(exec);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

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

console.log('🚀 开始上传图片到 Cloudflare R2...\n');
console.log(`📂 输入目录: ${INPUT_DIR}`);
console.log(`📦 存储桶: ${BUCKET_NAME}`);
console.log(`🔑 Account ID: ${ACCOUNT_ID.substring(0, 8)}...`);
console.log('');

// 设置环境变量供 wrangler 使用
process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
process.env.CLOUDFLARE_API_TOKEN = API_TOKEN;

async function uploadFile(filePath, fileName) {
    try {
        const remotePath = `prompts/${fileName}`;

        // 使用 wrangler r2 object put 命令上传到远程R2
        const command = `npx wrangler r2 object put ${BUCKET_NAME}/${remotePath} --file="${filePath}" --remote`;

        await execAsync(command, {
            env: {
                ...process.env,
                CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
                CLOUDFLARE_API_TOKEN: API_TOKEN
            }
        });

        return true;
    } catch (error) {
        console.error(`❌ 上传失败: ${fileName}`);
        console.error(`   错误: ${error.message}`);
        return false;
    }
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
