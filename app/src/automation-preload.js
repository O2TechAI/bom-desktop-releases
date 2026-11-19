"use strict";

/* The bridge for the supplier window's task panel (static/automation.html),
 * an app page. It can start, pause and stop a task in its own window and
 * hear what the task is doing; the main process ignores these calls from
 * any other page. Supplier sites get no preload at all. */

const { contextBridge, ipcRenderer } = require("electron");

const COMMANDS = new Set(["run", "pause", "resume", "continue", "stop", "confirm", "reveal", "view"]);

contextBridge.exposeInMainWorld("o2Automation", Object.freeze({
  command(name, payload) {
    if (!COMMANDS.has(name)) return Promise.resolve({ ok: false, message: "Unknown command" });
    return ipcRenderer.invoke("automation:command", name, payload);
  },
  onView(callback) {
    ipcRenderer.on("automation:view", (_event, view) => callback(view));
  },
}));
