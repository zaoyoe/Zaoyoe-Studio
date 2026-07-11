/**
 * Translation Module for Admin Studio
 * Provides bidirectional translation (EN ↔️ ZH) using the configured admin AI provider
 */

const PromptTranslator = {
    normalizeTranslationText: function (value) {
        if (value === undefined || value === null) return null;
        const normalized = String(value).trim();
        return normalized || null;
    },

    parseJsonResponse: function (text) {
        let jsonStr = String(text || '').trim();
        if (!jsonStr) {
            throw new Error('Empty translation response');
        }

        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
        }

        return JSON.parse(jsonStr);
    },

    getPromptBilingualCoverage: function (promptData = {}) {
        return {
            zh: Boolean(this.normalizeTranslationText(promptData.title_zh)
                || this.normalizeTranslationText(promptData.description_zh)
                || this.normalizeTranslationText(promptData.prompt_text_zh)),
            en: Boolean(this.normalizeTranslationText(promptData.title_en)
                || this.normalizeTranslationText(promptData.description_en)
                || this.normalizeTranslationText(promptData.prompt_text_en))
        };
    },

    seedCoverageFields: function (promptData = {}) {
        const seeded = {};

        const title = this.normalizeTranslationText(promptData.title);
        const description = this.normalizeTranslationText(promptData.description);
        const promptText = this.normalizeTranslationText(promptData.prompt_text);

        if (!this.normalizeTranslationText(promptData.title_zh) && title && this.isChinese(title)) {
            seeded.title_zh = title;
        }
        if (!this.normalizeTranslationText(promptData.title_en) && title && !this.isChinese(title)) {
            seeded.title_en = title;
        }

        if (!this.normalizeTranslationText(promptData.description_zh) && description && this.isChinese(description)) {
            seeded.description_zh = description;
        }
        if (!this.normalizeTranslationText(promptData.description_en) && description && !this.isChinese(description)) {
            seeded.description_en = description;
        }

        if (!this.normalizeTranslationText(promptData.prompt_text_zh) && promptText && this.isChinese(promptText)) {
            seeded.prompt_text_zh = promptText;
        }
        if (!this.normalizeTranslationText(promptData.prompt_text_en) && promptText && !this.isChinese(promptText)) {
            seeded.prompt_text_en = promptText;
        }

        return seeded;
    },

    buildCoverageTranslationTargets: function (promptData = {}, seededFields = {}) {
        const merged = { ...promptData, ...seededFields };
        const coverage = this.getPromptBilingualCoverage(merged);
        const targets = {};

        if (!coverage.zh) {
            const title = this.normalizeTranslationText(merged.title);
            const description = this.normalizeTranslationText(merged.description);
            const promptText = this.normalizeTranslationText(merged.prompt_text);

            if (!this.normalizeTranslationText(merged.title_zh) && title && !this.isChinese(title)) {
                targets.title_zh = title;
            } else if (!this.normalizeTranslationText(merged.description_zh) && description && !this.isChinese(description)) {
                targets.description_zh = description;
            } else if (!this.normalizeTranslationText(merged.prompt_text_zh) && promptText && !this.isChinese(promptText)) {
                targets.prompt_text_zh = promptText;
            }
        }

        if (!coverage.en) {
            const title = this.normalizeTranslationText(merged.title);
            const description = this.normalizeTranslationText(merged.description);
            const promptText = this.normalizeTranslationText(merged.prompt_text);

            if (!this.normalizeTranslationText(merged.title_en) && title && this.isChinese(title)) {
                targets.title_en = title;
            } else if (!this.normalizeTranslationText(merged.description_en) && description && this.isChinese(description)) {
                targets.description_en = description;
            } else if (!this.normalizeTranslationText(merged.prompt_text_en) && promptText && this.isChinese(promptText)) {
                targets.prompt_text_en = promptText;
            }
        }

        return targets;
    },

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
    translateToEnglish: async function (text, options = {}) {
        if (!window.AdminAI?.configured) {
            console.warn('[PromptTranslator] No server AI proxy, skipping translation');
            return null;
        }

        if (!text || !this.isChinese(text)) {
            return null; // Skip if empty or already English
        }

        const prompt = `Translate the following Chinese text to English. Return ONLY the English translation, no markdown or extra text.

Text: ${text}`;

        try {
            const translation = await window.AdminAI.generateText(prompt, {
                model: window.AdminAI?.defaultModel || 'gemini-2.0-flash',
                generationConfig: { temperature: 0.1, maxOutputTokens: 1000 },
                budget: {
                    tier: 'lean',
                    maxInputChars: 5000,
                    maxOutputTokens: 1000
                }
            });
            const normalized = translation?.trim() || null;
            console.log('[PromptTranslator] EN translation:', normalized);
            return normalized;
        } catch (err) {
            console.error('[PromptTranslator] Translation to English failed:', err);
            if (options.rethrow === true) {
                throw err;
            }
            return null;
        }
    },

    /**
     * Translate English text to Chinese
     */
    translateToChinese: async function (text, options = {}) {
        if (!window.AdminAI?.configured) {
            console.warn('[PromptTranslator] No server AI proxy, skipping translation');
            return null;
        }

        if (!text || this.isChinese(text)) {
            return null; // Skip if empty or already Chinese
        }

        const prompt = `Translate the following English text to Chinese. Return ONLY the Chinese translation, no markdown or extra text.

Text: ${text}`;

        try {
            const translation = await window.AdminAI.generateText(prompt, {
                model: window.AdminAI?.defaultModel || 'gemini-2.0-flash',
                generationConfig: { temperature: 0.1, maxOutputTokens: 1000 },
                budget: {
                    tier: 'lean',
                    maxInputChars: 5000,
                    maxOutputTokens: 1000
                }
            });
            const normalized = translation?.trim() || null;
            console.log('[PromptTranslator] ZH translation:', normalized);
            return normalized;
        } catch (err) {
            console.error('[PromptTranslator] Translation to Chinese failed:', err);
            if (options.rethrow === true) {
                throw err;
            }
            return null;
        }
    },

    /**
     * Translate all prompt fields bidirectionally
     * Returns object with translated fields
     */
    translatePromptFields: async function (promptData, options = {}) {
        const result = { ...promptData };
        const translations = {};
        const mode = String(options?.mode || 'full').trim().toLowerCase();

        // Detect input language and translate accordingly
        const titleIsChinese = this.isChinese(promptData.title);
        const descIsChinese = this.isChinese(promptData.description);
        const promptIsChinese = this.isChinese(promptData.prompt_text);

        if (mode === 'coverage') {
            Object.assign(translations, this.seedCoverageFields(promptData));

            const coverageTargets = this.buildCoverageTranslationTargets(promptData, translations);
            const targetEntries = Object.entries(coverageTargets);

            if (targetEntries.length === 0) {
                return { ...result, ...translations };
            }

            try {
                await Promise.all(targetEntries.map(async ([fieldName, sourceText]) => {
                    if (fieldName.endsWith('_zh')) {
                        const value = await this.translateToChinese(sourceText, { rethrow: true });
                        if (value) translations[fieldName] = value;
                        return;
                    }
                    const value = await this.translateToEnglish(sourceText, { rethrow: true });
                    if (value) translations[fieldName] = value;
                }));
            } catch (err) {
                console.error('[PromptTranslator] Coverage translation failed:', err);
                throw err;
            }

            const coverageAfter = this.getPromptBilingualCoverage({
                ...promptData,
                ...translations
            });

            if (!coverageAfter.zh || !coverageAfter.en) {
                const unresolvedFields = [];
                if (!coverageAfter.zh) unresolvedFields.push('zh');
                if (!coverageAfter.en) unresolvedFields.push('en');
                throw new Error(`AI translation could not establish coverage: ${unresolvedFields.join(', ')}`);
            }

            return { ...result, ...translations };
        }

        const needsTranslation = {
            title_en: Boolean(promptData.title && titleIsChinese && !promptData.title_en),
            title_zh: Boolean(promptData.title && !titleIsChinese && !promptData.title_zh),
            description_en: Boolean(promptData.description && descIsChinese && !promptData.description_en),
            description_zh: Boolean(promptData.description && !descIsChinese && !promptData.description_zh),
            prompt_text_en: Boolean(promptData.prompt_text && promptIsChinese && !promptData.prompt_text_en),
            prompt_text_zh: Boolean(promptData.prompt_text && !promptIsChinese && !promptData.prompt_text_zh)
        };

        const getMissingTranslationFields = () => Object.keys(needsTranslation).filter((fieldName) => (
            needsTranslation[fieldName] && !this.normalizeTranslationText(translations[fieldName])
        ));

        if (!Object.values(needsTranslation).some(Boolean)) {
            return result;
        }

        const jsonPrompt = `You are filling missing bilingual copy for an admin prompt editor.
Return ONLY valid JSON with the following shape:
{
  "title_zh": "",
  "title_en": "",
  "description_zh": "",
  "description_en": "",
  "prompt_text_zh": "",
  "prompt_text_en": ""
}

Rules:
- Only fill fields marked as missing in the input.
- Keep fields that do not need translation as empty strings.
- Preserve meaning faithfully and do not add commentary.
- For prompt_text fields, translate the full prompt text, not a summary.

Input:
${JSON.stringify({
            title: promptData.title || '',
            description: promptData.description || '',
            prompt_text: promptData.prompt_text || '',
            existing: {
                title_zh: promptData.title_zh || '',
                title_en: promptData.title_en || '',
                description_zh: promptData.description_zh || '',
                description_en: promptData.description_en || '',
                prompt_text_zh: promptData.prompt_text_zh || '',
                prompt_text_en: promptData.prompt_text_en || ''
            },
            missing: needsTranslation
        })}`;

        try {
            const text = await window.AdminAI.generateText(jsonPrompt, {
                model: window.AdminAI?.defaultModel || 'gemini-2.0-flash',
                generationConfig: { temperature: 0.1, maxOutputTokens: 1600 },
                budget: {
                    tier: 'expanded',
                    maxInputChars: 24000,
                    maxOutputTokens: 1600
                }
            });
            const parsed = this.parseJsonResponse(text);

            Object.keys(needsTranslation).forEach((fieldName) => {
                if (!needsTranslation[fieldName]) return;
                const normalized = this.normalizeTranslationText(parsed?.[fieldName]);
                if (normalized) {
                    translations[fieldName] = normalized;
                }
            });

            if (getMissingTranslationFields().length === 0) {
                return { ...result, ...translations };
            }
        } catch (err) {
            console.error('[PromptTranslator] Batched translation failed, falling back:', err);
        }

        try {
            const translationTasks = [];

            if (needsTranslation.title_en) {
                translationTasks.push(
                    this.translateToEnglish(promptData.title).then((value) => {
                        if (value) translations.title_en = value;
                    })
                );
            }
            if (needsTranslation.title_zh) {
                translationTasks.push(
                    this.translateToChinese(promptData.title).then((value) => {
                        if (value) translations.title_zh = value;
                    })
                );
            }
            if (needsTranslation.description_en) {
                translationTasks.push(
                    this.translateToEnglish(promptData.description).then((value) => {
                        if (value) translations.description_en = value;
                    })
                );
            }
            if (needsTranslation.description_zh) {
                translationTasks.push(
                    this.translateToChinese(promptData.description).then((value) => {
                        if (value) translations.description_zh = value;
                    })
                );
            }
            if (needsTranslation.prompt_text_en) {
                translationTasks.push(
                    this.translateToEnglish(promptData.prompt_text).then((value) => {
                        if (value) translations.prompt_text_en = value;
                    })
                );
            }
            if (needsTranslation.prompt_text_zh) {
                translationTasks.push(
                    this.translateToChinese(promptData.prompt_text).then((value) => {
                        if (value) translations.prompt_text_zh = value;
                    })
                );
            }

            await Promise.all(translationTasks);
            const unresolvedFields = getMissingTranslationFields();
            if (unresolvedFields.length > 0) {
                throw new Error(`AI translation returned empty fields: ${unresolvedFields.join(', ')}`);
            }

            return { ...result, ...translations };
        } catch (err) {
            console.error('[PromptTranslator] Translation failed:', err);
            throw err;
        }
    }
};

// Make available globally
window.PromptTranslator = PromptTranslator;
