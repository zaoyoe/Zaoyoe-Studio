'use strict';

// Source-only replay. This reads SQL constants and applies text substitutions;
// it never opens a database or executes SQL/PLpgSQL. It is deliberately limited
// to the installed-function patches used by these native checkout functions.
const fs = require('node:fs');
const path = require('node:path');
const names = new Set(['fn_purchase_shop_item_core', 'fn_guest_shop_create_order',
    'fn_guest_shop_confirm_payment', 'fn_guest_shop_claim_fulfillment',
    'fn_guest_shop_mark_fulfilled', 'fn_guest_shop_list_delivered_content',
    'shop_supplier_capture_funding_v2']);
function tokens(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
        if (/\s/.test(text[i])) { i++; continue; }
        if (text.startsWith('--', i)) { i = text.indexOf('\n', i); if (i < 0) break; continue; }
        if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); if (end < 0) throw Error('Unclosed comment'); i = end + 2; continue; }
        const start = i;
        const dollar = text.slice(i).match(/^\$(?:[A-Za-z_]\w*)?\$/)?.[0];
        if (dollar) {
            const end = text.indexOf(dollar, i + dollar.length);
            if (end < 0) throw Error('Unclosed dollar quote');
            out.push({ kind: 'str', value: text.slice(i + dollar.length, end), start, end: end + dollar.length });
            i = end + dollar.length; continue;
        }
        const escaped = /^[eE]'/.test(text.slice(i));
        if (escaped || text[i] === "'") {
            i += escaped ? 2 : 1;
            let value = '';
            while (i < text.length) {
                if (text[i] === "'") {
                    if (text[i + 1] === "'") { value += "'"; i += 2; continue; }
                    i++; break;
                }
                if (escaped && text[i] === '\\') {
                    const c = text[++i];
                    value += ({ n: '\n', r: '\r', t: '\t' })[c] ?? c; i++; continue;
                }
                value += text[i++];
            }
            out.push({ kind: 'str', value, start, end: i }); continue;
        }
        const word = text.slice(i).match(/^[\w.]+/)?.[0];
        const value = word || (text.startsWith('||', i) ? '||' : text[i]);
        i += value.length;
        out.push({ kind: 'word', value, start, end: i });
    }
    return out;
}
function argumentsAt(ts, open) {
    let depth = 0; const args = []; let start = open + 1;
    for (let i = open + 1; i < ts.length; i++) {
        if (ts[i].kind === 'str') continue;
        if (ts[i].value === '(') depth++;
        if (ts[i].value === ')') {
            if (depth-- === 0) { args.push(ts.slice(start, i)); return args; }
        }
        if (ts[i].value === ',' && depth === 0) { args.push(ts.slice(start, i)); start = i + 1; }
    }
    throw Error('Unclosed call');
}
function constant(ts, values = {}) {
    if (ts.length === 1 && Object.hasOwn(values, ts[0].value)) return values[ts[0].value];
    if (ts.length === 1 && /^\d+$/.test(ts[0].value)) return Number(ts[0].value);
    if (!ts.length || ts.some((t, i) => i % 2 === 0 ? t.kind !== 'str' : t.value !== '||')) {
        throw Error(`Unsupported source expression: ${ts.map(t => t.value).join(' ').slice(0, 80)}`);
    }
    return ts.filter(t => t.kind === 'str').map(t => t.value).join('');
}
function replay(root, { includeP2b = true } = {}) {
    const dir = path.join(root, 'supabase/migrations');
    const sources = {}; const evidence = [];
    const order = n => n.replace(/^(\d{8})(?=_)/, '$10000');
    for (const filename of fs.readdirSync(dir).filter(n => n.endsWith('.sql')).sort((a, b) => order(a).localeCompare(order(b)))) {
        if (filename.includes('verify_') || filename.startsWith('20261019_verify')) continue;
        if (!includeP2b && filename === '20261019_shop_supplier_platform_v2_native_checkout.sql') continue;
        const sql = fs.readFileSync(path.join(dir, filename), 'utf8');
        const top = tokens(sql);
        for (let t = 0; t < top.length; t++) {
            // AS-body on an actual function declaration. Arguments/default strings
            // are tokens, so semicolons and dollar quotes inside bodies are safe.
            if (top[t].kind !== 'str') continue;
            if (top[t - 1]?.value.toLowerCase() === 'as') {
                let start = t - 2;
                while (start > 0 && top[start].value !== ';') start--;
                const declarationStart = top[start].value === ';' ? top[start].end : top[start].start;
                const header = sql.slice(declarationStart, top[t].start);
                const name = header.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)/i)?.[1];
                if (names.has(name)) {
                    sources[name] = sql.slice(declarationStart, top[t].end).trim() + ';';
                    evidence.push({ filename, name, kind: 'definition' });
                }
                continue;
            }
            if (top[t - 1]?.value.toLowerCase() !== 'do') continue;
            const body = tokens(top[t].value); let current = null; const values = {};
            for (let j = 0; j < body.length; j++) {
                if (!/^v_/.test(body[j].value)) continue;
                let k = j + 1;
                if (body[k]?.value.toLowerCase() === 'text') k++;
                if (body[k]?.value !== ':' || body[k + 1]?.value !== '=') continue;
                let end = k + 2;
                while (end < body.length && body[end].value !== ';') end++;
                const expression = body.slice(k + 2, end);
                if (expression[0]?.kind === 'str' && expression.every((a, i) => i % 2 === 0 ? a.kind === 'str' : a.value === '||')) values[body[j].value] = constant(expression);
            }
            for (let i = 0; i < body.length - 1; i++) {
                const fn = body[i].value.toLowerCase();
                if (body[i].kind === 'str' || body[i + 1].value !== '(') continue;
                if (fn === 'pg_get_functiondef') {
                    const args = argumentsAt(body, i + 1);
                    const signature = args[0].find(a => a.kind === 'str')?.value;
                    current = signature?.match(/(?:public\.)?(\w+)\(/)?.[1] || null;
                    continue;
                }
                if (!current || !names.has(current)) continue;
                if (!['replace', 'pg_temp.shop_flash_sale_replace_once', 'pg_temp.shop_supplier_replace_v2'].includes(fn)) continue;
                const args = argumentsAt(body, i + 1);
                if (args[0].length !== 1 || !/^v_\w+$/.test(args[0][0].value)) continue;
                const old = constant(args[1], values); const replacement = constant(args[2], values);
                if (!sources[current]) continue; // Earlier patches superseded by a later complete definition.
                const count = sources[current].split(old).length - 1;
                const checked = fn !== 'replace';
                const label = checked ? constant(args[3]) : '';
                if (checked) {
                    const expected = args[4] ? constant(args[4]) : 1;
                    const ordinal = args[5] ? constant(args[5]) : 1;
                    if (count !== expected) throw Error(`${filename}: ${current}: ${label}: expected ${expected}, found ${count}`);
                    let pos = -old.length;
                    for (let n = 0; n < ordinal; n++) pos = sources[current].indexOf(old, pos + old.length);
                    sources[current] = sources[current].slice(0, pos) + replacement + sources[current].slice(pos + old.length);
                } else {
                    sources[current] = sources[current].split(old).join(replacement);
                }
                evidence.push({ filename, name: current, kind: 'patch', label, count });
            }
        }
    }
    return { sources, evidence };
}
module.exports = { replay, tokens, argumentsAt, constant };
