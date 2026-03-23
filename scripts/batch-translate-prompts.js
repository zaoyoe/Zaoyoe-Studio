const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: false });

function readFirstEnv(names = []) {
    for (const name of names) {
        const value = String(process.env[name] || '').trim();
        if (value) return value;
    }
    return '';
}

const supabaseUrl = readFirstEnv([
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_URL'
]);
const supabaseKey = readFirstEnv([
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_KEY'
]);

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 需要翻译的提示词
const translations = [
    { id: 21, title_zh: '北京七日冒险', description_zh: '探索北京的精彩七日旅程' },
    { id: 5, title_zh: '贵宾犬的倒影之美', description_zh: '捕捉贵宾犬在水中倒影的优雅时刻' },
    { id: 4, title_zh: '捕捉浪漫', description_zh: '永恒爱情的艺术呈现' },
    { id: 3, title_zh: 'KDA女团', description_zh: 'KDA虚拟女子偶像团体主题创作' }
];

async function batchUpdateTranslations() {
    console.log('开始批量更新中文翻译...\n');

    let successCount = 0;
    let failCount = 0;

    for (const trans of translations) {
        const { data, error } = await supabase
            .from('prompts')
            .update({
                title_zh: trans.title_zh,
                description_zh: trans.description_zh
            })
            .eq('id', trans.id)
            .select();

        if (error) {
            console.error(`❌ ID ${trans.id} 更新失败:`, error.message);
            failCount++;
        } else {
            console.log(`✅ ID ${trans.id}: ${trans.title_zh}`);
            successCount++;
        }
    }

    console.log(`\n📊 更新完成: 成功 ${successCount}, 失败 ${failCount}`);

    // 验证更新
    console.log('\n验证更新结果:');
    for (const trans of translations) {
        const { data } = await supabase
            .from('prompts')
            .select('id, title, title_zh, description_zh')
            .eq('id', trans.id)
            .single();

        console.log(`ID ${data.id}: title_zh = "${data.title_zh}"`);
    }
}

batchUpdateTranslations();
