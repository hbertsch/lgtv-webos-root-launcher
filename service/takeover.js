// Takeover rules of the launcher service, ES5. No require of webos-service: every call to the
// TV goes through options.call(uri, payload, onReply), which answers with { payload: <reply> }.
//
// Fail-safe: nothing here takes anything from LG until the launcher was seen in front (the
// first confirmed launch). The last-input override and disableHome are written only then.
// If a launch is refused, or the launcher is not in front after the retries, the takeover
// gives both back at once, puts the original last input back and stops acting. A restart
// of the service tries again.
var LAUNCH_URI = "luna://com.webos.applicationManager/launch";
var CONFIG_SET_URI = "luna://com.webos.service.config/setConfigs";
var DISABLE_HOME_KEY = "com.webos.surfacemanager.disableHome";
var FOREGROUND_URI = "luna://com.webos.applicationManager/getForegroundAppInfo";
var VIDEO_STATUS_URI = "luna://com.webos.service.videooutput/getStatus";
var CLOSE_URI = "luna://com.webos.applicationManager/closeByAppId";
var HOME_APP_ID = "com.webos.app.home";
var LIVE_TV_APP_ID = "com.webos.app.livetv";
var POWER_ACTIVE = "Active";
var POWER_SCREEN_SAVER = "Screen Saver";
// bootd opens the last-input app about 0.5 s after the state becomes Active.
var AFTER_ACTIVE_DELAY_MS = 2000;
var LAUNCH_MAX_ATTEMPTS = 4;
var LAUNCH_RETRY_MS = 1500;
// After a power-on or wake LG may still open its own screens (Home as "Power On Screen", the
// last input). For this long the launcher is reopened if LG Home takes over.
var SETTLE_WINDOW_MS = 45000;
var SETTLE_CHECK_MS = 1500;
var SETTLE_MAX_RELAUNCHES = 3;
// How long Live TV stays in front while it releases the video sink.
var SINK_RELEASE_MS = 2000;
var HOME_DEBOUNCE_MS = 500;
// How long after a HOME launch the launcher has to be in front.
var HOME_VERIFY_MS = 3000;
// A healthy HDMI input app joins the video sink within about 1 s after its launch.
var INPUT_VIDEO_CHECK_MS = 3000;
var HDMI_APP_PATTERN = /^com\.webos\.app\.hdmi\d$/;
var WAKE_GAP_SECONDS = 10;
// The clock jumps from 2021 to the real date at NTP sync shortly after boot.
var HEARTBEAT_MIN_UPTIME_SECONDS = 120;

// Returns the reason for a failed launch reply, or null if the launch was accepted.
function launchError(launchPayload) {
  if (launchPayload && launchPayload.returnValue === true) {
    return null;
  }
  return "launch failed: " + JSON.stringify(launchPayload);
}

// getForegroundAppInfo without extraInfo: the card app that is in front.
function isLauncherInFront(foregroundPayload, appId) {
  return Boolean(foregroundPayload) && foregroundPayload.returnValue !== false && foregroundPayload.appId === appId;
}

// getForegroundAppInfo with extraInfo:true lists overlays like Settings too, so only a lone window counts.
// The input stand-in (see isInputStandIn) is not the launcher.
function isOnlyForegroundWindow(foregroundPayload, appId) {
  var windows = (foregroundPayload && foregroundPayload.foregroundAppInfo) || [];
  return windows.length === 1 && windows[0].appId === appId && windows[0].windowGroup !== true;
}

// getForegroundAppInfo with extraInfo:true (windowGroup is missing without it). After a mains start
// bootd opens com.webos.app.inputcommon, which renames itself to the launcher: the foreground
// appId is the launcher, but the window is an input app's (windowGroup true, pid of inputcommon),
// transparent over the boot video, and the web app does not run. The real web launcher has
// windowGroup false.
function isInputStandIn(foregroundPayload, appId) {
  var windows = (foregroundPayload && foregroundPayload.foregroundAppInfo) || [];
  return windows.some(function (window) {
    return window.appId === appId && window.windowGroup === true;
  });
}

// videooutput/getStatus: the MAIN sink entry, or undefined.
function mainSink(videoPayload) {
  var sinks = (videoPayload && videoPayload.video) || [];
  return sinks.filter(function (sink) {
    return sink.sink === "MAIN";
  })[0];
}

// videooutput/getStatus: true if the TV tuner (connectedSource VDEC) is connected to the MAIN sink.
// An HDMI input there is no sound under the menu.
function isTunerOnMainSink(videoPayload) {
  var sink = mainSink(videoPayload);
  return Boolean(sink) && sink.connected === true && sink.connectedSource === "VDEC";
}

// videooutput/getStatus: true if the app has a video client (its HDMI picture or the "no signal" image).
function hasVideoClient(videoPayload, clientAppId) {
  var clients = (videoPayload && videoPayload.clients) || [];
  return clients.some(function (client) {
    return client.appId === clientAppId;
  });
}

// options: { call, lastInput, hasInputDevices, uptimeSeconds, log, appId, launchId, bootMode, watchMode }
// All state lives in this closure.
function createTakeover(options) {
  var call = options.call;
  var log = options.log;
  var appId = options.appId;

  // The app the takeover opens as "the launcher"; only tests change it.
  var launcherLaunchId = options.launchId || appId;
  var takeoverArmed = false;
  var takeoverFailed = false;
  // Counts launches that supersede older ones (a newer sequence, or a launch the user chose).
  var launchSequenceId = 0;
  // The input stand-in is replaced once per service run; if it stays in front after that, the takeover fails.
  var standInRescued = false;
  var systemHomeDisabled = false;
  var lastPowerState = null;
  var lastHomeAt = 0;
  var lastBeatAt = Date.now();
  var lastBeatUptime = Number(options.uptimeSeconds());

  function pointLastInputAtLauncher(reason) {
    if (!takeoverArmed) {
      return;
    }
    options.lastInput.pointAtLauncher(reason);
  }

  function setSystemHomeDisabled(disabled, onDone) {
    var configs = {};
    configs[DISABLE_HOME_KEY] = disabled;
    call(CONFIG_SET_URI, { configs: configs }, function (reply) {
      log("disableHome=" + disabled + ": " + JSON.stringify(reply.payload));
      if (reply.payload && reply.payload.returnValue === true) {
        systemHomeDisabled = disabled;
      }
      if (onDone) {
        onDone();
      }
    });
  }

  // The launcher was seen in front: now the service may take HOME and the power-on screen.
  function armTakeover() {
    if (takeoverArmed || takeoverFailed) {
      return;
    }
    takeoverArmed = true;
    log("takeover armed: launcher confirmed in front");
    if (options.bootMode) {
      pointLastInputAtLauncher("armed");
    }
    // Without a readable input device nobody would answer HOME, so the system keeps its handling.
    if (options.watchMode && options.hasInputDevices()) {
      setSystemHomeDisabled(true);
    }
  }

  // Gives HOME and the power-on screen back to LG and stops acting until the service restarts.
  function failTakeover(reason) {
    if (takeoverFailed) {
      return;
    }
    takeoverFailed = true;
    takeoverArmed = false;
    log("takeover FAILED, back to LG's HOME and last input: " + reason);
    setSystemHomeDisabled(false);
    options.lastInput.restoreOriginal();
  }

  // Runs for SETTLE_WINDOW_MS after a power-on or wake launch was confirmed. Reopens the launcher
  // if LG Home takes over. After a cold start the system may also connect the last TV input (Live
  // TV tuner) to the video sink with no app in front, and its sound plays under the menu. Closing
  // the apps does not free the sink; opening Live TV and then the launcher again does, once. An
  // HDMI input on the sink (bootd's boot source HDMI_1) is left alone.
  // A newer launch sequence ends the guard.
  function keepLauncherInFront(reason, sequenceId) {
    var endsAt = Date.now() + SETTLE_WINDOW_MS;
    var relaunches = 0;
    var sinkReleased = false;

    function launchLauncherAgain(onDone) {
      call(LAUNCH_URI, { id: launcherLaunchId }, function (launchReply) {
        onDone(launchReply.payload);
      });
    }

    function releaseVideoSink(sink) {
      sinkReleased = true;
      log(reason + " settle: video sink connected behind the launcher (" + sink.connectedSource + ", " + sink.contentType + "), opening Live TV and the launcher again");
      call(LAUNCH_URI, { id: LIVE_TV_APP_ID }, function (liveTvReply) {
        log(reason + " settle: Live TV launch: " + JSON.stringify(liveTvReply.payload));
        setTimeout(function () {
          launchLauncherAgain(function (payload) {
            log(reason + " settle: launcher launch after the sink release: " + JSON.stringify(payload));
          });
        }, SINK_RELEASE_MS);
      });
    }

    function check() {
      if (sequenceId !== launchSequenceId || takeoverFailed || Date.now() > endsAt) {
        return;
      }
      call(FOREGROUND_URI, {}, function (foregroundReply) {
        var foregroundAppId = foregroundReply.payload && foregroundReply.payload.appId;
        if (foregroundAppId === HOME_APP_ID && relaunches < SETTLE_MAX_RELAUNCHES) {
          relaunches += 1;
          launchLauncherAgain(function (payload) {
            log(reason + " settle: LG Home took over, launcher launch " + relaunches + ": " + JSON.stringify(payload));
          });
        } else if (!sinkReleased && isLauncherInFront(foregroundReply.payload, appId)) {
          call(VIDEO_STATUS_URI, { subscribe: false }, function (videoReply) {
            if (!sinkReleased && isTunerOnMainSink(videoReply.payload)) {
              releaseVideoSink(mainSink(videoReply.payload));
            }
          });
        }
        setTimeout(check, SETTLE_CHECK_MS);
      });
    }

    setTimeout(check, SETTLE_CHECK_MS);
  }

  // Opens the launcher until it is the foreground app, at most LAUNCH_MAX_ATTEMPTS
  // launches, the first one after delayMs. A newer sequence cancels an older one.
  // A refused launch, or giving up, fails the takeover; a confirmed launcher arms it.
  // With settleAfterwards the launcher is then kept in front for SETTLE_WINDOW_MS.
  function launchLauncher(reason, delayMs, settleAfterwards) {
    if (takeoverFailed) {
      return;
    }
    launchSequenceId += 1;
    var sequenceId = launchSequenceId;

    // The foreground says "launcher", but it is the input stand-in with no web app behind it and a
    // black screen. A plain launch replaces it with the real launcher; then the check runs again.
    function replaceInputStandIn(reasonText, number, windows) {
      if (standInRescued) {
        // The rescue launch needs a moment to show: check again until the attempts are used up.
        if (number > LAUNCH_MAX_ATTEMPTS) {
          failTakeover(reasonText + ": input stand-in still in front after the rescue launch, windows " + windows);
          return;
        }
        setTimeout(function () {
          attempt(number + 1);
        }, LAUNCH_RETRY_MS);
        return;
      }
      standInRescued = true;
      log(reasonText + ": input stand-in in front (windowGroup true), launching the launcher, windows " + windows);
      call(LAUNCH_URI, { id: launcherLaunchId }, function (launchReply) {
        log(reasonText + ": rescue launch of " + launcherLaunchId + ": " + JSON.stringify(launchReply.payload));
        var error = launchError(launchReply.payload);
        if (error) {
          failTakeover(reasonText + ": " + error);
          return;
        }
        setTimeout(function () {
          attempt(number + 1);
        }, LAUNCH_RETRY_MS);
      });
    }

    function attempt(number) {
      if (sequenceId !== launchSequenceId || takeoverFailed) {
        return;
      }
      call(FOREGROUND_URI, {}, function (foregroundReply) {
        if (isLauncherInFront(foregroundReply.payload, appId)) {
          call(FOREGROUND_URI, { extraInfo: true }, function (windowsReply) {
            var windows = JSON.stringify(windowsReply.payload && windowsReply.payload.foregroundAppInfo);
            if (isInputStandIn(windowsReply.payload, appId)) {
              replaceInputStandIn(reason, number, windows);
              return;
            }
            log(reason + ": launcher is in the foreground after " + (number - 1) + " launches, windows " + windows);
            armTakeover();
            if (settleAfterwards) {
              keepLauncherInFront(reason, sequenceId);
            }
          });
          return;
        }
        if (number > LAUNCH_MAX_ATTEMPTS) {
          failTakeover(reason + ": giving up, launcher not in front, foreground reply " + JSON.stringify(foregroundReply.payload));
          return;
        }
        call(LAUNCH_URI, { id: launcherLaunchId }, function (launchReply) {
          log(reason + ": launch " + number + " of " + launcherLaunchId + ": " + JSON.stringify(launchReply.payload));
          var error = launchError(launchReply.payload);
          if (error) {
            failTakeover(reason + ": " + error);
            return;
          }
          setTimeout(function () {
            attempt(number + 1);
          }, LAUNCH_RETRY_MS);
        });
      });
    }

    setTimeout(function () {
      attempt(1);
    }, delayMs);
  }

  function handlePowerState(state) {
    var previousState = lastPowerState;
    lastPowerState = state;
    if (state === previousState) {
      return;
    }
    log("power state " + previousState + " -> " + state);
    if (state !== POWER_ACTIVE) {
      if (state !== POWER_SCREEN_SAVER) {
        pointLastInputAtLauncher("power state " + state);
      }
      return;
    }
    // Ending the screen saver is not a power-on: do not pull the user out of an app. Only a
    // service that is not armed yet launches, otherwise it would never take over.
    if (previousState === POWER_SCREEN_SAVER && takeoverArmed) {
      log("Active after Screen Saver: no launch");
      return;
    }
    launchLauncher("power Active", AFTER_ACTIVE_DELAY_MS, true);
  }

  // Live TV only pauses behind other apps: its audio decoder keeps running muted, and the mute
  // is lost at the next wake. Closing the app stops the decoder.
  function closeLiveTv(reason) {
    if (!takeoverArmed) {
      return;
    }
    call(CLOSE_URI, { id: LIVE_TV_APP_ID }, function (reply) {
      log("close Live TV (" + reason + "): " + JSON.stringify(reply.payload));
    });
  }

  function verifyHomeLaunch() {
    var sequenceId = launchSequenceId;
    setTimeout(function () {
      if (sequenceId !== launchSequenceId || takeoverFailed) {
        return;
      }
      call(FOREGROUND_URI, {}, function (foregroundReply) {
        if (!isLauncherInFront(foregroundReply.payload, appId)) {
          failTakeover("HOME: launcher not in front " + HOME_VERIFY_MS + " ms after the launch, foreground reply " + JSON.stringify(foregroundReply.payload));
        }
      });
    }, HOME_VERIFY_MS);
  }

  // payload: a valid getPowerState answer (returnValue true, state a string).
  function powerChanged(payload) {
    if (/power off/i.test(String(payload.processing))) {
      pointLastInputAtLauncher("processing " + payload.processing);
      closeLiveTv("processing " + payload.processing);
    }
    handlePowerState(payload.state);
  }

  function homePressed(deviceName) {
    // After a failed takeover the system handles HOME itself.
    if (takeoverFailed) {
      return;
    }
    var now = Date.now();
    // Several devices report the same press.
    if (now - lastHomeAt < HOME_DEBOUNCE_MS) {
      return;
    }
    lastHomeAt = now;
    log("HOME pressed on " + deviceName);
    // The Settings overlay sits on top of the card that is "in front", so only a lone launcher counts.
    call(FOREGROUND_URI, { extraInfo: true }, function (foregroundReply) {
      if (isOnlyForegroundWindow(foregroundReply.payload, appId)) {
        log("HOME: launcher is in front already");
        return;
      }
      call(LAUNCH_URI, { id: launcherLaunchId }, function (launchReply) {
        log("HOME: launch: " + JSON.stringify(launchReply.payload));
        var error = launchError(launchReply.payload);
        if (error) {
          failTakeover("HOME: " + error);
          return;
        }
        verifyHomeLaunch();
      });
    });
  }

  // Called once a second. A real suspend stops the process; both the wall clock and /proc/uptime
  // (which counts suspend time) move on by the same amount. A clock jump from NTP moves only the
  // wall clock.
  function heartbeat() {
    // The system writes the TV input it switches to (Live TV) into the file: keep it on the launcher
    // so a power cut cannot leave the next start on Live TV or LG Home.
    if (options.bootMode) {
      pointLastInputAtLauncher("heartbeat");
    }
    var now = Date.now();
    var uptime = Number(options.uptimeSeconds());
    var wallGapSeconds = (now - lastBeatAt) / 1000;
    var uptimeGapSeconds = uptime - lastBeatUptime;
    lastBeatAt = now;
    lastBeatUptime = uptime;
    if (wallGapSeconds <= WAKE_GAP_SECONDS || uptime < HEARTBEAT_MIN_UPTIME_SECONDS) {
      return;
    }
    if (Math.abs(wallGapSeconds - uptimeGapSeconds) > WAKE_GAP_SECONDS) {
      log("heartbeat: clock jump of " + wallGapSeconds + " s while uptime moved " + uptimeGapSeconds + " s, ignored");
      return;
    }
    log("heartbeat: gap of " + wallGapSeconds + " s, TV woke from suspend");
    launchLauncher("wake", AFTER_ACTIVE_DELAY_MS, true);
  }

  // With bootMode the first power Active launches and arms; alone, the watch does it right away.
  function start() {
    if (!options.bootMode) {
      launchLauncher("arm", 0, false);
    }
  }

  // Now and then an HDMI input app comes to the front without joining the video sink: the screen
  // stays black, not even "no signal" shows. Closing and launching it again fixes that, so it is
  // done once if the app is still in front and has no video client after INPUT_VIDEO_CHECK_MS.
  function restartInputWithoutVideo(inputAppId, params, sequenceId) {
    setTimeout(function () {
      if (sequenceId !== launchSequenceId) {
        return;
      }
      call(FOREGROUND_URI, {}, function (foregroundReply) {
        var foregroundAppId = foregroundReply.payload && foregroundReply.payload.appId;
        if (foregroundAppId !== inputAppId) {
          return;
        }
        call(VIDEO_STATUS_URI, { subscribe: false }, function (videoReply) {
          if (hasVideoClient(videoReply.payload, inputAppId)) {
            return;
          }
          log(inputAppId + " in front with no video client, closing and launching it again, clients " + JSON.stringify(videoReply.payload && videoReply.payload.clients));
          call(CLOSE_URI, { id: inputAppId }, function (closeReply) {
            call(LAUNCH_URI, { id: inputAppId, params: params }, function (launchReply) {
              log("relaunch " + inputAppId + ": close " + JSON.stringify(closeReply.payload) + ", launch " + JSON.stringify(launchReply.payload));
            });
          });
        });
      });
    }, INPUT_VIDEO_CHECK_MS);
  }

  // The user chose another app: a pending check whether the launcher is in front is void.
  function userLaunch(userAppId, params, onReply) {
    launchSequenceId += 1;
    var sequenceId = launchSequenceId;
    call(LAUNCH_URI, { id: userAppId, params: params || {} }, function (reply) {
      log("launch " + userAppId + ": " + JSON.stringify(reply.payload));
      onReply(reply.payload);
      if (HDMI_APP_PATTERN.test(userAppId) && !launchError(reply.payload)) {
        restartInputWithoutVideo(userAppId, params || {}, sequenceId);
      }
    });
  }

  function setLaunchId(id) {
    launcherLaunchId = id || appId;
    log("injectLaunchId: the launcher is launched as " + launcherLaunchId);
    return launcherLaunchId;
  }

  // Whatever ends the service, LG's own HOME handling has to come back.
  function shutDown(onDone) {
    if (!systemHomeDisabled) {
      onDone();
      return;
    }
    setSystemHomeDisabled(false, onDone);
  }

  return {
    start: start,
    powerChanged: powerChanged,
    homePressed: homePressed,
    heartbeat: heartbeat,
    userLaunch: userLaunch,
    setLaunchId: setLaunchId,
    shutDown: shutDown,
  };
}

module.exports = { createTakeover: createTakeover };
