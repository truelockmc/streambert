// Copies the desktop app's ad/tracker host list (BLOCKED_HOSTS in
// index.js, Electron URL patterns like "*://*.ads.com/*") into
// the Android assets as one entry per line: "ads.com" blocks that exact host,
// "*.ads.com" blocks its subdomains (matching the Electron pattern semantics).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexJs = path.resolve(here, "../../../index.js");
const out = path.resolve(here, "../../app/src/main/assets/blocklist.txt");

const source = fs.readFileSync(indexJs, "utf8");
const block = source.match(/const BLOCKED_HOSTS = \[([\s\S]*?)\];/);
if (!block) throw new Error("BLOCKED_HOSTS not found in " + indexJs);

const hosts = new Set();
for (const [, pattern] of block[1].matchAll(/"([^"]+)"/g)) {
  const m = pattern.match(/^\*:\/\/((?:\*\.)?[^/*]+)\/\*$/);
  if (m) hosts.add(m[1].toLowerCase());
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, [...hosts].sort().join("\n") + "\n");
console.log(`blocklist: ${hosts.size} entries ->${path.relative(process.cwd(), out)}`);
