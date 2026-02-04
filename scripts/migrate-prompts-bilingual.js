/**
 * Migration Script: Translate existing prompts to bilingual format
 * 
 * Reads all prompts from Supabase, uses Gemini API to translate
 * Chinese titles/descriptions to English, then updates the database.
 * 
 * Usage: node scripts/migrate-prompts-bilingual.js
 */

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Configuration - read from environment
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mmkugdibsaeoevliebzk.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_lwkiF-sQ80z8e9oMcejFPQ_j7oezjcF';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

if (!GEMINI_API_KEY) {
    console.error('Error: Please set GEMINI_API_KEY environment variable');
    console.error('Example: GEMINI_API_KEY=your_key node scripts/migrate-prompts-bilingual.js');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

/**
 * Translate text from Chinese to English using Gemini
 */
async function translateToEnglish(text, context = '') {
    if (!text || text.trim() === '') return '';

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Translate the following Chinese text to English. 
Keep the translation natural and professional.
${context ? `Context: This is a ${context} for an AI-generated prompt/artwork.` : ''}
Only return the English translation, no explanations.

Text to translate:
${text}`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error(`Translation error for "${text.substring(0, 50)}...":`, error.message);
        return text; // Return original on error
    }
}

/**
 * Process a single prompt - translate and update
 */
async function migratePrompt(prompt) {
    console.log(`\n📝 Processing prompt #${prompt.id}: ${prompt.title || 'Untitled'}`);

    const updates = {};

    // Determine source language and translate
    // Assume existing data is Chinese, translate to English

    // Title translation
    if (prompt.title && (!prompt.title_en || prompt.title_en === prompt.title)) {
        console.log('   Translating title...');
        updates.title_en = await translateToEnglish(prompt.title, 'title');
        updates.title_zh = prompt.title; // Keep original as Chinese
        console.log(`   ✓ Title EN: ${updates.title_en}`);
    }

    // Description translation  
    if (prompt.description && (!prompt.description_en || prompt.description_en === prompt.description)) {
        console.log('   Translating description...');
        updates.description_en = await translateToEnglish(prompt.description, 'description');
        updates.description_zh = prompt.description; // Keep original as Chinese
        console.log(`   ✓ Description EN: ${updates.description_en?.substring(0, 80)}...`);
    }

    // Prompt text translation
    if (prompt.prompt_text && (!prompt.prompt_text_en || prompt.prompt_text_en === prompt.prompt_text)) {
        console.log('   Translating prompt text...');
        updates.prompt_text_en = await translateToEnglish(prompt.prompt_text, 'prompt/instructions');
        updates.prompt_text_zh = prompt.prompt_text; // Keep original as Chinese
        console.log(`   ✓ Prompt text translated`);
    }

    // Update database if there are changes
    if (Object.keys(updates).length > 0) {
        const { error } = await supabase
            .from('prompts')
            .update(updates)
            .eq('id', prompt.id);

        if (error) {
            console.error(`   ❌ Update failed:`, error.message);
            return false;
        }
        console.log(`   ✅ Updated prompt #${prompt.id}`);
        return true;
    } else {
        console.log('   ⏭️  Already translated, skipping');
        return false;
    }
}

/**
 * Main migration function
 */
async function runMigration() {
    console.log('🚀 Starting bilingual migration for prompts...\n');

    // Fetch all prompts
    const { data: prompts, error } = await supabase
        .from('prompts')
        .select('*')
        .order('id', { ascending: true });

    if (error) {
        console.error('Failed to fetch prompts:', error.message);
        process.exit(1);
    }

    console.log(`📊 Found ${prompts.length} prompts to process\n`);

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const prompt of prompts) {
        try {
            const wasUpdated = await migratePrompt(prompt);
            if (wasUpdated) updated++;
            else skipped++;

            // Rate limiting - wait 500ms between API calls
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
            console.error(`   ❌ Error processing prompt #${prompt.id}:`, err.message);
            failed++;
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Migration Summary:');
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log('='.repeat(50));
}

// Run the migration
runMigration().catch(console.error);
