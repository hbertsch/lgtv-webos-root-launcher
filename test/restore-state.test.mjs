import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { findMissingRules } from "../scripts/find-missing-rules.mjs";

const wantedRules = [
  { type: "deny", kind: "exact", domain: "ueiwsp.com", comment: "LG TV privacy layer (Phase 2)" },
  { type: "allow", kind: "exact", domain: "de.nextlgsdp.com", comment: "LG TV: Store/app service discovery (error 102 fix)" },
];

test("findMissingRules: nothing missing when every rule exists", () => {
  const existingRules = [{ type: "allow", kind: "exact", domain: "de.nextlgsdp.com", id: 1 }, { type: "deny", kind: "exact", domain: "ueiwsp.com", id: 2 }];
  assert.deepEqual(findMissingRules(existingRules, wantedRules), []);
});

test("findMissingRules: a deny rule does not count as the allow rule of the same domain", () => {
  const existingRules = [{ type: "deny", kind: "exact", domain: "de.nextlgsdp.com" }, { type: "deny", kind: "exact", domain: "ueiwsp.com" }];
  assert.deepEqual(findMissingRules(existingRules, wantedRules), [wantedRules[1]]);
});

test("findMissingRules: everything is missing from an empty Pi-hole", () => {
  assert.deepEqual(findMissingRules([], wantedRules), wantedRules);
});

test("pihole-rules.json: every rule is complete and none is duplicated", async () => {
  const rules = JSON.parse(await readFile(new URL("../scripts/root/pihole-rules.json", import.meta.url), "utf8"));
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    assert.match(rule.type, /^(allow|deny)$/);
    assert.match(rule.kind, /^(exact|regex)$/);
    assert.ok(rule.domain && rule.comment, `incomplete rule ${JSON.stringify(rule)}`);
  }
  const keys = rules.map((rule) => `${rule.type}/${rule.kind}/${rule.domain}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("debloat-ids.txt: 41 unique, well-formed app ids, the Home Dashboard (INPUT key) not among them", async () => {
  const content = await readFile(new URL("../scripts/root/debloat-ids.txt", import.meta.url), "utf8");
  const ids = content.split("\n").filter((line) => line !== "");
  assert.equal(ids.length, 41);
  assert.ok(!ids.includes("com.webos.app.homeconnect"));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[a-z0-9._-]+$/);
  }
});
