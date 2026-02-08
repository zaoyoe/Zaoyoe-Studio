-- ============================================
-- Add English translations to homepage_config JSONB content
-- ============================================

-- Update Hero section with English translations
UPDATE homepage_config
SET content = jsonb_set(
  jsonb_set(
    content,
    '{title_en}',
    '"Zaoyoe Studio"'::jsonb
  ),
  '{subtitle_en}',
  '"Creativity · Efficiency · Infinite Possibilities"'::jsonb
)
WHERE section = 'hero';

-- Update Prompts section with English translations  
UPDATE homepage_config
SET content = jsonb_set(
  jsonb_set(
    content,
    '{section_title_en}',
    '"AI Prompt"'::jsonb
  ),
  '{section_subtitle_en}',
  '"Boost creativity, unleash inspiration"'::jsonb
)
WHERE section = 'prompts';

-- Update Shop section with English translations
UPDATE homepage_config
SET content = jsonb_set(
  jsonb_set(
    content,
    '{section_title_en}',
    '"Featured Resources"'::jsonb
  ),
  '{section_subtitle_en}',
    '"Premium resources to fuel your growth"'::jsonb
)
WHERE section = 'shop';

-- Update Verify section with English translations
UPDATE homepage_config
SET content = jsonb_set(
  jsonb_set(
    content,
    '{section_title_en}',
    '"Gemini API Verification"'::jsonb
  ),
  '{section_subtitle_en}',
    '"Verify your API key instantly with real-time results"'::jsonb
)
WHERE section = 'verify';

-- Update Guestbook section with English translations
UPDATE homepage_config
SET content = jsonb_set(
  jsonb_set(
    content,
    '{section_title_en}',
    '"Guestbook"'::jsonb
  ),
  '{section_subtitle_en}',
  '"Voices from our community"'::jsonb
)
WHERE section = 'guestbook';

-- Verify the updates
SELECT section, content FROM homepage_config ORDER BY display_order;
