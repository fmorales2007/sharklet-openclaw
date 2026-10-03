#!/usr/bin/env bash
# Sharklet release scan: production dependency advisories, committed private
# keys and first-party code rules. Fails on high or critical findings.
# CI only (Linux x64): the PR check passes --changed, the gateway package scans
# the tree. Needs node, curl and git; no install step, no third-party action.
set -euo pipefail
cd "$(dirname "$0")/.."

# Same pinned release and digest as upstream's opengrep workflow.
OPENGREP_VERSION=v1.27.1
OPENGREP_LINUX_X64_SHA256=58053da76672bbeb5b0a5441021c58338707052e10f81d777140ca879bd491ce

node scripts/pre-commit/pnpm-audit-prod.mjs --audit-level=high
node scripts/detect-private-keys.mts

if ! command -v opengrep >/dev/null; then
  bin_dir="${RUNNER_TEMP:-$(mktemp -d)}/opengrep-bin"
  mkdir -p "$bin_dir"
  curl -fsSL --retry 4 --retry-all-errors --retry-delay 2 --connect-timeout 10 --max-time 300 \
    -o "$bin_dir/opengrep" \
    "https://github.com/opengrep/opengrep/releases/download/${OPENGREP_VERSION}/opengrep_manylinux_x86"
  printf '%s  %s\n' "$OPENGREP_LINUX_X64_SHA256" "$bin_dir/opengrep" | sha256sum --check
  chmod 0755 "$bin_dir/opengrep"
  export PATH="$bin_dir:$PATH"
fi

scripts/run-opengrep.sh --error --severity ERROR "$@"
