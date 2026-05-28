const presets = {
            midnight: {
                accent: '#38bdf8',
                text: '#f8fafc',
                muted: 'rgba(226, 232, 240, 0.82)',
                badgeBg: 'rgba(56, 189, 248, 0.16)',
                badgeText: '#e0f2fe',
                qrCardBg: 'rgba(255, 255, 255, 0.95)',
                qrLabelColor: '#0f172a',
                codeColor: '#0f172a',
                cardBodyColor: '#334155',
                cardMutedColor: '#64748b',
                apiCallout: {
                    panelStops: ['rgba(15, 23, 42, 0.88)', 'rgba(30, 58, 138, 0.82)', 'rgba(14, 116, 144, 0.72)'],
                    border: 'rgba(191, 219, 254, 0.34)',
                    shadow: 'rgba(2, 8, 23, 0.24)',
                    title: '#f8fafc',
                    accent: '#67e8f9',
                    body: '#dbeafe',
                    ctaStops: ['#0ea5e9', '#2563eb'],
                    ctaText: '#ffffff',
                    iconStops: ['#38bdf8', '#2563eb', '#4f46e5'],
                    iconBackground: 'rgba(255, 255, 255, 0.14)'
                },
                overlayOpacity: 0.34,
                gradientStops: [
                    { offset: 0, color: '#0f172a' },
                    { offset: 0.52, color: '#1e3a8a' },
                    { offset: 1, color: '#dbeafe' }
                ]
            },
            sunset: {
                accent: '#f97316',
                text: '#fff7ed',
                muted: 'rgba(255, 237, 213, 0.86)',
                badgeBg: 'rgba(251, 146, 60, 0.18)',
                badgeText: '#ffedd5',
                qrCardBg: 'rgba(255, 251, 235, 0.96)',
                qrLabelColor: '#7c2d12',
                codeColor: '#c2410c',
                cardBodyColor: '#334155',
                cardMutedColor: '#64748b',
                apiCallout: {
                    panelStops: ['#fffaf0', '#ffedd5', '#fed7aa'],
                    border: 'rgba(251, 146, 60, 0.42)',
                    shadow: 'rgba(154, 52, 18, 0.18)',
                    title: '#7c2d12',
                    accent: '#ea580c',
                    body: '#9a3412',
                    ctaStops: ['#ea580c', '#f59e0b'],
                    ctaText: '#fff7ed',
                    iconStops: ['#fb923c', '#ea580c', '#f59e0b'],
                    iconBackground: '#fff7ed'
                },
                overlayOpacity: 0.42,
                gradientStops: [
                    { offset: 0, color: '#431407' },
                    { offset: 0.4, color: '#9a3412' },
                    { offset: 1, color: '#f59e0b' }
                ]
            },
            crystal: {
                accent: '#2563eb',
                text: '#0f172a',
                muted: 'rgba(15, 23, 42, 0.68)',
                badgeBg: 'rgba(37, 99, 235, 0.12)',
                badgeText: '#1d4ed8',
                qrCardBg: 'rgba(255, 255, 255, 0.96)',
                qrLabelColor: '#1e293b',
                codeColor: '#1d4ed8',
                cardBodyColor: '#334155',
                cardMutedColor: '#64748b',
                apiCallout: {
                    panelStops: ['#ffffff', '#f8fbff', '#e0f2fe'],
                    border: 'rgba(37, 99, 235, 0.22)',
                    shadow: 'rgba(37, 99, 235, 0.12)',
                    title: '#0f172a',
                    accent: '#2563eb',
                    body: '#475569',
                    ctaStops: ['#2563eb', '#0ea5e9'],
                    ctaText: '#ffffff',
                    iconStops: ['#60a5fa', '#2563eb', '#818cf8'],
                    iconBackground: '#ffffff'
                },
                overlayOpacity: 0.2,
                gradientStops: [
                    { offset: 0, color: '#eff6ff' },
                    { offset: 0.45, color: '#dbeafe' },
                    { offset: 1, color: '#f8fafc' }
                ]
            }
        };

        const defaultState = {
            template: 'midnight',
            backgroundDataUrl: '',
            avatarDataUrl: '',
            posterTitle: '邀请函',
            posterSubtitle: '扫码注册 · 即享专属奖励',
            qrLabel: '扫码注册领取新人福利',
            posterLink: 'https://www.fatherkey.com/?ref=ZAOYOE88',
            legalText: '活动最终解释权归平台所有',
            registrationReward: 5,
            pointsUnit: '分',
            rewardTrigger: 'purchase',
            shopCommission: 5,
            agentCommission: 9,
            displayName: 'Zaoyoe',
            avatarUrl: '',
            overlayOpacity: 52,
            titleSize: 88,
            cardY: 570,
            cardRadius: 42
        };

        const benefitIconSpecs = [
            { label: 'Gemini', src: 'assets/affiliate-poster-icons/gemini.png' },
            { label: 'GPT', src: 'assets/affiliate-poster-icons/gpt.png' },
            { label: 'Claude', src: 'assets/affiliate-poster-icons/claude.png' },
            { label: 'Apple id', src: 'assets/affiliate-poster-icons/apple-id.svg' },
            { label: 'Gift card', type: 'gift-card' },
            { label: 'Gmail', src: 'assets/affiliate-poster-icons/gmail.png' }
        ];

        const state = { ...defaultState };
        const canvas = document.getElementById('posterCanvas');
        const ctx = canvas.getContext('2d');
        const statusEl = document.getElementById('canvasStatus');
        const avatarStatusEl = document.getElementById('avatarStatus');
        const inputIds = [
            'posterTitle',
            'posterSubtitle',
            'qrLabel',
            'posterLink',
            'legalText',
            'registrationReward',
            'pointsUnit',
            'rewardTrigger',
            'shopCommission',
            'agentCommission',
            'displayName',
            'avatarUrl',
            'overlayOpacity',
            'titleSize',
            'cardY',
            'cardRadius'
        ];

        let renderTimer = 0;
        let benefitIconLoadPromise = null;
        let benefitIcons = [];
        let apiCalloutIconLoadPromise = null;
        let apiCalloutIcon = null;

        function setStatus(message) {
            statusEl.textContent = message || '';
            statusEl.classList.toggle('visible', Boolean(message));
        }

        function setAvatarStatus(message, tone = 'warning') {
            if (!avatarStatusEl) return;
            avatarStatusEl.textContent = message || '';
            avatarStatusEl.dataset.tone = tone;
        }

        function syncRangeLabels() {
            document.getElementById('overlayValue').textContent = `${state.overlayOpacity}%`;
            document.getElementById('titleSizeValue').textContent = `${state.titleSize}px`;
            document.getElementById('cardYValue').textContent = String(state.cardY);
            document.getElementById('cardRadiusValue').textContent = String(state.cardRadius);
        }

        function readControls() {
            inputIds.forEach((id) => {
                const el = document.getElementById(id);
                if (!el) return;
                if (el.type === 'range') {
                    state[id] = Number(el.value);
                    return;
                }
                if (el.type !== 'file') {
                    state[id] = el.value;
                }
            });
            syncRangeLabels();
        }

        function writeControls() {
            inputIds.forEach((id) => {
                const el = document.getElementById(id);
                if (!el || el.type === 'file') return;
                el.value = state[id] ?? '';
            });
            document.querySelectorAll('.template-btn').forEach((button) => {
                button.classList.toggle('active', button.dataset.template === state.template);
            });
            syncRangeLabels();
        }

        function isGeneratedAvatarUrl(url) {
            return /ui-avatars\.com|dicebear\.com/i.test(String(url || ''));
        }

        function normalizePreviewAvatarUrl(value = '') {
            const source = String(value || '').trim();
            if (!source || isGeneratedAvatarUrl(source)) {
                return '';
            }

            if (source.startsWith('data:image/')) {
                return /^data:image\/(png|jpeg|jpg|webp|gif);/i.test(source) && source.length > 100
                    ? source
                    : '';
            }

            try {
                const parsed = new URL(source, window.location.origin);
                if (!['http:', 'https:', 'blob:'].includes(parsed.protocol)) {
                    return '';
                }
                return parsed.href;
            } catch (error) {
                return '';
            }
        }

        function getProfileDisplayName(source = {}) {
            const candidates = [
                source.display_name,
                source.displayName,
                source.username,
                source.nickname,
                source.full_name,
                source.name,
                source.email ? String(source.email).split('@')[0] : ''
            ];
            return candidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
        }

        function getProfileAvatarUrl(source = {}) {
            const candidates = [
                source.avatar_url,
                source.avatarUrl,
                source.picture,
                source.photoURL,
                source.image
            ];
            return candidates.map(normalizePreviewAvatarUrl).find(Boolean) || '';
        }

        function formatPreviewNumber(value) {
            const parsed = Number(value);
            const safe = Number.isFinite(parsed) ? parsed : 0;
            const hasDecimal = Math.abs(safe % 1) > 0.0001;
            return safe.toLocaleString(undefined, {
                minimumFractionDigits: hasDecimal ? (Math.abs(safe * 10 - Math.round(safe * 10)) > 0.0001 ? 2 : 1) : 0,
                maximumFractionDigits: 2
            });
        }

        function formatPreviewPercent(value) {
            const parsed = Number(value);
            const safe = Number.isFinite(parsed) ? parsed : 0;
            return `${formatPreviewNumber(safe)}%`;
        }

        function getPreviewPointsText(value) {
            const unit = String(state.pointsUnit || '分').trim() || '分';
            return `${formatPreviewNumber(value)}${unit}`;
        }

        function getPreviewRewardDetail() {
            const registrationReward = Number(state.registrationReward);
            const safeRegistrationReward = Number.isFinite(registrationReward) ? registrationReward : 0;
            return {
                groups: [
                    {
                        title: `固定拉新奖励：${safeRegistrationReward > 0 ? getPreviewPointsText(safeRegistrationReward) : '当前未开启'}`,
                        note: state.rewardTrigger === 'register' ? '好友注册后发放' : '好友首充或首单后发放'
                    },
                    {
                        title: `商城消费返佣：${formatPreviewPercent(state.shopCommission)}`,
                        note: '好友商城消费持续返佣'
                    },
                    {
                        title: `分销资源返佣：${formatPreviewPercent(state.agentCommission)}`,
                        note: '好友购买分销资源返佣'
                    }
                ]
            };
        }

        function applyRealProfileSource(profile, sourceLabel) {
            const avatarUrl = getProfileAvatarUrl(profile);
            if (!avatarUrl) return false;

            const displayName = getProfileDisplayName(profile);
            state.avatarUrl = avatarUrl;
            state.avatarDataUrl = '';
            if (displayName) {
                state.displayName = displayName;
            }
            writeControls();
            setAvatarStatus(`已读取真实头像：${sourceLabel}`, 'success');
            return true;
        }

        function readCachedUserProfile() {
            try {
                const raw = localStorage.getItem('cached_user_profile');
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
            } catch (error) {
                return null;
            }
        }

        function readSupabaseStorageProfile() {
            try {
                for (let index = 0; index < localStorage.length; index += 1) {
                    const key = localStorage.key(index);
                    if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;
                    const parsed = JSON.parse(raw);
                    const session = parsed?.currentSession || parsed?.session || parsed;
                    const user = session?.user || parsed?.user;
                    const metadata = user?.user_metadata && typeof user.user_metadata === 'object'
                        ? user.user_metadata
                        : {};
                    const profile = {
                        id: user?.id,
                        email: user?.email,
                        ...metadata
                    };
                    if (getProfileAvatarUrl(profile)) {
                        return profile;
                    }
                }
            } catch (error) {
                return null;
            }
            return null;
        }

        function loadScript(src) {
            return new Promise((resolve, reject) => {
                if (document.querySelector(`script[src="${src}"]`)) {
                    resolve();
                    return;
                }
                const script = document.createElement('script');
                script.src = src;
                script.async = false;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error(`load failed: ${src}`));
                document.head.appendChild(script);
            });
        }

        async function ensureSupabaseClient() {
            if (window.supabaseClient?.auth && window.supabaseClient?.from) {
                return true;
            }
            if (window.location.protocol === 'file:') {
                return false;
            }

            try {
                await loadScript('https://unpkg.com/@supabase/supabase-js@2');
                await loadScript('/api/runtime/supabase-config');
                await loadScript('./js/runtime-supabase-config.js');
                await loadScript('./supabase-client.js');
                return Boolean(window.supabaseClient?.auth && window.supabaseClient?.from);
            } catch (error) {
                return false;
            }
        }

        async function readSupabaseProfile() {
            const hasClient = await ensureSupabaseClient();
            if (!hasClient) return null;

            try {
                const sessionResult = await window.supabaseClient.auth.getSession();
                const user = sessionResult?.data?.session?.user;
                if (!user?.id) return null;

                const profileResult = await window.supabaseClient
                    .from('profiles')
                    .select('display_name, username, avatar_url')
                    .eq('id', user.id)
                    .maybeSingle();
                const metadata = user.user_metadata && typeof user.user_metadata === 'object'
                    ? user.user_metadata
                    : {};

                return {
                    id: user.id,
                    email: user.email,
                    ...metadata,
                    ...(profileResult?.data || {})
                };
            } catch (error) {
                return null;
            }
        }

        async function loadRealUserAvatar() {
            setAvatarStatus('正在尝试读取真实用户头像...', 'warning');

            const cachedProfile = readCachedUserProfile();
            if (cachedProfile && applyRealProfileSource(cachedProfile, '当前站点缓存 cached_user_profile')) {
                requestRender();
                return true;
            }

            const storedProfile = readSupabaseStorageProfile();
            if (storedProfile && applyRealProfileSource(storedProfile, '当前站点登录态')) {
                requestRender();
                return true;
            }

            const supabaseProfile = await readSupabaseProfile();
            if (supabaseProfile && applyRealProfileSource(supabaseProfile, 'profiles.avatar_url')) {
                requestRender();
                return true;
            }

            const isFilePreview = window.location.protocol === 'file:';
            setAvatarStatus(
                isFilePreview
                    ? '未读取到真实头像：当前是 file:// 独立预览，浏览器无法访问 www.fatherkey.com 的登录态。请把头像 URL 填到上方，或上传头像文件。'
                    : '未读取到真实头像：当前账号可能未设置头像，或此预览页未运行在已登录的站点域名下。',
                'warning'
            );
            requestRender();
            return false;
        }

        function requestRender() {
            window.clearTimeout(renderTimer);
            renderTimer = window.setTimeout(() => {
                readControls();
                renderPoster();
            }, 60);
        }

        function drawRoundedRect(context, x, y, width, height, radius) {
            const safeRadius = Math.min(radius, width / 2, height / 2);
            context.beginPath();
            if (typeof context.roundRect === 'function') {
                context.roundRect(x, y, width, height, safeRadius);
                return;
            }
            context.moveTo(x + safeRadius, y);
            context.arcTo(x + width, y, x + width, y + height, safeRadius);
            context.arcTo(x + width, y + height, x, y + height, safeRadius);
            context.arcTo(x, y + height, x, y, safeRadius);
            context.arcTo(x, y, x + width, y, safeRadius);
            context.closePath();
        }

        function drawPosterTextBlock(context, text, x, startY, maxWidth, lineHeight, maxLines = 3) {
            const content = String(text || '').trim();
            if (!content) {
                return { lines: [], lineCount: 0, startY, lastBaseline: startY, nextY: startY };
            }

            const lines = [];
            let currentLine = '';

            for (const char of content) {
                const candidate = currentLine + char;
                if (context.measureText(candidate).width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = char;
                    if (lines.length >= maxLines - 1) break;
                } else {
                    currentLine = candidate;
                }
            }

            if (currentLine && lines.length < maxLines) {
                lines.push(currentLine);
            }

            if (lines.length === maxLines && content.length > lines.join('').length) {
                lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, lines[maxLines - 1].length - 1))}…`;
            }

            lines.forEach((line, index) => {
                context.fillText(line, x, startY + index * lineHeight);
            });

            const lastBaseline = startY + Math.max(0, lines.length - 1) * lineHeight;
            return {
                lines,
                lineCount: lines.length,
                startY,
                lastBaseline,
                nextY: startY + lines.length * lineHeight
            };
        }

        function drawCoverImage(context, image, x, y, width, height) {
            const imageRatio = image.width / image.height;
            const targetRatio = width / height;
            let drawWidth = width;
            let drawHeight = height;
            let offsetX = x;
            let offsetY = y;

            if (imageRatio > targetRatio) {
                drawWidth = height * imageRatio;
                offsetX = x - (drawWidth - width) / 2;
            } else {
                drawHeight = width / imageRatio;
                offsetY = y - (drawHeight - height) / 2;
            }

            context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
        }

        function loadCanvasImage(src) {
            return new Promise((resolve, reject) => {
                if (!src) {
                    resolve(null);
                    return;
                }
                const image = new Image();
                try {
                    const imageUrl = new URL(src, window.location.href);
                    if (imageUrl.origin !== window.location.origin && !src.startsWith('data:') && !src.startsWith('blob:')) {
                        image.crossOrigin = 'Anonymous';
                    }
                } catch (error) {
                    image.crossOrigin = 'Anonymous';
                }
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('图片加载失败'));
                image.src = src;
            });
        }

        function loadBenefitIcons() {
            if (!benefitIconLoadPromise) {
                benefitIconLoadPromise = Promise.all(benefitIconSpecs.map(async (spec) => {
                    if (!spec.src) return { ...spec, image: null };
                    try {
                        const image = await loadCanvasImage(spec.src);
                        return { ...spec, image };
                    } catch (error) {
                        return { ...spec, image: null };
                    }
                })).then((icons) => {
                    benefitIcons = icons;
                    return icons;
                });
            }
            return benefitIconLoadPromise;
        }

        function loadApiCalloutIcon() {
            if (!apiCalloutIconLoadPromise) {
                apiCalloutIconLoadPromise = loadCanvasImage('assets/affiliate-poster-icons/api-transfer.svg')
                    .then((image) => {
                        apiCalloutIcon = image;
                        return image;
                    })
                    .catch(() => null);
            }
            return apiCalloutIconLoadPromise;
        }

        function drawBenefitGiftCardIcon(context, x, y, size) {
            const gradient = context.createLinearGradient(x, y, x + size, y + size);
            gradient.addColorStop(0, '#60a5fa');
            gradient.addColorStop(0.45, '#a78bfa');
            gradient.addColorStop(1, '#fb7185');
            context.save();
            drawRoundedRect(context, x, y, size, size, 13);
            context.fillStyle = gradient;
            context.fill();
            context.fillStyle = 'rgba(255, 255, 255, 0.88)';
            context.font = `700 ${Math.round(size * 0.48)}px "Helvetica Neue", Arial, sans-serif`;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText('', x + size / 2, y + size / 2 + 1);
            context.restore();
        }

        function drawFallbackBenefitIcon(context, icon, x, y, size) {
            const label = String(icon?.label || '').toLowerCase();
            context.save();

            if (label.includes('gemini')) {
                const gradient = context.createLinearGradient(x, y, x + size, y + size);
                gradient.addColorStop(0, '#9168c0');
                gradient.addColorStop(0.5, '#5684d1');
                gradient.addColorStop(1, '#1ba1e3');
                drawRoundedRect(context, x, y, size, size, 16);
                context.fillStyle = '#f8fafc';
                context.fill();
                context.translate(x + size / 2, y + size / 2);
                context.fillStyle = gradient;
                context.beginPath();
                context.moveTo(0, -size * 0.34);
                context.bezierCurveTo(size * 0.07, -size * 0.12, size * 0.18, -size * 0.05, size * 0.34, 0);
                context.bezierCurveTo(size * 0.18, size * 0.05, size * 0.07, size * 0.12, 0, size * 0.34);
                context.bezierCurveTo(-size * 0.07, size * 0.12, -size * 0.18, size * 0.05, -size * 0.34, 0);
                context.bezierCurveTo(-size * 0.18, -size * 0.05, -size * 0.07, -size * 0.12, 0, -size * 0.34);
                context.fill();
            } else if (label.includes('gpt')) {
                drawRoundedRect(context, x, y, size, size, 16);
                context.fillStyle = '#ffffff';
                context.fill();
                context.strokeStyle = '#0f172a';
                context.lineWidth = 4;
                context.beginPath();
                context.arc(x + size / 2, y + size / 2, size * 0.25, 0, Math.PI * 2);
                context.stroke();
                for (let index = 0; index < 6; index += 1) {
                    const angle = (Math.PI * 2 / 6) * index;
                    const cx = x + size / 2 + Math.cos(angle) * size * 0.21;
                    const cy = y + size / 2 + Math.sin(angle) * size * 0.21;
                    context.beginPath();
                    context.arc(cx, cy, size * 0.15, angle - 1.2, angle + 1.2);
                    context.stroke();
                }
            } else if (label.includes('claude')) {
                const gradient = context.createLinearGradient(x, y, x + size, y + size);
                gradient.addColorStop(0, '#f59e0b');
                gradient.addColorStop(1, '#c2410c');
                drawRoundedRect(context, x, y, size, size, 16);
                context.fillStyle = gradient;
                context.fill();
                context.fillStyle = '#fff7ed';
                context.beginPath();
                context.arc(x + size / 2, y + size / 2, size * 0.25, 0, Math.PI * 2);
                context.fill();
                for (let index = 0; index < 8; index += 1) {
                    const angle = (Math.PI * 2 / 8) * index;
                    context.beginPath();
                    context.moveTo(x + size / 2, y + size / 2);
                    context.lineTo(x + size / 2 + Math.cos(angle) * size * 0.36, y + size / 2 + Math.sin(angle) * size * 0.36);
                    context.strokeStyle = '#fff7ed';
                    context.lineWidth = 4;
                    context.stroke();
                }
            } else if (label.includes('apple id')) {
                const gradient = context.createLinearGradient(x, y, x + size, y + size);
                gradient.addColorStop(0, '#38bdf8');
                gradient.addColorStop(1, '#2563eb');
                drawRoundedRect(context, x, y, size, size, 16);
                context.fillStyle = gradient;
                context.fill();
                context.strokeStyle = '#ffffff';
                context.lineWidth = 5;
                context.lineCap = 'round';
                context.beginPath();
                context.moveTo(x + size * 0.32, y + size * 0.72);
                context.lineTo(x + size * 0.50, y + size * 0.30);
                context.lineTo(x + size * 0.68, y + size * 0.72);
                context.stroke();
                context.beginPath();
                context.moveTo(x + size * 0.28, y + size * 0.63);
                context.lineTo(x + size * 0.72, y + size * 0.63);
                context.stroke();
            } else if (label.includes('gmail')) {
                drawRoundedRect(context, x, y, size, size, 16);
                context.fillStyle = '#ffffff';
                context.fill();
                context.lineCap = 'round';
                context.lineJoin = 'round';
                context.lineWidth = size * 0.105;
                context.strokeStyle = '#1a73e8';
                context.beginPath();
                context.moveTo(x + size * 0.22, y + size * 0.34);
                context.lineTo(x + size * 0.22, y + size * 0.72);
                context.stroke();
                context.strokeStyle = '#34a853';
                context.beginPath();
                context.moveTo(x + size * 0.78, y + size * 0.34);
                context.lineTo(x + size * 0.78, y + size * 0.72);
                context.stroke();
                context.strokeStyle = '#ea4335';
                context.beginPath();
                context.moveTo(x + size * 0.22, y + size * 0.34);
                context.lineTo(x + size * 0.50, y + size * 0.56);
                context.lineTo(x + size * 0.78, y + size * 0.34);
                context.stroke();
                context.strokeStyle = '#fbbc04';
                context.beginPath();
                context.moveTo(x + size * 0.28, y + size * 0.67);
                context.lineTo(x + size * 0.72, y + size * 0.67);
                context.stroke();
            } else {
                drawRoundedRect(context, x, y, size, size, 16);
                context.fillStyle = '#e2e8f0';
                context.fill();
            }

            context.restore();
        }

        function drawApiFallbackIcon(context, x, y, size, palette = {}) {
            const gradient = context.createLinearGradient(x, y, x + size, y + size);
            const iconStops = Array.isArray(palette.iconStops) && palette.iconStops.length
                ? palette.iconStops
                : ['#38bdf8', '#2563eb', '#4f46e5'];
            iconStops.forEach((color, index) => {
                gradient.addColorStop(iconStops.length === 1 ? 0 : index / (iconStops.length - 1), color);
            });
            drawRoundedRect(context, x, y, size, size, 18);
            context.fillStyle = gradient;
            context.fill();
            context.strokeStyle = palette.iconLine || '#ffffff';
            context.lineWidth = 4;
            context.lineCap = 'round';
            context.lineJoin = 'round';
            const leftX = x + size * 0.28;
            const rightX = x + size * 0.72;
            const topY = y + size * 0.34;
            const bottomY = y + size * 0.70;
            context.beginPath();
            context.arc(leftX, topY, size * 0.11, 0, Math.PI * 2);
            context.stroke();
            context.beginPath();
            context.arc(rightX, topY, size * 0.11, 0, Math.PI * 2);
            context.stroke();
            context.beginPath();
            context.arc(x + size * 0.5, bottomY, size * 0.11, 0, Math.PI * 2);
            context.stroke();
            context.beginPath();
            context.moveTo(leftX + size * 0.12, topY);
            context.lineTo(rightX - size * 0.12, topY);
            context.moveTo(leftX + size * 0.06, topY + size * 0.12);
            context.lineTo(x + size * 0.43, bottomY - size * 0.10);
            context.moveTo(rightX - size * 0.06, topY + size * 0.12);
            context.lineTo(x + size * 0.57, bottomY - size * 0.10);
            context.stroke();
        }

        function drawApiCallout(context, options = {}) {
            const cardX = Number(options.cardX) || 0;
            const cardY = Number(options.cardY) || 0;
            const cardWidth = Number(options.cardWidth) || 0;
            const cardHeight = Number(options.cardHeight) || 0;
            const preset = options.preset || {};
            const calloutWidth = cardWidth - 104;
            const calloutHeight = 120;
            const calloutX = cardX + (cardWidth - calloutWidth) / 2;
            const calloutY = cardY + cardHeight + 50;
            const calloutPalette = preset.apiCallout || {};
            const panelStops = Array.isArray(calloutPalette.panelStops) && calloutPalette.panelStops.length
                ? calloutPalette.panelStops
                : ['#ffffff', '#f5faff', '#eef6ff'];
            const ctaStops = Array.isArray(calloutPalette.ctaStops) && calloutPalette.ctaStops.length
                ? calloutPalette.ctaStops
                : ['#2563eb', '#38bdf8'];
            const mainTextColor = calloutPalette.title || '#0f172a';
            const accentColor = calloutPalette.accent || preset.accent || '#38bdf8';
            const bodyTextColor = calloutPalette.body || '#475569';

            context.save();
            context.shadowColor = calloutPalette.shadow || 'rgba(37, 99, 235, 0.10)';
            context.shadowBlur = 20;
            context.shadowOffsetY = 8;
            drawRoundedRect(context, calloutX, calloutY, calloutWidth, calloutHeight, 28);
            const panelGradient = context.createLinearGradient(calloutX, calloutY, calloutX + calloutWidth, calloutY + calloutHeight);
            panelStops.forEach((color, index) => {
                panelGradient.addColorStop(panelStops.length === 1 ? 0 : index / (panelStops.length - 1), color);
            });
            context.fillStyle = panelGradient;
            context.fill();
            context.restore();

            context.save();
            drawRoundedRect(context, calloutX, calloutY, calloutWidth, calloutHeight, 28);
            context.strokeStyle = calloutPalette.border || 'rgba(96, 165, 250, 0.24)';
            context.lineWidth = 1.6;
            context.stroke();

            const iconSize = 68;
            const iconX = calloutX + 26;
            const iconY = calloutY + (calloutHeight - iconSize) / 2;
            context.save();
            context.shadowColor = 'rgba(37, 99, 235, 0.12)';
            context.shadowBlur = 12;
            context.shadowOffsetY = 5;
            drawRoundedRect(context, iconX - 4, iconY - 4, iconSize + 8, iconSize + 8, 20);
            context.fillStyle = calloutPalette.iconBackground || '#ffffff';
            context.fill();
            context.restore();

            if (Array.isArray(calloutPalette.iconStops) && calloutPalette.iconStops.length) {
                drawApiFallbackIcon(context, iconX, iconY, iconSize, calloutPalette);
            } else if (options.icon) {
                context.save();
                drawRoundedRect(context, iconX, iconY, iconSize, iconSize, 18);
                context.clip();
                drawCoverImage(context, options.icon, iconX, iconY, iconSize, iconSize);
                context.restore();
            } else {
                drawApiFallbackIcon(context, iconX, iconY, iconSize, calloutPalette);
            }

            const textX = iconX + iconSize + 26;
            const mainY = calloutY + 48;
            context.textAlign = 'left';
            context.textBaseline = 'alphabetic';
            context.font = '800 27px "Helvetica Neue", Arial, sans-serif';
            context.fillStyle = mainTextColor;
            context.fillText('满血 ', textX, mainY);
            const prefixWidth = context.measureText('满血 ').width;
            context.font = '900 34px "Helvetica Neue", Arial, sans-serif';
            context.fillStyle = accentColor;
            context.fillText('API 中转', textX + prefixWidth, mainY);

            context.font = '600 21px "Helvetica Neue", Arial, sans-serif';
            context.fillStyle = bodyTextColor;
            context.fillText('一站式服务 · 人气商品热销中', textX, calloutY + 84);

            const ctaWidth = 154;
            const ctaHeight = 38;
            const ctaX = calloutX + calloutWidth - ctaWidth - 24;
            const ctaY = calloutY + 58;
            const ctaGradient = context.createLinearGradient(ctaX, ctaY, ctaX + ctaWidth, ctaY + ctaHeight);
            ctaStops.forEach((color, index) => {
                ctaGradient.addColorStop(ctaStops.length === 1 ? 0 : index / (ctaStops.length - 1), color);
            });
            drawRoundedRect(context, ctaX, ctaY, ctaWidth, ctaHeight, 19);
            context.fillStyle = ctaGradient;
            context.fill();
            context.font = '700 18px "Helvetica Neue", Arial, sans-serif';
            context.fillStyle = calloutPalette.ctaText || '#ffffff';
            context.fillText('扫码了解更多', ctaX + 18, ctaY + 25);
            context.strokeStyle = calloutPalette.ctaArrow || 'rgba(255, 255, 255, 0.78)';
            context.lineWidth = 2;
            context.lineCap = 'round';
            context.beginPath();
            context.moveTo(ctaX + ctaWidth - 27, ctaY + 15);
            context.lineTo(ctaX + ctaWidth - 20, ctaY + 19);
            context.lineTo(ctaX + ctaWidth - 27, ctaY + 23);
            context.stroke();
            context.restore();
        }

        function drawBenefitIcons(context, options = {}) {
            const cardX = Number(options.cardX) || 0;
            const cardY = Number(options.cardY) || 0;
            const cardWidth = Number(options.cardWidth) || 0;
            const cardHeight = Number(options.cardHeight) || 0;
            const icons = Array.isArray(options.icons) && options.icons.length ? options.icons : benefitIconSpecs;
            const iconSize = icons.length > 5 ? 56 : 60;
            const labelGap = 6;
            const sidePadding = icons.length > 5 ? 38 : 42;
            const availableWidth = Math.max(0, cardWidth - sidePadding * 2);
            const columnWidth = Math.max(iconSize + 38, Math.min(154, availableWidth / Math.max(icons.length, 1)));
            const totalWidth = columnWidth * icons.length;
            const startX = cardX + Math.max(sidePadding, (cardWidth - totalWidth) / 2);
            const iconTop = cardY + Math.min(470, cardHeight - 130);
            const labelY = iconTop + iconSize + 34;

            context.save();
            context.fillStyle = 'rgba(148, 163, 184, 0.22)';
            context.fillRect(cardX + 48, iconTop - 24, cardWidth - 96, 1);

            icons.forEach((icon, index) => {
                const centerX = startX + index * columnWidth + columnWidth / 2;
                const iconX = centerX - iconSize / 2;

                context.save();
                context.shadowColor = 'rgba(15, 23, 42, 0.10)';
                context.shadowBlur = 12;
                context.shadowOffsetY = 5;
                drawRoundedRect(context, iconX - 5, iconTop - 5, iconSize + 10, iconSize + 10, 17);
                context.fillStyle = '#ffffff';
                context.fill();
                context.restore();

                if (icon.image) {
                    context.save();
                    drawRoundedRect(context, iconX, iconTop, iconSize, iconSize, 16);
                    context.clip();
                    drawCoverImage(context, icon.image, iconX, iconTop, iconSize, iconSize);
                    context.restore();
                } else if (icon.type === 'gift-card') {
                    drawBenefitGiftCardIcon(context, iconX, iconTop, iconSize);
                } else {
                    drawFallbackBenefitIcon(context, icon, iconX, iconTop, iconSize);
                }

                const label = String(icon.label || '').trim();
                let labelFontSize = 17;
                context.fillStyle = '#64748b';
                context.font = `600 ${labelFontSize}px "Helvetica Neue", Arial, sans-serif`;
                context.textAlign = 'center';
                context.textBaseline = 'alphabetic';
                while (label && context.measureText(label).width > columnWidth - labelGap * 2 && labelFontSize > 12) {
                    labelFontSize -= 1;
                    context.font = `600 ${labelFontSize}px "Helvetica Neue", Arial, sans-serif`;
                }
                context.fillText(label, centerX, labelY);
            });

            context.restore();
        }

        function hashText(text) {
            let hash = 2166136261;
            for (let i = 0; i < text.length; i += 1) {
                hash ^= text.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            return hash >>> 0;
        }

        function drawFinder(context, x, y, cell) {
            context.fillStyle = '#0f172a';
            context.fillRect(x, y, cell * 7, cell * 7);
            context.fillStyle = '#ffffff';
            context.fillRect(x + cell, y + cell, cell * 5, cell * 5);
            context.fillStyle = '#0f172a';
            context.fillRect(x + cell * 2, y + cell * 2, cell * 3, cell * 3);
        }

        function drawPreviewQr(context, text, x, y, size) {
            const cells = 29;
            const cell = size / cells;
            const seed = hashText(text);

            context.save();
            context.fillStyle = '#ffffff';
            context.fillRect(x, y, size, size);
            drawFinder(context, x + cell, y + cell, cell);
            drawFinder(context, x + size - cell * 8, y + cell, cell);
            drawFinder(context, x + cell, y + size - cell * 8, cell);
            context.fillStyle = '#0f172a';

            for (let row = 0; row < cells; row += 1) {
                for (let col = 0; col < cells; col += 1) {
                    const inTopLeft = row < 9 && col < 9;
                    const inTopRight = row < 9 && col > cells - 10;
                    const inBottomLeft = row > cells - 10 && col < 9;
                    if (inTopLeft || inTopRight || inBottomLeft) continue;
                    const value = hashText(`${seed}:${row}:${col}:${text}`);
                    if ((value % 7) < 3) {
                        context.fillRect(
                            x + col * cell + cell * 0.12,
                            y + row * cell + cell * 0.12,
                            cell * 0.76,
                            cell * 0.76
                        );
                    }
                }
            }
            context.restore();
        }

        function drawPosterAvatar(context, options = {}) {
            const centerX = Number(options.centerX) || 0;
            const centerY = Number(options.centerY) || 0;
            const radius = Number(options.radius) || 56;
            const ringRadius = radius + 10;
            const fallbackInitial = options.fallbackInitial || 'U';

            context.save();
            context.shadowColor = 'rgba(15, 23, 42, 0.18)';
            context.shadowBlur = 28;
            context.shadowOffsetY = 10;
            context.beginPath();
            context.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
            context.fillStyle = options.ringColor || 'rgba(255, 255, 255, 0.96)';
            context.fill();
            context.restore();

            drawGoogleOneAvatarRing(context, centerX, centerY, ringRadius - 4, 8);

            context.save();
            context.beginPath();
            context.arc(centerX, centerY, radius, 0, Math.PI * 2);
            context.closePath();
            context.clip();

            if (options.image) {
                drawCoverImage(context, options.image, centerX - radius, centerY - radius, radius * 2, radius * 2);
            } else if (options.missingAvatar) {
                context.fillStyle = '#e5e7eb';
                context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
                context.fillStyle = '#94a3b8';
                context.beginPath();
                context.arc(centerX, centerY - 18, radius * 0.28, 0, Math.PI * 2);
                context.fill();
                context.beginPath();
                context.ellipse(centerX, centerY + 32, radius * 0.46, radius * 0.34, 0, 0, Math.PI * 2);
                context.fill();
            } else {
                const fallbackGradient = context.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
                if (options.fallbackBackground === 'sunset') {
                    fallbackGradient.addColorStop(0, '#f97316');
                    fallbackGradient.addColorStop(1, '#f59e0b');
                } else {
                    fallbackGradient.addColorStop(0, '#0f172a');
                    fallbackGradient.addColorStop(1, '#134e4a');
                }
                context.fillStyle = fallbackGradient;
                context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
                context.fillStyle = '#ffffff';
                context.font = '700 56px "Helvetica Neue", Arial, sans-serif';
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                context.fillText(fallbackInitial, centerX, centerY + 2);
            }
            context.restore();

            context.save();
            context.beginPath();
            context.arc(centerX, centerY, radius, 0, Math.PI * 2);
            context.strokeStyle = options.borderColor || 'rgba(255, 255, 255, 0.92)';
            context.lineWidth = 4;
            context.stroke();
            context.restore();
        }

        function drawGoogleOneAvatarRing(context, centerX, centerY, radius, lineWidth) {
            const segments = [
                { color: '#ea4335', start: -45, end: 45 },
                { color: '#1a73e8', start: 45, end: 135 },
                { color: '#34a853', start: 135, end: 225 },
                { color: '#fbbc04', start: 225, end: 315 }
            ];

            context.save();
            context.lineWidth = lineWidth;
            context.lineCap = 'butt';
            segments.forEach((segment) => {
                context.beginPath();
                context.arc(
                    centerX,
                    centerY,
                    radius,
                    (segment.start - 90) * Math.PI / 180,
                    (segment.end - 90) * Math.PI / 180
                );
                context.strokeStyle = segment.color;
                context.stroke();
            });

            context.lineWidth = 2;
            context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
            context.beginPath();
            context.arc(centerX, centerY, radius - lineWidth / 2 - 1, 0, Math.PI * 2);
            context.stroke();
            context.beginPath();
            context.arc(centerX, centerY, radius + lineWidth / 2 + 1, 0, Math.PI * 2);
            context.stroke();
            context.restore();
        }

        function getInitial(name) {
            const safe = String(name || '').trim();
            return safe ? safe.charAt(0).toUpperCase() : 'U';
        }

        async function renderPoster() {
            const preset = presets[state.template] || presets.midnight;
            const width = canvas.width;
            const height = canvas.height;
            setStatus('');

            const gradient = ctx.createLinearGradient(0, 0, width, height);
            preset.gradientStops.forEach((stop) => gradient.addColorStop(stop.offset, stop.color));
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);

            if (state.backgroundDataUrl) {
                try {
                    const backgroundImage = await loadCanvasImage(state.backgroundDataUrl);
                    drawCoverImage(ctx, backgroundImage, 0, 0, width, height);
                    ctx.save();
                    ctx.globalAlpha = Math.max(0, Math.min(1, Number(state.overlayOpacity) / 100));
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, width, height);
                    ctx.restore();
                } catch (error) {
                    setStatus('背景图加载失败，已回退到模板渐变。');
                }
            }

            ctx.save();
            ctx.globalAlpha = state.template === 'crystal' ? 0.65 : 0.14;
            ctx.fillStyle = state.template === 'sunset'
                ? '#fed7aa'
                : state.template === 'midnight'
                    ? '#cbd5e1'
                    : '#bfdbfe';
            ctx.beginPath();
            ctx.arc(width * 0.88, 160, 220, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.globalAlpha = state.template === 'crystal' ? 0.45 : 0.18;
            ctx.fillStyle = state.template === 'sunset'
                ? '#fdba74'
                : state.template === 'midnight'
                    ? '#bfdbfe'
                    : '#6ee7b7';
            ctx.beginPath();
            ctx.arc(120, height - 220, 180, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.fillStyle = preset.text;
            ctx.font = `800 ${state.titleSize}px "Helvetica Neue", Arial, sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            const titleLayout = drawPosterTextBlock(
                ctx,
                state.posterTitle,
                72,
                214,
                720,
                Math.round(state.titleSize * 1.12),
                2
            );

            ctx.fillStyle = preset.muted;
            ctx.font = '500 34px "Helvetica Neue", Arial, sans-serif';
            const subtitleLayout = drawPosterTextBlock(ctx, state.posterSubtitle, 72, titleLayout.nextY + 18, 760, 46, 2);

            const cardX = 72;
            const autoCardY = Math.max(state.cardY, subtitleLayout.nextY + 86);
            const cardY = Math.min(autoCardY, 660);
            const cardWidth = width - 144;
            const cardHeight = 620;
            const rewardDetail = getPreviewRewardDetail();
            const loadedBenefitIcons = await loadBenefitIcons();
            const loadedApiCalloutIcon = await loadApiCalloutIcon();

            drawRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, state.cardRadius);
            ctx.fillStyle = preset.qrCardBg;
            ctx.fill();

            let avatarImage = null;
            const avatarSource = String(state.avatarUrl || '').trim() || state.avatarDataUrl;
            if (avatarSource) {
                try {
                    avatarImage = await loadCanvasImage(avatarSource);
                } catch (error) {
                    setStatus('头像加载失败，已使用首字母头像。');
                }
            }

            drawPosterAvatar(ctx, {
                image: avatarImage,
                missingAvatar: !avatarImage,
                centerX: cardX + cardWidth / 2,
                centerY: cardY + 8,
                radius: 58,
                ringColor: 'rgba(255, 251, 235, 0.96)',
                borderColor: state.template === 'sunset' ? 'rgba(249, 115, 22, 0.34)' : 'rgba(15, 23, 42, 0.12)',
                fallbackInitial: getInitial(state.displayName),
                fallbackBackground: state.template === 'sunset' ? 'sunset' : 'midnight'
            });

            const qrCardX = cardX + 54;
            const qrCardY = cardY + 104;
            const qrCardSize = 328;
            const qrImageSize = 252;
            const qrImageX = qrCardX + (qrCardSize - qrImageSize) / 2;
            const qrImageY = qrCardY + 22;
            drawRoundedRect(ctx, qrCardX, qrCardY, qrCardSize, qrCardSize, 28);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            drawPreviewQr(ctx, state.posterLink, qrImageX, qrImageY, qrImageSize);

            ctx.fillStyle = preset.qrLabelColor;
            ctx.font = '700 25px "Helvetica Neue", Arial, sans-serif';
            ctx.textAlign = 'center';
            drawPosterTextBlock(ctx, state.qrLabel, qrCardX + qrCardSize / 2, qrCardY + 310, 288, 30, 1);
            ctx.textAlign = 'left';

            const detailX = cardX + 464;
            const detailWidth = 430;
            ctx.fillStyle = preset.qrLabelColor;
            ctx.font = '700 30px "Helvetica Neue", Arial, sans-serif';
            ctx.fillText('奖励规则', detailX, cardY + 174);

            let detailY = cardY + 226;
            const rewardGroups = Array.isArray(rewardDetail.groups) ? rewardDetail.groups : [];
            rewardGroups.forEach((group) => {
                const title = String(group?.title || '').trim();
                const note = String(group?.note || '').trim();

                ctx.fillStyle = preset.accent;
                ctx.beginPath();
                ctx.arc(detailX + 7, detailY - 8, 5, 0, Math.PI * 2);
                ctx.fill();

                ctx.font = '700 24px "Helvetica Neue", Arial, sans-serif';
                ctx.fillStyle = preset.cardBodyColor || '#334155';
                const titleLayout = drawPosterTextBlock(
                    ctx,
                    title,
                    detailX + 24,
                    detailY,
                    detailWidth - 24,
                    30,
                    1
                );

                let nextY = titleLayout.nextY;
                if (note) {
                    ctx.font = '500 21px "Helvetica Neue", Arial, sans-serif';
                    ctx.fillStyle = preset.cardMutedColor || '#64748b';
                    const noteLayout = drawPosterTextBlock(
                        ctx,
                        note,
                        detailX + 24,
                        titleLayout.nextY + 8,
                        detailWidth - 24,
                        26,
                        1
                    );
                    nextY = noteLayout.nextY;
                }

                detailY = nextY + 24;
            });

            drawBenefitIcons(ctx, {
                cardX,
                cardY,
                cardWidth,
                cardHeight,
                icons: loadedBenefitIcons
            });

            drawApiCallout(ctx, {
                cardX,
                cardY,
                cardWidth,
                cardHeight,
                icon: loadedApiCalloutIcon,
                preset
            });

            ctx.fillStyle = state.template === 'crystal'
                ? 'rgba(71, 85, 105, 0.44)'
                : 'rgba(255, 255, 255, 0.46)';
            ctx.font = '500 22px "Helvetica Neue", Arial, sans-serif';
            ctx.fillText(state.legalText || '活动最终解释权归平台所有', 72, 1508);
        }

        function downloadPoster() {
            readControls();
            renderPoster().then(() => {
                const link = document.createElement('a');
                link.href = canvas.toDataURL('image/png');
                link.download = 'Affiliate_Poster_preview.png';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });
        }

        inputIds.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const eventName = el.type === 'file' ? 'change' : 'input';
            el.addEventListener(eventName, requestRender);
        });

        document.querySelectorAll('.template-btn').forEach((button) => {
            button.addEventListener('click', () => {
                state.template = button.dataset.template || 'midnight';
                const defaultOpacity = Math.round((presets[state.template]?.overlayOpacity || 0.52) * 100);
                state.overlayOpacity = defaultOpacity;
                document.getElementById('overlayOpacity').value = String(defaultOpacity);
                document.querySelectorAll('.template-btn').forEach((item) => item.classList.toggle('active', item === button));
                requestRender();
            });
        });

        document.getElementById('backgroundFile').addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            if (!file) {
                state.backgroundDataUrl = '';
                requestRender();
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                state.backgroundDataUrl = String(reader.result || '');
                requestRender();
            };
            reader.readAsDataURL(file);
        });

        document.getElementById('avatarFile').addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            if (!file) {
                state.avatarDataUrl = '';
                requestRender();
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                state.avatarDataUrl = String(reader.result || '');
                state.avatarUrl = '';
                document.getElementById('avatarUrl').value = '';
                setAvatarStatus('已使用上传头像预览。', 'success');
                requestRender();
            };
            reader.readAsDataURL(file);
        });

        document.getElementById('loadProfileBtn').addEventListener('click', () => {
            loadRealUserAvatar();
        });

        document.getElementById('renderBtn').addEventListener('click', () => {
            readControls();
            renderPoster();
        });

        document.getElementById('downloadBtn').addEventListener('click', downloadPoster);

        document.getElementById('resetBtn').addEventListener('click', () => {
            Object.assign(state, defaultState);
            document.getElementById('backgroundFile').value = '';
            document.getElementById('avatarFile').value = '';
            writeControls();
            loadRealUserAvatar();
        });

        writeControls();
        loadRealUserAvatar();
        renderPoster();
    