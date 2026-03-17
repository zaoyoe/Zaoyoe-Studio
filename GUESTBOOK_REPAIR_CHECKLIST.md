# Guestbook Repair Checklist

> Tracking file for the web guestbook remediation work.
> Mark completed items with `[x]` so progress stays visible after each fix.

## P0 - Broken Or Risky Paths

- [x] Fix admin guestbook field mapping in `admin-comments.js`
  - Current code reads `msg.message` and `msg.nickname`, but `guestbook_messages` now uses `content` and profile-based author data.
  - Goal: admin list shows correct message text, author, avatar, image, and like count.

- [x] Remove remaining LeanCloud/AV dependency from guestbook smart-scroll recovery
  - Current fallback path in `guestbook.js` still calls `AV.Query('Message'/'Comment'/'Like')`.
  - Goal: all guestbook read/write/recovery paths use Supabase only.

- [x] Repair realtime message insertion path
  - Current realtime formatter uses fields that do not match `createMessageCard()`, and references stale insertion hooks/selectors.
  - Goal: new remote messages insert correctly without reload and without broken author/avatar rendering.

- [x] Unify comment/reply immediate insertion behavior with the main renderer
  - Current `insertCommentToDOM()` / `insertReplyToDOM()` manually build DOM and can drift from `createMessageCard()`.
  - Goal: optimistic UI stays visually and structurally consistent with full reload render.

## P1 - Slow Loading And Perceived Performance

- [x] Create a dedicated `guestbook_prefetch` producer before entering the guestbook page
  - Right now `loadGuestbookMessages()` can consume `sessionStorage.guestbook_prefetch`, but no matching producer was found for normal guestbook navigation.
  - Goal: prefetch guestbook RPC payload on hover/touch/click from homepage or nav, then render instantly on entry.

- [x] Reduce guestbook page boot cost by deferring non-critical scripts
  - Candidates include announcement/chat/supportive UI scripts that do not affect first message paint.
  - Goal: first contentful render is not blocked by unrelated widgets.

- [x] Audit synchronous script tags on `guestbook.html`
  - Several scripts are loaded without `defer`, including the Supabase CDN, `supabase-client.js`, `smooth-scroll.js`, `announcement-loader.js`, and the chat widget script.
  - Goal: keep only true boot-critical code on the critical path.

- [x] Start guestbook boot as soon as deferred scripts are ready
  - Previous `guestbook.js` waited for `DOMContentLoaded`, which delayed message loading until every deferred page script finished executing.
  - Goal: let the guestbook page start loading data immediately after its own prerequisites are available.

- [x] Delay non-essential realtime setup until after first paint
  - Current page enables realtime shortly after boot from both `guestbook.js` and `supabase-guestbook-functions.js`.
  - Goal: prioritize initial content render, then attach realtime subscriptions.

- [x] Shorten the auth/session wait path for anonymous visitors
  - Current guestbook load path calls auth APIs even when the user may only be browsing.
  - Goal: initial public read path should not wait on avoidable auth work.

- [ ] Add lightweight performance instrumentation for guestbook load stages
  - Measure: HTML ready, Supabase ready, RPC resolved, first batch rendered, skeleton hidden, realtime attached.
  - Goal: make future slowdowns measurable instead of relying on feel.

## P2 - Maintainability And UX Stability

- [x] Move guestbook page overrides out of the large inline `<style>` block in `guestbook.html`
  - Goal: consolidate guestbook styles into one source of truth and reduce cascade fights.

- [ ] Reduce duplicate "force override" CSS around guestbook/comment composer
  - Goal: replace emergency `!important` patches with clearer component-level styles.

- [ ] Add keyboard/accessibility support for clickable comment items
  - Goal: reply interactions should be available through keyboard and have proper semantics.

- [ ] Add `prefers-reduced-motion` handling for entry, hover, and highlight effects
  - Goal: keep the page polished without forcing motion-heavy behavior on every user.

- [ ] Clean out clearly deprecated guestbook code paths and dead compatibility helpers
  - Goal: shrink the surface area before adding new features.

## Expected Wins

- Faster first render of the guestbook page
- Lower chance of realtime and edge-path bugs
- Cleaner admin moderation data
- Easier future iteration on UI without regression-prone overrides
