#!/usr/bin/env node
'use strict';

// Isolated browser fixture using the actual supplier markup, CSS and ShopAdmin.
// No credentials, database, external requests, upstream purchases or port 8000.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sources = ['admin-studio.html', 'js/admin-shop.js', 'css/admin-studio-page.css', 'admin-studio.css', 'prompts-poetry.css'];
const sourceHash = crypto.createHash('sha256');
for (const file of sources) sourceHash.update(file).update(fs.readFileSync(path.join(root, file)));
const diagnostics = { sourceCommit, sourceHash: sourceHash.digest('hex'), fixture: true,
    workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0 };
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'supplier-readonly-smoke-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'supplier-readonly-chrome-'));
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const fixture = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<script>
window.fixtureReady = (async () => {
  const original = await (await fetch('/admin-studio.html')).text();
  const parsed = new DOMParser().parseFromString(original, 'text/html');
  const css = [...parsed.querySelectorAll('link[rel="stylesheet"]')].filter(link => !/^(?:https?:)?\\/\\//.test(link.getAttribute('href')));
  await Promise.all(css.map(link => new Promise(resolve => { const cloned = link.cloneNode(true); cloned.onload = cloned.onerror = resolve; document.head.append(cloned); })));
  const style = document.createElement('style');
  style.textContent = 'body{padding:24px;box-sizing:border-box}#module-shop{display:block!important;width:100%;max-width:1200px;margin:auto}#shop-view-supplier-catalog{display:block!important}@media(max-width:640px){body{padding:12px}}';
  document.head.append(style);
  const module = document.createElement('main'); module.id = 'module-shop';
  module.append(parsed.getElementById('shop-view-supplier-catalog'), parsed.getElementById('supplierCatalogDetailModal'));
  document.body.append(module);
  window.AdminShell = { registerModule() {} };
  window.__requests = [];
  const item = { providerGoodsId:'XR-FIXTURE', name:'模拟商品 · 固定规格', description:'浏览器模拟资料，仅验证只读界面与草稿操作。', supplierUnitPrice:'12.340000', currency:null, availableQuantity:8, minimumQuantity:1, deliveryLabel:'交付语义待核验', variantRequirements:{importable:true,requiresRace:true,races:['月卡','年卡'],reasons:[]} };
  window.AdminApi = { async fetch(raw, options = {}) {
    const url = new URL(raw, location.origin), action = options.method === 'POST' ? JSON.parse(options.body).action : url.searchParams.get('action');
    window.__requests.push({action,providerId:url.searchParams.get('providerId'),accountKey:url.searchParams.get('accountKey')});
    let payload;
    if (action === 'accounts') payload = {success:true,accounts:[{accountKey:'fixture',displayName:'模拟账号',enabled:true,configured:true}]};
    else if (action === 'list') payload = {success:true,total:1,pageNo:1,items:[item]};
    else if (action === 'detail') { if(window.__holdDetail) await new Promise(resolve => {window.__releaseDetail = resolve}); payload = {success:true,item}; }
    else if (action === 'preview') payload = {success:true,stock:{availableQuantity:8},quote:{amount:'12.340000',currency:null,locked:false,procurementReady:false}};
    else if (action === 'import') payload = {success:true,results:[{goodsNo:'XR-FIXTURE',status:'imported_as_draft',productId:'00000000-0000-4000-8000-000000000001',site:'cn'}]};
    else throw new Error('Unexpected fixture action: '+action);
    return {ok:true,status:200,json:async()=>payload};
  }};
  await new Promise((resolve,reject) => { const script = document.createElement('script'); script.src = '/js/admin-shop.js'; script.onload = resolve; script.onerror = reject; document.body.append(script); });
  ShopAdmin.isShopModuleVisible = () => false;
  ShopAdmin.buildAdminShopUrl = (_, params = {}) => '/api/admin/shop/supplier-catalog?'+new URLSearchParams(params);
  ShopAdmin.getAdminAuthHeaders = async () => ({'Content-Type':'application/json'});
  ShopAdmin.bindDelegatedHandlers();
  window.confirm = () => true;
  document.getElementById('supplierCatalogProvider').value = 'xiareng';
  await ShopAdmin.loadSupplierCatalog({force:true});
  return true;
})();
</script></body></html>`;

async function main() {
    console.log(JSON.stringify({ ...diagnostics, output, state: 'STARTED' }));
    const server = http.createServer((req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Security-Policy', "default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:");
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fixture); }
        if (url.pathname === '/source.json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(diagnostics)); }
        const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (!file.startsWith(`${root}${path.sep}`) || !/\.(?:html|css|js|svg|png|woff2?|ttf)$/.test(file) || !fs.existsSync(file)) {
            res.writeHead(404); return res.end();
        }
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let socket;
    try {
        for (let n = 0; !fs.existsSync(path.join(profile, 'DevToolsActivePort')); n++) {
            if (n >= 100 || chrome.exitCode !== null) throw new Error('Headless Chrome did not start');
            await pause(100);
        }
        const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
        const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
        socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
        const pending = new Map(); let sequence = 0;
        const exceptions = [];
        socket.addEventListener('message', (event) => {
            const data = JSON.parse(event.data);
            if (data.id) { const callback = pending.get(data.id); if (callback) { pending.delete(data.id); data.error ? callback.reject(new Error(data.error.message)) : callback.resolve(data.result); } }
            else if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails.text);
        });
        const call = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++sequence;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
            pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
            socket.send(JSON.stringify({ id, method, params }));
        });
        const evaluate = async (expression) => {
            const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        await call('Runtime.enable'); await call('Page.enable');
        await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
        for (let n = 0; !await evaluate('Boolean(window.fixtureReady)'); n++) { if (n > 100) throw new Error('Fixture failed to initialize'); await pause(50); }
        await evaluate('window.fixtureReady');
        const scenarios = [];
        const screenshot = async (name) => { const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(image.data, 'base64')); };
        const frame = () => evaluate(`(()=>{const b=document.querySelector('.shop-supplier-catalog-detail-modal__content').getBoundingClientRect();return {width:b.width,height:b.height,left:b.left,right:b.right,top:b.top,bottom:b.bottom,viewport:innerWidth}})()`);
        for (const [width, height] of [[1440, 1000], [390, 844]]) {
            await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
            for (const theme of ['light', 'dark']) {
                await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};ShopAdmin.closeSupplierCatalogDetail()`);
                await pause(450);
                const layout = await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,scrollWidth:document.documentElement.scrollWidth,overflowElements:[...document.querySelectorAll('#module-shop *')].filter(e=>{const b=e.getBoundingClientRect();return b.width&&b.right>innerWidth+1}).slice(0,12).map(e=>({tag:e.tagName,id:e.id,className:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})),selectedDisabled:document.getElementById('supplierCatalogSelectAll').disabled,selects:[...document.querySelectorAll('.shop-supplier-catalog__toolbar select')].map(e=>Math.round(e.getBoundingClientRect().height)),input:Math.round(document.getElementById('supplierCatalogSearchInput').getBoundingClientRect().height),rows:document.querySelectorAll('#supplierCatalogTableBody tr').length})`);
                await screenshot(`${width}-${theme}-catalog`);
                if (layout.overflow) console.error(JSON.stringify({ width, theme, layout }));
                assert.equal(layout.overflow, false, `catalog horizontal overflow at ${width}/${theme}`);
                assert.equal(layout.selectedDisabled, true, 'Xiareng bulk import must be disabled');
                assert.equal(layout.rows, 1);
                assert.ok(Math.max(...layout.selects, layout.input) - Math.min(...layout.selects, layout.input) <= 2, 'toolbar controls need equal height');
                await evaluate(`window.__holdDetail=true;window.__opening=ShopAdmin.openSupplierCatalogDetail('XR-FIXTURE');true`);
                await pause(450); // Let the existing modal entrance finish before comparing content frames.
                const loading = await frame();
                await screenshot(`${width}-${theme}-loading`);
                await evaluate('window.__releaseDetail();window.__opening');
                await pause(100);
                const loaded = await frame();
                assert.ok(loaded.width <= width && loaded.left >= -1 && loaded.right <= width + 1, 'detail must fit width');
                assert.ok(loaded.top >= -1 && loaded.bottom <= height + 1, 'detail must fit height');
                assert.ok(Math.abs(loaded.width - loading.width) <= 1, `loading frame width must stay stable: ${loading.width} -> ${loaded.width}`);
                assert.ok(Math.abs(loaded.height - loading.height) <= 32, `loading/detail height jump: ${loading.height} -> ${loaded.height}`);
                const disabled = await evaluate(`document.querySelector('[data-shop-action="supplier-catalog-import-detail"]').disabled`);
                assert.equal(disabled, true, 'race is required before import');
                await evaluate(`document.getElementById('supplierCatalogRace').value='月卡';document.getElementById('supplierCatalogRace').dispatchEvent(new Event('change',{bubbles:true}));true`);
                await evaluate('ShopAdmin.previewSupplierCatalogDetail()');
                assert.match(await evaluate(`document.getElementById('supplierCatalogPreview').textContent`), /12\.340000.*币种待核验/);
                await screenshot(`${width}-${theme}-detail`);
                scenarios.push({ width, theme, loading, loaded, layout });
            }
        }
        await evaluate('ShopAdmin.importSupplierCatalogDetail()');
        const feedback = await evaluate(`({text:document.getElementById('supplierCatalogFeedback').textContent,closed:!document.getElementById('supplierCatalogDetailModal').classList.contains('active'),requests:window.__requests})`);
        assert.match(feedback.text, /已生成草稿.*编辑草稿/s);
        assert.equal(feedback.closed, true);
        assert.equal(feedback.requests.filter((request) => request.action === 'import').length, 1);
        assert.deepEqual(exceptions, []);
        const report = { ...diagnostics, scenarios, feedback, javascriptExceptions: exceptions, result: 'PASS', merchantAcceptance: 'NOT RUN', databaseAcceptance: 'NOT RUN' };
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ ...diagnostics, result: 'PASS', scenarios: scenarios.length, output }, null, 2));
    } finally {
        socket?.close();
        chrome.kill('SIGTERM');
        await new Promise((resolve) => server.close(resolve));
        if (chrome.exitCode === null) await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), pause(2000)]);
        if (chrome.exitCode === null) chrome.kill('SIGKILL');
        fs.rmSync(profile, { recursive: true, force: true });
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
