"use strict";

/* The pointer and highlight drawn on a supplier's page use the BOM tokens,
 * read from the same files the app's own pages use: static/vendor/tokens.css
 * (copied from the BOM site by scripts/copy-assets.mjs) and
 * static/motion-tokens.css. Only the first :root block is taken: the light
 * theme's custom properties, without media queries or other themes. */

const fs = require("node:fs");
const path = require("node:path");

const STATIC_DIR = path.join(__dirname, "..", "..", "static");


function rootBlock(css) {
  const start = css.search(/(^|\n)\s*:root\s*\{/);
  if (start < 0) return "";
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  return "";
}


function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}


let cached = null;

/** CSS declarations (`--primary: …; …`) for the overlay's :host. */
function overlayThemeCss(staticDir = STATIC_DIR) {
  if (cached && staticDir === STATIC_DIR) return cached;
  const parts = [];
  for (const file of ["vendor/tokens.css", "motion-tokens.css"]) {
    try {
      parts.push(rootBlock(stripComments(fs.readFileSync(path.join(staticDir, file), "utf8"))));
    } catch {
      // A development run before `npm run assets`: the pointer falls back to plain colours.
    }
  }
  const css = parts.join("\n");
  if (staticDir === STATIC_DIR) cached = css;
  return css;
}


module.exports = { overlayThemeCss, rootBlock };
