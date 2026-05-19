# KVM4 Verify Server Deployment

KVM4 runs the persistent API and worker process behind `https://verify-api.zaoyoe.com`.
The public site still enters through `https://www.zaoyoe.com`, and Vercel rewrites
selected dynamic API paths to this service.

## What Gets Deployed

The deploy script builds a compact release from the latest clean `main`:

- `package.json`
- `package-lock.json`
- `api/`
- `server/`
- `js/`
- `scripts/`
- `docs/`
- `supabase/`

Secrets are not packaged. Runtime secrets stay on KVM4 in:

```text
/opt/zaoyoe-verify-server/.env
```

## Deploy

Run from local `main` after it has been fast-forwarded to `origin/main`:

```bash
npm run deploy:kvm4:verify
```

The script:

- refuses to deploy from non-`main`
- refuses to deploy if local `main` is not latest `origin/main`
- refuses to deploy with a dirty worktree
- creates a timestamped release under `/opt/zaoyoe-verify-server/releases`
- keeps the previous app path for rollback
- rebuilds `zaoyoe-verify-server`
- checks `http://127.0.0.1:3001/healthz`

Default SSH settings:

```bash
KVM4_HOST=76.13.188.218
KVM4_PORT=2222
KVM4_USER=root
KVM4_KEY=~/.ssh/hostinger_sub2api
KVM4_ROOT=/opt/zaoyoe-verify-server
```

Override any of these as environment variables when needed.

## Rollback

Rollback to the previous release:

```bash
npm run rollback:kvm4:verify
```

Rollback to a specific release id:

```bash
npm run rollback:kvm4:verify -- 20260519090000-abcdef12
```

## Verify

After deploy or rollback:

```bash
curl -fsS https://verify-api.zaoyoe.com/healthz
curl -fsS 'https://www.zaoyoe.com/api/payments/config?site=cn'
curl -fsS 'https://www.zaoyoe.com/api/shop/catalog?site=cn'
```

On KVM4:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
systemctl list-timers --all --no-pager | grep zaoyoe
```
