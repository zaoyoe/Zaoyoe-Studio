-- ============================================
-- Phase 3: A/B experiment results drilldown by exposure site and placement
-- ============================================

CREATE OR REPLACE FUNCTION public.get_experiment_results_v2(p_experiment_id UUID)
RETURNS TABLE (
    dimension_type TEXT,
    dimension_value TEXT,
    variant_name TEXT,
    assigned_user_count BIGINT,
    exposure_user_count BIGINT,
    conversion_count BIGINT,
    conversion_rate NUMERIC
) AS $$
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH experiment AS (
        SELECT
            e.id,
            LOWER(BTRIM(COALESCE(e.name, ''))) AS experiment_name_key,
            LOWER(BTRIM(COALESCE(NULLIF(e.target_metric, ''), 'engagement'))) AS target_metric_key,
            CASE
                WHEN LOWER(BTRIM(COALESCE(e.target_metric, ''))) IN ('', 'page_view', 'button_click', 'signup', 'purchase', 'engagement') THEN FALSE
                ELSE TRUE
            END AS require_context
        FROM public.ab_experiments e
        WHERE e.id = p_experiment_id
    ),
    assignment_base AS (
        SELECT
            a.user_id,
            a.variant_name,
            LOWER(BTRIM(COALESCE(a.variant_name, ''))) AS variant_name_key,
            a.assigned_at
        FROM public.ab_assignments a
        WHERE a.experiment_id = p_experiment_id
    ),
    exposure_events AS (
        SELECT DISTINCT ON (
            a.user_id,
            a.variant_name_key,
            COALESCE(NULLIF(LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', ''))), ''), 'cn'),
            COALESCE(NULLIF(LOWER(BTRIM(COALESCE(ue.event_data->'metadata'->>'placement', ue.event_data->>'placement', ''))), ''), 'default')
        )
            a.user_id,
            a.variant_name,
            a.variant_name_key,
            COALESCE(NULLIF(LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', ''))), ''), 'cn') AS site_value,
            COALESCE(NULLIF(LOWER(BTRIM(COALESCE(ue.event_data->'metadata'->>'placement', ue.event_data->>'placement', ''))), ''), 'default') AS placement_value,
            ue.created_at AS exposed_at
        FROM assignment_base a
        CROSS JOIN experiment e
        JOIN public.user_events ue
          ON ue.user_id = a.user_id
         AND ue.created_at >= a.assigned_at
         AND LOWER(BTRIM(COALESCE(ue.event_name, ''))) = 'experiment_exposure'
         AND (
            LOWER(BTRIM(COALESCE(ue.event_data->>'experiment_id', ''))) IN (e.experiment_name_key, LOWER(e.id::TEXT))
            OR LOWER(BTRIM(COALESCE(ue.event_data->'metadata'->>'experiment_name', ''))) = e.experiment_name_key
         )
         AND (
            LOWER(BTRIM(COALESCE(ue.event_data->>'variant_id', ''))) = a.variant_name_key
            OR LOWER(BTRIM(COALESCE(ue.event_data->'metadata'->>'variant_name', ''))) = a.variant_name_key
         )
        ORDER BY
            a.user_id,
            a.variant_name_key,
            site_value,
            placement_value,
            ue.created_at
    ),
    exposed_overall AS (
        SELECT
            user_id,
            variant_name,
            variant_name_key,
            MIN(exposed_at) AS exposed_at
        FROM exposure_events
        GROUP BY user_id, variant_name, variant_name_key
    ),
    exposed_by_site AS (
        SELECT
            user_id,
            variant_name,
            variant_name_key,
            site_value AS dimension_value,
            MIN(exposed_at) AS exposed_at
        FROM exposure_events
        GROUP BY user_id, variant_name, variant_name_key, site_value
    ),
    exposed_by_placement AS (
        SELECT
            user_id,
            variant_name,
            variant_name_key,
            placement_value AS dimension_value,
            MIN(exposed_at) AS exposed_at
        FROM exposure_events
        GROUP BY user_id, variant_name, variant_name_key, placement_value
    ),
    conversion_events AS (
        SELECT
            ue.user_id,
            ue.created_at,
            LOWER(BTRIM(COALESCE(ue.event_name, ''))) AS event_name_key,
            LOWER(BTRIM(COALESCE(ue.event_type, ''))) AS event_type_key,
            LOWER(BTRIM(COALESCE(ue.event_data->>'experiment_id', ''))) AS experiment_id_key,
            LOWER(BTRIM(COALESCE(ue.event_data->'metadata'->>'experiment_name', ''))) AS experiment_name_key,
            LOWER(BTRIM(COALESCE(ue.event_data->>'variant_id', ''))) AS variant_id_key,
            LOWER(BTRIM(COALESCE(ue.event_data->'metadata'->>'variant_name', ''))) AS variant_name_key
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL
    ),
    overall_conversions AS (
        SELECT DISTINCT
            eo.variant_name,
            eo.variant_name_key,
            eo.user_id
        FROM exposed_overall eo
        CROSS JOIN experiment e
        JOIN conversion_events ce
          ON ce.user_id = eo.user_id
         AND ce.created_at >= eo.exposed_at
         AND public.experiment_metric_matches_event(e.target_metric_key, ce.event_name_key, ce.event_type_key)
         AND (
            CASE
                WHEN e.require_context THEN
                    (
                        ce.experiment_id_key IN (e.experiment_name_key, LOWER(e.id::TEXT))
                        OR ce.experiment_name_key = e.experiment_name_key
                    )
                    AND (
                        ce.variant_id_key = eo.variant_name_key
                        OR ce.variant_name_key = eo.variant_name_key
                    )
                ELSE TRUE
            END
         )
    ),
    site_conversions AS (
        SELECT DISTINCT
            es.dimension_value,
            es.variant_name,
            es.variant_name_key,
            es.user_id
        FROM exposed_by_site es
        CROSS JOIN experiment e
        JOIN conversion_events ce
          ON ce.user_id = es.user_id
         AND ce.created_at >= es.exposed_at
         AND public.experiment_metric_matches_event(e.target_metric_key, ce.event_name_key, ce.event_type_key)
         AND (
            CASE
                WHEN e.require_context THEN
                    (
                        ce.experiment_id_key IN (e.experiment_name_key, LOWER(e.id::TEXT))
                        OR ce.experiment_name_key = e.experiment_name_key
                    )
                    AND (
                        ce.variant_id_key = es.variant_name_key
                        OR ce.variant_name_key = es.variant_name_key
                    )
                ELSE TRUE
            END
         )
    ),
    placement_conversions AS (
        SELECT DISTINCT
            ep.dimension_value,
            ep.variant_name,
            ep.variant_name_key,
            ep.user_id
        FROM exposed_by_placement ep
        CROSS JOIN experiment e
        JOIN conversion_events ce
          ON ce.user_id = ep.user_id
         AND ce.created_at >= ep.exposed_at
         AND public.experiment_metric_matches_event(e.target_metric_key, ce.event_name_key, ce.event_type_key)
         AND (
            CASE
                WHEN e.require_context THEN
                    (
                        ce.experiment_id_key IN (e.experiment_name_key, LOWER(e.id::TEXT))
                        OR ce.experiment_name_key = e.experiment_name_key
                    )
                    AND (
                        ce.variant_id_key = ep.variant_name_key
                        OR ce.variant_name_key = ep.variant_name_key
                    )
                ELSE TRUE
            END
         )
    ),
    overall_rows AS (
        SELECT
            'overall'::TEXT AS dimension_type,
            'all'::TEXT AS dimension_value,
            a.variant_name::TEXT,
            COUNT(DISTINCT a.user_id)::BIGINT AS assigned_user_count,
            COUNT(DISTINCT eo.user_id)::BIGINT AS exposure_user_count,
            COUNT(DISTINCT oc.user_id)::BIGINT AS conversion_count,
            ROUND(
                COUNT(DISTINCT oc.user_id)::NUMERIC
                / NULLIF(COUNT(DISTINCT eo.user_id), 0) * 100,
                1
            ) AS conversion_rate
        FROM assignment_base a
        LEFT JOIN exposed_overall eo
          ON eo.user_id = a.user_id
         AND eo.variant_name_key = a.variant_name_key
        LEFT JOIN overall_conversions oc
          ON oc.user_id = a.user_id
         AND oc.variant_name_key = a.variant_name_key
        GROUP BY a.variant_name
    ),
    site_rows AS (
        SELECT
            'site'::TEXT AS dimension_type,
            es.dimension_value::TEXT,
            es.variant_name::TEXT,
            COUNT(DISTINCT es.user_id)::BIGINT AS assigned_user_count,
            COUNT(DISTINCT es.user_id)::BIGINT AS exposure_user_count,
            COUNT(DISTINCT sc.user_id)::BIGINT AS conversion_count,
            ROUND(
                COUNT(DISTINCT sc.user_id)::NUMERIC
                / NULLIF(COUNT(DISTINCT es.user_id), 0) * 100,
                1
            ) AS conversion_rate
        FROM exposed_by_site es
        LEFT JOIN site_conversions sc
          ON sc.user_id = es.user_id
         AND sc.variant_name_key = es.variant_name_key
         AND sc.dimension_value = es.dimension_value
        GROUP BY es.dimension_value, es.variant_name
    ),
    placement_rows AS (
        SELECT
            'placement'::TEXT AS dimension_type,
            ep.dimension_value::TEXT,
            ep.variant_name::TEXT,
            COUNT(DISTINCT ep.user_id)::BIGINT AS assigned_user_count,
            COUNT(DISTINCT ep.user_id)::BIGINT AS exposure_user_count,
            COUNT(DISTINCT pc.user_id)::BIGINT AS conversion_count,
            ROUND(
                COUNT(DISTINCT pc.user_id)::NUMERIC
                / NULLIF(COUNT(DISTINCT ep.user_id), 0) * 100,
                1
            ) AS conversion_rate
        FROM exposed_by_placement ep
        LEFT JOIN placement_conversions pc
          ON pc.user_id = ep.user_id
         AND pc.variant_name_key = ep.variant_name_key
         AND pc.dimension_value = ep.dimension_value
        GROUP BY ep.dimension_value, ep.variant_name
    )
    SELECT *
    FROM (
        SELECT * FROM overall_rows
        UNION ALL
        SELECT * FROM site_rows
        UNION ALL
        SELECT * FROM placement_rows
    ) AS result_rows
    ORDER BY
        CASE result_rows.dimension_type
            WHEN 'overall' THEN 0
            WHEN 'site' THEN 1
            ELSE 2
        END,
        result_rows.dimension_value,
        result_rows.variant_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_experiment_results_v2(UUID) TO authenticated;
