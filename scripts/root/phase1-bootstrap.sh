#!/bin/sh
# Payload for the second SlopBro run (replaces wwwroot/autoroot.sh in the throwaway copy that
# scripts/root/bootstrap-root.sh builds). It runs on the TV as root, after the first SlopBro run
# installed and elevated Homebrew Channel. It makes root access survive a reboot:
#   - puts the public SSH key into /home/root/.ssh/authorized_keys
#   - turns on sshd and the firmware update block, and turns the telnet server off (flag files
#     read by Homebrew Channel; without the telnet flag it starts a root telnet without password)
#   - installs Homebrew Channel's startup.sh and registers its boot activity
# bootstrap-root.sh replaces the placeholder below with the key before the run.
PUBLIC_KEY='@@PUBLIC_KEY@@'
LOG=/tmp/phase1-bootstrap.log
HBC_SERVICE_DIR=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service

log() {
    echo "$*" >>"$LOG"
}

mkdir -p /home/root/.ssh
chmod 700 /home/root/.ssh
echo "$PUBLIC_KEY" >/home/root/.ssh/authorized_keys
chmod 600 /home/root/.ssh/authorized_keys
log "authorized_keys written"

mkdir -p /var/luna/preferences
: >/var/luna/preferences/webosbrew_sshd_enabled
: >/var/luna/preferences/webosbrew_block_updates
: >/var/luna/preferences/webosbrew_telnet_disabled
log "sshd, update block and telnet disabled flags created"

mkdir -p /var/lib/webosbrew/init.d
cp "$HBC_SERVICE_DIR/startup.sh" /var/lib/webosbrew/startup.sh
chmod 755 /var/lib/webosbrew/startup.sh
log "startup.sh installed"

luna-send -w 3000 -n 1 -a org.webosbrew.hbchannel luna://org.webosbrew.hbchannel.service/autostart '{"reason":"activity"}' >>"$LOG" 2>&1
log "autostart called"
