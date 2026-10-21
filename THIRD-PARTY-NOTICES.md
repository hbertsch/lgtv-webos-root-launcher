# Third-party notices

This project builds on the work below. The revisions are the ones that were read when the code was written.

## webos-custom-home

- Source: https://github.com/zzeppieri/webos-custom-home
- Revision: v0.4.2, commit `41f8fc2cf368374293d036979390e683e40c370d`
- Licence: MIT
- Copyright line: `Copyright (c) 2026 zzeppieri`
- Used for: the technique behind `service/service.js`, `service/input.js` and `service/autostart.sh` (elevating the service, reading the HOME key from the input devices, starting at boot). The code in this repository is a rewrite.

## webos-debloat

- Source: https://gist.github.com/lucataco/7c303b443934008a9031a55cfca552ec
- Revision: `a269896606b83a31bb85f2f25146b51ceb876fe6`
- Licence: MIT (SPDX header in the file)
- Copyright line: no copyright line published; the author is `lucataco`
- Used for: `scripts/root/webos-debloat.sh`, a copy with two changes (the list folder `blockedAppList` and the key `blocked_applist`, which differ on webOS 6.5.3).

## Glasshouse

- Source: https://github.com/rorygallagher2024/glasshouse
- Licence: MIT
- Copyright line: `Copyright (c) 2026 Rory Gallagher`
- Used for: the technique behind `scripts/root/30-preload-off.sh` (switching off app preloading through the preload manager's app list). The script in this repository is a rewrite.

## lg-tv-blocklist

- Source: https://github.com/furkan-bayrak/lg-tv-blocklist
- Revision: commit `68afe10de07bfdc8e8ecf91a7069a17419597271`
- Licence: the host lists are CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) with no copyright line; the example hooks in `examples/webos-hooks` are MIT, `Copyright (c) 2026 furkan-bayrak`
- Used for: `scripts/root/blocklist.hosts` is derived from `lists/safe-hosts.txt` plus selected entries from `lists/strict-hosts.txt`, with additions of our own. The technique of `scripts/root/10-hosts-blocklist` follows the example hooks.
- Changes: selection of entries, extra update-server entries and further entries found in a TV's DNS log. The changes are noted in the header of `blocklist.hosts`.

## Hanken Grotesk

- Source: https://github.com/marcologous/hanken-grotesk
- Licence: SIL Open Font License 1.1, full text in `app/fonts/OFL.txt`
- Copyright line: `Copyright 2021 The Hanken Grotesk Project Authors (https://github.com/marcologous/hanken-grotesk)`
- Used for: the variable font file in `app/fonts/` (Latin subset).
