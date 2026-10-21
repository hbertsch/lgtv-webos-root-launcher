# Guide: root, privacy, debloat and launcher

This guide takes a 2021 LG OLED from the stock home screen to a rooted TV with a privacy layer, fewer apps in the way and the custom launcher. Every step has a check and an undo. Do the steps in order, and run the check of a step before you go on.

## Before you start

### Risks

- Rooting can brick the TV and void its warranty. You do it at your own risk.
- Firmware updates stay blocked on purpose. The update servers are blocked in the TV's hosts file and a flag file tells Homebrew Channel to keep them blocked. You will not get LG's security updates until you undo this.
- A factory reset (Settings > General > Reset to Initial Settings) removes root, the launcher and every hook. It is the last-resort undo.

### What was verified

All of this was done on one TV:

| Fact | Value |
|---|---|
| Model | OLED55B19LA |
| Firmware | 03.53.45 |
| webOS | 6.5.3-47 |
| Root exploit | SlopBro, commit `21023d56ca424607bb03d2939609cc658c655fc7` |
| Root tool | Homebrew Channel v0.7.3 |

Other models and firmware versions are not tested, see [6. Other models](#6-other-models). The root tools change over time. Check https://github.com/throwaway96/slopbro and https://github.com/webosbrew/webos-homebrew-channel for the versions and models they support today before you run anything.

### What you need

- A Mac. The scripts use macOS tools (`ipconfig`, `shasum`) and no Linux or Windows host is supported.
- `ares-cli` (`ares-package`), Node 22 or newer, Python 3, `git`, `curl`, `ssh` and `scp`.
- The TV on a wired network with a fixed address (a reservation in your router is enough), on the same network as the Mac.
- An SSH key pair for the TV:

  ```sh
  ssh-keygen -t ed25519 -f ~/.ssh/lgtv_root_ed25519
  ```

Set the TV's address in every terminal you use. The scripts stop with a message when `TV_IP` is missing.

```sh
export TV_IP=192.0.2.18   # use the address of your TV
export TV_KEY=~/.ssh/lgtv_root_ed25519
```

The commands in this guide use three small helpers. Paste them once per terminal. The terminal variant matters: `luna-send` prints nothing over an SSH session without a terminal, so every `luna-send` call goes through `tv_ssh_with_terminal`.

```sh
tv_ssh() { ssh -i "$TV_KEY" -o IdentitiesOnly=yes "root@$TV_IP" "$@"; }
tv_ssh_with_terminal() { ssh -tt -i "$TV_KEY" -o IdentitiesOnly=yes "root@$TV_IP" "$@"; }
tv_copy() { scp -i "$TV_KEY" -o IdentitiesOnly=yes "$1" "root@$TV_IP:$2"; }
```

Run all commands from the project folder.

### Shortcut after the root step

`scripts/restore-custom-state.sh` runs every layer of steps 2 to 4 in one go (launcher, hosts blocklist, hidden apps, preload, settings and, if `PIHOLE_URL` is set, the Pi-hole rules). It checks each layer first, skips what is already right, reboots the TV and checks the result. Use `--dry-run` to see the steps. It is also the way back after a factory reset: `--full` starts with the root step. The sections below describe the same layers one at a time, which is the better way to learn what each one does.

## 1. Root

Root needs two things from you on the TV itself: answer a pairing prompt, and switch Quick Start+ off.

1. In the TV menu, switch Quick Start+ off (General > Devices > TV Management, or General > Additional Settings, depending on the model). With it on, a power-off does not give a real boot and hooks behave differently.
2. If the LG Developer Mode app is installed, uninstall it in the TV's app list before you run the root script, and do not install it again while the TV is rooted. Background: the app is LG's official way to install your own apps with `ares-install`. The tested TV had it installed first for that, and it was removed before rooting. The scripts in this repository do not need it. SlopBro warns when the app is present, and after root the install goes through `scripts/install-root.sh`, because `ares-install` fails on this firmware. An agent that finds the app on your TV should remove it at this point, not use it.
3. Test the download step. `--dry-run` downloads the pinned tools and checks their checksums but does not touch the TV:

   ```sh
   scripts/root/bootstrap-root.sh --dry-run
   ```

4. Then run it for real:

   ```sh
   scripts/root/bootstrap-root.sh
   ```

The script does five things. It downloads Homebrew Channel and checks its SHA-256, clones SlopBro at the pinned commit, runs SlopBro to install and elevate Homebrew Channel, runs SlopBro a second time with `scripts/root/phase1-bootstrap.sh` as payload, and waits for the TV to reboot and accept your key.

During the first SlopBro run the TV shows a pairing prompt. Accept it with the remote. The second run puts your public key into `/home/root/.ssh/authorized_keys`, turns on the SSH server, creates the flag files that block firmware updates and disable the telnet server, and registers Homebrew Channel's boot activity. The TV reboots by itself. If it does not, restart it with the remote.

Without the telnet flag, Homebrew Channel starts a telnet server with a root shell and no password. The payload creates the flag, but check it (below).

Homebrew Channel appears in the TV's app list only after the next reboot. Root is active before that.

### Check

```sh
tv_ssh 'id -u'                                                   # 0
nc -z -w 3 "$TV_IP" 23 || echo "telnet port closed"             # telnet port closed
ssh -o BatchMode=yes -o PubkeyAuthentication=no -o PreferredAuthentications=password "root@$TV_IP" true   # must fail
tv_ssh 'ls /var/luna/preferences/ | grep webosbrew_'            # sshd_enabled, block_updates, telnet_disabled
tv_ssh_with_terminal 'luna-send -w 3000 -n 1 -a webosbrew luna://org.webosbrew.hbchannel.service/getConfiguration "{}"'
```

The last call should show `root`, `sshdEnabled`, `telnetDisabled` and `blockUpdates` as `true` and `failsafe` as `false`. Reboot once (`tv_ssh reboot`) and run `tv_ssh 'id -u'` again to be sure root survives a boot.

The payload already calls Homebrew Channel's `autostart` once, which registers the boot activity. Without that call nothing root-related runs at boot. If the hosts hook from step 2 does not show up in `/etc/hosts` after a reboot, call it again:

```sh
tv_ssh_with_terminal 'luna-send -w 3000 -n 1 -a webosbrew luna://org.webosbrew.hbchannel.service/autostart "{\"reason\":\"activity\"}"'
```

### Recovery

- A boot hangs after a hook was added: Homebrew Channel's failsafe starts a root telnet server on your network when the flag `/var/luna/preferences/webosbrew_failsafe` survives a boot. Log in, remove the last hook under `/var/lib/webosbrew/init.d/` and reboot.
- SSH does not answer but the TV reacts to its remote: the TV drops SSH in standby. Wake it with the remote and try again. Otherwise use Homebrew Channel's own settings on the TV.
- You lost the launcher app only: run `scripts/package.sh` and `scripts/install-root.sh` again (step 4).
- Settings, hooks or root are gone after a reset or a firmware change: `scripts/restore-custom-state.sh --soft` if SSH still works, `--full` if root is gone.

### Undo

- Remove the key from `/home/root/.ssh/authorized_keys` (or delete the file) and reboot. Homebrew Channel then falls back to its default `alpine` password. Re-add the key, or disable SSH in Homebrew Channel.
- Disable SSH and enable telnet again in Homebrew Channel's settings, or write the flags through `setConfiguration`.
- Remove the update block: `luna://org.webosbrew.hbchannel.service/setConfiguration {"blockUpdates":false}`, then reboot.
- Uninstall Homebrew Channel (its UI or the app manager). This removes its service and boot activity, but `/var/lib/webosbrew` and the flag files stay.
- The complete undo is the factory reset named under Risks.

## 2. Privacy

Three layers block LG's tracking, advertising and update traffic: the TV's own hosts file, optional rules on a Pi-hole, and the TV's consent and ad settings.

### Consent choices during TV setup

The consent flags are not set by a script. They belong to the TV setup after a factory reset, and you choose them yourself there. The setup used for this guide: accept only the terms of use (`generalTermsAllowed` and `networkAllowed` stay `true`), decline every optional consent (ACR, ad personalisation, third-party sharing, cookies, voice, remote diagnostics, marketing, shopping and the additional data options). If you accepted some earlier, change them in the TV's settings menu or reset the TV.

Check them (the optional keys should all be `false`):

```sh
tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.settingsservice/getSystemSettings "{\"keys\":[\"eulaStatus\"]}"'
```

### Hosts layer

`scripts/root/blocklist.hosts` lists names that the TV maps to `0.0.0.0`. The hook `scripts/root/10-hosts-blocklist` runs at every boot from Homebrew Channel. It builds a copy of `/etc/hosts` with the list added and mounts that copy over `/etc/hosts`. It never writes the real file, so the change disappears when the hook is removed and the TV reboots. On any failure the hook leaves Homebrew Channel's mount alone and exits 0, so it cannot stall a boot.

```sh
tv_copy scripts/root/blocklist.hosts /var/lib/webosbrew/blocklist.hosts
tv_copy scripts/root/10-hosts-blocklist /var/lib/webosbrew/init.d/10-hosts-blocklist
tv_ssh 'chmod 755 /var/lib/webosbrew/init.d/10-hosts-blocklist && /var/lib/webosbrew/init.d/10-hosts-blocklist'
```

Check:

```sh
tv_ssh 'tail -n 2 /var/log/10-hosts-blocklist.log'               # "mounted ... over /etc/hosts (N blocked names)"
tv_ssh 'grep -c "^0.0.0.0" /etc/hosts'                           # at least N
tv_ssh 'getent hosts prov-lg.alphonso.tv'                        # :: or 0.0.0.0
tv_ssh 'getent hosts lgappstv.com'                               # a real address
```

Each manual re-run stacks one more mount over `/etc/hosts`. That is harmless, and a reboot resets it. Reboot and run the checks again: after a boot there should be exactly one more mount than before the hook (`tv_ssh 'mount | grep hosts'`).

### Names that must stay resolvable

The Content Store, the TV clock and some apps break when these names are blocked. They are not in `blocklist.hosts` and `scripts/root/pihole-rules.json` allows them:

`de.nextlgsdp.com`, `de.ibs.nextlgsdp.com`, `de.emp.lgsmartplatform.com`, `eic.tv.wiselg.com`, `de.lgrecommends.lgappstv.com`, `eic-ngfts.tv.wiselg.com`, `ngfts.tv.wiselg.com` and `eic-gfts.tv.wiselg.com`.

Also left open: `lgtvsdp.com`, `lgappstv.com`, `lge.com`, `lgeapi.com` and their subdomains, and `discovery.meethue.com` for Hue.

Symptoms of a name that is blocked by mistake: the Content Store shows network error 102, an app such as ZDF shows an error code, or the TV clock is one hour behind after a reboot. After every reboot compare `date` on the TV with the Mac before you blame an app. To find what an app needs, unmount the hook's mounts (`umount /etc/hosts` for each mount of the hook; keep Homebrew Channel's, check with `mount | grep hosts`), start the app and read your DNS log for the TV. Names that the hosts file maps to `0.0.0.0` never reach a Pi-hole, so this is the only way to see them. Then re-run the hook.

