const AI_BUDGET_PRESETS = Object.freeze({
    lean: {
        tier: 'lean',
        maxInputChars: 6000,
        maxOutputTokens: 600
    },
    balanced: {
        tier: 'balanced',
        maxInputChars: 12000,
        maxOutputTokens: 900
    },
    expanded: {
        tier: 'expanded',
        maxInputChars: 24000,
        maxOutputTokens: 1600
    },
    longform: {
        tier: 'longform',
        maxInputChars: 24000,
        maxOutputTokens: 8192
    }
});

const AI_BUDGET_ALIASES = Object.freeze({
    compact: 'lean',
    concise: 'lean',
    low: 'lean',
    lean: 'lean',
    normal: 'balanced',
    balanced: 'balanced',
    standard: 'balanced',
    deep: 'expanded',
    expanded: 'expanded',
    longform: 'longform'
});

function clampInteger(value, min, max, fallback = min) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.floor(numberValue)));
}

function estimateTokenCountFromChars(charCount = 0) {
    return Math.max(0, Math.ceil((Number(charCount) || 0) / 4));
}

function resolveBudgetTier(value = null) {
    const rawTier = typeof value === 'string'
        ? value
        : (value?.tier || value?.mode || value?.level || value?.preset);
    return AI_BUDGET_ALIASES[String(rawTier || '').trim().toLowerCase()] || '';
}

function hasExplicitBudgetTier(value = null) {
    return Boolean(resolveBudgetTier(value));
}

function resolveRequestBudget(value = null, fallbackTier = 'balanced') {
    const normalizedTier = resolveBudgetTier(value) || fallbackTier;
    const preset = AI_BUDGET_PRESETS[normalizedTier] || AI_BUDGET_PRESETS.balanced;
    const requestedMaxInputChars = value && typeof value === 'object'
        ? value.maxInputChars || value.max_input_chars
        : undefined;
    const requestedMaxOutputTokens = value && typeof value === 'object'
        ? value.maxOutputTokens || value.max_output_tokens
        : undefined;

    return {
        tier: normalizedTier,
        maxInputChars: clampInteger(
            requestedMaxInputChars,
            1000,
            preset.maxInputChars,
            preset.maxInputChars
        ),
        maxOutputTokens: clampInteger(
            requestedMaxOutputTokens,
            64,
            preset.maxOutputTokens,
            preset.maxOutputTokens
        )
    };
}

function createBudgetState(budget = {}) {
    return {
        maxInputChars: Number(budget.maxInputChars) || 0,
        inputChars: 0,
        truncatedChars: 0,
        truncated: false
    };
}

function applyTextBudget(value, state) {
    const source = String(value || '');
    if (!source || !state?.maxInputChars) {
        return source;
    }

    const remainingChars = Math.max(0, state.maxInputChars - state.inputChars);
    const nextValue = source.slice(0, remainingChars);
    state.inputChars += nextValue.length;

    if (source.length > nextValue.length) {
        state.truncated = true;
        state.truncatedChars += source.length - nextValue.length;
    }

    return nextValue;
}

function applyBudgetToContent(content, state) {
    if (typeof content === 'string') {
        return applyTextBudget(content, state);
    }

    if (!Array.isArray(content)) {
        return content;
    }

    return content.map((part) => {
        if (!part || typeof part !== 'object' || Array.isArray(part)) {
            return part;
        }

        const nextPart = { ...part };
        if (typeof nextPart.text === 'string') {
            nextPart.text = applyTextBudget(nextPart.text, state);
        } else if (typeof nextPart.output_text === 'string') {
            nextPart.output_text = applyTextBudget(nextPart.output_text, state);
        } else if (typeof nextPart.content === 'string') {
            nextPart.content = applyTextBudget(nextPart.content, state);
        }

        return nextPart;
    });
}

function applyBudgetToMessages(messages = [], budget = null) {
    if (!budget) {
        return {
            items: messages,
            state: null
        };
    }

    const state = createBudgetState(budget);
    const items = Array.isArray(messages)
        ? messages.map((message) => ({
            ...message,
            content: applyBudgetToContent(message?.content, state)
        }))
        : messages;

    return {
        items,
        state
    };
}

function applyBudgetToGeminiContents(contents = [], budget = null) {
    if (!budget) {
        return {
            items: contents,
            state: null
        };
    }

    const state = createBudgetState(budget);
    const items = Array.isArray(contents)
        ? contents.map((message) => ({
            ...message,
            parts: (Array.isArray(message?.parts) ? message.parts : []).map((part) => {
                if (!part || typeof part !== 'object' || Array.isArray(part)) {
                    return part;
                }

                const nextPart = { ...part };
                if (typeof nextPart.text === 'string') {
                    nextPart.text = applyTextBudget(nextPart.text, state);
                } else if (typeof nextPart.content === 'string') {
                    nextPart.content = applyTextBudget(nextPart.content, state);
                }
                return nextPart;
            })
        }))
        : contents;

    return {
        items,
        state
    };
}

function mergeBudgetStates(...states) {
    return states
        .filter(Boolean)
        .reduce((accumulator, state) => ({
            inputChars: accumulator.inputChars + (Number(state.inputChars) || 0),
            truncatedChars: accumulator.truncatedChars + (Number(state.truncatedChars) || 0),
            truncated: accumulator.truncated || state.truncated === true
        }), {
            inputChars: 0,
            truncatedChars: 0,
            truncated: false
        });
}

function buildBudgetMeta(budget = null, state = null) {
    if (!budget) {
        return null;
    }

    const inputChars = Number(state?.inputChars) || 0;
    return {
        tier: budget.tier,
        maxInputChars: budget.maxInputChars,
        maxOutputTokens: budget.maxOutputTokens,
        inputChars,
        estimatedInputTokens: estimateTokenCountFromChars(inputChars),
        truncated: state?.truncated === true,
        truncatedChars: Number(state?.truncatedChars) || 0
    };
}

function redactSensitiveText(value = '') {
    return String(value || '')
        .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
        .replace(/sk-[A-Za-z0-9._-]{8,}/gi, 'sk-[redacted]')
        .replace(/AIza[0-9A-Za-z_-]{16,}/g, 'AIza[redacted]');
}

function redactSensitiveValue(value, depth = 0) {
    if (depth > 4) {
        return '[redacted-depth]';
    }

    if (typeof value === 'string') {
        return redactSensitiveText(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactSensitiveValue(item, depth + 1));
    }

    if (value && typeof value === 'object') {
        return Object.entries(value).reduce((accumulator, [key, item]) => {
            if (/authorization|api[_-]?key|token|secret/i.test(key)) {
                accumulator[key] = '[redacted]';
            } else {
                accumulator[key] = redactSensitiveValue(item, depth + 1);
            }
            return accumulator;
        }, {});
    }

    return value;
}

module.exports = {
    AI_BUDGET_ALIASES,
    AI_BUDGET_PRESETS,
    applyBudgetToGeminiContents,
    applyBudgetToMessages,
    buildBudgetMeta,
    clampInteger,
    estimateTokenCountFromChars,
    hasExplicitBudgetTier,
    mergeBudgetStates,
    redactSensitiveText,
    redactSensitiveValue,
    resolveBudgetTier,
    resolveRequestBudget
};
