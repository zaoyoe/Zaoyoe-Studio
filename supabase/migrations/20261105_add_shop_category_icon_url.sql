-- Add icon_url column to public.shop_categories for category display icon
ALTER TABLE public.shop_categories
    ADD COLUMN IF NOT EXISTS icon_url text;

COMMENT ON COLUMN public.shop_categories.icon_url IS 'Category display icon URL (e.g. Cloudflare R2 image URL or FontAwesome class)';
