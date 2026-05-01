# Wallet and Shop Bilingual Plan

## Current Audit

- Wallet modal still had hardcoded Chinese in coupon cards, custom recharge, check-in, affiliate stats/journey, toasts, and some order record labels.
- Shop purchase confirmation still used Chinese coupon details in the discount benefit label, stacking rule, price waterfall, and coupon asset cards.
- Wallet order history used `shop_orders.snapshot_product_name` only, so English mode could still show Chinese product names even when `shop_products.name_en` existed.
- Discount asset API returns useful semantic fields (`discount_type`, `discount_value`, `scope_type`, `source_channel`, product ids) plus Chinese display labels. The frontend should localize from semantic fields instead of trusting Chinese labels in English mode.

## Hardcoded In Language Packs

Use `lang/en.json` and `lang/zh.json` for stable UI chrome:

- Wallet navigation, balance labels, records filters, card/coupon labels, card states, delete confirmations.
- Custom recharge title, placeholders, validation messages, pending/success/failure toasts.
- Check-in calendar labels, weekday names, make-up confirmation, reward toasts.
- Affiliate dashboard metrics, stage labels, member journey labels, default poster template names.
- Shop checkout labels: discount, price waterfall, stacking policy, claim/apply button states, unavailable-coupon messages.

## Reuse Existing Bilingual Data

Use stored bilingual columns that are already produced or managed by admin tooling:

- `shop_products.name_en` for wallet order records, coupon scoped products, and shop cards.
- `shop_products.description_en`, `purchase_notes_en`, and `usage_instructions_en` for product detail and order guidance.
- Prompt bilingual fields (`title_en`, `title_zh`, descriptions) for prompt-related history and search where available.
- AI-generated guidance that has already been reviewed and stored should be read from the DB and cached, not regenerated during customer checkout.

## AI Translation And Backfill

Use AI only for editable business content that lacks bilingual fields or has stale translations:

- Product names, descriptions, purchase notes, and usage instructions that still contain CJK in English mode.
- Affiliate poster marketing copy and configurable campaign copy if admins want polished English versions.
- Prompt titles/descriptions and long-form resource copy in migration/admin batch jobs.

Do not call AI during normal wallet/shop rendering. Run translation from admin tools or migration scripts, save the reviewed result, then let the frontend reuse it.

## Never AI-Translate

- User secrets, card contents, inventory payloads, account emails, order IDs, discount codes, payment provider names, and system error identifiers.
- User-entered search text or ticket descriptions.
- Numeric settlement data, points, prices, dates, and coupon code values.

## Rollout Checks

- English mode should show no Chinese in wallet card details, custom recharge, records product names when `name_en` exists, invite overview, and check-in UI.
- Chinese mode should preserve existing wording and fallbacks.
- Backend wallet records should include `snapshot_product_name_en`/`shop_product.name_en` without changing existing Chinese endpoint labels that tests and admin views rely on.
