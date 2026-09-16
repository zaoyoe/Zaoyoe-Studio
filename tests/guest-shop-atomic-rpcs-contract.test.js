const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ATOMIC_RPC_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260913_guest_shop_atomic_rpcs.sql'
);

const ATOMIC_PREFLIGHT_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260913_verify_guest_shop_atomic_rpcs_preflight.sql'
);

const ATOMIC_POSTFLIGHT_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260913_verify_guest_shop_atomic_rpcs.sql'
);

function readAtomicRpcSql() {
    return fs.readFileSync(ATOMIC_RPC_PATH, 'utf8');
}

function readVerifierSql(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function functionBlock(sql, name) {
    const start = sql.search(new RegExp(
        `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`,
        'i'
    ));
    assert.notEqual(start, -1, `missing ${name} definition`);

    // A function ends at the first dollar-quoted terminator followed by a
    // semicolon.  This is deliberately a small static parser: the migration
    // is checked as text and is never sent to a database by this test.
    const end = sql.indexOf('$$;', start);
    assert.notEqual(end, -1, `${name} should have a dollar-quoted body`);
    return sql.slice(start, end + 3);
}

const RPC_NAMES = [
    'fn_guest_shop_create_order',
    'fn_guest_shop_confirm_payment',
    'fn_guest_shop_claim_fulfillment',
    'fn_guest_shop_consume_reservation',
    'fn_guest_shop_mark_fulfilled',
    'fn_guest_shop_record_refund_result',
    'fn_guest_shop_release_reservation',
    'fn_guest_shop_release_expired_reservations'
];

test('guest order RPC never accepts a client amount and computes an immutable server price', () => {
    const sql = readAtomicRpcSql();
    const create = functionBlock(sql, 'fn_guest_shop_create_order');

    // Keep the pre-hardening overload from being retained by PostgreSQL.  The
    // old signature contained NUMERIC (a client amount) between the SKU and
    // provider arguments; accepting it would re-open a zero-price path.
    assert.match(sql, /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.fn_guest_shop_create_order\s*\([\s\S]*?NUMERIC[\s\S]*?\)\s*;/i);
    assert.doesNotMatch(create, /p_(?:unit_)?amount\s+NUMERIC|p_price\s+NUMERIC|p_total_amount\s+NUMERIC/i);
    assert.match(create, /v_unit_amount\s+NUMERIC/i);
    assert.match(create, /guest_cash_price_(?:cny|intl)/i);
    assert.match(create, /INSERT\s+INTO\s+public\.guest_shop_orders[\s\S]*?\bunit_amount\b[\s\S]*?v_unit_amount/i);
    assert.match(create, /INSERT\s+INTO\s+public\.guest_shop_payment_orders[\s\S]*?\bexpected_amount\b[\s\S]*?v_unit_amount/i);
    assert.doesNotMatch(create, /(?:p_amount|p_price|p_total_amount)\s*(?:,|\))/i);
});

test('guest atomic migration has no dangerous destructive SQL or legacy payment path', () => {
    const sql = readAtomicRpcSql();

    assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+FUNCTION\b[^;]*\bCASCADE\b/i);
    assert.doesNotMatch(sql, /fn_purchase_shop_item|payment_checkout_sessions|rechargePointsForPayment/i);
    assert.match(sql, /guest_shop_payment_orders_purpose_check|purpose\s*=\s*'shop_direct'/i);
});

test('every SECURITY DEFINER guest function fixes the search path', () => {
    const sql = readAtomicRpcSql();
    const definitions = [...sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\([\s\S]*?\$\$;/gi)];
    const guestDefinitions = definitions.filter((match) =>
        (match[1].startsWith('guest_shop_') || match[1].startsWith('fn_guest_shop_'))
        && /SECURITY\s+DEFINER/i.test(match[0])
    );
    assert.ok(guestDefinitions.length >= RPC_NAMES.length, 'expected all guest helper/RPC definitions');
    for (const match of guestDefinitions) {
        const block = match[0];
        assert.match(
            block,
            /SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*public\s*,\s*pg_temp/i,
            `${match[1]} must pin search_path`
        );
    }
});

