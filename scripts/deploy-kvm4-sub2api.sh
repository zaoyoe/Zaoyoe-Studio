#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KVM4_HOST="${KVM4_HOST:-76.13.188.218}"
KVM4_PORT="${KVM4_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-$HOME/.ssh/hostinger_sub2api}"
KVM4_SUB2API_ROOT="${KVM4_SUB2API_ROOT:-/opt/sub2api}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
KVM4_SSH_ATTEMPTS="${KVM4_SSH_ATTEMPTS:-4}"
KVM4_SSH_RETRY_DELAY="${KVM4_SSH_RETRY_DELAY:-15}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: scripts/deploy-kvm4-sub2api.sh [options]

Deploy NewAPI into the Hostinger KVM4 Sub2API service slot from the latest
clean main. The public domain and /opt/sub2api root stay unchanged.

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

[[ -d services/newapi ]] || die "missing services/newapi"
[[ -f services/newapi/Dockerfile ]] || die "missing services/newapi/Dockerfile"
[[ -f services/newapi/.upstream-commit ]] || die "missing services/newapi/.upstream-commit"
[[ -f deploy/kvm4/docker-compose.sub2api.yml ]] || die "missing deploy/kvm4/docker-compose.sub2api.yml"
[[ -f deploy/kvm4/caddy/sub2api-newapi.caddy.tmpl ]] || die "missing NewAPI Caddy ingress template"
[[ -f deploy/kvm4/caddy/sub2api-maintenance.caddy.tmpl ]] || die "missing Sub2API maintenance Caddy ingress template"

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
archive_path="$tmp_dir/zaoyoe-newapi-$release_id.tar.gz"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$release_dir"
echo "Creating NewAPI release archive $release_id for the Sub2API service slot"
git archive --format=tar HEAD services/newapi | tar -xf - -C "$release_dir"
mv "$release_dir/services/newapi" "$release_dir/newapi"
rmdir "$release_dir/services"

COPYFILE_DISABLE=1 tar --no-xattrs -C "$release_dir" -czf "$archive_path" newapi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Dry run complete: $archive_path"
  tar -tzf "$archive_path" | sed -n '1,60p'
  exit 0
fi

ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
scp_opts=(-i "$KVM4_KEY" -P "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
remote="$KVM4_USER@$KVM4_HOST"
remote_tmp="/tmp/zaoyoe-newapi-$release_id"

echo "Uploading NewAPI release to $remote:$KVM4_SUB2API_ROOT"
retry_command ssh "${ssh_opts[@]}" "$remote" "mkdir -p '$remote_tmp'"
retry_command scp "${scp_opts[@]}" "$archive_path" "$remote:$remote_tmp/app.tar.gz"
retry_command scp "${scp_opts[@]}" deploy/kvm4/docker-compose.sub2api.yml "$remote:$remote_tmp/docker-compose.local.yml"
retry_command scp "${scp_opts[@]}" deploy/kvm4/caddy/sub2api-newapi.caddy.tmpl "$remote:$remote_tmp/sub2api-newapi.caddy.tmpl"
retry_command scp "${scp_opts[@]}" deploy/kvm4/caddy/sub2api-maintenance.caddy.tmpl "$remote:$remote_tmp/sub2api-maintenance.caddy.tmpl"

remote_script_path="$tmp_dir/activate-newapi.sh"
cat > "$remote_script_path" <<'REMOTE'
set -Eeuo pipefail

die() {
  echo "remote NewAPI deploy in Sub2API slot: $*" >&2
  exit 1
}

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" .env | tail -n 1
}

append_env_value() {
  local key="$1"
  local value="$2"
  printf '\n%s=%s\n' "$key" "$value" >> .env
}

