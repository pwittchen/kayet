// Dev server launcher used as Tauri's beforeDevCommand.
//
// Runs Vite in-process (no npm/sh wrappers that swallow signals) and makes sure
// it never outlives `tauri dev`: it shuts down on SIGINT/SIGTERM/SIGHUP and when
// its parent process disappears. On startup it also reclaims the port from a
// stale Vite left behind by an earlier session of this project.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 1420; // keep in sync with vite.config.ts and tauri.conf.json devUrl

function listeningPids() {
  try {
    return execFileSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return []; // lsof exits non-zero when nothing is listening
  }
}

function commandOf(pid) {
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function reclaimPort() {
  const stale = listeningPids().filter((pid) => {
    const cmd = commandOf(pid);
    return cmd.includes(root) && cmd.includes("vite");
  });
  if (stale.length === 0) return;
  console.log(`[dev] stopping stale dev server on port ${port} (pid ${stale.join(", ")})`);
  for (const pid of stale) process.kill(pid, "SIGTERM");
  for (let i = 0; i < 25 && listeningPids().length > 0; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const pid of stale) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

await reclaimPort();

const server = await createServer({ configFile: `${root}/vite.config.ts` });
await server.listen();
server.printUrls();

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const force = setTimeout(() => process.exit(0), 2000);
  force.unref();
  await server.close().catch(() => {});
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, shutdown);

// If tauri dev dies without signalling us, we get re-parented; exit then too.
const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) shutdown();
}, 1000).unref();
