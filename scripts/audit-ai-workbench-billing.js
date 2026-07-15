const path = require('node:path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

function parseArgs(argv = []) {
    const options = {
        envFile: 'server/.env',
        since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        failOnAnomaly: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--env-file' && argv[index + 1]) options.envFile = argv[++index];
        else if (argument === '--since' && argv[index + 1]) options.since = new Date(argv[++index]).toISOString();
        else if (argument === '--fail-on-anomaly') options.failOnAnomaly = true;
    }
    return options;
}

function isMissingRelationError(error = {}, relation = '') {
    const message = [error.message, error.details, error.hint].filter(Boolean).join(' ').toLowerCase();
    return String(error.code || '') === '42P01' || message.includes(String(relation || '').toLowerCase());
}

async function fetchAll(client, table, select, configure, pageSize = 1000) {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
        let query = client.from(table).select(select).range(from, from + pageSize - 1);
        query = configure(query);
        const { data, error } = await query;
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < pageSize) break;
    }
    return rows;
}

function roundPoints(value) {
    return Math.round((Number(value) || 0) * 1000000) / 1000000;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    dotenv.config({ path: path.resolve(process.cwd(), options.envFile) });
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service credentials');

    const client = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const tasks = await fetchAll(
        client,
        'ai_image_tasks',
        'id,mode,billing_mode,status,charged_points,total_tokens,metadata,created_at',
        (query) => query.gte('created_at', options.since).order('created_at', { ascending: true })
    );
    const taskIds = tasks.map((task) => task.id).filter(Boolean);
    const ledgerRows = [];
    for (let index = 0; index < taskIds.length; index += 100) {
        const taskIdChunk = taskIds.slice(index, index + 100);
        const { data, error } = await client
            .from('points_ledger')
            .select('reference_id,amount,reason,is_visible,created_at')
            .in('reference_id', taskIdChunk)
            .lt('amount', 0);
        if (error) throw error;
        ledgerRows.push(...(data || []));
    }

    let reservations = [];
    const reservationResult = await client
        .from('ai_workbench_point_reservations')
        .select('task_id,status,authorized_points,settled_points,released_points,updated_at')
        .gte('created_at', options.since)
        .limit(5000);
    if (reservationResult.error && !isMissingRelationError(reservationResult.error, 'ai_workbench_point_reservations')) {
        throw reservationResult.error;
    }
    if (!reservationResult.error) reservations = reservationResult.data || [];

    const visibleLedgerByTask = new Map();
    for (const ledger of ledgerRows) {
        if (ledger.is_visible === false) continue;
        const rows = visibleLedgerByTask.get(ledger.reference_id) || [];
        rows.push(ledger);
        visibleLedgerByTask.set(ledger.reference_id, rows);
    }

    const anomalies = {
        positive_charge_without_ledger: 0,
        charge_ledger_mismatch: 0,
        duplicate_visible_deductions: 0,
        terminal_failure_with_visible_deduction: 0,
        successful_chat_with_tokens_and_zero_charge: 0,
        stale_authorizing_tasks: 0,
        stale_authorized_reservations: 0
    };
    const modes = {};
    const staleCutoff = Date.now() - 15 * 60 * 1000;
    for (const task of tasks) {
        const mode = String(task.mode || 'unknown');
        const modeSummary = modes[mode] ||= { total: 0, succeeded: 0, failed: 0, charged: 0, charged_points: 0 };
        modeSummary.total += 1;
        if (task.status === 'succeeded') modeSummary.succeeded += 1;
        if (task.status === 'failed') modeSummary.failed += 1;
        const chargedPoints = roundPoints(task.charged_points);
        if (chargedPoints > 0) {
            modeSummary.charged += 1;
            modeSummary.charged_points = roundPoints(modeSummary.charged_points + chargedPoints);
        }
        const ledgers = visibleLedgerByTask.get(task.id) || [];
        const ledgerPoints = roundPoints(ledgers.reduce((sum, ledger) => sum + Math.abs(Number(ledger.amount) || 0), 0));
        if (chargedPoints > 0 && ledgers.length === 0) anomalies.positive_charge_without_ledger += 1;
        if (Math.abs(chargedPoints - ledgerPoints) > 0.000001) anomalies.charge_ledger_mismatch += 1;
        if (ledgers.length > 1) anomalies.duplicate_visible_deductions += 1;
        if (['failed', 'cancelled', 'refunded'].includes(task.status) && ledgerPoints > 0) {
            anomalies.terminal_failure_with_visible_deduction += 1;
        }
        if (task.mode === 'chat' && task.status === 'succeeded' && Number(task.total_tokens || 0) > 0 && chargedPoints === 0) {
            anomalies.successful_chat_with_tokens_and_zero_charge += 1;
        }
        if (task.status === 'authorizing' && Date.parse(task.created_at || '') < staleCutoff) {
            anomalies.stale_authorizing_tasks += 1;
        }
    }
    for (const reservation of reservations) {
        if (reservation.status === 'authorized' && Date.parse(reservation.updated_at || '') < staleCutoff) {
            anomalies.stale_authorized_reservations += 1;
        }
    }

    const anomalyCount = Object.values(anomalies).reduce((sum, value) => sum + value, 0);
    const report = {
        generated_at: new Date().toISOString(),
        since: options.since,
        task_count: tasks.length,
        ledger_count: ledgerRows.length,
        reservation_count: reservations.length,
        modes,
        anomalies,
        anomaly_count: anomalyCount
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (options.failOnAnomaly && anomalyCount > 0) process.exitCode = 1;
}

main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: error.message, code: error.code || '' })}\n`);
    process.exitCode = 1;
});
