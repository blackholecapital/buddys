import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(root, "tenant-kit.lock.json"), "utf8"));
const failures = [];
for (const [relativePath, expected] of Object.entries(lock.sealed_files ?? {})) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) {
    failures.push(`missing sealed file: ${relativePath}`);
    continue;
  }
  const actual = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  if (actual !== expected) failures.push(`sealed file changed: ${relativePath}`);
}
if (failures.length > 0) {
  for (const failure of failures) console.error(`[tenant-kit][FAIL] ${failure}`);
  process.exit(1);
}
console.log(`[tenant-kit][PASS] ${Object.keys(lock.sealed_files).length} sealed files match adapter ${lock.adapter_version}`);
