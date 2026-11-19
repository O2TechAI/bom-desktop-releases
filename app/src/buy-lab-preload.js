"use strict";

/* The Buy lab page's only bridge: the list starts a purchase, the page
 * follows its states, a confirmation is the person's click, and the live
 * overlay sends the person's input to the supplier's Chrome. Nothing else
 * reaches the app. */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("buyLab", {
  state: () => ipcRenderer.invoke("buy-lab:state"),
  start: (payload) => ipcRenderer.invoke("buy-lab:start", payload),
  stop: () => ipcRenderer.invoke("buy-lab:stop"),
  confirm: () => ipcRenderer.invoke("buy-lab:confirm"),
  select: (id) => ipcRenderer.invoke("buy-lab:select", String(id)),
  showLive: () => ipcRenderer.invoke("buy-lab:show-live"),
  showFlow: () => ipcRenderer.invoke("buy-lab:show-flow"),
  reload: () => ipcRenderer.invoke("buy-lab:reload"),
  openExternal: () => ipcRenderer.invoke("buy-lab:open-external"),
  onFlow: (callback) => {
    ipcRenderer.on("buy-lab:flow", (_event, state) => callback(state));
  },
  onLoading: (callback) => {
    ipcRenderer.on("buy-lab:loading", (_event, state) => callback(state));
  },
  onView: (callback) => {
    ipcRenderer.on("buy-lab:view", (_event, view) => callback(String(view)));
  },
  onFrame: (callback) => {
    ipcRenderer.on("live:frame", (_event, frame) => callback(frame));
  },
  input: (event) => ipcRenderer.invoke("live:input", event),
});

/* live.js draws the overlay; this is the bridge it expects. */
contextBridge.exposeInMainWorld("liveBridge", {
  onFrame: (callback) => {
    ipcRenderer.on("live:frame", (_event, frame) => callback(frame));
  },
  input: (event) => ipcRenderer.invoke("live:input", event),
  reload: () => ipcRenderer.invoke("live:reload"),
  back: () => ipcRenderer.invoke("buy-lab:show-flow"),
});
