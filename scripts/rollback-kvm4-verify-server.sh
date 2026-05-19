#!/usr/bin/env bash
set -Eeuo pipefail

KVM4_HOST="${KVM4_HOST:-76.13.188.218}"
KVM4_PORT="${KVM4_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-$HOME/.ssh/hostinger_sub2api}"
KVM4_ROOT="${KVM4_ROOT:-/opt/zaoyoe-verify-server}"
TARGET_RELEASE="${1:-}"

usage() {
  cat <<'EOF'
Usage: scripts/rollback-kvm4-verify-server.sh [release-id]

Rollback the KVM4 verify API service to a previous release. If release-id is
omitted, the script uses /opt/zaoyoe-verify-server/.previous-app when available,
or the newest release that is not currently active.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

[[ -f "$KVM4_KEY" ]] || {
  echo "rollback-kvm4-verify-server: SSH key not found: $KVM4_KEY" >&2
  exit 1
}

ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT")
remote="$KVM4_USER@$KVM4_HOST"

ssh "${ssh_opts[@]}" "$remote" \
  "KVM4_ROOT='$KVM4_ROOT' TARGET_RELEASE='$TARGET_RELEASE' bash -s" <<'REMOTE'
set -Eeuo pipefail

die() {
  echo "remote rollback: $*" >&2
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

[[ -d "$KVM4_ROOT/releases" ]] || die "release directory missing"
current_app=""
if [[ -L "$KVM4_ROOT/app" ]]; then
  current_app="$(readlink -f "$KVM4_ROOT/app" || true)"
fi

target_app=""
if [[ -n "${TARGET_RELEASE:-}" ]]; then
  target_app="$KVM4_ROOT/releases/$TARGET_RELEASE/app"
elif [[ -f "$KVM4_ROOT/.previous-app" ]]; then
  target_app="$(cat "$KVM4_ROOT/.previous-app")"
else
  while IFS= read -r candidate; do
    if [[ "$candidate/app" != "$current_app" && -d "$candidate/app" ]]; then
      target_app="$candidate/app"
      break
    fi
  done < <(find "$KVM4_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | awk '{print $2}')
fi

[[ -d "$target_app" ]] || die "target app not found: $target_app"
target_root="$(dirname "$target_app")"

ln -sfn "$target_app" "$KVM4_ROOT/app"
if [[ -f "$target_root/Dockerfile" ]]; then
  install -o root -g root -m 0644 "$target_root/Dockerfile" "$KVM4_ROOT/Dockerfile"
fi
if [[ -f "$target_root/docker-compose.yml" ]]; then
  install -o root -g root -m 0644 "$target_root/docker-compose.yml" "$KVM4_ROOT/docker-compose.yml"
fi

cd "$KVM4_ROOT"
docker compose up -d --build --force-recreate verify-server
healthcheck || die "healthcheck failed after rollback"

basename "$target_root" > "$KVM4_ROOT/.current-release"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'NAMES|zaoyoe-verify-server'
curl -fsS http://127.0.0.1:3001/healthz
REMOTE
