const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function readText(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('AI image worker has a KVM4 systemd deployment contract', () => {
    const service = readText('deploy/kvm4/ai-image-worker/zaoyoe-ai-image-worker.service');
    const installScript = readText('scripts/install-kvm4-ai-image-worker.sh');
    const packageJson = JSON.parse(readText('package.json'));

    assert.equal(packageJson.scripts['install:kvm4:ai-image-worker'], 'bash scripts/install-kvm4-ai-image-worker.sh');
    assert.match(service, /Description=Zaoyoe AI image queue worker/);
    assert.match(service, /WorkingDirectory=\/opt\/zaoyoe-verify-server\/current/);
    assert.match(service, /EnvironmentFile=\/opt\/zaoyoe-verify-server\/\.env/);
    assert.match(service, /npm run ai-image:worker -- --env-file \/opt\/zaoyoe-verify-server\/\.env --limit 8 --concurrency 4 --interval-ms 3000/);
    assert.match(service, /Restart=always/);
    assert.match(installScript, /does not deploy app code or write/);
    assert.match(installScript, /systemctl enable "\$SERVICE_NAME"/);
    assert.match(installScript, /if \[\[ "\$\{START_NOW:-0\}" == "1" \]\]/);
});

test('AI image ops docs and env template include model and R2 requirements', () => {
    const docs = readText('docs/ai-image-workbench-ops.md');
    const envExample = readText('server/.env.production.example');

    assert.match(docs, /AI_IMAGE_R2_ENDPOINT/);
    assert.match(docs, /AI_IMAGE_API_KEY/);
    assert.match(docs, /AI_IMAGE_CHAT_MODEL/);
    assert.match(docs, /不要在生产启用 inline data URL/);
    assert.match(docs, /--limit 8 --concurrency 4/);
    assert.match(docs, /`--concurrency` 是同一时间执行的任务数/);
    assert.match(docs, /不要从功能分支手动进行生产部署/);
    assert.match(envExample, /AI_IMAGE_API_KEY=/);
    assert.match(envExample, /AI_IMAGE_CHAT_MODEL=gpt-4o-mini/);
    assert.match(envExample, /AI_IMAGE_PROVIDER_TIMEOUT_MS=120000/);
    assert.match(envExample, /AI_IMAGE_RESPONSE_BODY_TIMEOUT_MS=120000/);
    assert.match(envExample, /AI_IMAGE_TASK_TIMEOUT_MS=150000/);
    assert.match(envExample, /AI_IMAGE_STALE_RUNNING_TIMEOUT_MS=180000/);
    assert.match(envExample, /AI_IMAGE_R2_SECRET_ACCESS_KEY=/);
    assert.match(envExample, /AI_IMAGE_ALLOW_INLINE_DATA_URLS=false/);
});

test('AI image ops docs include real configuration simulation checklist', () => {
    const docs = readText('docs/ai-image-workbench-ops.md');

    assert.match(docs, /真实配置自检 \/ 模拟清单/);
    assert.match(docs, /T1[\s\S]*积分文生图/);
    assert.match(docs, /T7[\s\S]*高清原图下载/);
    assert.match(docs, /public\.ai_image_tasks/);
    assert.match(docs, /public\.ai_image_results/);
    assert.match(docs, /public\.ai_image_api_usage/);
    assert.match(docs, /public\.ai_image_download_events/);
    assert.match(docs, /public\.points_ledger/);
    assert.match(docs, /查询结果必须为空/);
    assert.match(docs, /任意表或日志出现用户 API Key 明文/);
    assert.match(docs, /同一个任务产生多条负数 `points_ledger`/);
});
