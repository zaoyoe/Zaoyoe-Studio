# NewAPI Support Gateway

`new.fatherkey.com` has its own NewAPI-native support drawer. It sends
authenticated dashboard messages to the existing Father Key Admin Studio inbox
through `POST /api/newapi-support`; the legacy customer-facing widget on
`www.fatherkey.com` is unchanged.

## Data Boundary

- NewAPI authenticates the signed-in dashboard user before making a server-side
  gateway request. Browser access tokens, cookies, API keys, and session IDs
  are never forwarded to the Father Key site.
- The two services share only `NEWAPI_SUPPORT_GATEWAY_HMAC_SECRET`. Each
  request is signed over its timestamp, nonce, and exact body. The Father Key
  gateway rejects expired, replayed, unsigned, and browser-authenticated
  requests.
- NewAPI conversations use opaque, database-generated `newapi:<uuid>` session
  identifiers. Do not replace them with IDs derived from the NewAPI user ID.
- `chat_messages.product = 'newapi'` is the tenant boundary. The existing
  `site = 'cn'` value exists only so the Admin Studio queue can display the
  conversation; it is not an authorization boundary for this integration.

## Required Configuration

Apply `supabase/migrations/20260909_add_newapi_support_gateway.sql` before
enabling the bridge. The migration adds the message metadata, opaque
conversation mapping, nonce replay table, and indexes used by the gateway.

Configure the same high-entropy value on both production services:

| Runtime | Variables |
| --- | --- |
| Vercel production for `www.fatherkey.com` | `NEWAPI_SUPPORT_GATEWAY_HMAC_SECRET` |
| KVM4 `/opt/sub2api/.env` | `NEWAPI_SUPPORT_GATEWAY_URL=https://www.fatherkey.com/api/newapi-support`, `NEWAPI_SUPPORT_GATEWAY_HMAC_SECRET=<same secret>` |
| KVM4 `/opt/sub2api/.env` (optional) | `NEWAPI_SUPPORT_GATEWAY_TIMEOUT_SECONDS=8` |

Do not expose this secret in a browser build, checked-in `.env` file, log, or
support transcript. The gateway is fail-closed: without the URL or secret,
the NewAPI drawer shows an unavailable state and no message is sent.

## Release Order

1. Apply the Supabase migration and verify the Admin Studio service role can
   read and write the new tables.
2. Add the HMAC secret to Vercel Production, then add the matching URL and
   secret to KVM4's `/opt/sub2api/.env`.
3. Merge the code through `main`; Vercel and the KVM4 Sub2API workflow deploy
   from `main` according to `AGENTS.md`.
4. Sign in to NewAPI, send a test message, confirm it appears in Admin Studio
   with the `NewAPI` source label, reply there, and confirm the reply appears
   in the NewAPI drawer.

## Operational Notes

- Preserve `product: 'newapi'` when an administrator replies. Otherwise the
  NewAPI gateway intentionally excludes the reply from its product-scoped
  message query.
- Admin Studio may display an external NewAPI username and email for routing,
  but must not assume that identity is a Father Key Supabase user.
- HMAC nonces are retained only long enough to cover the accepted clock-skew
  window and are opportunistically pruned by gateway traffic.
- History requests are capped at 50 messages per page and use a bounded 1 MiB
  response envelope; older messages are loaded through the next cursor.
- Administrator text and image replies keep the `newapi` product marker. NewAPI
  renders administrator HTTPS image replies as previews and treats other
  content as text.
