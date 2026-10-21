import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { createTakeover } = createRequire(import.meta.url)("../service/takeover.js");

const APP_ID = "lgtv.blueprint.launcher";
const LAUNCH_URI = "luna://com.webos.applicationManager/launch";
const CONFIG_SET_URI = "luna://com.webos.service.config/setConfigs";
const FOREGROUND_URI = "luna://com.webos.applicationManager/getForegroundAppInfo";
const VIDEO_STATUS_URI = "luna://com.webos.service.videooutput/getStatus";
const CLOSE_URI = "luna://com.webos.applicationManager/closeByAppId";
const DISABLE_HOME_KEY = "com.webos.surfacemanager.disableHome";
const LIVE_TV_APP_ID = "com.webos.app.livetv";
const HOME_APP_ID = "com.webos.app.home";
const START_TIME = 1000000;

const launcherInFront = (payload) =>
  payload.extraInfo
    ? { returnValue: true, foregroundAppInfo: [{ appId: APP_ID, windowGroup: false }] }
    : { returnValue: true, appId: APP_ID };
const otherAppInFront = (payload) =>
  payload.extraInfo
    ? { returnValue: true, foregroundAppInfo: [{ appId: "netflix", windowGroup: false }] }
    : { returnValue: true, appId: "netflix" };
const standInInFront = (payload) =>
  payload.extraInfo
    ? { returnValue: true, foregroundAppInfo: [{ appId: APP_ID, windowGroup: true }] }
    : { returnValue: true, appId: APP_ID };
const settingsOverLauncher = (payload) =>
  payload.extraInfo
    ? { returnValue: true, foregroundAppInfo: [{ appId: APP_ID, windowGroup: false }, { appId: "com.palm.app.settings" }] }
    : { returnValue: true, appId: APP_ID };
const lgHomeInFront = () => ({ returnValue: true, appId: HOME_APP_ID });
const noTuner = () => ({ returnValue: true, video: [{ sink: "MAIN", connected: false }] });
const tunerOnMainSink = () => ({ returnValue: true, video: [{ sink: "MAIN", connected: true, connectedSource: "VDEC", contentType: "dtv" }] });
const hdmiOnMainSink = () => ({ returnValue: true, video: [{ sink: "MAIN", connected: true, connectedSource: "HDMI", contentType: "hdmi1" }] });
const launchRefused = () => ({ returnValue: false, errorCode: -102, errorText: "app is locked" });

// The mock timers tick in steps of 100 ms: chained timeouts do not fire inside one large tick.
function advance(t, milliseconds) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    t.mock.timers.tick(100);
  }
}

// responders: { <uri>: (payload) => reply payload }, replaced per test. Unknown URIs answer returnValue true.
function createHarness(t, overrides = {}) {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: START_TIME });
  const calls = [];
  const logLines = [];
  const lastInputCalls = [];
  const responders = {
    [FOREGROUND_URI]: launcherInFront,
    [VIDEO_STATUS_URI]: noTuner,
    ...overrides.responders,
  };
  const clock = { uptime: overrides.uptime === undefined ? 1000 : overrides.uptime, hasInputDevices: overrides.hasInputDevices !== false };
  const takeover = createTakeover({
    call: (uri, payload, onReply) => {
      calls.push({ uri, payload, at: Date.now() - START_TIME });
      const responder = responders[uri];
      onReply({ payload: responder ? responder(payload) : { returnValue: true } });
    },
    lastInput: {
      pointAtLauncher: (reason) => lastInputCalls.push(["pointAtLauncher", reason]),
      restoreOriginal: () => lastInputCalls.push(["restoreOriginal"]),
    },
    hasInputDevices: () => clock.hasInputDevices,
    uptimeSeconds: () => clock.uptime,
    log: (line) => logLines.push(line),
    appId: APP_ID,
    launchId: overrides.launchId,
    bootMode: overrides.bootMode !== false,
    watchMode: overrides.watchMode !== false,
  });
  return {
    takeover,
    calls,
    logLines,
    lastInputCalls,
    responders,
    clock,
    callsTo: (uri) => calls.filter((entry) => entry.uri === uri),
    launchedIds: () => calls.filter((entry) => entry.uri === LAUNCH_URI).map((entry) => entry.payload.id),
    logged: (text) => logLines.some((line) => line.includes(text)),
  };
}

function powerActive() {
  return { returnValue: true, state: "Active" };
}

function arm(t, harness) {
  harness.takeover.powerChanged(powerActive());
  advance(t, 2000);
  assert.ok(harness.logged("takeover armed"));
}

test("1. power Active: after 2000 ms the launcher in front arms the takeover without a launch", (t) => {
  const harness = createHarness(t);
  harness.takeover.powerChanged(powerActive());
  advance(t, 1900);
  assert.equal(harness.calls.length, 0);
  advance(t, 100);
  assert.deepEqual(harness.callsTo(FOREGROUND_URI).map((entry) => entry.payload), [{}, { extraInfo: true }]);
  assert.deepEqual(harness.callsTo(CONFIG_SET_URI).map((entry) => entry.payload), [{ configs: { [DISABLE_HOME_KEY]: true } }]);
  assert.deepEqual(harness.lastInputCalls, [["pointAtLauncher", "armed"]]);
  assert.ok(harness.logged("takeover armed"));
  assert.equal(harness.callsTo(LAUNCH_URI).length, 0);
});

test("2. refused launch fails the takeover and hands everything back; later events do nothing", (t) => {
  const harness = createHarness(t, { responders: { [FOREGROUND_URI]: otherAppInFront, [LAUNCH_URI]: launchRefused } });
  harness.takeover.powerChanged(powerActive());
  advance(t, 2000);
  assert.deepEqual(harness.callsTo(CONFIG_SET_URI).map((entry) => entry.payload), [{ configs: { [DISABLE_HOME_KEY]: false } }]);
  assert.deepEqual(harness.lastInputCalls, [["restoreOriginal"]]);
  assert.ok(harness.logged("takeover FAILED"));
  const callCount = harness.calls.length;
  harness.takeover.powerChanged({ returnValue: true, state: "Active Standby" });
  harness.takeover.powerChanged(powerActive());
  harness.takeover.homePressed("event1");
  advance(t, 10000);
  assert.equal(harness.calls.length, callCount);
});

test("3. another app stays in front: four launches 1500 ms apart, then the takeover fails", (t) => {
  const harness = createHarness(t, { responders: { [FOREGROUND_URI]: otherAppInFront } });
  harness.takeover.powerChanged(powerActive());
  advance(t, 20000);
  const launchTimes = harness.callsTo(LAUNCH_URI).map((entry) => entry.at);
  assert.deepEqual(launchTimes, [2000, 3500, 5000, 6500]);
  assert.ok(harness.logged("giving up, launcher not in front"));
  assert.deepEqual(harness.lastInputCalls, [["restoreOriginal"]]);
});

test("4. input stand-in gets one rescue launch; a second stand-in in the same run gets none", (t) => {
  const harness = createHarness(t);
  let standInShown = true;
  harness.responders[FOREGROUND_URI] = (payload) => (standInShown ? standInInFront(payload) : launcherInFront(payload));
  harness.responders[LAUNCH_URI] = () => {
    standInShown = false;
    return { returnValue: true };
  };
  harness.takeover.powerChanged(powerActive());
  advance(t, 4000);
  assert.deepEqual(harness.launchedIds(), [APP_ID]);
  assert.ok(harness.logged("input stand-in in front"));
  assert.ok(harness.logged("takeover armed"));

  standInShown = true;
  harness.takeover.powerChanged({ returnValue: true, state: "Active Standby" });
  harness.takeover.powerChanged(powerActive());
  advance(t, 20000);
  assert.deepEqual(harness.launchedIds(), [APP_ID]);
  assert.ok(harness.logged("input stand-in still in front after the rescue launch"));
  assert.ok(harness.logged("takeover FAILED"));

  const staysInFront = createHarness(t, { responders: { [FOREGROUND_URI]: standInInFront } });
  staysInFront.takeover.powerChanged(powerActive());
  advance(t, 20000);
  assert.deepEqual(staysInFront.launchedIds(), [APP_ID]);
  assert.ok(staysInFront.logged("input stand-in still in front after the rescue launch"));
  assert.deepEqual(staysInFront.lastInputCalls, [["restoreOriginal"]]);
});

test("5. without input devices the takeover arms but leaves disableHome alone", (t) => {
  const harness = createHarness(t, { hasInputDevices: false });
  arm(t, harness);
  assert.equal(harness.callsTo(CONFIG_SET_URI).length, 0);
});

test("6. watch only: start() checks the foreground once and launches only when needed; with boot it does nothing", (t) => {
  const launcherFront = createHarness(t, { bootMode: false });
  launcherFront.takeover.start();
  advance(t, 100);
  assert.deepEqual(launcherFront.callsTo(FOREGROUND_URI).map((entry) => entry.payload), [{}, { extraInfo: true }]);
  assert.equal(launcherFront.callsTo(LAUNCH_URI).length, 0);
  assert.ok(launcherFront.logged("takeover armed"));
  advance(t, 10000);
  assert.equal(launcherFront.callsTo(FOREGROUND_URI).length, 2);
  assert.equal(launcherFront.callsTo(VIDEO_STATUS_URI).length, 0);

  const otherFront = createHarness(t, { bootMode: false, responders: { [FOREGROUND_URI]: otherAppInFront } });
  otherFront.takeover.start();
  advance(t, 100);
  assert.deepEqual(otherFront.launchedIds(), [APP_ID]);

  const withBoot = createHarness(t);
  withBoot.takeover.start();
  advance(t, 10000);
  assert.equal(withBoot.calls.length, 0);
});

test("7. settle guard: LG Home in front relaunches the launcher at most three times, none after the window", (t) => {
  const harness = createHarness(t);
  arm(t, harness);
  harness.responders[FOREGROUND_URI] = lgHomeInFront;
  advance(t, 60000);
  const launchTimes = harness.callsTo(LAUNCH_URI).map((entry) => entry.at);
  assert.equal(launchTimes.length, 3);
  assert.ok(launchTimes.every((time) => time <= 2000 + 45000));
});

test("8. settle guard: tuner on the MAIN sink opens Live TV, then the launcher once; HDMI is left alone", (t) => {
  const tuner = createHarness(t, { responders: { [VIDEO_STATUS_URI]: tunerOnMainSink } });
  arm(t, tuner);
  advance(t, 30000);
  assert.deepEqual(tuner.launchedIds(), [LIVE_TV_APP_ID, APP_ID]);
  const launchTimes = tuner.callsTo(LAUNCH_URI).map((entry) => entry.at);
  assert.equal(launchTimes[1] - launchTimes[0], 2000);

  const hdmi = createHarness(t, { responders: { [VIDEO_STATUS_URI]: hdmiOnMainSink } });
  arm(t, hdmi);
  advance(t, 30000);
  assert.equal(hdmi.callsTo(LAUNCH_URI).length, 0);
});

test("9. Active after Screen Saver launches only while the takeover is not armed", (t) => {
  const armed = createHarness(t);
  arm(t, armed);
  armed.responders[FOREGROUND_URI] = otherAppInFront;
  armed.takeover.powerChanged({ returnValue: true, state: "Screen Saver" });
  armed.takeover.powerChanged(powerActive());
  advance(t, 10000);
  assert.equal(armed.callsTo(LAUNCH_URI).length, 0);
  assert.ok(armed.logged("Active after Screen Saver: no launch"));

  const notArmed = createHarness(t, { responders: { [FOREGROUND_URI]: otherAppInFront } });
  notArmed.takeover.powerChanged({ returnValue: true, state: "Screen Saver" });
  notArmed.takeover.powerChanged(powerActive());
  advance(t, 2000);
  assert.deepEqual(notArmed.launchedIds(), [APP_ID]);
});

test("10. power off while armed saves the last input and closes Live TV; other states point the last input once", (t) => {
  const armed = createHarness(t);
  arm(t, armed);
  armed.takeover.powerChanged({ returnValue: true, state: "Active", processing: "Request Power Off" });
  assert.deepEqual(armed.lastInputCalls, [["pointAtLauncher", "armed"], ["pointAtLauncher", "processing Request Power Off"]]);
  assert.deepEqual(armed.callsTo(CLOSE_URI).map((entry) => entry.payload), [{ id: LIVE_TV_APP_ID }]);

  const standby = createHarness(t);
  arm(t, standby);
  standby.takeover.powerChanged({ returnValue: true, state: "Active Standby" });
  assert.deepEqual(standby.lastInputCalls, [["pointAtLauncher", "armed"], ["pointAtLauncher", "power state Active Standby"]]);

  const notArmed = createHarness(t);
  notArmed.takeover.powerChanged({ returnValue: true, state: "Active", processing: "Request Power Off" });
  assert.deepEqual(notArmed.lastInputCalls, []);
  assert.equal(notArmed.callsTo(CLOSE_URI).length, 0);
});

test("11. userLaunch voids the pending launch sequence and passes the reply on", (t) => {
  const harness = createHarness(t, { responders: { [FOREGROUND_URI]: otherAppInFront } });
  harness.takeover.powerChanged(powerActive());
  advance(t, 1000);
  const replies = [];
  harness.takeover.userLaunch("com.example.app", undefined, (payload) => replies.push(payload));
  advance(t, 10000);
  assert.deepEqual(harness.calls.map((entry) => entry.uri), [LAUNCH_URI]);
  assert.deepEqual(harness.calls[0].payload, { id: "com.example.app", params: {} });
  assert.deepEqual(replies, [{ returnValue: true }]);
  assert.ok(harness.logged("launch com.example.app"));
});

test("12. HOME: nothing for a lone launcher, one launch with Settings on top, one handling per press burst", (t) => {
  const loneLauncher = createHarness(t);
  loneLauncher.takeover.homePressed("event1");
  advance(t, 5000);
  assert.equal(loneLauncher.callsTo(LAUNCH_URI).length, 0);
  assert.ok(loneLauncher.logged("HOME: launcher is in front already"));

  const settings = createHarness(t, { responders: { [FOREGROUND_URI]: settingsOverLauncher } });
  settings.takeover.homePressed("event1");
  advance(t, 5000);
  assert.deepEqual(settings.launchedIds(), [APP_ID]);

  const burst = createHarness(t, { responders: { [FOREGROUND_URI]: settingsOverLauncher } });
  burst.takeover.homePressed("event1");
  advance(t, 400);
  burst.takeover.homePressed("event2");
  advance(t, 5000);
  assert.deepEqual(burst.launchedIds(), [APP_ID]);
  assert.equal(burst.logLines.filter((line) => line.includes("HOME pressed")).length, 1);
});

test("13. HOME launch with the launcher not in front 3000 ms later fails; a userLaunch cancels that check", (t) => {
  const notInFront = createHarness(t, { responders: { [FOREGROUND_URI]: (payload) => (payload.extraInfo ? settingsOverLauncher(payload) : otherAppInFront(payload)) } });
  notInFront.takeover.homePressed("event1");
  advance(t, 2900);
  assert.equal(notInFront.logged("takeover FAILED"), false);
  advance(t, 100);
  assert.ok(notInFront.logged("takeover FAILED"));
  assert.deepEqual(notInFront.lastInputCalls, [["restoreOriginal"]]);

  const cancelled = createHarness(t, { responders: { [FOREGROUND_URI]: (payload) => (payload.extraInfo ? settingsOverLauncher(payload) : otherAppInFront(payload)) } });
  cancelled.takeover.homePressed("event1");
  advance(t, 1000);
  cancelled.takeover.userLaunch("com.example.app", {}, () => {});
  advance(t, 10000);
  assert.equal(cancelled.logged("takeover FAILED"), false);
});

test("14. heartbeat: wake starts a launch sequence; clock jumps, early uptime and unarmed state do not", (t) => {
  const wake = createHarness(t, { uptime: "1000.50", responders: { [FOREGROUND_URI]: otherAppInFront } });
  advance(t, 15000);
  wake.clock.uptime = "1015.50";
  wake.takeover.heartbeat();
  assert.ok(wake.logged("heartbeat: gap of 15 s, TV woke from suspend"));
  advance(t, 1900);
  assert.equal(wake.calls.length, 0);
  advance(t, 100);
  assert.deepEqual(wake.launchedIds(), [APP_ID]);

  const launcherFront = createHarness(t, { uptime: 1000 });
  advance(t, 15000);
  launcherFront.clock.uptime = 1015;
  launcherFront.takeover.heartbeat();
  advance(t, 2000);
  assert.equal(launcherFront.callsTo(LAUNCH_URI).length, 0);
  assert.ok(launcherFront.logged("wake: launcher is in the foreground after 0 launches"));

  const clockJump = createHarness(t, { uptime: 1000 });
  t.mock.timers.tick(3600000);
  clockJump.clock.uptime = 1001;
  clockJump.takeover.heartbeat();
  advance(t, 5000);
  assert.ok(clockJump.logged("clock jump"));
  assert.equal(clockJump.calls.length, 0);

  const earlyUptime = createHarness(t, { uptime: 50 });
  advance(t, 15000);
  earlyUptime.clock.uptime = 65;
  earlyUptime.takeover.heartbeat();
  advance(t, 5000);
  assert.equal(earlyUptime.calls.length, 0);

  const heartbeatPoints = createHarness(t);
  heartbeatPoints.takeover.heartbeat();
  assert.deepEqual(heartbeatPoints.lastInputCalls, []);
  arm(t, heartbeatPoints);
  heartbeatPoints.takeover.heartbeat();
  assert.deepEqual(heartbeatPoints.lastInputCalls, [["pointAtLauncher", "armed"], ["pointAtLauncher", "heartbeat"]]);

  const watchOnly = createHarness(t, { bootMode: false });
  arm(t, watchOnly);
  watchOnly.takeover.heartbeat();
  assert.deepEqual(watchOnly.lastInputCalls, []);
});

test("15. shutDown gives disableHome back only after it was set", (t) => {
  const armed = createHarness(t);
  arm(t, armed);
  const callCount = armed.calls.length;
  let done = 0;
  armed.takeover.shutDown(() => (done += 1));
  assert.equal(done, 1);
  assert.deepEqual(armed.calls[callCount].payload, { configs: { [DISABLE_HOME_KEY]: false } });

  const notArmed = createHarness(t);
  notArmed.takeover.shutDown(() => (done += 1));
  assert.equal(done, 2);
  assert.equal(notArmed.calls.length, 0);

  const noDevices = createHarness(t, { hasInputDevices: false });
  arm(t, noDevices);
  const callsBefore = noDevices.calls.length;
  noDevices.takeover.shutDown(() => (done += 1));
  assert.equal(done, 3);
  assert.equal(noDevices.calls.length, callsBefore);
});

test("16. HDMI input with no video client 3000 ms after the launch is closed and launched once more", (t) => {
  const HDMI_APP_ID = "com.webos.app.hdmi3";
  const hdmiInFront = () => ({ returnValue: true, appId: HDMI_APP_ID });
  const staleClientOnly = () => ({ returnValue: true, clients: [{ appId: "com.webos.app.hdmi2", sinkName: "MAIN", sourceName: "HDMI", activation: false }] });
  const hdmiClient = () => ({ returnValue: true, clients: [{ appId: HDMI_APP_ID, sinkName: "MAIN", sourceName: "HDMI", activation: true }] });

  const stuck = createHarness(t, { responders: { [FOREGROUND_URI]: hdmiInFront, [VIDEO_STATUS_URI]: staleClientOnly } });
  stuck.takeover.userLaunch(HDMI_APP_ID, { source: "tile" }, () => {});
  advance(t, 2900);
  assert.equal(stuck.callsTo(CLOSE_URI).length, 0);
  advance(t, 100);
  assert.deepEqual(stuck.callsTo(CLOSE_URI).map((entry) => entry.payload), [{ id: HDMI_APP_ID }]);
  assert.deepEqual(stuck.callsTo(LAUNCH_URI).map((entry) => entry.payload), [
    { id: HDMI_APP_ID, params: { source: "tile" } },
    { id: HDMI_APP_ID, params: { source: "tile" } },
  ]);
  assert.ok(stuck.logged("no video client"));
  advance(t, 10000);
  assert.equal(stuck.callsTo(CLOSE_URI).length, 1);

  const healthy = createHarness(t, { responders: { [FOREGROUND_URI]: hdmiInFront, [VIDEO_STATUS_URI]: hdmiClient } });
  healthy.takeover.userLaunch(HDMI_APP_ID, {}, () => {});
  advance(t, 10000);
  assert.equal(healthy.callsTo(VIDEO_STATUS_URI).length, 1);
  assert.equal(healthy.callsTo(CLOSE_URI).length, 0);

  const userLeft = createHarness(t, { responders: { [VIDEO_STATUS_URI]: staleClientOnly } });
  userLeft.takeover.userLaunch(HDMI_APP_ID, {}, () => {});
  advance(t, 10000);
  assert.equal(userLeft.callsTo(CLOSE_URI).length, 0);

  const otherApp = createHarness(t, { responders: { [FOREGROUND_URI]: otherAppInFront, [VIDEO_STATUS_URI]: staleClientOnly } });
  otherApp.takeover.userLaunch("netflix", {}, () => {});
  advance(t, 10000);
  assert.equal(otherApp.callsTo(FOREGROUND_URI).length, 0);
  assert.equal(otherApp.callsTo(VIDEO_STATUS_URI).length, 0);

  const newerLaunch = createHarness(t, { responders: { [FOREGROUND_URI]: hdmiInFront, [VIDEO_STATUS_URI]: staleClientOnly } });
  newerLaunch.takeover.userLaunch(HDMI_APP_ID, {}, () => {});
  advance(t, 1000);
  newerLaunch.takeover.userLaunch(HDMI_APP_ID, {}, () => {});
  advance(t, 10000);
  assert.equal(newerLaunch.callsTo(CLOSE_URI).length, 1);
});
