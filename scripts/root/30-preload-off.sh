#!/bin/sh
# 30-preload-off.sh — stop apps in APP_IDS from being preloaded.
#
# Installed at /var/lib/webosbrew/30-preload-off.sh (mode 755). Run by hand:
#   30-preload-off.sh            turn preload off for the apps in APP_IDS
#   30-preload-off.sh --restore  put these apps back as in the backup
#
# What it does:
#   - reads com.webos.service.preloadmanager.supportAppList through
#     com.webos.service.config/getConfigs;
#   - keeps the original list in /var/lib/webosbrew/preload-backup.json (written
#     once, never overwritten, so a second run cannot save the changed list);
#   - sets isEnabled=false for the apps below and nothing else, writes the
#     list back with setConfigs and tells the running preload manager with
#     setPreloadPolicy.
#
# The TV's node has no jq counterpart in the base image, so the JSON edit runs
# in node. Home, Live TV and HDMI are never touched: only IDs in APP_IDS change.
#
# Technique after Glasshouse server/lib/preload.js (MIT, https://github.com/rorygallagher2024/glasshouse).

set -u

CONFIG_NAME=com.webos.service.preloadmanager.supportAppList
APP_IDS="com.webos.app.lgchannels com.webos.app.browser com.webos.app.voice google.assistant com.webos.app.livemenu youtube.leanback.v4 amazon"
BACKUP=/var/lib/webosbrew/preload-backup.json
WORK=/tmp/launcher-preload
LOG=/var/log/30-preload-off.log

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >>"$LOG" 2>/dev/null
    echo "$*"
}

mkdir -p "$WORK" || exit 1

# Reads the supportAppList and prints the bare JSON array.
read_list() {
    luna-send -n 1 luna://com.webos.service.config/getConfigs \
        "{\"configNames\":[\"$CONFIG_NAME\"]}" |
        node -e '
var input = "";
process.stdin.on("data", function (chunk) { input += chunk; });
process.stdin.on("end", function () {
    var response = JSON.parse(input);
    if (!response.returnValue || !response.configs || !response.configs[process.argv[1]]) {
        process.exit(1);
    }
    process.stdout.write(JSON.stringify(response.configs[process.argv[1]]));
});' "$CONFIG_NAME"
}

# Prints the new list. Mode "off": the app IDs get isEnabled=false.
# Mode "restore": the app IDs get the isEnabled value stored in the backup.
rewrite_list() {
    mode=$1
    node -e '
var fs = require("fs");
var mode = process.argv[1];
var appIds = process.argv[2].split(" ");
var current = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
var backup = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
current.forEach(function (entry) {
    if (appIds.indexOf(entry.id) === -1) { return; }
    if (mode === "off") {
        entry.isEnabled = false;
        return;
    }
    backup.forEach(function (original) {
        if (original.id === entry.id) { entry.isEnabled = original.isEnabled; }
    });
});
process.stdout.write(JSON.stringify(current));
' "$mode" "$APP_IDS" "$WORK/current.json" "$BACKUP"
}

# Pushes the isEnabled state of every app in APP_IDS to the running preload manager.
# Reads the target state from the list in $WORK/new.json.
apply_policy() {
    for app_id in $APP_IDS; do
        is_enabled=$(node -e '
var list = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
list.forEach(function (entry) {
    if (entry.id === process.argv[2]) { process.stdout.write(String(entry.isEnabled)); }
});' "$WORK/new.json" "$app_id")
        response=$(luna-send -n 1 luna://com.webos.service.preloadmanager/setPreloadPolicy \
            "{\"application\":{\"id\":\"$app_id\",\"isEnabled\":$is_enabled}}")
        log "setPreloadPolicy $app_id isEnabled=$is_enabled -> $response"
    done
}

mode=off
[ "${1:-}" = "--restore" ] && mode=restore

if ! read_list >"$WORK/current.json" 2>>"$LOG"; then
    log "cannot read $CONFIG_NAME; nothing changed"
    exit 1
fi

if [ "$mode" = "off" ] && [ ! -f "$BACKUP" ]; then
    cp "$WORK/current.json" "$BACKUP" || { log "cannot write $BACKUP; nothing changed"; exit 1; }
    log "saved original list to $BACKUP"
fi

if [ ! -f "$BACKUP" ]; then
    log "no backup at $BACKUP; nothing to restore"
    exit 1
fi

if ! rewrite_list "$mode" >"$WORK/new.json" 2>>"$LOG"; then
    log "cannot rewrite the list; nothing changed"
    exit 1
fi

response=$(luna-send -n 1 luna://com.webos.service.config/setConfigs \
    "{\"configs\":{\"$CONFIG_NAME\":$(cat "$WORK/new.json")}}")
log "setConfigs ($mode) -> $response"

apply_policy
exit 0
