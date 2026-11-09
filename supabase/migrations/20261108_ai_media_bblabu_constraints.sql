-- BBLABU media request persistence. Application is a separate operator action.
BEGIN;

ALTER TABLE public.ai_image_pricing_rules
    DROP CONSTRAINT IF EXISTS ai_image_pricing_rules_quantity_check;
ALTER TABLE public.ai_image_pricing_rules
    ADD CONSTRAINT ai_image_pricing_rules_quantity_check CHECK (quantity BETWEEN 1 AND 10);
ALTER TABLE public.ai_image_tasks
    DROP CONSTRAINT IF EXISTS ai_image_tasks_quantity_check;
ALTER TABLE public.ai_image_tasks
    ADD CONSTRAINT ai_image_tasks_quantity_check CHECK (quantity BETWEEN 1 AND 10);

ALTER TABLE public.ai_image_agents
    DROP CONSTRAINT IF EXISTS ai_image_agents_default_resolution_check;
ALTER TABLE public.ai_image_agents
    ADD CONSTRAINT ai_image_agents_default_resolution_check
    CHECK (default_resolution IN ('1k', '2k', '4k', '480p', '720p', '768p', '1080p'));
ALTER TABLE public.ai_image_tasks
    DROP CONSTRAINT IF EXISTS ai_image_tasks_resolution_check;
ALTER TABLE public.ai_image_tasks
    ADD CONSTRAINT ai_image_tasks_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('1k', '2k', '4k', '480p', '720p', '768p', '1080p'));
ALTER TABLE public.ai_image_results
    DROP CONSTRAINT IF EXISTS ai_image_results_resolution_check;
ALTER TABLE public.ai_image_results
    ADD CONSTRAINT ai_image_results_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('1k', '2k', '4k', '480p', '720p', '768p', '1080p'));
ALTER TABLE public.ai_image_api_usage
    DROP CONSTRAINT IF EXISTS ai_image_api_usage_resolution_check;
ALTER TABLE public.ai_image_api_usage
    ADD CONSTRAINT ai_image_api_usage_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('1k', '2k', '4k', '480p', '720p', '768p', '1080p'));

COMMIT;
