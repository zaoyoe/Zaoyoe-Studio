#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.local');
const SERVER_ENV_PATH = path.join(ROOT_DIR, 'server/.env');
const REALTIME_DEGRADED_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

function readEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    return dotenv.parse(fs.readFileSync(filePath, 'utf8'));
}

function readFirstEnv(sources, names) {
    for (const source of sources) {
        for (const name of names) {
            const value = String(source?.[name] || '').trim();
            if (value) return value;
        }
    }
    return '';
}

function requireEnv(sources, label, names = []) {
    const value = readFirstEnv(sources, names);
    if (!value) {
        throw new Error(`Missing ${label}: ${names.join(' / ')}`);
    }
    return value;
}

function parseArgs(argv = []) {
    const args = {
        apply: false,
        timeoutMs: 8000
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--apply') {
            args.apply = true;
            continue;
        }
        if (value === '--timeout-ms') {
            const timeoutMs = Number.parseInt(argv[index + 1], 10);
            if (Number.isFinite(timeoutMs) && timeoutMs >= 1000) {
                args.timeoutMs = timeoutMs;
            }
            index += 1;
        }
    }

    return args;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeoutMs, label) {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function fetchFirstRow(supabase, table, select) {
    const { data, error } = await supabase
        .from(table)
        .select(select)
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(`${table}: ${error.message}`);
    }

    return data || null;
}

function matchesExpectedRow(payload, expected = {}) {
    const row = payload?.new || payload?.record || {};
    return Object.entries(expected).every(([key, value]) => String(row?.[key] ?? '') === String(value ?? ''));
}

async function subscribeAndTrigger({ supabase, label, table, filter, expected, timeoutMs, trigger }) {
    const statusEvents = [];
    const channelName = `codex-realtime-smoke-${table}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let eventResolver = null;
    let eventRejecter = null;
    const eventPromise = new Promise((resolve, reject) => {
        eventResolver = resolve;
        eventRejecter = reject;
    });

    const channel = supabase
        .channel(channelName)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table,
            ...(filter ? { filter } : {})
        }, (payload) => {
            if (!expected || matchesExpectedRow(payload, expected)) {
                eventResolver(payload);
            }
        });

    const subscribed = await withTimeout(
        new Promise((resolve, reject) => {
            channel.subscribe((status, error) => {
                statusEvents.push(status);
                if (status === 'SUBSCRIBED') {
                    resolve(true);
                    return;
                }
                if (REALTIME_DEGRADED_STATUSES.has(status)) {
                    reject(new Error(`${label} realtime degraded: ${status}${error?.message ? ` (${error.message})` : ''}`));
                }
            });
        }),
        timeoutMs,
        `${label} subscribe`
    );

    if (!subscribed) {
        throw new Error(`${label} realtime did not subscribe`);
    }

    await trigger();

    const payload = await withTimeout(
        eventPromise,
        timeoutMs,
        `${label} event`
    ).catch((error) => {
        eventRejecter?.(error);
        throw error;
    });

    await supabase.removeChannel(channel);
    await delay(100);

    return {
        ok: true,
        label,
        table,
        filter,
        statusEvents,
        event: payload?.eventType || payload?.type || 'UPDATE'
    };
}

function applySiteFilter(query, site) {
    const normalizedSite = String(site ?? '').trim();
    if (!normalizedSite) {
        return query;
    }
    return query.eq('site', normalizedSite);
}

async function runPointsBalanceSmoke(supabase, args) {
    const row = await fetchFirstRow(supabase, 'points_balance', 'user_id, site, paid_balance, bonus_balance');
    if (!row?.user_id) {
        return { ok: false, label: 'points_balance', skipped: true, reason: 'no rows' };
    }

    if (!args.apply) {
        return { ok: true, label: 'points_balance', dryRun: true, userId: row.user_id, site: row.site || '' };
    }

    const trigger = async () => {
        const { error } = await applySiteFilter(
            supabase
                .from('points_balance')
                .update({ paid_balance: row.paid_balance })
                .eq('user_id', row.user_id),
            row.site
        );
        if (error) {
            throw new Error(`points_balance no-op update failed: ${error.message}`);
        }
    };

    return subscribeAndTrigger({
        supabase,
        label: 'points_balance',
        table: 'points_balance',
        filter: `user_id=eq.${row.user_id}`,
        expected: { user_id: row.user_id },
        timeoutMs: args.timeoutMs,
        trigger
    });
}

async function runOrderSmoke(supabase, args, table) {
    const row = await fetchFirstRow(supabase, table, 'id, user_id, site, status, created_at');
    if (!row?.id) {
        return { ok: false, label: table, skipped: true, reason: 'no rows' };
    }

    if (!args.apply) {
        return { ok: true, label: table, dryRun: true, id: row.id, userId: row.user_id || '', site: row.site || '' };
    }

    const trigger = async () => {
        const { error } = await supabase
            .from(table)
            .update({ status: row.status })
            .eq('id', row.id);
        if (error) {
            throw new Error(`${table} no-op update failed: ${error.message}`);
        }
    };

    return subscribeAndTrigger({
        supabase,
        label: table,
        table,
        filter: `id=eq.${row.id}`,
        expected: { id: row.id },
        timeoutMs: args.timeoutMs,
        trigger
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const envSources = [
        process.env,
        readEnvFile(LOCAL_ENV_PATH),
        readEnvFile(SERVER_ENV_PATH)
    ];
    const supabaseUrl = requireEnv(envSources, 'Supabase URL', [
        'SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_URL',
        'PUBLIC_SUPABASE_URL'
    ]);
    const serviceRoleKey = requireEnv(envSources, 'Supabase service role key', [
        'SUPABASE_SERVICE_ROLE_KEY',
        'SUPABASE_SERVICE_KEY'
    ]);
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });

    console.log(`${args.apply ? 'Apply' : 'Dry run'} realtime production smoke`);
    console.log(`- timeout: ${args.timeoutMs}ms`);

    const results = [];
    results.push(await runPointsBalanceSmoke(supabase, args));
    results.push(await runOrderSmoke(supabase, args, 'payment_orders'));
    results.push(await runOrderSmoke(supabase, args, 'shop_orders'));

    for (const result of results) {
        if (result.skipped) {
            console.log(`- ${result.label}: skipped (${result.reason})`);
        } else if (result.dryRun) {
            console.log(`- ${result.label}: ready (${JSON.stringify(result)})`);
        } else {
            console.log(`- ${result.label}: realtime event received (${result.event})`);
        }
    }

    const failures = results.filter((item) => item.ok === false && !item.skipped);
    if (failures.length) {
        process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error(`Realtime production smoke failed: ${error.message}`);
    process.exit(1);
});
