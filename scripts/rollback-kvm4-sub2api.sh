#!/usr/bin/env bash
set -Eeuo pipefail

KVM4_HOST="${KVM4_HOST:-76.13.188.218}"
KVM4_PORT="${KVM4_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-$HOME/.ssh/hostinger_sub2api}"
KVM4_SUB2API_ROOT="${KVM4_SUB2API_ROOT:-/opt/sub2api}"
TARGET_RELEASE="${1:-}"

usage() {
  cat <<'EOF'
Usage: scripts/rollback-kvm4-sub2api.sh [release-id]

Rollback the KVM4 Sub2API app container to a previous release. If release-id is
omitted, the script uses /opt/sub2api/.previous-src when available, or the
newest release that is not currently active.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

[[ -f "$KVM4_KEY" ]] || {
  echo "rollback-kvm4-sub2api: SSH key not found: $KVM4_KEY" >&2
  exit 1
}

ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT")
remote="$KVM4_USER@$KVM4_HOST"

ssh "${ssh_opts[@]}" "$remote" \
  "KVM4_SUB2API_ROOT='$KVM4_SUB2API_ROOT' TARGET_RELEASE='$TARGET_RELEASE' bash -s" <<'REMOTE'
set -Eeuo pipefail

die() {
  echo "remote sub2api rollback: $*" >&2
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

[[ -d "$KVM4_SUB2API_ROOT/releases" ]] || die "release directory missing"
current_src=""
if [[ -L "$KVM4_SUB2API_ROOT/src" ]]; then
  current_src="$(readlink -f "$KVM4_SUB2API_ROOT/src" || true)"
fi

target_src=""
if [[ -n "${TARGET_RELEASE:-}" ]]; then
  target_src="$KVM4_SUB2API_ROOT/releases/$TARGET_RELEASE/sub2api"
elif [[ -f "$KVM4_SUB2API_ROOT/.previous-src" ]]; then
  target_src="$(cat "$KVM4_SUB2API_ROOT/.previous-src")"
else
  while IFS= read -r candidate; do
    if [[ "$candidate/sub2api" != "$current_src" && -d "$candidate/sub2api" ]]; then
      target_src="$candidate/sub2api"
      break
    fi
  done < <(find "$KVM4_SUB2API_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | awk '{print $2}')
fi

[[ -d "$target_src" ]] || die "target source not found: $target_src"
target_root="$(dirname "$target_src")"
[[ -f "$target_root/docker-compose.local.yml" ]] || die "target compose file missing"

cd "$KVM4_SUB2API_ROOT"
ln -sfn "$target_src" "$KVM4_SUB2API_ROOT/src"
install -o root -g root -m 0644 "$target_root/docker-compose.local.yml" "$KVM4_SUB2API_ROOT/docker-compose.local.yml"

docker compose --env-file .env -f docker-compose.local.yml build sub2api
docker compose --env-file .env -f docker-compose.local.yml up -d --no-deps --force-recreate sub2api
healthcheck || die "healthcheck failed after rollback"

basename "$target_root" > "$KVM4_SUB2API_ROOT/.current-release"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'NAMES|sub2api'
curl -fsS http://127.0.0.1:8080/health
REMOTE