### The `de.` prefixes

Several names carry the German region prefix (`de.nextlgsdp.com`, `de.info.lgsmartad.com`, `de.rdx2.nextlgsdp.com`, `de.emp.lgsmartplatform.com` and others) in `scripts/root/blocklist.hosts` and `scripts/root/pihole-rules.json`. The TV talks to the server of its own region. Check your own DNS log for the prefix your TV uses (`fr.`, `uk.`, `us.`, `eic.` and so on) and adjust the files. The "must stay resolvable" list has the same prefixes.

### Settings layer

`scripts/root/apply-settings.sh` sets the privacy keys that a TV does not offer in an obvious place and skips those that are already right. It runs on the TV under a terminal.

```sh
tv_copy scripts/root/apply-settings.sh /var/lib/webosbrew/apply-settings.sh
tv_ssh_with_terminal 'sh /var/lib/webosbrew/apply-settings.sh'
```

| Key | Value set |
|---|---|
| `general:lmt` (Limit Ad Tracking) | `on` |
| `general:adCookie` | `off` |
| `option:livePromotion` | `off` |
| `option:webOSPromotionVideo` | `off` |
| `general:homeAutoLaunch` (Power On Screen) | `off`, needed by the launcher in step 4 |

A second run prints "already" for every key.

### Optional: Pi-hole layer

