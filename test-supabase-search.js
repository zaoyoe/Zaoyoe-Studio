// Test Supabase Full-Text Search
import { supabase } from './supabase-client.js';

async function testSearch(query) {
    console.log(`🔍 Searching for: "${query}"`);

    // PostgreSQL Full-Text Search query
    const { data, error } = await supabase
        .from('prompts')
        .select('id, title, tags')
        .textSearch('fts', query, {
            type: 'websearch',
            config: 'english'
        })
        .limit(5);

    if (error) {
        console.error('❌ Search failed:', error.message);
        return;
    }

    if (data.length === 0) {
        console.log('📭 No results found.');
    } else {
        console.log(`✅ Found ${data.length} results:`);
        data.forEach((p, i) => {
            console.log(`  ${i + 1}. [ID ${p.id}] ${p.title} (Tags: ${p.tags.join(', ')})`);
        });
    }
}

// Test with multiple queries
async function runTests() {
    await testSearch('fashion'); // Should find fashion-related prompts
    console.log('---');
    await testSearch('3D'); // Should find 3D Art prompts
    console.log('---');
    await testSearch('child'); // Should find children's book prompt
}

runTests();
