import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const storePath = new URL('../mysql-store.js', import.meta.url);

function harness(initialConfig = {}) {
    const configMap = new Map(Object.entries(initialConfig));
    const execute = vi.fn(async (sql, params) => {
        if (sql.includes('FROM app_config')) {
            const key = params[0];
            return configMap.has(key) ? [[{ config_value: configMap.get(key) }]] : [[]];
        }
        if (sql.includes('app_config') && (sql.includes('INSERT') || sql.includes('UPDATE'))) {
            const [key, val] = params;
            configMap.set(key, val);
            return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 1 }];
    });
    const createPool = vi.fn(() => ({ execute, query: execute }));
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(storePath, 'utf8'), {
        module, exports: module.exports, __dirname: path.dirname(storePath.pathname),
        process: { env: process.env }, Buffer, console,
        require: key => key === 'mysql2/promise' ? { createPool }
            : require(key.startsWith('.') ? new URL(`../${key}`, import.meta.url).pathname : key)
    });
    return { store: module.exports, execute, createPool, configMap };
}

describe('Record Video Config Toggle', () => {
    const originalEnv = process.env.RECORD_VIDEO;

    beforeEach(async () => {
        delete process.env.RECORD_VIDEO;
    });

    afterEach(async () => {
        if (originalEnv !== undefined) {
            process.env.RECORD_VIDEO = originalEnv;
        } else {
            delete process.env.RECORD_VIDEO;
        }
    });

    it('defaults to false when neither DB nor env specifies true', async () => {
        const { store } = harness();
        await store.setAppConfigValue('record_video_enabled', '');
        const enabled = await store.getRecordVideoEnabled();
        expect(enabled).toBe(false);
    });

    it('can be enabled and disabled via setRecordVideoEnabled', async () => {
        const { store } = harness();
        await store.setRecordVideoEnabled(true);
        expect(await store.getRecordVideoEnabled()).toBe(true);

        await store.setRecordVideoEnabled(false);
        expect(await store.getRecordVideoEnabled()).toBe(false);
    });

    it('honors environment variable fallback if DB config is empty', async () => {
        const { store } = harness();
        await store.setAppConfigValue('record_video_enabled', '');
        process.env.RECORD_VIDEO = '1';
        expect(await store.getRecordVideoEnabled()).toBe(true);

        process.env.RECORD_VIDEO = '0';
        expect(await store.getRecordVideoEnabled()).toBe(false);
    });
});
