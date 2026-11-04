#!/usr/bin/env node

// Reads a local COPY-format dump. It never executes SQL or makes network calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const zlib = require('node:zlib');
const { Transform, PassThrough } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const IMAGE_TABLES = {
    shop_products: ['icon_url', 'image_assets'],
    profiles: ['avatar_url'],
    prompts: ['images', 'image_assets', 'video_assets', 'author_avatar', 'source_author_avatar_url'],
    prompt_comments: ['image_url'],
    guestbook_messages: ['image_url'],
    chat_messages: ['content'],
    homepage_config: ['content'],
    ai_image_tasks: ['reference_image_url', 'reference_image_storage_path', 'metadata'],
    ai_image_results: ['image_url', 'original_image_url', 'storage_path', 'original_storage_path', 'metadata'],
    ai_image_download_events: ['image_url', 'original_image_url', 'storage_path', 'original_storage_path', 'metadata'],
    ai_image_api_usage: ['raw_usage']
};
const KNOWN_CDN_HOSTS = new Set(['cdn.fatherkey.com', 'cdn.zaoyoe.com']);
const RAW_BASE64_KEYS = new Set(['b64_json', 'b64Json', 'base64', 'image_base64', 'imageBase64']);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const add = (object, key, count = 1) => { object[key] = (object[key] || 0) + count; };
const byteLength = (value) => Buffer.byteLength(value || '', 'utf8');

function decodeCopyValue(value) {
    if (value === '\\N') return null;
    const pieces = [];
    const escapes = /\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|[\s\S])/g;
    const controls = { b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 };
    let start = 0;
    for (const match of value.matchAll(escapes)) {
        pieces.push(Buffer.from(value.slice(start, match.index)));
        const code = match[1];
        if (/^[0-7]+$/.test(code)) pieces.push(Buffer.from([parseInt(code, 8)]));
        else if (/^x[0-9a-fA-F]+$/.test(code)) pieces.push(Buffer.from([parseInt(code.slice(1), 16)]));
        else pieces.push(controls[code] === undefined ? Buffer.from(code) : Buffer.from([controls[code]]));
        start = match.index + match[0].length;
    }
    pieces.push(Buffer.from(value.slice(start)));
    return Buffer.concat(pieces).toString('utf8');
}

function parseCopyHeader(line) {
    const match = line.match(/^COPY "?([a-zA-Z_][a-zA-Z0-9_]*)"?\."?([a-zA-Z_][a-zA-Z0-9_]*)"? \(([^)]+)\) FROM stdin;\s*$/);
    if (!match) return null;
    const columns = match[3].split(',').map((item) => item.trim().replace(/^"|"$/g, ''));
    return { schema: match[1], table: match[2], columns };
}

function splitCopyRow(value) {
    const cells = [];
    let start = 0;
    for (let i = 0; i < value.length; i += 1) {
        if (value[i] === '\\') i += 1;
        else if (value[i] === '\t') {
            cells.push(value.slice(start, i));
            start = i + 1;
        }
    }
    cells.push(value.slice(start));
    return cells;
}

// pg_dump may use text[] as well as JSON arrays for image fields.
function parsePostgresArray(value) {
    let index = 0;
    const parse = () => {
        if (value[index++] !== '{') throw new Error('Invalid array');
        const items = [];
        if (value[index] === '}') { index += 1; return items; }
        while (index < value.length) {
            if (value[index] === '{') items.push(parse());
            else {
                let text = '';
                const quoted = value[index] === '"';
                if (quoted) index += 1;
                let closed = !quoted;
                while (index < value.length) {
                    const char = value[index++];
                    if (char === '\\') {
                        if (index >= value.length) throw new Error('Invalid array');
                        text += value[index++];
                    } else if (quoted && char === '"') { closed = true; break; }
                    else if (!quoted && (char === ',' || char === '}')) { index -= 1; break; }
                    else text += char;
                }
                if (!closed) throw new Error('Invalid array');
                items.push(!quoted && text === 'NULL' ? null : text);
            }
            const delimiter = value[index++];
            if (delimiter === '}') return items;
            if (delimiter !== ',') throw new Error('Invalid array');
        }
        throw new Error('Invalid array');
    };
    const result = parse();
    if (index !== value.length) throw new Error('Invalid array');
    return result;
}

