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

async function updatePrompt4() {
    console.log('Updating Prompt ID 4 with Chinese translation...\n');

    const { data, error } = await supabase
        .from('prompts')
        .update({
            title_zh: '永恒之爱的拥抱'
        })
        .eq('id', 4)
        .select();

    if (error) {
        console.error('❌ Error updating prompt:', error);
        return;
    }

    console.log('✅ Successfully updated!');
    console.log('Updated data:', data);
}

updatePrompt4();
