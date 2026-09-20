#!/usr/bin/env bash
# Back up the gateway's state (~/.openclaw: config, credentials, sessions and
# workspaces) and keep a copy off the server.
#
#   bash scripts/backup-gateway-state.sh                 # back up now and copy it here
#   bash scripts/backup-gateway-state.sh --install-timer # daily backup on the server
#   bash scripts/backup-gateway-state.sh --verify <file> # check a local archive
#
# The server is a single Lightsail instance: losing it without a copy means
# losing every agent, session and credential. `openclaw backup create --verify`
# writes and checks the archive; this script then pulls it down, because a
# backup that only lives on the machine it protects is not a backup.
set -euo pipefail

GATEWAY_HOST="${SHARKLET_GATEWAY_HOST:-openclaw.tail438e44.ts.net}"
GATEWAY_USER="${SHARKLET_GATEWAY_USER:-ubuntu}"
SERVICE_USER="${SHARKLET_SERVICE_USER:-claw}"
SSH_KEY="${SHARKLET_SSH_KEY:-$HOME/.ssh/openclaw_oracle}"
REMOTE_DIR="${SHARKLET_REMOTE_BACKUP_DIR:-/home/$SERVICE_USER/backups}"
LOCAL_DIR="${SHARKLET_BACKUP_DIR:-$HOME/sharklet-backups}"
KEEP_LOCAL="${SHARKLET_KEEP_BACKUPS:-14}"

[[ "$KEEP_LOCAL" =~ ^[1-9][0-9]*$ ]] || { echo "SHARKLET_KEEP_BACKUPS must be a positive integer." >&2; exit 2; }

MODE="run"
VERIFY_FILE=""
case "${1:-}" in
  "") ;;
  --install-timer) MODE="install-timer" ;;
  --verify) MODE="verify"; VERIFY_FILE="${2:?--verify needs an archive path}" ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
remote() { ssh -i "$SSH_KEY" -o ConnectTimeout=15 "$GATEWAY_USER@$GATEWAY_HOST" "$@"; }

# The payload is wrapped in single quotes remotely, so it must not contain any,
# and the remote shell has no pipefail: a payload with a pipe must set it.
as_service() {
  case "$1" in
    *\'*) echo "as_service payload must not contain single quotes: $1" >&2; return 2 ;;
  esac
  remote "cd /tmp && U=\$(id -u '$SERVICE_USER') && sudo -u '$SERVICE_USER' -H env \
      XDG_RUNTIME_DIR=/run/user/\$U DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$U/bus \
      bash -lc 'cd ~ && $1'"
}

if [[ "$MODE" == "verify" ]]; then
  [[ -f "$VERIFY_FILE" ]] || { echo "No such archive: $VERIFY_FILE" >&2; exit 1; }
  log "Verifying $VERIFY_FILE on the server"
  scp -i "$SSH_KEY" -q "$VERIFY_FILE" "$GATEWAY_USER@$GATEWAY_HOST:/tmp/verify-backup.tar.gz"
  remote "sudo install -o '$SERVICE_USER' -g '$SERVICE_USER' -m 0600 /tmp/verify-backup.tar.gz '$REMOTE_DIR/verify-backup.tar.gz' && rm -f /tmp/verify-backup.tar.gz"
  as_service "openclaw backup verify $REMOTE_DIR/verify-backup.tar.gz"
  as_service "rm -f $REMOTE_DIR/verify-backup.tar.gz"
  echo "The archive is valid."
  exit 0
fi

if [[ "$MODE" == "install-timer" ]]; then
  log "Installing a daily backup timer for $SERVICE_USER"
  # A user timer, because the gateway itself runs as a systemd user service.
  remote "set -euo pipefail
    sudo -u '$SERVICE_USER' mkdir -p '$REMOTE_DIR' '/home/$SERVICE_USER/.config/systemd/user'
    sudo -u '$SERVICE_USER' tee '/home/$SERVICE_USER/.config/systemd/user/sharklet-backup.service' >/dev/null <<'UNIT'
[Unit]
Description=Sharklet: back up OpenClaw state

[Service]
Type=oneshot
Environment=PATH=%h/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=%h
ExecStart=/bin/bash -lc 'openclaw backup create --verify --output %h/backups'
# Keep two weeks of daily archives on the server; the copies pulled to the PC are the real safety net.
ExecStartPost=/bin/bash -lc 'ls -1t %h/backups/*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f'
UNIT
    sudo -u '$SERVICE_USER' tee '/home/$SERVICE_USER/.config/systemd/user/sharklet-backup.timer' >/dev/null <<'UNIT'
[Unit]
Description=Sharklet: daily OpenClaw state backup

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
UNIT
"
  as_service "systemctl --user daemon-reload && systemctl --user enable --now sharklet-backup.timer"
  as_service "systemctl --user list-timers sharklet-backup.timer --no-pager"
  echo "Daily backups are on. Run this script with no arguments to pull a copy here."
  exit 0
fi

log "Creating a backup on $GATEWAY_HOST"
as_service "mkdir -p $REMOTE_DIR && openclaw backup create --verify --output $REMOTE_DIR"

# openclaw writes <timestamp>-openclaw-backup.tar.gz, not .tgz.
newest="$(as_service "ls -1t $REMOTE_DIR/*.tar.gz | head -1")"
newest="$(printf '%s\n' "$newest" | tail -1 | tr -d '\r')"
[[ -n "$newest" ]] || { echo "The backup was not written to $REMOTE_DIR." >&2; exit 1; }

log "Copying $(basename "$newest") to $LOCAL_DIR"
mkdir -p "$LOCAL_DIR"
scp -i "$SSH_KEY" -q "$GATEWAY_USER@$GATEWAY_HOST:$newest" "$LOCAL_DIR/" || {
  # The archive belongs to the service user, so fall back to a readable copy.
  remote "sudo cp '$newest' /tmp/sharklet-backup.tar.gz && sudo chown '$GATEWAY_USER' /tmp/sharklet-backup.tar.gz"
  scp -i "$SSH_KEY" -q "$GATEWAY_USER@$GATEWAY_HOST:/tmp/sharklet-backup.tar.gz" "$LOCAL_DIR/$(basename "$newest")"
  remote "rm -f /tmp/sharklet-backup.tar.gz"
}

local_copy="$LOCAL_DIR/$(basename "$newest")"
[[ -s "$local_copy" ]] || { echo "The local copy at $local_copy is missing or empty." >&2; exit 1; }

# Keep the local history bounded without ever leaving zero copies.
ls -1t "$LOCAL_DIR"/*.tar.gz 2>/dev/null | tail -n +$((KEEP_LOCAL + 1)) | xargs -r rm -f

log "Done"
echo "$(du -h "$local_copy" | cut -f1) in $local_copy"
echo "Restoring on a fresh server: openclaw backup restore <archive> (test it before you need it)."
