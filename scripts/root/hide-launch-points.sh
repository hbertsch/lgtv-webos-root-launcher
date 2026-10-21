#!/bin/sh
# hide-launch-points.sh — remove the launch points of the apps in an ID list.
#
# Installed at /var/lib/webosbrew/hide-launch-points.sh (mode 755). Run by hand:
#   hide-launch-points.sh <id-list-file>
#
# What it does:
#   - reads one app id per line from the list file;
#   - calls com.webos.applicationManager/removeLaunchPoint with
#     launchPointId "<id>_default" for each id;
#   - writes the answer and the exit status of luna-send to the log file.
#
# The change is not stored: after a reboot the tiles come back, so a boot hook
# has to run this script again. Always exits 0.

LOG=/var/log/60-hide-apps.log

if [ ! -f "${1:-}" ]; then
    echo "usage: $0 <id-list-file>" >&2
    exit 0
fi

while read -r app_id; do
    [ -z "$app_id" ] && continue
    response=$(luna-send -n 1 luna://com.webos.applicationManager/removeLaunchPoint \
        "{\"launchPointId\":\"${app_id}_default\"}" 2>&1)
    exit_status=$?
    echo "$(date '+%Y-%m-%d %H:%M:%S') $app_id exit=$exit_status $response" >>"$LOG"
    echo "$app_id exit=$exit_status $response"
done <"$1"
exit 0
