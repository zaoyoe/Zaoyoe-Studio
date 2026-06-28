-- Allow AI workbench video tasks to pass the database constraints that were
-- originally created for image/chat-only generations.

DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    FOR constraint_record IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a
            ON a.attrelid = c.conrelid
            AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.ai_image_agents'::regclass
            AND c.contype = 'c'
            AND a.attname = 'mode'
    LOOP
        EXECUTE format('ALTER TABLE public.ai_image_agents DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;

    FOR constraint_record IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a
            ON a.attrelid = c.conrelid
            AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.ai_image_agents'::regclass
            AND c.contype = 'c'
            AND a.attname = 'default_resolution'
    LOOP
        EXECUTE format('ALTER TABLE public.ai_image_agents DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;

    FOR constraint_record IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a
            ON a.attrelid = c.conrelid
            AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.ai_image_pricing_rules'::regclass
            AND c.contype = 'c'
            AND a.attname = 'mode'
    LOOP
        EXECUTE format('ALTER TABLE public.ai_image_pricing_rules DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;

    FOR constraint_record IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a
            ON a.attrelid = c.conrelid
            AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.ai_image_tasks'::regclass
            AND c.contype = 'c'
            AND a.attname = 'mode'
    LOOP
        EXECUTE format('ALTER TABLE public.ai_image_tasks DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;

    FOR constraint_record IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a
            ON a.attrelid = c.conrelid
            AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.ai_image_tasks'::regclass
            AND c.contype = 'c'
            AND a.attname = 'resolution'
    LOOP
        EXECUTE format('ALTER TABLE public.ai_image_tasks DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;

    FOR constraint_record IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a
            ON a.attrelid = c.conrelid
            AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.ai_image_results'::regclass
            AND c.contype = 'c'
            AND a.attname = 'resolution'
    LOOP
        EXECUTE format('ALTER TABLE public.ai_image_results DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;

    FOR constraint_record IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a
            ON a.attrelid = c.conrelid
            AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.ai_image_api_usage'::regclass
            AND c.contype = 'c'
            AND a.attname = 'request_type'
    LOOP
        EXECUTE format('ALTER TABLE public.ai_image_api_usage DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;

    FOR constraint_record IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a
            ON a.attrelid = c.conrelid
            AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.ai_image_api_usage'::regclass
            AND c.contype = 'c'
            AND a.attname = 'resolution'
    LOOP
        EXECUTE format('ALTER TABLE public.ai_image_api_usage DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;
END $$;

ALTER TABLE public.ai_image_agents
    ADD CONSTRAINT ai_image_agents_mode_check
    CHECK (mode IN ('agent', 'text', 'image', 'video', 'reverse', 'chat'));

ALTER TABLE public.ai_image_agents
    ADD CONSTRAINT ai_image_agents_default_resolution_check
    CHECK (default_resolution IN ('1k', '2k', '4k', '480p', '720p', '1080p'));

ALTER TABLE public.ai_image_pricing_rules
    ADD CONSTRAINT ai_image_pricing_rules_mode_check
    CHECK (mode IN ('text', 'image', 'video', 'reverse', 'chat', 'agent'));

ALTER TABLE public.ai_image_tasks
    ADD CONSTRAINT ai_image_tasks_mode_check
    CHECK (mode IN ('text', 'image', 'video', 'reverse', 'chat', 'agent'));

ALTER TABLE public.ai_image_tasks
    ADD CONSTRAINT ai_image_tasks_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('1k', '2k', '4k', '480p', '720p', '1080p'));

ALTER TABLE public.ai_image_results
    ADD CONSTRAINT ai_image_results_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('1k', '2k', '4k', '480p', '720p', '1080p'));

ALTER TABLE public.ai_image_api_usage
    ADD CONSTRAINT ai_image_api_usage_request_type_check
    CHECK (request_type IN ('chat', 'text', 'image', 'video', 'reverse', 'agent'));

ALTER TABLE public.ai_image_api_usage
    ADD CONSTRAINT ai_image_api_usage_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('1k', '2k', '4k', '480p', '720p', '1080p'));
