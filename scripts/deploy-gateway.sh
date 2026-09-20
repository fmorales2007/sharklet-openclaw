#!/usr/bin/env bash
# Install an OpenClaw gateway package built from this fork on the gateway host.
#
#   bash scripts/deploy-gateway.sh                 # latest successful package build
#   bash scripts/deploy-gateway.sh --run <run-id>  # a specific build
#   bash scripts/deploy-gateway.sh --rollback      # reinstall the package before the active one
#
# The package comes from .github/workflows/sharklet-gateway-package.yml. Every
# installed tarball is kept in /srv/sharklet-gateway-releases for rollback, and
# active.tgz points at the package that is actually running: it only moves after
# an install succeeds. Update checks are turned off so `openclaw update` never
# replaces this build with the official npm package.
#
# The gateway package carries its own Control UI, but the gateway serves
# gateway.controlUi.root, so run scripts/deploy-ui.sh after this to keep the
# served UI on the same commit as the gateway.
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
# Installing a commit that is not on custom is a mistake by default.
ALLOW_ANY_COMMIT="${SHARKLET_ALLOW_ANY_COMMIT:-0}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ "$KEEP_RELEASES" =~ ^[1-9][0-9]*$ ]] || {
  echo "SHARKLET_KEEP_RELEASES must be a positive integer, got: $KEEP_RELEASES" >&2
  exit 2
}

RUN_ID=""
ROLLBACK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN_ID="${2:?--run needs a run id}"; shift 2 ;;
    --rollback) ROLLBACK=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ "$ROLLBACK" -eq 1 && -n "$RUN_ID" ]] && { echo "--rollback cannot be combined with --run." >&2; exit 2; }

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
remote() { ssh -i "$SSH_KEY" -o ConnectTimeout=15 "$GATEWAY_USER@$GATEWAY_HOST" "$@"; }

# Runs a command as the service user, from its home, with its systemd user bus.
# The argument is wrapped in single quotes remotely, so it must not contain any.
# The remote shell starts without pipefail: a payload with a pipe has to set it
# itself, or a failing command upstream of the pipe is reported as success.
as_service() {
  case "$1" in
    *\'*) echo "as_service payload must not contain single quotes: $1" >&2; return 2 ;;
  esac
  remote "cd /tmp && U=\$(id -u '$SERVICE_USER') && sudo -u '$SERVICE_USER' -H env \
      XDG_RUNTIME_DIR=/run/user/\$U DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$U/bus \
      bash -lc 'cd ~ && $1'"
}

# Fails unless the running gateway reports a build from the expected commit.
assert_running_commit() {
  local expected="$1" running
  running="$(as_service "openclaw --version")" || {
    echo "Could not read the gateway version." >&2
    exit 1
  }
  running="$(printf '%s\n' "$running" | tail -1)"
  case "$running" in
    *"${expected:0:7}"*) echo "Running: $running" ;;
    *) echo "Gateway reports \"$running\", expected a build from ${expected:0:7}." >&2; exit 1 ;;
  esac
}

install_release() {
  local release="$1" expected="$2"

  log "Backing up gateway state before touching the installation"
  as_service "set -o pipefail; openclaw backup create 2>&1 | tail -3"

  log "Installing $release as $SERVICE_USER"
  # npm 11.16+ skips install scripts unless allowed. Upstream's installer builds
  # this flag from the install spec itself, so a tarball spec allows that path.
  as_service "set -o pipefail; npm install -g --no-fund --no-audit --allow-scripts=$release $release 2>&1 | tail -5"

  log "Turning off update checks so the official package is never installed over this build"
  as_service "openclaw config set update.checkOnStart false --strict-json && openclaw config set update.auto.enabled false --strict-json"

  # openclaw.mjs finishes a skipped lifecycle on first run and refuses to start
  # if it cannot; a marker still present here means the install is incomplete.
  if ! as_service "test ! -e \$(npm root -g)/openclaw/.openclaw-lifecycle-pending"; then
    echo "The package lifecycle did not complete (.openclaw-lifecycle-pending is still there)." >&2
    exit 1
  fi

  log "Restarting the gateway"
  local status
  as_service "openclaw gateway restart" || { echo "The gateway did not restart." >&2; exit 1; }
  status="$(as_service "openclaw gateway status")" || { echo "The gateway did not report status." >&2; exit 1; }
  printf '%s\n' "$status" | grep -iE 'Runtime|Connectivity|Gateway:' || true
  printf '%s\n' "$status" | grep -qi 'Connectivity probe: ok' || {
    echo "The gateway restarted but its connectivity probe is not ok." >&2
    exit 1
  }
  assert_running_commit "$expected"
}