redis_db_from_url() {
  local dsn="$1"
  local path

  [[ "$dsn" =~ ^rediss?://[^/]+(/[^?]*)?(\?.*)?$ ]] || return 1
  path="${BASH_REMATCH[1]:-}"
  path="${path#/}"
  if [[ -z "$path" ]]; then
    printf '0\n'
    return 0
  fi
  [[ "$path" =~ ^[0-9]+$ ]] || return 1
  printf '%d\n' "$((10#$path))"
}

flush_newapi_redis() {
  local redis_cli_dsn
  local result

  redis_cli_dsn="${newapi_redis_dsn/@redis:/@127.0.0.1:}"
  redis_cli_dsn="${redis_cli_dsn/\/\/redis:/\/\/127.0.0.1:}"
  redis_cli_dsn="${redis_cli_dsn/@sub2api-redis:/@127.0.0.1:}"
  redis_cli_dsn="${redis_cli_dsn/\/\/sub2api-redis:/\/\/127.0.0.1:}"
  result="$(docker exec sub2api-redis sh -c \
    'unset REDISCLI_AUTH; exec redis-cli --no-auth-warning -u "$1" FLUSHDB' \
    sh "$redis_cli_dsn" 2>/dev/null)" || return 1
  [[ "$result" == "OK" ]]
}

healthcheck() {
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 5 http://127.0.0.1:8080/health >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

legacy_healthcheck() {
  for _ in $(seq 1 45); do
    if docker exec sub2api-legacy wget -q -T 5 -O /dev/null http://127.0.0.1:8080/health 2>/dev/null; then
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

CADDY_CONFIG_PATH="${KVM4_CADDY_CONFIG:-/etc/caddy/Caddyfile}"
CADDY_SERVICE_NAME="${KVM4_CADDY_SERVICE:-caddy}"
CADDY_MANAGED_BEGIN="BEGIN FATHERKEY MANAGED NEWAPI SUB2API INGRESS"
CADDY_MANAGED_END="END FATHERKEY MANAGED NEWAPI SUB2API INGRESS"
caddy_backup=""
caddy_restore_needed=0

reload_caddy_config() {
  local config_path="$1"

  command -v caddy >/dev/null 2>&1 || return 1
  caddy validate --config "$config_path" --adapter caddyfile >/dev/null || return 1

  if command -v systemctl >/dev/null 2>&1 && systemctl cat "$CADDY_SERVICE_NAME" >/dev/null 2>&1; then
    systemctl reload "$CADDY_SERVICE_NAME" || return 1
    systemctl is-active --quiet "$CADDY_SERVICE_NAME" || return 1
    return 0
  fi

  caddy reload --config "$config_path" --adapter caddyfile >/dev/null
}

restore_caddy_config() {
  local attempt

  if [[ "$caddy_restore_needed" != "1" ]]; then
    return 0
  fi
  [[ -n "$caddy_backup" && -f "$caddy_backup" ]] || return 1

  echo "Restoring the previous Caddy ingress configuration" >&2
  cp -a "$caddy_backup" "$CADDY_CONFIG_PATH" || return 1
  for attempt in 1 2 3; do
    if reload_caddy_config "$CADDY_CONFIG_PATH"; then
      caddy_restore_needed=0
      return 0
    fi
    sleep 1
  done
  return 1
}

install_managed_caddy_config() {
  local edge_secret="$1"
  local mode="${2:-live}"
  local template_path
  local caddy_dir
  local stripped_path
  local rendered_path
  local candidate_path
  local template_token_count
  local site_count
  local caddy_user
  local caddy_group

  case "$mode" in
    live)
      [[ "$edge_secret" =~ ^[[:xdigit:]]{64}$ ]] || return 1
      template_path="$REMOTE_TMP/sub2api-newapi.caddy.tmpl"
      ;;
    maintenance)
      template_path="$REMOTE_TMP/sub2api-maintenance.caddy.tmpl"
      ;;
    *)
      return 1
      ;;
  esac
  [[ -f "$CADDY_CONFIG_PATH" && -f "$template_path" ]] || return 1
  command -v caddy >/dev/null 2>&1 || return 1

  if [[ -z "$caddy_backup" ]]; then
    caddy_backup="$KVM4_SUB2API_ROOT/backups/Caddyfile.$RELEASE_ID.bak"
    cp -a "$CADDY_CONFIG_PATH" "$caddy_backup" || return 1
    caddy_restore_needed=1
  fi

  caddy_dir="$(dirname "$CADDY_CONFIG_PATH")"
  if ! stripped_path="$(mktemp "$caddy_dir/.sub2api-stripped.XXXXXX")"; then
    return 1
  fi
  if ! rendered_path="$(mktemp "$caddy_dir/.sub2api-rendered.XXXXXX")"; then
    rm -f "$stripped_path"
    return 1
  fi
  if ! candidate_path="$(mktemp "$caddy_dir/.sub2api-candidate.XXXXXX")"; then
    rm -f "$stripped_path" "$rendered_path"
    return 1
  fi

  template_token_count="$(awk '{ count += gsub(/__NEWAPI_REGIONAL_EDGE_SECRET__/, "&") } END { print count + 0 }' "$template_path")"
  if [[ "$mode" == "live" ]]; then
    if [[ "$template_token_count" != "1" ]] ||
      ! sed "s/__NEWAPI_REGIONAL_EDGE_SECRET__/$edge_secret/" "$template_path" > "$rendered_path"; then
      rm -f "$stripped_path" "$rendered_path" "$candidate_path"
      return 1
    fi
  else
    if [[ "$template_token_count" != "0" ]] || ! cp "$template_path" "$rendered_path"; then
      rm -f "$stripped_path" "$rendered_path" "$candidate_path"
      return 1
    fi
  fi

  if ! awk -v managed_begin="$CADDY_MANAGED_BEGIN" -v managed_end="$CADDY_MANAGED_END" '
    function brace_delta(value, copy, opens, closes) {
      copy = value
      opens = gsub(/[\{]/, "", copy)
      copy = value
      closes = gsub(/[\}]/, "", copy)
      return opens - closes
    }
    index($0, managed_begin) {
      skipping_managed = 1
      next
    }
    skipping_managed {
      if (index($0, managed_end)) {
        skipping_managed = 0
      }
      next
    }
    skipping_site {
      site_depth += brace_delta($0)
      if (site_depth <= 0) {
        skipping_site = 0
      }
      next
    }
    top_depth == 0 && $0 !~ /^[[:space:]]*#/ &&
      $0 ~ /sub2api[.](fatherkey[.]com|zaoyoe[.](com|xyz))/ && index($0, "{") {
      skipping_site = 1
      site_depth = brace_delta($0)
      if (site_depth <= 0) {
        skipping_site = 0
      }
      next
    }
    {
      print
      top_depth += brace_delta($0)
      if (top_depth < 0) {
        exit 42
      }
    }
    END {
      if (skipping_managed || skipping_site || top_depth != 0) {
        exit 43
      }
    }
  ' "$CADDY_CONFIG_PATH" > "$stripped_path"; then
    rm -f "$stripped_path" "$rendered_path" "$candidate_path"
    return 1
  fi

  if ! {
    sed -e '${/^$/d;}' "$stripped_path" &&
      printf '\n' &&
      sed -e '${/^$/d;}' "$rendered_path" &&
      printf '\n'
  } > "$candidate_path"; then
    rm -f "$stripped_path" "$rendered_path" "$candidate_path"
    return 1
  fi

  site_count="$(awk '/sub2api[.]fatherkey[.]com/ { count++ } END { print count + 0 }' "$candidate_path")"
  if [[ "$site_count" != "1" ]] || grep -q '__NEWAPI_REGIONAL_EDGE_SECRET__' "$candidate_path"; then
    rm -f "$stripped_path" "$rendered_path" "$candidate_path"
    return 1
  fi
  if ! caddy validate --config "$candidate_path" --adapter caddyfile >/dev/null; then
    rm -f "$stripped_path" "$rendered_path" "$candidate_path"
    return 1
  fi

  caddy_user="$(systemctl show "$CADDY_SERVICE_NAME" --property User --value 2>/dev/null || true)"
  caddy_user="${caddy_user:-root}"
  if ! id "$caddy_user" >/dev/null 2>&1; then
    rm -f "$stripped_path" "$rendered_path" "$candidate_path"
    return 1
  fi
  caddy_group="$(id -gn "$caddy_user")"

  if ! install -o root -g "$caddy_group" -m 0640 "$candidate_path" "$CADDY_CONFIG_PATH" ||
    ! reload_caddy_config "$CADDY_CONFIG_PATH"; then
    rm -f "$stripped_path" "$rendered_path" "$candidate_path"
    restore_caddy_config || true
    return 1
  fi

  rm -f "$stripped_path" "$rendered_path" "$candidate_path"
}

cleanup_regional_smoke_user() {
  local deleted_smoke_user_id

  if [[ "${smoke_user_cleanup_pending:-0}" == "1" ]]; then
    if ! deleted_smoke_user_id="$(docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
      psql -X -v ON_ERROR_STOP=1 -U "$postgres_user" -d "$newapi_db_name" -qAtc \
      "DELETE FROM users WHERE id = $smoke_user_id AND username = '$smoke_username' AND access_token = '$smoke_dashboard_token' RETURNING id")"; then
      return 1
    fi
    [[ "$deleted_smoke_user_id" == "$smoke_user_id" ]] || return 1
    smoke_user_cleanup_pending=0
  fi

  if [[ "${smoke_user_cache_cleanup_pending:-0}" == "1" ]]; then
    flush_newapi_redis || return 1
    smoke_user_cache_cleanup_pending=0
  fi
}

