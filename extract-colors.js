/**
 * Color Extraction Script for Prompts Gallery
 * Analyzes images and extracts dominant colors
 */

const getPixels = require('get-pixels');
const quantize = require('quantize');
const fs = require('fs');
const path = require('path');

// Color name mapping (RGB ranges to color names)
const COLOR_NAMES = {
    red: { h: [350, 10], s: [30, 100], l: [20, 80] },
    orange: { h: [10, 45], s: [30, 100], l: [30, 80] },
    yellow: { h: [45, 70], s: [30, 100], l: [40, 90] },
    green: { h: [70, 170], s: [20, 100], l: [20, 80] },
    cyan: { h: [170, 200], s: [30, 100], l: [30, 80] },
    blue: { h: [200, 260], s: [30, 100], l: [20, 80] },
    purple: { h: [260, 290], s: [30, 100], l: [20, 80] },
    pink: { h: [290, 350], s: [30, 100], l: [40, 85] },
    brown: { h: [10, 45], s: [20, 60], l: [15, 40] },
    black: { h: [0, 360], s: [0, 100], l: [0, 15] },
    white: { h: [0, 360], s: [0, 20], l: [85, 100] },
    gray: { h: [0, 360], s: [0, 20], l: [20, 80] },
};

// Convert RGB to HSL
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
}

// Get color name from HSL values
function getColorName(r, g, b) {
    const hsl = rgbToHsl(r, g, b);

    for (const [name, range] of Object.entries(COLOR_NAMES)) {
        // Handle hue wrap-around for red
        let hMatch = false;
        if (name === 'red') {
            hMatch = hsl.h >= 350 || hsl.h <= 10;
        } else {
            hMatch = hsl.h >= range.h[0] && hsl.h < range.h[1];
        }

        const sMatch = hsl.s >= range.s[0] && hsl.s <= range.s[1];
        const lMatch = hsl.l >= range.l[0] && hsl.l <= range.l[1];

        // Check black/white/gray first (they override hue)
        if (name === 'black' && hsl.l < 15) return 'black';
        if (name === 'white' && hsl.l > 85 && hsl.s < 20) return 'white';
        if (name === 'gray' && hsl.s < 20 && hsl.l >= 15 && hsl.l <= 85) return 'gray';

        if (hMatch && sMatch && lMatch) return name;
    }
    return 'unknown';
}

// Extract colors from image
function extractColors(imagePath) {
    return new Promise((resolve, reject) => {
        getPixels(imagePath, (err, pixels) => {
            if (err) {
                reject(err);
                return;
            }

            const data = pixels.data;
            const width = pixels.shape[0];
            const height = pixels.shape[1];
            const pixelArray = [];

            // Sample every 10th pixel for performance
            for (let i = 0; i < data.length; i += 40) { // 4 channels * 10
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const a = data[i + 3];

                // Skip transparent pixels
                if (a < 125) continue;

                pixelArray.push([r, g, b]);
            }

            // Use quantize to get color palette
            const colorMap = quantize(pixelArray, 5);
            if (!colorMap) {
                resolve(['gray']);
                return;
            }

            const palette = colorMap.palette();
            const colorNames = [];
            const seen = new Set();

            for (const [r, g, b] of palette) {
                const name = getColorName(r, g, b);
                if (name !== 'unknown' && !seen.has(name)) {
                    seen.add(name);
                    colorNames.push(name);
                }
            }

            resolve(colorNames.length > 0 ? colorNames.slice(0, 3) : ['gray']);
        });
    });
}

// Main function
async function main() {
    const promptsDataPath = path.join(__dirname, 'prompts-data.js');
    const assetsDir = path.join(__dirname, 'assets', 'prompts');

    // Read current prompts data
    let content = fs.readFileSync(promptsDataPath, 'utf-8');

    // Parse the PROMPTS array (simple extraction)
    const match = content.match(/const PROMPTS = (\[[\s\S]*\]);/);
    if (!match) {
        console.error('Could not parse prompts-data.js');
        return;
    }

    const prompts = eval(match[1]);
    console.log(`Found ${prompts.length} prompts to process`);

    // Process each prompt
    for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i];
        const firstImage = prompt.images[0];
        const imagePath = path.join(__dirname, firstImage);

        try {
            console.log(`[${i + 1}/${prompts.length}] Processing: ${prompt.title}`);
            const colors = await extractColors(imagePath);
            prompt.dominantColors = colors;
            console.log(`   Colors: ${colors.join(', ')}`);
        } catch (err) {
            console.error(`   Error: ${err.message}`);
            prompt.dominantColors = ['gray'];
        }
    }

    // Generate new content
    const newContent = `const PROMPTS = ${JSON.stringify(prompts, null, 4)};`;
    fs.writeFileSync(promptsDataPath, newContent);

    console.log('\n✅ Done! Updated prompts-data.js with color information.');
}

main().catch(console.error);
