#!/usr/bin/env bash
# Build the Sharklet Control UI and deploy it to the gateway.
#
#   bash scripts/deploy-ui.sh              # build, upload, activate, restart
#   bash scripts/deploy-ui.sh --no-build   # reuse the existing dist/control-ui
#   bash scripts/deploy-ui.sh --rollback   # activate the release before the active one
#
# Releases land in /srv/sharklet-ui-releases/<stamp> and /srv/sharklet-ui is a
# symlink to the active one, so activation is atomic and rollback is instant.
# rsync is not used: Git Bash on Windows does not ship it.
#
# Every value below has a default and can be overridden with an environment variable.
set -euo pipefail

GATEWAY_HOST="${SHARKLET_GATEWAY_HOST:-openclaw.tail438e44.ts.net}"
GATEWAY_USER="${SHARKLET_GATEWAY_USER:-ubuntu}"
SERVICE_USER="${SHARKLET_SERVICE_USER:-claw}"
SSH_KEY="${SHARKLET_SSH_KEY:-$HOME/.ssh/openclaw_oracle}"
RELEASES_DIR="${SHARKLET_RELEASES_DIR:-/srv/sharklet-ui-releases}"
CURRENT_LINK="${SHARKLET_CURRENT_LINK:-/srv/sharklet-ui}"
KEEP_RELEASES="${SHARKLET_KEEP_RELEASES:-5}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist/control-ui"

BUILD=1
ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --rollback) ROLLBACK=1; BUILD=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
remote() { ssh -i "$SSH_KEY" -o ConnectTimeout=15 "$GATEWAY_USER@$GATEWAY_HOST" "$@"; }

# Runs an openclaw command as the service user. The gateway is a systemd user
# service, so its session bus has to be reachable, and the shell must start in
# the service user's home (the SSH user's home is not readable to it).
as_service() {
  remote "cd /tmp && U=\$(id -u '$SERVICE_USER') && sudo -u '$SERVICE_USER' -H env \
      XDG_RUNTIME_DIR=/run/user/\$U DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$U/bus \
      bash -lc 'cd ~ && $1'"
}

restart_gateway() {
  as_service "openclaw gateway restart && openclaw gateway status" \
    | grep -iE 'Runtime|Connectivity|Gateway:|Dashboard' || true
}

if [[ "$ROLLBACK" -eq 1 ]]; then
  log "Rolling back to the release before the active one"
  remote "set -euo pipefail
    active=\$(readlink -f '$CURRENT_LINK')
    previous=\$(ls -1d '$RELEASES_DIR'/*/ 2>/dev/null | sed 's:/*\$::' | sort | awk -v a=\"\$active\" '\$0 == a {print prev; exit} {prev = \$0}')
    [[ -n \"\$previous\" ]] || { echo 'No release before the active one.' >&2; exit 1; }
    sudo ln -sfn \"\$previous\" '$CURRENT_LINK'
    echo \"Active release: \$(readlink -f '$CURRENT_LINK')\""
  restart_gateway
  exit 0
fi

if [[ "$BUILD" -eq 1 ]]; then
  log "Building the Control UI"
  # corepack's bare `pnpm` shim breaks under Git Bash on Windows; `corepack pnpm` works everywhere.
  (cd "$REPO_ROOT" && corepack pnpm ui:build)
fi

[[ -f "$DIST_DIR/index.html" ]] || {
  echo "No build found at $DIST_DIR (missing index.html). Run without --no-build." >&2
  exit 1
}

STAMP="$(date -u +%Y%m%d-%H%M%S)"
TARBALL="$(mktemp -t sharklet-ui-XXXXXX.tgz)"
trap 'rm -f "$TARBALL"' EXIT

log "Packing $DIST_DIR"
tar -czf "$TARBALL" -C "$DIST_DIR" .
echo "$(du -h "$TARBALL" | cut -f1) -> $GATEWAY_HOST"

log "Uploading release $STAMP"
scp -i "$SSH_KEY" -q "$TARBALL" "$GATEWAY_USER@$GATEWAY_HOST:/tmp/sharklet-ui-$STAMP.tgz"

log "Activating release $STAMP"
remote "set -euo pipefail
  sudo mkdir -p '$RELEASES_DIR/$STAMP'
  sudo tar -xzf '/tmp/sharklet-ui-$STAMP.tgz' -C '$RELEASES_DIR/$STAMP'
  rm -f '/tmp/sharklet-ui-$STAMP.tgz'
  sudo chown -R '$SERVICE_USER':'$SERVICE_USER' '$RELEASES_DIR/$STAMP'
  sudo chmod -R a+rX '$RELEASES_DIR/$STAMP'
  sudo ln -sfn '$RELEASES_DIR/$STAMP' '$CURRENT_LINK'
  # Keep the most recent releases so a rollback always has somewhere to go.
  ls -1d '$RELEASES_DIR'/*/ 2>/dev/null | sort | head -n -$KEEP_RELEASES | xargs -r sudo rm -rf
  echo \"Active release: \$(readlink -f '$CURRENT_LINK')\""

log "Pointing the gateway at $CURRENT_LINK"
if [[ "$(as_service "openclaw config get gateway.controlUi.root 2>/dev/null" | tr -d '\"[:space:]')" != "$CURRENT_LINK" ]]; then
  # as_service wraps its argument in single quotes, so it must not contain any.
  as_service "openclaw config set gateway.controlUi.root $CURRENT_LINK"
else
  echo "gateway.controlUi.root already set."
fi

log "Restarting the gateway"
restart_gateway

log "Done"
echo "Release $STAMP is live at $CURRENT_LINK on $GATEWAY_HOST."