fail_after_public_open() {
  local message="$1"
  local ingress_reblocked=0
  local smoke_user_removed=0

  if install_managed_caddy_config "$newapi_regional_edge_secret" maintenance; then
    ingress_reblocked=1
  fi
  if cleanup_regional_smoke_user; then
    smoke_user_removed=1
  fi

  if [[ "$ingress_reblocked" == "1" && "$smoke_user_removed" == "1" ]]; then
    die "$message; public traffic was re-blocked, temporary credentials were removed, and the NewAPI database was preserved"
  fi
  if [[ "$ingress_reblocked" == "1" ]]; then
    die "$message; public traffic was re-blocked and the NewAPI database was preserved, but temporary credential cleanup failed"
  fi
  if [[ "$smoke_user_removed" == "1" ]]; then
    die "$message; CRITICAL: temporary credentials were removed, but automatic rollback was forbidden and the attempt to re-block public traffic failed"
  fi
  die "$message; CRITICAL: automatic rollback was forbidden, the attempt to re-block public traffic failed, and temporary credential cleanup failed"
}

[[ -n "${KVM4_SUB2API_ROOT:-}" ]] || die "KVM4_SUB2API_ROOT missing"
[[ -n "${RELEASE_ID:-}" ]] || die "RELEASE_ID missing"
[[ -n "${RELEASE_COMMIT:-}" ]] || die "RELEASE_COMMIT missing"
[[ -n "${REMOTE_TMP:-}" ]] || die "REMOTE_TMP missing"
[[ -f "$KVM4_SUB2API_ROOT/.env" ]] || die "$KVM4_SUB2API_ROOT/.env missing"
[[ -f "$REMOTE_TMP/app.tar.gz" ]] || die "release archive missing"
[[ -f "$REMOTE_TMP/docker-compose.local.yml" ]] || die "compose file missing"
[[ -f "$REMOTE_TMP/sub2api-newapi.caddy.tmpl" ]] || die "Caddy ingress template missing"
[[ -f "$REMOTE_TMP/sub2api-maintenance.caddy.tmpl" ]] || die "Caddy maintenance ingress template missing"

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

  echo "Pausing KVM4 watchdog during NewAPI cutover"
  systemctl stop "$WATCHDOG_TIMER" "$WATCHDOG_SERVICE" >/dev/null 2>&1 || true
fi

cd "$KVM4_SUB2API_ROOT"
[[ -f docker-compose.local.yml ]] || die "$KVM4_SUB2API_ROOT/docker-compose.local.yml missing"
[[ -d data ]] || die "$KVM4_SUB2API_ROOT/data missing"
[[ -d postgres_data ]] || die "$KVM4_SUB2API_ROOT/postgres_data missing"
[[ -d redis_data ]] || die "$KVM4_SUB2API_ROOT/redis_data missing"

mkdir -p releases backups newapi_data
release_root="$KVM4_SUB2API_ROOT/releases/$RELEASE_ID"
release_src="$release_root/newapi"
mkdir -p "$release_root"
tar -xzf "$REMOTE_TMP/app.tar.gz" -C "$release_root"
[[ -f "$release_src/Dockerfile" ]] || die "NewAPI release Dockerfile missing"
[[ -x "$release_src" || -d "$release_src" ]] || die "NewAPI release source missing"
install -o root -g root -m 0644 "$REMOTE_TMP/docker-compose.local.yml" "$release_root/docker-compose.local.yml"
printf '%s\n' "$RELEASE_COMMIT" > "$release_root/.commit"

cp -a "$KVM4_SUB2API_ROOT/.env" "$KVM4_SUB2API_ROOT/backups/env.$RELEASE_ID.bak"
cp -a "$KVM4_SUB2API_ROOT/docker-compose.local.yml" "$KVM4_SUB2API_ROOT/backups/docker-compose.local.$RELEASE_ID.bak"
previous_compose="$KVM4_SUB2API_ROOT/backups/docker-compose.local.$RELEASE_ID.bak"
previous_env="$KVM4_SUB2API_ROOT/backups/env.$RELEASE_ID.bak"
previous_image="zaoyoe/newapi:rollback-$RELEASE_ID"
previous_was_newapi=0
if grep -q 'zaoyoe/newapi:local' "$previous_compose"; then
  previous_was_newapi=1
