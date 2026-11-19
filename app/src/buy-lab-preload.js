"use strict";

/* The Buy lab flow page's only bridge: the list starts a purchase, the page
 * follows its states, and a confirmation is the person's click. Nothing else
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
});
