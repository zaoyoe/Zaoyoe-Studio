const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mmkugdibsaeoevliebzk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ta3VnZGlic2Flb2V2bGllYnprIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNDMyNDU4MywiZXhwIjoyMDQ5OTAwNTgzfQ.5RAfmnxOFB17bVfNLnDv8uGYyJ6hJD3gLCfVbT-aTIY';

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