fi
if docker image inspect zaoyoe/newapi:local >/dev/null 2>&1; then
  docker tag zaoyoe/newapi:local "$previous_image"
fi

previous_src=""
if [[ -L "$KVM4_SUB2API_ROOT/src" ]]; then
  previous_src="$(readlink -f "$KVM4_SUB2API_ROOT/src" || true)"
elif [[ -d "$KVM4_SUB2API_ROOT/src" ]]; then
  previous_src="$KVM4_SUB2API_ROOT/releases/pre-managed-$RELEASE_ID/sub2api"
  mkdir -p "$(dirname "$previous_src")"
  mv "$KVM4_SUB2API_ROOT/src" "$previous_src"
fi

rollback_done=0
drop_newapi_on_rollback=0
restore_newapi_on_rollback=0
newapi_db_backup=""
newapi_db_name=""
newapi_db_name_valid=0
public_newapi_open=0
newapi_redis_ready=0
newapi_runtime_started=0

rollback() {
  if [[ "$public_newapi_open" == "1" ]]; then
    echo "CRITICAL: refusing automatic rollback after NewAPI accepted public traffic; the NewAPI database must be preserved" >&2
    return 1
  fi
  if [[ "$rollback_done" == "1" ]]; then
    return 0
  fi
  rollback_done=1
  trap - ERR
  set +e

  echo "Rolling back the Sub2API service slot" >&2
  docker rm -f sub2api >/dev/null 2>&1 || true

  if [[ "$drop_newapi_on_rollback" == "1" && "$newapi_db_name_valid" == "1" ]]; then
    echo "Discarding the incomplete NewAPI cutover snapshot" >&2
    docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
      psql -X -v ON_ERROR_STOP=1 -U "$postgres_user" -d postgres -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$newapi_db_name' AND pid <> pg_backend_pid()" \
      >/dev/null 2>&1 || true
    docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
      dropdb --if-exists -U "$postgres_user" "$newapi_db_name" >/dev/null 2>&1 || true
  fi

  if [[ "$restore_newapi_on_rollback" == "1" && "$newapi_db_name_valid" == "1" ]]; then
    echo "Restoring the pre-deploy NewAPI database snapshot" >&2
    docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
      psql -X -v ON_ERROR_STOP=1 -U "$postgres_user" -d postgres -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$newapi_db_name' AND pid <> pg_backend_pid()" \
      >/dev/null 2>&1 || true
    if ! docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
      dropdb --if-exists -U "$postgres_user" "$newapi_db_name" >/dev/null 2>&1 ||
      ! docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
        createdb -U "$postgres_user" -O "$postgres_user" "$newapi_db_name" >/dev/null 2>&1 ||
      ! docker exec -i -e PGPASSWORD="$postgres_password" sub2api-postgres \
        pg_restore --exit-on-error --no-owner -U "$postgres_user" -d "$newapi_db_name" < "$newapi_db_backup"; then
      echo "CRITICAL: failed to restore $newapi_db_name from $newapi_db_backup; refusing to restart the previous NewAPI release" >&2
      return 1
    fi
    restore_newapi_on_rollback=0
  fi

  if [[ "$newapi_runtime_started" == "1" && "$newapi_redis_ready" == "1" ]]; then
    if ! flush_newapi_redis; then
      if [[ "$previous_was_newapi" == "1" ]]; then
        echo "CRITICAL: failed to clear the isolated NewAPI Redis database; refusing to restart the previous NewAPI release" >&2
        return 1
      fi
      echo "WARNING: failed to clear the isolated NewAPI Redis database while returning to legacy Sub2API" >&2
    fi
  fi

  if [[ -f "$previous_compose" ]]; then
    install -o root -g root -m 0644 "$previous_compose" "$KVM4_SUB2API_ROOT/docker-compose.local.yml"
  fi
  if [[ -f "$previous_env" ]]; then
    install -o root -g root -m 0600 "$previous_env" "$KVM4_SUB2API_ROOT/.env"
  fi
  if [[ -n "$previous_src" && -d "$previous_src" ]]; then
    ln -sfn "$previous_src" "$KVM4_SUB2API_ROOT/src"
  fi

  if grep -q 'zaoyoe/newapi:local' "$KVM4_SUB2API_ROOT/docker-compose.local.yml" 2>/dev/null; then
    if docker image inspect "$previous_image" >/dev/null 2>&1; then
      docker tag "$previous_image" zaoyoe/newapi:local
    fi
    docker compose --env-file .env -f docker-compose.local.yml up -d postgres redis legacy-sub2api || true
    docker compose --env-file .env -f docker-compose.local.yml up -d --no-deps --force-recreate sub2api || true
  else
    docker rm -f sub2api-legacy >/dev/null 2>&1 || true
    docker compose --env-file .env -f docker-compose.local.yml up -d postgres redis || true
    docker compose --env-file .env -f docker-compose.local.yml up -d --no-deps --force-recreate sub2api || true
  fi
  if healthcheck; then
    if ! restore_caddy_config; then
      echo "WARNING: previous app is healthy but the previous Caddy ingress configuration could not be restored" >&2
    fi
  else
    echo "WARNING: previous app did not become healthy; leaving the maintenance ingress in place" >&2
  fi
}

rollback_on_error() {
  local status=$?
  rollback
  exit "$status"
}

trap rollback_on_error ERR

ln -sfn "$release_src" "$KVM4_SUB2API_ROOT/src"
install -o root -g root -m 0644 "$release_root/docker-compose.local.yml" "$KVM4_SUB2API_ROOT/docker-compose.local.yml"

newapi_db_name="$(read_env_value NEWAPI_DB_NAME)"
if [[ -z "$newapi_db_name" ]]; then
  newapi_db_name="newapi"
  append_env_value NEWAPI_DB_NAME "$newapi_db_name"
