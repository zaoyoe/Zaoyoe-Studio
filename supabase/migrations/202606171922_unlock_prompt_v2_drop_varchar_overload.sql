DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, integer, character varying);
DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, bigint, character varying);

REVOKE ALL ON FUNCTION public.unlock_prompt_v2(TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unlock_prompt_v2(TEXT, INTEGER, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
