const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {
    decodeCopyValue, parseCopyHeader, splitCopyRow, parseStructuredValue,
    collectAssets, describeUrl, auditLines, auditBackup, parseArgs
} = require('../scripts/audit-image-backup');

const project = 'abcdefghijklmnopqrst';
const encode = (value) => value == null ? '\\N' : String(value)
    .replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('\r', '\\r').replaceAll('\n', '\\n');
function section(table, columns, rows) {
    return [
        `COPY ${table} (${columns.join(', ')}) FROM stdin;`,
        ...rows.map((row) => row.map(encode).join('\t')),
        '\\.'
    ];
}
const table = (report, name) => report.tables.find((item) => item.table === name);

test('COPY decoder distinguishes null, empty and literal null markers', () => {
    assert.equal(decodeCopyValue('\\N'), null);
    assert.equal(decodeCopyValue(''), '');
    assert.equal(decodeCopyValue('\\\\N'), '\\N');
    assert.equal(decodeCopyValue('a\\tb\\nc\\rd\\\\e'), 'a\tb\nc\rd\\e');
});

test('COPY decoder preserves UTF-8 encoded with octal or hex escapes', () => {
    assert.equal(decodeCopyValue('\\303\\251'), 'é');
    assert.equal(decodeCopyValue('\\xc3\\xa9'), 'é');
    assert.equal(decodeCopyValue('中文'), '中文');
});

test('COPY header accepts quoted identifiers and rejects alternate formats', () => {
    assert.deepEqual(parseCopyHeader('COPY "public"."prompts" ("id", images) FROM stdin;'), {
        schema: 'public', table: 'prompts', columns: ['id', 'images']
    });
    assert.equal(parseCopyHeader('COPY public.prompts (id) FROM stdin WITH CSV;'), null);
});

test('COPY splitter preserves escaped tabs and literal backslashes', () => {
    assert.deepEqual(splitCopyRow('a\\\tb\tc'), ['a\\\tb', 'c']);
    assert.deepEqual(splitCopyRow('a\\\\\tb'), ['a\\\\', 'b']);
});

test('structured values support JSON objects, JSON arrays and PostgreSQL arrays', () => {
    assert.deepEqual(parseStructuredValue('["https://example.test/a"]'), ['https://example.test/a']);
    assert.deepEqual(parseStructuredValue('{"preview":"https://example.test/a"}'), { preview: 'https://example.test/a' });
    assert.deepEqual(parseStructuredValue('{https://example.test/a,https://example.test/b}'), ['https://example.test/a', 'https://example.test/b']);
    assert.deepEqual(parseStructuredValue('{"a,b","a\\"b",NULL,"NULL",{x,y}}'), ['a,b', 'a"b', null, 'NULL', ['x', 'y']]);
    assert.equal(parseStructuredValue('unstructured text'), 'unstructured text');
});

test('signed and transformed Supabase URLs identify the same object without exposing tokens', () => {
    const root = `https://${project}.supabase.co/storage/v1/`;
    const signed = describeUrl(`${root}object/sign/private/a%20b.png?token=SECRET`, project);
    const rendered = describeUrl(`${root}render/image/authenticated/private/a%20b.png?width=200`, project);
    assert.equal(signed.identity, rendered.identity);
    assert.equal(signed.expectedProject, true);
    assert.equal(signed.bucket, 'private');
    assert.equal(describeUrl(`${root}object/public/private/a.png`, 'xxxxxxxxxxxxxxxxxxxx').expectedProject, false);
    assert.equal(JSON.stringify(signed).includes('SECRET'), false);
});

test('known CDN hosts ignore query variants and remain distinguishable', () => {
    for (const host of ['cdn.fatherkey.com', 'cdn.zaoyoe.com']) {
        assert.equal(describeUrl(`https://${host}/a.png?v=1`).identity, describeUrl(`https://${host}/a.png?v=2`).identity);
    }
    assert.equal(describeUrl('https://cdn.zaoyoe.com/a.png').kind, 'cdn_host');
    assert.equal(describeUrl('https://cdn.fatherkey.com.evil.test/a.png').kind, 'other_http');
});

test('asset collector counts nested inline images and base64 without printing content', () => {
    const assets = [...collectAssets({ preview: 'data:image/png;base64,YWJjZA==', nested: [{ b64_json: 'YWJjZGVmZ2hpamts' }] })];
    assert.equal(assets.length, 2);
    assert.deepEqual(assets.map((asset) => asset.decodedBytes), [4, 12]);
    assert.equal(JSON.stringify(assets).includes('YWJj'), false);
});

test('inventory deduplicates resources across fields and keeps missing tables explicit', async () => {
    const report = await auditLines(section('public.prompts', ['id', 'images', 'image_assets'], [[
        'private-record-id', '{https://cdn.fatherkey.com/a.png,https://cdn.fatherkey.com/b.png}',
        JSON.stringify([{ preview: 'https://cdn.fatherkey.com/a.png?v=2' }])
    ]]), { expectedProjectRef: project });
    assert.equal(report.totals.references, 3);
    assert.equal(report.totals.uniqueAssets, 2);
    assert.equal(table(report, 'prompts').scanned, 1);
    assert.equal(table(report, 'prompts').status, 'partial');
    assert.equal(table(report, 'profiles').status, 'missing');
    assert.equal(report.copyTables[0].rows, 1);
    assert.equal(JSON.stringify(report).includes('private-record-id'), false);
    assert.equal(JSON.stringify(report).includes('/a.png'), false);
});

