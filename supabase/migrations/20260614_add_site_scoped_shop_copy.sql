-- Site-scoped shop product copy and guidance controls.
-- CN/fatherkey keeps the existing base fields. INTL/zaoyoe gets independent
-- copy and visibility fields so admin edits no longer overwrite the other site.

ALTER TABLE public.shop_products
    ADD COLUMN IF NOT EXISTS name_intl VARCHAR(200),
    ADD COLUMN IF NOT EXISTS name_intl_zh VARCHAR(200),
    ADD COLUMN IF NOT EXISTS description_intl TEXT,
    ADD COLUMN IF NOT EXISTS description_intl_zh TEXT,
    ADD COLUMN IF NOT EXISTS show_product_description_intl BOOLEAN,
    ADD COLUMN IF NOT EXISTS purchase_notes_intl TEXT,
    ADD COLUMN IF NOT EXISTS purchase_notes_intl_zh TEXT,
    ADD COLUMN IF NOT EXISTS show_purchase_notes_intl BOOLEAN,
    ADD COLUMN IF NOT EXISTS usage_instructions_intl TEXT,
    ADD COLUMN IF NOT EXISTS usage_instructions_intl_zh TEXT,
    ADD COLUMN IF NOT EXISTS show_usage_instructions_intl BOOLEAN;

COMMENT ON COLUMN public.shop_products.name_intl IS 'INTL/zaoyoe product name, independent from CN/fatherkey name';
COMMENT ON COLUMN public.shop_products.name_intl_zh IS 'Chinese translation for INTL/zaoyoe product name';
COMMENT ON COLUMN public.shop_products.description_intl IS 'INTL/zaoyoe product description, independent from CN/fatherkey description';
COMMENT ON COLUMN public.shop_products.description_intl_zh IS 'Chinese translation for INTL/zaoyoe product description';
COMMENT ON COLUMN public.shop_products.show_product_description_intl IS 'INTL/zaoyoe product description visibility switch';
COMMENT ON COLUMN public.shop_products.purchase_notes_intl IS 'INTL/zaoyoe purchase notes shown before checkout confirmation';
COMMENT ON COLUMN public.shop_products.purchase_notes_intl_zh IS 'Chinese translation for INTL/zaoyoe purchase notes';
COMMENT ON COLUMN public.shop_products.show_purchase_notes_intl IS 'INTL/zaoyoe purchase notes visibility switch';
COMMENT ON COLUMN public.shop_products.usage_instructions_intl IS 'INTL/zaoyoe usage instructions shown after successful purchase';
COMMENT ON COLUMN public.shop_products.usage_instructions_intl_zh IS 'Chinese translation for INTL/zaoyoe usage instructions';
COMMENT ON COLUMN public.shop_products.show_usage_instructions_intl IS 'INTL/zaoyoe usage instructions visibility switch';

UPDATE public.shop_products
SET
    name_intl = COALESCE(NULLIF(name_intl, ''), NULLIF(name_en, '')),
    name_intl_zh = COALESCE(NULLIF(name_intl_zh, ''), NULLIF(name, '')),
    description_intl = COALESCE(NULLIF(description_intl, ''), NULLIF(description_en, '')),
    description_intl_zh = COALESCE(NULLIF(description_intl_zh, ''), NULLIF(description, '')),
    purchase_notes_intl = COALESCE(NULLIF(purchase_notes_intl, ''), NULLIF(purchase_notes_en, '')),
    purchase_notes_intl_zh = COALESCE(NULLIF(purchase_notes_intl_zh, ''), NULLIF(purchase_notes_zh, ''), NULLIF(purchase_notes, '')),
    usage_instructions_intl = COALESCE(NULLIF(usage_instructions_intl, ''), NULLIF(usage_instructions_en, '')),
    usage_instructions_intl_zh = COALESCE(NULLIF(usage_instructions_intl_zh, ''), NULLIF(usage_instructions_zh, ''), NULLIF(usage_instructions, '')),
    show_product_description_intl = COALESCE(show_product_description_intl, show_product_description, true),
    show_purchase_notes_intl = CASE
        WHEN NULLIF(COALESCE(purchase_notes_en, ''), '') IS NOT NULL THEN COALESCE(show_purchase_notes, true)
        ELSE COALESCE(show_purchase_notes_intl, false)
    END,
    show_usage_instructions_intl = CASE
        WHEN NULLIF(COALESCE(usage_instructions_en, ''), '') IS NOT NULL THEN COALESCE(show_usage_instructions, true)
        ELSE COALESCE(show_usage_instructions_intl, false)
    END;

ALTER TABLE public.shop_products
    ALTER COLUMN show_product_description_intl SET DEFAULT true,
    ALTER COLUMN show_purchase_notes_intl SET DEFAULT false,
    ALTER COLUMN show_usage_instructions_intl SET DEFAULT false;
