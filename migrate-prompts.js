// Migration script: prompts-data.js -> Supabase prompts table
import { supabase } from './supabase-client.js';
import { readFileSync } from 'fs';

// Read prompts data file
const fileContent = readFileSync('./prompts-data.js', 'utf8');

// Extract PROMPTS array (safely using regex since it's a JS file, not JSON)
const match = fileContent.match(/const PROMPTS = (\[[\s\S]*\]);/);
if (!match) {
    console.error('❌ Failed to parse prompts-data.js');
    process.exit(1);
}

// Evaluate the array (it's valid JS, so eval is safe here for this migration)
let PROMPTS;
try {
    PROMPTS = eval(match[1]);
    console.log(`📄 Found ${PROMPTS.length} prompts to migrate.`);
} catch (e) {
    console.error('❌ Failed to evaluate PROMPTS array:', e.message);
    process.exit(1);
}

async function migratePrompts() {
    console.log('🚀 Starting migration to Supabase...');

    // Transform data for Supabase
    const supabaseData = PROMPTS.map((p, index) => ({
        id: index + 1, // Use sequential IDs
        title: p.title,
        description: p.description || null,
        prompt: p.prompt || null,
        tags: p.tags || [],
        images: p.images || [],
        author_name: p.authorName || 'Banana Prompt',
        author_avatar: p.authorAvatar || null
    }));

    // Insert into Supabase (upsert to avoid duplicates on re-run)
    const { data, error } = await supabase
        .from('prompts')
        .upsert(supabaseData, { onConflict: 'id' });

    if (error) {
        console.error('❌ Migration failed:', error.message);
        console.log('Error details:', error);
        process.exit(1);
    }

    console.log(`✅ Successfully migrated ${supabaseData.length} prompts to Supabase!`);

    // Quick verification
    const { count } = await supabase
        .from('prompts')
        .select('*', { count: 'exact', head: true });

    console.log(`📊 Total prompts in database: ${count}`);
}

migratePrompts();
