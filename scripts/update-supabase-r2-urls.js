#!/usr/bin/env node

/**
 * 更新Supabase数据库中的图片URL
 * 将所有Supabase Storage和本地路径的图片URL更新为R2 CDN URL
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mmkugdibsaeoevliebzk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ta3VnZGlic2Flb2V2bGllYnprIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTkzOTM2NiwiZXhwIjoyMDgxNTE1MzY2fQ.FdwbzapB8-TgaZKiocHgsQuuMy250qAilACZkO5CqhY';

const R2_CDN_BASE = 'https://cdn.zaoyoe.com/prompts/';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔄 开始更新Supabase中的图片URL...\n');

async function updateSupabaseUrls() {
    try {
        // 1. 获取所有prompts
        console.log('📥 正在获取所有prompts...');
        const { data: prompts, error: fetchError } = await supabase
            .from('prompts')
            .select('*');

        if (fetchError) {
            throw new Error(`获取prompts失败: ${fetchError.message}`);
        }

        console.log(`✅ 获取到 ${prompts.length} 个prompts\n`);

        let updateCount = 0;
        let skippedCount = 0;

        // 2. 遍历并更新每个prompt
        for (const prompt of prompts) {
            let needsUpdate = false;
            let newImages = null;
            let newImage = null;

            // 更新 images 数组
            if (prompt.images && Array.isArray(prompt.images) && prompt.images.length > 0) {
                newImages = prompt.images.map(url => {
                    // 如果已经是R2 URL，跳过
                    if (url.includes('r2.dev')) {
                        return url;
                    }

                    needsUpdate = true;

                    // 从URL中提取文件名
                    let filename = '';

                    if (url.includes('supabase.co/storage')) {
                        // Supabase Storage URL
                        // 例如: https://mmkugdibsaeoevliebzk.supabase.co/storage/v1/object/public/prompts/3D_chibi_style______1_1.png
                        const match = url.match(/\/prompts\/([^?]+)/);
                        if (match) {
                            filename = match[1];
                        }
                    } else if (url.startsWith('assets/prompts/')) {
                        // 本地路径
                        // 例如: assets/prompts/3D_chibi_style______1_1.png
                        filename = url.replace('assets/prompts/', '');
                    } else if (url.includes('/prompts/')) {
                        // 任何包含 /prompts/ 的URL
                        const match = url.match(/\/prompts\/([^?]+)/);
                        if (match) {
                            filename = match[1];
                        }
                    }

                    if (!filename) {
                        console.warn(`⚠️  无法提取文件名: ${url}`);
                        return url;
                    }

                    // 将 .png 替换为 .webp
                    filename = filename.replace(/\.png$/i, '.webp');
                    filename = filename.replace(/\.jpg$/i, '.webp');
                    filename = filename.replace(/\.jpeg$/i, '.webp');

                    return R2_CDN_BASE + filename;
                });
            }

            // 更新 image 字段（单个图片）
            if (prompt.image && typeof prompt.image === 'string' && !prompt.image.includes('r2.dev')) {
                needsUpdate = true;
                let filename = '';

                if (prompt.image.includes('supabase.co/storage')) {
                    const match = prompt.image.match(/\/prompts\/([^?]+)/);
                    if (match) {
                        filename = match[1];
                    }
                } else if (prompt.image.startsWith('assets/prompts/')) {
                    filename = prompt.image.replace('assets/prompts/', '');
                } else if (prompt.image.includes('/prompts/')) {
                    const match = prompt.image.match(/\/prompts\/([^?]+)/);
                    if (match) {
                        filename = match[1];
                    }
                }

                if (filename) {
                    filename = filename.replace(/\.(png|jpg|jpeg)$/i, '.webp');
                    newImage = R2_CDN_BASE + filename;
                }
            }

            // 执行更新
            if (needsUpdate) {
                const updateData = {};
                if (newImages) updateData.images = newImages;
                if (newImage) updateData.image = newImage;

                const { error: updateError } = await supabase
                    .from('prompts')
                    .update(updateData)
                    .eq('id', prompt.id);

                if (updateError) {
                    console.error(`❌ 更新失败 [${prompt.id}]:`, updateError.message);
                } else {
                    updateCount++;
                    console.log(`✅ [${updateCount}/${prompts.length}] 已更新: ${prompt.title || prompt.id}`);

                    // 显示示例URL
                    if (newImages && newImages.length > 0) {
                        console.log(`   → ${newImages[0]}`);
                    } else if (newImage) {
                        console.log(`   → ${newImage}`);
                    }
                }
            } else {
                skippedCount++;
                console.log(`⏭️  [${skippedCount}] 已是R2 URL，跳过: ${prompt.title || prompt.id}`);
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('📊 更新完成！\n');
        console.log(`总数: ${prompts.length} 个prompts`);
        console.log(`已更新: ${updateCount} 个`);
        console.log(`跳过: ${skippedCount} 个（已是R2 URL）`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('❌ 发生错误:', error.message);
        console.error(error);
        process.exit(1);
    }
}

updateSupabaseUrls();
