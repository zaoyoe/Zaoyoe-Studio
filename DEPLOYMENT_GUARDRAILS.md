# Deployment Guardrails

Production deploys must come from `main`.

## Safe Codex Flow

1. Make changes on a `codex/*` branch.
2. Push the branch to GitHub.
3. Open a pull request with `gh pr create`.
4. Merge it with `gh pr merge` after checks pass.
5. Let the Vercel Git integration deploy `main`.

Codex can do every step above from the CLI. No GitHub web click is required.

## Forbidden

Do not run `vercel deploy --prod` from a `codex/*` branch or any branch other than `main`.

The build command blocks non-`main` production builds as a last line of defense. This prevents a manual production deploy from aliasing an old feature-branch snapshot onto `www.zaoyoe.com`.

## Emergency Rollback

Use `vercel rollback <previous-production-url-or-deployment-id> --yes`, then confirm with:

```sh
vercel inspect https://www.zaoyoe.com
```
