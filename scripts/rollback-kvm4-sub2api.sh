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
Usage: scripts/rollback-kvm4-sub2api.sh [newapi-release-id]

Rollback the KVM4 NewAPI service slot to a previous NewAPI release. Legacy
Sub2API releases and the private bridge are intentionally not valid rollback
targets after the NewAPI-only cutover.
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
  echo "remote NewAPI rollback: $*" >&2
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

newapi_source_for_release() {
  local release_root="$1"
  [[ -d "$release_root/newapi" ]] || return 1
  [[ -f "$release_root/docker-compose.local.yml" ]] || return 1
  grep -q 'zaoyoe/newapi:local' "$release_root/docker-compose.local.yml" || return 1
  if grep -q 'legacy-sub2api:' "$release_root/docker-compose.local.yml"; then
    return 1
  fi
  printf '%s\n' "$release_root/newapi"
}

[[ -d "$KVM4_SUB2API_ROOT/releases" ]] || die "release directory missing"
current_src=""
if [[ -L "$KVM4_SUB2API_ROOT/src" ]]; then
  current_src="$(readlink -f "$KVM4_SUB2API_ROOT/src" || true)"
fi
[[ -d "$current_src" ]] || die "current NewAPI release source is unavailable"
[[ "$(basename "$current_src")" == "newapi" ]] || die "current release is not a NewAPI release"
grep -q 'zaoyoe/newapi:local' "$KVM4_SUB2API_ROOT/docker-compose.local.yml" ||
  die "active compose file is not NewAPI-only"
if grep -q 'legacy-sub2api:' "$KVM4_SUB2API_ROOT/docker-compose.local.yml"; then
  die "active compose file still declares the removed legacy bridge"
fi

target_src=""
if [[ -n "${TARGET_RELEASE:-}" ]]; then
  target_root="$KVM4_SUB2API_ROOT/releases/$TARGET_RELEASE"
  target_src="$(newapi_source_for_release "$target_root" || true)"
elif [[ -f "$KVM4_SUB2API_ROOT/.previous-src" ]]; then
  previous_src="$(cat "$KVM4_SUB2API_ROOT/.previous-src")"
  if [[ -d "$previous_src" && "$previous_src" != "$current_src" && "$(basename "$previous_src")" == "newapi" ]]; then
    target_src="$previous_src"
  fi
fi

if [[ -z "$target_src" && -z "${TARGET_RELEASE:-}" ]]; then
  while IFS= read -r candidate; do
    candidate_src="$(newapi_source_for_release "$candidate" || true)"
    if [[ -n "$candidate_src" && "$candidate_src" != "$current_src" ]]; then
      target_src="$candidate_src"
      break
    fi
  done < <(find "$KVM4_SUB2API_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | awk '{print $2}')
fi

[[ -d "$target_src" ]] || die "NewAPI rollback target not found: ${TARGET_RELEASE:-automatic selection}"
target_root="$(dirname "$target_src")"
[[ -f "$target_root/docker-compose.local.yml" ]] || die "target compose file missing"
grep -q 'zaoyoe/newapi:local' "$target_root/docker-compose.local.yml" ||
  die "target release is not NewAPI-only"
if grep -q 'legacy-sub2api:' "$target_root/docker-compose.local.yml"; then
  die "target release still declares the removed legacy bridge"
fi

cd "$KVM4_SUB2API_ROOT"
docker rm -f sub2api-legacy >/dev/null 2>&1 || true
ln -sfn "$target_src" "$KVM4_SUB2API_ROOT/src"
install -o root -g root -m 0644 "$target_root/docker-compose.local.yml" "$KVM4_SUB2API_ROOT/docker-compose.local.yml"

docker compose --env-file .env -f docker-compose.local.yml config >/dev/null ||
  die "target NewAPI compose configuration is invalid"
docker compose --env-file .env -f docker-compose.local.yml build sub2api
docker compose --env-file .env -f docker-compose.local.yml up -d postgres redis
docker compose --env-file .env -f docker-compose.local.yml up -d --no-deps --force-recreate sub2api
healthcheck || die "NewAPI healthcheck failed after rollback"

if [[ -f "$target_root/.commit" ]]; then
  install -o root -g root -m 0644 "$target_root/.commit" "$KVM4_SUB2API_ROOT/.current-release"
else
  basename "$target_root" > "$KVM4_SUB2API_ROOT/.current-release"
fi
if docker ps --format '{{.Names}}' | grep -qx 'sub2api-legacy'; then
  die "legacy bridge container is still running after rollback"
fi
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'NAMES|sub2api'
curl -fsS http://127.0.0.1:8080/health
REMOTE
