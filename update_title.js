const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env.local'), override: false });

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
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY'
]);

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or Supabase key in environment');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function updatePromptsTitle() {
    try {
        // Get current config
        const { data: current, error: fetchError } = await supabase
            .from('homepage_config')
            .select('content')
            .eq('section', 'prompts')
            .single();

        if (fetchError) throw fetchError;

        console.log('Current config:', current);

        // Update with new titles
        const updatedContent = {
            ...current.content,
            section_title: 'AI 提示词',
            section_title_en: 'AI Prompt'
        };

        const { data, error } = await supabase
            .from('homepage_config')
            .update({ content: updatedContent })
            .eq('section', 'prompts')
            .select();

        if (error) throw error;

        console.log('✅ Updated successfully:', data);
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

updatePromptsTitle();
