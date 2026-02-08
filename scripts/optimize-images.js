const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 * 批量优化图片脚本
 * 将 /assets/prompts/ 中的所有图片转换为优化的WebP格式
 * 
 * 功能：
 * - PNG/JPG → WebP
 * - 调整最大宽度1200px（保持宽高比）
 * - 质量85%
 * - 输出到 /assets/prompts-optimized/
 */

// 配置
const CONFIG = {
    inputDir: path.join(__dirname, '../assets/prompts'),
    outputDir: path.join(__dirname, '../assets/prompts-optimized'),
    maxWidth: 1200,
    quality: 85,
    format: 'webp'
};

// 统计
const stats = {
    total: 0,
    processed: 0,
    failed: 0,
    originalSize: 0,
    optimizedSize: 0
};

/**
 * 确保输出目录存在
 */
function ensureOutputDir() {
    if (!fs.existsSync(CONFIG.outputDir)) {
        fs.mkdirSync(CONFIG.outputDir, { recursive: true });
        console.log(`✅ Created output directory: ${CONFIG.outputDir}`);
    }
}

/**
 * 获取文件大小（KB）
 */
function getFileSizeInKB(filePath) {
    const stats = fs.statSync(filePath);
    return (stats.size / 1024).toFixed(2);
}

/**
 * 优化单个图片
 */
async function optimizeImage(inputPath, outputPath) {
    try {
        const originalSize = getFileSizeInKB(inputPath);
        stats.originalSize += parseFloat(originalSize);

        // 读取图片元数据
        const metadata = await sharp(inputPath).metadata();

        // 计算缩放后的尺寸
        let width = metadata.width;
        let height = metadata.height;

        if (width > CONFIG.maxWidth) {
            const scale = CONFIG.maxWidth / width;
            width = CONFIG.maxWidth;
            height = Math.round(height * scale);
        }

        // 转换并保存
        await sharp(inputPath)
            .resize(width, height, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .webp({ quality: CONFIG.quality })
            .toFile(outputPath);

        const optimizedSize = getFileSizeInKB(outputPath);
        stats.optimizedSize += parseFloat(optimizedSize);

        const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(1);

        console.log(`✅ ${path.basename(inputPath)}`);
        console.log(`   ${metadata.width}x${metadata.height} → ${width}x${height}`);
        console.log(`   ${originalSize}KB → ${optimizedSize}KB (${savings}% smaller)\n`);

        stats.processed++;
    } catch (error) {
        console.error(`❌ Failed to process ${path.basename(inputPath)}:`, error.message);
        stats.failed++;
    }
}

/**
 * 批量处理所有图片
 */
async function processAllImages() {
    console.log('🚀 Starting image optimization...\n');
    console.log(`📂 Input:  ${CONFIG.inputDir}`);
    console.log(`📂 Output: ${CONFIG.outputDir}`);
    console.log(`⚙️  Config: max ${CONFIG.maxWidth}px, ${CONFIG.quality}% quality, ${CONFIG.format} format\n`);

    ensureOutputDir();

    // 读取输入目录
    const files = fs.readdirSync(CONFIG.inputDir);

    // 过滤图片文件
    const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
    });

    stats.total = imageFiles.length;
    console.log(`📊 Found ${stats.total} images to process\n`);

    // 批量处理
    for (const file of imageFiles) {
        const inputPath = path.join(CONFIG.inputDir, file);
        const outputFilename = path.basename(file, path.extname(file)) + '.webp';
        const outputPath = path.join(CONFIG.outputDir, outputFilename);

        await optimizeImage(inputPath, outputPath);
    }

    // 输出统计
    console.log('━'.repeat(50));
    console.log('📊 Optimization Summary');
    console.log('━'.repeat(50));
    console.log(`Total images:     ${stats.total}`);
    console.log(`Processed:        ${stats.processed} ✅`);
    console.log(`Failed:           ${stats.failed} ❌`);
    console.log(`Original size:    ${(stats.originalSize / 1024).toFixed(2)} MB`);
    console.log(`Optimized size:   ${(stats.optimizedSize / 1024).toFixed(2)} MB`);

    if (stats.originalSize > 0) {
        const totalSavings = ((1 - stats.optimizedSize / stats.originalSize) * 100).toFixed(1);
        const savedMB = ((stats.originalSize - stats.optimizedSize) / 1024).toFixed(2);
        console.log(`Savings:          ${savedMB} MB (${totalSavings}% reduction) 🎉`);
    }

    console.log('━'.repeat(50));
    console.log(`\n✨ Done! Optimized images saved to:\n   ${CONFIG.outputDir}\n`);
}

// 执行
processAllImages().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
