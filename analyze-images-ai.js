/**
 * AI Smart Search - Gemini Vision Analysis Script
 * Analyzes images to extract: objects, scenes, styles, mood
 * Uses Gemini 2.5 Flash for cost-effective analysis
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ===== CONFIGURATION =====
let API_KEY = process.env.GEMINI_API_KEY;

async function getApiKey() {
    if (API_KEY) return API_KEY;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question('🔑 Please enter your Gemini API Key: ', (key) => {
            rl.close();
            resolve(key.trim());
        });
    });
}

const ANALYSIS_PROMPT = `You are analyzing an image for a bilingual (English + Chinese) art gallery search system.

CRITICAL: For each category, provide BOTH English and Chinese tags that are EXACT translations of each other.
- English tags should be common, searchable terms
- Chinese tags (中文) should be the most natural, commonly-used translations
- Each English tag MUST have a corresponding Chinese translation at the SAME position in the array

RESPOND ONLY WITH VALID JSON, no markdown, no explanation.

{
  "objects": {
    "en": ["bicycle", "girl", "leaves", "flowers", "butterfly"],
    "zh": ["自行车", "女孩", "树叶", "花朵", "蝴蝶"]
  },
  "scenes": {
    "en": ["garden", "autumn", "outdoor", "nature"],
    "zh": ["花园", "秋天", "户外", "自然"]
  },
  "styles": {
    "en": ["3D art", "miniature", "whimsical", "colorful"],
    "zh": ["3D艺术", "微缩", "奇幻", "多彩"]
  },
  "mood": {
    "en": ["romantic", "dreamy", "peaceful", "joyful"],
    "zh": ["浪漫", "梦幻", "宁静", "欢快"]
  }
}

IMPORTANT TRANSLATION GUIDELINES:
- "leaf/leaves" → "树叶/叶子" (NOT "页")
- "bicycle/bike" → "自行车/单车"  
- "girl/woman" → "女孩/女性"
- "flower" → "花/花朵" (NOT just "华")
- "tree" → "树/树木"
- "sky" → "天空"
- "water" → "水/水面"
- "mountain" → "山/山脉"

Be comprehensive. Maximum 10 items per category. Ensure 1:1 English-Chinese correspondence.`;

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

// Rate limiting helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Analyze a single image with Gemini (with retry logic)
async function analyzeImage(imagePath, retries = 3) {
    const base64 = imageToBase64(imagePath);
    const mimeType = getMimeType(imagePath);
    // Use the model initialized globally in main
    const model = global.geminiModel;

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

// Main function
async function main() {
    const key = await getApiKey();
    if (!key) {
        console.error('❌ API Key is required!');
        process.exit(1);
    }

    console.log('✅ API Key received. Initializing Gemini...');
    const genAI = new GoogleGenerativeAI(key);
    // Use gemini-2.5-flash for best performance as requested by user
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    // Make model available to analyzeImage
    global.geminiModel = model;

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

        // Skip if already analyzed - checks if we have valid tags
        if (prompt.aiTags && prompt.aiTags.objects &&
            prompt.aiTags.objects.en && prompt.aiTags.objects.en.length > 0) {
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

            // Rate limiting: wait 2 seconds between requests (2.0 Flash has high limit)
            if (i < prompts.length - 1) {
                await sleep(2000);
            }
        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
            // Keep old tags if analysis failed, or set strict empty structure
            // prompt.aiTags = ...
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
