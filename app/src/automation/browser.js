"use strict";

/* The supplier's own browser, and where its two windows go.
 *
 * A shop should meet a browser a person could have opened themselves, so a
 * supplier window is the person's installed Chrome (or Edge) driven by the
 * rebrowser-patched Playwright, not Electron's Chromium. This module holds
 * the parts that need no I/O: which browser to use, where a supplier's
 * profile lives, and the rectangles of the site window and its panel.
 *
 * The site window is Chrome's, on the left. The panel the app draws is an
 * Electron window docked at its right edge (see window.js). */

const path = require("node:path");

/* Wide enough for a cart table; the panel is what is left. */
const PANEL_WIDTH = 400;
const WINDOW_GAP = 8;
const MIN_SITE_WIDTH = 720;

/* Standard install locations, per platform. `%NAME%` is read from the
 * environment (Program Files differs between 64- and 32-bit hosts). */
const WINDOWS_PATHS = {
  chrome: [
    "%PROGRAMFILES%/Google/Chrome/Application/chrome.exe",
    "%PROGRAMFILES(X86)%/Google/Chrome/Application/chrome.exe",
    "%LOCALAPPDATA%/Google/Chrome/Application/chrome.exe",
  ],
  msedge: [
    "%PROGRAMFILES(X86)%/Microsoft/Edge/Application/msedge.exe",
    "%PROGRAMFILES%/Microsoft/Edge/Application/msedge.exe",
    "%LOCALAPPDATA%/Microsoft/Edge/Application/msedge.exe",
  ],
};
const LINUX_PATHS = {
  chrome: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
  msedge: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
};

/* The order we prefer: a real Chrome, then Edge (same engine, also not
 * Electron). */
const CHANNELS = ["chrome", "msedge"];


function pathTable(platform, env) {
  const mac = {
    chrome: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      `${env.HOME || ""}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ],
    msedge: [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      `${env.HOME || ""}/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`,
    ],
  };
  const table = platform === "darwin" ? mac : platform === "win32" ? WINDOWS_PATHS : LINUX_PATHS;
  const resolve = (entry) => entry.replace(/%([A-Z0-9_()]+)%/gi, (_match, name) => env[name] || "");
  return Object.fromEntries(Object.entries(table).map(([channel, paths]) => [channel, paths.map(resolve).filter(Boolean)]));
}


function executableFor(channel, { platform = process.platform, env = process.env, exists = (file) => require("node:fs").existsSync(file) } = {}) {
  const paths = pathTable(platform, env)[channel] || [];
  return paths.find((file) => exists(file)) || null;
}


/** Which browsers this computer can give a supplier window, in preference order.
 * `BOM_DESKTOP_SUPPLIER_BROWSER` overrides: a channel name ("chrome",
 * "msedge") or a path to a Chromium-based browser. */
function browserChoices({ platform = process.platform, env = process.env, exists } = {}) {
  const override = String(env.BOM_DESKTOP_SUPPLIER_BROWSER || "").trim();
  if (override) {
    if (CHANNELS.includes(override)) return [{ channel: override }];
    return exists && exists(override) === false ? [] : [{ executablePath: override }];
  }
  return CHANNELS
    .map((channel) => ({
      channel,
      executablePath: executableFor(channel, { platform, env, ...(exists ? { exists } : {}) }),
    }))
    .filter((choice) => choice.executablePath)
    .map(({ channel }) => ({ channel }));
}


/** The Chrome profile of one supplier: its own cookies and sign-in, kept
 * apart from every other supplier and from the BOM site. */
function profileDir(userData, supplierId) {
  if (!/^[a-z0-9-]+$/.test(supplierId)) throw new Error(`Bad supplier id ${supplierId}`);
  return path.join(userData, "suppliers", supplierId, "chrome");
}


/** The site window: everything left of the panel. */
function launchBounds(workArea) {
  const width = Math.max(MIN_SITE_WIDTH, workArea.width - PANEL_WIDTH - WINDOW_GAP);
  return {
    left: Math.round(workArea.x),
    top: Math.round(workArea.y),
    width: Math.round(width),
    height: Math.round(workArea.height),
  };
}


/** Where the panel sits for a given site-window rectangle: at its right edge,
 * kept inside the work area. A maximized site window puts the panel over its
 * right edge rather than off-screen. */
function panelBounds(chrome, workArea) {
  const width = Math.min(PANEL_WIDTH, Math.max(0, workArea.width - WINDOW_GAP));
  const height = Math.min(chrome.height || workArea.height, workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  return {
    x: Math.round(Math.min(maxX, Math.max(workArea.x, chrome.left + chrome.width + WINDOW_GAP))),
    y: Math.round(Math.min(maxY, Math.max(workArea.y, chrome.top))),
    width: Math.round(width),
    height: Math.round(Math.max(0, height)),
  };
}


module.exports = {
  CHANNELS,
  MIN_SITE_WIDTH,
  PANEL_WIDTH,
  WINDOW_GAP,
  browserChoices,
  executableFor,
  launchBounds,
  panelBounds,
  profileDir,
};
