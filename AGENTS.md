# Agent Deployment Rules

Production deploys must only come from the latest `main`.

When the user asks Codex to deploy:

1. Do not run `npx vercel deploy --prod` from a feature branch, `codex/*` branch, or any branch other than `main`.
2. Push the current branch to GitHub.
3. Create or update a pull request with `gh pr create` or `gh pr view`.
4. Merge the pull request with `gh pr merge` after checks are acceptable.
5. Let the Vercel Git integration deploy `main`.
6. Verify the production alias with `npx vercel inspect https://www.fatherkey.com`.
7. Verify Vercel production is `Ready`.
8. Verify the GitHub Actions workflow `Deploy KVM4 Verify Server` succeeds.
9. Verify the GitHub Actions workflow `Deploy KVM4 Sub2API` succeeds.
10. SSH to KVM4 and confirm both verify and the Sub2API service-slot
    `.current-release` files equal the latest `main` commit, `/health` is
    healthy, and the public NewAPI, private legacy bridge, PostgreSQL, and Redis
    containers are healthy.
11. Report the final result in Chinese with three deployment chains: Vercel
    production, KVM4 Verify Server, and KVM4 Sub2API.

Canonical full deploy prompt:

> 推送并完整部署。请严格按 AGENTS.md：创建/更新 PR 到 main，检查通过后合并；不要从功能分支手动 vercel prod deploy。合并后必须同时验证 Vercel production Ready、GitHub Actions 的 Deploy KVM4 Verify Server 成功、Deploy KVM4 Sub2API 成功，并 SSH 到 KVM4 确认 verify/sub2api 的 .current-release 都等于 main 最新 commit，/health 正常，docker ps healthy。最后用中文汇报三条链路结果。

Emergency rollback is allowed with `npx vercel rollback <deployment-url-or-id> --yes`.

The build command also blocks production builds when `VERCEL_ENV=production` and `VERCEL_GIT_COMMIT_REF` is not `main`.

KVM4 verify server deploys are automated from `main` by the GitHub Actions
workflow `Deploy KVM4 Verify Server`. After a PR merges into `main`, the
workflow runs `npm run deploy:kvm4:verify` and verifies the public routes. Use
manual KVM4 deploys only from latest clean `main` for emergency follow-up or
workflow recovery.

KVM4 Sub2API service-slot deploys are automated from `main` by the GitHub Actions
workflow `Deploy KVM4 Sub2API`. The workflow and `/opt/sub2api` names are stable
deployment identifiers; they no longer mean that legacy Sub2API is the public
application. After a PR merges into `main`, the workflow runs
`npm run deploy:kvm4:sub2api` and verifies
`https://new.fatherkey.com/health` as the canonical route and
`https://sub2api.fatherkey.com/health` as a temporary compatibility route. Use
manual KVM4 deploys only from latest clean `main` for emergency follow-up or
workflow recovery.

The phase-one Sub2API service-slot topology is:

- The public `sub2api` container and canonical `https://new.fatherkey.com` route
  run NewAPI from `services/newapi` with the local image
  `zaoyoe/newapi:local`. `https://sub2api.fatherkey.com` remains a temporary
  compatibility alias for existing clients and sessions; it is not the public
  product name.
- The `legacy-sub2api` service runs `zaoyoe/sub2api:legacy` only as a private,
  loopback/internal compatibility bridge for upstream account scheduling that
  has not yet moved to NewAPI. It must never receive public ingress.
- NewAPI uses its own `NEWAPI_DB_NAME` database and `newapi_data` directory. All
  deploys and rollbacks must preserve the existing `postgres_data`,
  `redis_data`, legacy `data`, and NewAPI `newapi_data` directories.
- Production must keep using the repository-level
  `deploy/kvm4/docker-compose.sub2api.yml`. Do not switch the public service back
  to a legacy Sub2API image. Do not remove the private bridge until all of its
  remaining scheduler responsibilities have verified NewAPI replacements.

