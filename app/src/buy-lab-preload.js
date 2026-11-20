"use strict";

/* The Buy lab page's only bridge: the list starts a purchase, the page
 * follows its states, a confirmation is the person's click, and the live
 * overlay sends the person's input to the supplier's Chrome. Nothing else
 * reaches the app. */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("buyLab", {
  state: () => ipcRenderer.invoke("buy-lab:state"),
  start: (payload) => ipcRenderer.invoke("buy-lab:start", payload),
  // Per supplier: stop(id) (every supplier without one), confirm(id), showLive(id).
  stop: (id = "") => ipcRenderer.invoke("buy-lab:stop", String(id)),
  confirm: (id) => ipcRenderer.invoke("buy-lab:confirm", String(id)),
  // The cart check before checkout, and going on after an interruption.
  confirmCart: (id) => ipcRenderer.invoke("buy-lab:confirm-cart", String(id)),
  recheckCart: (id) => ipcRenderer.invoke("buy-lab:recheck-cart", String(id)),
  resume: (id) => ipcRenderer.invoke("buy-lab:resume", String(id)),
  select: (id) => ipcRenderer.invoke("buy-lab:select", String(id)),
  showLive: (id = "") => ipcRenderer.invoke("buy-lab:show-live", String(id)),
  showFlow: () => ipcRenderer.invoke("buy-lab:show-flow"),
  reload: () => ipcRenderer.invoke("buy-lab:reload"),
  openExternal: () => ipcRenderer.invoke("buy-lab:open-external"),
  // The address book: saved shipping addresses on this computer.
  addresses: () => ipcRenderer.invoke("buy-lab:addresses"),
  saveAddress: (address) => ipcRenderer.invoke("buy-lab:save-address", address),
  deleteAddress: (id) => ipcRenderer.invoke("buy-lab:delete-address", String(id)),
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
  // The supplier Chrome's tabs: { viewing, tabs: [{ id, title, url, main }] }.
  onTabs: (callback) => {
    ipcRenderer.on("live:tabs", (_event, state) => callback(state));
  },
  selectTab: (id) => ipcRenderer.invoke("live:select-tab", Number(id) || 0),
  closeTab: (id) => ipcRenderer.invoke("live:close-tab", Number(id) || 0),
});
