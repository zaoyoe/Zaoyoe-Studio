#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KVM4_HOST="${KVM4_HOST:-76.13.188.218}"
KVM4_PORT="${KVM4_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-$HOME/.ssh/hostinger_sub2api}"
KVM4_ROOT="${KVM4_ROOT:-/opt/zaoyoe-verify-server}"
SERVICE_NAME="${SERVICE_NAME:-zaoyoe-ai-image-worker.service}"
START_NOW=0

usage() {
  cat <<'EOF'
Usage: scripts/install-kvm4-ai-image-worker.sh [options]

Install or update the KVM4 systemd service that runs the AI image queue worker.
This script only installs the service unit; it does not deploy app code or write
production secrets.

Options:
  --start         Enable and start the service after installation.
  --host HOST     SSH host. Default: KVM4_HOST or 76.13.188.218
  --port PORT     SSH port. Default: KVM4_PORT or 2222
  --user USER     SSH user. Default: KVM4_USER or root
  --key PATH      SSH private key. Default: KVM4_KEY or ~/.ssh/hostinger_sub2api
  --root PATH     Remote app root. Default: KVM4_ROOT or /opt/zaoyoe-verify-server
EOF
}

die() {
  echo "install-kvm4-ai-image-worker: $*" >&2
  exit 1
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
[[ -f deploy/kvm4/ai-image-worker/zaoyoe-ai-image-worker.service ]] || die "missing AI image worker service template"

ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
scp_opts=(-i "$KVM4_KEY" -P "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
remote="$KVM4_USER@$KVM4_HOST"
remote_tmp="/tmp/zaoyoe-ai-image-worker"

ssh "${ssh_opts[@]}" "$remote" "rm -rf '$remote_tmp' && mkdir -p '$remote_tmp'"
scp "${scp_opts[@]}" deploy/kvm4/ai-image-worker/zaoyoe-ai-image-worker.service "$remote:$remote_tmp/$SERVICE_NAME"

ssh "${ssh_opts[@]}" "$remote" "REMOTE_TMP='$remote_tmp' KVM4_ROOT='$KVM4_ROOT' SERVICE_NAME='$SERVICE_NAME' START_NOW='$START_NOW' bash -s" <<'REMOTE'
set -Eeuo pipefail

die() {
  echo "remote install ai-image-worker: $*" >&2
  exit 1
}

[[ -n "${REMOTE_TMP:-}" ]] || die "REMOTE_TMP missing"
[[ -n "${KVM4_ROOT:-}" ]] || die "KVM4_ROOT missing"
[[ -f "$REMOTE_TMP/$SERVICE_NAME" ]] || die "service template missing"
[[ -d "$KVM4_ROOT" ]] || die "$KVM4_ROOT missing; deploy verify server first"
[[ -f "$KVM4_ROOT/.env" ]] || die "$KVM4_ROOT/.env missing"

install -o root -g root -m 0644 "$REMOTE_TMP/$SERVICE_NAME" "/etc/systemd/system/$SERVICE_NAME"
rm -rf "$REMOTE_TMP"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

if [[ "${START_NOW:-0}" == "1" ]]; then
  systemctl restart "$SERVICE_NAME"
fi

systemctl status "$SERVICE_NAME" --no-pager || true
REMOTE
