#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KVM4_HOST="${KVM4_HOST:-kvm4-origin.internal}"
KVM4_PORT="${KVM4_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-$HOME/.ssh/hostinger_sub2api}"
KVM4_KC_ROOT="${KVM4_KC_ROOT:-/opt/kc-pay-gpt}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
KVM4_SSH_ATTEMPTS="${KVM4_SSH_ATTEMPTS:-4}"
KVM4_SSH_RETRY_DELAY="${KVM4_SSH_RETRY_DELAY:-15}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: scripts/deploy-kvm4-kc-pay.sh [options]

Deploy KC-PAY-GPT into the Hostinger KVM4 service slot (/opt/kc-pay-gpt)
from the latest clean main.

Options:
  --dry-run       Build the local release archive without uploading.
  --host HOST     SSH host. Default: KVM4_HOST or kvm4-origin.internal
  --port PORT     SSH port. Default: KVM4_PORT or 2222
  --user USER     SSH user. Default: KVM4_USER or root
  --key PATH      SSH private key. Default: KVM4_KEY or ~/.ssh/hostinger_sub2api
  --root PATH     Remote app root. Default: KVM4_KC_ROOT or /opt/kc-pay-gpt
EOF
}

die() {
  echo "deploy-kvm4-kc-pay: $*" >&2
  exit 1
}

