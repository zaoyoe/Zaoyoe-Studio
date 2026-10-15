'use strict';

// Read-only decoder for the official page's unary RPC traffic. It never sends RPCs.
// Field descriptors were extracted from /plans public assets; see schema provenance.
const schema = require('./grok-commerce-schema.json');
const MAX_BYTES = 2 * 1024 * 1024;
// Keep scalar defaults for protobuf semantics, but retain wire presence so a
// vendor default can never turn an explicitly supplied invalid value into one.
const FIELD_PRESENCE = Symbol.for('kc.grokCommerce.rpcFieldPresence');
function hasRpcField(message, name) {
    return !!message && (message[FIELD_PRESENCE]
        ? message[FIELD_PRESENCE].has(name) : Object.hasOwn(message, name));
}
function varint(buffer, cursor) {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
        if (cursor.offset >= buffer.length) throw new Error('Truncated varint');
        const byte = buffer[cursor.offset++];
        value |= BigInt(byte & 127) << shift;
        if (!(byte & 128)) return value;
    }
    throw new Error('Invalid varint');
}
const enumValue = (field, value) => schema.enums[field.ref]?.[String(value)] ?? String(value);
function defaults(type) {
    const result = {};
    Object.defineProperty(result, FIELD_PRESENCE, { value: new Set() });
    for (const field of Object.values(schema.messages[type] || {})) {
        if (field.repeated) result[field.name] = [];
        else if (field.type === 9) result[field.name] = '';
        else if (field.type === 8) result[field.name] = false;
        else if (field.type === 14) result[field.name] = enumValue(field, 0);
        else if ([3, 4, 18].includes(field.type)) result[field.name] = '0';
        else if (field.type !== 11 && field.type !== 12) result[field.name] = 0;
    }
    return result;
}
function decodeMessage(type, buffer, depth = 0) {
    if (!schema.messages[type] || depth > 24) throw new Error('Unsupported RPC schema');
    const result = defaults(type), cursor = { offset: 0 };
    let fieldsRead = 0;
    while (cursor.offset < buffer.length) {
        if (++fieldsRead > 20000) throw new Error('Oversized RPC message');
        const key = Number(varint(buffer, cursor)), wire = key & 7, field = schema.messages[type][key >>> 3];
        if (!(key >>> 3)) throw new Error('Invalid protobuf tag');
        let raw;
        if (wire === 0) raw = varint(buffer, cursor);
        else if (wire === 1 || wire === 5 || wire === 2) {
            const length = wire === 2 ? Number(varint(buffer, cursor)) : wire === 1 ? 8 : 4;
            if (!Number.isSafeInteger(length) || length < 0 || cursor.offset + length > buffer.length) throw new Error('Truncated field');
            raw = buffer.subarray(cursor.offset, cursor.offset + length); cursor.offset += length;
        } else throw new Error('Unsupported protobuf wire type');
        if (!field) continue;
        result[FIELD_PRESENCE].add(field.name);
        let values;
        if (wire === 2 && field.repeated && field.type === 14) {
            const packed = { offset: 0 }; values = [];
            while (packed.offset < raw.length) values.push(enumValue(field, varint(raw, packed)));
        } else {
            let value;
            if (field.type === 11 && wire === 2) value = decodeMessage(field.ref, raw, depth + 1);
            else if (field.type === 9 && wire === 2) value = new TextDecoder('utf-8', { fatal: true }).decode(raw);
            else if (field.type === 12 && wire === 2) value = raw.toString('base64');
            else if (field.type === 8 && wire === 0) value = raw !== 0n;
            else if (field.type === 14 && wire === 0) value = enumValue(field, raw);
            else if ([3, 4].includes(field.type) && wire === 0) value = (field.type === 3 ? BigInt.asIntN(64, raw) : raw).toString();
            else if ([5, 13].includes(field.type) && wire === 0) value = Number(field.type === 5 ? BigInt.asIntN(32, raw) : raw);
            else if (field.type === 1 && wire === 1) value = raw.readDoubleLE();
            else if (field.type === 2 && wire === 5) value = raw.readFloatLE();
            else throw new Error('Protobuf field type mismatch');
            values = [value];
        }
        if (field.repeated) result[field.name].push(...values);
        else result[field.name] = values[0];
    }
    return result;
}
function normalizeJson(type, data, depth = 0) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || depth > 24) throw new Error('Invalid RPC JSON');
    const result = defaults(type);
    for (const field of Object.values(schema.messages[type] || {})) {
        if (!Object.hasOwn(data, field.name)) continue;
        result[FIELD_PRESENCE].add(field.name);
        const normalize = value => field.type === 11 ? (field.ref === '.google.protobuf.Timestamp' && typeof value === 'string'
            ? { seconds: String(Math.floor(Date.parse(value) / 1000)), nanos: 0 } : normalizeJson(field.ref, value, depth + 1))
            : field.type === 14 ? enumValue(field, value) : value;
        const value = data[field.name];
        if (field.repeated && !Array.isArray(value)) throw new Error('Invalid repeated field');
        result[field.name] = field.repeated ? value.map(normalize) : normalize(value);
    }
    return result;
}
function decodeRpc(method, direction, body, headers = {}) {
    const type = schema.methods[method]?.[direction];
    if (!type) throw new Error('Unsupported Commerce method');
    const buffer = Buffer.from(body || []);
    if (buffer.length > MAX_BYTES) throw new Error('Oversized Commerce response');
    const contentType = String(headers['content-type'] || '').toLowerCase();
    let payload = buffer;
    if (contentType.startsWith('application/grpc-web')) {
        if (contentType.includes('text')) throw new Error('Unsupported grpc-web text transport');
        let offset = 0, message = null, trailer = '';
        while (offset < buffer.length) {
            if (offset + 5 > buffer.length) throw new Error('Truncated grpc-web envelope');
            const flags = buffer[offset], length = buffer.readUInt32BE(offset + 1); offset += 5;
            if (offset + length > buffer.length) throw new Error('Truncated grpc-web payload');
            const data = buffer.subarray(offset, offset + length); offset += length;
            if (flags === 128 && !trailer) trailer = data.toString('utf8');
            else if (flags === 0 && !message) message = data;
            else throw new Error('Unsupported/compressed grpc-web envelope');
        }
        const statuses = [...trailer.matchAll(/(?:^|\r\n)grpc-status:\s*(\d+)\s*(?=\r\n|$)/gi)].map(match => match[1]);
        if (!message || direction === 'output' && (statuses.length > 1 || statuses.some(status => status !== '0')
            || headers['grpc-status'] != null && String(headers['grpc-status']) !== '0'
            || !statuses.length && headers['grpc-status'] !== '0')) throw new Error('Commerce RPC did not complete successfully');
        payload = message;
    } else if (!['application/json', 'application/proto'].some(type => contentType.startsWith(type))) {
        throw new Error('Unrecognized Commerce transport');
    }
    return contentType.includes('json') ? normalizeJson(type, JSON.parse(payload.toString('utf8'))) : decodeMessage(type, payload);
}
function commerceMethod(urlValue) {
    try {
        const url = new URL(urlValue), method = url.pathname.slice(1);
        return url.protocol === 'https:' && url.hostname === 'grok.com' && !url.port && !url.username && !url.password
            && Object.hasOwn(schema.methods, method) ? method : null;
    } catch (_) { return null; }
}
module.exports = { decodeRpc, commerceMethod, hasRpcField };