fi
[[ "$newapi_db_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
  rollback
  die "NEWAPI_DB_NAME must contain only letters, digits, and underscores"
}
newapi_db_name_valid=1

newapi_session_secret="$(read_env_value NEWAPI_SESSION_SECRET)"
if [[ -z "$newapi_session_secret" ]]; then
  newapi_session_secret="$(read_env_value JWT_SECRET)"
  if [[ -z "$newapi_session_secret" ]]; then
    newapi_session_secret="$(openssl rand -hex 32)"
  fi
  append_env_value NEWAPI_SESSION_SECRET "$newapi_session_secret"
fi
[[ ${#newapi_session_secret} -ge 32 ]] || {
  rollback
  die "NEWAPI_SESSION_SECRET must be at least 32 characters"
}

newapi_regional_edge_secret="$(read_env_value NEWAPI_REGIONAL_EDGE_SECRET)"
if [[ -z "$newapi_regional_edge_secret" ]]; then
  newapi_regional_edge_secret="$(openssl rand -hex 32)"
  append_env_value NEWAPI_REGIONAL_EDGE_SECRET "$newapi_regional_edge_secret"
fi
[[ "$newapi_regional_edge_secret" =~ ^[[:xdigit:]]{64}$ ]] || {
  rollback
  die "NEWAPI_REGIONAL_EDGE_SECRET must be exactly 64 hexadecimal characters"
}

redis_password="$(read_env_value REDIS_PASSWORD)"
newapi_redis_dsn="$(read_env_value NEWAPI_REDIS_CONN_STRING)"
if [[ -n "$redis_password" && -z "$newapi_redis_dsn" ]]; then
  [[ "$redis_password" =~ ^[A-Za-z0-9._~-]+$ ]] || {
    rollback
    die "set a URL-encoded NEWAPI_REDIS_CONN_STRING when REDIS_PASSWORD contains URL-special characters"
  }
  newapi_redis_dsn="redis://:${redis_password}@redis:6379/1"
  append_env_value NEWAPI_REDIS_CONN_STRING "$newapi_redis_dsn"
fi
newapi_redis_dsn="${newapi_redis_dsn:-redis://redis:6379/1}"
if ! newapi_redis_db="$(redis_db_from_url "$newapi_redis_dsn")"; then
  rollback
  die "NEWAPI_REDIS_CONN_STRING must be a redis:// or rediss:// URL with an optional numeric database path"
fi
legacy_redis_db="$(read_env_value REDIS_DB)"
legacy_redis_db="${legacy_redis_db:-0}"
[[ "$legacy_redis_db" =~ ^[0-9]+$ ]] || {
  rollback
  die "REDIS_DB must be a non-negative integer"
}
legacy_redis_db="$((10#$legacy_redis_db))"
[[ "$newapi_redis_db" != "$legacy_redis_db" ]] || {
  rollback
  die "NewAPI and legacy Sub2API must use different Redis databases"
}
newapi_redis_ready=1
chmod 0600 .env

postgres_user="$(read_env_value POSTGRES_USER)"
postgres_user="${postgres_user:-sub2api}"
postgres_password="$(read_env_value POSTGRES_PASSWORD)"
source_db_name="$(read_env_value POSTGRES_DB)"
source_db_name="${source_db_name:-sub2api}"
[[ "$postgres_user" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
  rollback
  die "POSTGRES_USER is not safe for the migration DSN"
}
[[ "$source_db_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
  rollback
  die "POSTGRES_DB is not safe for the migration DSN"
}
[[ "$newapi_db_name" != "$source_db_name" ]] || {
  rollback
  die "NEWAPI_DB_NAME must differ from POSTGRES_DB"
}
case "$newapi_db_name" in
  postgres|template0|template1)
    rollback
    die "NEWAPI_DB_NAME must not use a PostgreSQL system database"
    ;;
esac
[[ -n "$postgres_password" ]] || {
  rollback
  die "POSTGRES_PASSWORD is required"
}
[[ "$postgres_password" =~ ^[A-Za-z0-9._~-]+$ ]] || {
  rollback
  die "POSTGRES_PASSWORD must be URL-safe for NewAPI SQL_DSN"
}

ensure_dependency_healthy sub2api-postgres postgres
ensure_dependency_healthy sub2api-redis redis

if ! docker image inspect zaoyoe/sub2api:legacy >/dev/null 2>&1; then
  if ! docker image inspect zaoyoe/sub2api:local >/dev/null 2>&1; then
    rollback
    die "legacy Sub2API image is unavailable for the phase-one compatibility bridge"
  fi
  docker tag zaoyoe/sub2api:local zaoyoe/sub2api:legacy
fi

echo "Building NewAPI image from $release_src"
if ! docker compose --env-file .env -f docker-compose.local.yml config >/dev/null; then
  rollback
  die "NewAPI compose configuration is invalid"
fi
if ! docker compose --env-file .env -f docker-compose.local.yml build sub2api; then
  rollback
  die "NewAPI image build failed"
fi

newapi_database_exists=0
if docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
  psql -X -v ON_ERROR_STOP=1 -U "$postgres_user" -d postgres -Atc \
  "SELECT 1 FROM pg_database WHERE datname = '$newapi_db_name'" | grep -qx 1; then
  newapi_database_exists=1
fi

if [[ "$previous_was_newapi" == "0" && "$newapi_database_exists" == "1" ]]; then
  rollback
  die "database $newapi_db_name already exists before the first NewAPI cutover; refusing to delete or overwrite an unverified database"
fi

if [[ "$previous_was_newapi" == "1" && "$newapi_database_exists" == "0" ]]; then
  rollback
  die "the active NewAPI release has no preserved database"
fi

if [[ "$newapi_database_exists" == "0" ]]; then
  echo "Creating isolated NewAPI database $newapi_db_name"
  if ! docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
    createdb -U "$postgres_user" -O "$postgres_user" "$newapi_db_name"; then
    rollback
    die "failed to create isolated NewAPI database"
  fi
fi
if [[ "$previous_was_newapi" == "0" ]]; then
  drop_newapi_on_rollback=1
fi

source_dsn="postgresql://${postgres_user}:${postgres_password}@postgres:5432/${source_db_name}?sslmode=disable"
target_dsn="postgresql://${postgres_user}:${postgres_password}@postgres:5432/${newapi_db_name}?sslmode=disable"

echo "Blocking public Sub2API traffic during the final migration and smoke tests"
if ! install_managed_caddy_config "$newapi_regional_edge_secret" maintenance; then
  rollback
  die "failed to install the temporary Sub2API maintenance ingress"
fi
maintenance_status="$(curl -sS --noproxy '*' --max-time 10 -o /dev/null -w '%{http_code}' \
  --resolve sub2api.fatherkey.com:443:127.0.0.1 \
  https://sub2api.fatherkey.com/health || true)"
if [[ "$maintenance_status" != "403" ]]; then
  rollback
  die "temporary Sub2API maintenance ingress did not reject direct origin traffic with HTTP 403"
fi
maintenance_edge_status="$(curl -sS --max-time 20 -H 'Cache-Control: no-cache' \
  -o /dev/null -w '%{http_code}' \
  "https://sub2api.fatherkey.com/health?maintenance=$RELEASE_ID" || true)"
if [[ "$maintenance_edge_status" != "503" ]]; then
  rollback
  die "temporary Sub2API maintenance ingress did not return HTTP 503 through Cloudflare"
fi

echo "Stopping the previous public app before schema or data migration"
docker stop --time 130 sub2api >/dev/null 2>&1 || true

if ! flush_newapi_redis; then
  rollback
  die "failed to clear the isolated NewAPI Redis database before migration"
fi

if [[ "$previous_was_newapi" == "1" ]]; then
  newapi_db_backup="$KVM4_SUB2API_ROOT/backups/newapi-db.$RELEASE_ID.dump"
  install -o root -g root -m 0600 /dev/null "$newapi_db_backup"
  echo "Snapshotting the active NewAPI database before schema migration"
  if ! docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
    pg_dump --format=custom --no-owner -U "$postgres_user" "$newapi_db_name" > "$newapi_db_backup"; then
    rollback
    die "failed to snapshot the active NewAPI database"
  fi
  [[ -s "$newapi_db_backup" ]] || {
    rollback
    die "the active NewAPI database snapshot is empty"
  }
  restore_newapi_on_rollback=1
fi

echo "Starting private legacy scheduler bridge"
if ! docker compose --env-file .env -f docker-compose.local.yml up -d --no-deps legacy-sub2api; then
  rollback
  die "failed to start private legacy bridge"
fi
if ! legacy_healthcheck; then
  docker compose --env-file .env -f docker-compose.local.yml logs --tail=120 legacy-sub2api >&2 || true
  rollback
  die "private legacy bridge healthcheck failed"
fi

echo "Applying NewAPI schema migrations with the dedicated migration command"
if ! docker compose --env-file .env -f docker-compose.local.yml run --rm --no-deps \
  --entrypoint /newapi-migrate sub2api; then
  rollback
  die "NewAPI schema migration failed"
fi

if [[ "$previous_was_newapi" == "1" ]]; then
  if ! existing_migration_marker="$(docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
    psql -X -v ON_ERROR_STOP=1 -U "$postgres_user" -d "$newapi_db_name" -Atc \
    "SELECT value FROM options WHERE key = 'Sub2APIMigrationVersion'")"; then
    rollback
    die "failed to verify the preserved NewAPI migration marker"
  fi
  if [[ "$existing_migration_marker" != "sub2api-to-newapi-v1" ]]; then
    rollback
    die "the active NewAPI database has no compatible migration marker"
  fi
fi

echo "Migrating users, balances, API keys, groups, pricing, and regional policy"
if ! docker compose --env-file .env -f docker-compose.local.yml run --rm --no-deps \
  --entrypoint /sub2api-migrate \
  -e SOURCE_SQL_DSN="$source_dsn" \
  -e TARGET_SQL_DSN="$target_dsn" \
  -e SOURCE_BASE_URL=http://legacy-sub2api:8080 \
  -e BRIDGE_BASE_URL=http://legacy-sub2api:8080 \
  -e MIGRATION_VERSION=sub2api-to-newapi-v1 \
  sub2api; then
  rollback
  die "Sub2API to NewAPI data migration failed"
fi

echo "Starting NewAPI on the local Sub2API service port behind maintenance ingress"
newapi_runtime_started=1
if ! docker compose --env-file .env -f docker-compose.local.yml up -d --no-deps --force-recreate sub2api; then
  rollback
  die "failed to start NewAPI public container"
fi
if ! healthcheck; then
  docker compose --env-file .env -f docker-compose.local.yml logs --tail=200 sub2api >&2 || true
  rollback
  die "NewAPI public healthcheck failed"
fi

if ! setup_payload="$(curl -fsS --max-time 10 http://127.0.0.1:8080/api/setup)"; then
  rollback
  die "NewAPI setup endpoint is unavailable"
fi
if ! jq -e '.success == true and .data.status == true' >/dev/null <<<"$setup_payload"; then
  rollback
  die "NewAPI setup state was not initialized by the migration"
fi

if ! regional_status_payload="$(curl -fsS --max-time 10 http://127.0.0.1:8080/api/status)"; then
  rollback
  die "NewAPI public settings endpoint is unavailable"
fi
if ! jq -e '
  .success == true and
  (.data.regional_restriction_enabled | type == "boolean") and
  (.data.regional_restriction_unknown_region_policy == "allow" or
   .data.regional_restriction_unknown_region_policy == "deny")
' >/dev/null <<<"$regional_status_payload"; then
  rollback
  die "NewAPI regional restriction settings were not loaded"
fi

if ! bridge_rows="$(docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
  psql -X -v ON_ERROR_STOP=1 -U "$postgres_user" -d "$newapi_db_name" -AtF $'\t' -c \
  "SELECT key, base_url FROM channels WHERE type = 59 AND status = 1 ORDER BY id")"; then
  rollback
  die "failed to read migrated Sub2API bridge channels"
fi
bridge_count=0
while IFS=$'\t' read -r bridge_key bridge_url; do
  [[ -n "$bridge_key" && -n "$bridge_url" ]] || continue
  bridge_count=$((bridge_count + 1))
  if ! bridge_models_payload="$(docker exec sub2api wget -q -T 30 -O - \
    --header="Authorization: Bearer $bridge_key" \
    "${bridge_url%/}/v1/models")"; then
    rollback
    die "Sub2API bridge channel $bridge_count is unreachable from NewAPI"
  fi
  if ! jq -e '.data | type == "array" and length > 0' >/dev/null <<<"$bridge_models_payload"; then
    rollback
    die "Sub2API bridge channel $bridge_count returned no models"
  fi
done <<<"$bridge_rows"
if (( bridge_count == 0 )); then
  rollback
  die "no active Sub2API bridge channels were migrated"
fi

if ! source_priced_models="$(docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
  psql -X -v ON_ERROR_STOP=1 -U "$postgres_user" -d "$source_db_name" -Atc \
  "SELECT DISTINCT jsonb_array_elements_text(models) FROM channel_model_pricing WHERE billing_mode = 'token' ORDER BY 1")"; then
  rollback
  die "failed to read legacy token-priced models for end-to-end verification"
fi
smoke_group_b64=""
smoke_model_b64=""
while IFS= read -r candidate_model; do
  [[ -n "$candidate_model" ]] || continue
  candidate_model_b64="$(printf '%s' "$candidate_model" | base64 | tr -d '\n')"
  if ! smoke_route_row="$(docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
    psql -X -v ON_ERROR_STOP=1 -U "$postgres_user" -d "$newapi_db_name" -AtF $'\t' -c \
    "SELECT replace(encode(convert_to(a.\"group\", 'UTF8'), 'base64'), E'\\n', ''), replace(encode(convert_to(a.model, 'UTF8'), 'base64'), E'\\n', '') FROM abilities a JOIN channels c ON c.id = a.channel_id WHERE a.enabled AND c.status = 1 AND c.type = 59 AND a.model = convert_from(decode('$candidate_model_b64', 'base64'), 'UTF8') ORDER BY a.channel_id LIMIT 1")"; then
    rollback
    die "failed to select a migrated chat route for end-to-end verification"
  fi
  if [[ -n "$smoke_route_row" ]]; then
    IFS=$'\t' read -r smoke_group_b64 smoke_model_b64 <<<"$smoke_route_row"
    break
  fi