NewAPI upstream updates must preserve the local regional-restriction security
customization. When updating `services/newapi` from upstream, do not blindly
overwrite this feature. Re-apply and verify controls that restrict only
new login-session creation, registration, OAuth new-account signup, the API key
page password confirmation, and API key creation. Do not add a site-wide
middleware or affect refresh, existing sessions, passkey enrollment, 2FA
management, or other authenticated access. The login check must run before a
new password, OAuth, WeChat, Telegram, passkey, or 2FA-completed session is
created. A VPN user remains allowed when the current request country is not
blocked. Unknown or unrecognized regions remain configurable and default to
allow unless the administrator explicitly selects deny. A regional-status
lookup failure must not turn into a client-side site-wide denial.

After every NewAPI upstream update, verify these local files or equivalent logic
still exist before deploy:

- `services/newapi/controller/regional_restriction.go`
- `services/newapi/controller/regional_restriction_test.go`
- `services/newapi/controller/secure_verification.go`
- `services/newapi/controller/api_key_password_confirmation_test.go`
- `services/newapi/controller/user.go`
- `services/newapi/controller/misc.go`
- `services/newapi/controller/oauth.go`
- `services/newapi/controller/wechat.go`
- `services/newapi/controller/token.go`
- `services/newapi/router/api-router.go`
- `services/newapi/i18n/keys.go`
- `services/newapi/i18n/locales/en.yaml`
- `services/newapi/i18n/locales/zh-CN.yaml`
- `services/newapi/i18n/locales/zh-TW.yaml`
- `services/newapi/model/option.go`
- `services/newapi/model/option_regional_restriction_test.go`
- `services/newapi/setting/system_setting/regional_restriction.go`
- `services/newapi/setting/system_setting/regional_restriction_test.go`
- `services/newapi/web/src/features/keys/api.ts`
- `services/newapi/web/src/features/keys/types.ts`
- `services/newapi/web/src/features/keys/index.tsx`
- `services/newapi/web/src/features/keys/components/api-keys-provider.tsx`
- `services/newapi/web/src/features/keys/components/api-keys-dialogs.tsx`
- `services/newapi/web/src/features/keys/components/api-keys-mutate-drawer.tsx`
- `services/newapi/web/src/features/keys/components/regional-restriction-gate.tsx`
- `services/newapi/web/src/features/keys/components/__tests__/api-keys-mutate-drawer.test.tsx`
- `services/newapi/web/src/features/keys/components/__tests__/regional-restriction-gate.test.tsx`
- `services/newapi/web/src/features/system-settings/security/index.tsx`
- `services/newapi/web/src/features/system-settings/security/section-registry.tsx`
- `services/newapi/web/src/features/system-settings/security/regional-restriction-section.tsx`
- `services/newapi/web/src/features/system-settings/types.ts`
- `services/newapi/web/src/i18n/languages.ts`
- `services/newapi/web/src/i18n/locales/en.json`
- `services/newapi/web/src/i18n/locales/zh.json`
- `services/newapi/web/src/i18n/locales/zh-TW.json`
- `services/newapi/web/src/lib/http-client.ts`
- `services/newapi/web/src/lib/server-error-message.ts`
- `services/newapi/cmd/sub2api-migrate/migration.go`
- `services/newapi/cmd/sub2api-migrate/migration_test.go`

The API key page confirmation copy must retain the original English wording,
including `API Key Use Confirmation` and the restricted-regions notice. After
re-applying an upstream update, run the focused Go and frontend tests for all
protected flows, validate the administrator configuration entry, and confirm
the English copy remains covered by a frontend contract test.

While the phase-one bridge remains, updates to `services/sub2api` must preserve
the private scheduler compatibility behavior and existing Father Key product
customizations so emergency rollback remains viable. The sidebar brand/logo and
public home logo must still link to `https://www.fatherkey.com/` for the
China/domestic site and `https://www.zaoyoe.xyz/` for the international site.
Regular users must retain `返回主站充值` / `Recharge on main site`. Preserve CC
Switch Claude model slot import parameters (`haikuModel`, `sonnetModel`,
`opusModel`), and keep request error detail modals defaulting to `all` while
upstream error detail modals default to `errors`. Legacy Sub2API deploy templates
keep the URL allowlist enabled by default. The production bridge image remains
`zaoyoe/sub2api:legacy`, and the bridge must stay inaccessible from the public
network.
