const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://kbclpfztfjgqikzsydfy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtiY2xwZnp0ZmpncWlrenN5ZGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzE0NzkwNDcsImV4cCI6MjA0NzA1NTA0N30.Fs-lZrEwh0vSdjdE3F_K1o4-wjVi1WTNdlY0cMWMCmA';

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
