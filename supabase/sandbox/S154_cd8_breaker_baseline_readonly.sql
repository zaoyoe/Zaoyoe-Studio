-- S154 卡 8 熔断基线。Codex 不执行。全文只有一条 SELECT。
-- 只读熔断单行、熔断事件计数和两站预算。不调用 service_role 促销状态函数。
-- 不打开熔断，不合闸，不改预算，不改券，不打开游客开关，不建单，不付款。
-- 期望正好 1 行。把整行贴回，尤其 baseline_verdict。
-- baseline_verdict 以「基线通过」开头才算这半步。
-- 写着「缺行」或「不是 closed」时不要补行，不要改状态，不要建单。
-- 缺行也可能是当前角色看不见表，不是邀请去插入熔断行。
-- manual_open_count 与 manual_close_count 是打开熔断之前的起点。以后各加 1 用差值，不要求现在是 0。

WITH breaker AS (
    SELECT
        b.id,
        b.state,
        b.reason,
        b.opened_at,
        b.opened_by,
        b.closed_at,
        b.closed_by,
        b.mismatch_trip_threshold,
        b.identity_trip_threshold,
        b.trip_window_seconds,
        (
            (b.state = 'open' AND b.opened_at IS NOT NULL AND b.opened_by IS NOT NULL)
            OR (b.state = 'closed' AND b.opened_at IS NULL AND b.opened_by IS NULL)
        ) AS state_exclusive_ok
    FROM public.guest_shop_promo_breaker b
    WHERE b.id = 1
),
events AS (
    SELECT
        COUNT(*)::bigint AS event_count,
        COUNT(*) FILTER (WHERE kind = 'manual_open')::bigint AS manual_open_count,
        COUNT(*) FILTER (WHERE kind = 'manual_close')::bigint AS manual_close_count,
        COUNT(*) FILTER (WHERE kind = 'auto_open')::bigint AS auto_open_count,
        COUNT(*) FILTER (WHERE kind = 'amount_mismatch')::bigint AS amount_mismatch_count,
        COUNT(*) FILTER (WHERE kind = 'identity_limit_hit')::bigint AS identity_limit_hit_count,
        COUNT(*) FILTER (WHERE kind = 'budget_exhausted')::bigint AS budget_exhausted_count,
        COUNT(*) FILTER (WHERE kind = 'code_exhausted')::bigint AS code_exhausted_count
    FROM public.guest_shop_promo_breaker_events
),
budgets AS (
    SELECT
        COUNT(*) FILTER (WHERE site = 'cn')::bigint AS cn_rows,
        COUNT(*) FILTER (WHERE site = 'intl')::bigint AS intl_rows,
        MAX(daily_budget_cny) FILTER (WHERE site = 'cn') AS cn_daily_budget_cny,
        MAX(spent_cny) FILTER (WHERE site = 'cn') AS cn_spent_cny,
        MAX(budget_date) FILTER (WHERE site = 'cn') AS cn_budget_date,
        BOOL_OR(enabled) FILTER (WHERE site = 'cn') AS cn_enabled,
        MAX(daily_budget_cny) FILTER (WHERE site = 'intl') AS intl_daily_budget_cny,
        MAX(spent_cny) FILTER (WHERE site = 'intl') AS intl_spent_cny,
        MAX(budget_date) FILTER (WHERE site = 'intl') AS intl_budget_date,
        BOOL_OR(enabled) FILTER (WHERE site = 'intl') AS intl_enabled
    FROM public.guest_shop_promo_budget
)
SELECT
    (b.id IS NOT NULL) AS breaker_present,
    COALESCE(b.state, 'missing') AS breaker_state,
    b.state_exclusive_ok,
    b.reason AS breaker_reason,
    b.opened_at,
    b.opened_by,
    b.closed_at,
    b.closed_by,
    b.mismatch_trip_threshold,
    b.identity_trip_threshold,
    b.trip_window_seconds,
    e.event_count,
    e.manual_open_count,
    e.manual_close_count,
    e.auto_open_count,
    e.amount_mismatch_count,
    e.identity_limit_hit_count,
    e.budget_exhausted_count,
    e.code_exhausted_count,
    (bg.cn_rows = 1) AS cn_budget_present,
    bg.cn_enabled,
    bg.cn_daily_budget_cny,
    bg.cn_budget_date,
    bg.cn_spent_cny,
    (bg.intl_rows = 1) AS intl_budget_present,
    bg.intl_enabled,
    bg.intl_daily_budget_cny,
    bg.intl_budget_date,
    bg.intl_spent_cny,
    CASE
        WHEN b.id IS NULL THEN '缺行。不要补插熔断行，不要打开熔断，不要建单。把本行贴回。'
        WHEN b.state IS DISTINCT FROM 'closed' THEN '熔断不是 closed。不要再开，不要合闸，不要建单。把本行贴回。'
        WHEN b.state_exclusive_ok IS NOT TRUE THEN 'closed 行的打开时间或打开人不满足互斥约束。不要改行，不要建单。把本行贴回。'
        ELSE '基线通过。贴回本行。state=closed。本文件不打开熔断，不打开游客开关，不建单。'
    END AS baseline_verdict
FROM (SELECT 1) AS anchor
LEFT JOIN breaker b ON TRUE
CROSS JOIN events e
CROSS JOIN budgets bg;
