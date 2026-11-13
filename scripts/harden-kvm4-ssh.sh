#!/usr/bin/env bash
set -Eeuo pipefail

KVM4_HOST="${KVM4_HOST:-kvm4-origin.internal}"
SSH_HARDEN_PORT="${SSH_HARDEN_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-${HOME:-}/.ssh/hostinger_sub2api}"
DRY_RUN=1
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/harden-kvm4-ssh.sh [options]

Verify SSH connectivity on port 2222 first, then safely harden sshd on KVM4:
  - Ensures Port 2222 is active and passes sshd -t validation
  - Removes Port 22 listeners from /etc/ssh/sshd_config (backup created)
  - Disables password/keyboard-interactive authentication (pubkey only)

Defaults to --dry-run (preflight check only). Pass --apply to modify remote sshd.

Options:
  --apply            Apply sshd configuration on remote host after preflight passes.
  --dry-run          Verify port 2222 key auth only without changing sshd config.
  --host HOST        Target SSH host (default: KVM4_HOST or kvm4-origin.internal).
  --port PORT        Hardened SSH port (default: 2222).
  --user USER        SSH user (default: root).
  --key PATH         SSH private key (default: ~/.ssh/hostinger_sub2api).
EOF
}

die() { echo "harden-kvm4-ssh: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; DRY_RUN=0; shift ;;
    --dry-run) DRY_RUN=1; APPLY=0; shift ;;
    --host) KVM4_HOST="${2:-}"; shift 2 ;;
    --port) SSH_HARDEN_PORT="${2:-}"; shift 2 ;;
    --user) KVM4_USER="${2:-}"; shift 2 ;;
    --key) KVM4_KEY="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[[ "$KVM4_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || die 'invalid SSH host'
[[ "$KVM4_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || die 'invalid SSH user'
[[ "$SSH_HARDEN_PORT" =~ ^[0-9]+$ && "$SSH_HARDEN_PORT" -ge 1024 && "$SSH_HARDEN_PORT" -le 65535 && "$SSH_HARDEN_PORT" -ne 22 ]] \
  || die '--port must be an unprivileged/non-22 hardened SSH port (e.g. 2222)'

if [[ "$DRY_RUN" == "1" && "${KVM4_SKIP_SSH_PROBE:-0}" == "1" ]]; then
  echo "harden-kvm4-ssh: dry-run syntax check ok (port=${SSH_HARDEN_PORT})"
  exit 0
fi

[[ -f "$KVM4_KEY" ]] || die "SSH key file missing: $KVM4_KEY"

ssh_opts=(-i "$KVM4_KEY" -p "$SSH_HARDEN_PORT" -o BatchMode=yes -o ConnectTimeout=15)

echo "==> Verifying key auth on hardened SSH port ${SSH_HARDEN_PORT}..."
ssh "${ssh_opts[@]}" "$KVM4_USER@$KVM4_HOST" "echo ssh-port-${SSH_HARDEN_PORT}-ok"

if [[ "$APPLY" != "1" ]]; then
  echo "Preflight passed on port ${SSH_HARDEN_PORT}. Re-run with --apply to remove Port 22 and password auth."
  exit 0
fi

echo "==> Applying sshd hardening on ${KVM4_HOST} (port ${SSH_HARDEN_PORT} only)..."
ssh "${ssh_opts[@]}" "$KVM4_USER@$KVM4_HOST" bash -s -- "$SSH_HARDEN_PORT" <<'REMOTE_EOF'
set -Eeuo pipefail
hardened_port="$1"
timestamp="$(date -u +%Y%m%d%H%M%S)"
cp -a /etc/ssh/sshd_config "/etc/ssh/sshd_config.bak.${timestamp}"

mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-zaoyoe-hardening.conf <<CONF
# Managed by Zaoyoe security hardening
Port ${hardened_port}
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
CONF
chmod 0644 /etc/ssh/sshd_config.d/99-zaoyoe-hardening.conf

# Remove explicit Port 22 directives while preserving all other config lines
sed -i.pre22 -E '/^[[:space:]]*Port[[:space:]]+22([[:space:]]|$)/d' /etc/ssh/sshd_config

if ! sshd -t; then
  mv "/etc/ssh/sshd_config.bak.${timestamp}" /etc/ssh/sshd_config
  rm -f /etc/ssh/sshd_config.d/99-zaoyoe-hardening.conf
  echo 'sshd -t validation failed; rolled back sshd configuration' >&2
  exit 1
fi

if systemctl is-active --quiet ssh; then
  systemctl reload ssh
elif systemctl is-active --quiet sshd; then
  systemctl reload sshd
fi

echo "Verified sshd config on port ${hardened_port}; Port 22 removed."
REMOTE_EOF