If your network uses a Pi-hole (version 6) as the TV's DNS server, `scripts/pihole-rules.mjs` adds the deny and allow rules from `scripts/root/pihole-rules.json`. It adds only the missing ones.

```sh
export PIHOLE_URL=http://192.0.2.2     # address of your Pi-hole
export PIHOLE_PASSWORD=...             # an app password
node scripts/pihole-rules.mjs --check  # only report
node scripts/pihole-rules.mjs          # add what is missing
```

Notes:

- An allow rule always wins over a deny rule. If a name stays blocked or open against your expectation, look at the allow list first.
- The Pi-hole API takes the domain text in the path for `PUT` and `DELETE` (`/api/domains/{type}/{kind}/{domain}`), not the numeric id.
- Without a second resolver, a Pi-hole outage takes DNS away from the TV. Plan for it: start the Pi-hole again, or set a temporary resolver on the router.
- A firewall redirect for DNS did not work: on this firmware `iptables` has a `nat` table but no DNAT target. Programs that hard-code a public resolver such as `8.8.8.8` go around the Pi-hole. The hosts layer covers part of that.

### Undo

```sh
# hosts layer: remove the hook and data, reboot
tv_ssh 'rm -f /var/lib/webosbrew/init.d/10-hosts-blocklist /var/lib/webosbrew/blocklist.hosts; reboot'
```

