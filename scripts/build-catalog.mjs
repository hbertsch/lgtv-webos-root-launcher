// Pairs with the TV over SSAP, reads the launch points and writes app/catalog.json plus app/icons/.
// Run: TV_IP=<address of the TV> node scripts/build-catalog.mjs (the TV shows a pairing prompt on the first run).
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWantedApps } from "./resolve-wanted-apps.mjs";

const TV_HOST = process.env.TV_IP;
if (!TV_HOST) {
  console.error("set TV_IP to the address of the TV");
  process.exit(1);
}
const SECURE_URL = `wss://${TV_HOST}:3001`;
const PLAIN_URL = `ws://${TV_HOST}:3000`;
const CONNECT_TIMEOUT_MS = 10_000;
const RESPONSE_TIMEOUT_MS = 10_000;
const PAIRING_TIMEOUT_MS = 60_000;

const KEY_DIRECTORY = join(homedir(), ".config", "lgtv-webos-root-launcher");
const KEY_FILE = join(KEY_DIRECTORY, "client-key");

const projectFile = (relativePath) => fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
const WANTED_APPS_FILE = projectFile("scripts/wanted-apps.json");
const ALL_APPS_FILE = projectFile("docs/all-apps.json");
const CATALOG_FILE = projectFile("app/catalog.json");
const ICON_DIRECTORY = projectFile("app/icons");

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`timeout after ${CONNECT_TIMEOUT_MS} ms`));
    }, CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve(socket);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("connection failed"));
    };
  });
}

async function connect() {
  // The TV serves a self-signed certificate. Node's built-in WebSocket has no per-connection
  // option for that, so certificate checks are switched off for this process (only the TV is contacted).
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await openSocket(SECURE_URL);
  } catch (error) {
    console.log(`${SECURE_URL}: ${error.message}, trying ${PLAIN_URL}`);
    return openSocket(PLAIN_URL);
  }
}

// Resolves with the first message that has the given id and one of the given types.
function waitForMessage(socket, id, types, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`no answer for "${id}" after ${timeoutMs} ms`));
    }, timeoutMs);
    function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.id !== id || !types.includes(message.type)) {
        return;
      }
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    }
    socket.addEventListener("message", onMessage);
  });
}

async function sendAndWait(socket, message, types = ["response", "hello"]) {
  const answer = waitForMessage(socket, message.id, [...types, "error"], RESPONSE_TIMEOUT_MS);
  socket.send(JSON.stringify(message));
  const response = await answer;
  if (response.type === "error") {
    throw new Error(`${message.id}: ${response.error}`);
  }
  return response;
}

async function readClientKey() {
  try {
    return (await readFile(KEY_FILE, "utf8")).trim();
  } catch (error) {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function saveClientKey(clientKey) {
  await mkdir(KEY_DIRECTORY, { recursive: true, mode: 0o700 });
  await writeFile(KEY_FILE, clientKey, { mode: 0o600 });
  await chmod(KEY_FILE, 0o600);
}

async function register(socket) {
  const payload = {
    forcePairing: false,
    pairingType: "PROMPT",
    manifest: { manifestVersion: 1, appVersion: "1.1", permissions: ["READ_INSTALLED_APPS"] },
  };
  const savedClientKey = await readClientKey();
  if (savedClientKey) {
    payload["client-key"] = savedClientKey;
  } else {
    console.log("No client key saved yet. Accept the pairing prompt on the TV with the remote (60 s).");
  }

  const registered = waitForMessage(socket, "register_0", ["registered", "error"], PAIRING_TIMEOUT_MS);
  socket.send(JSON.stringify({ id: "register_0", type: "register", payload }));
  const answer = await registered;
  if (answer.type === "error") {
    throw new Error(`pairing failed: ${answer.error}`);
  }

  const clientKey = answer.payload["client-key"];
  if (clientKey !== savedClientKey) {
    await saveClientKey(clientKey);
    console.log(`Client key saved to ${KEY_FILE}`);
  }
}

async function listLaunchPoints(socket) {
  const response = await sendAndWait(socket, {
    id: "launch_points",
    type: "request",
    uri: "ssap://com.webos.applicationManager/listLaunchPoints",
    payload: {},
  });
  return response.payload.launchPoints;
}

async function downloadIcon(iconUrl, appId) {
  // The TV may name itself in the URL (for example lgwebostv.local); use the known address instead.
  const url = new URL(iconUrl, `http://${TV_HOST}:3000`);
  url.hostname = TV_HOST;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  await writeFile(join(ICON_DIRECTORY, `${appId}.png`), Buffer.from(await response.arrayBuffer()));
}

function formatCatalog(catalogEntries) {
  const lines = catalogEntries.map((entry) => {
    const fields = Object.entries(entry).map(([name, value]) => `"${name}": ${JSON.stringify(value)}`);
    return `  { ${fields.join(", ")} }`;
  });
  return `[\n${lines.join(",\n")}\n]\n`;
}

async function main() {
  const wantedApps = JSON.parse(await readFile(WANTED_APPS_FILE, "utf8"));

  const socket = await connect();
  console.log(`Connected to ${socket.url}`);
  // The TV's hello answer carries no id, so it is matched by "no id" instead of "hello".
  const helloAnswer = waitForMessage(socket, undefined, ["hello"], RESPONSE_TIMEOUT_MS);
  socket.send(JSON.stringify({ id: "hello", type: "hello", payload: {} }));
  await helloAnswer;
  // Newer webOS versions want this request before the registration. The answer is not needed.
  await sendAndWait(socket, { id: "system_info", type: "request", uri: "ssap://system/getSystemInfo", payload: {} }).catch(() => {});
  await register(socket);
  const launchPoints = await listLaunchPoints(socket);
  socket.close();

  await writeFile(ALL_APPS_FILE, `${JSON.stringify(launchPoints, null, 2)}\n`);
  console.log(`${launchPoints.length} launch points written to docs/all-apps.json`);

  const { resolvedApps, missingTitles } = resolveWantedApps(launchPoints, wantedApps);
  await mkdir(ICON_DIRECTORY, { recursive: true });
  const catalogEntries = [];
  for (const { title, appId, iconUrl, color, logo } of resolvedApps) {
    const entry = { title, appId };
    if (color) {
      entry.color = color;
    }
    if (logo) {
      entry.logo = logo;
    } else if (iconUrl) {
      try {
        await downloadIcon(iconUrl, appId);
        entry.icon = `icons/${appId}.png`;
      } catch (error) {
        console.log(`No icon for ${title}: ${error.message}`);
      }
    }
    catalogEntries.push(entry);
  }

  await writeFile(CATALOG_FILE, formatCatalog(catalogEntries));
  console.log(`${catalogEntries.length} tiles written to app/catalog.json`);
  for (const title of missingTitles) {
    console.log(`No match for wanted app: ${title}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error.message);
    process.exit(1);
  },
);