test('guest RPC execute privileges are explicitly service-role-only', () => {
    const sql = readAtomicRpcSql();
    for (const name of RPC_NAMES) {
        const revoke = new RegExp(
            `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${name}\\s*\\([^;]*\\)\\s+FROM\\s+[^;]*(?:PUBLIC|anon|authenticated)`,
            'i'
        );
        const grant = new RegExp(
            `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}\\s*\\([^;]*\\)\\s+TO\\s+service_role`,
            'i'
        );
        assert.match(sql, revoke, `${name} must revoke public/client execute access`);
        assert.match(sql, grant, `${name} must grant execute only to service_role`);
    }
});

test('order and reservation use the site-scoped source-SKU chain', () => {
    const sql = readAtomicRpcSql();
    const create = functionBlock(sql, 'fn_guest_shop_create_order');
    const reservation = functionBlock(sql, 'guest_shop_validate_inventory_reservation');

    assert.match(create, /fn_resolve_shop_sku_inventory_sources\s*\(\s*v_sku\.id\s*,\s*v_site\s*\)/i);
    assert.match(create, /source_sku_id/i);
    assert.match(create, /source_is_default/i);
    assert.match(create, /FOR\s+UPDATE\s+SKIP\s+LOCKED/i);
    assert.match(create, /i\.sku_id\s*=\s*src\.source_sku_id/i);
    assert.match(create, /src\.source_is_default\s+AND\s+i\.sku_id\s+IS\s+NULL/i);

    assert.match(reservation, /fn_resolve_shop_sku_inventory_sources\s*\(\s*v_order\.sku_id\s*,\s*v_order\.site\s*\)/i);
    assert.match(reservation, /source_sku_id/i);
    assert.match(reservation, /source_is_default/i);
});

test('guest order source configuration fails closed and snapshots default inventory source', () => {
    const sql = readAtomicRpcSql();
    const create = functionBlock(sql, 'fn_guest_shop_create_order');
    const reservation = functionBlock(sql, 'guest_shop_validate_inventory_reservation');

    // A NULL in the persisted source array is malformed configuration, not an
    // absent source that may be quietly filtered out before reservation.
    assert.match(create, /v_raw_source_ids\s+UUID\[\]/i);
    assert.match(create, /array_position\(v_raw_source_ids,\s*NULL\)\s+IS\s+NOT\s+NULL/i);
    assert.match(create, /unnest\(v_raw_source_ids\)\s+WITH\s+ORDINALITY/i);
    assert.match(create, /source_sku\.id\s+IS\s+NULL/i);
    assert.match(create, /source_sku\.product_id\s+IS\s+DISTINCT\s+FROM\s+v_product\.id/i);
    assert.match(create, /source_sku\.is_active[\s\S]*?IS\s+NOT\s+TRUE/i);
    assert.match(create, /source_sku\.manual_delivery/i);
    assert.match(create, /array_length\(v_source_ids,\s*1\)[\s\S]*?array_length\(v_configured_source_ids,\s*1\)/i);
    assert.match(create, /unnest\(v_configured_source_ids\)[\s\S]*?NOT\s+EXISTS[\s\S]*?unnest\(v_source_ids\)/i);
    assert.match(create, /unnest\(v_source_ids\)[\s\S]*?NOT\s+EXISTS[\s\S]*?unnest\(v_configured_source_ids\)/i);
    assert.match(create, /v_source_ids\s+IS\s+DISTINCT\s+FROM\s+v_configured_source_ids/i);
    assert.match(create, /SELECT\s+i\.id,\s*src\.source_sku_id\s+AS\s+matched_source_sku_id/i);
    assert.match(create, /RETURNING\s+i\.id,\s*candidate\.matched_source_sku_id\s+INTO\s+v_inventory_id,\s*v_inventory_source_sku_id/i);
    assert.doesNotMatch(
        create,
        /SELECT\s+src\.source_sku_id[\s\S]*?INTO\s+v_inventory_source_sku_id[\s\S]*?WHERE\s+i\.id\s*=\s*v_inventory_id/i,
        'source snapshot must not be re-resolved after the inventory row was updated'
    );
    assert.match(create, /guest_inventory_source_snapshot_failed/i);
    assert.match(reservation, /inventory_source_sku_id\s+IS\s+NULL[\s\S]*?source SKU snapshot is required/i);
    assert.match(sql, /guest_shop_inventory_reservations_source_sku_fk/i);
    assert.match(sql, /REFERENCES\s+public\.shop_product_skus\(id\)[\s\S]*?ON DELETE RESTRICT/i);
    assert.match(sql, /guest_shop_inventory_reservations_source_sku_product_fk/i);
    assert.match(sql, /REFERENCES\s+public\.shop_product_skus\(product_id,\s*id\)[\s\S]*?ON DELETE RESTRICT/i);
    assert.match(sql, /ALTER\s+COLUMN\s+inventory_source_sku_id\s+SET\s+NOT\s+NULL/i);
});

