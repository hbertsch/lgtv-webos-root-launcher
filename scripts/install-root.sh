#!/bin/sh
# Installs the launcher IPK on the rooted TV, copies the helper scripts and arms
# the cold-boot autostart. Run scripts/package.sh first.
#
# ares-install does not work against the root profile on firmware 03.53.45, so the
# IPK goes over scp and the app install service.
# Needs TV_IP (the address of the TV); TV_KEY is optional (default ~/.ssh/lgtv_root_ed25519).
set -e
cd "$(dirname "$0")/.."

TV_HOST=root@${TV_IP:?set TV_IP to the address of the TV}
TV_KEY=${TV_KEY:-$HOME/.ssh/lgtv_root_ed25519}
IPK=dist/lgtv.blueprint.launcher_1.0.0_all.ipk
REMOTE_IPK=/media/developer/temp/lgtv.blueprint.launcher_1.0.0_all.ipk
SERVICE_DIR=/media/developer/apps/usr/palm/services/lgtv.blueprint.launcher.service
HOOK=/var/lib/webosbrew/init.d/50-launcher

tv_ssh() {
    ssh -i "$TV_KEY" -o IdentitiesOnly=yes "$TV_HOST" "$@"
}

[ -f "$IPK" ] || { echo "missing $IPK; run scripts/package.sh first" >&2; exit 1; }

scp -i "$TV_KEY" -o IdentitiesOnly=yes "$IPK" "$TV_HOST:$REMOTE_IPK"
scp -i "$TV_KEY" -o IdentitiesOnly=yes scripts/root/30-preload-off.sh "$TV_HOST:/var/lib/webosbrew/30-preload-off.sh"
tv_ssh "chmod 755 /var/lib/webosbrew/30-preload-off.sh"
scp -i "$TV_KEY" -o IdentitiesOnly=yes scripts/root/40-home-reset "$TV_HOST:/var/lib/webosbrew/init.d/40-home-reset"
tv_ssh "chmod 755 /var/lib/webosbrew/init.d/40-home-reset"

# The install call is a subscription that never ends by itself: run it in the
# background on the TV, wait for state installed, then stop it.
tv_ssh "rm -f /tmp/launcher-install.log; \
    (luna-send -i luna://com.webos.appInstallService/dev/install \
    '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$REMOTE_IPK\",\"subscribe\":true}' \
    >/tmp/launcher-install.log 2>&1 &)"
installed=no
for attempt in $(seq 1 30); do
    if tv_ssh "grep -q '\"state\":\"installed\"' /tmp/launcher-install.log"; then
        installed=yes
        break
    fi
    sleep 2
done
tv_ssh "pkill luna-send; true"
[ "$installed" = yes ] || { echo "install did not report state installed" >&2; exit 1; }

# Installing resets the service ACLs: elevate again, then arm the hook and run it once.
tv_ssh "ln -sf $SERVICE_DIR/autostart.sh $HOOK && sh $HOOK"
sleep 3
tv_ssh "ls -l $HOOK; cat /tmp/launcher-elevate.log; tail -n 5 /tmp/launcher-service.log"

cat <<'VERIFY'

Verify:
  ssh -tt <tv> 'luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo "{}"'
  ssh <tv> 'ls -l /var/lib/webosbrew/init.d/50-launcher; cat /tmp/launcher-service.log; kill -0 $(cat /tmp/launcher-service.pid) && echo alive'
Remove autostart: ssh <tv> rm /var/lib/webosbrew/init.d/50-launcher
VERIFY