# Points active.tgz at what is now installed, then prunes older packages.
# Retention never removes the active package.
activate_and_prune() {
  local release="$1"
  remote "set -euo pipefail
    sudo ln -sfn '$release' '$RELEASES_DIR/active.tgz'
    active=\$(readlink -f '$RELEASES_DIR/active.tgz')
    ls -1 '$RELEASES_DIR'/openclaw-sharklet-*.tgz | sort | head -n -$KEEP_RELEASES \
      | { grep -vFx \"\$active\" || true; } | xargs -r sudo rm -f
    echo \"Active package: \$active\""
}

if [[ "$ROLLBACK" -eq 1 ]]; then
  log "Finding the package before the active one"
  previous="$(remote "set -euo pipefail
    active=\$(readlink -f '$RELEASES_DIR/active.tgz' 2>/dev/null || true)
    ls -1 '$RELEASES_DIR'/openclaw-sharklet-*.tgz 2>/dev/null | sort \
      | awk -v a=\"\$active\" '\$0 == a {print prev; exit} {prev = \$0}'")"
  [[ -n "$previous" ]] || { echo "No package before the active one." >&2; exit 1; }
  # Release names end in -<short sha>.tgz, which is what the gateway reports.
  previous_commit="$(basename "$previous" .tgz)"
  previous_commit="${previous_commit##*-}"
  echo "Rolling back to $previous (commit $previous_commit)"
  install_release "$previous" "$previous_commit"
  activate_and_prune "$previous"
  exit 0
fi

if [[ -z "$RUN_ID" ]]; then
  RUN_ID="$(gh run list -R "$REPO" --workflow "$WORKFLOW" --status success --limit 1 \
    --json databaseId --jq '.[0].databaseId')"
  [[ -n "$RUN_ID" && "$RUN_ID" != "null" ]] || { echo "No successful package build found." >&2; exit 1; }
fi
COMMIT="$(gh run view "$RUN_ID" -R "$REPO" --json headSha --jq .headSha)"
[[ -n "$COMMIT" && "$COMMIT" != "null" ]] || { echo "Run $RUN_ID has no head commit." >&2; exit 1; }
log "Package from run $RUN_ID (commit ${COMMIT:0:8})"

# The workflow also runs on demand from any branch, so a build has to be proven
# to come from custom before it reaches the gateway.
if [[ "$ALLOW_ANY_COMMIT" != "1" ]]; then
  git -C "$REPO_ROOT" fetch -q origin custom
  git -C "$REPO_ROOT" merge-base --is-ancestor "$COMMIT" origin/custom || {
    echo "Run $RUN_ID built $COMMIT, which is not on origin/custom." >&2
    echo "Set SHARKLET_ALLOW_ANY_COMMIT=1 only when deploying a build on purpose." >&2
    exit 1
  }
fi

WORKDIR="$(mktemp -d -t sharklet-gateway-XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT
gh run download "$RUN_ID" -R "$REPO" -n "openclaw-sharklet-$COMMIT" -D "$WORKDIR"

log "Verifying the package against channels outside the artifact"
# The .sha256 shipped next to the tarball proves only that the download is
# intact: both files come from the same artifact. GitHub's provenance
# attestation is not available for user-owned private repositories, so the
# independent checks here are the API (which artifact belongs to which commit)
# and the digest the build printed into its own log.
artifact_commit="$(gh api "repos/$REPO/actions/runs/$RUN_ID/artifacts" \
  --jq ".artifacts[] | select(.name == \"openclaw-sharklet-$COMMIT\") | .workflow_run.head_sha")"
[[ "$artifact_commit" == "$COMMIT" ]] || {
  echo "The artifact does not belong to commit $COMMIT (API reports: ${artifact_commit:-none})." >&2
  exit 1
}
logged_digest="$(gh run view "$RUN_ID" -R "$REPO" --log \
  | tr -d '\r' | grep -oE "[0-9a-f]{64}[[:space:]]+openclaw-sharklet\.tgz" | head -1 | cut -d' ' -f1)"
[[ -n "$logged_digest" ]] || { echo "Run $RUN_ID logged no package digest." >&2; exit 1; }
local_digest="$(sha256sum "$WORKDIR/openclaw-sharklet.tgz" | cut -d' ' -f1)"
[[ "$local_digest" == "$logged_digest" ]] || {
  echo "The downloaded package does not match the digest the build logged." >&2
  echo "  build log: $logged_digest" >&2
  echo "  download:  $local_digest" >&2
  exit 1
}
echo "Package matches run $RUN_ID (${logged_digest:0:16}…) and commit ${COMMIT:0:8}."
(cd "$WORKDIR" && sha256sum -c openclaw-sharklet.tgz.sha256)
cat "$WORKDIR/build-info.txt"

STAMP="$(date -u +%Y%m%d-%H%M%S)-${COMMIT:0:8}"
RELEASE="$RELEASES_DIR/openclaw-sharklet-$STAMP.tgz"

log "Uploading $(du -h "$WORKDIR/openclaw-sharklet.tgz" | cut -f1) to $GATEWAY_HOST"
scp -i "$SSH_KEY" -q "$WORKDIR/openclaw-sharklet.tgz" "$GATEWAY_USER@$GATEWAY_HOST:/tmp/openclaw-sharklet-$STAMP.tgz"
remote "set -euo pipefail
  sudo install -d -o root -g root -m 0755 '$RELEASES_DIR'
  sudo install -o root -g root -m 0644 '/tmp/openclaw-sharklet-$STAMP.tgz' '$RELEASE'
  rm -f '/tmp/openclaw-sharklet-$STAMP.tgz'"

install_release "$RELEASE" "$COMMIT"
activate_and_prune "$RELEASE"

log "Done"
echo "Gateway package from commit ${COMMIT:0:8} is live on $GATEWAY_HOST."
echo "Run scripts/deploy-ui.sh next so the served Control UI matches this build."
