# Agent Deployment Rules

Production deploys must only come from the latest `main`.

When the user asks Codex to deploy:

1. Do not run `npx vercel deploy --prod` from a feature branch, `codex/*` branch, or any branch other than `main`.
2. Push the current branch to GitHub.
3. Create or update a pull request with `gh pr create` or `gh pr view`.
4. Merge the pull request with `gh pr merge` after checks are acceptable.
5. Let the Vercel Git integration deploy `main`.
6. Verify the production alias with `npx vercel inspect https://www.zaoyoe.com`.

Emergency rollback is allowed with `npx vercel rollback <deployment-url-or-id> --yes`.

The build command also blocks production builds when `VERCEL_ENV=production` and `VERCEL_GIT_COMMIT_REF` is not `main`.

KVM4 verify server deploys are automated from `main` by the GitHub Actions
workflow `Deploy KVM4 Verify Server`. After a PR merges into `main`, the
workflow runs `npm run deploy:kvm4:verify` and verifies the public routes. Use
manual KVM4 deploys only from latest clean `main` for emergency follow-up or
workflow recovery.

KVM4 Sub2API deploys are automated from `main` by the GitHub Actions workflow
`Deploy KVM4 Sub2API`. After a PR merges into `main`, the workflow runs
`npm run deploy:kvm4:sub2api` and verifies `https://sub2api.zaoyoe.com/health`.
Use manual Sub2API KVM4 deploys only from latest clean `main` for emergency
follow-up or workflow recovery. The deploy updates only the Sub2API app
container and must preserve the existing PostgreSQL and Redis data directories.
