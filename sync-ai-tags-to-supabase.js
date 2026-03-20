/**
 * Sync AI Tags from prompts-data.js to Supabase
 * Run this script with: node sync-ai-tags-to-supabase.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Supabase configuration
const SUPABASE_URL = 'https://mmkugdibsaeoevliebzk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Need service key for updates

if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ Please set SUPABASE_SERVICE_KEY environment variable');
    console.log('   You can find it in Supabase Dashboard > Settings > API > service_role key');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function syncAiTags() {
    // Read local prompts data
    const promptsDataPath = path.join(__dirname, 'prompts-data.js');
    const content = fs.readFileSync(promptsDataPath, 'utf-8');

    // Parse the PROMPTS array
    const match = content.match(/const PROMPTS = (\[[\s\S]*\]);/);
    if (!match) {
        console.error('❌ Could not parse prompts-data.js');
        return;
    }

    const localPrompts = eval(match[1]);
    console.log(`📦 Found ${localPrompts.length} local prompts\n`);

    // Fetch all prompts from Supabase
    const { data: supabasePrompts, error: fetchError } = await supabase
        .from('prompts')
        .select('id, title');

    if (fetchError) {
        console.error('❌ Error fetching from Supabase:', fetchError);
        return;
    }

    console.log(`☁️  Found ${supabasePrompts.length} prompts in Supabase\n`);

    let successCount = 0;
    let errorCount = 0;

    // For each local prompt, find matching Supabase prompt and update ai_tags
    for (const localPrompt of localPrompts) {
        // Match by title (since IDs might differ between local and remote)
        const remotePrompt = supabasePrompts.find(p => p.title === localPrompt.title);

        if (!remotePrompt) {
            console.log(`⚠️  No match in Supabase for: ${localPrompt.title}`);
            continue;
        }

        // Check if local prompt has valid aiTags
        if (!localPrompt.aiTags || !localPrompt.aiTags.objects || localPrompt.aiTags.objects.en.length === 0) {
            console.log(`⏭️  Skipping (no aiTags): ${localPrompt.title}`);
            continue;
        }

        // Update Supabase
        const { error: updateError } = await supabase
            .from('prompts')
            .update({ ai_tags: localPrompt.aiTags })
            .eq('id', remotePrompt.id);

        if (updateError) {
            console.error(`❌ Error updating ${localPrompt.title}:`, updateError.message);
            errorCount++;
        } else {
            console.log(`✅ Updated: ${localPrompt.title}`);
            successCount++;
        }
    }

    console.log('\n' + '═'.repeat(50));
    console.log(`\n✅ Sync complete! ${successCount} updated, ${errorCount} errors.`);
}

syncAiTags().catch(console.error);
