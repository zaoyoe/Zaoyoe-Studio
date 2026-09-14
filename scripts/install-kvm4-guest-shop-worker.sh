#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KVM4_HOST="${KVM4_HOST:-76.13.188.218}"
KVM4_PORT="${KVM4_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-${HOME:-}/.ssh/hostinger_sub2api}"
# The verify-server deployment contract uses one canonical root.  The unit
# file is intentionally static (it is not a template), so accepting a custom
# root here would pass the preflight checks but install a service that loads a
# different .env path.  Fail closed instead of silently creating that split.
CANONICAL_KVM4_ROOT="/opt/zaoyoe-verify-server"
REQUESTED_KVM4_ROOT="${KVM4_ROOT:-}"
KVM4_ROOT="$CANONICAL_KVM4_ROOT"
SERVICE_NAME="zaoyoe-guest-shop-worker.service"
TIMER_NAME="zaoyoe-guest-shop-worker.timer"
START_NOW=0

usage() {
  cat <<'EOF'
Usage: scripts/install-kvm4-guest-shop-worker.sh [options]

Install the KVM4 systemd timer that calls the local guest-shop worker endpoint.
This installs scheduler files only; it does not deploy app code, change the
database, or write/print production secrets. The timer is enabled but remains
stopped unless --start is supplied.

Options:
  --start         Enable and start the timer after installation.
  --host HOST     SSH host (KVM4_HOST or 76.13.188.218).
  --port PORT     SSH port (KVM4_PORT or 2222).
  --user USER     SSH user (KVM4_USER or root).
  --key PATH      SSH private key (KVM4_KEY or ~/.ssh/hostinger_sub2api).
  The remote app root is fixed at /opt/zaoyoe-verify-server to match the
  systemd unit. Custom --root/KVM4_ROOT values are rejected.
EOF
}

die() {
  echo "install-kvm4-guest-shop-worker: $*" >&2
  exit 1
}

validate_root() {
  local requested="${1:-}"
  if [[ -n "$requested" && "$requested" != "$CANONICAL_KVM4_ROOT" ]]; then
    die "custom KVM4_ROOT is unsupported; use $CANONICAL_KVM4_ROOT (the systemd unit is fixed to this root)"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start)
      START_NOW=1
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
      validate_root "${2:-}"
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

validate_root "$REQUESTED_KVM4_ROOT"

cd "$ROOT_DIR"

[[ -f "$KVM4_KEY" ]] || die "SSH key not found: $KVM4_KEY"
[[ -f deploy/kvm4/guest-shop-worker/zaoyoe-guest-shop-worker ]] || die "missing guest worker helper"
[[ -f deploy/kvm4/guest-shop-worker/$SERVICE_NAME ]] || die "missing guest worker service"
[[ -f deploy/kvm4/guest-shop-worker/$TIMER_NAME ]] || die "missing guest worker timer"

ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
scp_opts=(-i "$KVM4_KEY" -P "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
remote="$KVM4_USER@$KVM4_HOST"
remote_tmp="/tmp/zaoyoe-guest-shop-worker-install"

ssh "${ssh_opts[@]}" "$remote" "rm -rf '$remote_tmp' && mkdir -p '$remote_tmp'"
scp "${scp_opts[@]}" \
  deploy/kvm4/guest-shop-worker/zaoyoe-guest-shop-worker \
  deploy/kvm4/guest-shop-worker/"$SERVICE_NAME" \
  deploy/kvm4/guest-shop-worker/"$TIMER_NAME" \
  "$remote:$remote_tmp/"

ssh "${ssh_opts[@]}" "$remote" "REMOTE_TMP='$remote_tmp' KVM4_ROOT='$KVM4_ROOT' SERVICE_NAME='$SERVICE_NAME' TIMER_NAME='$TIMER_NAME' START_NOW='$START_NOW' bash -s" <<'REMOTE'
set -Eeuo pipefail

die() {
  echo "remote install guest-shop-worker: $*" >&2
  exit 1
}

[[ -n "${REMOTE_TMP:-}" ]] || die "REMOTE_TMP missing"
[[ -n "${KVM4_ROOT:-}" ]] || die "KVM4_ROOT missing"
[[ -f "$REMOTE_TMP/zaoyoe-guest-shop-worker" ]] || die "worker helper missing"
[[ -f "$REMOTE_TMP/$SERVICE_NAME" ]] || die "worker service missing"
[[ -f "$REMOTE_TMP/$TIMER_NAME" ]] || die "worker timer missing"
[[ -d "$KVM4_ROOT" ]] || die "$KVM4_ROOT missing; deploy verify server first"
[[ -f "$KVM4_ROOT/.env" ]] || die "$KVM4_ROOT/.env missing"

# Keep the static unit and installer contract in lockstep.  If somebody edits
# the artifact to point at another .env, abort before replacing a live unit.
grep -Fqx "ConditionPathExists=$KVM4_ROOT/.env" "$REMOTE_TMP/$SERVICE_NAME" || die "worker service root does not match $KVM4_ROOT"
grep -Fqx "EnvironmentFile=$KVM4_ROOT/.env" "$REMOTE_TMP/$SERVICE_NAME" || die "worker service environment path does not match $KVM4_ROOT"

install -o root -g root -m 0750 "$REMOTE_TMP/zaoyoe-guest-shop-worker" /usr/local/sbin/zaoyoe-guest-shop-worker
install -o root -g root -m 0644 "$REMOTE_TMP/$SERVICE_NAME" "/etc/systemd/system/$SERVICE_NAME"
install -o root -g root -m 0644 "$REMOTE_TMP/$TIMER_NAME" "/etc/systemd/system/$TIMER_NAME"
rm -rf "$REMOTE_TMP"

systemctl daemon-reload
systemctl enable "$TIMER_NAME"
if [[ "${START_NOW:-0}" == "1" ]]; then
  systemctl start "$TIMER_NAME"
fi

systemctl status "$TIMER_NAME" --no-pager || true
systemctl list-timers --all --no-pager | grep "$TIMER_NAME" || true
REMOTE
