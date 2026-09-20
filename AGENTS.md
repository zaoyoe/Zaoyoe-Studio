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
10. SSH to KVM4 and confirm both verify and the NewAPI service-slot
    `.current-release` files equal the latest `main` commit, `/health` is
    healthy, and the NewAPI, PostgreSQL, and Redis containers are healthy. The
    removed `sub2api-legacy` bridge container must not be running.
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
`https://new.fatherkey.com/health` as the canonical route. Use manual KVM4
deploys only from latest clean `main` for emergency follow-up or workflow
recovery.

The NewAPI service-slot topology is:

- The public `sub2api` container and canonical `https://new.fatherkey.com` route
  run NewAPI from `services/newapi` with the local image
  `zaoyoe/newapi:local`. The public application no longer starts or routes to a
  legacy Sub2API bridge.
- NewAPI uses its own `NEWAPI_DB_NAME` database and `newapi_data` directory. All
  deploys and rollbacks must preserve the existing `postgres_data`,
  `redis_data`, and NewAPI `newapi_data` directories. The old `data` directory
  may remain on disk as inert historical data but is not mounted by NewAPI.
- Production must keep using the repository-level
  `deploy/kvm4/docker-compose.sub2api.yml`. Do not switch the public service to
  a legacy Sub2API image or re-enable the removed bridge.

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

The removed `services/sub2api` source and bridge are not deployment
dependencies. The sidebar brand/logo and public home logo must still link to
`https://www.fatherkey.com/` for the China/domestic site and
`https://www.zaoyoe.xyz/` for the international site. Regular users must retain
`返回主站充值` / `Recharge on main site`.

## Guest Shop Deployment Rules

游客现金直付购买的代码发布仍必须走最新 `main`，但 **发布不等于启用游客商品**。
游客购买 API、webhook 和 worker 跑在 KVM4 Verify Server；Vercel 生产只托管前端，
并把 `/api/shop/:path*` 反代到 `https://verify-api.fatherkey.com/api/shop/:path*`。

When the user asks Codex to deploy guest-shop related changes:

1. Work only on `codex/guest-shop-cash-purchase` or a later dedicated guest-shop
   branch. Do not stack this work onto an already-merged layout/UI branch.
2. Do not run `npx vercel deploy --prod` from a feature branch, `codex/*`
   branch, or any branch other than latest `main`.
3. Push the current branch, create or update a PR into `main`, and merge only
   after checks are acceptable.
4. Let the Vercel Git integration deploy `main`. Never treat a preview or
   feature-branch deployment as production.
5. Verify the three existing production chains:
   - Vercel production alias `https://www.fatherkey.com` is `Ready`
   - GitHub Actions `Deploy KVM4 Verify Server` succeeds
   - GitHub Actions `Deploy KVM4 Sub2API` succeeds
6. SSH to KVM4 and confirm verify and NewAPI `.current-release` equal the
   latest `main` commit, `/health` is healthy, and required containers are
   healthy.
7. Guest-shop extra chain, only after verify is on that commit:
   - `npm run readiness:guest-shop -- --env-file server/.env.production --fail-on-invalid`
   - Worker installer uses canonical root `/opt/zaoyoe-verify-server`
   - Guest-shop secrets stay in `/opt/zaoyoe-verify-server/.env` with mode `0600`.
     After adding or rotating `GUEST_SHOP_*` keys, pause the KVM4 health
     watchdog and recreate verify-server so compose `env_file` is reloaded:
     `cd /opt/zaoyoe-verify-server && docker compose up -d --no-deps --force-recreate --no-build verify-server`
     Then confirm `/healthz` and start the watchdog again. Do not use
     `docker restart`; it will not reread `env_file`.
   - Never print secret values. Never reuse `CRON_SECRET` or
     `SUPABASE_SERVICE_ROLE_KEY` for guest-shop peppers or the worker secret.
   - Compact verify images may omit `deploy/kvm4/guest-shop-worker/*`. That is
     not a start failure; the host installer lands the systemd units.
   - Do not start the timer until secrets, port and health checks are confirmed
   - Confirm `systemctl status zaoyoe-guest-shop-worker.timer` and recent
     `journalctl` evidence when the launch checklist actually requires the
     worker to run
8. Report in Chinese with four chains when guest-shop code is in the release:
   Vercel production, KVM4 Verify Server, KVM4 Sub2API, KVM4 guest-shop worker.

Hard prohibitions:

- Do not enable guest products, guest SKUs, or the guest purchase switch as
  part of a deploy.
- Do not execute SQL during deploy. Codex never executes SQL; new SQL must be
  written to a file, given as an absolute path, and left for the user.
- Do not run the guest-shop worker installer before the matching `main` commit
  is live on KVM4 Verify Server.
- Do not pass a custom `--root` / `KVM4_ROOT` to the worker installer.
- Do not treat `docker restart zaoyoe-verify-server` or
  `docker compose restart` as a secret reload. Compose `env_file` is only
  reread by `docker compose up -d --no-deps --force-recreate --no-build verify-server`.
- Do not print `GUEST_SHOP_*` values, claim tokens, card secrets, or recovery
  codes in logs, journal, chat, or deploy output.
- Do not reuse `CRON_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` as a guest-shop
  pepper or worker secret.
- Do not treat automated tests, default readiness exit `0`, or a successful
  three-chain deploy as permission to open guest checkout.
- `--fail-on-not-ready` returning `3` is the expected fail-closed result until
  its applicable sandbox, database, worker and manual evidence is archived. Do
  not bypass it with `|| true`. This aggregate result does not block a
  default-off production deploy, and a disabled optional feature does not block
  a CN, original-price, quantity-one SKU; it blocks enabling the capability to
  which the missing evidence belongs.
- Rollback of guest checkout is closing the guest product/SKU switch, not a
  database rollback and not a Vercel-only rollback.

Canonical guest-shop deploy prompt:

> 推送并完整部署游客购买相关改动。请严格按 AGENTS.md：从专用游客购买分支创建/更新 PR 到 main，检查通过后合并；不要从功能分支手动 vercel prod deploy。合并后必须验证 Vercel production Ready、Deploy KVM4 Verify Server、Deploy KVM4 Sub2API，并 SSH 确认 verify/sub2api 的 .current-release 等于 main 最新 commit。verify 发布成功后才能安装或启动 KVM4 guest-shop worker。部署过程不得执行 SQL，也不得打开游客商品。最后用中文汇报四条链路结果。

Canonical guest-shop enablement is a separate later step in
`docs/guest-purchase-task-2.0.md` (the file currently carries the Task 2.1
content version for compatibility). The old Task 2.0 percentage and A-J matrix
are frozen historical evidence: they do not block a default-off Task 2.1
deploy. Enabling a selected SKU requires the direct, feature-scoped safety gate
in Task 2.1 §61.9, an operator review of that exact product/SKU, a successful
production deploy, and the user's explicit approval. Unrelated historical
payment cases and disabled future features are not implicit prerequisites.
Deployment success alone still never enables a guest product.

See also:

- `docs/vercel-release-checklist.md` §1.1：游客购买必须走专用分支；禁止功能分支 prod deploy
- `docs/kvm4-verify-server-deploy.md` Guest Shop Worker：worker 只能在 verify 发布对应 commit 后安装；改 `.env` 后必须 `--force-recreate` 重建容器以重载 `env_file`；禁止自定义 root；部署不执行 SQL
- `docs/guest-shop-payment-fulfillment-runbook.md`：发布不等于启用，密钥重建步骤，以及后台退款/补发/解锁操作
