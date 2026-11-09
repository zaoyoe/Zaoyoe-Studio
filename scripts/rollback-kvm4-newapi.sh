#!/usr/bin/env bash
set -Eeuo pipefail

# Canonical NewAPI rollback command; /opt/sub2api remains the stable service
# slot and is intentionally not renamed by this compatibility wrapper.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/rollback-kvm4-sub2api.sh" "$@"
