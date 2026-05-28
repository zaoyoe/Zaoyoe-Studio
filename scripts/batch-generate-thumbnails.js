/**
 * Batch Thumbnail Generation Script
 * 
 * 运行方法：
 * 1. 打开 Admin Studio (https://www.fatherkey.com/admin-studio.html)
 * 2. 登录管理员账户
 * 3. 打开浏览器开发者工具 (F12 或 Cmd+Option+I)
 * 4. 复制此脚本到 Console 运行
 * 
 * 脚本会自动：
 * - 获取所有提示词图片 URL
 * - 检查哪些图片没有缩略图
 * - 批量生成 400px 缩略图
 * - 上传到 R2 的 prompts/thumb/ 路径
 */

(async function batchGenerateThumbnails() {
    console.log('🚀 开始批量生成缩略图...');

    // Configuration
    const THUMB_WIDTH = 400;
    const THUMB_QUALITY = 0.8;
    const BATCH_SIZE = 5; // 每批处理数量
    const DELAY_BETWEEN_BATCHES = 2000; // 批次间延迟 (ms)
    const supabaseUrl = (window.__PUBLIC_RUNTIME_CONFIG__ && window.__PUBLIC_RUNTIME_CONFIG__.supabaseUrl)
        || window.supabaseClient?.supabaseUrl
        || null;

    if (!supabaseUrl) {
        console.error('❌ 无法解析 Supabase URL，请先在 Admin Studio 中加载 runtime config 后再执行脚本');
        return;
    }

    const uploadToR2Url = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/upload-to-r2`;

    // Statistics
    let stats = {
        total: 0,
        processed: 0,
        skipped: 0,
        failed: 0,
        uploaded: 0
    };

    // Get auth session
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        console.error('❌ 请先登录管理员账户');
        return;
    }
    console.log('✅ 已登录:', session.user.email);

    // Fetch all prompts with R2 images
    console.log('📥 正在获取提示词列表...');
    const { data: prompts, error } = await supabaseClient
        .from('prompts')
        .select('id, title, images')
        .order('id', { ascending: false });

    if (error) {
        console.error('❌ 获取提示词失败:', error);
        return;
    }

    // Collect all R2 image URLs that don't have thumbnails yet
    const imagesToProcess = [];

    for (const prompt of prompts) {
        if (!prompt.images || !Array.isArray(prompt.images)) continue;

        for (const url of prompt.images) {
            // Only process R2 CDN images
            if (url && url.includes('cdn.fatherkey.com/prompts/') && !url.includes('/thumb/')) {
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
    console.log(`📊 发现 ${stats.total} 张图片需要生成缩略图`);

    if (stats.total === 0) {
        console.log('✅ 所有图片都已有缩略图，无需处理');
        return stats;
    }

    // Helper: Generate thumbnail using Canvas
    async function generateThumbnail(imageUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous'; // Required for CORS

            img.onload = () => {
                if (img.width <= THUMB_WIDTH) {
                    // Image is already small, skip
                    resolve(null);
                    return;
                }

                const canvas = document.createElement('canvas');
                const ratio = THUMB_WIDTH / img.width;
                canvas.width = THUMB_WIDTH;
                canvas.height = Math.round(img.height * ratio);

                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                canvas.toBlob((blob) => {
                    if (blob) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const base64 = reader.result.split(',')[1];
                            resolve(base64);
                        };
                        reader.readAsDataURL(blob);
                    } else {
                        reject(new Error('Failed to create blob'));
                    }
                }, 'image/webp', THUMB_QUALITY);
            };

            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = imageUrl;
        });
    }

    // Helper: Upload thumbnail to R2
    async function uploadThumbnail(base64, filename) {
        const response = await fetch(
            uploadToR2Url,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    images: [{
                        base64: base64,
                        filename: filename,
                        isThumb: true // This tells Edge Function to use thumb/ path
                    }]
                })
            }
        );

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Upload failed');
        }

        return await response.json();
    }

    // Process images in batches
    console.log(`🔄 开始处理，每批 ${BATCH_SIZE} 张...`);

    for (let i = 0; i < imagesToProcess.length; i += BATCH_SIZE) {
        const batch = imagesToProcess.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(imagesToProcess.length / BATCH_SIZE);

        console.log(`\n📦 处理批次 ${batchNum}/${totalBatches}...`);

        for (const item of batch) {
            try {
                stats.processed++;
                console.log(`  [${stats.processed}/${stats.total}] ${item.filename}`);

                // Generate thumbnail
                const thumbBase64 = await generateThumbnail(item.originalUrl);

                if (!thumbBase64) {
                    console.log(`    ⏭️ 跳过 (图片太小)`);
                    stats.skipped++;
                    continue;
                }

                // Upload thumbnail
                await uploadThumbnail(thumbBase64, item.filename);
                console.log(`    ✅ 上传成功`);
                stats.uploaded++;

            } catch (err) {
                console.error(`    ❌ 失败:`, err.message);
                stats.failed++;
            }
        }

        // Delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < imagesToProcess.length) {
            console.log(`  ⏳ 等待 ${DELAY_BETWEEN_BATCHES / 1000}s...`);
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
        }
    }

    // Final report
    console.log('\n');
    console.log('═══════════════════════════════════════');
    console.log('📊 批量生成缩略图完成！');
    console.log('═══════════════════════════════════════');
    console.log(`   总计: ${stats.total} 张图片`);
    console.log(`   上传成功: ${stats.uploaded} 张`);
    console.log(`   跳过 (太小): ${stats.skipped} 张`);
    console.log(`   失败: ${stats.failed} 张`);
    console.log('═══════════════════════════════════════');

    return stats;
})();
