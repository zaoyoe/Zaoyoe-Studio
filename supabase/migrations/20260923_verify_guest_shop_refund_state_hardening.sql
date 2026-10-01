-- Read-only verification for 20260923_guest_shop_refund_state_hardening.sql.
-- This query performs no writes and never displays order, buyer, or coupon data.
WITH refund_rpc AS (
    SELECT
        p.oid,
        p.prosecdef,
        p.proconfig,
        pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.oid = to_regprocedure('public.fn_guest_shop_record_refund_result(uuid,text,text,text,text)')
), review_guard AS (
    SELECT
        p.oid,
        pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.oid = to_regprocedure('public.guest_shop_preserve_refund_manual_review()')
), refund_branches AS (
    SELECT
        r.oid,
        regexp_replace(LOWER(r.definition), '[[:space:]]+', '', 'g') AS normalized_definition,
        strpos(
            regexp_replace(LOWER(r.definition), '[[:space:]]+', '', 'g'),
            'ifv_status=''succeeded''then'
        ) AS success_branch_start,
        strpos(
            regexp_replace(LOWER(r.definition), '[[:space:]]+', '', 'g'),
            'elseupdatepublic.guest_shop_payment_orderssetstatus=casewhenv_status=''manual_review'''
        ) AS failure_branch_start
    FROM refund_rpc r
), review_trigger AS (
    SELECT
        t.tgenabled,
        pg_get_triggerdef(t.oid, true) AS definition,
        t.tgfoid
    FROM pg_trigger t
    WHERE t.tgrelid = to_regclass('public.guest_shop_orders')
      AND t.tgname = 'guest_shop_preserve_refund_manual_review'
      AND NOT t.tgisinternal
), checks AS (
    SELECT
        'refund_rpc_security'::TEXT AS check_name,
        COALESCE(
            r.prosecdef
            AND EXISTS (
                SELECT 1
                FROM unnest(COALESCE(r.proconfig, ARRAY[]::TEXT[])) AS setting
                WHERE regexp_replace(split_part(setting, '=', 1), '[[:space:]]', '', 'g') = 'search_path'
                  AND regexp_replace(split_part(setting, '=', 2), '[[:space:]]', '', 'g') = 'public,pg_temp'
            )
            AND has_function_privilege('service_role', r.oid, 'EXECUTE')
            AND NOT has_function_privilege('anon', r.oid, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', r.oid, 'EXECUTE'),
            false
        ) AS ok,
        CASE
            WHEN r.oid IS NULL THEN 'refund RPC is missing'
            ELSE 'prosecdef=' || r.prosecdef::TEXT || '; service_role only; fixed search_path'
        END AS detail
    FROM (SELECT 1) seed
    LEFT JOIN refund_rpc r ON true

    UNION ALL

    SELECT
        'refund_returns_promo_reservation',
        COALESCE(
            b.oid IS NOT NULL
            AND b.success_branch_start > 0
            AND b.failure_branch_start > b.success_branch_start
            AND POSITION(
                'performpublic.guest_shop_release_held_reservations(p_order_id,''refund_succeeded'');'
                IN SUBSTRING(
                    b.normalized_definition
                    FROM b.success_branch_start
                    FOR b.failure_branch_start - b.success_branch_start
                )
            ) > 0
            AND POSITION(
                'performpublic.fn_guest_shop_return_discount_reservation(p_order_id,''refund_succeeded'');'
                IN SUBSTRING(
                    b.normalized_definition
                    FROM b.success_branch_start
                    FOR b.failure_branch_start - b.success_branch_start
                )
            ) > POSITION(
                'performpublic.guest_shop_release_held_reservations(p_order_id,''refund_succeeded'');'
                IN SUBSTRING(
                    b.normalized_definition
                    FROM b.success_branch_start
                    FOR b.failure_branch_start - b.success_branch_start
                )
            )
            AND POSITION(
                'guest_shop_release_held_reservations('
                IN SUBSTRING(b.normalized_definition FROM b.failure_branch_start)
            ) = 0
            AND POSITION(
                'fn_guest_shop_return_discount_reservation('
                IN SUBSTRING(b.normalized_definition FROM b.failure_branch_start)
            ) = 0,
            false
        ),
        CASE
            WHEN b.oid IS NULL THEN 'refund RPC is missing'
            WHEN b.success_branch_start = 0 OR b.failure_branch_start <= b.success_branch_start
                THEN 'cannot locate the success and failure branches'
            ELSE 'release helper must run before the coupon return in the success branch, and both calls must be absent from the failure branch'
        END
    FROM (SELECT 1) seed
    LEFT JOIN refund_branches b ON true

    UNION ALL

    SELECT
        'manual_review_guard_function',
        COALESCE(
            g.definition ILIKE '%OLD.refund_status%manual_review%'
            AND g.definition ILIKE '%NEW.refund_status%pending%'
            AND g.definition ILIKE '%NEW.refund_status%manual_review%',
            false
        ),
        CASE WHEN g.oid IS NULL THEN 'manual-review guard function is missing'
             ELSE 'pending rollups preserve manual_review' END
    FROM (SELECT 1) seed
    LEFT JOIN review_guard g ON true

    UNION ALL

    SELECT
        'manual_review_guard_trigger',
        COALESCE(
            t.tgenabled = 'O'
            AND t.definition ILIKE 'CREATE TRIGGER%BEFORE UPDATE OF refund_status%guest_shop_orders%'
            AND g.oid = t.tgfoid,
            false
        ),
        CASE WHEN t.tgfoid IS NULL THEN 'enabled BEFORE UPDATE OF refund_status trigger is missing'
             ELSE 'enabled trigger is attached to guest_shop_orders' END
    FROM (SELECT 1) seed
    LEFT JOIN review_trigger t ON true
    LEFT JOIN review_guard g ON true
)
SELECT check_name, ok, detail
FROM checks
ORDER BY check_name;
