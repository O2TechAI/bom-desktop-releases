"use strict";

/* The canvas page's only bridge: frames come in, the person's input goes out,
 * and one button goes back to the list. */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("liveBridge", {
  onFrame: (callback) => {
    ipcRenderer.on("live:frame", (_event, frame) => callback(frame));
  },
  input: (event) => ipcRenderer.invoke("live:input", event),
  reload: () => ipcRenderer.invoke("live:reload"),
  back: () => ipcRenderer.invoke("buy-lab:show-flow"),
});
