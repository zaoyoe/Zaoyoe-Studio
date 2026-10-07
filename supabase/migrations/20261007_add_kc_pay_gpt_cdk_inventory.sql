-- KC-PAY-GPT CDK inventory support.
--
-- This migration deliberately keeps CDK plaintext out of shop_inventory.content.
-- The application encrypts each CDK before calling the service-role-only import RPC.
-- The public shop continues to use the existing purchase/order tables, while the
-- protected delivery RPC returns ciphertext only to the server-side API.

ALTER TABLE public.shop_inventory
    ADD COLUMN IF NOT EXISTS inventory_type TEXT NOT NULL DEFAULT 'standard';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'shop_inventory_inventory_type_check'
          AND conrelid = 'public.shop_inventory'::regclass
    ) THEN
        ALTER TABLE public.shop_inventory
            ADD CONSTRAINT shop_inventory_inventory_type_check
            CHECK (inventory_type IN ('standard', 'kc_pay_gpt_cdk'));
    END IF;
END;
$$;

COMMENT ON COLUMN public.shop_inventory.inventory_type IS
    'Explicit delivery inventory type. kc_pay_gpt_cdk is encrypted in shop_cdk_secrets and is never stored in content.';

CREATE INDEX IF NOT EXISTS idx_shop_inventory_type_status
    ON public.shop_inventory (inventory_type, status, product_id, sku_id, created_at, id);