- Pi-hole: delete the rules with the comment used by the script on the Pi-hole's Domains page.
- Settings: put the keys back (`general:lmt` `off`, `general:adCookie` `on`, `option:livePromotion` `on`, `option:webOSPromotionVideo` `on`) with `setSystemSettings`, as in `scripts/root/apply-settings.sh`. Leave `homeAutoLaunch` for step 4.

## 3. Hide apps and stop preloading

### Hide apps

`scripts/root/webos-debloat.sh` hides apps by editing LG's own list of hidden apps. Nothing is deleted and the root file system is untouched, so updates and the recovery path behave as on a stock TV. The script comes from a public gist (credited in `THIRD-PARTY-NOTICES.md`) with two changes: webOS 6.5.3 keeps the list in `blockedAppList/<REGION>.json` under the key `blocked_applist`, not in `blockedSystemAppList` as the original assumes. The original would write to an unused folder and hide nothing.

`scripts/root/debloat-ids.txt` has the 41 app ids to hide: advertising and ACR helpers, example apps from the SDK, demo apps, the remote service, and visible extras (LG Channels, Art Gallery, Sports Alert, Alexa, Google Assistant promo and others). Edit it before you run. Apps you use must not be in it.

```sh
tv_ssh 'mkdir -p /var/lib/webos-debloat'
tv_copy scripts/root/webos-debloat.sh /var/lib/webos-debloat/webos-debloat.sh
hidden_ids=$(tr '\n' ' ' < scripts/root/debloat-ids.txt)
tv_ssh_with_terminal 'sh /var/lib/webos-debloat/webos-debloat.sh --list'                              # what the TV has
tv_ssh_with_terminal "sh /var/lib/webos-debloat/webos-debloat.sh --apply --dry-run --id '$hidden_ids'"   # preview
```

If the preview looks right, apply it and make the list immutable:

```sh
region_file=$(tv_ssh 'ls /var/preferences/com.webos.applicationManager/blockedAppList/*.json | head -n 1')
tv_ssh "chattr -i $region_file 2>/dev/null; true"
tv_ssh_with_terminal "sh /var/lib/webos-debloat/webos-debloat.sh --apply --id '$hidden_ids'"
tv_ssh "chattr +i $region_file"
tv_ssh reboot
```

How this works and what to know:

- The region file is the first `*.json` in that folder, the same rule the script uses to choose its file. It is `DEU.json` on the tested TV. This rule was not verified on a TV with more than one region file.
- The application manager reads the list only at start, so a reboot is needed.
- The TV reset the list to LG's two entries at boot on the tested TV. The cause is not proven. The immutable bit (`chattr +i`) keeps the list through reboots and a mains cycle. The script replaces the file by a move, so it fails while the bit is set. Remove the bit first, as above.
- Hiding is cosmetic. Only five of the 41 ids are tiles on LG Home (LG Channels, Art Gallery, Sports Alert, Alexa and 8 Ball Pool). The other 36 are not visible anyway. Privacy rests on step 2.
- A hidden app cannot be launched, not even by the system. The Home Dashboard (`com.webos.app.homeconnect`) is not in the list on purpose: the INPUT key on the remote opens it, so hiding it kills the INPUT key. If you change the list, keep it visible.
- The script backs the original list up once, to `/var/lib/webos-debloat/<REGION>.json.orig`, and never overwrites that file.

Check:

```sh
tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.applicationManager/listLaunchPoints "{}"'
```

The hidden apps are gone from the list, and the apps you use are still in it. Launch each of them once.

Undo:

```sh
tv_ssh "chattr -i $region_file; sh /var/lib/webos-debloat/webos-debloat.sh --restore; reboot"
# or put the byte-exact original back:
tv_ssh "chattr -i $region_file; cp /var/lib/webos-debloat/$(basename $region_file).orig $region_file; reboot"
```

### Stop preloading

webOS keeps some apps in memory so they open faster. `scripts/root/30-preload-off.sh` turns that off for seven apps (LG Channels, the browser, voice, Google Assistant, Live Menu, YouTube and Prime Video). On the tested TV this freed about 40 MB. Home, Live TV and the HDMI inputs are not touched. AirPlay cannot be held off: something outside the stored list turns it on at every boot.

The script keeps the original list once in `/var/lib/webosbrew/preload-backup.json` and never overwrites that file. It needs a terminal.

```sh
tv_copy scripts/root/30-preload-off.sh /var/lib/webosbrew/30-preload-off.sh
tv_ssh 'chmod 755 /var/lib/webosbrew/30-preload-off.sh'
tv_ssh_with_terminal /var/lib/webosbrew/30-preload-off.sh
```

The setting survived reboots on the tested TV, so there is no boot hook. Check after a reboot with `getPreloadPolicy`, not only the stored list, because some apps can still run:

```sh
tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.service.preloadmanager/getPreloadPolicy "{}"'
```

Undo:

```sh
tv_ssh_with_terminal /var/lib/webosbrew/30-preload-off.sh --restore
tv_ssh 'rm /var/lib/webosbrew/30-preload-off.sh /var/lib/webosbrew/preload-backup.json'   # optional
```

## 4. Install the launcher

### Build and install

```sh
scripts/package.sh        # writes dist/lgtv.blueprint.launcher_1.0.0_all.ipk
scripts/install-root.sh   # installs it and arms the autostart
```

`install-root.sh` copies the IPK with `scp` and installs it through the TV's app install service, because `ares-install` fails on this firmware. It also copies the preload script and the boot hook `40-home-reset` to the TV, links the boot hook `50-launcher` and runs it once. Every install resets the service's permissions, so the hook elevates the service again before it starts it.

Do not start a second install while one is still running. If an install hangs, a later reinstall can fail with `-102 app is locked` or "duplicate command" because the TV resumes the job at every boot. The fix: stop the service, close the launcher, move `/var/palm/data/com.webos.appInstallService/installHistory2.db` aside (do not delete it) and reboot.

### Power On Screen off

The TV setting "Power On Screen" (`general.homeAutoLaunch`) must be `off`. With it on, a mains cycle opens LG Home instead of the launcher. Step 2's settings script sets it. By hand:

```sh
tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.settingsservice/setSystemSettings "{\"category\":\"general\",\"settings\":{\"homeAutoLaunch\":\"off\"}}"'
```

### Check

```sh
tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo "{}"'    # lgtv.blueprint.launcher
tv_ssh 'ls -l /var/lib/webosbrew/init.d/50-launcher; tail -n 5 /tmp/launcher-service.log; kill -0 $(cat /tmp/launcher-service.pid) && echo alive'
tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.service.config/getConfigs "{\"configNames\":[\"com.webos.surfacemanager.disableHome\"]}"'   # true once the launcher is in front
```