test('reservation source snapshot stays valid across status-only transitions', () => {
    const sql = readAtomicRpcSql();
    const reservation = functionBlock(sql, 'guest_shop_validate_inventory_reservation');

    assert.match(reservation, /IF\s+TG_OP\s*=\s*'INSERT'[\s\S]*?v_identity_changed\s*:=\s*true/i);
    assert.match(reservation, /v_identity_changed\s*:=\s*NEW\.order_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.order_id/i);
    assert.match(reservation, /IF\s+v_identity_changed\s+THEN[\s\S]*?fn_resolve_shop_sku_inventory_sources/i);
    assert.match(reservation, /ELSE[\s\S]*?Do not consult the live source resolver on a status-only update/i);
    assert.match(reservation, /guest reservation inventory source binding changed/i);
});

test('guest cash money and payment identifiers reject non-finite or malformed values', () => {
    const sql = readAtomicRpcSql();
    const create = functionBlock(sql, 'fn_guest_shop_create_order');
    const confirm = functionBlock(sql, 'fn_guest_shop_confirm_payment');

    assert.match(sql, /LOWER\([^)]*::TEXT\)\s+NOT\s+IN\s*\(\s*'nan'\s*,\s*'infinity'\s*,\s*'-infinity'/i);
    assert.match(create, /v_provider\s*!~\s*'\^\[a-z0-9\]/i);
    assert.match(create, /v_channel\s*!~\s*'\^\[a-z0-9\]/i);
    assert.match(create, /v_fingerprint\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/i);
    assert.match(confirm, /v_provider_order_no\s*~\s*'\[\[:cntrl:\]\[:space:\]\]+'/i);
    assert.match(confirm, /p_observed_amount\s*>\s*999999999999\.99/i);
    assert.match(sql, /guest_shop_orders_amount_check[\s\S]*?unit_amount\s*=\s*ROUND\(unit_amount,\s*2\)/i);
    assert.match(sql, /guest_shop_payment_orders_expected_amount_check[\s\S]*?expected_amount\s*<=\s*999999999999\.99/i);
    assert.match(sql, /guest_shop_payment_events_observed_amount_check[\s\S]*?observed_amount\s*=\s*ROUND\(observed_amount,\s*2\)/i);
    assert.match(sql, /guest_shop_orders_request_fingerprint_check[\s\S]*?\^\[0-9a-f\]\{64\}\$/i);
    assert.match(sql, /guest_shop_orders_claim_secret_hash_format_check[\s\S]*?hmac-sha256:v1/i);
});

test('database order RPC treats payment channels as a strict fail-closed allowlist', () => {
    const sql = readAtomicRpcSql();
    const create = functionBlock(sql, 'fn_guest_shop_create_order');

    assert.match(create, /jsonb_typeof\(v_allowed_channels\)\s*<>\s*'array'/i);
    assert.match(create, /jsonb_array_length\(v_allowed_channels\)\s*=\s*0/i);
    assert.match(create, /guest_payment_channel_allowlist_empty/i);
    assert.match(create, /jsonb_array_elements\(v_allowed_channels\)/i);
    assert.match(create, /jsonb_typeof\(allowed\.value\)\s*<>\s*'string'/i);
    assert.match(create, /guest_payment_channel_allowlist_invalid/i);
    assert.match(create, /\^\[a-z0-9\]\[a-z0-9\._:-\]\{0,159\}\$/i);
    assert.match(create, /IN\s*\(\s*'mock'\s*,\s*'test'\s*,\s*'fake'\s*\)/i);
    assert.match(create, /v_provider\s*\|\|\s*':'\s*\|\|\s*v_channel/i);
    assert.match(create, /guest_payment_channel_unavailable/i);
});

test('P0 guest channel is KEY-only, automatic, quantity-one, and excludes shared inventory', () => {
    const sql = readAtomicRpcSql();
    const create = functionBlock(sql, 'fn_guest_shop_create_order');
    const reservation = functionBlock(sql, 'guest_shop_validate_inventory_reservation');
    const claim = functionBlock(sql, 'fn_guest_shop_claim_fulfillment');

    assert.match(create, /v_delivery_type\s*<>\s*'KEY'/i);
    assert.match(create, /manual_delivery/i);
    assert.match(create, /quantity\s*[,)]|\b1\s*,\s*v_unit_amount/i);
    assert.match(create, /COALESCE\s*\(\s*i\.is_shared\s*,\s*false\s*\)\s*=\s*false/i);
    assert.match(reservation, /v_inventory\.is_shared|COALESCE\s*\(\s*v_inventory\.is_shared/i);
    assert.match(claim, /is_shared/i);
    assert.match(claim, /guest_payment_not_fulfillable|refund_status\s+IN/i);
});

test('payment confirmation is tied to one verified event and never silently fulfills after expiry', () => {
    const sql = readAtomicRpcSql();
    const confirm = functionBlock(sql, 'fn_guest_shop_confirm_payment');

    assert.match(confirm, /p_event_id\s+UUID/i);
    assert.match(confirm, /p_event_id\s+IS\s+NULL|guest_payment_event_required/i);
    assert.match(confirm, /processing_status\s*=\s*'verified'|processing_status\s*(?:NOT\s+IN|IN)\s*\([^)]*'verified'|processing_status[^\n]*verified|v_event\.processing_status[^\n]*verified/i);
    assert.match(confirm, /signature_verified\s+IS\s+(?:NOT\s+)?TRUE/i);
    assert.match(confirm, /amount_verified\s+IS\s+(?:NOT\s+)?TRUE/i);
    assert.match(confirm, /currency_verified\s+IS\s+(?:NOT\s+)?TRUE/i);
    assert.match(confirm, /final_status_verified\s+IS\s+(?:NOT\s+)?TRUE/i);
    assert.match(confirm, /paid_unfulfillable/i);
    assert.match(confirm, /payment_confirmed_after_expiry|reservation_expired/i);
});

test('payment, fulfillment, and refund transitions have monotonic terminal guards', () => {
    const sql = readAtomicRpcSql();
    const confirm = functionBlock(sql, 'fn_guest_shop_confirm_payment');
    const claim = functionBlock(sql, 'fn_guest_shop_claim_fulfillment');
    const mark = functionBlock(sql, 'fn_guest_shop_mark_fulfilled');
    const refund = functionBlock(sql, 'fn_guest_shop_record_refund_result');

    assert.match(confirm, /status\s+IN\s*\(\s*'refunded'\s*,\s*'chargeback'\s*\)|status\s*=\s*'refunded'/i);
    assert.match(confirm, /status\s*=\s*'confirmed'/i);
    assert.match(claim, /payment_status\s*<>\s*'confirmed'|payment_status\s+IN\s*\([^)]*'refunded'/i);
    assert.match(claim, /refund_status\s+IN\s*\([^)]*'succeeded'[^)]*'manual_review'|refund_status\s+IN\s*\([^)]*'manual_review'[^)]*'succeeded'/i);
    assert.match(mark, /payment_status\s*<>\s*'confirmed'|guest_payment_not_confirmed/i);
    assert.match(mark, /refund_status\s+IN\s*\([^)]*'succeeded'[^)]*'manual_review'|refund_status\s+IN\s*\([^)]*'manual_review'[^)]*'succeeded'/i);

    // Refund success is terminal and must be idempotent; failed/pending/review
    // may not overwrite an already successful or chargeback outcome.
    assert.match(refund, /refund_status\s*=\s*'succeeded'|status\s*=\s*'refunded'/i);
    assert.match(refund, /already_refunded|refund.*(?:terminal|monotonic|idempotent)|refund_status\s+IN\s*\([^)]*'succeeded'/i);
    assert.match(refund, /provider_ref.*required|p_provider_ref\s+IS\s+NULL|guest_refund_provider_ref_required/i);
});

