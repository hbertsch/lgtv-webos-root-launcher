// Launcher service for lgtv.blueprint.launcher. ES5 only (the TV's Node is old).
//
// Flags:
// Fail-safe: nothing below takes anything from LG until the launcher was seen in front (the
// first confirmed launch). The last-input override and disableHome are written only then.
// If a launch is refused, or the launcher is not in front after the retries, the service gives
// both back at once, puts the original last input back and stops acting. A restart tries again.
//
//   --boot   watch the TV power state. Whenever the state becomes "Active" (also
//            the first answer, if the TV is already Active), open the launcher
//            after bootd's last-input app, and keep it in front for a few seconds.
//            While the state is "Active Standby" the service only waits.
//            It also points bootd's "last input" at the launcher (see below), so the
//            next power-on opens the launcher instead of the last HDMI input.
//            At power off it also closes Live TV, which otherwise keeps decoding muted.
//   --watch  read the remote's input devices (read only, never grabbed) and open the
//            launcher when HOME is pressed. The system's own HOME handling is switched
//            off while the watch runs (config com.webos.surfacemanager.disableHome),
//            otherwise LG Home and the launcher fight for the screen. The setting is put
//            back when the service exits; autostart.sh also resets it before every start.
//            A wall-clock heartbeat also reopens the launcher after a real suspend wake.
//
// Test flag: --inject-launch-id=<app id> makes the service launch that app instead of the
// launcher (also settable at run time with the "injectLaunchId" method), to test the fail-safe.
//
// Technique after webos-custom-home service.js (MIT, https://github.com/zzeppieri/webos-custom-home), rewritten for this launcher.
var Service = require("webos-service");
var Subscription = require("webos-service/lib/subscription");
var fs = require("fs");
var input = require("./input");

var SERVICE_ID = "lgtv.blueprint.launcher.service";
var APP_ID = "lgtv.blueprint.launcher";
var LOG_FILE = "/tmp/launcher-service.log";
var PID_FILE = "/tmp/launcher-service.pid";
var LAST_INPUT_FILE = "/var/lib/eim/lastinput";
var LAUNCHER_APP_FILE = "/media/developer/apps/usr/palm/applications/lgtv.blueprint.launcher/appinfo.json";
var SHUTDOWN_MAX_MS = 2000;
var POWER_STATE_URI = "luna://com.webos.service.tvpower/power/getPowerState";
var SUBSCRIBE_RETRY_MS = 2000;
var SUBSCRIBE_MAX_ATTEMPTS = 60;
var INPUT_DIRECTORY = "/dev/input";
// 50 ms cost about 2% of one core on the TV, so the poll runs every 100 ms.
var INPUT_POLL_MS = 100;
var INPUT_RESCAN_MS = 5000;
var inputReadBuffer = new Buffer(input.RECORD_SIZE * 64);
// Numeric O_RDONLY | O_NONBLOCK of Linux ARM; fs.constants does not exist on old Node.
var OPEN_READ_NONBLOCK = 2048;
var HEARTBEAT_MS = 1000;
var ARGUMENTS = process.argv.slice(2);
var BOOT_MODE = ARGUMENTS.indexOf("--boot") !== -1;
var WATCH_MODE = ARGUMENTS.indexOf("--watch") !== -1;
var INJECT_FLAG = "--inject-launch-id=";

// The app the service opens as "the launcher"; only tests change it (see takeover.js).
var launchId = APP_ID;
ARGUMENTS.forEach(function (argument) {
  if (argument.indexOf(INJECT_FLAG) === 0) {
    launchId = argument.slice(INJECT_FLAG.length);
  }
});

function uptimeSeconds() {
  try {
    return fs.readFileSync("/proc/uptime", "utf8").split(" ")[0];
  } catch (error) {
    return "?";
  }
}

// The TV clock is wrong until NTP sync, so every line also carries the uptime.
function log(message) {
  try {
    fs.appendFileSync(LOG_FILE, "[" + new Date().toISOString() + " up=" + uptimeSeconds() + "s] " + message + "\n");
  } catch (error) {
    // logging must never stop the service
  }
}

// webos-service exits after a few idle seconds unless this flag is set before
// `new Service(...)` builds its activity manager.
if (process.argv.indexOf("--disable-timeouts") === -1) {
  process.argv.push("--disable-timeouts");
}

var service = new Service(SERVICE_ID);
fs.writeFileSync(PID_FILE, String(process.pid));
log("start pid=" + process.pid + " args=[" + ARGUMENTS.join(" ") + "]");

var openDevices = {};

var lastInput = require("./last-input").createLastInput({
  file: LAST_INPUT_FILE,
  backupFile: "/var/lib/webosbrew/lastinput.orig",
  launcherAppFile: LAUNCHER_APP_FILE,
  appId: APP_ID,
  log: log,
});

var takeover = require("./takeover").createTakeover({
  call: function (uri, payload, onReply) {
    service.call(uri, payload, onReply);
  },
  lastInput: lastInput,
  hasInputDevices: function () {
    return Object.keys(openDevices).length > 0;
  },
  uptimeSeconds: uptimeSeconds,
  log: log,
  appId: APP_ID,
  launchId: launchId,
  bootMode: BOOT_MODE,
  watchMode: WATCH_MODE,
});

