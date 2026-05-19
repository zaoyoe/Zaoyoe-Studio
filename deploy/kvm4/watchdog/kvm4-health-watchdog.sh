#!/usr/bin/env bash
set -Eeuo pipefail

VERIFY_ROOT="${VERIFY_ROOT:-/opt/zaoyoe-verify-server}"
SUB2API_ROOT="${SUB2API_ROOT:-/opt/sub2api}"
VERIFY_SERVICE="${VERIFY_SERVICE:-verify-server}"
SUB2API_SERVICE="${SUB2API_SERVICE:-sub2api}"
VERIFY_CONTAINER="${VERIFY_CONTAINER:-zaoyoe-verify-server}"
SUB2API_CONTAINER="${SUB2API_CONTAINER:-sub2api}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-sub2api-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-sub2api-redis}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
REDIS_SERVICE="${REDIS_SERVICE:-redis}"
VERIFY_HEALTH_URL="${VERIFY_HEALTH_URL:-http://127.0.0.1:3001/healthz}"
SUB2API_HEALTH_URL="${SUB2API_HEALTH_URL:-http://127.0.0.1:8080/v1/models}"
HTTP_TIMEOUT_SECONDS="${HTTP_TIMEOUT_SECONDS:-5}"
LOG_TAG="${LOG_TAG:-zaoyoe-kvm4-watchdog}"

FAILED=0

log() {
  local message="$*"
  printf '[%s] %s\n' "$(date -Is)" "$message"
  logger -t "$LOG_TAG" -- "$message" 2>/dev/null || true
}

container_state() {
  local container="$1"
  docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-health{{end}}' "$container" 2>/dev/null || printf 'missing missing'
}

container_is_healthy() {
  local container="$1"
  local state health
  read -r state health < <(container_state "$container")

  [[ "$state" == "running" && ( "$health" == "healthy" || "$health" == "no-health" ) ]]
}

container_is_starting() {
  local container="$1"
  local state health
  read -r state health < <(container_state "$container")

  [[ "$state" == "running" && "$health" == "starting" ]]
}

http_is_healthy() {
  local url="$1"
  curl -fsS --max-time "$HTTP_TIMEOUT_SECONDS" "$url" >/dev/null
}

compose_up() {
  local root="$1"
  shift

  if [[ ! -d "$root" ]]; then
    log "missing compose root: $root"
    return 1
  fi

  (cd "$root" && docker compose "$@")
}

restart_verify() {
  log "restarting $VERIFY_CONTAINER via $VERIFY_ROOT"
  compose_up "$VERIFY_ROOT" up -d --force-recreate "$VERIFY_SERVICE" >/dev/null
}

restart_sub2api() {
  log "restarting $SUB2API_CONTAINER via $SUB2API_ROOT"
  compose_up "$SUB2API_ROOT" -f docker-compose.local.yml up -d --force-recreate "$SUB2API_SERVICE" >/dev/null
}

recover_sub2api_dependency() {
  local service="$1"
  local container="$2"
  local label="$3"

  if container_is_healthy "$container"; then
    log "$label container healthy"
    return 0
  fi

  if container_is_starting "$container"; then
    log "$label container is still starting"
    return 0
  fi

  log "$label container unhealthy: $(container_state "$container"); asking compose to start $service"
  compose_up "$SUB2API_ROOT" -f docker-compose.local.yml up -d "$service" >/dev/null || true
  sleep 6

  if container_is_healthy "$container" || container_is_starting "$container"; then
    log "$label container recovered or is starting"
    return 0
  fi

  log "$label container still unhealthy: $(container_state "$container")"
  FAILED=1
  return 1
}

check_verify() {
  if container_is_healthy "$VERIFY_CONTAINER" && http_is_healthy "$VERIFY_HEALTH_URL"; then
    log "$VERIFY_CONTAINER healthy"
    return 0
  fi

  if container_is_starting "$VERIFY_CONTAINER"; then
    log "$VERIFY_CONTAINER is still starting"
    return 0
  fi

  log "$VERIFY_CONTAINER failed health check; state=$(container_state "$VERIFY_CONTAINER")"
  if restart_verify; then
    sleep 8
    if container_is_healthy "$VERIFY_CONTAINER" && http_is_healthy "$VERIFY_HEALTH_URL"; then
      log "$VERIFY_CONTAINER recovered after restart"
      return 0
    fi
  fi

  log "$VERIFY_CONTAINER still unhealthy after recovery attempt; state=$(container_state "$VERIFY_CONTAINER")"
  FAILED=1
}

check_sub2api() {
  recover_sub2api_dependency "$POSTGRES_SERVICE" "$POSTGRES_CONTAINER" "sub2api postgres" || true
  recover_sub2api_dependency "$REDIS_SERVICE" "$REDIS_CONTAINER" "sub2api redis" || true

  if container_is_healthy "$SUB2API_CONTAINER" && http_is_healthy "$SUB2API_HEALTH_URL"; then
    log "$SUB2API_CONTAINER healthy"
    return 0
  fi

  if container_is_starting "$SUB2API_CONTAINER"; then
    log "$SUB2API_CONTAINER is still starting"
    return 0
  fi

  log "$SUB2API_CONTAINER failed health check; state=$(container_state "$SUB2API_CONTAINER")"
  if restart_sub2api; then
    sleep 10
    if container_is_healthy "$SUB2API_CONTAINER" && http_is_healthy "$SUB2API_HEALTH_URL"; then
      log "$SUB2API_CONTAINER recovered after restart"
      return 0
    fi
  fi

  log "$SUB2API_CONTAINER still unhealthy after recovery attempt; state=$(container_state "$SUB2API_CONTAINER")"
  FAILED=1
}

check_verify
check_sub2api

exit "$FAILED"
