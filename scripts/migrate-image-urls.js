#!/usr/bin/env node

/**
 * 迁移 prompts-data.js 中的图片URL
 * 从本地路径 assets/prompts/*.png
 * 更新为 R2 CDN URL https://cdn.zaoyoe.com/prompts/*.webp
 */

const fs = require('fs');
const path = require('path');

const PROMPTS_DATA_FILE = path.join(__dirname, '../prompts-data.js');
const R2_CDN_BASE = 'https://cdn.zaoyoe.com/prompts/';

console.log('🔄 开始迁移图片URL到R2 CDN...\n');

try {
    // 读取文件
    let content = fs.readFileSync(PROMPTS_DATA_FILE, 'utf8');

    console.log('📂 读取文件: prompts-data.js');

    // 统计更新数量
    let updateCount = 0;

    // 替换所有 assets/prompts/*.png 为 R2 CDN URL
    // 同时将 .png 改为 .webp
    const updatedContent = content.replace(
        /"assets\/prompts\/([^"]+)\.png"/g,
        (match, filename) => {
            updateCount++;
            return `"${R2_CDN_BASE}${filename}.webp"`;
        }
    );

    console.log(`\n✅ 找到 ${updateCount} 个图片URL需要更新`);

    // 写回文件
    fs.writeFileSync(PROMPTS_DATA_FILE, updatedContent, 'utf8');

    console.log('✅ 文件已更新: prompts-data.js\n');
    console.log('=' + '='.repeat(60));
    console.log('📊 迁移完成！\n');
    console.log(`更新数量: ${updateCount} 个URL`);
    console.log(`图片格式: .png → .webp`);
    console.log(`CDN地址: ${R2_CDN_BASE}`);
    console.log('=' + '='.repeat(60));

    console.log('\n💡 下一步: 运行本地服务器测试图片加载');
    console.log('   python3 -m http.server 8000\n');

} catch (error) {
    console.error('❌ 错误:', error.message);
    process.exit(1);
}