test('expiry release uses a safe lock strategy and preserves paid_unfulfillable visibility', () => {
    const sql = readAtomicRpcSql();
    const sweep = functionBlock(sql, 'fn_guest_shop_release_expired_reservations');
    const release = functionBlock(sql, 'fn_guest_shop_release_reservation');

    assert.match(sweep, /FOR\s+UPDATE(?:\s+OF\s+[a-z_][a-z0-9_]*)?\s+SKIP\s+LOCKED/i);
    assert.match(sweep, /status\s*=\s*'held'/i);
    assert.match(sweep, /reserved_until\s*<=/i);
    assert.match(release, /order[\s\S]*reservation[\s\S]*inventory|order\s*->\s*reservation\s*->\s*inventory/i);
    assert.match(release, /paid_unfulfillable/i);
});

test('claim and mark fulfillment keep explicit paid/unrefunded gates', () => {
    const sql = readAtomicRpcSql();
    const claim = functionBlock(sql, 'fn_guest_shop_claim_fulfillment');
    const mark = functionBlock(sql, 'fn_guest_shop_mark_fulfilled');

    assert.match(claim, /payment_status\s*<>\s*'confirmed'/i);
    assert.match(claim, /refund_status\s+IN\s*\([^)]*'succeeded'[^)]*'manual_review'|refund_status\s+IN\s*\([^)]*'manual_review'[^)]*'succeeded'/i);
    assert.match(claim, /status\s*=\s*'held'|status\s*=\s*'consumed'/i);
    assert.match(mark, /payment_status\s*<>\s*'confirmed'/i);
    assert.match(mark, /refund_status\s+IN\s*\([^)]*'succeeded'[^)]*'manual_review'|refund_status\s+IN\s*\([^)]*'manual_review'[^)]*'succeeded'/i);
    assert.match(mark, /v_reservation\.status\s+NOT\s+IN\s*\([^)]*'consumed'/i);
});

