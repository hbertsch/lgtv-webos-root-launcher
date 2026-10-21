# Context

Terms of the launcher service on the LG TV. Code lives in `service/`; background and measurements are in `docs/guide.md`.

**Launcher service**: The Node service `lgtv.blueprint.launcher.service`, started at boot by the hook `50-launcher` with `--boot --watch`. It opens the launcher app at power-on, on HOME and after a wake, and offers the Luna methods `launch`, `injectLaunchId` and `status`.

**Takeover**: The service taking the power-on screen and the HOME key from LG. It is _armed_ once the launcher was seen in front: from then on the service writes the last-input override and sets `disableHome=true`. It is _failed_ when a launch is refused or the launcher is not in front after the retries: the service gives both back and stays passive until it is restarted. Code: `service/takeover.js`.

**Launch sequence**: Up to 4 launches of the launcher 1.5 s apart, each followed by a foreground check, started by a power-on or a wake. A newer sequence, or a launch the user chose, ends an older one.

**Input stand-in**: After a mains start bootd opens `com.webos.app.inputcommon` under the launcher's name. The foreground appId is the launcher, but `windowGroup` is `true`, the web app does not run and the screen is black. The service launches the real launcher once per run to replace it.

**Settle guard**: For 45 s after a confirmed power-on or wake launch, the service reopens the launcher if LG Home takes the front. If the tuner is connected to the MAIN video sink, it opens Live TV for 2 s and then the launcher again to release the sink.

**Input restart**: An HDMI input app that is in front 3 s after a tile launch but has no client at the video output (black screen, no "No signal") is closed and launched again, once. Code: `service/takeover.js`.

**Last-input override**: The file `/var/lib/eim/lastinput` names the app and input bootd opens at power-on. The service writes the launcher and an unused input such as `HDMI_1` there and keeps the original in `/var/lib/webosbrew/lastinput.orig`; a failed takeover puts the original back. Code: `service/last-input.js`.

**HOME watch**: The service reads the `/dev/input/event*` devices read-only and reacts to the measured HOME key code (773 on the tested remote). A press opens the launcher unless it is the only window in front; 3 s later the launcher must be in front, otherwise the takeover fails.

**Wake**: A 1 s heartbeat detects a wall-clock gap above 10 s that `/proc/uptime` shares (a real suspend) and starts a launch sequence. A gap that only the wall clock shows is an NTP clock jump and is ignored.
