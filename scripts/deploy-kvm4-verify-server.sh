#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KVM4_HOST="${KVM4_HOST:-76.13.188.218}"
KVM4_PORT="${KVM4_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-$HOME/.ssh/hostinger_sub2api}"
KVM4_ROOT="${KVM4_ROOT:-/opt/zaoyoe-verify-server}"
KEEP_RELEASES="${KEEP_RELEASES:-8}"
DRY_RUN=0

PACKAGE_PATHS=(
  package.json
  package-lock.json
  api
  server
  js
  scripts
  docs
  supabase
)

usage() {
  cat <<'EOF'
Usage: scripts/deploy-kvm4-verify-server.sh [options]

Deploy the verify API service to Hostinger KVM4 from the latest clean main.

Options:
  --dry-run       Build the local release archive without uploading.
  --host HOST     SSH host. Default: KVM4_HOST or 76.13.188.218
  --port PORT     SSH port. Default: KVM4_PORT or 2222
  --user USER     SSH user. Default: KVM4_USER or root
  --key PATH      SSH private key. Default: KVM4_KEY or ~/.ssh/hostinger_sub2api
  --root PATH     Remote app root. Default: KVM4_ROOT or /opt/zaoyoe-verify-server
EOF
}

die() {
  echo "deploy-kvm4-verify-server: $*" >&2
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
      KVM4_ROOT="${2:-}"
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

[[ -f "$KVM4_KEY" ]] || die "SSH key not found: $KVM4_KEY"
[[ -f deploy/kvm4/verify-server.Dockerfile ]] || die "missing deploy/kvm4/verify-server.Dockerfile"
[[ -f deploy/kvm4/docker-compose.verify-server.yml ]] || die "missing deploy/kvm4/docker-compose.verify-server.yml"

current_branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$current_branch" == "main" ]] || die "deploys must run from main, current branch is $current_branch"

git fetch origin main >/dev/null
head_sha="$(git rev-parse HEAD)"
origin_sha="$(git rev-parse origin/main)"
[[ "$head_sha" == "$origin_sha" ]] || die "local main is not the latest origin/main"

if [[ -n "$(git status --porcelain)" ]]; then
  die "working tree must be clean before deploying"
fi

for path in "${PACKAGE_PATHS[@]}"; do
  [[ -e "$path" ]] || die "missing package path: $path"
done

short_sha="$(git rev-parse --short=8 HEAD)"
release_id="$(date -u +%Y%m%d%H%M%S)-$short_sha"
tmp_dir="$(mktemp -d)"
archive_path="$tmp_dir/zaoyoe-verify-$release_id.tar.gz"
trap 'rm -rf "$tmp_dir"' EXIT

echo "Creating release archive $release_id"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$archive_path" "${PACKAGE_PATHS[@]}"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Dry run complete: $archive_path"
  tar -tzf "$archive_path" | sed -n '1,40p'
  exit 0
fi

ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT")
scp_opts=(-i "$KVM4_KEY" -P "$KVM4_PORT")
remote="$KVM4_USER@$KVM4_HOST"
remote_tmp="/tmp/zaoyoe-verify-$release_id"

echo "Uploading release to $remote:$KVM4_ROOT"
ssh "${ssh_opts[@]}" "$remote" "mkdir -p '$remote_tmp'"
scp "${scp_opts[@]}" "$archive_path" "$remote:$remote_tmp/app.tar.gz"
scp "${scp_opts[@]}" deploy/kvm4/verify-server.Dockerfile "$remote:$remote_tmp/Dockerfile"
scp "${scp_opts[@]}" deploy/kvm4/docker-compose.verify-server.yml "$remote:$remote_tmp/docker-compose.yml"

echo "Activating release on KVM4"
ssh "${ssh_opts[@]}" "$remote" \
  "KVM4_ROOT='$KVM4_ROOT' RELEASE_ID='$release_id' KEEP_RELEASES='$KEEP_RELEASES' REMOTE_TMP='$remote_tmp' bash -s" <<'REMOTE'
set -Eeuo pipefail

die() {
  echo "remote deploy: $*" >&2
  exit 1
}

healthcheck() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 5 http://127.0.0.1:3001/healthz >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

[[ -n "${KVM4_ROOT:-}" ]] || die "KVM4_ROOT missing"
[[ -n "${RELEASE_ID:-}" ]] || die "RELEASE_ID missing"
[[ -n "${REMOTE_TMP:-}" ]] || die "REMOTE_TMP missing"
[[ -f "$KVM4_ROOT/.env" ]] || die "$KVM4_ROOT/.env missing"
[[ -f "$REMOTE_TMP/app.tar.gz" ]] || die "release archive missing"

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

  echo "Pausing KVM4 watchdog during deploy"
  systemctl stop "$WATCHDOG_TIMER" "$WATCHDOG_SERVICE" >/dev/null 2>&1 || true
fi

mkdir -p "$KVM4_ROOT/releases" "$KVM4_ROOT/backups"
release_root="$KVM4_ROOT/releases/$RELEASE_ID"
release_app="$release_root/app"
mkdir -p "$release_app"

tar -xzf "$REMOTE_TMP/app.tar.gz" -C "$release_app"
install -o root -g root -m 0644 "$REMOTE_TMP/Dockerfile" "$release_root/Dockerfile"
install -o root -g root -m 0644 "$REMOTE_TMP/docker-compose.yml" "$release_root/docker-compose.yml"
cp -a "$KVM4_ROOT/.env" "$KVM4_ROOT/backups/env.$RELEASE_ID.bak"

previous_app=""
if [[ -L "$KVM4_ROOT/app" ]]; then
  previous_app="$(readlink -f "$KVM4_ROOT/app" || true)"
elif [[ -d "$KVM4_ROOT/app" ]]; then
  previous_app="$KVM4_ROOT/releases/pre-managed-$RELEASE_ID/app"
  mkdir -p "$(dirname "$previous_app")"
  mv "$KVM4_ROOT/app" "$previous_app"
fi

ln -sfn "$release_app" "$KVM4_ROOT/app"
install -o root -g root -m 0644 "$release_root/Dockerfile" "$KVM4_ROOT/Dockerfile"
install -o root -g root -m 0644 "$release_root/docker-compose.yml" "$KVM4_ROOT/docker-compose.yml"

cd "$KVM4_ROOT"
if ! docker compose up -d --build --force-recreate verify-server; then
  if [[ -n "$previous_app" && -d "$previous_app" ]]; then
    echo "Build/start failed; rolling back to $previous_app" >&2
    ln -sfn "$previous_app" "$KVM4_ROOT/app"
    docker compose up -d --build --force-recreate verify-server || true
  fi
  exit 1
fi

if ! healthcheck; then
  if [[ -n "$previous_app" && -d "$previous_app" ]]; then
    echo "Healthcheck failed; rolling back to $previous_app" >&2
    ln -sfn "$previous_app" "$KVM4_ROOT/app"
    docker compose up -d --build --force-recreate verify-server || true
    healthcheck || true
  fi
  exit 1
fi

printf '%s\n' "$RELEASE_ID" > "$KVM4_ROOT/.current-release"
if [[ -n "$previous_app" ]]; then
  printf '%s\n' "$previous_app" > "$KVM4_ROOT/.previous-app"
fi

docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'NAMES|zaoyoe-verify-server'
curl -fsS http://127.0.0.1:3001/healthz
REMOTE

echo
echo "KVM4 release deployed: $release_id"