service.register("status", function (message) {
  message.respond({ returnValue: true, running: true, pid: process.pid });
});

service.register("injectLaunchId", function (message) {
  var effectiveLaunchId = takeover.setLaunchId(message.payload && message.payload.id);
  message.respond({ returnValue: true, launchId: effectiveLaunchId });
});

service.register("launch", function (message) {
  var appId = message.payload && message.payload.id;
  if (!appId) {
    message.respond({ returnValue: false, errorText: "id is required" });
    return;
  }
  takeover.userLaunch(appId, message.payload.params, function (payload) {
    message.respond(payload);
  });
});

function subscribePowerState(attempt) {
  var received = false;
  var resubscribeScheduled = false;
  // tvpowerd offers getPowerState only on the private bus, and webos-service sends
  // calls from ids outside com.webos.* over the public one: use the private handle.
  var powerHandle = service.privateHandle || service.sendingHandle;
  var subscription = new Subscription(powerHandle, POWER_STATE_URI, { subscribe: true });

  function resubscribe() {
    if (resubscribeScheduled) {
      return;
    }
    resubscribeScheduled = true;
    var nextAttempt = received ? 1 : attempt + 1;
    if (nextAttempt > SUBSCRIBE_MAX_ATTEMPTS) {
      log("power state subscription failed after " + SUBSCRIBE_MAX_ATTEMPTS + " attempts");
      return;
    }
    setTimeout(function () {
      subscribePowerState(nextAttempt);
    }, SUBSCRIBE_RETRY_MS);
  }

  subscription.on("response", function (reply) {
    var payload = reply.payload;
    if (payload && payload.returnValue === true && typeof payload.state === "string") {
      received = true;
      log("power payload " + JSON.stringify(payload));
      takeover.powerChanged(payload);
    } else {
      log("getPowerState attempt " + attempt + " failed: " + JSON.stringify(payload));
      subscription.cancel();
      resubscribe();
    }
  });
  subscription.on("cancel", function () {
    log("power state subscription cancelled");
    resubscribe();
  });
}

if (BOOT_MODE) {
  subscribePowerState(1);
}

function closeDevice(name, reason) {
  try {
    fs.closeSync(openDevices[name]);
  } catch (error) {
    // already gone
  }
  delete openDevices[name];
  log("input " + name + " closed: " + reason);
}

function openNewDevices() {
  var names;
  try {
    names = fs.readdirSync(INPUT_DIRECTORY);
  } catch (error) {
    log("cannot list " + INPUT_DIRECTORY + ": " + error);
    return;
  }
  names.forEach(function (name) {
    if (!/^event\d+$/.test(name) || openDevices[name] !== undefined) {
      return;
    }
    try {
      openDevices[name] = fs.openSync(INPUT_DIRECTORY + "/" + name, OPEN_READ_NONBLOCK);
      log("input " + name + " opened");
    } catch (error) {
      // unused slots answer ENXIO; they are tried again at the next rescan
    }
  });
}

function readDevice(name) {
  var bytesRead;
  try {
    bytesRead = fs.readSync(openDevices[name], inputReadBuffer, 0, inputReadBuffer.length, null);
  } catch (error) {
    if (error.code !== "EAGAIN") {
      closeDevice(name, String(error));
    }
    return false;
  }
  if (bytesRead <= 0) {
    return false;
  }
  input.parseInputEvents(inputReadBuffer.slice(0, bytesRead)).forEach(function (event) {
    if (event.type === input.EV_KEY && event.code === input.HOME_KEY_CODE && event.value === input.VALUE_PRESS) {
      takeover.homePressed(name);
    }
  });
  return true;
}

function pollInput() {
  Object.keys(openDevices).forEach(function (name) {
    // drain what is queued; the device is only read, never grabbed
    while (openDevices[name] !== undefined && readDevice(name)) {
      // keep reading
    }
  });
}

// Whatever ends the service, LG's own HOME handling has to come back.
function shutDown(reason, exitCode) {
  log("exit: " + reason);
  setTimeout(function () {
    process.exit(exitCode);
  }, SHUTDOWN_MAX_MS);
  takeover.shutDown(function () {
    process.exit(exitCode);
  });
}

if (WATCH_MODE) {
  openNewDevices();
  log("watching for key code " + input.HOME_KEY_CODE + " (--watch) on " + Object.keys(openDevices).join(" "));
  setInterval(pollInput, INPUT_POLL_MS);
  setInterval(openNewDevices, INPUT_RESCAN_MS);
  setInterval(takeover.heartbeat, HEARTBEAT_MS);
  takeover.start();

  process.on("SIGTERM", function () {
    shutDown("SIGTERM", 0);
  });
  process.on("SIGINT", function () {
    shutDown("SIGINT", 0);
  });
  process.on("uncaughtException", function (error) {
    log("uncaught exception: " + (error && error.stack));
    shutDown("uncaught exception", 1);
  });
}
