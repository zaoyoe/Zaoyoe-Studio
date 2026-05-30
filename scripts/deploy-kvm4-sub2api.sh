#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KVM4_HOST="${KVM4_HOST:-76.13.188.218}"
KVM4_PORT="${KVM4_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-$HOME/.ssh/hostinger_sub2api}"
KVM4_SUB2API_ROOT="${KVM4_SUB2API_ROOT:-/opt/sub2api}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: scripts/deploy-kvm4-sub2api.sh [options]

Deploy Sub2API to Hostinger KVM4 from the latest clean main.

Options:
  --dry-run       Build the local release archive without uploading.
  --host HOST     SSH host. Default: KVM4_HOST or 76.13.188.218
  --port PORT     SSH port. Default: KVM4_PORT or 2222
  --user USER     SSH user. Default: KVM4_USER or root
  --key PATH      SSH private key. Default: KVM4_KEY or ~/.ssh/hostinger_sub2api
  --root PATH     Remote app root. Default: KVM4_SUB2API_ROOT or /opt/sub2api
EOF
}

die() {
  echo "deploy-kvm4-sub2api: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --host)
      KVM4_HOST="${2:-}"
      shift 2
      ;;
    --port)
      KVM4_PORT="${2:-}"
      shift 2
      ;;
    --user)
      KVM4_USER="${2:-}"
      shift 2
      ;;
    --key)
      KVM4_KEY="${2:-}"
      shift 2
      ;;
    --root)
      KVM4_SUB2API_ROOT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

cd "$ROOT_DIR"

[[ -d services/sub2api ]] || die "missing services/sub2api"
[[ -f services/sub2api/Dockerfile ]] || die "missing services/sub2api/Dockerfile"
[[ -f services/sub2api/deploy/docker-compose.local.yml ]] || die "missing services/sub2api/deploy/docker-compose.local.yml"
[[ -f deploy/kvm4/docker-compose.sub2api.yml ]] || die "missing deploy/kvm4/docker-compose.sub2api.yml"

current_branch="$(git rev-parse --abbrev-ref HEAD)"
head_sha="$(git rev-parse HEAD)"

if [[ "$DRY_RUN" != "1" ]]; then
  [[ -f "$KVM4_KEY" ]] || die "SSH key not found: $KVM4_KEY"
  [[ "$current_branch" == "main" ]] || die "deploys must run from main, current branch is $current_branch"

  git fetch origin main >/dev/null
  origin_sha="$(git rev-parse origin/main)"
  [[ "$head_sha" == "$origin_sha" ]] || die "local main is not the latest origin/main"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  die "working tree must be clean before deploying"
fi

short_sha="$(git rev-parse --short=8 HEAD)"
release_id="$(date -u +%Y%m%d%H%M%S)-$short_sha"
tmp_dir="$(mktemp -d)"
release_dir="$tmp_dir/release"
archive_path="$tmp_dir/zaoyoe-sub2api-$release_id.tar.gz"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$release_dir"
echo "Creating Sub2API release archive $release_id"
git archive --format=tar HEAD services/sub2api | tar -xf - -C "$release_dir"
mv "$release_dir/services/sub2api" "$release_dir/sub2api"
rmdir "$release_dir/services"

COPYFILE_DISABLE=1 tar --no-xattrs -C "$release_dir" -czf "$archive_path" sub2api

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Dry run complete: $archive_path"
  tar -tzf "$archive_path" | sed -n '1,60p'
  exit 0
fi

ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT")
scp_opts=(-i "$KVM4_KEY" -P "$KVM4_PORT")
remote="$KVM4_USER@$KVM4_HOST"
remote_tmp="/tmp/zaoyoe-sub2api-$release_id"

echo "Uploading Sub2API release to $remote:$KVM4_SUB2API_ROOT"
ssh "${ssh_opts[@]}" "$remote" "mkdir -p '$remote_tmp'"
scp "${scp_opts[@]}" "$archive_path" "$remote:$remote_tmp/app.tar.gz"
scp "${scp_opts[@]}" deploy/kvm4/docker-compose.sub2api.yml "$remote:$remote_tmp/docker-compose.local.yml"