Then look at the screen: reboot the TV and press HOME inside another app. A log line alone is not enough. After a mains start the launcher can be an empty stand-in window (a black screen, with the launcher as foreground app in the logs). The service detects this and starts the real launcher. If you doubt what you see, take a screenshot on the TV and copy it:

```sh
tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.service.capture/executeOneShot "{\"path\":\"/tmp/shot.jpg\",\"method\":\"DISPLAY\",\"width\":960,\"height\":540,\"format\":\"JPG\"}"'
scp -i "$TV_KEY" -o IdentitiesOnly=yes "root@$TV_IP:/tmp/shot.jpg" .
```

The call answers `ERROR_INTERNAL` while the screen saver is on (about two minutes after power-on). Take the screenshot before that.

### What the launcher takes over

The service takes the power-on screen and the HOME key from LG, and gives both back at once when something goes wrong. It is armed only after the launcher was seen in front. It sets `com.webos.surfacemanager.disableHome` to `true` so that the HOME key opens only the launcher, and writes the launcher and an unused input into `/var/lib/eim/lastinput` so that the power-on opens the launcher. The original `lastinput` is kept in `/var/lib/webosbrew/lastinput.orig`. [CONTEXT.md](../CONTEXT.md) explains the terms.

Why the boot hook cannot run earlier than about 40 seconds after power-on: it runs inside Homebrew Channel's startup script, and everything earlier is on a read-only or signed part of the system. A mains start therefore shows the last input for a few seconds before the launcher.

### Emergency rollback without a reboot

If HOME or the power-on screen misbehaves:

```sh
# 1 HOME back to LG
tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.service.config/setConfigs "{\"configs\":{\"com.webos.surfacemanager.disableHome\":false}}"'
# 2 stop the service
tv_ssh 'kill $(cat /tmp/launcher-service.pid)'
# 3 original last input back
tv_ssh 'cp /var/lib/webosbrew/lastinput.orig /var/lib/eim/lastinput'
# 4 hooks off for the next boot
tv_ssh 'cd /var/lib/webosbrew/init.d && mv 50-launcher 50-launcher.disabled && mv 40-home-reset 40-home-reset.disabled'
```

Check with `getConfigs` that `disableHome` says `false`, then press HOME: LG Home opens. To arm again, rename the hooks back and run `sh /var/lib/webosbrew/init.d/50-launcher`. If `disableHome` stays `true` with both hooks and the service gone, HOME stays dead until you set it to `false` as in step 1.

### Complete rollback

Run all four steps. Running only some of them leaves the TV in a worse state than the launcher itself. In particular, removing only `50-launcher` leaves `lastinput` on the launcher: the TV then boots to a black stand-in with no service.

```sh
# 1 hooks off for the next boot
tv_ssh 'rm /var/lib/webosbrew/init.d/50-launcher /var/lib/webosbrew/init.d/40-home-reset'
# 2 stop the service (SIGTERM sets disableHome=false; it does not restore lastinput)
tv_ssh 'kill $(cat /tmp/launcher-service.pid)'
# 3 original last input back
tv_ssh 'cp /var/lib/webosbrew/lastinput.orig /var/lib/eim/lastinput'
# 4 Power On Screen back to LG's default
tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.settingsservice/setSystemSettings "{\"category\":\"general\",\"settings\":{\"homeAutoLaunch\":\"on\"}}"'
tv_ssh reboot
```

After the reboot the TV shows its last input (for example HDMI 1 with "No signal"), not LG Home, because the boot manager opens the last input after a `reboot`. HOME, or `launch com.webos.app.home` through `applicationManager`, opens LG Home. To remove the app too:

```sh
tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.appInstallService/remove "{\"id\":\"lgtv.blueprint.launcher\"}"'
```

## 5. Customise

### Tiles

`scripts/wanted-apps.json` is an ordered list with one entry per tile. `scripts/build-catalog.mjs` pairs with the TV over the network (SSAP), reads its launch points and writes `app/catalog.json`.

| Field | Meaning |
|---|---|
| `title` | name of the tile |
| `match` | compared with the app title, ignoring case; an exact match wins over a partial one |
| `appId` | used instead of `match` to assign the app directly, as for Live TV and the HDMI inputs |
| `color` | brand colour (hex) |
| `logo` | symbol in `app/logos.svg` |