test('atomic verifier resolves named PostgreSQL function arguments by regprocedure', () => {
    const preflight = readVerifierSql(ATOMIC_PREFLIGHT_PATH);
    const postflight = readVerifierSql(ATOMIC_POSTFLIGHT_PATH);

    // pg_get_function_identity_arguments includes declared argument names on
    // supported PostgreSQL versions (for example, "p_sku_id uuid, p_site
    // text").  Comparing it with a bare "uuid, text" string creates a false
    // BLOCK even when the exact function exists.  regprocedure resolves by
    // argument types and is the canonical check used by the migration itself.
    assert.match(
        preflight,
        /to_regprocedure\(\s*'public\.fn_resolve_shop_sku_inventory_sources\(uuid,text\)'\s*\)\s+IS\s+NOT\s+NULL/i
    );
    assert.doesNotMatch(
        preflight,
        /pg_get_function_identity_arguments\(p\.oid\)\s*=\s*'uuid,\s*text'/i
    );
    assert.match(
        postflight,
        /p\.oid\s*=\s*to_regprocedure\(\s*format\('public\.%I\(%s\)'/i
    );
    assert.doesNotMatch(
        postflight,
        /pg_get_function_identity_arguments\(p\.oid\)\s*=\s*e\.identity_args/i
    );
});

test('atomic verifier preserves invoker semantics for pure helper functions', () => {
    const postflight = readVerifierSql(ATOMIC_POSTFLIGHT_PATH);

    // The two immutable, table-free helpers do not need SECURITY DEFINER.  A
    // postflight that requires it would report a false failure after a valid
    // migration and could tempt an operator to widen function privileges.
    assert.match(
        postflight,
        /\('guest_shop_normalize_site',\s*'text',\s*false,\s*'search_path=public, pg_temp'\)/i
    );
    assert.match(
        postflight,
        /\('guest_shop_payment_is_final_success',\s*'text',\s*false,\s*'search_path=public, pg_temp'\)/i
    );
    assert.match(
        postflight,
        /all expected functions exist with the required security attributes/i
    );
});

test('claim and release RETURN QUERY qualify table columns so RETURNS TABLE names are not ambiguous', () => {
    const sql = readAtomicRpcSql();
    const claim = functionBlock(sql, 'fn_guest_shop_claim_fulfillment');
    const release = functionBlock(sql, 'fn_guest_shop_release_reservation');

    // PostgreSQL 42702: RETURNS TABLE(fulfillment_status ...) makes
    // `SELECT fulfillment_status FROM guest_shop_orders` ambiguous.
    assert.match(
        claim,
        /\(SELECT\s+o\.fulfillment_status\s+FROM\s+public\.guest_shop_orders\s+o\s+WHERE\s+o\.id\s*=\s*v_order\.id\)/i
    );
    assert.doesNotMatch(
        claim,
        /\(SELECT\s+fulfillment_status\s+FROM\s+public\.guest_shop_orders\s+WHERE/i
    );
    assert.match(
        release,
        /\(SELECT\s+r\.status\s+FROM\s+public\.guest_shop_inventory_reservations\s+r\s+WHERE\s+r\.id\s*=\s*p_reservation_id\)/i
    );
    assert.match(
        release,
        /\(SELECT\s+o\.payment_status\s+FROM\s+public\.guest_shop_orders\s+o\s+WHERE\s+o\.id\s*=\s*p_order_id\)/i
    );
    assert.match(
        release,
        /\(SELECT\s+o\.fulfillment_status\s+FROM\s+public\.guest_shop_orders\s+o\s+WHERE\s+o\.id\s*=\s*p_order_id\)/i
    );
    assert.match(
        release,
        /\(SELECT\s+o\.refund_status\s+FROM\s+public\.guest_shop_orders\s+o\s+WHERE\s+o\.id\s*=\s*p_order_id\)/i
    );
    assert.doesNotMatch(
        release,
        /\(SELECT\s+(?:status|payment_status|fulfillment_status|refund_status)\s+FROM\s+public\.(?:guest_shop_inventory_reservations|guest_shop_orders)\s+WHERE/i
    );
});

test('atomic RPCs qualify UPDATE SET CASE arms so RETURNS TABLE names are not ambiguous', () => {
    const sql = readAtomicRpcSql();
    const claim = functionBlock(sql, 'fn_guest_shop_claim_fulfillment');
    const release = functionBlock(sql, 'fn_guest_shop_release_reservation');
    const confirm = functionBlock(sql, 'fn_guest_shop_confirm_payment');
    const record = functionBlock(sql, 'fn_guest_shop_record_refund_result');

    for (const [name, body] of [
        ['claim', claim],
        ['release', release],
        ['confirm', confirm],
        ['record', record]
    ]) {
        assert.doesNotMatch(
            body,
            /WHEN\s+(fulfillment_status|refund_status)\s*(=|IN)/i,
            `${name} should not use unqualified WHEN status-column CASE arms`
        );
        assert.doesNotMatch(
            body,
            /(THEN|ELSE)\s+(fulfillment_status|refund_status)\b(?!\.)/i,
            `${name} should not use unqualified THEN/ELSE status-column CASE arms`
        );
    }

    assert.match(
        claim,
        /WHEN\s+v_order\.fulfillment_status\s*=\s*'delivered'\s+THEN\s+v_order\.fulfillment_status/i
    );
    assert.match(
        release,
        /WHEN\s+v_order\.refund_status\s*=\s*'succeeded'\s+THEN\s+v_order\.refund_status/i
    );
    assert.match(
        confirm,
        /WHEN\s+v_order\.fulfillment_status\s+IN\s*\(\s*'delivered'\s*,\s*'refunded'\s*\)/i
    );
    assert.match(record, /ELSE\s+v_order\.fulfillment_status/i);
});
