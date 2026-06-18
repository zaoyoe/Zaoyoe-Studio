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
10. SSH to KVM4 and confirm both verify and Sub2API `.current-release` files
    equal the latest `main` commit, `/health` is healthy, and related
    `docker ps` containers are healthy.
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

KVM4 Sub2API deploys are automated from `main` by the GitHub Actions workflow
`Deploy KVM4 Sub2API`. After a PR merges into `main`, the workflow runs
`npm run deploy:kvm4:sub2api` and verifies `https://sub2api.fatherkey.com/health`.
Use manual Sub2API KVM4 deploys only from latest clean `main` for emergency
follow-up or workflow recovery. The deploy updates only the Sub2API app
container and must preserve the existing PostgreSQL and Redis data directories.

Sub2API upstream updates must preserve local security customizations. When
updating `services/sub2api` from upstream, do not blindly overwrite the local
regional restriction feature. Re-apply and verify the controls that restrict
only registration, OAuth new-account signup, API key page confirmation, and API
key creation. Do not block the whole site or existing login/session access.
VPN users must remain allowed when their current request IP is not detected as a
blocked country. Unknown region policy should remain configurable and default to
allow unless the admin setting explicitly changes it.

Sub2API upstream updates must also preserve local Father Key product
customizations. The sidebar brand/logo and public home logo must link back to
the main site: `https://www.fatherkey.com/` for the China/domestic site and
`https://www.zaoyoe.xyz/` for the international site. Regular users should keep
the sidebar brand hint `返回主站充值` / `Recharge on main site`. Preserve CC Switch
Claude model slot import parameters (`haikuModel`, `sonnetModel`, `opusModel`),
and keep request error detail modals defaulting to `all` while upstream error
detail modals default to `errors`. Sub2API deploy templates should keep the
local image `zaoyoe/sub2api:local` and URL allowlist default enabled (`true`);
production KVM4 deploys must continue using the repository-level
`deploy/kvm4/docker-compose.sub2api.yml`.

After every Sub2API upstream update, verify these local files or equivalent
logic still exist before deploy:

- `services/sub2api/backend/internal/handler/regional_restriction.go`
- `services/sub2api/backend/internal/handler/regional_restriction_test.go`
- `services/sub2api/backend/internal/handler/api_key_handler.go`
- `services/sub2api/backend/internal/handler/auth_handler.go`
- `services/sub2api/backend/internal/handler/auth_email_oauth.go`
- `services/sub2api/backend/internal/handler/auth_oauth_pending_flow.go`
- `services/sub2api/backend/internal/handler/auth_linuxdo_oauth.go`
- `services/sub2api/backend/internal/handler/auth_oidc_oauth.go`
- `services/sub2api/backend/internal/handler/auth_dingtalk_oauth.go`
- `services/sub2api/backend/internal/handler/auth_wechat_oauth.go`
- `services/sub2api/backend/internal/server/routes/user.go`
- `services/sub2api/backend/internal/server/api_contract_test.go`
- `services/sub2api/backend/internal/handler/admin/setting_handler.go`
- `services/sub2api/backend/internal/service/domain_constants.go`
- `services/sub2api/backend/internal/service/setting_service.go`
- `services/sub2api/backend/internal/service/settings_view.go`
- `services/sub2api/backend/internal/handler/dto/settings.go`
- `services/sub2api/frontend/src/views/admin/SettingsView.vue`
- `services/sub2api/frontend/src/views/user/KeysView.vue`
- `services/sub2api/frontend/src/views/HomeView.vue`
- `services/sub2api/frontend/src/components/layout/AppSidebar.vue`
- `services/sub2api/frontend/src/views/admin/ops/components/OpsErrorDetailsModal.vue`
- `services/sub2api/frontend/src/utils/ccswitchImport.ts`
- `services/sub2api/frontend/src/utils/__tests__/ccswitchImport.spec.ts`
- `services/sub2api/frontend/src/i18n/locales/en.ts`
- `services/sub2api/frontend/src/i18n/locales/zh.ts`
- `services/sub2api/frontend/src/api/keys.ts`
- `services/sub2api/frontend/src/api/admin/settings.ts`
- `services/sub2api/frontend/src/types/index.ts`
- `services/sub2api/deploy/docker-compose.local.yml`
- `services/sub2api/deploy/docker-compose.yml`

The API key page confirmation copy should remain the original English wording,
including `API Key Use Confirmation` and the restricted-regions notice. Run the
focused Go and frontend tests for these flows after re-applying upstream changes.
