#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KVM4_HOST="${KVM4_HOST:-kvm4-origin.internal}"
KVM4_PORT="${KVM4_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-${HOME:-}/.ssh/hostinger_sub2api}"
EXPECTED_COMMIT=""
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: scripts/install-kvm4-offsite-backup.sh --expected-commit FULL_MAIN_SHA [options]

Install the encrypted R2 full-stack offsite backup systemd units on KVM4 without
starting timers automatically:
  - deploy/kvm4/offsite-backup/zaoyoe-offsite-backup.service
  - deploy/kvm4/offsite-backup/zaoyoe-offsite-backup.timer

Options:
  --expected-commit SHA  Full 40-character commit matching verified main.
  --host HOST            SSH host (default: KVM4_HOST or kvm4-origin.internal).
  --port PORT            SSH port (default: KVM4_PORT or 2222).
  --user USER            SSH user (default: KVM4_USER or root).
  --key PATH             SSH private key (default: KVM4_KEY or ~/.ssh/hostinger_sub2api).
  --dry-run              Check artifact presence and syntax locally without networking.
EOF
}

die() { echo "install-kvm4-offsite-backup: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected-commit) [[ $# -ge 2 ]] || die 'expected commit missing'; EXPECTED_COMMIT="$2"; shift 2 ;;
    --host) [[ $# -ge 2 ]] || die 'host missing'; KVM4_HOST="$2"; shift 2 ;;
    --port) [[ $# -ge 2 ]] || die 'port missing'; KVM4_PORT="$2"; shift 2 ;;
    --user) [[ $# -ge 2 ]] || die 'user missing'; KVM4_USER="$2"; shift 2 ;;
    --key) [[ $# -ge 2 ]] || die 'key missing'; KVM4_KEY="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]] || die '--expected-commit requires a full lowercase SHA'
[[ "$KVM4_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || die 'invalid SSH host'
[[ "$KVM4_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || die 'invalid SSH user'
[[ "$KVM4_PORT" =~ ^[0-9]+$ && "$KVM4_PORT" -ge 1 && "$KVM4_PORT" -le 65535 ]] || die 'invalid SSH port'

cd "$ROOT_DIR"

ARTIFACT_DIR="deploy/kvm4/offsite-backup"
REQUIRED_ARTIFACTS=(
  "zaoyoe-offsite-backup.service"
  "zaoyoe-offsite-backup.timer"
)

for artifact in "${REQUIRED_ARTIFACTS[@]}"; do
  [[ -f "$ARTIFACT_DIR/$artifact" ]] || die "missing artifact: $ARTIFACT_DIR/$artifact"
done
[[ -f "scripts/backup-offsite-r2.js" ]] || die "missing script: scripts/backup-offsite-r2.js"
node --check scripts/backup-offsite-r2.js

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[dry-run] Preflight checks passed for offsite-backup units and backup script syntax."
  exit 0
fi

[[ "$(git remote)" == "origin" ]] || die 'installation requires the single canonical origin remote'
[[ "$(git config --get-all remote.origin.url)" == 'https://github.com/zaoyoe/Zaoyoe-Studio.git' ]] \
  || die 'origin must use the canonical HTTPS repository'
[[ "$(git symbolic-ref --quiet --short HEAD)" == 'main' ]] || die 'installation requires main'
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || die 'installation requires a clean checkout'
git fetch origin main
[[ "$(git rev-parse HEAD)" == "$EXPECTED_COMMIT" ]] || die 'HEAD does not match expected commit'
[[ "$(git rev-parse refs/remotes/origin/main)" == "$EXPECTED_COMMIT" ]] || die 'expected commit is not latest origin/main'

STAGED_DIR="$(mktemp -d "${TMPDIR:-/tmp}/zaoyoe-offsite-backup.XXXXXX")"
trap 'rm -rf "$STAGED_DIR"' EXIT
for artifact in "${REQUIRED_ARTIFACTS[@]}"; do
  git show "$EXPECTED_COMMIT:$ARTIFACT_DIR/$artifact" > "$STAGED_DIR/$artifact"
  [[ -s "$STAGED_DIR/$artifact" ]] || die "empty committed artifact: $artifact"
done

[[ -f "$KVM4_KEY" ]] || die "SSH key file missing: $KVM4_KEY"

ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
scp_opts=(-i "$KVM4_KEY" -P "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

ssh "${ssh_opts[@]}" "$KVM4_USER@$KVM4_HOST" bash -s -- "$EXPECTED_COMMIT" <<'REMOTE_EOF'
set -Eeuo pipefail
expected_commit="$1"
[[ "$(cat /opt/zaoyoe-verify-server/.current-release)" == "$expected_commit" ]] || {
  echo 'KVM4 verify-server release does not match reviewed main commit' >&2
  exit 1
}
[[ -f /opt/zaoyoe-verify-server/app/scripts/backup-offsite-r2.js ]] || {
  echo 'Missing /opt/zaoyoe-verify-server/app/scripts/backup-offsite-r2.js' >&2
  exit 1
}
REMOTE_EOF

scp "${scp_opts[@]}" \
  "$STAGED_DIR/zaoyoe-offsite-backup.service" \
  "$STAGED_DIR/zaoyoe-offsite-backup.timer" \
  "$KVM4_USER@$KVM4_HOST:/etc/systemd/system/"

ssh "${ssh_opts[@]}" "$KVM4_USER@$KVM4_HOST" "systemctl daemon-reload"
echo "Installed zaoyoe-offsite-backup units on KVM4. Enable timer manually after verifying .env R2 credentials."
