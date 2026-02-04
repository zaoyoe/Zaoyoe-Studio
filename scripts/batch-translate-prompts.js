const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mmkugdibsaeoevliebzk.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ta3VnZGlic2Flb2V2bGllYnprIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNDMyNDU4MywiZXhwIjoyMDQ5OTAwNTgzfQ.5RAfmnxOFB17bVfNLnDv8uGYyJ6hJD3gLCfVbT-aTIY';

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
