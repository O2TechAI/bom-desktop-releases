"use strict";

/* A stand-in feed for an unpackaged app, so Settings → Version can be seen in
 * every state without publishing: BOM_DESKTOP_FAKE_UPDATE=0.0.9 makes a check
 * find 0.0.9 and download it in a few steps; "none" finds nothing new, and
 * "fail" fails. main.js uses it only when the app is not packaged. */

const { EventEmitter } = require("node:events");


function fakeUpdater(version, { step = 400 } = {}) {
  const updater = new EventEmitter();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  updater.quitAndInstall = () => updater.emit("quit-and-install");
  updater.checkForUpdates = async () => {
    updater.emit("checking-for-update");
    await wait(step * 2);
    if (version === "fail") {
      updater.emit("error", new Error("The update feed could not be reached"));
      throw new Error("The update feed could not be reached");
    }
    if (version === "none") {
      updater.emit("update-not-available", {});
      return null;
    }
    updater.emit("update-available", { version });
    if (updater.autoDownload === false) return { updateInfo: { version } };
    void (async () => {
      for (const percent of [12, 37, 64, 88, 100]) {
        await wait(step);
        updater.emit("download-progress", { percent });
      }
      updater.emit("update-downloaded", { version });
    })();
    return { updateInfo: { version } };
  };
  return updater;
}


module.exports = { fakeUpdater };
