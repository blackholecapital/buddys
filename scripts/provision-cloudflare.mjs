import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), "buddys-cloudflare-"));
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const baseEnv = { ...process.env, CI:"true", NO_COLOR:"1" };

function run(args, { capture = false } = {}) {
  const result = spawnSync(npx, ["wrangler@latest", ...args], {
    cwd: scratch,
    env: baseEnv,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const detail = capture ? `${result.stdout || ""}\n${result.stderr || ""}`.trim() : "";
    throw new Error(`wrangler ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result.stdout || "";
}

function databases() {
  const parsed = JSON.parse(run(["d1", "list", "--json"], { capture:true }));
  return Array.isArray(parsed) ? parsed : parsed.result || [];
}

function databaseId(row) {
  return String(row.uuid || row.id || row.database_id || "").trim();
}

function ensureDatabase(name) {
  let row = databases().find((item) => item.name === name);
  if (!row) {
    run(["d1", "create", name, "--location", "enam"]);
    row = databases().find((item) => item.name === name);
  }
  const id = row && databaseId(row);
  if (!id) throw new Error(`Could not resolve D1 ID for ${name}`);
  return id;
}

function ensureQueue(name) {
  const listed = run(["queues", "list"], { capture:true });
  if (listed.split(/\r?\n/).some((line) => line.includes(name))) return;
  run(["queues", "create", name]);
}

function replaceMarker(path, marker, value) {
  const absolute = resolve(repo, path);
  const current = readFileSync(absolute, "utf8");
  if (!current.includes(marker)) return;
  writeFileSync(absolute, current.replaceAll(marker, value));
}

try {
  run(["whoami"]);
  const dashboardId = ensureDatabase("buddys-dashboard-db");
  const messageTrackId = ensureDatabase("buddys-message-track-db");
  ensureQueue("buddys-followup-jobs");
  ensureQueue("buddys-communication-events");

  replaceMarker("apps/dashboard/wrangler.toml", "__BUDDYS_DASHBOARD_DB_ID__", dashboardId);
  replaceMarker("apps/dashboard/wrangler.toml", "__BUDDYS_MESSAGE_TRACK_DB_ID__", messageTrackId);
  replaceMarker("apps/blackhole-concierge-worker/wrangler.toml", "__BUDDYS_MESSAGE_TRACK_DB_ID__", messageTrackId);

  console.log(JSON.stringify({
    ok:true,
    d1:{ dashboard:{ name:"buddys-dashboard-db", id:dashboardId }, messageTrack:{ name:"buddys-message-track-db", id:messageTrackId } },
    queues:["buddys-followup-jobs", "buddys-communication-events"],
    analytics:["buddys_message_events", "buddys_voice_events"],
  }, null, 2));
} finally {
  rmSync(scratch, { recursive:true, force:true });
}