```sh
node scripts/build-catalog.mjs
```

On the first run the TV shows a pairing prompt. Confirm it with the remote within 60 seconds. The key is stored in `~/.config/lgtv-webos-root-launcher/client-key`. The full app list of your TV goes to `docs/all-apps.json`. Entries without a match are printed and left out. Build and install again (`scripts/package.sh`, `scripts/install-root.sh`) to bring the new tiles to the TV. The grid has room for nine tiles. Tiles without a logo show the TV's icon or the app name in the brand colour. The README explains how to add your own logos.

The example tiles open HDMI 2 for "Nintendo Switch" and HDMI 3 for "Xbox". Change the `appId` and the title to match what is plugged into your TV (`com.webos.app.hdmi1` to `com.webos.app.hdmi4`).

### Toolbar

The buttons at the top come from `app/toolbar.json` (`title` and `appId` per entry). The file is maintained by hand. `build-catalog.mjs` does not touch it.

### Greeting and texts

The greeting and the date line are in `app/main.js`: the function `greetingFor` picks the greeting by the hour, and `WEEKDAYS` and `MONTHS` hold the names. Change the language or the words there. The prompt at the bottom is in `app/index.html`.

### HOME key code

The service reacts to key code 773, which is the HOME key on the tested remote. Other remotes can use another code. Measure yours:

1. Open a shell on the TV: `ssh -tt -i "$TV_KEY" -o IdentitiesOnly=yes root@$TV_IP`
2. Paste this command in that shell. It reads every input device and prints a line per key press. It contains single quotes, so it cannot be wrapped in `ssh host '...'`. It needs the launcher installed (step 4), because it reuses the service's input parser.

   ```sh
   cd /media/developer/apps/usr/palm/services/lgtv.blueprint.launcher.service && node -e 'var fs=require("fs"),input=require("./input");fs.readdirSync("/dev/input").filter(function(n){return /^event\d+$/.test(n)}).forEach(function(n){fs.createReadStream("/dev/input/"+n).on("data",function(b){input.parseInputEvents(b).forEach(function(e){if(e.type===input.EV_KEY&&e.value===input.VALUE_PRESS)console.log(n+" code="+e.code)})}).on("error",function(){})})'
   ```

3. Press HOME on the remote. On the tested TV it printed `event3 code=773`. Some remotes send a second code right after the release; ignore it. Stop with Ctrl+C and leave the shell.
4. If your code differs, set `HOME_KEY_CODE` in `service/input.js`.

This command has not been run on a TV by the project author yet. If it fails, the error text tells you which part; the TV has Node 8 and no `python` or `jq`.

### Boot input

At power-on the service writes an unused HDMI input into `/var/lib/eim/lastinput`, so the boot does not start the tuner or a device behind the launcher. The default is `HDMI_1`. Choose an input with nothing plugged in. List the inputs:

```sh
tv_ssh_with_terminal 'luna-send -n 1 luna://com.webos.service.eim/getAllInputStatus "{}"'
```

Pick an entry with `"hdmiPlugIn":false` and set `LAST_INPUT_SOURCE_ID` in `service/last-input.js` to its id (for example `HDMI_1`). If a device is plugged into the boot input and powered on, you can hear it behind the launcher at boot.

After any change in `service/` or `app/`, run `node --test`, then `scripts/package.sh` and `scripts/install-root.sh`.

## 6. Other models

The setup was verified on one 2021 model (OLED55B19LA, firmware 03.53.45). Other series may work, but nobody has checked. Verify with your own AI agent before you trust a layer:

1. Give your agent this guide, `docs/known-traps.md` and `CONTEXT.md`.
2. Ask it to compare the paths, key codes, region files and Luna services on your TV with the ones named here. Typical differences are the folder `blockedAppList`, the region file name, the HOME key code and the boot input.
3. Ask it to run the check of each step before you move on to the next one, and to stop at the first check that fails.
4. Check the current state of SlopBro and Homebrew Channel for your model and firmware first (links under "What was verified").

Do one layer at a time and reboot between layers. Every layer has an undo.
