#!/bin/sh
# Puts the TV back into the custom state: root access, hosts blocklist, hidden apps, preload off,
# privacy settings, Pi-hole rules and the launcher with autostart. Every layer checks first and
# skips what is already right, so a second run changes nothing.
#
#   scripts/restore-custom-state.sh [--soft|--full] [--skip-pihole] [--tiles] [--dry-run]
#
# --soft  (default) the TV is still rooted; settings or hooks are lost or drifted.
# --full  the TV lost root (factory reset, firmware change). Starts with scripts/root/bootstrap-root.sh
#         and pauses for the steps that only work on the TV itself.
# --tiles also rebuild app/catalog.json from the TV (node scripts/build-catalog.mjs).
#
# Layers and rollbacks: docs/guide.md. Environment: TV_IP (required, the address of the TV),
# TV_KEY (optional, default ~/.ssh/lgtv_root_ed25519), PIHOLE_URL and PIHOLE_PASSWORD (optional, the Pi-hole layer
# runs only when PIHOLE_URL is set).
set -u
cd "$(dirname "$0")/.."

TV_HOST=root@${TV_IP:?set TV_IP to the address of the TV}
TV_KEY=${TV_KEY:-$HOME/.ssh/lgtv_root_ed25519}
BLOCKED_APP_LIST_DIRECTORY=/var/preferences/com.webos.applicationManager/blockedAppList
# The only hidden IDs that are launch points (tiles in LG Home); the other 36 are not visible anyway.
# The Home Dashboard (com.webos.app.homeconnect) stays visible: the INPUT key opens it, and a hidden app cannot be launched.
BLOAT_TILE_IDS="com.webos.app.lgchannels com.webos.app.igallery com.webos.app.sportsteamsettings amazon.alexa.view com.miniclip.eightballpool"
MODE=soft
SKIP_PIHOLE=no
PIHOLE_SKIP_REASON="--skip-pihole"
[ -z "${PIHOLE_URL:-}" ] && { SKIP_PIHOLE=yes; PIHOLE_SKIP_REASON="PIHOLE_URL not set"; }
REBUILD_TILES=no
DRY_RUN=no
for argument in "$@"; do
    case "$argument" in
        --soft) MODE=soft ;;
        --full) MODE=full ;;
        --skip-pihole) SKIP_PIHOLE=yes ;;
        --tiles) REBUILD_TILES=yes ;;
        --dry-run) DRY_RUN=yes ;;
        *) echo "unknown option $argument" >&2; exit 2 ;;
    esac
done

tv_ssh() {
    ssh -i "$TV_KEY" -o IdentitiesOnly=yes -o ConnectTimeout=10 "$TV_HOST" "$@"
}

# luna-send prints nothing without a terminal (docs/known-traps.md)
tv_ssh_with_terminal() {
    ssh -tt -i "$TV_KEY" -o IdentitiesOnly=yes -o ConnectTimeout=10 "$TV_HOST" "$@"
}

tv_copy() {
    scp -q -i "$TV_KEY" -o IdentitiesOnly=yes "$1" "$TV_HOST:$2"
}

results=""
record() {
    suffix=""
    [ "$DRY_RUN" = yes ] && suffix=" (dry run, nothing done)"
    results="$results
$1: $2$suffix"
}

# Runs the command, or only prints it with --dry-run.
execute() {
    if [ "$DRY_RUN" = yes ]; then
        echo "dry run: $*"
        return 0
    fi
    "$@"
}

wait_for_root_login() {
    for attempt in $(seq 1 60); do
        if tv_ssh 'id -u' 2>/dev/null | grep -q '^0$'; then
            return 0
        fi
        sleep 5
    done
    return 1
}

if [ "$MODE" = full ]; then
    echo "== Full restore: root first"
    echo "Finish the TV setup after the reset: language, wired network with a fixed address (the one in TV_IP),"
    echo "accept only the terms of use, decline every optional consent."
    if [ "$DRY_RUN" = no ]; then
        printf 'Press Enter when the TV shows its home screen: '
        read -r _
        scripts/root/bootstrap-root.sh || { echo "root bootstrap failed" >&2; exit 1; }
        echo "Turn Quick Start+ off in the TV menu (General > Devices > TV Management, or General > Additional Settings)."
        printf 'Press Enter when done: '
        read -r _
    else
        scripts/root/bootstrap-root.sh --dry-run
    fi
fi

if [ "$DRY_RUN" = no ] && ! tv_ssh 'id -u' 2>/dev/null | grep -q '^0$'; then
    echo "No root login on $TV_HOST. If the TV is on and was reset, run with --full." >&2
    exit 1
fi

echo "== Layer: launcher, service and autostart hooks"
if execute scripts/package.sh && execute scripts/install-root.sh; then
    record launcher ok
else
    record launcher FAILED
fi

echo "== Layer: hosts blocklist"
if execute tv_copy scripts/root/blocklist.hosts /var/lib/webosbrew/blocklist.hosts &&
    execute tv_copy scripts/root/10-hosts-blocklist /var/lib/webosbrew/init.d/10-hosts-blocklist &&
    execute tv_ssh 'chmod 755 /var/lib/webosbrew/init.d/10-hosts-blocklist && /var/lib/webosbrew/init.d/10-hosts-blocklist'; then
    record hosts-blocklist ok
