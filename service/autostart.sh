#!/bin/sh
# 50-launcher — starts the launcher service at every cold boot.
#
# Installed as a symlink: /var/lib/webosbrew/init.d/50-launcher -> this file in the
# installed service directory. Homebrew Channel's run-parts loop runs it on each boot.
# It starts the service in the background and returns at once, so boot is never blocked.
# Remove the symlink (or uninstall the app) to turn autostart off.
SERVICE_DIR=/media/developer/apps/usr/palm/services/lgtv.blueprint.launcher.service
SERVICE_ID=lgtv.blueprint.launcher.service
PID_FILE=/tmp/launcher-service.pid
ELEVATE=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service
ELEVATED_ROLE=/var/luna-service2-dev/roles.d/lgtv.blueprint.launcher.service.service.json

[ -f "$SERVICE_DIR/service.js" ] || exit 0

if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null
fi

# The service switches the system's own HOME handling off while it runs. Switch it back on
# first, so a service that does not start leaves HOME working (it sets the value again itself).
luna-send -n 1 luna://com.webos.service.config/setConfigs '{"configs":{"com.webos.surfacemanager.disableHome":false}}' >/dev/null 2>&1

export NODE_PATH=/usr/lib/node_modules:/usr/lib/nodejs
cd "$SERVICE_DIR" || exit 0

# The elevated role survives reboots and only an install resets it, so elevate-service
# (a node start, about 4 s) runs only when the role file lacks the elevated entry.
if [ -x "$ELEVATE" ] && ! grep -q '"service":"\*"' "$ELEVATED_ROLE" 2>/dev/null; then
    "$ELEVATE" "$SERVICE_ID" >/tmp/launcher-elevate.log 2>&1 || echo "elevate-service failed" >>/tmp/launcher-elevate.log
fi

nohup /usr/bin/node service.js --boot --watch >/tmp/launcher-service.stdout 2>&1 &
exit 0
