#!/usr/bin/env bash
set -Eeuo pipefail

# Canonical NewAPI command. The implementation file keeps its historical name
# because the KVM4 service slot and existing automation still use Sub2API
# identifiers for compatibility.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/deploy-kvm4-sub2api.sh" "$@"
