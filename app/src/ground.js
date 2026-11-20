"use strict";

/* The window's ground colour.
 *
 * The site picks its own ground per theme (`--page`), and the desktop window
 * used to paint one fixed grey before the page arrived. That grey is correct
 * for the default theme only; on the dark or eco theme it flashes the wrong
 * colour at every launch. The last ground the site reported is remembered
 * here, so the next launch starts in the right colour and the wrapper follows
 * the theme while the app runs. */

const fs = require("node:fs");
const path = require("node:path");

const FALLBACK = "#ecf0f3";
const FILE = "ground.txt";

/** "#AABBCC" (the only form the site's tokens use) or null. */
function validGround(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : null;
}

function readGround(dir) {
  try {
    return validGround(fs.readFileSync(path.join(dir, FILE), "utf8")) || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

function writeGround(dir, value) {
  const ground = validGround(value);
  if (!ground) return false;
  try {
    fs.writeFileSync(path.join(dir, FILE), ground);
    return true;
  } catch {
    return false;
  }
}


module.exports = { FALLBACK, validGround, readGround, writeGround };
