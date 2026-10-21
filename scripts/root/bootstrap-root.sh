#!/bin/sh
# Roots a TV that lost root (factory reset, firmware change): SlopBro installs Homebrew Channel,
# then a second SlopBro run with scripts/root/phase1-bootstrap.sh makes SSH access permanent.
# Steps and pins are explained in docs/guide.md, step 1.
#
# Needs: git, python3, curl, the key pair ~/.ssh/lgtv_root_ed25519(.pub), the TV on the same network
# with the "LG Connect Apps" pairing prompt answered on the remote.
#   scripts/root/bootstrap-root.sh [--dry-run]
set -e
cd "$(dirname "$0")/../.."

TV_IP=${TV_IP:?set TV_IP to the address of the TV}
TV_KEY=${TV_KEY:-$HOME/.ssh/lgtv_root_ed25519}
SLOPBRO_URL=https://github.com/throwaway96/slopbro
SLOPBRO_COMMIT=21023d56ca424607bb03d2939609cc658c655fc7
HBC_URL=https://github.com/webosbrew/webos-homebrew-channel/releases/download/v0.7.3/org.webosbrew.hbchannel_0.7.3_all.ipk
HBC_SHA256=d10bf3c753551d7c72fb7a92b20fcd2317e502a220ac668ba8e76f6ea78b363c
DRY_RUN=no
[ "${1:-}" = "--dry-run" ] && DRY_RUN=yes

# Downloaded code is untrusted: it lives in its own new directory and python runs in isolated mode.
download_directory=$(mktemp -d "${TMPDIR:-/tmp}/slopbro-download.XXXXXX")
trap 'rm -rf "$download_directory"' EXIT

echo "1/5 Check the Homebrew Channel release file"
curl -sSL -o "$download_directory/hbchannel.ipk" "$HBC_URL"
actual_sha256=$(shasum -a 256 "$download_directory/hbchannel.ipk" | cut -d' ' -f1)
[ "$actual_sha256" = "$HBC_SHA256" ] || { echo "Homebrew Channel SHA-256 mismatch: $actual_sha256" >&2; exit 1; }

echo "2/5 Fetch SlopBro at the pinned commit"
git clone --quiet "$SLOPBRO_URL" "$download_directory/slopbro"
git -C "$download_directory/slopbro" checkout --quiet "$SLOPBRO_COMMIT"
[ "$(git -C "$download_directory/slopbro" rev-parse HEAD)" = "$SLOPBRO_COMMIT" ] || { echo "SlopBro commit mismatch" >&2; exit 1; }

local_ip=$(ipconfig getifaddr en0)
if [ "$DRY_RUN" = yes ]; then
    echo "dry run: would run slopbro.py twice against $TV_IP from $local_ip; stopping here"
    exit 0
fi

echo "3/5 First SlopBro run: install and elevate Homebrew Channel. Answer the pairing prompt on the TV."
python3 -I "$download_directory/slopbro/slopbro.py" --webos-version 6 --local-ip "$local_ip" "$TV_IP"

echo "4/5 Second SlopBro run: permanent SSH key, sshd, update block"
public_key=$(cat "$TV_KEY.pub")
sed "s|@@PUBLIC_KEY@@|$public_key|" scripts/root/phase1-bootstrap.sh >"$download_directory/slopbro/wwwroot/autoroot.sh"
python3 -I "$download_directory/slopbro/slopbro.py" --webos-version 6 --asset-source dir --local-ip "$local_ip" "$TV_IP"

echo "5/5 Wait for the TV to reboot, then test the key login"
echo "The TV reboots by itself. If it does not, restart it with the remote."
for attempt in $(seq 1 60); do
    if ssh -i "$TV_KEY" -o IdentitiesOnly=yes -o ConnectTimeout=5 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "root@$TV_IP" 'id -u' 2>/dev/null | grep -q '^0$'; then
        echo "root login works"
        exit 0
    fi
    sleep 5
done
echo "no root login after 5 minutes" >&2
exit 1
