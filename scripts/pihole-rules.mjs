// Adds the Pi-hole rules of the TV privacy layer (scripts/root/pihole-rules.json) that are missing.
// Run: PIHOLE_URL=<Pi-hole address> PIHOLE_PASSWORD=<password> node scripts/pihole-rules.mjs [--check]
// --check only reports and exits 1 when rules are missing.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { findMissingRules } from "./find-missing-rules.mjs";

const PIHOLE_URL = process.env.PIHOLE_URL;
if (!PIHOLE_URL) {
  console.error("set PIHOLE_URL to the address of the Pi-hole, e.g. http://192.0.2.2");
  process.exit(1);
}
const RULES_FILE = fileURLToPath(new URL("root/pihole-rules.json", import.meta.url));
const onlyCheck = process.argv.includes("--check");

async function piholeRequest(method, path, sessionId, body) {
  const response = await fetch(`${PIHOLE_URL}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(sessionId ? { sid: sessionId } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const wantedRules = JSON.parse(await readFile(RULES_FILE, "utf8"));
const login = await piholeRequest("POST", "/auth", null, { password: process.env.PIHOLE_PASSWORD });
const sessionId = login.session.sid;

try {
  const { domains } = await piholeRequest("GET", "/domains", sessionId);
  const missingRules = findMissingRules(domains, wantedRules);
  console.log(`pihole rules: ${wantedRules.length - missingRules.length} of ${wantedRules.length} present`);

  for (const rule of missingRules) {
    if (onlyCheck) {
      console.log(`missing ${rule.type}/${rule.kind} ${rule.domain}`);
      continue;
    }
    await piholeRequest("POST", `/domains/${rule.type}/${rule.kind}`, sessionId, {
      domain: rule.domain,
      comment: rule.comment,
      groups: [0],
      enabled: true,
    });
    console.log(`added ${rule.type}/${rule.kind} ${rule.domain}`);
  }
  process.exitCode = onlyCheck && missingRules.length > 0 ? 1 : 0;
} finally {
  await piholeRequest("DELETE", "/auth", sessionId).catch(() => {});
}
