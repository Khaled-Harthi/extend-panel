#!/bin/sh
# Extend Panel installer.
#
#   curl -fsSL https://raw.githubusercontent.com/Khaled-Harthi/extend-panel/main/install.sh | sh
#
# Works on a Hostinger OpenClaw VPS (detected by container image) and on a plain
# `openclaw` install. Everything it needs — container name, public address — is
# discovered, so there is nothing to fill in.
#
# Override if you need to:
#   VERSION=v0.1.2  pin a different release
#   PANEL_URL=...   set the public address by hand
set -eu

VERSION="${VERSION:-v0.1.2}"
REPO="github.com/Khaled-Harthi/extend-panel"
SPEC="git:${REPO}@${VERSION}"
IMAGE_MATCH="hvps-openclaw"

say()  { printf '\033[36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33m !\033[0m %s\n' "$1"; }
die()  { printf '\033[31m x\033[0m %s\n' "$1" >&2; exit 1; }

# ---- locate the gateway -------------------------------------------------
# Match on image, not container name: a VPS can have other containers with
# "openclaw" in their name, and picking the wrong one installs into nothing.
CT=""
if command -v docker >/dev/null 2>&1; then
  CT=$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null \
       | awk -v m="$IMAGE_MATCH" 'index($2, m) {print $1; exit}')
fi

if [ -n "$CT" ]; then
  say "OpenClaw container: $CT"
  RUN="docker exec $CT"
elif command -v openclaw >/dev/null 2>&1; then
  say "Using the local openclaw install"
  RUN=""
else
  die "No OpenClaw found. Run this on the VPS where OpenClaw is installed."
fi

# ---- work out the public address ---------------------------------------
# Hostinger publishes each stack under its own Traefik host rule, so the
# container's own labels carry the address the phone will use.
HOST="${PANEL_URL:-}"
if [ -z "$HOST" ] && [ -n "$CT" ]; then
  HOST=$(docker inspect "$CT" --format '{{json .Config.Labels}}' 2>/dev/null \
         | grep -oE 'Host\(`[^`]+`\)' | head -1 | tr -d '`' | sed 's/Host(//; s/)//' || true)
  [ -n "$HOST" ] && HOST="https://$HOST"
fi

# ---- install ------------------------------------------------------------
say "Installing Extend Panel $VERSION"
# Non-ClawHub sources need --force to confirm the source without a prompt.
$RUN openclaw plugins install "$SPEC" --force >/dev/null 2>&1 \
  || die "Install failed. Run this to see why:
    ${RUN:+$RUN }openclaw plugins install $SPEC --force"

if [ -n "$HOST" ]; then
  say "Public address: $HOST"
  $RUN openclaw config set plugins.entries.extend-panel.config.panelUrl "$HOST" >/dev/null 2>&1 \
    || warn "Could not save the address; set it later with PANEL_URL=..."
else
  warn "Could not detect a public address. Chat links will point at localhost."
  warn "Re-run with: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | PANEL_URL=https://your-address sh"
fi

# ---- restart and wait ---------------------------------------------------
say "Restarting the gateway (this takes about a minute)"
if [ -n "$CT" ]; then
  docker restart "$CT" >/dev/null
  i=0
  while [ "$i" -lt 24 ]; do
    if [ "$(docker exec "$CT" curl -s -o /dev/null -w '%{http_code}' \
            http://127.0.0.1:18789/health 2>/dev/null)" = "200" ]; then
      break
    fi
    i=$((i + 1))
    sleep 10
  done
  [ "$i" -lt 24 ] || warn "Gateway is taking longer than usual; give it another minute."
else
  openclaw gateway restart >/dev/null 2>&1 || warn "Restart the gateway yourself to finish."
fi

printf '\n\033[32m✓ Extend Panel is installed.\033[0m\n\n'
[ -n "$HOST" ] && printf '  %s/hooks/extend-panel/\n\n' "$HOST"
printf '  أرسل \033[1m/extend\033[0m في المحادثة للحصول على رابطك الخاص.\n'
printf '  Send \033[1m/extend\033[0m to your agent to get your private link.\n\n'
