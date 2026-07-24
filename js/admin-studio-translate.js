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

    getCanonicalPromptLanguage: function (text = '') {
        const source = String(text || '');
        const cjkCount = (source.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
        const latinCount = (source.match(/[a-z]/gi) || []).length;
        if (cjkCount >= 4 && cjkCount >= latinCount * 0.15) return 'zh';
        if (latinCount >= 8) return 'en';
        return cjkCount > 0 ? 'zh' : '';
    },

    extractCanonicalMediaHeaders: function (text = '') {
        return Array.from(String(text || '').matchAll(/\[(?:IMAGE|VIDEO)\s*·\s*\d{1,3}\]/gi))
            .map((match) => match[0]);
    },

    extractPromptStructureTokens: function (text = '') {
        const source = String(text || '');
        const patterns = [
            /\bP(?:\d{1,3}\b|#{1,3})/gi,
            /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
            /\b\d+(?:\.\d+)?(?:\s*[-–—]\s*\d+(?:\.\d+)?)?\s*(?:ms|s|sec|secs|second|seconds|秒|毫秒)\b/gi,
            /\b\d+(?:\.\d+)?%(?!\w)/g,
            /\b\d{1,2}:\d{1,2}\b/g
        ];
        return [...new Set(patterns.flatMap((pattern) => source.match(pattern) || []).map((token) => token.toLowerCase()))];
    },

    splitCanonicalPromptText: function (text = '', maxChars = 4200) {
        const source = String(text || '').trim();
        if (!source) return [];

        const chunkLimit = Math.max(64, Number(maxChars) || 4200);
        if (source.length <= chunkLimit) return [source];

        const chunks = [];
        let remaining = source;
        while (remaining.length > chunkLimit) {
            const windowText = remaining.slice(0, chunkLimit + 1);
            const minimumCut = Math.max(32, Math.floor(chunkLimit * 0.55));
            let cutIndex = 0;
            const mediaHeaderCuts = Array.from(windowText.matchAll(/\n(?=\[(?:IMAGE|VIDEO)\s*·\s*\d{1,3}\])/gi))
                .map((match) => match.index + 1)
                .filter((index) => index >= minimumCut && index <= chunkLimit);
            if (mediaHeaderCuts.length) cutIndex = Math.max(...mediaHeaderCuts);

            for (const separator of ['\r\n\r\n', '\n\n', '\r\n', '\n', '. ', '! ', '? ', '。', '！', '？', '; ', '；', ', ', '，', ' ']) {
                if (cutIndex) break;
                const separatorIndex = windowText.lastIndexOf(separator);
                const candidateCut = separatorIndex + separator.length;
                if (separatorIndex >= 0 && candidateCut >= minimumCut && candidateCut <= chunkLimit) {
                    cutIndex = candidateCut;
                }
            }
            if (!cutIndex) cutIndex = chunkLimit;
            const chunk = remaining.slice(0, cutIndex).trim();
            if (chunk) chunks.push(chunk);
            remaining = remaining.slice(cutIndex).trim();
        }
        if (remaining) chunks.push(remaining);
        return chunks;
    },

    protectCanonicalPromptTokens: function (text = '') {
        const source = String(text || '');
        let tokenPrefix = 'FK_CANONICAL_TOKEN';
        while (source.includes(`__${tokenPrefix}_`)) tokenPrefix += 'X';

        const tokens = [];
        const tokenPattern = /\[(?:IMAGE|VIDEO)\s*·\s*\d{1,3}\]|\bP(?:\d{1,3}\b|#{1,3})|\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?)?|\b\d+(?:\.\d+)?(?:\s*[-–—]\s*\d+(?:\.\d+)?)?\s*(?:ms|s|sec|secs|second|seconds|秒|毫秒)\b|\b\d{1,2}\s*:\s*\d{1,2}\b|\b\d+(?:\.\d+)?%(?!\w)|\b\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\b|[-+]?\b\d+(?:\.\d+)?(?:e[-+]?\d+)?(?![\d.])/gi;
        const protectedText = source.replace(tokenPattern, (value) => {
            const placeholder = `__${tokenPrefix}_${String(tokens.length + 1).padStart(4, '0')}__`;
            tokens.push({ placeholder, value });
            return placeholder;
        });

        return { protectedText, tokens, tokenPrefix };
    },

    restoreCanonicalPromptTokens: function (translatedText = '', protection = {}) {
        let restored = String(translatedText || '').trim();
        const tokens = Array.isArray(protection?.tokens) ? protection.tokens : [];
        for (const token of tokens) {
            const occurrenceCount = restored.split(token.placeholder).length - 1;
            if (occurrenceCount !== 1) {
                throw new Error(`完整提示词翻译改写了结构占位符：${token.value}`);
            }
        }
        for (const token of tokens) {
            restored = restored.replace(token.placeholder, token.value);
        }

        const unresolvedPrefix = String(protection?.tokenPrefix || '').trim();
        if (unresolvedPrefix && restored.includes(`__${unresolvedPrefix}_`)) {
            throw new Error('完整提示词翻译包含无法恢复的结构占位符');
        }
        return restored.trim();
    },

    validateCanonicalPromptTranslation: function (sourceText = '', translatedText = '') {
        const source = String(sourceText || '').trim();
        const translated = String(translatedText || '').trim();
        if (!source || !translated) {
            throw new Error('完整提示词翻译为空');
        }

        const expectedHeaders = this.extractCanonicalMediaHeaders(source);
        const actualHeaders = this.extractCanonicalMediaHeaders(translated);
        if (expectedHeaders.length && JSON.stringify(actualHeaders) !== JSON.stringify(expectedHeaders)) {
            throw new Error('完整提示词翻译丢失图片或视频段落');
        }
        if (/(?:\.{3}|…)\s*$/.test(translated)) {
            throw new Error('完整提示词翻译疑似被截断');
        }

        const sourceLength = source.replace(/\s/g, '').length;
        const translatedLength = translated.replace(/\s/g, '').length;
        if (sourceLength >= 240 && translatedLength < Math.ceil(sourceLength * 0.2)) {
            throw new Error('完整提示词翻译明显短于源提示词');
        }

        const translatedLower = translated.toLowerCase();
        const missingTokens = this.extractPromptStructureTokens(source)
            .filter((token) => !translatedLower.includes(token));
        if (missingTokens.length) {
            throw new Error(`完整提示词翻译丢失结构标记：${missingTokens.slice(0, 8).join(', ')}`);
        }
        return translated;
    },

    translateCanonicalPromptChunk: async function (sourceChunk = '', targetLanguage = 'Chinese', options = {}) {
        const source = String(sourceChunk || '').trim();
        if (!source) throw new Error('完整提示词分段为空');
        const maxAttempts = Math.max(1, Number(options.maxAttempts) || 3);
        const protection = this.protectCanonicalPromptTokens(source);

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const prompt = `Translate the source prompt chunk completely into ${targetLanguage}.
Return ONLY the translated prompt, with no markdown fence, label, summary, or commentary.
Translate every sentence and line. Do not shorten, omit, paraphrase, or add instructions.
Tokens matching __${protection.tokenPrefix}_NNNN__ are protected placeholders. Copy every placeholder exactly once and never translate, reformat, duplicate, or remove it. Keep media section headers in their original order. Other placeholders may move only when required by natural ${targetLanguage} grammar.
Preserve paragraph and line structure.

Source prompt chunk:
${protection.protectedText}`;

            // Provider and transport errors must reach the outer adaptive scheduler unchanged.
            const response = await window.AdminAI.generateText(prompt, {
                model: window.AdminAI?.defaultModel || 'gemini-2.0-flash',
                generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
                budget: {
                    tier: 'longform',
                    maxInputChars: 24000,
                    maxOutputTokens: 8192
                }
            });

            try {
                const protectedTranslation = String(response || '').trim()
                    .replace(/^```(?:text)?\s*/i, '')
                    .replace(/```$/i, '')
                    .trim();
                const translated = this.restoreCanonicalPromptTokens(protectedTranslation, protection);
                this.validateCanonicalPromptTranslation(source, translated);
                return translated;
            } catch (error) {
                error.code = error.code || 'CANONICAL_PROMPT_VALIDATION_FAILED';
                error.chunkAttempt = attempt;
                if (attempt >= maxAttempts) throw error;
            }
        }

        throw new Error('完整提示词分段翻译重试次数已耗尽');
    },

    translateCanonicalPromptChunks: async function (chunks = [], targetLanguage = 'Chinese', options = {}) {
        const sourceChunks = Array.isArray(chunks) ? chunks.filter((chunk) => String(chunk || '').trim()) : [];
        if (!sourceChunks.length) return [];

        const translatedChunks = new Array(sourceChunks.length);
        const parallelism = Math.max(1, Math.min(
            Number(options.parallelism) || 3,
            sourceChunks.length,
            3
        ));
        let nextIndex = 0;
        let firstError = null;
        const workers = Array.from({ length: parallelism }, async () => {
            while (!firstError) {
                const chunkIndex = nextIndex;
                nextIndex += 1;
                if (chunkIndex >= sourceChunks.length) return;
                try {
                    translatedChunks[chunkIndex] = await this.translateCanonicalPromptChunk(
                        sourceChunks[chunkIndex],
                        targetLanguage,
                        { maxAttempts: options.maxAttempts }
                    );
                } catch (error) {
                    firstError = firstError || error;
                }
            }
        });
        await Promise.all(workers);
        if (firstError) throw firstError;
        return translatedChunks;
    },

    translateCanonicalPromptText: async function (sourceText = '') {
        if (!window.AdminAI?.configured) {
            throw new Error('请先配置可用的 AI 翻译服务');
        }
        const source = String(sourceText || '').trim();
        if (!source) throw new Error('源提示词为空');
        if (source.length > 20000) throw new Error('源提示词超过 20000 字符，需人工处理');

        const sourceLanguage = this.getCanonicalPromptLanguage(source);
        if (!sourceLanguage) throw new Error('无法识别源提示词语言');
        const targetLanguage = sourceLanguage === 'zh' ? 'English' : 'Chinese';
        const chunks = this.splitCanonicalPromptText(source);
        const translatedChunks = await this.translateCanonicalPromptChunks(chunks, targetLanguage, {
            parallelism: 3,
            maxAttempts: 3
        });
        const translated = translatedChunks.join('\n\n').trim();
        this.validateCanonicalPromptTranslation(source, translated);
        return sourceLanguage === 'zh'
            ? { prompt_text_en: translated, prompt_text_zh: source }
            : { prompt_text_en: source, prompt_text_zh: translated };
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
