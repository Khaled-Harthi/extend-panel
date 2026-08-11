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
#   VERSION=v0.1.3  pin a different release
#   PANEL_URL=...   set the public address by hand
set -eu

VERSION="${VERSION:-v0.1.3}"
REPO="github.com/Khaled-Harthi/extend-panel"
RAW="https://raw.githubusercontent.com/Khaled-Harthi/extend-panel/main/install.sh"
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

# Hostinger's "App terminal" is a shell *inside* the container: no docker socket,
# so the Traefik label above is unreachable. But the data volume is bind-mounted
# from /docker/<stack>/data on the host, and Traefik publishes each stack at
# `<stack>.$TRAEFIK_HOST` — so mountinfo plus that env var reconstruct the
# address. Confirm the guess actually serves this OpenClaw before trusting it.
if [ -z "$HOST" ] && [ -n "${TRAEFIK_HOST:-}" ]; then
  STACK=$(grep -oE '/docker/[^/ ]+/' /proc/self/mountinfo 2>/dev/null | head -1 | cut -d/ -f3)
  if [ -n "${STACK:-}" ]; then
    CAND="https://${STACK}.${TRAEFIK_HOST}"
    if curl -fsS --max-time 15 "$CAND/" 2>/dev/null | grep -qi openclaw; then
      HOST="$CAND"
    fi
  fi
fi

# Last resort only: every automatic route above failed, so ask rather than
# install something whose chat links would point at localhost.
# `< /dev/tty` because stdin is the piped script.
if [ -z "$HOST" ] && [ -t 1 ] && [ -e /dev/tty ]; then
  printf '\n\033[36m==>\033[0m What address do you open this app on?\n'
  [ -n "${TRAEFIK_HOST:-}" ] \
    && printf '    It ends in \033[1m%s\033[0m — copy it from the Hostinger page.\n' "$TRAEFIK_HOST"
  printf '    Paste it here and press Enter: '
  read -r HOST < /dev/tty || HOST=""
  HOST=$(printf '%s' "$HOST" | tr -d ' \t\r')
  # Accept a bare hostname or a pasted full URL, with or without a trailing slash.
  case "$HOST" in
    "") ;;
    http://*|https://*) ;;
    *) HOST="https://$HOST" ;;
  esac
  HOST=$(printf '%s' "$HOST" | sed 's#/*$##')
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
  warn "Re-run with: curl -fsSL $RAW | PANEL_URL=https://your-address sh"
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
  # Inside Hostinger's container the gateway is supervised by their server.mjs,
  # not by launchd/systemd, so `gateway restart` prints "Gateway service
  # disabled" and exits 0 without doing anything. Killing the process does not
  # help either — nothing respawns it. So try, then let the verify step below
  # decide whether the plugin actually came up.
  openclaw gateway restart >/dev/null 2>&1 || true
fi

# ---- prove it ------------------------------------------------------------
# The panel serves its stylesheet without a session, so a 200 here means the
# address really reaches this gateway. A wrong address is the one mistake that
# otherwise stays invisible until a student taps a dead link on their phone.
CODE=skipped
if [ -n "$HOST" ]; then
  # Give the gateway time to come back before judging it; a fresh start takes
  # well under a minute, and a no-op restart never will.
  n=0
  while [ "$n" -lt 12 ]; do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
           "$HOST/hooks/extend-panel/app.css" 2>/dev/null || echo 000)
    [ "$CODE" = "200" ] && break
    n=$((n + 1))
    sleep 5
  done
fi

if [ "$CODE" = "200" ]; then
  printf '\n\033[32m✓ Extend Panel is installed.\033[0m\n\n'
  printf '  %s/hooks/extend-panel/\n\n' "$HOST"
  printf '  أرسل \033[1m/extend\033[0m في المحادثة للحصول على رابطك الخاص.\n'
  printf '  Send \033[1m/extend\033[0m to your agent to get your private link.\n\n'
elif [ -z "$HOST" ]; then
  # Installed, but /extend would hand out a localhost link, so do not call it done.
  printf '\n\033[33m !\033[0m Extend Panel is installed, but it has no public address yet,\n'
  printf '   so chat links would point at localhost. Set one with:\n\n'
  printf '     curl -fsSL %s | PANEL_URL=https://your-address sh\n\n' "$RAW"
elif [ -z "$CT" ]; then
  # In-container: installed and configured, but only a real app restart loads
  # the plugin, and nothing reachable from in here can trigger one.
  printf '\n\033[33m !\033[0m Almost done — the app needs one restart to load the panel.\n\n'
  printf '   Open your app in the Hostinger dashboard and press \033[1mRestart\033[0m.\n'
  printf '   Then send \033[1m/extend\033[0m in the chat.\n\n'
  printf '   Your panel will be at:\n     %s/hooks/extend-panel/\n\n' "$HOST"
else
  printf '\n\033[33m !\033[0m Installed, but %s did not answer (%s).\n' "$HOST" "$CODE"
  printf '   The plugin is fine; the address may be wrong. Re-run with the right one:\n\n'
  printf '     curl -fsSL %s | PANEL_URL=https://your-address sh\n\n' "$RAW"
fi