else
    record hosts-blocklist FAILED
fi

echo "== Layer: hidden apps"
if [ -f scripts/root/webos-debloat.sh ] && [ -f scripts/root/debloat-ids.txt ]; then
    hidden_ids=$(tr '\n' ' ' <scripts/root/debloat-ids.txt)
    # The region file name depends on the TV's region; webos-debloat.sh also takes the first *.json.
    if [ "$DRY_RUN" = yes ]; then
        echo "dry run: would detect the region file in $BLOCKED_APP_LIST_DIRECTORY"
        blocked_app_list="$BLOCKED_APP_LIST_DIRECTORY/<region>.json"
    else
        blocked_app_list=$(tv_ssh "ls $BLOCKED_APP_LIST_DIRECTORY/*.json 2>/dev/null | head -n 1" | tr -d '\r')
    fi
    # sam rewrites the list at boot (cause unknown); the immutable bit keeps the entries.
    # webos-debloat.sh replaces the file by mv, which fails while the bit is set.
    if [ -n "$blocked_app_list" ] &&
        execute tv_ssh 'mkdir -p /var/lib/webos-debloat' &&
        execute tv_copy scripts/root/webos-debloat.sh /var/lib/webos-debloat/webos-debloat.sh &&
        execute tv_ssh "chattr -i $blocked_app_list 2>/dev/null; true" &&
        execute tv_ssh_with_terminal "sh /var/lib/webos-debloat/webos-debloat.sh --apply --id '$hidden_ids'" &&
        execute tv_ssh "chattr +i $blocked_app_list"; then
        record hidden-apps ok
    else
        record hidden-apps FAILED
    fi
else
    record hidden-apps "SKIPPED (scripts/root/webos-debloat.sh or debloat-ids.txt missing)"
fi

echo "== Layer: preload off"
if execute tv_ssh_with_terminal /var/lib/webosbrew/30-preload-off.sh; then
    record preload-off ok
else
    record preload-off FAILED
fi

echo "== Layer: TV settings"
if execute tv_copy scripts/root/apply-settings.sh /var/lib/webosbrew/apply-settings.sh &&
    execute tv_ssh_with_terminal 'sh /var/lib/webosbrew/apply-settings.sh'; then
    record tv-settings ok
else
    record tv-settings FAILED
fi

echo "== Layer: Pi-hole rules"
if [ "$SKIP_PIHOLE" = yes ]; then
    record pihole-rules "SKIPPED ($PIHOLE_SKIP_REASON)"
elif execute node scripts/pihole-rules.mjs; then
    record pihole-rules ok
else
    record pihole-rules FAILED
fi

if [ "$REBUILD_TILES" = yes ]; then
    echo "== Layer: tiles"
    if execute node scripts/build-catalog.mjs; then
        record tiles ok
    else
        record tiles FAILED
    fi
fi

if [ "$DRY_RUN" = yes ]; then
    echo "$results"
    echo "== Dry run done; nothing was changed on the TV"
    exit 0
fi

echo "== Reboot and check"
tv_ssh reboot 2>/dev/null
sleep 20
if wait_for_root_login; then
    echo "TV is back; waiting 60 s for the launcher takeover"
    sleep 60
    tv_ssh 'grep -q "# BEGIN launcher blocklist" /etc/hosts' && record check-hosts ok || record check-hosts FAILED
    tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.service.config/getConfigs "{\"configNames\":[\"com.webos.surfacemanager.disableHome\"]}"' |
        grep -q 'disableHome": *true' && record check-home-key-takeover ok || record check-home-key-takeover FAILED
    tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo "{}"' |
        grep -q 'lgtv.blueprint.launcher' && record check-launcher-in-front ok || record check-launcher-in-front FAILED
    tv_ssh_with_terminal 'sh /var/lib/webosbrew/apply-settings.sh' | grep -q -E 'set to|could not be set' && record check-settings FAILED || record check-settings ok
    launch_points=$(tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.applicationManager/listLaunchPoints "{}"' | tr -d '\r')
    if echo "$launch_points" | grep -q '"returnValue": *true'; then
        visible_tiles=$(for tile_id in $BLOAT_TILE_IDS; do
            echo "$launch_points" | grep -q "\"launchPointId\" *: *\"${tile_id}_default\"" && echo "$tile_id"
        done)
        [ -z "$visible_tiles" ] && record check-hidden-apps ok || record check-hidden-apps "FAILED (still visible: $visible_tiles)"
    else
        record check-hidden-apps "FAILED (no launch point list)"
    fi
    [ "$SKIP_PIHOLE" = yes ] || { node scripts/pihole-rules.mjs --check >/dev/null && record check-pihole ok || record check-pihole FAILED; }
else
    record check-reboot "FAILED (no root login after 5 minutes)"
fi

echo "$results"
echo
echo "Look at the TV: the launcher grid must be on screen, not a black screen or LG Home."
case "$results" in
    *FAILED*) exit 1 ;;
esac
