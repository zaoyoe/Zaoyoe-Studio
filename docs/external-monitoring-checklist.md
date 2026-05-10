# External Monitoring Checklist

External monitoring is an optional enhancement for production diagnosis. It is not a runtime dependency: if Sentry, Axiom, Datadog, Log Drain, or a Supabase Pro add-on is missing or down, the site should keep using the existing app reads, polling fallbacks, and `ops_alert_jobs` notification queue.

## Current Baseline

- In-app alerts already flow through `ops_alert_jobs` and `ops_alert_job_attempts`.
- Admin Studio already exposes ops alert delivery health through the existing ops alert health endpoint.
- Supabase Pro Realtime should improve freshness, but Realtime and external monitors must stay fail-open.
- External tools should receive copies of logs/events; they should not sit on the critical path for payments, wallet balance, order state, uploads, or page rendering.

## Provider Setup

### Sentry

Use Sentry for frontend and server exception traces.

Recommended env:

```bash
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=
```

Keep the DSN optional. If it is missing, runtime error handling should continue to use console logging and existing Admin Studio alerts.

### Axiom

Use Axiom for searchable structured logs when you want fast incident queries.

Recommended env:

```bash
AXIOM_TOKEN=
AXIOM_DATASET=zaoyoe-production
```

Configure both token and dataset together. A half-configured Axiom setup should be caught by readiness, not by user-facing runtime failures.

### Datadog

Use Datadog when you want broader infrastructure metrics and dashboards.

Recommended env:

```bash
DATADOG_API_KEY=
DATADOG_SITE=datadoghq.com
```

`DATADOG_SITE` can be changed for EU/US regional accounts. Do not send payment secrets, Supabase service-role keys, auth tokens, or raw webhook payload secrets.

### Log Drain

Use platform Log Drain for raw platform logs. Some platforms configure this outside app env, so readiness supports a manual marker.

Optional readiness env:

```bash
EXTERNAL_LOG_DRAIN_CONFIGURED=true
```

If a URL-based drain is used, it must be HTTPS:

```bash
LOG_DRAIN_URL=https://logs.example.com/ingest
```

## Supabase Pro Fallback Rule

Supabase Pro Realtime and Log Drain can improve freshness and visibility, but the application must not assume they are always available. If Pro expires, Realtime limits are hit, or external monitors reject traffic:

1. Wallet, orders, notifications, and admin panels fall back to existing reads or polling.
2. Modals should render cached/loaded data instead of waiting on a Realtime subscription.
3. `ops_alert_jobs` remains the internal source of alert delivery state.
4. External logging failures should be recorded as diagnostics only, never thrown into user flows.

## Verification

Run the non-blocking readiness check:

```bash
npm run readiness:external-monitoring
```

Run strict mode before enabling a provider:

```bash
node scripts/external-monitoring-readiness.js --fail-on-invalid
```

Expected behavior:

- No provider configured: PASS, because external monitoring is optional.
- Fully configured provider: PASS and listed under configured providers.
- Half-configured provider: WARN by default; exits non-zero only with `--fail-on-invalid`.
- Missing Supabase Pro or Realtime: not tested here as a blocker; app fallback behavior is covered by Realtime fallback tests.

## Rollout Order

1. Keep current Admin Studio + `ops_alert_jobs` baseline enabled.
2. Enable one external provider at a time.
3. Run strict readiness for that provider.
4. Send one test alert/event.
5. Confirm external delivery without changing the user-facing critical path.
