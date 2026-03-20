# Payment Ops Checklist

## Must Verify After Deploy

1. Use a real admin account to open `/admin-studio.html`, switch to `支付对账`, and confirm:
   - Overview cards load normally
   - Recent anomalies list renders
   - Recent orders table renders
   - Test data cleanup preview loads

2. Use a normal non-admin account to open the same `支付对账` module and confirm:
   - The page shows a front-end access denied state
   - The API does not expose payment data

3. Use `https://www.zaoyoe.com` for the full login flow and confirm:
   - Google login completes on `www`
   - Session persists after refresh
   - Wallet recharge and query flow still work on `www`

## Security Follow-up

1. Rotate the Supabase `secret/service role` key because it was shared during debugging.
2. Update Vercel environment variables after rotation:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_CONFIG_ENCRYPTION_KEY` only if you intentionally rotate it too
3. Redeploy Vercel after key rotation.

## Payment Follow-up

1. Keep `模拟支付` only as a temporary bridge.
2. When HupiJiao is ready, implement:
   - real create order
   - signature verification
   - webhook ingestion
   - automatic crediting
3. After real payment is stable, disable `模拟支付`.

## Data Cleanup

1. Open `支付对账` and run the cleanup tool if test data is still present.
2. Verify that only:
   - `AUTO_CDX_*` orders
   - `codex.*@example.com` accounts
   were removed.
