/**
 * Translation Module for Admin Studio
 * Provides bidirectional translation (EN ↔️ ZH) using Gemini API
 */

const PromptTranslator = {
    /**
     * Detect if text contains Chinese characters
     */
    isChinese: function (text) {
        if (!text) return false;
        return /[\u4e00-\u9fff]/.test(text);
    },

    /**
     * Translate Chinese text to English
     */
    translateToEnglish: async function (text) {
        const apiKey = window.GEMINI_API_KEY;
        if (!apiKey) {
            console.warn('[PromptTranslator] No Gemini API key, skipping translation');
            return null;
        }

        if (!text || !this.isChinese(text)) {
            return null; // Skip if empty or already English
        }

        const prompt = `Translate the following Chinese text to English. Return ONLY the English translation, no markdown or extra text.

Text: ${text}`;

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
                })
            });

            const data = await response.json();
            const translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
            console.log('[PromptTranslator] EN translation:', translation);
            return translation;
        } catch (err) {
            console.error('[PromptTranslator] Translation to English failed:', err);
            return null;
        }
    },

    /**
     * Translate English text to Chinese
     */
    translateToChinese: async function (text) {
        const apiKey = window.GEMINI_API_KEY;
        if (!apiKey) {
            console.warn('[PromptTranslator] No Gemini API key, skipping translation');
            return null;
        }

        if (!text || this.isChinese(text)) {
            return null; // Skip if empty or already Chinese
        }

        const prompt = `Translate the following English text to Chinese. Return ONLY the Chinese translation, no markdown or extra text.

Text: ${text}`;

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
                })
            });

            const data = await response.json();
            const translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
            console.log('[PromptTranslator] ZH translation:', translation);
            return translation;
        } catch (err) {
            console.error('[PromptTranslator] Translation to Chinese failed:', err);
            return null;
        }
    },

    /**
     * Translate all prompt fields bidirectionally
     * Returns object with translated fields
     */
    translatePromptFields: async function (promptData) {
        const result = { ...promptData };
        const translations = {};

        // Detect input language and translate accordingly
        const titleIsChinese = this.isChinese(promptData.title);
        const descIsChinese = this.isChinese(promptData.description);
        const promptIsChinese = this.isChinese(promptData.prompt_text);

        try {
            // Title
            if (promptData.title) {
                if (titleIsChinese && !promptData.title_en) {
                    translations.title_en = await this.translateToEnglish(promptData.title);
                } else if (!titleIsChinese && !promptData.title_zh) {
                    translations.title_zh = await this.translateToChinese(promptData.title);
                }
            }

            // Description
            if (promptData.description) {
                if (descIsChinese && !promptData.description_en) {
                    translations.description_en = await this.translateToEnglish(promptData.description);
                } else if (!descIsChinese && !promptData.description_zh) {
                    translations.description_zh = await this.translateToChinese(promptData.description);
                }
            }

            // Prompt Text
            if (promptData.prompt_text) {
                if (promptIsChinese && !promptData.prompt_text_en) {
                    translations.prompt_text_en = await this.translateToEnglish(promptData.prompt_text);
                } else if (!promptIsChinese && !promptData.prompt_text_zh) {
                    translations.prompt_text_zh = await this.translateToChinese(promptData.prompt_text);
                }
            }

            return { ...result, ...translations };
        } catch (err) {
            console.error('[PromptTranslator] Translation failed:', err);
            return result; // Return original data if translation fails
        }
    }
};

// Make available globally
window.PromptTranslator = PromptTranslator;
