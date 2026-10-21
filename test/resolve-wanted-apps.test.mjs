import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveWantedApps } from "../scripts/resolve-wanted-apps.mjs";

const launchPoints = JSON.parse(readFileSync(new URL("./fixtures/launch-points.json", import.meta.url)));

test("matches the title case-insensitively and prefers the large icon", () => {
  const { resolvedApps } = resolveWantedApps(launchPoints, [{ title: "Netflix", match: "NETFLIX" }]);
  assert.deepEqual(resolvedApps, [
    { title: "Netflix", appId: "netflix", iconUrl: "http://192.0.2.18:3000/resources/netflix/large.png" },
  ]);
});

test("prefers an exact title over an earlier partial match", () => {
  const { resolvedApps } = resolveWantedApps(launchPoints, [{ title: "YouTube", match: "youtube" }]);
  assert.equal(resolvedApps[0].appId, "youtube.leanback.v4");
});

test("falls back to the small icon and a partial title match", () => {
  const { resolvedApps } = resolveWantedApps(launchPoints, [{ title: "Prime", match: "prime" }]);
  assert.deepEqual(resolvedApps, [
    { title: "Prime", appId: "amazon", iconUrl: "http://192.0.2.18:3000/resources/amazon/icon.png" },
  ]);
});

test("fixed entries skip matching and take the icon of the launch point with that id", () => {
  const wantedApps = [
    { title: "Switch", appId: "com.webos.app.hdmi1" },
    { title: "Xbox", appId: "com.webos.app.hdmi2" },
  ];
  const { resolvedApps, missingTitles } = resolveWantedApps(launchPoints, wantedApps);
  assert.deepEqual(resolvedApps, [
    { title: "Switch", appId: "com.webos.app.hdmi1", iconUrl: "http://192.0.2.18:3000/resources/hdmi1/icon.png" },
    { title: "Xbox", appId: "com.webos.app.hdmi2", iconUrl: undefined },
  ]);
  assert.deepEqual(missingTitles, []);
});

test("reports wanted titles without a launch point and keeps the order of the rest", () => {
  const wantedApps = [
    { title: "Plex", match: "Plex" },
    { title: "Netflix", match: "Netflix" },
    { title: "YouTube", match: "YouTube" },
  ];
  const { resolvedApps, missingTitles } = resolveWantedApps(launchPoints, wantedApps);
  assert.deepEqual(resolvedApps.map((app) => app.title), ["Netflix", "YouTube"]);
  assert.deepEqual(missingTitles, ["Plex"]);
});

test("passes the optional brand color through and leaves it out when not set", () => {
  const wantedApps = [
    { title: "Netflix", match: "Netflix", color: "#e50914" },
    { title: "YouTube", match: "YouTube" },
  ];
  const { resolvedApps } = resolveWantedApps(launchPoints, wantedApps);
  assert.equal(resolvedApps[0].color, "#e50914");
  assert.equal("color" in resolvedApps[1], false);
});

test("passes the optional logo through and leaves it out when not set", () => {
  const wantedApps = [
    { title: "Netflix", match: "Netflix", logo: "netflix" },
    { title: "YouTube", match: "YouTube" },
  ];
  const { resolvedApps } = resolveWantedApps(launchPoints, wantedApps);
  assert.equal(resolvedApps[0].logo, "netflix");
  assert.equal("logo" in resolvedApps[1], false);
});