retry_command() {
  local attempt=1
  local status=0

  while true; do
    "$@" && return 0
    status=$?

    if [[ "$status" != "255" ]] || (( attempt >= KVM4_SSH_ATTEMPTS )); then
      return "$status"
    fi

    echo "SSH transport failed with status 255; retrying in ${KVM4_SSH_RETRY_DELAY}s ($attempt/$KVM4_SSH_ATTEMPTS): $*" >&2
    sleep "$KVM4_SSH_RETRY_DELAY"
    attempt=$((attempt + 1))
  done
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
      KVM4_KC_ROOT="${2:-}"
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

[[ -d services/kc-pay-gpt ]] || die "missing services/kc-pay-gpt"
[[ -f services/kc-pay-gpt/Dockerfile ]] || die "missing services/kc-pay-gpt/Dockerfile"
[[ -f services/kc-pay-gpt/server.js ]] || die "missing services/kc-pay-gpt/server.js"
[[ -f services/kc-pay-gpt/docker-compose.yml ]] || die "missing services/kc-pay-gpt/docker-compose.yml"

current_branch="$(git rev-parse --abbrev-ref HEAD)"
head_sha="$(git rev-parse HEAD)"

if [[ "$DRY_RUN" != "1" ]]; then
  [[ -f "$KVM4_KEY" ]] || die "SSH key not found: $KVM4_KEY"
  [[ "$current_branch" == "main" ]] || die "deploys must run from main, current branch is $current_branch"

  git fetch origin main >/dev/null
  origin_sha="$(git rev-parse origin/main)"
  [[ "$head_sha" == "$origin_sha" ]] || die "local main is not the latest origin/main"

  if [[ -n "$(git status --porcelain)" ]]; then
    die "working tree must be clean before deploying"
  fi
fi

short_sha="$(git rev-parse --short=8 HEAD)"
release_id="$(date -u +%Y%m%d%H%M%S)-$short_sha"
tmp_dir="$(mktemp -d)"
release_dir="$tmp_dir/release"
archive_path="$tmp_dir/zaoyoe-kc-pay-$release_id.tar.gz"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$release_dir"
echo "Creating KC-PAY-GPT release archive $release_id"
git archive --format=tar HEAD services/kc-pay-gpt | tar -xf - -C "$release_dir"
mv "$release_dir/services/kc-pay-gpt" "$release_dir/kc-pay-gpt"
rmdir "$release_dir/services"
printf '%s\n' "$head_sha" > "$release_dir/kc-pay-gpt/.release-commit"

COPYFILE_DISABLE=1 tar --no-xattrs -C "$release_dir/kc-pay-gpt" -czf "$archive_path" .

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Dry run complete: $archive_path"
  tar -tzf "$archive_path" | sed -n '1,60p'
  exit 0
fi

ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
scp_opts=(-i "$KVM4_KEY" -P "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
remote="$KVM4_USER@$KVM4_HOST"
remote_tmp="/tmp/zaoyoe-kc-pay-$release_id"

echo "Uploading KC-PAY-GPT release to $remote:$KVM4_KC_ROOT"
retry_command ssh "${ssh_opts[@]}" "$remote" "mkdir -p '$remote_tmp'"
retry_command scp "${scp_opts[@]}" "$archive_path" "$remote:$remote_tmp/app.tar.gz"

remote_script_path="$tmp_dir/activate-kc.sh"
cat > "$remote_script_path" <<'REMOTE'
set -Eeuo pipefail

die() {
  echo "remote KC deploy: $*" >&2
  exit 1
}

healthcheck() {
  for _ in $(seq 1 45); do
    if curl -fsS --max-time 5 http://127.0.0.1:3100/api/public/runtime >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

[[ -n "${KVM4_KC_ROOT:-}" ]] || die "KVM4_KC_ROOT missing"
[[ -n "${RELEASE_ID:-}" ]] || die "RELEASE_ID missing"
[[ -n "${RELEASE_COMMIT:-}" ]] || die "RELEASE_COMMIT missing"
[[ -n "${REMOTE_TMP:-}" ]] || die "REMOTE_TMP missing"
[[ -d "$KVM4_KC_ROOT" ]] || die "$KVM4_KC_ROOT directory does not exist"
[[ -f "$KVM4_KC_ROOT/.env" ]] || die "$KVM4_KC_ROOT/.env missing"
[[ -f "$KVM4_KC_ROOT/docker-compose.yml" ]] || die "$KVM4_KC_ROOT/docker-compose.yml missing"
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

  echo "Pausing KVM4 watchdog during KC deploy"
  systemctl stop "$WATCHDOG_TIMER" "$WATCHDOG_SERVICE" >/dev/null 2>&1 || true
fi

mkdir -p "$KVM4_KC_ROOT/backups"
backup_archive="$KVM4_KC_ROOT/backups/kc-pay-backup-$RELEASE_ID.tar.gz"

echo "Creating rollback backup: $backup_archive"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$backup_archive" \
  --exclude='backups' \
  --exclude='data' \
  --exclude='debug_screenshots' \
  --exclude='product_files' \
  --exclude='node_modules' \
  --exclude='.git' \
  -C "$KVM4_KC_ROOT" . 2>/dev/null || true

rollback() {
  echo "Rolling back KC deployment to $backup_archive" >&2
  if [[ -f "$backup_archive" ]]; then
    tar -xzf "$backup_archive" \
      --exclude='./.env' \
      --exclude='./docker-compose.yml' \
      --exclude='./data' \
      --exclude='./debug_screenshots' \
      --exclude='./product_files' \
      -C "$KVM4_KC_ROOT" || true
    cd "$KVM4_KC_ROOT"
    docker compose build --no-cache app || true
    docker compose up -d --no-deps --force-recreate app || true
  fi
}

# Extract new release while strictly protecting .env, host docker-compose.yml, data, debug_screenshots, product_files
echo "Extracting release files into $KVM4_KC_ROOT"
tar -xzf "$REMOTE_TMP/app.tar.gz" \
  --exclude='./.env' \
  --exclude='./docker-compose.yml' \
  --exclude='./data' \
  --exclude='./debug_screenshots' \
  --exclude='./product_files' \
  -C "$KVM4_KC_ROOT"

tar -xzf "$REMOTE_TMP/app.tar.gz" docker-compose.yml -O > "$KVM4_KC_ROOT/docker-compose.repo.yml" 2>/dev/null || true
printf '%s\n' "$RELEASE_COMMIT" > "$KVM4_KC_ROOT/.current-release"

cd "$KVM4_KC_ROOT"
echo "Rebuilding app container image without cache..."
if ! docker compose build --no-cache app; then
  rollback
  die "docker compose build --no-cache failed"
fi

echo "Recreating app container..."
if ! docker compose up -d --no-deps --force-recreate app; then
  rollback
  die "docker compose up failed"
fi

echo "Verifying local service health on 127.0.0.1:3100..."
if ! healthcheck; then
  docker compose logs --tail=100 app >&2 || true
  rollback
  die "KC local healthcheck failed"
fi

# Prune old backups keeping KEEP_RELEASES
find "$KVM4_KC_ROOT/backups" -mindepth 1 -maxdepth 1 -name "kc-pay-backup-*.tar.gz" -type f |
  sort -rn |
  awk "NR > ${KEEP_RELEASES:-5} {print \$1}" |
  xargs -r rm -f

app_container="$(docker ps --filter "name=kc.*app" --format "{{.Names}}" | head -n 1)"
app_container="${app_container:-kc-pay-gpt-app}"

echo "Checking host public/admin.html for Touch ID..."
if ! grep -q "Mac Touch ID" "$KVM4_KC_ROOT/public/admin.html"; then
  echo "WARNING: Mac Touch ID not found in $KVM4_KC_ROOT/public/admin.html" >&2
else
  echo "PASS: Mac Touch ID found in host public/admin.html"
fi

echo "Checking container $app_container for Touch ID..."
if docker exec "$app_container" grep -q "Mac Touch ID" /app/public/admin.html 2>/dev/null; then
  echo "PASS: Mac Touch ID found in container /app/public/admin.html"
else
  echo "WARNING: Mac Touch ID not found in container /app/public/admin.html" >&2
fi

echo "Checking local HTTP response from http://127.0.0.1:3100/admin for Touch ID..."
if curl -fsS -H "Host: adm.fatherkey.com" http://127.0.0.1:3100/admin | grep -q "Mac Touch ID"; then
  echo "PASS: Local curl on 3100 returned Mac Touch ID in admin HTML"
else
  echo "WARNING: Local curl on 3100 did not return Mac Touch ID in admin HTML" >&2
fi

echo "Active container status:"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'NAMES|kc'
curl -fsS http://127.0.0.1:3100/api/public/runtime
REMOTE

retry_command scp "${scp_opts[@]}" "$remote_script_path" "$remote:$remote_tmp/activate.sh"

echo "Activating KC-PAY-GPT release on KVM4"
retry_command ssh "${ssh_opts[@]}" "$remote" \
  "KVM4_KC_ROOT='$KVM4_KC_ROOT' RELEASE_ID='$release_id' RELEASE_COMMIT='$head_sha' KEEP_RELEASES='$KEEP_RELEASES' REMOTE_TMP='$remote_tmp' bash '$remote_tmp/activate.sh'"

echo
echo "KVM4 KC-PAY-GPT release deployed: $release_id"