done <<<"$source_priced_models"
[[ -n "$smoke_group_b64" && -n "$smoke_model_b64" ]] || {
  rollback
  die "no token-priced legacy chat model has a migrated NewAPI ability"
}
if ! smoke_model="$(printf '%s' "$smoke_model_b64" | base64 -d)"; then
  rollback
  die "failed to decode the selected smoke-test model"
fi

smoke_suffix="$(openssl rand -hex 6)"
smoke_username="s2smoke-$smoke_suffix"
smoke_email="$smoke_username@internal.invalid"
smoke_aff_code="$(openssl rand -hex 8)"
smoke_token_secret="$(openssl rand -hex 32)"
smoke_dashboard_token="$(openssl rand -hex 16)"
if ! smoke_ids="$(docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
  psql -X -v ON_ERROR_STOP=1 -U "$postgres_user" -d "$newapi_db_name" -AtF $'\t' -c \
  "WITH smoke_user AS (INSERT INTO users (username, password, display_name, role, status, email, github_id, discord_id, oidc_id, wechat_id, telegram_id, linux_do_id, quota, relay_concurrency, used_quota, request_count, \"group\", aff_code, aff_count, aff_quota, aff_history, inviter_id, setting, created_at, last_login_at, auth_version, access_token) VALUES ('$smoke_username', '!smoke-disabled!', '$smoke_username', 1, 1, '$smoke_email', '', '', '', '', '', '', 5000000, 1, 0, 0, 'default', '$smoke_aff_code', 0, 0, 0, 0, '{}', EXTRACT(EPOCH FROM now())::bigint, 0, 1, '$smoke_dashboard_token') RETURNING id), smoke_token AS (INSERT INTO tokens (user_id, key, status, name, created_time, accessed_time, expired_time, remain_quota, unlimited_quota, model_limits_enabled, model_limits, allow_ips, used_quota, \"group\", cross_group_retry, auto_groups) SELECT id, '$smoke_token_secret', 1, 'Deployment relay smoke test', EXTRACT(EPOCH FROM now())::bigint, 0, EXTRACT(EPOCH FROM now() + interval '10 minutes')::bigint, 5000000, false, false, '', '', 0, convert_from(decode('$smoke_group_b64', 'base64'), 'UTF8'), false, '' FROM smoke_user RETURNING id, user_id) SELECT user_id, id FROM smoke_token")"; then
  rollback
  die "failed to create isolated NewAPI smoke-test credentials"
