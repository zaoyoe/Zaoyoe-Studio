(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.CheckoutDiagnostic = api;
})(typeof window === 'object' ? window : this, function () {
    'use strict';

    const STORAGE_KEY = 'kc_admin_checkout_diagnostic_job';
    const TERMINAL = new Set(['success', 'failed', 'cancelled', 'canceled', 'manual', 'maintenance', 'expired']);
    const LABELS = { running: '诊断中', queued: '等待浏览器', pending: '等待检查', passed: '已确认',
        success: '已完成', failed: '失败', cancelled: '已取消', canceled: '已取消', skipped: '未检查',
        unknown: '未确认', unconfirmed: '未确认', warning: '待核对', unverified: '未确认', not_checked: '未检查', cancelling: '正在取消' };
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const isTerminal = status => TERMINAL.has(String(status || '').toLowerCase());
    const safeUrl = value => {
        try {
            const url = new URL(String(value || ''));
            const trusted = ['chatgpt.com', 'openai.com', 'stripe.com', 'claude.ai', 'anthropic.com', 'grok.com', 'x.ai', 'x.com'];
            return url.protocol === 'https:' && !url.username && !url.password
                && trusted.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : '';
        }
        catch (_) { return ''; }
    };
    const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
    const duration = value => Number.isFinite(Number(value)) ? `${(Number(value) / 1000).toFixed(1)} 秒` : '—';

    function normalizeCatalog(data) {
        const catalog = data.catalog || data;
        const suppliedPlans = catalog.plans || catalog.platforms?.flatMap(platform => (platform.plans || []).map(plan => ({
            ...plan, platform: platform.id, planType: plan.id, regions: platform.regions,
            modes: (platform.modes || []).map(mode => typeof mode === 'string' ? mode : mode.id)
        })));
        if (!Array.isArray(suppliedPlans) || !suppliedPlans.length) throw new Error('诊断套餐目录不可用，请重新加载');
        const plans = suppliedPlans.filter(p => ['chatgpt', 'claude', 'grok'].includes(p.platform)
            && p.planType && p.planType !== 'claude_team' && !/^(supergrok|grok_(?:lite|super|plus|heavy|premium)(?:_|$))/.test(p.planType));
        if (!plans.length) throw new Error('没有可诊断的当前商品');
        return { ...catalog, plans, platforms: catalog.platforms || [
            { id: 'chatgpt', label: 'ChatGPT' }, { id: 'claude', label: 'Claude' }, { id: 'grok', label: 'Grok / X' }
        ], regions: catalog.regions || [], defaultRegion: catalog.defaultRegion || data.region || 'PH' };
    }

    function buildPayload({ catalog, platform, planType, country, mode, credential, override, requestId }) {
        const plan = catalog?.plans.find(p => p.platform === platform && p.planType === planType);
        if (!plan) throw new Error('请选择目录中的有效套餐');
        if (!plan.regions?.includes(country)) throw new Error('该套餐不支持所选支付地区');
        if (!plan.modes?.includes(mode) || (platform !== 'chatgpt' && mode === 'link')) throw new Error('该平台不支持仅生成链接模式');
        const session = String(credential || '').trim();
        if (!session) throw new Error(platform === 'chatgpt' ? '请粘贴 ChatGPT Session JSON' : `请粘贴 ${platform === 'claude' ? 'Claude' : 'Grok / X'} 完整登录 Cookie`);
        if (platform === 'chatgpt') {
            let parsed;
            try { parsed = JSON.parse(session); } catch (_) { throw new Error('ChatGPT 凭证必须是有效的 Session JSON'); }
            if (!parsed || typeof parsed !== 'object' || !(parsed.accessToken || parsed.access_token)) throw new Error('Session JSON 缺少 accessToken');
        }
        const payload = { platform, plan_type: planType, country, mode, session, request_id: requestId };
        if (platform === 'chatgpt' && mode === 'link' && String(override || '').trim()) payload.plan_name = String(override).trim();
        return payload;
    }

    function checkoutSummary(report = {}) {
        const checkout = report.checkout || {};
        const confirmed = checkout.confirmed === true || checkout.verified === true;
        const actual = confirmed || report.mode === 'checkout' ? (checkout.actual || checkout) : {};
        const observed = value => value == null || value === '' ? '未确认' : `${value}${confirmed ? '' : '（待核对）'}`;
        return {
            product: observed(actual.productLabel || actual.product || actual.planName || actual.planType),
            amount: observed(actual.amount),
            currency: observed(actual.currency),
            region: report.region || '未指定',
            interval: observed(actual.interval === 'month' ? '月付' : actual.interval === 'year' ? '年付' : actual.interval),
            expectedAmount: checkout.expectedAmount,
            expectedCurrency: checkout.expectedCurrency,
            expiresAt: checkout.expiresAt || null,
            url: safeUrl(checkout.url || checkout.checkoutUrl || checkout.checkout_url),
            confirmed
        };
    }

    function create(options) {
        const doc = options.document;
        const fetcher = options.fetch;
        const storage = options.storage;
        const notify = options.onMessage || (() => {});
        const schedule = options.setTimeout || setTimeout;
        const unschedule = options.clearTimeout || clearTimeout;
        const objectURL = options.URL || (typeof URL === 'function' ? URL : null);
        const state = { catalog: null, platform: 'chatgpt', region: '', jobKey: '', status: '', visible: false,
            busy: false, cancelling: false, timer: null, epoch: 0, page: 1, total: 0, requestId: '', signature: '',
            captcha: null, points: [], captchaBusy: false, media: new Map(), flights: new Map() };
        const el = id => doc.getElementById(id);
        const text = (id, value) => { if (el(id)) el(id).textContent = String(value ?? ''); };
        const html = (id, value) => { if (el(id)) el(id).innerHTML = value; };
        const hidden = (id, value) => { if (el(id)) el(id).hidden = value; };
        const value = id => el(id)?.value || '';
        const currentPlan = () => state.catalog?.plans.find(p => p.platform === value('checkout_platform') && p.planType === value('checkout_plan_type'));
        function error(message) { text('checkout_connection_hint', message); notify(message, 'error'); }
        function persist(key) { try { key ? storage?.setItem(STORAGE_KEY, key) : storage?.removeItem(STORAGE_KEY); } catch (_) {} }
        function storedJob() { try { return storage?.getItem(STORAGE_KEY) || ''; } catch (_) { return ''; } }

        async function request(path, init) {
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const timer = schedule(() => controller?.abort(), 20000);
            try {
                const response = await fetcher(path, { ...init, signal: controller?.signal });
                let data;
                try { data = await response.json(); } catch (_) { throw new Error('服务返回无法解析的数据，请重试'); }
                if (!response.ok || data.success === false) {
                    const failure = new Error(data.error || data.message || `请求失败（${response.status}）`);
                    failure.status = response.status;
                    throw failure;
                }
                return data;
            } catch (failure) {
                if (failure.name === 'AbortError') throw new Error('请求超时，请刷新状态确认任务是否已启动');
                throw failure;
            } finally { unschedule(timer); }
        }
        function single(key, action) {
            if (state.flights.has(key)) return state.flights.get(key);
            const promise = action().finally(() => state.flights.delete(key));
            state.flights.set(key, promise);
            return promise;
        }
        function controls() {
            const active = state.jobKey && !isTerminal(state.status);
            if (el('checkout_generate_btn')) el('checkout_generate_btn').disabled = !state.catalog || state.busy || Boolean(active);
            if (el('checkout_cancel_btn')) el('checkout_cancel_btn').disabled = !active || state.cancelling;
            if (el('checkout_clear_btn')) el('checkout_clear_btn').disabled = state.busy;
            text('checkout_generate_label', state.busy ? '正在启动…' : '开始诊断');
            text('checkout_cancel_label', state.cancelling ? '正在取消…' : '取消当前任务');
            for (const id of ['checkout_platform', 'checkout_plan_type', 'checkout_region_selector', 'checkout_mode', 'checkout_plan_override']) {
                if (el(id)) el(id).disabled = state.busy || Boolean(active);
            }
            hidden('checkout_advanced', value('checkout_platform') !== 'chatgpt' || value('checkout_mode') !== 'link');
        }
        function populate(id, entries, selected) {
            html(id, entries.map(item => `<option value="${escape(item.value)}">${escape(item.label)}</option>`).join(''));
            if (el(id)) el(id).value = entries.some(item => item.value === selected) ? selected : entries[0]?.value || '';
        }
        function syncPlan({ resetOverride = false } = {}) {
            const plan = currentPlan();
            if (!plan) return;
            const names = state.catalog.planNames || {};
            text('checkout_plan_name_display', plan.planName || names[plan.planType] || plan.planType);
            const regions = (plan.regions || []).map(code => {
                const item = state.catalog.regions.find(r => (r.code || r.value || r.id) === code);
                return { value: code, label: `${item?.label || code} (${code})${item?.currency ? ` · ${item.currency}` : ''}` };
            });
            const recommended = plan.defaultRegion || (plan.planType === 'go' ? 'PH' : state.catalog.defaultRegion);
            populate('checkout_region_selector', regions, regions.some(r => r.value === state.region) ? state.region : recommended);
            state.region = value('checkout_region_selector');
            const modes = (plan.modes || []).filter(mode => mode !== 'link' || plan.platform === 'chatgpt');
            populate('checkout_mode', modes.map(mode => ({ value: mode, label: mode === 'link' ? '仅生成链接' : '打开并检查收银台' })), value('checkout_mode') || 'checkout');
            if (resetOverride && el('checkout_plan_override')) el('checkout_plan_override').value = '';
            hidden('checkout_advanced', plan.platform !== 'chatgpt');
            const credentials = {
                chatgpt: ['ChatGPT Session JSON', '粘贴 chatgpt.com/api/auth/session 返回的完整 JSON。', '粘贴完整 Session JSON（含 accessToken）'],
                claude: ['Claude 登录 Cookie', '粘贴 Claude 完整登录 Cookie（包含 sessionKey）。', '粘贴 Claude 完整 Cookie，包含 sessionKey=…'],
                grok: ['Grok / X 登录 Cookie', '粘贴与当前 Grok / X 商品对应的完整登录 Cookie；不要使用 ChatGPT Session。', '粘贴 Grok / X 完整登录 Cookie']
            }[plan.platform];
            text('checkout_credential_label', credentials[0]);
            text('checkout_credential_hint', credentials[1]);
            if (el('checkout_session_input')) el('checkout_session_input').placeholder = credentials[2];
            regionChanged();
            controls();
        }
        function platformChanged() {
            const platform = value('checkout_platform');
            if (platform !== state.platform && el('checkout_session_input')) el('checkout_session_input').value = '';
            state.platform = platform;
            state.region = '';
            populate('checkout_plan_type', state.catalog.plans.filter(p => p.platform === platform).map(p => ({ value: p.planType, label: p.label })), '');
            syncPlan({ resetOverride: true });
        }
        function planChanged() { syncPlan({ resetOverride: true }); }
        function regionChanged() {
            state.region = value('checkout_region_selector');
            const region = state.catalog?.regions.find(r => (r.code || r.value || r.id) === state.region);
            text('checkout_region_hint', `本次诊断：${region?.label || state.region} / ${region?.currency || currentPlan()?.currency || '—'}。不会更改全局默认地区。`);
            const plan = currentPlan();
            if (plan) {
                const amount = state.region === 'US' ? (plan.expectedAmount ?? plan.amount) : null;
                const period = /年付|月付|年费|monthly|annual|yearly/i.test(plan.label) ? '' : ` · ${plan.interval === 'year' || plan.interval === 'annual' ? '年付' : '月付'}`;
                text('checkout_expected_hint', `目录商品：${plan.label}${period}${amount != null ? ` · 参考金额 ${amount} ${plan.currency || 'USD'}` : ' · 地区价格待收银台确认'}。实际金额与商品以诊断报告为准。`);
            }
        }
        async function loadCatalog() {
            try {
                const data = await single('catalog', () => request('/api/admin/checkout/plans'));
                state.catalog = normalizeCatalog(data);
                const scope = state.catalog.scopeLabel || '检查本地银行卡池的结账链路，不代表第三方代充 API 路线已通过验证。';
                text('checkout_scope_hint', `${data.configuredRechargeMode === 'third_party_api' ? '当前 ChatGPT 正式充值使用第三方代充 API。' : ''}${scope}`);
                populate('checkout_platform', state.catalog.platforms.filter(p => state.catalog.plans.some(plan => plan.platform === p.id)).map(p => ({ value: p.id, label: p.label || p.name || p.id })), state.platform);
                const oldPlan = value('checkout_plan_type');
                populate('checkout_plan_type', state.catalog.plans.filter(p => p.platform === value('checkout_platform')).map(p => ({ value: p.planType, label: p.label })), oldPlan);
                syncPlan();
                text('checkout_connection_hint', '');
            } catch (failure) { state.catalog = null; error(failure.message); }
            controls();
        }

        function stop() {
            state.visible = false;
            unschedule(state.timer); state.timer = null;
        }
        function schedulePoll() {
            unschedule(state.timer);
            if (!state.visible || !state.jobKey || isTerminal(state.status)) return;
            state.timer = schedule(async () => { state.timer = null; await refresh(false); schedulePoll(); }, 2000);
        }
        function startStream() {
            state.visible = true;
            if (state.jobKey && !isTerminal(state.status)) schedulePoll();
        }
        function releaseMedia() {
            for (const url of state.media.values()) objectURL?.revokeObjectURL?.(url);
            state.media.clear();
        }
        function selectJob(key, status = 'running') {
            stop(); releaseMedia(); state.epoch += 1;
            state.jobKey = key; state.status = status; state.cancelling = false;
            state.captcha = null; state.points = []; hidden('checkout_captcha_box', true);
            persist(key); text('checkout_job_hint', key ? `任务 ${key}` : '');
            html('checkout_media_list', ''); text('checkout_debug_log_pre', '');
            if (el('checkout_media_list')) delete el('checkout_media_list').dataset.signature;
            controls();
        }
        async function start() {
            if (state.busy || (state.jobKey && !isTerminal(state.status))) return;
            let payload;
            try {
                const input = { catalog: state.catalog, platform: value('checkout_platform'), planType: value('checkout_plan_type'),
                    country: state.region, mode: value('checkout_mode'), credential: value('checkout_session_input'), override: value('checkout_plan_override') };
                const signature = JSON.stringify({ ...input, catalog: undefined });
                if (signature !== state.signature || !state.requestId) {
                    state.requestId = options.randomId?.() || `diag-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    state.signature = signature;
                }
                payload = buildPayload({ ...input, requestId: state.requestId });
            } catch (failure) { error(failure.message); return; }
            state.busy = true; controls(); text('checkout_connection_hint', '');
            hidden('checkout_result_box', true);
            try {
                const data = await request('/api/admin/checkout/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (!data.jobKey) throw new Error('服务没有返回任务编号，请从历史记录确认任务');
                selectJob(data.jobKey, data.status || 'running');
                if (el('checkout_session_input')) el('checkout_session_input').value = '';
                state.signature = ''; state.requestId = '';
                render({ ...data, status: data.status || 'running' });
                startStream(); await refresh(false); await history(1);
            } catch (failure) { error(failure.message); }
            finally { state.busy = false; controls(); }
        }
        function clear() {
            if (el('checkout_session_input')) el('checkout_session_input').value = '';
            if (el('checkout_plan_override')) el('checkout_plan_override').value = '';
            if (state.jobKey && !isTerminal(state.status)) {
                text('checkout_connection_hint', '输入已清空；当前诊断继续运行。需要停止时请点击“取消当前任务”。');
                return;
            }
            selectJob('', ''); state.signature = ''; state.requestId = '';
            hidden('checkout_result_box', true); text('checkout_connection_hint', '');
        }
        async function cancel() {
            if (!state.jobKey || isTerminal(state.status) || state.cancelling) return;
            const key = state.jobKey;
            state.cancelling = true; controls();
            try {
                const data = await request(`/api/admin/checkout/cancel/${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                if (state.jobKey !== key) return;
                text('checkout_connection_hint', data.message || '已请求取消，等待后台释放浏览器并确认终态。');
                await refresh(false); schedulePoll();
            } catch (failure) { state.cancelling = false; error(failure.message); }
            controls();
        }
        async function refresh(manual = true) {
            if (!state.jobKey) { if (manual) text('checkout_connection_hint', '请开始诊断或打开一条历史记录。'); return; }
            const key = state.jobKey; const epoch = state.epoch;
            try {
                const data = await single(`status:${key}`, () => request(`/api/admin/checkout/status/${encodeURIComponent(key)}`));
                if (epoch !== state.epoch || state.jobKey !== key) return;
                render(data); text('checkout_connection_hint', '');
                if (isTerminal(state.status) || data.is_terminal === true) {
                    stop(); state.cancelling = false; hidden('checkout_captcha_box', true); controls();
                }
            } catch (failure) {
                if (epoch !== state.epoch) return;
                text('checkout_connection_hint', `状态更新失败：${failure.message}。可点击“刷新状态”重试。`);
                if ([404, 410].includes(failure.status)) {
                    stop(); state.status = 'expired'; persist(''); controls();
                    text('checkout_result_status', '该任务已不存在，请检查历史记录后重新诊断。');
                }
                if (manual) notify(failure.message, 'error');
            }
        }
        function render(data) {
            const report = data.report || {};
            const checkout = checkoutSummary(report);
            state.status = data.status || 'running';
            hidden('checkout_result_box', false);
            const statusEl = el('checkout_result_status');
            if (statusEl) statusEl.dataset.status = state.status;
            const resultLabel = state.status === 'success'
                ? (report.mode === 'link' ? '链接已生成 · 未核验收银台' : checkout.confirmed ? '收银台检查完成' : '收银台信息尚未完整核验')
                : LABELS[state.status] || state.status;
            if (statusEl && state.status === 'success' && !checkout.confirmed) statusEl.dataset.status = 'unconfirmed';
            text('checkout_result_status', `${resultLabel}${data.message ? ` · ${data.message}` : ''}`);
            const progress = Math.min(100, Math.max(0, Number(data.progress) || 0));
            if (el('checkout_progress')) { el('checkout_progress').value = progress; el('checkout_progress').setAttribute('aria-valuetext', `${progress}%`); }
            text('checkout_progress_label', `${progress}%`);
            text('checkout_result_email', report.account?.email ? `官方账号邮箱：${report.account.email}`
                : data.email ? `提交凭证中的邮箱：${data.email}` : '');
            text('checkout_report_meta', `${report.platform || '—'} · ${report.planType || '—'} · ${report.region || '—'} · ${report.mode === 'link' ? '仅生成链接' : report.mode === 'checkout' ? '收银台检查' : '—'} · ${duration(report.durationMs ?? report.elapsedMs ?? data.duration_ms)} · 开始 ${time(report.startedAt || data.started_at)}${report.finishedAt || data.finished_at ? ` · 结束 ${time(report.finishedAt || data.finished_at)}` : ''}`);
            const stages = report.stages || data.stages || (Array.isArray(report.checks) ? report.checks : []);
            html('checkout_stages', stages.length ? stages.map(stage => `<li class="diagnostic-stage" data-status="${escape(stage.status || 'pending')}"><div><strong>${escape(stage.label || stage.id)}</strong><span>${escape(LABELS[stage.status] || stage.status || '等待检查')}</span></div><p>${escape(stage.detail || stage.message || '')}</p><small>${escape(duration(stage.elapsedMs ?? stage.durationMs))}</small></li>`).join('') : '<li class="diagnostic-empty">等待后台阶段报告…</li>');
            const rawChecks = report.checks || data.checks || [];
            const checks = Array.isArray(rawChecks) ? rawChecks : Object.entries(rawChecks).map(([id, check]) => typeof check === 'object' && check ? { id, ...check } : { id, status: check === true ? 'passed' : 'unknown' });
            const separateStages = stages.length > 0 && JSON.stringify(stages) !== JSON.stringify(checks);
            hidden('checkout_checks_title', !separateStages);
            hidden('checkout_checks', !separateStages);
            html('checkout_checks', checks.length ? checks.map(check => `<div class="diagnostic-check" data-status="${escape(check.status || 'unknown')}"><span>${escape(check.label || check.id)}</span><strong>${escape(LABELS[check.status] || check.status || '未确认')}</strong><p>${escape(check.detail || check.message || '')}</p></div>`).join('') : '<p class="diagnostic-empty">尚无检查证据；不能据此判断可以完成充值。</p>');
            const pairs = [['已读取商品', checkout.product], ['已读取金额', checkout.amount], ['已读取币种', checkout.currency], ['请求地区', checkout.region], ['已读取计费周期', checkout.interval], ['目录参考金额', checkout.expectedAmount != null ? `${checkout.expectedAmount} ${checkout.expectedCurrency || ''}` : '该地区未提供目录价'], ['链接到期时间', checkout.expiresAt ? time(checkout.expiresAt) : '上游未提供']];
            html('checkout_facts', pairs.map(([label, item]) => `<div><dt>${escape(label)}</dt><dd>${escape(item)}</dd></div>`).join(''));
            text('checkout_verification_hint', checkout.confirmed ? '后台已提供商品检查证据，仍未进行付款。' : '实际商品、金额或币种尚未完整确认；生成链接或打开页面不代表支付成功。');
            const url = checkout.url || safeUrl(data.checkout_url);
            html('checkout_result_url_wrap', url ? `<div class="diagnostic-toolbar"><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">打开上游收银台链接 <span aria-hidden="true">↗</span></a><button type="button" class="btn btn-secondary" data-diagnostic-copy-url="${escape(url)}">复制链接</button></div><p class="diagnostic-muted">链接可能要求相同账号登录；诊断不会替你提交付款。</p>` : '<span class="diagnostic-muted">暂无可打开的收银台链接。</span>');
            if (typeof data.raw_output === 'string') {
                text('checkout_debug_log_pre', data.raw_output || '暂无输出，阶段报告会随任务更新。');
                const pre = el('checkout_debug_log_pre');
                if (el('checkout_log_autoscroll')?.checked) { if (pre?.parentElement) pre.parentElement.scrollTop = pre.parentElement.scrollHeight; }
            }
            renderMedia(data.screenshots || [], data.videos || []);
            if (Object.hasOwn(data, 'captcha')) renderCaptcha(data.captcha);
            controls();
        }
        function renderMedia(screenshots, videos) {
            const entries = [...screenshots.map(path => ({ kind: 'screenshot', path })), ...videos.map(path => ({ kind: 'video', path }))];
            const signature = JSON.stringify(entries);
            if (el('checkout_media_list')?.dataset.signature === signature) return;
            releaseMedia();
            if (el('checkout_media_list')) el('checkout_media_list').dataset.signature = signature;
            html('checkout_media_list', entries.length ? entries.map(item => `<div class="diagnostic-media"><button type="button" class="btn btn-secondary" data-diagnostic-media="${item.kind}" data-path="${escape(item.path)}">${item.kind === 'video' ? '加载录像' : '加载截图'}</button><span>${escape(item.path)}</span><div class="diagnostic-media-preview"></div></div>`).join('') : '<p class="diagnostic-empty">尚无截图或录像。</p>');
        }
        async function loadMedia(button) {
            const epoch = state.epoch;
            const kind = button.dataset.diagnosticMedia;
            const path = button.dataset.path;
            button.disabled = true;
            try {
                const endpoint = kind === 'video' ? `/api/admin/video?path=${encodeURIComponent(path)}` : options.screenshotPath(path);
                const response = await fetcher(endpoint);
                if (!response.ok) throw new Error('媒体已不存在或暂时无法加载');
                const url = objectURL.createObjectURL(await response.blob());
                if (epoch !== state.epoch) { objectURL.revokeObjectURL(url); return; }
                state.media.set(`${kind}:${path}`, url);
                const preview = button.parentElement.querySelector('.diagnostic-media-preview');
                preview.innerHTML = kind === 'video' ? `<video src="${escape(url)}" controls preload="metadata"></video>` : `<img src="${escape(url)}" alt="诊断截图" loading="lazy">`;
                button.hidden = true;
            } catch (failure) { error(failure.message); button.disabled = false; }
        }
        async function copyUrl(url) {
            const trusted = safeUrl(url);
            if (!trusted) return error('没有可信的收银台链接可复制');
            try {
                await options.copyText(trusted);
                notify('收银台链接已复制', 'success');
            } catch (_) { error('复制失败，请使用打开链接按钮'); }
        }
        async function history(page = state.page) {
            try {
                const data = await single('history', () => request(`/api/admin/checkout/history?page=${Math.max(1, Number(page) || 1)}&limit=10`));
                state.page = Number(data.page) || 1; state.total = Number(data.total) || 0;
                const tasks = data.tasks || [];
                text('checkout_history_error', '');
                html('checkout_history_list', tasks.length ? tasks.map(task => {
                    const report = task.report || {};
                    const platform = state.catalog?.platforms.find(item => item.id === report.platform);
                    const plan = state.catalog?.plans.find(item => item.platform === report.platform && item.planType === report.planType);
                    return `<div class="diagnostic-history-row"><div><strong>${escape(platform?.name || platform?.label || report.platform || '诊断')} · ${escape(plan?.label || report.planType || '—')}</strong><span>${escape(task.status === 'success' && report.mode === 'link' ? '链接已生成 · 未核验' : LABELS[task.status] || task.status)} · ${escape(report.region || '—')} · ${escape(time(report.startedAt || task.started_at))}</span><small>${escape(task.message || task.jobKey)}</small></div><button type="button" class="btn btn-secondary" data-diagnostic-job="${escape(task.jobKey)}">查看报告</button></div>`;
                }).join('') : '<p class="diagnostic-empty">还没有诊断记录。</p>');
                text('checkout_history_page', `第 ${state.page} 页 · 共 ${state.total} 条`);
                if (el('checkout_history_prev')) el('checkout_history_prev').disabled = state.page <= 1;
                if (el('checkout_history_next')) el('checkout_history_next').disabled = !(data.has_more ?? (state.page * (Number(data.limit) || 10) < state.total));
            } catch (failure) { text('checkout_history_error', `历史记录加载失败：${failure.message}`); }
        }
        async function openHistory(key) {
            if (state.jobKey && !isTerminal(state.status) && state.jobKey !== key) { error('当前诊断仍在运行，请先取消或等待完成后再切换历史记录。'); return; }
            selectJob(key); startStream(); await refresh(true);
            el('checkout_result_box')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        }
        async function load() {
            state.visible = true;
            await loadCatalog();
            if (!state.jobKey && storedJob()) selectJob(storedJob());
            startStream(); await Promise.all([refresh(false), history(1)]);
        }

        function renderCaptcha(captcha) {
            if (!captcha || captcha.active === false || isTerminal(state.status)) { hidden('checkout_captcha_box', true); state.captcha = null; return; }
            const nextFrame = Number(captcha.frameSeq || 0);
            if (nextFrame !== Number(state.captcha?.frameSeq || 0)) { state.points = []; state.captchaBusy = false; html('checkout_captcha_markers', ''); }
            state.captcha = captcha; hidden('checkout_captcha_box', false);
            text('checkout_captcha_prompt', captcha.promptZh || captcha.promptEn || captcha.message || captcha.title || '请协助完成官方人机验证');
            text('checkout_captcha_hint', captcha.loading || captcha.contentReady === false ? '正在等待官方题图加载…' : state.captchaBusy ? '操作已发送，等待官方画面更新…' : '选择操作方式，然后直接操作下方官方验证画面。');
            const image = el('checkout_captcha_image');
            if (image) {
                const src = String(captcha.image || '');
                const validImage = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(src);
                image.src = validImage ? src : '';
                image.hidden = !validImage || captcha.loading || captcha.contentReady === false;
                image.setAttribute('aria-disabled', String(state.captchaBusy));
            }
            text('checkout_captcha_expiry', captcha.expiresAt ? `验证等待截止：${time(captcha.expiresAt)}` : '');
        }
        function point(event) {
            const rect = el('checkout_captcha_image').getBoundingClientRect();
            return { ratioX: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), ratioY: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
        }
        async function captchaAction(payload, drag = false) {
            const key = state.jobKey; const frame = state.captcha?.frameSeq;
            if (!key || !state.captcha || state.captchaBusy || state.captcha.loading || state.captcha.contentReady === false) return;
            if (state.captcha.expiresAt && Date.now() >= Number(state.captcha.expiresAt)) { error('验证画面已过期，请等待新的题图。'); return; }
            state.captchaBusy = true; text('checkout_captcha_hint', '操作已发送，等待官方画面更新…');
            try {
                const data = await request(`/api/admin/checkout/captcha-${drag ? 'drag' : 'click'}/${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, frameSeq: frame }) });
                if (!data.handled) throw new Error('画面已更新或验证已结束，请刷新状态后重试');
            } catch (failure) { if (state.jobKey === key) { state.captchaBusy = false; error(failure.message); } }
        }
        function captchaClick(event) {
            if (value('checkout_captcha_mode') === 'drag' || !state.captcha || state.captchaBusy || state.captcha.loading || state.captcha.contentReady === false) return;
            const location = point(event);
            if (value('checkout_captcha_mode') === 'select' && !(location.ratioY > 0.78 && location.ratioX >= 0.58)) {
                const index = state.points.findIndex(p => Math.hypot(p.ratioX - location.ratioX, p.ratioY - location.ratioY) < 0.08);
                if (index >= 0) state.points.splice(index, 1); else state.points.push(location);
                html('checkout_captcha_markers', state.points.map(p => `<span style="left:${p.ratioX * 100}%;top:${p.ratioY * 100}%">✓</span>`).join(''));
                text('checkout_captcha_hint', `已选 ${state.points.length} 项；点击已选目标可取消，最后点击画面内右下角提交按钮。`);
                return;
            }
            return captchaAction(state.points.length ? { ...location, action: 'submit', points: state.points, submitPoint: location } : { ...location, action: 'click' });
        }
        let dragStart = null;
        el('checkout_captcha_image')?.addEventListener('pointerdown', event => {
            if (value('checkout_captcha_mode') === 'drag') { dragStart = point(event); event.preventDefault(); event.target.setPointerCapture?.(event.pointerId); }
        });
        el('checkout_captcha_image')?.addEventListener('pointerup', event => {
            if (!dragStart) return;
            const end = point(event); const start = dragStart; dragStart = null;
            captchaAction({ fromRatioX: start.ratioX, fromRatioY: start.ratioY, toRatioX: end.ratioX, toRatioY: end.ratioY }, true);
        });
        el('checkout_captcha_image')?.addEventListener('click', captchaClick);
        el('checkout_mode')?.addEventListener('change', controls);
        el('checkout_captcha_mode')?.addEventListener('change', () => { state.points = []; html('checkout_captcha_markers', ''); });
        el('checkout_debug')?.addEventListener('click', event => {
            const copy = event.target.closest('[data-diagnostic-copy-url]');
            if (copy) copyUrl(copy.dataset.diagnosticCopyUrl);
            const media = event.target.closest('[data-diagnostic-media]');
            if (media) loadMedia(media);
            const task = event.target.closest('[data-diagnostic-job]');
            if (task) openHistory(task.dataset.diagnosticJob);
        });
        return { load, loadCatalog, start, clear, cancel, refresh, history, openHistory, startStream, stop,
            platformChanged, planChanged, regionChanged, render, renderCaptcha, captchaClick, copyUrl, state };
    }
    return { create, normalizeCatalog, buildPayload, checkoutSummary, isTerminal, safeUrl, STORAGE_KEY };
});
