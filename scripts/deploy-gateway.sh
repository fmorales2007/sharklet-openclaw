#!/usr/bin/env bash
# Install an OpenClaw gateway package built from this fork on the gateway host.
#
#   bash scripts/deploy-gateway.sh                 # latest successful package build
#   bash scripts/deploy-gateway.sh --run <run-id>  # a specific build
#   bash scripts/deploy-gateway.sh --rollback      # reinstall the package before the active one
#
# The package comes from .github/workflows/sharklet-gateway-package.yml. Every
# installed tarball is kept in /srv/sharklet-gateway-releases for rollback.
# Update checks are turned off so `openclaw update` never replaces this build
# with the official npm package.
#
# The Control UI keeps being served from gateway.controlUi.root
# (scripts/deploy-ui.sh), so UI-only changes do not need a gateway install.
#
# Requires an authenticated `gh`. Every value below can be overridden with an
# environment variable.
set -euo pipefail

REPO="${SHARKLET_REPO:-fmorales2007/sharklet-openclaw}"
WORKFLOW="${SHARKLET_PACKAGE_WORKFLOW:-sharklet-gateway-package.yml}"
GATEWAY_HOST="${SHARKLET_GATEWAY_HOST:-openclaw.tail438e44.ts.net}"
GATEWAY_USER="${SHARKLET_GATEWAY_USER:-ubuntu}"
SERVICE_USER="${SHARKLET_SERVICE_USER:-claw}"
SSH_KEY="${SHARKLET_SSH_KEY:-$HOME/.ssh/openclaw_oracle}"
RELEASES_DIR="${SHARKLET_GATEWAY_RELEASES_DIR:-/srv/sharklet-gateway-releases}"
KEEP_RELEASES="${SHARKLET_KEEP_RELEASES:-5}"

RUN_ID=""
ROLLBACK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN_ID="${2:?--run needs a run id}"; shift 2 ;;
    --rollback) ROLLBACK=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
remote() { ssh -i "$SSH_KEY" -o ConnectTimeout=15 "$GATEWAY_USER@$GATEWAY_HOST" "$@"; }

# Runs a command as the service user, from its home, with its systemd user bus.
# The argument is wrapped in single quotes remotely, so it must not contain any.
as_service() {
  remote "cd /tmp && U=\$(id -u '$SERVICE_USER') && sudo -u '$SERVICE_USER' -H env \
      XDG_RUNTIME_DIR=/run/user/\$U DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$U/bus \
      bash -lc 'cd ~ && $1'"
}

install_release() {
  local release="$1"
  log "Installing $release as $SERVICE_USER"
  # npm 11.16+ skips install scripts unless allowed. Like upstream's installer,
  # allow only openclaw's own lifecycle; its other dependencies stay skipped.
  as_service "npm install -g --no-fund --no-audit --allow-scripts=openclaw $release 2>&1 | tail -5"

  log "Turning off update checks so the official package is never installed over this build"
  as_service "openclaw config set update.checkOnStart false --strict-json && openclaw config set update.auto.enabled false --strict-json"

  # openclaw.mjs finishes a skipped lifecycle on first run and refuses to start
  # if it cannot; a marker still present here means the install is incomplete.
  if ! as_service "test ! -e \$(npm root -g)/openclaw/.openclaw-lifecycle-pending"; then
    echo "The package lifecycle did not complete (.openclaw-lifecycle-pending is still there)." >&2
    exit 1
  fi

  log "Restarting the gateway"
  as_service "openclaw gateway restart && openclaw gateway status" \
    | grep -iE 'Runtime|Connectivity|Gateway:' || true
  echo "Installed: $(as_service "openclaw --version" | tail -1)"
}

if [[ "$ROLLBACK" -eq 1 ]]; then
  log "Finding the package before the active one"
  previous="$(remote "set -euo pipefail
    active=\$(readlink -f '$RELEASES_DIR/active.tgz' 2>/dev/null || true)
    ls -1 '$RELEASES_DIR'/*.tgz 2>/dev/null | grep -v '/active.tgz\$' | sort \
      | awk -v a=\"\$active\" '\$0 == a {print prev; exit} {prev = \$0}'")"
  [[ -n "$previous" ]] || { echo "No package before the active one." >&2; exit 1; }
  remote "sudo ln -sfn '$previous' '$RELEASES_DIR/active.tgz'"
  install_release "$previous"
  exit 0
fi

if [[ -z "$RUN_ID" ]]; then
  RUN_ID="$(gh run list -R "$REPO" --workflow "$WORKFLOW" --status success --limit 1 \
    --json databaseId --jq '.[0].databaseId')"
  [[ -n "$RUN_ID" && "$RUN_ID" != "null" ]] || { echo "No successful package build found." >&2; exit 1; }
fi
COMMIT="$(gh run view "$RUN_ID" -R "$REPO" --json headSha --jq .headSha)"
log "Package from run $RUN_ID (commit ${COMMIT:0:8})"

WORKDIR="$(mktemp -d -t sharklet-gateway-XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT
gh run download "$RUN_ID" -R "$REPO" -n "openclaw-sharklet-$COMMIT" -D "$WORKDIR"
(cd "$WORKDIR" && sha256sum -c openclaw-sharklet.tgz.sha256)
cat "$WORKDIR/build-info.txt"

STAMP="$(date -u +%Y%m%d-%H%M%S)-${COMMIT:0:8}"
RELEASE="$RELEASES_DIR/openclaw-sharklet-$STAMP.tgz"

log "Uploading $(du -h "$WORKDIR/openclaw-sharklet.tgz" | cut -f1) to $GATEWAY_HOST"
scp -i "$SSH_KEY" -q "$WORKDIR/openclaw-sharklet.tgz" "$GATEWAY_USER@$GATEWAY_HOST:/tmp/openclaw-sharklet-$STAMP.tgz"
remote "set -euo pipefail
  sudo install -d -o '$SERVICE_USER' -g '$SERVICE_USER' -m 0755 '$RELEASES_DIR'
  sudo install -o '$SERVICE_USER' -g '$SERVICE_USER' -m 0644 '/tmp/openclaw-sharklet-$STAMP.tgz' '$RELEASE'
  rm -f '/tmp/openclaw-sharklet-$STAMP.tgz'
  sudo ln -sfn '$RELEASE' '$RELEASES_DIR/active.tgz'
  # Keep the most recent packages so a rollback always has somewhere to go.
  ls -1 '$RELEASES_DIR'/openclaw-sharklet-*.tgz | sort | head -n -$KEEP_RELEASES | xargs -r sudo rm -f"

install_release "$RELEASE"

log "Done"
echo "Gateway package from commit ${COMMIT:0:8} is live on $GATEWAY_HOST."
