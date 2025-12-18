/**
 * AI Smart Search - Gemini Vision Analysis Script
 * Analyzes images to extract: objects, scenes, styles, mood
 * Uses Gemini 2.0 Flash for cost-effective analysis
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// ===== CONFIGURATION =====
// Set your API key here or use environment variable
const API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBEypLb4JZKxsQlWI56gzE_WtM19kXv7NU';

if (API_KEY === 'YOUR_API_KEY_HERE') {
    console.error('❌ Please set your Gemini API key!');
    console.log('   Option 1: Set environment variable: export GEMINI_API_KEY="your-key"');
    console.log('   Option 2: Edit this file and replace YOUR_API_KEY_HERE');
    console.log('\n   Get your key at: https://aistudio.google.com/app/apikey');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);

// Use Gemini 2.5 Flash (latest and fastest model)
const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
});

const ANALYSIS_PROMPT = `Analyze this image and provide structured tags in JSON format.

RESPOND ONLY WITH VALID JSON, no markdown, no explanation.

{
  "objects": {
    "en": ["list of objects in English, e.g. bicycle, cat, coffee cup"],
    "zh": ["对应的中文物体名称，如 自行车, 猫, 咖啡杯"]
  },
  "scenes": {
    "en": ["scene/location types, e.g. beach, city, forest, indoor"],
    "zh": ["场景中文，如 海滩, 城市, 森林, 室内"]
  },
  "styles": {
    "en": ["art styles, e.g. watercolor, 3D render, minimalist, cyberpunk"],
    "zh": ["风格中文，如 水彩, 3D渲染, 极简主义, 赛博朋克"]
  },
  "mood": {
    "en": ["emotional atmosphere, e.g. warm, mysterious, energetic, peaceful"],
    "zh": ["情绪氛围中文，如 温馨, 神秘, 活力, 宁静"]
  }
}

Be comprehensive but concise. Maximum 8 items per category.`;

// Convert image to base64
function imageToBase64(imagePath) {
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
}

// Get MIME type from file extension
function getMimeType(imagePath) {
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
    };
    return mimeTypes[ext] || 'image/png';
}

// Analyze a single image with Gemini (with retry logic)
async function analyzeImage(imagePath, retries = 3) {
    const base64 = imageToBase64(imagePath);
    const mimeType = getMimeType(imagePath);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await model.generateContent([
                ANALYSIS_PROMPT,
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: base64,
                    },
                },
            ]);

            const response = result.response.text();

            // Clean up response (remove markdown code blocks if present)
            let jsonStr = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

            return JSON.parse(jsonStr);
        } catch (e) {
            if (e.message.includes('429') && attempt < retries) {
                const waitTime = attempt * 30000; // 30s, 60s, 90s
                console.log(`   ⏳ Rate limited, waiting ${waitTime / 1000}s before retry ${attempt + 1}/${retries}...`);
                await sleep(waitTime);
            } else if (attempt === retries) {
                throw e;
            }
        }
    }

    return {
        objects: { en: [], zh: [] },
        scenes: { en: [], zh: [] },
        styles: { en: [], zh: [] },
        mood: { en: [], zh: [] },
    };
}

// Rate limiting helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main function
async function main() {
    const promptsDataPath = path.join(__dirname, 'prompts-data.js');

    // Read current prompts data
    let content = fs.readFileSync(promptsDataPath, 'utf-8');

    // Parse the PROMPTS array
    const match = content.match(/const PROMPTS = (\[[\s\S]*\]);/);
    if (!match) {
        console.error('❌ Could not parse prompts-data.js');
        return;
    }

    const prompts = eval(match[1]);
    console.log(`🔍 Found ${prompts.length} prompts to analyze\n`);

    let successCount = 0;
    let errorCount = 0;

    // Process each prompt
    for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i];

        // Skip if already analyzed
        if (prompt.aiTags && prompt.aiTags.objects) {
            console.log(`[${i + 1}/${prompts.length}] ⏭️  ${prompt.title} - Already analyzed, skipping`);
            continue;
        }

        const firstImage = prompt.images[0];
        const imagePath = path.join(__dirname, firstImage);

        console.log(`[${i + 1}/${prompts.length}] 🖼️  ${prompt.title}`);

        try {
            const analysis = await analyzeImage(imagePath);

            // Merge with existing data
            prompt.aiTags = analysis;

            console.log(`   ✅ Objects: ${analysis.objects.en.slice(0, 3).join(', ')}...`);
            console.log(`   ✅ Scenes: ${analysis.scenes.en.join(', ')}`);
            console.log(`   ✅ Styles: ${analysis.styles.en.join(', ')}`);
            console.log(`   ✅ Mood: ${analysis.mood.en.join(', ')}`);

            successCount++;

            // Rate limiting: wait 10 seconds between requests
            if (i < prompts.length - 1) {
                await sleep(10000); // 10 seconds between requests
            }
        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
            prompt.aiTags = {
                objects: { en: [], zh: [] },
                scenes: { en: [], zh: [] },
                styles: { en: [], zh: [] },
                mood: { en: [], zh: [] },
            };
            errorCount++;
        }

        console.log('');
    }

    // Generate new content
    const newContent = `const PROMPTS = ${JSON.stringify(prompts, null, 4)};`;
    fs.writeFileSync(promptsDataPath, newContent);

    console.log('═'.repeat(50));
    console.log(`\n✅ Done! Analyzed ${successCount} images successfully.`);
    if (errorCount > 0) {
        console.log(`⚠️  ${errorCount} images had errors.`);
    }
    console.log(`\n📁 Updated: prompts-data.js`);
}

main().catch(console.error);
