#!/usr/bin/env bash
set -Eeuo pipefail

# Restrict KVM4 HTTP/HTTPS (80/443) ingress strictly to Cloudflare edge IPs
# in both host INPUT and DOCKER-USER chains so port scanners (Censys/Shodan)
# cannot fingerprint origin certificates or bypass Cloudflare WAF/DDoS protection.

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

CF_IPV4_CIDRS=(
  "173.245.48.0/20"
  "103.21.244.0/22"
  "103.22.200.0/22"
  "103.31.4.0/22"
  "141.101.64.0/18"
  "108.162.192.0/18"
  "190.93.240.0/20"
  "188.114.96.0/20"
  "197.234.240.0/22"
  "198.41.128.0/17"
  "162.158.0.0/15"
  "104.16.0.0/13"
  "104.24.0.0/14"
  "172.64.0.0/13"
  "131.0.72.0/22"
)

CF_IPV6_CIDRS=(
  "2400:cb00::/32"
  "2606:4700::/32"
  "2803:f800::/32"
  "2405:b500::/32"
  "2405:8100::/32"
  "2a06:98c0::/29"
  "2c0f:f248::/32"
)

if [[ "$DRY_RUN" == "1" ]]; then
  echo "install-kvm4-cloudflare-firewall: dry-run mode"
  echo "IPv4 Cloudflare CIDRs: ${#CF_IPV4_CIDRS[@]}"
  echo "IPv6 Cloudflare CIDRs: ${#CF_IPV6_CIDRS[@]}"
  exit 0
fi

apply_v4_chain() {
  local chain="CF-WEB-ALLOW"
  iptables -N "$chain" 2>/dev/null || iptables -F "$chain"
  iptables -A "$chain" -s 127.0.0.0/8 -j RETURN
  iptables -A "$chain" -s 172.16.0.0/12 -j RETURN
  for cidr in "${CF_IPV4_CIDRS[@]}"; do
    iptables -A "$chain" -s "$cidr" -j RETURN
  done
  iptables -A "$chain" -j DROP

  iptables -C INPUT -p tcp -m multiport --dports 80,443 -j "$chain" 2>/dev/null \
    || iptables -I INPUT 1 -p tcp -m multiport --dports 80,443 -j "$chain"

  if iptables -L DOCKER-USER >/dev/null 2>&1; then
    iptables -C DOCKER-USER -p tcp -m multiport --dports 80,443 -j "$chain" 2>/dev/null \
      || iptables -I DOCKER-USER 1 -p tcp -m multiport --dports 80,443 -j "$chain"
  fi
}

apply_v6_chain() {
  if ! command -v ip6tables >/dev/null 2>&1; then
    return 0
  fi
  local chain="CF-WEB-ALLOW6"
  ip6tables -N "$chain" 2>/dev/null || ip6tables -F "$chain"
  ip6tables -A "$chain" -s ::1/128 -j RETURN
  for cidr in "${CF_IPV6_CIDRS[@]}"; do
    ip6tables -A "$chain" -s "$cidr" -j RETURN
  done
  ip6tables -A "$chain" -j DROP

  ip6tables -C INPUT -p tcp -m multiport --dports 80,443 -j "$chain" 2>/dev/null \
    || ip6tables -I INPUT 1 -p tcp -m multiport --dports 80,443 -j "$chain"
}

apply_v4_chain
apply_v6_chain
echo "Cloudflare-only ingress firewall applied for TCP ports 80 and 443."
