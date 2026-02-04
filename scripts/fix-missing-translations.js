/**
 * Batch Translation Script for Existing Prompts
 * Fixes the 4 prompts that are missing Chinese translations
 * Run this in browser console on Admin Studio Gallery page
 */

async function fixMissingTranslations() {
    console.log('🌐 Starting batch translation for missing prompts...\n');

    // Check if translation module is available
    if (!window.PromptTranslator) {
        console.error('❌ PromptTranslator not found! Make sure you are on Admin Studio Gallery page.');
        return;
    }

    if (!window.GEMINI_API_KEY) {
        console.error('❌ GEMINI_API_KEY not configured! Please set your API key first.');
        return;
    }

    // Prompts that need Chinese translation (updated based on actual database contents)
    const promptsToFix = [
        { id: 10, title: 'KDA' },
        { id: 12, title: "Poodle's Lion Reflection" },
        { id: 13, title: "children's book" }
    ];

    let successCount = 0;
    let failCount = 0;

    for (const prompt of promptsToFix) {
        try {
            console.log(`\n📝 Processing ID ${prompt.id}: "${prompt.title}"...`);

            // Fetch current prompt data
            const { data: currentData, error: fetchError } = await window.supabaseClient
                .from('prompts')
                .select('*')
                .eq('id', prompt.id)
                .single();

            if (fetchError) {
                throw new Error(`Failed to fetch prompt: ${fetchError.message}`);
            }

            console.log(`   Current title_zh: ${currentData.title_zh || '(empty)'}`);

            // Translate title, description, and prompt_text
            const updates = {};

            // Translate title (if missing Chinese or if Chinese field contains English)
            if (currentData.title && !PromptTranslator.isChinese(currentData.title)) {
                const needsTranslation = !currentData.title_zh || !PromptTranslator.isChinese(currentData.title_zh);
                if (needsTranslation) {
                    const title_zh = await PromptTranslator.translateToChinese(currentData.title);
                    if (title_zh) {
                        updates.title_zh = title_zh;
                        console.log(`   ✅ Translated title: ${title_zh}`);
                    }
                }
            }

            // Translate description (if missing Chinese or if Chinese field contains English)
            if (currentData.description && !PromptTranslator.isChinese(currentData.description)) {
                const needsTranslation = !currentData.description_zh || !PromptTranslator.isChinese(currentData.description_zh);
                if (needsTranslation) {
                    const description_zh = await PromptTranslator.translateToChinese(currentData.description);
                    if (description_zh) {
                        updates.description_zh = description_zh;
                        console.log(`   ✅ Translated description: ${description_zh.substring(0, 50)}...`);
                    }
                }
            }

            // Translate prompt_text (if missing Chinese or if Chinese field contains English)
            if (currentData.prompt_text && !PromptTranslator.isChinese(currentData.prompt_text)) {
                const needsTranslation = !currentData.prompt_text_zh || !PromptTranslator.isChinese(currentData.prompt_text_zh);
                if (needsTranslation) {
                    const prompt_text_zh = await PromptTranslator.translateToChinese(currentData.prompt_text);
                    if (prompt_text_zh) {
                        updates.prompt_text_zh = prompt_text_zh;
                        console.log(`   ✅ Translated prompt_text (${prompt_text_zh.length} chars)`);
                    }
                }
            }

            // Update database if we have translations
            if (Object.keys(updates).length > 0) {
                const { error: updateError } = await window.supabaseClient
                    .from('prompts')
                    .update(updates)
                    .eq('id', prompt.id);

                if (updateError) {
                    throw new Error(`Failed to update database: ${updateError.message}`);
                }

                console.log(`   💾 Saved to database`);
                successCount++;
            } else {
                console.log(`   ⚠️  No translations needed (already has Chinese)`);
                successCount++;
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            console.error(`   ❌ Failed: ${error.message}`);
            failCount++;
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`✨ Batch translation complete!`);
    console.log(`   Success: ${successCount}/${promptsToFix.length}`);
    console.log(`   Failed: ${failCount}/${promptsToFix.length}`);
    console.log(`${'='.repeat(50)}`);

    if (successCount === promptsToFix.length) {
        console.log('\n🎉 All prompts translated successfully!');
        console.log('🔄 Refresh the page to see updated translations.');
    }
}

// Run the script
fixMissingTranslations();