fi
IFS=$'\t' read -r smoke_user_id smoke_token_id <<<"$smoke_ids"
[[ "$smoke_user_id" =~ ^[0-9]+$ && "$smoke_token_id" =~ ^[0-9]+$ ]] || {
  rollback
  die "NewAPI returned invalid smoke-test credential IDs"
}
smoke_user_cleanup_pending=1
smoke_user_cache_cleanup_pending=1
smoke_key="sk-$smoke_token_secret"

if ! models_payload="$(curl -fsS --max-time 30 -H "Authorization: Bearer $smoke_key" http://127.0.0.1:8080/v1/models)"; then
  rollback
  die "isolated smoke-test key could not authenticate against NewAPI"
fi
if ! jq -e --arg model "$smoke_model" '.data | type == "array" and any(.id == $model)' >/dev/null <<<"$models_payload"; then
  rollback
  die "selected smoke-test model is not visible through the isolated NewAPI key"
fi

smoke_request="$(jq -cn --arg model "$smoke_model" '{model: $model, messages: [{role: "user", content: "Reply with OK."}], max_tokens: 1, stream: false}')"
if ! smoke_response="$(curl -fsS --max-time 120 \
  -H "Authorization: Bearer $smoke_key" \
  -H 'Content-Type: application/json' \
  --data "$smoke_request" \
  http://127.0.0.1:8080/v1/chat/completions)"; then
  rollback
  die "NewAPI to legacy bridge to provider chat smoke test failed"
