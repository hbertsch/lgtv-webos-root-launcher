#!/bin/sh
# apply-settings.sh — set the TV settings of the custom state and skip those already right.
#
# Runs on the TV (copy it there, call it under ssh -tt, luna-send prints nothing without a TTY).
# Settings from docs/guide.md, steps 2 and 4: the four privacy keys and homeAutoLaunch off, which the
# launcher needs so that a mains start opens the launcher instead of LG Home.
# The consent flags are not set here: they belong to the TV setup after a factory reset.
set -u

# Prints "unchanged" or "changed" per key; exits 1 if a call fails.
set_if_different() {
    category=$1
    key=$2
    wanted=$3
    current=$(luna-send -n 1 luna://com.webos.settingsservice/getSystemSettings "{\"category\":\"$category\",\"keys\":[\"$key\"]}")
    if echo "$current" | grep -q "\"$key\": *\"$wanted\""; then
        echo "$category:$key already $wanted"
        return 0
    fi
    response=$(luna-send -n 1 luna://com.webos.settingsservice/setSystemSettings "{\"category\":\"$category\",\"settings\":{\"$key\":\"$wanted\"}}")
    if echo "$response" | grep -q '"returnValue": *true'; then
        echo "$category:$key set to $wanted"
        return 0
    fi
    echo "$category:$key could not be set: $response"
    return 1
}

failed=0
set_if_different general homeAutoLaunch off || failed=1
set_if_different general lmt on || failed=1
set_if_different general adCookie off || failed=1
set_if_different option livePromotion off || failed=1
set_if_different option webOSPromotionVideo off || failed=1
exit $failed
