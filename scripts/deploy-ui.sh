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
# Deploying a UI that is not a clean commit on custom is a mistake by default.
ALLOW_ANY_SOURCE="${SHARKLET_ALLOW_ANY_SOURCE:-0}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist/control-ui"

# head -n -0 prints every line, which would prune the release just deployed.
[[ "$KEEP_RELEASES" =~ ^[1-9][0-9]*$ ]] || {
  echo "SHARKLET_KEEP_RELEASES must be a positive integer, got: $KEEP_RELEASES" >&2
  exit 2
}

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
  case "$1" in
    *\'*) echo "as_service payload must not contain single quotes: $1" >&2; return 2 ;;
  esac
  remote "cd /tmp && U=\$(id -u '$SERVICE_USER') && sudo -u '$SERVICE_USER' -H env \
      XDG_RUNTIME_DIR=/run/user/\$U DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$U/bus \
      bash -lc 'cd ~ && $1'"
}

restart_gateway() {
  local status
  as_service "openclaw gateway restart" || { echo "The gateway did not restart." >&2; exit 1; }
  status="$(as_service "openclaw gateway status")" || { echo "The gateway did not report status." >&2; exit 1; }
  printf '%s\n' "$status" | grep -iE 'Runtime|Connectivity|Gateway:|Dashboard' || true
  printf '%s\n' "$status" | grep -qi 'Connectivity probe: ok' || {
    echo "The gateway restarted but its connectivity probe is not ok." >&2
    exit 1
  }
}

# The Control UI has to answer over the tailnet, not just exist on disk.
assert_ui_serves() {
  local url="https://$GATEWAY_HOST/"
  curl -fsS -o /dev/null --max-time 30 "$url" || {
    echo "The Control UI did not answer at $url after the deploy." >&2
    exit 1
  }
  echo "Control UI answers at $url"
}

if [[ "$ROLLBACK" -eq 1 ]]; then
  log "Rolling back to the release before the active one"
  remote "set -euo pipefail
    active=\$(readlink -f '$CURRENT_LINK')
    previous=\$(ls -1d '$RELEASES_DIR'/*/ 2>/dev/null | sed 's:/*\$::' | grep -v '/[.]' | sort | awk -v a=\"\$active\" '\$0 == a {print prev; exit} {prev = \$0}')
    [[ -n \"\$previous\" ]] || { echo 'No release before the active one.' >&2; exit 1; }
    sudo ln -sfn \"\$previous\" '$CURRENT_LINK'
    echo \"Active release: \$(readlink -f '$CURRENT_LINK')\""
  restart_gateway
  assert_ui_serves
  exit 0
fi

COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
if [[ "$ALLOW_ANY_SOURCE" != "1" ]]; then
  git -C "$REPO_ROOT" fetch -q origin custom
  git -C "$REPO_ROOT" merge-base --is-ancestor "$COMMIT" origin/custom || {
    echo "HEAD ($BRANCH, ${COMMIT:0:8}) is not on origin/custom, so the gateway and the UI would drift." >&2
    echo "Set SHARKLET_ALLOW_ANY_SOURCE=1 to deploy from somewhere else on purpose." >&2
    exit 1
  }
  [[ -z "$(git -C "$REPO_ROOT" status --porcelain -- ui src packages)" ]] || {
    echo "Uncommitted changes under ui/, src/ or packages/: this release could not be traced back to a commit." >&2
    echo "Commit them, or set SHARKLET_ALLOW_ANY_SOURCE=1." >&2
    exit 1
  }
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

STAMP="$(date -u +%Y%m%d-%H%M%S)-${COMMIT:0:8}"
TARBALL="$(mktemp -t sharklet-ui-XXXXXX.tgz)"
trap 'rm -f "$TARBALL"' EXIT

log "Packing $DIST_DIR"
# Each release says which commit it came from; without this the served UI
# cannot be tied back to the gateway build.
{
  echo "commit=$COMMIT"
  echo "branch=$BRANCH"
  echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$DIST_DIR/sharklet-build-info.txt"
tar -czf "$TARBALL" -C "$DIST_DIR" .
echo "$(du -h "$TARBALL" | cut -f1) -> $GATEWAY_HOST"

log "Uploading release $STAMP"
scp -i "$SSH_KEY" -q "$TARBALL" "$GATEWAY_USER@$GATEWAY_HOST:/tmp/sharklet-ui-$STAMP.tgz"

log "Activating release $STAMP"
remote "set -euo pipefail
  staging='$RELEASES_DIR/.$STAMP.partial'
  sudo rm -rf \"\$staging\"
  sudo mkdir -p \"\$staging\"
  sudo tar -xzf '/tmp/sharklet-ui-$STAMP.tgz' -C \"\$staging\"
  rm -f '/tmp/sharklet-ui-$STAMP.tgz'
  # A half-extracted release must never become a rollback candidate, so it only
  # takes its final name once it is complete.
  sudo test -f \"\$staging/index.html\"
  sudo chown -R root:root \"\$staging\"
  sudo chmod -R a+rX \"\$staging\"
  sudo mv \"\$staging\" '$RELEASES_DIR/$STAMP'
  sudo ln -sfn '$RELEASES_DIR/$STAMP' '$CURRENT_LINK'
  active=\$(readlink -f '$CURRENT_LINK')
  # Keep the most recent releases so a rollback always has somewhere to go,
  # never pruning the active one or a leftover staging directory.
  ls -1d '$RELEASES_DIR'/*/ 2>/dev/null | sed 's:/*\$::' | grep -v '/[.]' | sort \
    | head -n -$KEEP_RELEASES | { grep -vFx \"\$active\" || true; } | xargs -r sudo rm -rf
  echo \"Active release: \$active\""

log "Pointing the gateway at $CURRENT_LINK"
if [[ "$(as_service "openclaw config get gateway.controlUi.root 2>/dev/null" | tr -d '\"[:space:]')" != "$CURRENT_LINK" ]]; then
  # as_service wraps its argument in single quotes, so it must not contain any.
  as_service "openclaw config set gateway.controlUi.root \"$CURRENT_LINK\""
else
  echo "gateway.controlUi.root already set."
fi

log "Restarting the gateway"
restart_gateway

assert_ui_serves

log "Done"
echo "Release $STAMP (commit ${COMMIT:0:8}) is live at $CURRENT_LINK on $GATEWAY_HOST."
