#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KVM4_HOST="${KVM4_HOST:-kvm4-origin.internal}"
KVM4_PORT="${KVM4_PORT:-22}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-${HOME:-}/.ssh/hostinger_sub2api}"
EXPECTED_COMMIT=""
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: scripts/install-kvm4-security-maintenance.sh --expected-commit FULL_MAIN_SHA [options]

Install the security maintenance wrappers and units on KVM4 without enabling timers:
1. zaoyoe-cdk-shredder (Daily 03:30 expired-CDK ciphertext cleanup)
2. zaoyoe-db-security-audit (Every 6h database exposure audit)

Options:
  --expected-commit SHA  Full 40-character commit matching verified main.
  --host HOST            SSH host (default: KVM4_HOST).
  --port PORT            SSH port (default: KVM4_PORT or 22).
  --user USER            SSH user (default: KVM4_USER or root).
  --key PATH             SSH private key (default: KVM4_KEY or ~/.ssh/hostinger_sub2api).
  --dry-run              Check artifact presence and shell syntax only, without networking.

Live installation requires a clean latest main and a matching KVM4 release.
Existing active/enabled maintenance units must be reconciled before replacement.
Database migrations, retention policy and cleanup eligibility must be reviewed
separately before an operator enables timers. This installer never starts them.
EOF
}

die() { echo "install-kvm4-security-maintenance: $*" >&2; exit 1; }

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

ARTIFACT_DIR="deploy/kvm4/security-maintenance"
REQUIRED_ARTIFACTS=(
  "zaoyoe-cdk-shredder"
  "zaoyoe-cdk-shredder.service"
  "zaoyoe-cdk-shredder.timer"
  "zaoyoe-db-security-audit"
  "zaoyoe-db-security-audit.service"
  "zaoyoe-db-security-audit.timer"
)

for artifact in "${REQUIRED_ARTIFACTS[@]}"; do
  [[ -f "$ARTIFACT_DIR/$artifact" ]] || die "missing artifact: $ARTIFACT_DIR/$artifact"
done

for wrapper in zaoyoe-cdk-shredder zaoyoe-db-security-audit; do
  bash -n "$ARTIFACT_DIR/$wrapper"
done

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[dry-run] Preflight checks passed for artifact presence and shell syntax only."
  echo "[dry-run] Release, systemd, database and timer readiness: NOT CHECKED. No timers started."
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

# Upload the reviewed commit contents even if the checkout changes after preflight.
STAGED_ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/zaoyoe-security-units.XXXXXX")"
trap 'rm -rf "$STAGED_ARTIFACT_DIR"' EXIT
for artifact in "${REQUIRED_ARTIFACTS[@]}"; do
  git show "$EXPECTED_COMMIT:$ARTIFACT_DIR/$artifact" > "$STAGED_ARTIFACT_DIR/$artifact"
  [[ -s "$STAGED_ARTIFACT_DIR/$artifact" ]] || die "empty committed artifact: $artifact"
done
for wrapper in zaoyoe-cdk-shredder zaoyoe-db-security-audit; do
  bash -n "$STAGED_ARTIFACT_DIR/$wrapper"
done

[[ -f "$KVM4_KEY" ]] || die "SSH key file missing: $KVM4_KEY"

ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
scp_opts=(-i "$KVM4_KEY" -P "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

echo "==> Verifying KVM4 verify-server release..."
ssh "${ssh_opts[@]}" "$KVM4_USER@$KVM4_HOST" bash -s -- "$EXPECTED_COMMIT" <<'REMOTE_EOF'
set -Eeuo pipefail
expected_commit="$1"
[[ "$(cat /opt/zaoyoe-verify-server/.current-release)" == "$expected_commit" ]] || {
  echo 'KVM4 release does not match the reviewed main commit' >&2; exit 1;
}
for unit in zaoyoe-cdk-shredder.service zaoyoe-cdk-shredder.timer zaoyoe-db-security-audit.service zaoyoe-db-security-audit.timer; do
  if systemctl is-active --quiet "$unit"; then
    echo "Refusing to replace active maintenance unit: $unit" >&2; exit 1;
  fi
done
for timer in zaoyoe-cdk-shredder.timer zaoyoe-db-security-audit.timer; do
  if systemctl is-enabled --quiet "$timer"; then
    echo "Refusing to replace enabled maintenance timer: $timer" >&2; exit 1;
  fi
done
REMOTE_EOF

echo "==> Uploading security maintenance wrappers and systemd units..."
scp "${scp_opts[@]}" \
  "$STAGED_ARTIFACT_DIR/zaoyoe-cdk-shredder" \
  "$STAGED_ARTIFACT_DIR/zaoyoe-db-security-audit" \
  "$KVM4_USER@$KVM4_HOST:/usr/local/sbin/"

ssh "${ssh_opts[@]}" "$KVM4_USER@$KVM4_HOST" "chmod 0755 /usr/local/sbin/zaoyoe-cdk-shredder /usr/local/sbin/zaoyoe-db-security-audit"

scp "${scp_opts[@]}" \
  "$STAGED_ARTIFACT_DIR/zaoyoe-cdk-shredder.service" \
  "$STAGED_ARTIFACT_DIR/zaoyoe-cdk-shredder.timer" \
  "$STAGED_ARTIFACT_DIR/zaoyoe-db-security-audit.service" \
  "$STAGED_ARTIFACT_DIR/zaoyoe-db-security-audit.timer" \
  "$KVM4_USER@$KVM4_HOST:/etc/systemd/system/"

echo "==> Reloading systemd; leaving maintenance timers disabled..."
ssh "${ssh_opts[@]}" "$KVM4_USER@$KVM4_HOST" bash <<'REMOTE_EOF'
set -Eeuo pipefail
systemctl daemon-reload
# Enabling a Persistent timer can immediately run missed destructive work.
# Installation deliberately does not enable or start either maintenance job.
REMOTE_EOF

echo "==> Security maintenance artifacts installed. Timers were not enabled or started."