echo "Activating Sub2API release on KVM4"
ssh "${ssh_opts[@]}" "$remote" \
  "KVM4_SUB2API_ROOT='$KVM4_SUB2API_ROOT' RELEASE_ID='$release_id' RELEASE_COMMIT='$head_sha' KEEP_RELEASES='$KEEP_RELEASES' REMOTE_TMP='$remote_tmp' bash -s" <<'REMOTE'
set -Eeuo pipefail

die() {
  echo "remote sub2api deploy: $*" >&2
  exit 1
}

healthcheck() {
  for _ in $(seq 1 45); do
    if curl -fsS --max-time 5 http://127.0.0.1:8080/health >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

container_health() {
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || true
}

ensure_dependency_healthy() {
  local container="$1"
  local service="$2"

  local state
  state="$(container_health "$container")"
  if [[ "$state" == "healthy" || "$state" == "running" || "$state" == "starting" ]]; then
    return 0
  fi

  echo "Dependency $container is $state; asking compose to start $service"
  docker compose --env-file .env -f docker-compose.local.yml up -d "$service"
}

[[ -n "${KVM4_SUB2API_ROOT:-}" ]] || die "KVM4_SUB2API_ROOT missing"
[[ -n "${RELEASE_ID:-}" ]] || die "RELEASE_ID missing"
[[ -n "${RELEASE_COMMIT:-}" ]] || die "RELEASE_COMMIT missing"
[[ -n "${REMOTE_TMP:-}" ]] || die "REMOTE_TMP missing"
[[ -f "$KVM4_SUB2API_ROOT/.env" ]] || die "$KVM4_SUB2API_ROOT/.env missing"
[[ -f "$REMOTE_TMP/app.tar.gz" ]] || die "release archive missing"
[[ -f "$REMOTE_TMP/docker-compose.local.yml" ]] || die "compose file missing"

WATCHDOG_TIMER="zaoyoe-kvm4-health-watchdog.timer"
WATCHDOG_SERVICE="zaoyoe-kvm4-health-watchdog.service"
WATCHDOG_WAS_ACTIVE=0

restore_watchdog() {
  if [[ "$WATCHDOG_WAS_ACTIVE" == "1" ]]; then
    systemctl start "$WATCHDOG_TIMER" >/dev/null 2>&1 || true
  fi
}

cleanup_remote_tmp() {
  restore_watchdog
  rm -rf "$REMOTE_TMP"
}

trap cleanup_remote_tmp EXIT

if command -v systemctl >/dev/null 2>&1 && systemctl cat "$WATCHDOG_TIMER" >/dev/null 2>&1; then
  if systemctl is-active --quiet "$WATCHDOG_TIMER"; then
    WATCHDOG_WAS_ACTIVE=1
  fi

  echo "Pausing KVM4 watchdog during Sub2API deploy"
  systemctl stop "$WATCHDOG_TIMER" "$WATCHDOG_SERVICE" >/dev/null 2>&1 || true
fi

cd "$KVM4_SUB2API_ROOT"
[[ -f docker-compose.local.yml ]] || die "$KVM4_SUB2API_ROOT/docker-compose.local.yml missing"
[[ -d data ]] || die "$KVM4_SUB2API_ROOT/data missing"
[[ -d postgres_data ]] || die "$KVM4_SUB2API_ROOT/postgres_data missing"
[[ -d redis_data ]] || die "$KVM4_SUB2API_ROOT/redis_data missing"

mkdir -p releases backups
release_root="$KVM4_SUB2API_ROOT/releases/$RELEASE_ID"
release_src="$release_root/sub2api"
mkdir -p "$release_root"
tar -xzf "$REMOTE_TMP/app.tar.gz" -C "$release_root"
[[ -f "$release_src/Dockerfile" ]] || die "release Dockerfile missing"
install -o root -g root -m 0644 "$REMOTE_TMP/docker-compose.local.yml" "$release_root/docker-compose.local.yml"
printf '%s\n' "$RELEASE_COMMIT" > "$release_root/.commit"

cp -a "$KVM4_SUB2API_ROOT/.env" "$KVM4_SUB2API_ROOT/backups/env.$RELEASE_ID.bak"
cp -a "$KVM4_SUB2API_ROOT/docker-compose.local.yml" "$KVM4_SUB2API_ROOT/backups/docker-compose.local.$RELEASE_ID.bak"
previous_compose="$KVM4_SUB2API_ROOT/backups/docker-compose.local.$RELEASE_ID.bak"
previous_image="zaoyoe/sub2api:rollback-$RELEASE_ID"
if docker image inspect zaoyoe/sub2api:local >/dev/null 2>&1; then
  docker tag zaoyoe/sub2api:local "$previous_image"
fi

previous_src=""
if [[ -L "$KVM4_SUB2API_ROOT/src" ]]; then
  previous_src="$(readlink -f "$KVM4_SUB2API_ROOT/src" || true)"
elif [[ -d "$KVM4_SUB2API_ROOT/src" ]]; then
  previous_src="$KVM4_SUB2API_ROOT/releases/pre-managed-$RELEASE_ID/sub2api"
  mkdir -p "$(dirname "$previous_src")"
  mv "$KVM4_SUB2API_ROOT/src" "$previous_src"
fi

rollback() {
  if [[ -f "$previous_compose" ]]; then
    install -o root -g root -m 0644 "$previous_compose" "$KVM4_SUB2API_ROOT/docker-compose.local.yml"
  fi

  if [[ -n "$previous_src" && -d "$previous_src" ]]; then
    echo "Rolling back Sub2API source to $previous_src" >&2
    ln -sfn "$previous_src" "$KVM4_SUB2API_ROOT/src"
  fi

  if docker image inspect "$previous_image" >/dev/null 2>&1; then
    docker tag "$previous_image" zaoyoe/sub2api:local
  fi

  docker compose --env-file .env -f docker-compose.local.yml up -d --no-deps --force-recreate sub2api || true
  healthcheck || true
}

ln -sfn "$release_src" "$KVM4_SUB2API_ROOT/src"

if ! cmp -s "$release_root/docker-compose.local.yml" "$KVM4_SUB2API_ROOT/docker-compose.local.yml"; then
  echo "Updating Sub2API compose file"
  install -o root -g root -m 0644 "$release_root/docker-compose.local.yml" "$KVM4_SUB2API_ROOT/docker-compose.local.yml"
fi

ensure_dependency_healthy sub2api-postgres postgres
ensure_dependency_healthy sub2api-redis redis

echo "Building Sub2API image from $release_src"
export SUB2API_COMMIT="$RELEASE_COMMIT"
docker compose --env-file .env -f docker-compose.local.yml config >/dev/null
if ! docker compose --env-file .env -f docker-compose.local.yml build sub2api; then
  rollback
  exit 1
fi

echo "Recreating Sub2API app container only"
if ! docker compose --env-file .env -f docker-compose.local.yml up -d --no-deps --force-recreate sub2api; then
  rollback
  exit 1
fi

if ! healthcheck; then
  echo "Sub2API healthcheck failed" >&2
  docker compose --env-file .env -f docker-compose.local.yml logs --tail=160 sub2api >&2 || true
  rollback
  exit 1
fi

if [[ -n "$previous_src" ]]; then
  printf '%s\n' "$previous_src" > "$KVM4_SUB2API_ROOT/.previous-src"
fi
printf '%s\n' "$RELEASE_COMMIT" > "$KVM4_SUB2API_ROOT/.current-release"

find "$KVM4_SUB2API_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
  sort -rn |
  awk "NR > ${KEEP_RELEASES:-5} {print \$2}" |
  xargs -r rm -rf

docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'NAMES|sub2api'
curl -fsS http://127.0.0.1:8080/health
REMOTE

echo
echo "KVM4 Sub2API release deployed: $release_id"