function parseStructuredValue(value) {
    if (typeof value !== 'string') return value;
    if (/^\s*[\[{]/.test(value)) {
        try { return JSON.parse(value); } catch (_) { /* Try pg_dump text arrays next. */ }
        if (value.trim().startsWith('{')) {
            try { return parsePostgresArray(value.trim()); } catch (_) { /* Scan unstructured URL text. */ }
        }
    }
    return value;
}

function decodedBase64Bytes(value) {
    return Math.floor(value.replace(/=+$/, '').length * 3 / 4);
}

function* collectAssets(value, key = '') {
    if (typeof value === 'string') {
        const text = value.trim();
        if (RAW_BASE64_KEYS.has(key) && text.length >= 16 && /^[a-zA-Z0-9+/]+={0,2}$/.test(text)) {
            yield { kind: 'inline_base64', identity: hash(text), textBytes: byteLength(text), decodedBytes: decodedBase64Bytes(text) };
            return;
        }
        const pattern = /data:(?:image|video)\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+|https?:\/\/[^\s"'<>\\{}]+/gi;
        for (const match of text.matchAll(pattern)) {
            const url = match[0].replace(/[),.;]+$/, '');
            if (/^data:/i.test(url)) {
                yield { kind: 'inline_data', identity: hash(url), textBytes: byteLength(url), decodedBytes: decodedBase64Bytes(url.slice(url.indexOf(',') + 1)) };
            } else yield { url };
        }
    } else if (Array.isArray(value)) {
        for (const item of value) yield* collectAssets(item, key);
    } else if (value && typeof value === 'object') {
        for (const [childKey, item] of Object.entries(value)) yield* collectAssets(item, childKey);
    }
}

function describeUrl(value, expectedProjectRef = '') {
    let parsed;
    try { parsed = new URL(value); } catch (_) { return null; }
    const host = parsed.hostname.toLowerCase();
    const storage = host.endsWith('.supabase.co') && parsed.pathname.match(/^\/storage\/v1\/(?:object|render\/image)\/(public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (storage) {
        let bucket = storage[2];
        let object = storage[3];
        try { bucket = decodeURIComponent(bucket); object = decodeURIComponent(object); } catch (_) { /* Keep encoded identity. */ }
        return {
            kind: `supabase_${storage[1]}`,
            host,
            bucket,
            expectedProject: expectedProjectRef ? host === `${expectedProjectRef}.supabase.co` : null,
            identity: hash(`supabase:${host}:${bucket}:${object}`)
        };
    }
    const kind = host === 'cdn.fatherkey.com' ? 'r2_cdn' : KNOWN_CDN_HOSTS.has(host) ? 'cdn_host' : host.endsWith('.r2.dev') ? 'raw_r2_dev'
        : host.endsWith('.supabase.co') && parsed.pathname.startsWith('/storage/v1/') ? 'supabase_other_storage' : 'other_http';
    return { kind, host, identity: hash(`${host}${parsed.pathname}${KNOWN_CDN_HOSTS.has(host) || kind === 'raw_r2_dev' ? '' : parsed.search}`) };
}

function createTableResult(table, fields) {
    return { table, status: 'missing', scanned: 0, considered: 0, rowsWithAssets: 0, missingFields: [...fields], fields: {}, byKind: {}, references: 0, unique: new Set() };
}

async function auditLines(lines, { expectedProjectRef = '' } = {}) {
    const tables = Object.fromEntries(Object.entries(IMAGE_TABLES).map(([table, fields]) => [table, createTableResult(table, fields)]));
    const locations = new Map();
    const uniqueAssets = new Set();
    const storageBuckets = new Map();
    const storagePresence = { buckets: false, objects: false };
    const copyTables = new Map();
    const ensureBucket = (name) => {
        if (!storageBuckets.has(name)) storageBuckets.set(name, { bucket: name, public: null, metadataRows: 0, uniqueNames: new Set(), metadataSizeBytesSum: 0, rowsMissingSize: 0, archivedRows: 0, deleteMarkerRows: 0, versionedRows: 0 });
        return storageBuckets.get(name);
    };
    let active = null;
    let copySections = 0;
    for await (const rawLine of lines) {
        const line = String(rawLine).replace(/\r$/, '');
        if (!active) {
            if (/^INSERT INTO (?:"?public"?)\."?(?:shop_products|profiles|prompts|prompt_comments|guestbook_messages|chat_messages|homepage_config|ai_image_\w+)"?\b/.test(line)) {
                throw new Error('Audited table uses INSERT statements; a COPY-format dump is required');
            }
            if (!line.startsWith('COPY ')) continue;
            const header = parseCopyHeader(line);
            if (!header) throw new Error('Unsupported COPY header; default pg_dump text COPY format is required');
            const tableKey = `${header.schema}.${header.table}`;
            if (!copyTables.has(tableKey)) copyTables.set(tableKey, { schema: header.schema, table: header.table, rows: 0, copyTextBytes: 0 });
            active = {
                ...header,
                inventory: copyTables.get(tableKey),
                audited: Boolean(header && ((header.schema === 'public' && Object.hasOwn(tables, header.table)) || (header.schema === 'storage' && ['buckets', 'objects'].includes(header.table)))),
                rowBuffer: ''
            };
            copySections += 1;
            if (!active.audited) continue;
            if (header.schema === 'storage') {
                storagePresence[header.table] = true;
                const required = header.table === 'buckets' ? ['id', 'public'] : ['bucket_id', 'name', 'metadata'];
                if (required.some((field) => !header.columns.includes(field))) throw new Error(`Missing required columns in storage.${header.table}`);
            } else {
                const result = tables[header.table];
                result.missingFields = IMAGE_TABLES[header.table].filter((field) => !header.columns.includes(field));
                if (header.table === 'chat_messages' && !header.columns.includes('message_type')) result.missingFields.push('message_type');
                result.status = result.missingFields.length ? 'partial' : 'present';
            }
            continue;
        }
        if (line === '\\.' && !active.rowBuffer) { active = null; continue; }
        active.inventory.copyTextBytes += byteLength(line) + 1;
        active.rowBuffer += line;
        const trailingSlashes = active.rowBuffer.match(/\\+$/)?.[0].length || 0;
        if (trailingSlashes % 2) { active.rowBuffer += '\n'; continue; }
        const row = active.rowBuffer;
        active.rowBuffer = '';
        const cells = splitCopyRow(row);
        if (cells.length !== active.columns.length) throw new Error(`Invalid COPY row width in ${active.schema}.${active.table}`);
        active.inventory.rows += 1;
        if (!active.audited) continue;
        const get = (field) => {
            const index = active.columns.indexOf(field);
            return index < 0 ? null : decodeCopyValue(cells[index]);
        };
        if (active.schema === 'storage') {
            if (active.table === 'buckets') {
                const bucket = ensureBucket(get('id'));
                bucket.public = get('public') === 't';
            } else {
                const bucket = ensureBucket(get('bucket_id'));
                bucket.metadataRows += 1;
                bucket.uniqueNames.add(hash(get('name') || ''));
                const metadata = parseStructuredValue(get('metadata'));
                const size = metadata && typeof metadata === 'object' ? metadata.size : undefined;
                if (size !== undefined && size !== null && size !== '' && Number.isFinite(Number(size)) && Number(size) >= 0) bucket.metadataSizeBytesSum += Number(size);
                else bucket.rowsMissingSize += 1;
                if (get('archived_at')) bucket.archivedRows += 1;
                if (get('is_delete_marker') === 't') bucket.deleteMarkerRows += 1;
                if (get('is_versioned') === 't') bucket.versionedRows += 1;
            }
            continue;
        }
        const result = tables[active.table];
        result.scanned += 1;
        if (active.table === 'chat_messages' && get('message_type') !== 'image') continue;
        result.considered += 1;
        let rowHasAssets = false;
        for (const field of IMAGE_TABLES[active.table]) {
            if (!active.columns.includes(field)) continue;
            const value = get(field);
            const bytes = byteLength(value);
            const fieldResult = result.fields[field] ||= { textBytes: 0, largestValueBytes: 0, references: 0, inlineTextBytes: 0, estimatedInlineDecodedBytes: 0, pathOnlyReferences: 0, unique: new Set() };
            fieldResult.textBytes += bytes;
            fieldResult.largestValueBytes = Math.max(fieldResult.largestValueBytes, bytes);
            if (/storage_path$/.test(field) && value && !/^https?:\/\//i.test(value)) fieldResult.pathOnlyReferences += 1;
            for (const asset of collectAssets(parseStructuredValue(value))) {
                const description = asset.url ? describeUrl(asset.url, expectedProjectRef) : asset;
                if (!description) continue;
                const locationKey = JSON.stringify([description.kind, description.host || '', description.bucket || '']);
                if (!locations.has(locationKey)) locations.set(locationKey, { kind: description.kind, host: description.host || null, bucket: description.bucket || null, expectedProject: description.expectedProject ?? null, references: 0, unique: new Set(), inlineTextBytes: 0, estimatedInlineDecodedBytes: 0 });
                const location = locations.get(locationKey);
                location.references += 1;
                location.unique.add(description.identity);
                location.inlineTextBytes += asset.textBytes || 0;
                location.estimatedInlineDecodedBytes += asset.decodedBytes || 0;
                fieldResult.references += 1;
                fieldResult.unique.add(description.identity);
                fieldResult.inlineTextBytes += asset.textBytes || 0;
                fieldResult.estimatedInlineDecodedBytes += asset.decodedBytes || 0;
                result.references += 1;
                result.unique.add(description.identity);
                uniqueAssets.add(description.identity);
                add(result.byKind, description.kind);
                rowHasAssets = true;
            }
        }
        if (rowHasAssets) result.rowsWithAssets += 1;
    }
    if (active) throw new Error('Truncated backup: COPY section has no terminator');
    if (!copySections) throw new Error('No COPY sections found; a plain SQL COPY-format dump is required');
    const withCount = ({ unique, ...rest }) => ({ ...rest, uniqueAssets: unique.size });
    const tableResults = Object.values(tables).map((table) => ({ ...withCount(table), fields: Object.fromEntries(Object.entries(table.fields).map(([field, value]) => [field, withCount(value)])) }));
    return {
        expectedProjectRef: expectedProjectRef || null,
        copyTables: [...copyTables.values()].sort((a, b) => b.copyTextBytes - a.copyTextBytes),
        tables: tableResults,
        totals: { references: tableResults.reduce((sum, item) => sum + item.references, 0), uniqueAssets: uniqueAssets.size },
        locations: [...locations.values()].map(withCount).sort((a, b) => b.references - a.references),
        storage: { presence: storagePresence, buckets: [...storageBuckets.values()].map(({ uniqueNames, ...bucket }) => ({ ...bucket, uniqueNames: uniqueNames.size })).sort((a, b) => a.bucket.localeCompare(b.bucket)) },
        limitations: [
            'Snapshot inventory only; project ownership and current production state are not independently verified.',
            'Field bytes are decoded COPY text bytes; table copyTextBytes includes delimiters and LF-normalized line endings. Neither measures database disk usage, PostgREST response bytes or historical egress.',
            'Object sizes come from storage.objects metadata; file contents and R2 sizes are not in this dump.',
            'Unique Supabase objects ignore signatures, transforms and access route; reference counts include duplicate fields and tables.',
            'Path-only values are counted separately and do not establish a storage host or file visibility.',
            'Public URL routes and bucket flags do not establish authorization to publish private business data.'
        ]
    };
}

async function* copyLines(stream) {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    for await (const chunk of stream) {
        pending += decoder.write(chunk);
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
            yield pending.slice(0, newline);
            pending = pending.slice(newline + 1);
        }
    }
    pending += decoder.end();
    if (pending) yield pending;
}

async function auditBackup(backupPath, options = {}) {
    const input = fs.createReadStream(backupPath);
    const digest = crypto.createHash('sha256');
    let sourceBytes = 0;
    let decodedBytes = 0;
    const counter = new Transform({ transform(chunk, _, callback) { sourceBytes += chunk.length; digest.update(chunk); callback(null, chunk); } });
    let prefix = Buffer.alloc(0);
    let checked = false;
    const guard = new Transform({
        transform(chunk, _, callback) {
            decodedBytes += chunk.length;
            if (!checked) {
                prefix = Buffer.concat([prefix, chunk]);
                if (prefix.length < 5) return callback();
                checked = true;
                if (prefix.subarray(0, 5).toString() === 'PGDMP') return callback(new Error('Custom-format PostgreSQL dumps are unsupported; use a plain SQL COPY-format backup'));
                chunk = prefix;
                prefix = null;
            }
            callback(null, chunk);
        },
        flush(callback) { if (!checked && prefix.length) this.push(prefix); callback(); }
    });
    const output = new PassThrough();
    const streams = [input, counter];
    if (String(backupPath).endsWith('.gz')) streams.push(zlib.createGunzip());
    streams.push(guard, output);
    let streamError;
    const pumping = pipeline(...streams).catch((error) => { streamError = error; });
    // readline also splits Unicode U+2028/U+2029 inside field values. COPY records use LF.
    const lines = copyLines(output);
    try {
        const summary = await auditLines(lines, options);
        await pumping;
        if (streamError) throw streamError;
        return { source: { file: path.basename(backupPath), sha256: digest.digest('hex'), compressedBytes: sourceBytes, decodedBytes }, ...summary };
    } finally {
        output.destroy();
        await pumping;
    }
}

function parseArgs(argv) {
    const args = { backup: '', expectedProjectRef: '', json: false, help: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--json') args.json = true;
        else if (arg === '--help') args.help = true;
        else if (arg === '--backup' || arg === '--expected-project-ref') {
            const value = argv[++i];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
            args[arg === '--backup' ? 'backup' : 'expectedProjectRef'] = value;
        } else throw new Error('Unknown audit option; use --help');
    }
    if (!args.help && !args.backup) throw new Error('--backup is required');
    if (args.expectedProjectRef && !/^[a-z0-9]{20}$/.test(args.expectedProjectRef)) throw new Error('Invalid expected Supabase project reference');
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log('Usage: node scripts/audit-image-backup.js --backup /absolute/path/backup.gz [--expected-project-ref PROJECT_REF] [--json]');
        return;
    }
    const result = await auditBackup(path.resolve(args.backup), args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
        console.log(`Offline image inventory: ${result.source.file}`);
        for (const table of result.copyTables.slice(0, 10)) console.log(`COPY ${table.schema}.${table.table}: rows=${table.rows}, textBytes=${table.copyTextBytes}`);
        for (const table of result.tables) console.log(`${table.table}: ${table.status}, rows=${table.scanned}, references=${table.references}, unique=${table.uniqueAssets}`);
        for (const location of result.locations) console.log(`${location.kind} ${location.host || ''} ${location.bucket || ''}: references=${location.references}, unique=${location.uniqueAssets}, inlineTextBytes=${location.inlineTextBytes}`);
        for (const bucket of result.storage.buckets) console.log(`Storage ${bucket.bucket}: public=${bucket.public}, rows=${bucket.metadataRows}, metadataSizeBytesSum=${bucket.metadataSizeBytesSum}`);
        console.log('Snapshot only. No SQL execution, network requests or file-content migration. Use --json for field sizes and limitations.');
    }
}

if (require.main === module) main().catch((error) => {
    // Parser errors deliberately omit row values and URLs.
    const safeMessage = error.code ? `I/O error (${error.code})` : error.message;
    console.error(`Offline image audit failed: ${safeMessage}`);
    process.exitCode = 1;
});

module.exports = { IMAGE_TABLES, decodeCopyValue, parseCopyHeader, splitCopyRow, parseStructuredValue, collectAssets, describeUrl, auditLines, auditBackup, parseArgs };
