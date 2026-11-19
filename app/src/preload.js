"use strict";

/* What the BOM site learns about the desktop app: that it runs in it, on
 * which platform, at which version, and two capabilities: opening a supplier
 * window (the site's supplier links) and its updates (Settings → Version: the
 * status, check now, install). main.js answers them only for the BOM site's
 * own top frame. Add a capability here only with an IPC handler that checks
 * the sender the same way. */

const { contextBridge, ipcRenderer } = require("electron");

const versionArg = process.argv.find((arg) => arg.startsWith("--bom-desktop-version="));

contextBridge.exposeInMainWorld("o2Desktop", Object.freeze({
  platform: process.platform,
  version: versionArg ? versionArg.slice("--bom-desktop-version=".length) : "",
  openSupplier: (id) => ipcRenderer.invoke("desktop:open-supplier", String(id)),
  updates: Object.freeze({
    status: () => ipcRenderer.invoke("desktop:update-status"),
    check: () => ipcRenderer.invoke("desktop:update-check"),
    install: () => ipcRenderer.invoke("desktop:update-install"),
    /** Calls `listener(status)` on every change; returns a function that stops it. */
    onChange: (listener) => {
      const forward = (_event, status) => listener(status);
      ipcRenderer.on("desktop:update-status", forward);
      return () => ipcRenderer.removeListener("desktop:update-status", forward);
    },
  }),
}));
