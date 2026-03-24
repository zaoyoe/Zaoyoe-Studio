(function () {
    'use strict';

    let supabase = null;
    let prompts = [];
    let isRunning = false;
    let geminiKey = '';

    const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

    function log(message, type = 'info') {
        const container = document.getElementById('logContainer');
        if (!container) {
            return;
        }

        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        container.appendChild(entry);
        container.scrollTop = container.scrollHeight;
    }

    async function loadPrompts() {
        const url = document.getElementById('supabaseUrl')?.value.trim();
        const key = document.getElementById('supabaseKey')?.value.trim();
        geminiKey = document.getElementById('geminiKey')?.value.trim() || '';

        if (!url || !key || !geminiKey) {
            window.alert('请填写所有配置项');
            return;
        }

        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        supabase = createClient(url, key);

        log('正在加载提示词...', 'info');

        try {
            const { data, error } = await supabase
                .from('prompts')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                throw error;
            }

            prompts = data;
            const needsWork = prompts.filter((prompt) => !prompt.title_en || !prompt.description_en);

            document.getElementById('totalCount').textContent = prompts.length;
            document.getElementById('needsTranslation').textContent = needsWork.length;
            document.getElementById('completedCount').textContent = prompts.length - needsWork.length;

            document.getElementById('statsCard')?.classList.remove('hidden');
            document.getElementById('logCard')?.classList.remove('hidden');

            log(`加载完成: ${prompts.length} 个提示词, ${needsWork.length} 个需要翻译`, 'success');
        } catch (error) {
            log(`加载失败: ${error.message}`, 'error');
        }
    }

    async function translateWithGemini(title, description) {
        const prompt = `Translate the following Chinese text to English. Return ONLY a JSON object, no markdown.

Input:
- Title: "${title}"
- Description: "${description || ''}"

Output format:
{
    "title_en": "English title (2-5 words, creative)",
    "description_en": "English description (1-2 sentences)"
}

IMPORTANT: Return ONLY valid JSON.`;

        const response = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }

        throw new Error('Invalid response format');
    }

    async function startMigration() {
        if (isRunning) {
            return;
        }

        isRunning = true;
        const startButton = document.getElementById('startBtn');
        if (startButton) {
            startButton.disabled = true;
        }
        document.getElementById('progressCard')?.classList.remove('hidden');

        const needsWork = prompts.filter((prompt) => !prompt.title_en || !prompt.description_en);
        let completed = 0;

        log(`开始迁移 ${needsWork.length} 个提示词...`, 'info');

        for (const prompt of needsWork) {
            if (!isRunning) {
                log('用户停止迁移', 'warning');
                break;
            }

            try {
                log(`翻译: ${prompt.title}`, 'info');
                const translation = await translateWithGemini(prompt.title, prompt.description);

                const { error } = await supabase
                    .from('prompts')
                    .update({
                        title_en: translation.title_en,
                        title_zh: prompt.title,
                        description_en: translation.description_en,
                        description_zh: prompt.description
                    })
                    .eq('id', prompt.id);

                if (error) {
                    throw error;
                }

                completed += 1;
                const percent = Math.round((completed / needsWork.length) * 100);
                const progressFill = document.getElementById('progressFill');
                if (progressFill) {
                    progressFill.value = percent;
                }
                document.getElementById('progressText').textContent = `${completed}/${needsWork.length} (${percent}%)`;
                document.getElementById('completedCount').textContent = prompts.length - needsWork.length + completed;

                log(`✓ ${prompt.title} → ${translation.title_en}`, 'success');
                await new Promise((resolve) => window.setTimeout(resolve, 500));
            } catch (error) {
                log(`✗ ${prompt.title}: ${error.message}`, 'error');
            }
        }

        isRunning = false;
        if (startButton) {
            startButton.disabled = false;
        }
        log(`迁移完成! 成功 ${completed}/${needsWork.length}`, 'success');
    }

    function stopMigration() {
        isRunning = false;
        log('正在停止...', 'warning');
    }

    function bindMigrationTool() {
        const supabaseUrlInput = document.getElementById('supabaseUrl');
        const supabaseKeyInput = document.getElementById('supabaseKey');
        const geminiKeyInput = document.getElementById('geminiKey');

        if (supabaseUrlInput) {
            supabaseUrlInput.value = localStorage.getItem('supabaseUrl') || '';
        }
        if (supabaseKeyInput) {
            supabaseKeyInput.value = localStorage.getItem('supabaseKey') || '';
        }
        if (geminiKeyInput) {
            geminiKeyInput.value = localStorage.getItem('geminiKey') || '';
        }

        document.querySelectorAll('input').forEach((input) => {
            input.addEventListener('change', () => {
                localStorage.setItem(input.id, input.value);
            });
        });

        document.getElementById('loadBtn')?.addEventListener('click', () => {
            void loadPrompts();
        });

        document.getElementById('startBtn')?.addEventListener('click', () => {
            void startMigration();
        });

        document.getElementById('stopBtn')?.addEventListener('click', () => {
            stopMigration();
        });
    }

    bindMigrationTool();
}());