fi
if ! jq -e '.choices | type == "array" and length > 0' >/dev/null <<<"$smoke_response"; then
  rollback
  die "provider chat smoke test returned no completion choice"
fi

smoke_billed=0
for _ in $(seq 1 30); do
  if docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
    psql -X -v ON_ERROR_STOP=1 -U "$postgres_user" -d "$newapi_db_name" -Atc \
    "SELECT count(*) FROM logs WHERE token_id = $smoke_token_id AND type = 2 AND model_name = convert_from(decode('$smoke_model_b64', 'base64'), 'UTF8') AND quota > 0" | grep -Eq '^[1-9][0-9]*$'; then
    smoke_billed=1
    break
  fi
  sleep 2
done
[[ "$smoke_billed" == "1" ]] || {
  rollback
  die "provider chat smoke test completed without a positive NewAPI billing log"
}

if ! deleted_smoke_token_id="$(docker exec -e PGPASSWORD="$postgres_password" sub2api-postgres \
  psql -X -v ON_ERROR_STOP=1 -U "$postgres_user" -d "$newapi_db_name" -qAtc \
  "DELETE FROM tokens WHERE id = $smoke_token_id AND user_id = $smoke_user_id RETURNING id")"; then
  rollback
  die "failed to remove isolated smoke-test API key"
fi
if [[ "$deleted_smoke_token_id" != "$smoke_token_id" ]]; then
  rollback
  die "isolated smoke-test API key deletion did not remove exactly the expected key"
fi
if ! flush_newapi_redis; then
  rollback
  die "failed to clear NewAPI caches after removing the smoke-test API key"
fi
if ! docker compose --env-file .env -f docker-compose.local.yml up -d --no-deps --force-recreate sub2api; then
  rollback
  die "failed to restart NewAPI after smoke-test cleanup"
fi
if ! healthcheck; then
  docker compose --env-file .env -f docker-compose.local.yml logs --tail=200 sub2api >&2 || true
  rollback
  die "NewAPI healthcheck failed after smoke-test cleanup"
fi

if ! local_edge_region_payload="$(curl -fsS --max-time 10 \
  -H "Authorization: Bearer $smoke_dashboard_token" \
  -H "X-NewAPI-Edge-Secret: $newapi_regional_edge_secret" \
  -H 'X-NewAPI-Edge-Country: CN' \
  'http://127.0.0.1:8080/api/token/regional-restriction?scope=api_key_page')"; then
  rollback
  die "local authenticated regional edge smoke test failed"
fi
if ! jq -e '.success == true and .data.unknown_region == false and .data.country_code == "CN"' >/dev/null <<<"$local_edge_region_payload"; then
  rollback
  die "NewAPI did not accept the authenticated local regional edge country"
fi

echo "Installing Cloudflare-only Caddy ingress for the three Sub2API domains"
if ! install_managed_caddy_config "$newapi_regional_edge_secret"; then
  rollback
  die "failed to install or reload the managed Caddy ingress"
fi
public_newapi_open=1
drop_newapi_on_rollback=0
restore_newapi_on_rollback=0
caddy_restore_needed=0
trap - ERR

direct_origin_status="$(curl -sS --noproxy '*' --max-time 10 -o /dev/null -w '%{http_code}' \
  --resolve sub2api.fatherkey.com:443:127.0.0.1 \
  https://sub2api.fatherkey.com/health || true)"
if [[ "$direct_origin_status" != "403" ]]; then
  fail_after_public_open "direct Caddy origin request was not rejected"
fi

if ! edge_region_payload="$(curl -fsS --max-time 20 \
  -H "Authorization: Bearer $smoke_dashboard_token" \
  -H 'Cache-Control: no-cache' \
  "https://sub2api.fatherkey.com/api/token/regional-restriction?scope=api_key_page&probe=$RELEASE_ID")"; then
  fail_after_public_open "Cloudflare-routed NewAPI regional status check failed"
fi
if ! jq -e '
  .success == true and
  .data.unknown_region == false and
  (.data.country_code | test("^[A-Z]{2}$"))
' >/dev/null <<<"$edge_region_payload"; then
  fail_after_public_open "Cloudflare did not provide an authenticated country to NewAPI"
fi

if ! cleanup_regional_smoke_user; then
  fail_after_public_open "failed to remove the regional smoke-test user or clear its cached credentials"
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

retry_command scp "${scp_opts[@]}" "$remote_script_path" "$remote:$remote_tmp/activate.sh"

echo "Activating NewAPI in the KVM4 Sub2API service slot"
retry_command ssh "${ssh_opts[@]}" "$remote" \
  "KVM4_SUB2API_ROOT='$KVM4_SUB2API_ROOT' RELEASE_ID='$release_id' RELEASE_COMMIT='$head_sha' KEEP_RELEASES='$KEEP_RELEASES' REMOTE_TMP='$remote_tmp' bash '$remote_tmp/activate.sh'"

echo
echo "KVM4 NewAPI release deployed in Sub2API slot: $release_id"
