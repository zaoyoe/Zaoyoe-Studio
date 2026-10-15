#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KVM4_HOST="${KVM4_HOST:-76.13.188.218}"
KVM4_PORT="${KVM4_PORT:-2222}"
KVM4_USER="${KVM4_USER:-root}"
KVM4_KEY="${KVM4_KEY:-${HOME:-}/.ssh/hostinger_sub2api}"
CANONICAL_KVM4_ROOT="/opt/zaoyoe-verify-server"
EXPECTED_COMMIT=""
SERVICE_NAME="zaoyoe-tg-worker.service"
TIMER_NAME="zaoyoe-tg-worker.timer"

usage() {
  cat <<'EOF'
Usage: scripts/install-kvm4-tg-worker.sh --expected-commit FULL_MAIN_SHA [options]

Install the independent TG worker scheduler after the matching main commit is
healthy on KVM4 Verify Server. The timer remains disabled and stopped. This
does not deploy app code, execute SQL, buy from GRAMIX, or edit secrets.

Options:
  --expected-commit SHA  Full 40-character commit, matching clean local main.
  --host HOST            SSH host (KVM4_HOST or 76.13.188.218).
  --port PORT            SSH port (KVM4_PORT or 2222).
  --user USER            SSH user (KVM4_USER or root).
  --key PATH             SSH private key (KVM4_KEY or ~/.ssh/hostinger_sub2api).

The app root is fixed at /opt/zaoyoe-verify-server. Custom --root/KVM4_ROOT
values and --start are unsupported. Starting/enabling the timer is a separate
explicit operation after readiness and manual launch evidence are complete.
After editing the compose env_file, recreate verify-server before checking
the scheduler. A restart does not reload the container environment.
EOF
}
die() { echo "install-kvm4-tg-worker: $*" >&2; exit 1; }
[[ -z "${KVM4_ROOT:-}" || "$KVM4_ROOT" == "$CANONICAL_KVM4_ROOT" ]] || die 'custom KVM4_ROOT is unsupported'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected-commit) [[ $# -ge 2 ]] || die 'expected commit missing'; EXPECTED_COMMIT="$2"; shift 2 ;;
    --host) [[ $# -ge 2 ]] || die 'host missing'; KVM4_HOST="$2"; shift 2 ;;
    --port) [[ $# -ge 2 ]] || die 'port missing'; KVM4_PORT="$2"; shift 2 ;;
    --user) [[ $# -ge 2 ]] || die 'user missing'; KVM4_USER="$2"; shift 2 ;;
    --key) [[ $# -ge 2 ]] || die 'key missing'; KVM4_KEY="$2"; shift 2 ;;
    --root) die 'custom --root is unsupported; root is fixed' ;;
    --start) die 'starting the timer is a separate explicit launch step' ;;
    -h|--help) usage; exit 0 ;;
    *) die 'unknown option' ;;
  esac
done
[[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]] || die '--expected-commit requires a full lowercase SHA'
[[ "$KVM4_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || die 'invalid SSH host'
[[ "$KVM4_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || die 'invalid SSH user'
[[ "$KVM4_PORT" =~ ^[0-9]+$ && "$KVM4_PORT" -ge 1 && "$KVM4_PORT" -le 65535 ]] || die 'invalid SSH port'
cd "$ROOT_DIR"
[[ "$(git branch --show-current)" == 'main' ]] || die 'install only from latest clean main after deployment'
[[ "$(git rev-parse HEAD)" == "$EXPECTED_COMMIT" ]] || die 'expected commit differs from local main'
[[ -z "$(git status --porcelain)" ]] || die 'local main must be clean'
remote_main="$(git ls-remote --exit-code origin refs/heads/main)" || die 'cannot verify latest origin/main'
[[ "$remote_main" == "$EXPECTED_COMMIT"$'\trefs/heads/main' ]] || die 'expected commit is not latest origin/main'
[[ -f "$KVM4_KEY" ]] || die 'SSH key file missing'

ARTIFACT_DIR="deploy/kvm4/tg-worker"
for artifact in zaoyoe-tg-worker zaoyoe-tg-worker.cjs "$SERVICE_NAME" "$TIMER_NAME"; do
  [[ -f "$ARTIFACT_DIR/$artifact" ]] || die 'scheduler artifact missing'
done

ssh_opts=(-i "$KVM4_KEY" -p "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
scp_opts=(-i "$KVM4_KEY" -P "$KVM4_PORT" -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
remote="$KVM4_USER@$KVM4_HOST"
remote_tmp="/tmp/zaoyoe-tg-worker-install.$EXPECTED_COMMIT.$$"
ssh "${ssh_opts[@]}" "$remote" "umask 077; mkdir '$remote_tmp'"
scp "${scp_opts[@]}" "$ARTIFACT_DIR/zaoyoe-tg-worker" "$ARTIFACT_DIR/zaoyoe-tg-worker.cjs" \
  "$ARTIFACT_DIR/$SERVICE_NAME" "$ARTIFACT_DIR/$TIMER_NAME" "$remote:$remote_tmp/"

ssh "${ssh_opts[@]}" "$remote" "REMOTE_TMP='$remote_tmp' EXPECTED_COMMIT='$EXPECTED_COMMIT' bash -s" <<'REMOTE'
set -Eeuo pipefail
ROOT="/opt/zaoyoe-verify-server"
SERVICE_NAME="zaoyoe-tg-worker.service"
TIMER_NAME="zaoyoe-tg-worker.timer"
die() { echo "remote install tg-worker: $*" >&2; exit 1; }
[[ "${REMOTE_TMP:-}" =~ ^/tmp/zaoyoe-tg-worker-install\.[0-9a-f]{40}\.[0-9]+$ ]] || die 'invalid staging directory'
trap 'rm -rf -- "$REMOTE_TMP"' EXIT
[[ "${EXPECTED_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]] || die 'invalid expected commit'
[[ "$(id -u)" == '0' ]] || die 'root is required for systemd installation'
[[ -f "$ROOT/.env" && -f "$ROOT/.current-release" ]] || die 'deploy Verify Server and configure env_file first'
[[ "$(stat -c '%a:%u' "$ROOT/.env")" == '600:0' ]] || die 'env_file must be root-owned mode 0600'
[[ "$(cat "$ROOT/.current-release")" == "$EXPECTED_COMMIT" ]] || die 'deployed release differs from expected commit'
app_root="$(readlink -f "$ROOT/app")"
[[ "$app_root" == "$ROOT/releases/"*/app ]] || die 'unexpected release layout'
[[ "$(cat "$app_root/../.commit")" == "$EXPECTED_COMMIT" ]] || die 'application release differs from expected commit'
[[ -f "$app_root/scripts/tg-fulfillment-worker.js" ]] || die 'deployed release has no TG worker'
[[ -f "$app_root/scripts/tg-readiness.js" ]] || die 'deployed release has no TG readiness checker'
for artifact in zaoyoe-tg-worker zaoyoe-tg-worker.cjs "$SERVICE_NAME" "$TIMER_NAME"; do
  [[ -f "$REMOTE_TMP/$artifact" ]] || die 'staged scheduler artifact missing'
  cmp -s "$REMOTE_TMP/$artifact" "$app_root/deploy/kvm4/tg-worker/$artifact" || die 'scheduler artifact differs from deployed main'
done
grep -Fqx "ConditionPathExists=$ROOT/.env" "$REMOTE_TMP/$SERVICE_NAME" || die 'service root differs'
if grep -q '^EnvironmentFile=' "$REMOTE_TMP/$SERVICE_NAME"; then die 'scheduler must use container configuration only'; fi
assert_worker_idle() {
  local worker_state
  worker_state="$(systemctl show --property=ActiveState --value "$SERVICE_NAME")" || die 'cannot inspect TG worker'
  case "$worker_state" in
    inactive|failed) ;;
    *) die 'TG worker is running or changing state; wait for it to finish before replacing scheduler' ;;
  esac
}
assert_worker_idle

# Readiness never submits an order. All secrets arrive via the same container
# env_file; no environment value is added to docker argv or printed.
container_id="$(docker inspect --format '{{.Id}}' zaoyoe-verify-server 2>/dev/null)" || die 'verify container missing'
[[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || die 'verify container id invalid'
[[ "$(docker inspect --format '{{.State.Running}}:{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id" 2>/dev/null)" == 'true:healthy' ]] || die 'verify container is not healthy'
if ! docker exec --workdir /app "$container_id" node scripts/tg-readiness.js --runtime --fail-on-invalid >/dev/null 2>&1; then
  die 'TG readiness has invalid configuration; inspect the read-only readiness report separately'
fi

# Installing intentionally closes scheduling. It never enables or starts it,
# including after a previous installation. An in-flight unit is not killed.
stop_timer() {
  systemctl disable --now "$TIMER_NAME" >/dev/null 2>&1 || die 'cannot stop and disable TG timer'
  [[ "$(systemctl is-enabled "$TIMER_NAME" 2>/dev/null || true)" == 'disabled' ]] || die 'TG timer is not disabled'
  [[ "$(systemctl is-active "$TIMER_NAME" 2>/dev/null || true)" == 'inactive' ]] || die 'TG timer is not inactive'
}
timer_load_state="$(systemctl show --property=LoadState --value "$TIMER_NAME")" || die 'cannot inspect TG timer'
case "$timer_load_state" in
  loaded) stop_timer ;;
  not-found) ;;
  *) die 'TG timer has an unexpected load state' ;;
esac
assert_worker_idle
install -d -o root -g root -m 0755 /etc/zaoyoe-tg-worker /usr/local/libexec
install -o root -g root -m 0750 "$REMOTE_TMP/zaoyoe-tg-worker" /usr/local/sbin/zaoyoe-tg-worker
install -o root -g root -m 0644 "$REMOTE_TMP/zaoyoe-tg-worker.cjs" /usr/local/libexec/zaoyoe-tg-worker.cjs
install -o root -g root -m 0644 "$REMOTE_TMP/$SERVICE_NAME" "/etc/systemd/system/$SERVICE_NAME"
install -o root -g root -m 0644 "$REMOTE_TMP/$TIMER_NAME" "/etc/systemd/system/$TIMER_NAME"
printf '%s\n' "$EXPECTED_COMMIT" > /etc/zaoyoe-tg-worker/expected-release
chmod 0644 /etc/zaoyoe-tg-worker/expected-release
systemctl daemon-reload
stop_timer
/usr/local/sbin/zaoyoe-tg-worker --check
echo 'TG scheduler installed; timer is disabled and stopped. No purchase was submitted.'
REMOTE
