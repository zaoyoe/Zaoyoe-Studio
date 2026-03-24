## Summary

- What changed:
- Why:

## Risk

- [ ] Low
- [ ] Medium
- [ ] High

## Release Checklist

- [ ] I ran `npm run test:security`
- [ ] If this PR touches payments / auth / production config, I also ran the needed preflight checks
- [ ] If this PR adds files under `supabase/migrations/`, I listed them below and marked whether they are already applied
- [ ] I understand `main` is the production release branch
- [ ] I am not relying on `Preview -> Promote to Production` as the normal release path

## SQL / Migration

- [ ] No new SQL migrations
- [ ] New migrations in this PR:
  - 
- [ ] These migrations are already applied to the target database
- [ ] These migrations still need manual execution before production deploy

## Post-Merge Verification

- [ ] Confirm Vercel `Production` commit matches latest `main`
- [ ] If this PR touches payments, verify `/api/payments/config` and the admin payments dashboard after deploy

## Notes

- Extra rollout steps:
- Follow-up items:
