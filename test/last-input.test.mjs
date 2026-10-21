import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const { createLastInput } = createRequire(import.meta.url)("../service/last-input.js");
const APP_ID = "lgtv.blueprint.launcher";

function setup(initialContent, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-input-"));
  const file = path.join(directory, "lastinput");
  const backupFile = path.join(directory, "lastinput.orig");
  const launcherAppFile = path.join(directory, "appinfo.json");
  if (initialContent !== undefined) {
    fs.writeFileSync(file, initialContent);
  }
  if (options.launcherInstalled !== false) {
    fs.writeFileSync(launcherAppFile, "{}");
  }
  if (options.backup !== undefined) {
    fs.writeFileSync(backupFile, options.backup);
  }
  const logLines = [];
  const lastInput = createLastInput({ file, backupFile, launcherAppFile, appId: APP_ID, log: (line) => logLines.push(line) });
  return { directory, file, backupFile, lastInput, logLines, readFile: () => fs.readFileSync(file, "utf8") };
}

const tunerContent = JSON.stringify({ physicalLastSourceAppId: "com.webos.app.livetv", physicalLastSourceId: "DTV", other: "keep" });
const launcherContent = JSON.stringify({ physicalLastSourceAppId: APP_ID, physicalLastSourceId: "HDMI_1", other: "new" });

test("pointAtLauncher sets app and source, keeps other fields, writes the backup", () => {
  const { lastInput, readFile, backupFile } = setup(tunerContent);
  lastInput.pointAtLauncher("test");
  assert.deepEqual(JSON.parse(readFile()), { physicalLastSourceAppId: APP_ID, physicalLastSourceId: "HDMI_1", other: "keep" });
  assert.equal(fs.readFileSync(backupFile, "utf8"), tunerContent);
});

test("a second pointAtLauncher after EIM rewrote the file keeps the first backup", () => {
  const { lastInput, file, backupFile } = setup(tunerContent);
  lastInput.pointAtLauncher("first");
  const rewritten = JSON.stringify({ physicalLastSourceAppId: "com.webos.app.hdmi2", physicalLastSourceId: "HDMI_2" });
  fs.writeFileSync(file, rewritten);
  lastInput.pointAtLauncher("second");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).physicalLastSourceAppId, APP_ID);
  assert.equal(fs.readFileSync(backupFile, "utf8"), tunerContent);
});

test("pointAtLauncher leaves a file alone that already points at the launcher and HDMI_1", () => {
  const { lastInput, readFile, backupFile } = setup(launcherContent);
  lastInput.pointAtLauncher("test");
  assert.equal(readFile(), launcherContent);
  assert.equal(fs.existsSync(backupFile), false);
});

test("pointAtLauncher with the launcher app file missing leaves the file alone", () => {
  const { lastInput, readFile, backupFile, logLines } = setup(tunerContent, { launcherInstalled: false });
  lastInput.pointAtLauncher("test");
  assert.equal(readFile(), tunerContent);
  assert.equal(fs.existsSync(backupFile), false);
  assert.match(logLines.join("\n"), /launcher not installed/);
});

test("restoreOriginal puts both fields back and keeps the other current fields", () => {
  const original = JSON.stringify({ physicalLastSourceAppId: "com.webos.app.livetv", physicalLastSourceId: "DTV", other: "old" });
  const { lastInput, readFile } = setup(launcherContent, { backup: original });
  lastInput.restoreOriginal();
  assert.deepEqual(JSON.parse(readFile()), { physicalLastSourceAppId: "com.webos.app.livetv", physicalLastSourceId: "DTV", other: "new" });
});

test("restoreOriginal leaves a file alone that points at another app", () => {
  const current = JSON.stringify({ physicalLastSourceAppId: "com.webos.app.hdmi2" });
  const { lastInput, readFile } = setup(current, { backup: JSON.stringify({ physicalLastSourceAppId: "com.webos.app.hdmi1" }) });
  lastInput.restoreOriginal();
  assert.equal(readFile(), current);
});

test("restoreOriginal without a backup leaves the file alone", () => {
  const { lastInput, readFile } = setup(launcherContent);
  lastInput.restoreOriginal();
  assert.equal(readFile(), launcherContent);
});

test("invalid JSON in the file does not throw and is logged as failed", () => {
  const { lastInput, logLines } = setup("not json");
  lastInput.pointAtLauncher("test");
  assert.match(logLines.join("\n"), /failed/);
});

test("no temp file is left behind after a write", () => {
  const { lastInput, directory } = setup(tunerContent, { backup: tunerContent });
  lastInput.pointAtLauncher("test");
  lastInput.restoreOriginal();
  assert.equal(fs.existsSync(path.join(directory, "lastinput.launcher.tmp")), false);
});
