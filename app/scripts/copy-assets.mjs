// Copy what the app's own pages share with the site: the BOM tokens, the O2
// mark and the Geist font. One source of truth; the copies are not committed.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const vendor = path.join(root, "static", "vendor");
const geist = path.dirname(require.resolve("@fontsource-variable/geist/package.json"));

const copies = [
  [path.join(root, "shared", "tokens.css"), "tokens.css"],
  [path.join(root, "shared", "o2-mark.png"), "o2-mark.png"],
  [path.join(geist, "files", "geist-latin-wght-normal.woff2"), "geist-latin-wght-normal.woff2"],
  [path.join(geist, "files", "geist-latin-ext-wght-normal.woff2"), "geist-latin-ext-wght-normal.woff2"],
];

mkdirSync(vendor, { recursive: true });
for (const [source, name] of copies) copyFileSync(source, path.join(vendor, name));
console.log(`Copied ${copies.length} shared assets to static/vendor.`);
