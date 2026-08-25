import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const names = [
  "buddys-sms-worker",
  "buddys-email-worker",
  "buddys-voice-worker",
  "buddys-concierge-worker",
  "buddys-dashboard-worker",
];
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const scratch = mkdtempSync(join(tmpdir(), "buddys-worker-bootstrap-"));

try {
  writeFileSync(join(scratch, "stub.mjs"), "export default { fetch(){ return Response.json({ ok:true, service:'buddys-bootstrap' }); } };\n");
  for (const name of names) {
    const config = join(scratch, `${name}.toml`);
    writeFileSync(config, `name = "${name}"\nmain = "stub.mjs"\ncompatibility_date = "2026-08-25"\n`);
    const result = spawnSync(npx, ["wrangler@latest", "deploy", "--config", config], {
      cwd: scratch,
      env:{ ...process.env, CI:"true" },
      stdio:"inherit",
    });
    if (result.status !== 0) throw new Error(`Failed to bootstrap ${name}`);
  }
} finally {
  rmSync(scratch, { recursive:true, force:true });
}