test('chat audit only considers image messages and marks absent type columns partial', async () => {
    const lines = section('public.chat_messages', ['message_type', 'content'], [
        ['text', 'https://example.test/private-message'], ['image', 'https://example.test/image']
    ]);
    const report = await auditLines(lines);
    assert.equal(table(report, 'chat_messages').scanned, 2);
    assert.equal(table(report, 'chat_messages').considered, 1);
    assert.equal(report.totals.references, 1);
    const missingType = await auditLines(section('public.chat_messages', ['content'], [['https://example.test/image']]));
    assert.equal(table(missingType, 'chat_messages').status, 'partial');
    assert.ok(table(missingType, 'chat_messages').missingFields.includes('message_type'));
});

test('Storage inventory uses metadata sizes and preserves missing size evidence', async () => {
    const report = await auditLines([
        ...section('storage.objects', ['bucket_id', 'name', 'metadata', 'is_delete_marker'], [
            ['private', 'secret/a.png', '{"size":100}', 'f'],
            ['private', 'secret/a.png', '{"size":"25"}', 't'],
            ['private', 'secret/b.png', '{}', 'f']
        ]),
        ...section('storage.buckets', ['id', 'public'], [['private', 'f']])
    ]);
    const bucket = report.storage.buckets[0];
    assert.equal(bucket.public, false);
    assert.equal(bucket.metadataRows, 3);
    assert.equal(bucket.uniqueNames, 2);
    assert.equal(bucket.metadataSizeBytesSum, 125);
    assert.equal(bucket.rowsMissingSize, 1);
    assert.equal(bucket.deleteMarkerRows, 1);
    assert.equal(JSON.stringify(report).includes('secret/a.png'), false);
});

test('path-only references are counted without inferring a host or visibility', async () => {
    const report = await auditLines(section('public.ai_image_results', ['storage_path'], [['private/task/image.png']]));
    assert.equal(table(report, 'ai_image_results').fields.storage_path.pathOnlyReferences, 1);
    assert.equal(report.locations.length, 0);
});

test('all-table ranking counts COPY text without decoding or disclosing business rows', async () => {
    const row = ['secret', '你好'].map(encode).join('\t');
    const report = await auditLines(section('public.orders', ['id', 'detail'], [['secret', '你好']]));
    assert.equal(report.copyTables[0].copyTextBytes, Buffer.byteLength(row) + 1);
    assert.equal(report.copyTables[0].rows, 1);
    assert.equal(JSON.stringify(report).includes('secret'), false);
});

test('escaped physical newlines and tabs remain one COPY row', async () => {
    const report = await auditLines([
        'COPY public.prompts (id, images) FROM stdin;',
        'a\\',
        'b\thttps://cdn.fatherkey.com/a.png',
        '\\.'
    ]);
    assert.equal(table(report, 'prompts').scanned, 1);
    assert.equal(report.totals.references, 1);
});

test('invalid and truncated COPY sections fail instead of becoming zero data', async () => {
    await assert.rejects(auditLines(['SELECT 1;']), /No COPY sections/);
    await assert.rejects(auditLines(['COPY public.prompts (id) FROM stdin;']), /Truncated/);
    await assert.rejects(auditLines(['COPY public.prompts (id, images) FROM stdin;', 'short', '\\.']), /row width/);
    await assert.rejects(auditLines(['COPY public.prompts (id) FROM stdin;', 'a\tb', '\\.']), /row width/);
    await assert.rejects(auditLines(['COPY public.prompts (id) FROM stdin WITH CSV;']), /Unsupported COPY/);
    await assert.rejects(auditLines(['INSERT INTO public.prompts VALUES (1);']), /INSERT statements/);
});

test('Storage sections lacking required columns fail instead of inventing sizes', async () => {
    await assert.rejects(auditLines(section('storage.objects', ['name'], [['a']])), /Missing required columns/);
});

test('gzip audit records source digest and rejects custom or corrupt backups', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'image-audit-fixture-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'fixture.backup.gz');
    const text = section('public.profiles', ['avatar_url'], [['https://cdn.fatherkey.com/a.png'], ['line\u2028separator\u2029before https://cdn.fatherkey.com/b.png']]).join('\n') + '\n';
    const compressed = zlib.gzipSync(text);
    await fs.writeFile(file, compressed);
    const report = await auditBackup(file);
    assert.equal(report.source.sha256, crypto.createHash('sha256').update(compressed).digest('hex'));
    assert.equal(report.source.compressedBytes, compressed.length);
    assert.equal(report.source.decodedBytes, Buffer.byteLength(text));
    assert.equal(report.totals.references, 2);
    assert.equal(table(report, 'profiles').scanned, 2);
    await fs.writeFile(file, zlib.gzipSync('PGDMPcustom-dump'));
    await assert.rejects(auditBackup(file), /Custom-format/);
    await fs.writeFile(file, Buffer.from('invalid gzip'));
    await assert.rejects(auditBackup(file));
});

test('CLI rejects writes, missing paths and malformed project references', () => {
    assert.throws(() => parseArgs(['--apply']), /Unknown audit option/);
    assert.throws(() => parseArgs([]), /--backup is required/);
    assert.throws(() => parseArgs(['--backup']), /Missing value/);
    assert.throws(() => parseArgs(['--backup', 'x', '--expected-project-ref', 'wrong']), /Invalid expected/);
    assert.equal(parseArgs(['--help']).help, true);
});
