"use strict";

/* Reopen the window where it was left, if that place is still on a screen. */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BOUNDS = { width: 1440, height: 900 };
const MIN_SIZE = { width: 960, height: 640 };


function loadWindowState(directory, displays) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(directory, "window-state.json"), "utf8"));
    const { x, y, width, height } = saved;
    if (![x, y, width, height].every(Number.isFinite)) throw new Error("incomplete");
    const visible = displays.some(({ workArea: area }) =>
      x < area.x + area.width && x + width > area.x && y < area.y + area.height && y + height > area.y);
    if (!visible) throw new Error("off screen");
    return {
      bounds: { x, y, width: Math.max(width, MIN_SIZE.width), height: Math.max(height, MIN_SIZE.height) },
      maximized: saved.maximized === true,
    };
  } catch {
    return { bounds: { ...DEFAULT_BOUNDS }, maximized: false };
  }
}


function saveWindowState(directory, window) {
  try {
    const bounds = window.getNormalBounds();
    fs.writeFileSync(
      path.join(directory, "window-state.json"),
      JSON.stringify({ ...bounds, maximized: window.isMaximized() }),
    );
  } catch {
    // A window that cannot remember its place still opens at the default size.
  }
}


module.exports = { DEFAULT_BOUNDS, MIN_SIZE, loadWindowState, saveWindowState };