CREATE TABLE IF NOT EXISTS public.shop_cdk_secrets (
    inventory_id UUID PRIMARY KEY REFERENCES public.shop_inventory(id) ON DELETE RESTRICT,
    site VARCHAR(10) NOT NULL DEFAULT 'cn',
    fingerprint TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    encryption_version INTEGER NOT NULL DEFAULT 1,
    algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    order_id UUID REFERENCES public.shop_orders(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shop_cdk_secrets_site_check CHECK (site IN ('cn', 'intl')),
    CONSTRAINT shop_cdk_secrets_fingerprint_check CHECK (char_length(fingerprint) = 64),
    CONSTRAINT shop_cdk_secrets_ciphertext_check CHECK (char_length(ciphertext) > 0),
    CONSTRAINT shop_cdk_secrets_nonce_check CHECK (char_length(nonce) > 0),
    CONSTRAINT shop_cdk_secrets_auth_tag_check CHECK (char_length(auth_tag) > 0),
    CONSTRAINT shop_cdk_secrets_algorithm_check CHECK (algorithm = 'aes-256-gcm'),
    CONSTRAINT shop_cdk_secrets_version_check CHECK (encryption_version = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_shop_cdk_secrets_fingerprint
    ON public.shop_cdk_secrets (fingerprint);
CREATE INDEX IF NOT EXISTS idx_shop_cdk_secrets_order
    ON public.shop_cdk_secrets (order_id, delivered_at);
CREATE INDEX IF NOT EXISTS idx_shop_cdk_secrets_site
    ON public.shop_cdk_secrets (site, inventory_id);

ALTER TABLE public.shop_cdk_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_cdk_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_cdk_secrets TO service_role;

-- A CDK is one-time inventory. It must never be marked as reusable/shared.
CREATE OR REPLACE FUNCTION public.shop_cdk_inventory_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.inventory_type = 'kc_pay_gpt_cdk' AND COALESCE(NEW.is_shared, false) THEN
        RAISE EXCEPTION 'KC-PAY-GPT CDK inventory cannot be reusable/shared';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.inventory_type = 'kc_pay_gpt_cdk'
       AND NEW.inventory_type <> OLD.inventory_type
       AND EXISTS (
           SELECT 1
           FROM public.shop_cdk_secrets
           WHERE inventory_id = OLD.id
       ) THEN
        RAISE EXCEPTION 'KC-PAY-GPT CDK inventory type cannot be changed after import';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shop_cdk_inventory_guard ON public.shop_inventory;
CREATE TRIGGER trg_shop_cdk_inventory_guard
    BEFORE INSERT OR UPDATE OF inventory_type, is_shared
    ON public.shop_inventory
    FOR EACH ROW
    EXECUTE FUNCTION public.shop_cdk_inventory_guard();

-- A delivered or order-bound CDK is never returned to the sellable pool. The
-- existing refund RPC restores ordinary inventory to its requested target
-- status; for CDK rows, an "available" target is fail-closed to "fault" so a
-- refunded customer cannot cause the same secret to be sold a second time.
CREATE OR REPLACE FUNCTION public.shop_cdk_reuse_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_id UUID;
BEGIN
    IF NEW.inventory_type = 'kc_pay_gpt_cdk'
       AND TG_OP = 'UPDATE'
       AND LOWER(BTRIM(COALESCE(NEW.status, ''))) = 'available' THEN
        SELECT order_id
        INTO v_order_id
        FROM public.shop_cdk_secrets
        WHERE inventory_id = NEW.id;

        IF v_order_id IS NOT NULL THEN
            NEW.status := 'fault';
            NEW.remark := COALESCE(
                NULLIF(BTRIM(NEW.remark), ''),
                'KC-PAY-GPT CDK 已绑定订单，退款后不可重新销售'
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shop_cdk_reuse_guard ON public.shop_inventory;
CREATE TRIGGER trg_shop_cdk_reuse_guard
    BEFORE UPDATE OF status
    ON public.shop_inventory
    FOR EACH ROW
    EXECUTE FUNCTION public.shop_cdk_reuse_guard();

-- Import is all-or-nothing. The API supplies an application-generated inventory
-- UUID so the same UUID can be used as AES-GCM AAD before the transaction starts.
CREATE OR REPLACE FUNCTION public.fn_admin_import_shop_cdk_inventory(
    p_product_id UUID,
    p_sku_id UUID,
    p_batch_id TEXT,
    p_site VARCHAR DEFAULT 'cn',
    p_items JSONB DEFAULT '[]'::JSONB,
    p_status TEXT DEFAULT 'available'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_item JSONB;
    v_inventory_id UUID;
    v_fingerprint TEXT;
    v_count INTEGER := 0;
    v_site TEXT := LOWER(BTRIM(COALESCE(p_site, 'cn')));
    v_status TEXT := LOWER(BTRIM(COALESCE(p_status, 'available')));
    v_source_batch_id UUID;
    v_purchase_unit_cost NUMERIC(14,4);
    v_purchase_currency VARCHAR(12);
    v_purchase_exchange_rate_to_cny NUMERIC(18,8);
    v_purchase_unit_cost_cny NUMERIC(14,4);
    v_encryption_version INTEGER;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'service role required';
    END IF;

    IF p_product_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'product_required', 'message', '商品不能为空');
    END IF;
    IF v_site NOT IN ('cn', 'intl') THEN
        RETURN jsonb_build_object('success', false, 'code', 'site_invalid', 'message', '站点参数无效');
    END IF;
    IF v_status NOT IN ('available', 'reserve', 'frozen', 'fault') THEN
        RETURN jsonb_build_object('success', false, 'code', 'status_invalid', 'message', '库存状态无效');
    END IF;
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 THEN
        RETURN jsonb_build_object('success', false, 'code', 'items_required', 'message', 'CDK 列表不能为空');
    END IF;
    IF jsonb_array_length(p_items) > 5000 THEN
        RETURN jsonb_build_object('success', false, 'code', 'too_many_items', 'message', '单批最多导入 5000 条 CDK');
    END IF;

    -- The API creates the procurement batch immediately before calling this
    -- RPC. Resolve it here so CDK inventory keeps the same immutable source and
    -- cost snapshots as ordinary inventory instead of leaving an orphan batch.
    SELECT id, unit_cost, currency, exchange_rate_to_cny, unit_cost_cny
    INTO v_source_batch_id, v_purchase_unit_cost, v_purchase_currency,
         v_purchase_exchange_rate_to_cny, v_purchase_unit_cost_cny
    FROM public.shop_procurement_batches
    WHERE site = v_site
      AND batch_code = NULLIF(BTRIM(COALESCE(p_batch_id, '')), '')
      AND product_id = p_product_id
      AND sku_id IS NOT DISTINCT FROM p_sku_id
    ORDER BY created_at DESC
    LIMIT 1;

    -- Validate the full batch before writing anything, including duplicate UUIDs
    -- and fingerprints inside the request itself and against historical imports.
    -- Validate every item before the first INSERT. Returning from inside the
    -- import loop would otherwise leave earlier rows inserted while reporting a
    -- failed batch, which violates the all-or-nothing import contract.
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS entries(value)
        WHERE NULLIF(BTRIM(value ->> 'inventory_id'), '') IS NULL
           OR BTRIM(value ->> 'inventory_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR NULLIF(BTRIM(value ->> 'fingerprint'), '') IS NULL
           OR BTRIM(value ->> 'fingerprint') !~ '^[0-9a-f]{64}$'
           OR NULLIF(BTRIM(value ->> 'ciphertext'), '') IS NULL
           OR NULLIF(BTRIM(value ->> 'nonce'), '') IS NULL
           OR NULLIF(BTRIM(value ->> 'auth_tag'), '') IS NULL
           OR BTRIM(COALESCE(value ->> 'encryption_version', '')) <> '1'
           OR BTRIM(COALESCE(value ->> 'algorithm', '')) <> 'aes-256-gcm'
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'item_invalid', 'message', 'CDK 密文记录无效，已拒绝整批导入');
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            SELECT value ->> 'inventory_id' AS inventory_id
            FROM jsonb_array_elements(p_items) AS entries(value)
        ) AS batch
        GROUP BY inventory_id
        HAVING COUNT(*) > 1
    ) OR EXISTS (
        SELECT 1
        FROM (
            SELECT value ->> 'fingerprint' AS fingerprint
            FROM jsonb_array_elements(p_items) AS entries(value)
        ) AS batch
        GROUP BY fingerprint
        HAVING COUNT(*) > 1
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'duplicate_cdk', 'message', '批次中存在重复的 CDK');
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.shop_cdk_secrets existing
        WHERE existing.fingerprint IN (
            SELECT value ->> 'fingerprint'
            FROM jsonb_array_elements(p_items) AS entries(value)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'duplicate_cdk', 'message', '存在已导入的重复 CDK');
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS entries(value)
    LOOP
        BEGIN
            v_inventory_id := NULLIF(BTRIM(v_item ->> 'inventory_id'), '')::UUID;
        EXCEPTION WHEN invalid_text_representation THEN
            RETURN jsonb_build_object('success', false, 'code', 'item_invalid', 'message', '库存标识格式无效');
        END;

        v_fingerprint := NULLIF(BTRIM(v_item ->> 'fingerprint'), '');
        BEGIN
            v_encryption_version := NULLIF(BTRIM(v_item ->> 'encryption_version'), '')::INTEGER;
        EXCEPTION WHEN invalid_text_representation THEN
            v_encryption_version := NULL;
        END;
        IF v_inventory_id IS NULL
           OR v_fingerprint IS NULL
           OR char_length(v_fingerprint) <> 64
           OR NULLIF(BTRIM(v_item ->> 'ciphertext'), '') IS NULL
           OR NULLIF(BTRIM(v_item ->> 'nonce'), '') IS NULL
           OR NULLIF(BTRIM(v_item ->> 'auth_tag'), '') IS NULL
           OR COALESCE(v_encryption_version, 0) <> 1
           OR COALESCE(v_item ->> 'algorithm', '') <> 'aes-256-gcm' THEN
            RETURN jsonb_build_object('success', false, 'code', 'item_invalid', 'message', 'CDK 密文记录无效');
        END IF;

        INSERT INTO public.shop_inventory (
            id,
            product_id,
            sku_id,
            content,
            status,
            batch_id,
            is_shared,
            inventory_type,
            source_batch_id,
            purchase_unit_cost,
            purchase_currency,
            purchase_exchange_rate_to_cny,
            purchase_unit_cost_cny
        )
        VALUES (
            v_inventory_id,
            p_product_id,
            p_sku_id,
            '',
            v_status,
            NULLIF(BTRIM(COALESCE(p_batch_id, '')), ''),
            false,
            'kc_pay_gpt_cdk',
            v_source_batch_id,
            v_purchase_unit_cost,
            v_purchase_currency,
            v_purchase_exchange_rate_to_cny,
            v_purchase_unit_cost_cny
        );

        INSERT INTO public.shop_cdk_secrets (
            inventory_id,
            site,
            fingerprint,
            ciphertext,
            nonce,
            auth_tag,
            encryption_version,
            algorithm
        )
        VALUES (
            v_inventory_id,
            v_site,
            v_fingerprint,
            BTRIM(v_item ->> 'ciphertext'),
            BTRIM(v_item ->> 'nonce'),
            BTRIM(v_item ->> 'auth_tag'),
            v_encryption_version,
            BTRIM(v_item ->> 'algorithm')
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'imported', v_count,
        'inventory_type', 'kc_pay_gpt_cdk',
        'site', v_site
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'code', 'duplicate_cdk', 'message', '存在重复的 CDK 或库存记录');
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_import_shop_cdk_inventory(UUID, UUID, TEXT, VARCHAR, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_import_shop_cdk_inventory(UUID, UUID, TEXT, VARCHAR, JSONB, TEXT) TO service_role;

-- Bind a CDK to exactly one successful shop order. This runs inside the same
-- transaction as the existing purchase RPC and makes replay/reassignment fail closed.
CREATE OR REPLACE FUNCTION public.shop_bind_cdk_inventory_to_order(p_inventory_id UUID, p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inventory_type TEXT;
    v_order_site TEXT;
    v_secret_site TEXT;
    v_existing_order UUID;
BEGIN
    IF p_inventory_id IS NULL OR p_order_id IS NULL THEN
        RETURN;
    END IF;

    SELECT inventory_type
    INTO v_inventory_type
    FROM public.shop_inventory
    WHERE id = p_inventory_id
    FOR SHARE;

    IF v_inventory_type <> 'kc_pay_gpt_cdk' THEN
        RETURN;
    END IF;

    SELECT LOWER(BTRIM(COALESCE(site, 'cn')))
    INTO v_order_site
    FROM public.shop_orders
    WHERE id = p_order_id
    FOR SHARE;

    SELECT site, order_id
    INTO v_secret_site, v_existing_order
    FROM public.shop_cdk_secrets
    WHERE inventory_id = p_inventory_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KC-PAY-GPT CDK secret is missing';
    END IF;
    IF v_secret_site <> v_order_site THEN
        RAISE EXCEPTION 'KC-PAY-GPT CDK site does not match order site';
    END IF;
    IF v_existing_order IS NOT NULL AND v_existing_order <> p_order_id THEN
        RAISE EXCEPTION 'KC-PAY-GPT CDK is already assigned to another order';
    END IF;

    UPDATE public.shop_cdk_secrets
    SET order_id = p_order_id,
        assigned_at = COALESCE(assigned_at, NOW())
    WHERE inventory_id = p_inventory_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_bind_cdk_from_shop_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.shop_bind_cdk_inventory_to_order(NEW.inventory_id, NEW.id);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_bind_cdk_from_shop_order_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.shop_bind_cdk_inventory_to_order(NEW.inventory_id, NEW.order_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shop_bind_cdk_from_shop_order ON public.shop_orders;
CREATE TRIGGER trg_shop_bind_cdk_from_shop_order
    AFTER INSERT OR UPDATE OF inventory_id
    ON public.shop_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.shop_bind_cdk_from_shop_order();

DROP TRIGGER IF EXISTS trg_shop_bind_cdk_from_shop_order_item ON public.shop_order_items;
CREATE TRIGGER trg_shop_bind_cdk_from_shop_order_item
    AFTER INSERT OR UPDATE OF inventory_id, order_id
    ON public.shop_order_items
    FOR EACH ROW
    EXECUTE FUNCTION public.shop_bind_cdk_from_shop_order_item();

REVOKE ALL ON FUNCTION public.shop_bind_cdk_inventory_to_order(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_bind_cdk_inventory_to_order(UUID, UUID) TO service_role;

-- Only the authenticated server-side order-detail API may call this function.
-- It returns ciphertext, never plaintext. The API decrypts it with its private
-- key and immediately returns the CDK to the owning user.
CREATE OR REPLACE FUNCTION public.fn_get_shop_cdk_delivery(
    p_order_id UUID,
    p_user_id UUID,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_inventory_id UUID;
    v_inventory_type TEXT;
    v_secret RECORD;
    v_items JSONB := '[]'::JSONB;
    v_site TEXT := LOWER(BTRIM(COALESCE(p_site, 'cn')));
    v_inventory_ids UUID[];
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'service role required';
    END IF;
    IF p_order_id IS NULL OR p_user_id IS NULL OR v_site NOT IN ('cn', 'intl') THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_request', 'message', '订单请求无效');
    END IF;

    SELECT id, user_id, site, refund_status
    INTO v_order
    FROM public.shop_orders
    WHERE id = p_order_id
      AND user_id = p_user_id
      AND LOWER(BTRIM(COALESCE(site, 'cn'))) = v_site;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'order_not_found', 'message', '订单不存在或无权访问');
    END IF;
    IF COALESCE(v_order.refund_status, 'none') IN ('refunded', 'full_refund') THEN
        RETURN jsonb_build_object('success', false, 'code', 'order_refunded', 'message', '退款订单不可交付');
    END IF;

    SELECT ARRAY(
        SELECT DISTINCT linked.inventory_id
        FROM (
            SELECT inventory_id
            FROM public.shop_order_items
            WHERE order_id = p_order_id
              AND inventory_id IS NOT NULL
            UNION ALL
            SELECT inventory_id
            FROM public.shop_orders
            WHERE id = p_order_id
              AND inventory_id IS NOT NULL
        ) AS linked
    )
    INTO v_inventory_ids;

    IF v_inventory_ids IS NULL OR array_length(v_inventory_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('success', true, 'items', v_items);
    END IF;

    FOREACH v_inventory_id IN ARRAY v_inventory_ids
    LOOP
        SELECT inventory_type
        INTO v_inventory_type
        FROM public.shop_inventory
        WHERE id = v_inventory_id;

        IF v_inventory_type <> 'kc_pay_gpt_cdk' THEN
            CONTINUE;
        END IF;

        SELECT inventory_id, site, fingerprint, ciphertext, nonce, auth_tag,
               encryption_version, algorithm, order_id, delivered_at
        INTO v_secret
        FROM public.shop_cdk_secrets
        WHERE inventory_id = v_inventory_id;

        IF NOT FOUND
           OR v_secret.order_id IS DISTINCT FROM p_order_id
           OR v_secret.site <> v_site THEN
            RETURN jsonb_build_object('success', false, 'code', 'cdk_binding_invalid', 'message', 'CDK 订单绑定校验失败');
        END IF;

        UPDATE public.shop_cdk_secrets
        SET delivered_at = COALESCE(delivered_at, NOW())
        WHERE inventory_id = v_inventory_id;

        v_items := v_items || jsonb_build_array(jsonb_build_object(
            'inventory_id', v_secret.inventory_id,
            'site', v_secret.site,
            'fingerprint', v_secret.fingerprint,
            'ciphertext', v_secret.ciphertext,
            'nonce', v_secret.nonce,
            'auth_tag', v_secret.auth_tag,
            'encryption_version', v_secret.encryption_version,
            'algorithm', v_secret.algorithm
        ));
    END LOOP;

    RETURN jsonb_build_object('success', true, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_shop_cdk_delivery(UUID, UUID, VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_shop_cdk_delivery(UUID, UUID, VARCHAR) TO service_role;

-- Guest cash purchase is a separate product path and must reject CDK rows even
-- if a future endpoint accidentally marks the product/SKU as guest-enabled.
CREATE OR REPLACE FUNCTION public.guest_shop_reject_cdk_inventory_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.shop_inventory
        WHERE id = NEW.inventory_id
          AND inventory_type = 'kc_pay_gpt_cdk'
    ) THEN
        RAISE EXCEPTION 'KC-PAY-GPT CDK inventory is not eligible for guest purchase';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guest_shop_reject_cdk_inventory_reservation
    ON public.guest_shop_inventory_reservations;
CREATE TRIGGER trg_guest_shop_reject_cdk_inventory_reservation
    BEFORE INSERT OR UPDATE OF inventory_id
    ON public.guest_shop_inventory_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.guest_shop_reject_cdk_inventory_reservation();

-- Provider-neutral purchase selection: a CDK imported for one site can only be
-- selected by an order on that same site. The existing purchase and marketplace
-- RPCs already call the site-aware lock helper from 20260615, so patching that
-- single helper keeps both purchase paths aligned without brittle text matching
-- against the much larger purchase function. Standard inventory remains unchanged.
DO $$
DECLARE
    v_definition TEXT;
    v_shared_false_marker TEXT := 'AND COALESCE(i.is_shared, false) = false';
    v_shared_true_marker TEXT := 'AND COALESCE(i.is_shared, false) = true';
    v_site_filter TEXT := E'\n             AND (COALESCE(i.inventory_type, ''standard'') <> ''kc_pay_gpt_cdk'' OR EXISTS (' || E'\n'
        || '                 SELECT 1' || E'\n'
        || '                 FROM public.shop_cdk_secrets cdk_site' || E'\n'
        || '                 WHERE cdk_site.inventory_id = i.id' || E'\n'
        || '                   AND cdk_site.site = v_site' || E'\n'
        || '             ))';
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_lock_shop_sku_inventory(uuid,uuid,integer,text)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_lock_shop_sku_inventory(uuid,uuid,integer,text) is missing; run 20260615_site_scoped_shop_sku_inventory_sources.sql first';
    END IF;

    IF POSITION('cdk_site.inventory_id = i.id' IN v_definition) = 0 THEN
        IF POSITION(v_shared_false_marker IN v_definition) = 0
           OR POSITION(v_shared_true_marker IN v_definition) = 0 THEN
            RAISE EXCEPTION 'failed to patch fn_lock_shop_sku_inventory for CDK site isolation: shared inventory markers missing';
        END IF;

        v_definition := REPLACE(
            v_definition,
            v_shared_false_marker,
            v_shared_false_marker || v_site_filter
        );
        v_definition := REPLACE(
            v_definition,
            v_shared_true_marker,
            v_shared_true_marker || v_site_filter
        );
    END IF;

    IF POSITION('cdk_site.inventory_id = i.id' IN v_definition) = 0
       OR POSITION('cdk_site.site = v_site' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_lock_shop_sku_inventory for CDK site isolation';
    END IF;

    EXECUTE v_definition;
END;
$$;

COMMENT ON TABLE public.shop_cdk_secrets IS
    'Encrypted KC-PAY-GPT CDK values only. Never expose this table to browser clients or admin list APIs.';
