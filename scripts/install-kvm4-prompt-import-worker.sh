#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KVM4_HOST="${KVM4_HOST:-76.13.188.218}"
KVM4_PORT="${KVM4_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-$HOME/.ssh/hostinger_sub2api}"
KVM4_ROOT="${KVM4_ROOT:-/opt/zaoyoe-verify-server}"
SERVICE_NAME="zaoyoe-prompt-import-worker.service"
START_NOW=0
[[ "${1:-}" == "--start" ]] && START_NOW=1
cd "$ROOT_DIR"
[[ -f "$KVM4_KEY" ]] || { echo "SSH key not found: $KVM4_KEY" >&2; exit 1; }
remote="$KVM4_USER@$KVM4_HOST"
ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT" -o ConnectTimeout=30)
scp_opts=(-i "$KVM4_KEY" -P "$KVM4_PORT" -o ConnectTimeout=30)
template="deploy/kvm4/prompt-import-worker/$SERVICE_NAME"
scp "${scp_opts[@]}" "$template" "$remote:/tmp/$SERVICE_NAME"
ssh "${ssh_opts[@]}" "$remote" "install -m 0644 /tmp/$SERVICE_NAME /etc/systemd/system/$SERVICE_NAME && rm /tmp/$SERVICE_NAME && systemctl daemon-reload && systemctl enable $SERVICE_NAME && if [[ '$START_NOW' == '1' ]]; then systemctl restart $SERVICE_NAME; fi && systemctl status $SERVICE_NAME --no-pager || true"
