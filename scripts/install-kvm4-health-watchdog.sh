#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KVM4_HOST="${KVM4_HOST:-76.13.188.218}"
KVM4_PORT="${KVM4_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-$HOME/.ssh/hostinger_sub2api}"

usage() {
  cat <<'EOF'
Usage: scripts/install-kvm4-health-watchdog.sh [options]

Install or update the KVM4 systemd watchdog that auto-recovers Zaoyoe services.

Options:
  --host HOST     SSH host. Default: KVM4_HOST or 76.13.188.218
  --port PORT     SSH port. Default: KVM4_PORT or 2222
  --user USER     SSH user. Default: KVM4_USER or root
  --key PATH      SSH private key. Default: KVM4_KEY or ~/.ssh/hostinger_sub2api
EOF
}

die() {
  echo "install-kvm4-health-watchdog: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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
[[ -f deploy/kvm4/watchdog/kvm4-health-watchdog.sh ]] || die "missing watchdog script"
[[ -f deploy/kvm4/watchdog/zaoyoe-kvm4-health-watchdog.service ]] || die "missing watchdog service"
[[ -f deploy/kvm4/watchdog/zaoyoe-kvm4-health-watchdog.timer ]] || die "missing watchdog timer"

ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT")
scp_opts=(-i "$KVM4_KEY" -P "$KVM4_PORT")
remote="$KVM4_USER@$KVM4_HOST"
remote_tmp="/tmp/zaoyoe-kvm4-health-watchdog"

ssh "${ssh_opts[@]}" "$remote" "rm -rf '$remote_tmp' && mkdir -p '$remote_tmp'"
scp "${scp_opts[@]}" \
  deploy/kvm4/watchdog/kvm4-health-watchdog.sh \
  deploy/kvm4/watchdog/zaoyoe-kvm4-health-watchdog.service \
  deploy/kvm4/watchdog/zaoyoe-kvm4-health-watchdog.timer \
  "$remote:$remote_tmp/"

ssh "${ssh_opts[@]}" "$remote" "REMOTE_TMP='$remote_tmp' bash -s" <<'REMOTE'
set -Eeuo pipefail

install -o root -g root -m 0755 "$REMOTE_TMP/kvm4-health-watchdog.sh" /usr/local/sbin/zaoyoe-kvm4-health-watchdog
install -o root -g root -m 0644 "$REMOTE_TMP/zaoyoe-kvm4-health-watchdog.service" /etc/systemd/system/zaoyoe-kvm4-health-watchdog.service
install -o root -g root -m 0644 "$REMOTE_TMP/zaoyoe-kvm4-health-watchdog.timer" /etc/systemd/system/zaoyoe-kvm4-health-watchdog.timer
rm -rf "$REMOTE_TMP"

systemctl daemon-reload
systemctl enable --now zaoyoe-kvm4-health-watchdog.timer
systemctl start zaoyoe-kvm4-health-watchdog.service
systemctl status zaoyoe-kvm4-health-watchdog.service --no-pager
systemctl list-timers --all --no-pager | grep zaoyoe-kvm4-health-watchdog
REMOTE
