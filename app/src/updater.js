"use strict";

/* Updates from the feed the build was published with (electron-builder writes
 * it to resources/app-update.yml): by default the public releases repository
 * O2TechAI/bom-desktop-releases, or BOM_DESKTOP_UPDATE_URL. A build without a
 * feed never checks. The app checks ten seconds after start, every six
 * hours, and whenever Settings → Version on the BOM site asks.
 *
 * - Windows (and a signed Mac build): the update downloads in the background
 *   and installs when the app quits; the person may restart now.
 * - An unsigned Mac build cannot install updates itself (macOS only accepts
 *   signed ones), so it offers the new installer for this Mac to download.
 *
 * Without a dialog when the check came from Settings: the page shows it. */

const fs = require("node:fs");
const path = require("node:path");

const FIRST_CHECK_DELAY_MS = 10 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;


/** The few fields of app-update.yml the app needs. */
function readFeed(text) {
  const feed = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^(provider|owner|repo|url):\s*['"]?([^'"#\s]+)['"]?\s*$/.exec(line);
    if (match) feed[match[1]] = match[2];
  }
  return feed;
}


/** Where this Mac downloads the installer for `version`, or null. */
function macInstallerUrl(feed, version, arch) {
  if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(String(version))) return null;
  const name = `O2-BOM-${version}-${arch === "arm64" ? "arm64" : "x64"}.dmg`;
  if (feed.provider === "github" && /^[\w.-]+$/.test(feed.owner || "") && /^[\w.-]+$/.test(feed.repo || "")) {
    return `https://github.com/${feed.owner}/${feed.repo}/releases/download/v${version}/${name}`;
  }
  if (feed.provider === "generic" && /^https:\/\//.test(feed.url || "")) {
    return new URL(name, feed.url.endsWith("/") ? feed.url : `${feed.url}/`).toString();
  }
  return null;
}


/* What the BOM site's Settings → Version tab sees (preload `updates`):
 *   off          this build has no feed (or runs unpackaged)
 *   idle         not checked yet
 *   checking     asking the feed
 *   current      this is the newest version
 *   downloading  `version` is downloading, `percent` done (Windows, signed Mac)
 *   ready        `version` is downloaded; install() restarts into it
 *   available    `version` is out; install() opens its installer (unsigned Mac)
 *   failed       the last check or download failed
 * Plain data only: it crosses to the page. */
const STATES = ["off", "idle", "checking", "current", "downloading", "ready", "available", "failed"];


function startUpdater({
  app, dialog, shell, t, signedMac = false, log = console,
  platform = process.platform, arch = process.arch,
  feed: givenFeed = null, autoUpdater: givenUpdater = null, now = () => Date.now(),
}) {
  const listeners = new Set();
  let status = { state: "off", current: app.getVersion(), version: "", percent: null, checkedAt: null };
  const set = (change) => {
    status = { ...status, ...change };
    for (const listener of listeners) {
      try { listener(status); } catch (error) { log.warn?.(`Update listener failed: ${error.message}`); }
    }
  };
  const controller = {
    status: () => status,
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    check: async () => status,
    install: async () => false,
  };

  let feed = givenFeed;
  if (!feed) {
    if (!app.isPackaged || process.env.BOM_DESKTOP_DISABLE_UPDATES === "1") return controller;
    const feedFile = path.join(process.resourcesPath, "app-update.yml");
    if (!fs.existsSync(feedFile)) return controller;
    feed = readFeed(fs.readFileSync(feedFile, "utf8"));
  }
  const autoUpdater = givenUpdater || require("electron-updater").autoUpdater;
  const offerInstaller = platform === "darwin" && !signedMac;
  autoUpdater.autoDownload = !offerInstaller;
  autoUpdater.autoInstallOnAppQuit = !offerInstaller;
  autoUpdater.logger = log;
  set({ state: "idle" });

  // Ask once per version per run, and never two dialogs at once. A check the
  // person started from Settings answers there, so it asks no dialog.
  const asked = new Set();
  let asking = false;
  let fromPage = false;
  async function ask(version, options, onYes) {
    if (fromPage) asked.add(version);
    if (asking || asked.has(version)) return;
    asked.add(version);
    asking = true;
    try {
      const { response } = await dialog.showMessageBox({
        type: "info",
        buttons: options.buttons,
        defaultId: 0,
        cancelId: 1,
        title: "O2 BOM",
        message: options.message,
        detail: options.detail,
      });
      if (response === 0) await onYes();
    } catch (error) {
      log.warn?.(`Update dialog failed: ${error.message}`);
    } finally {
      asking = false;
    }
  }

  const fill = (text, version) => text.replace("{version}", version);
  const installerUrl = (version) => macInstallerUrl(feed, version, arch);
  const install = async () => {
    if (status.state === "ready") {
      autoUpdater.quitAndInstall();
      return true;
    }
    const url = status.state === "available" ? installerUrl(status.version) : null;
    if (!url) return false;
    await shell.openExternal(url);
    return true;
  };

  autoUpdater.on("checking-for-update", () => set({ state: "checking", percent: null }));
  autoUpdater.on("update-not-available", () => set({ state: "current", version: "", percent: null, checkedAt: now() }));
  autoUpdater.on("update-available", (info) => {
    if (offerInstaller) {
      if (!installerUrl(info.version)) {
        set({ state: "failed", version: "", percent: null, checkedAt: now() });
        return;
      }
      set({ state: "available", version: info.version, percent: null, checkedAt: now() });
      void ask(info.version, {
        buttons: [t("update_download"), t("update_later")],
        message: fill(t("update_available_title"), info.version),
        detail: t("update_available_body"),
      }, install);
    } else {
      set({ state: "downloading", version: info.version, percent: 0, checkedAt: now() });
    }
  });
  autoUpdater.on("download-progress", (progress) => {
    if (status.state !== "downloading") return;
    const percent = Math.max(0, Math.min(100, Math.floor(Number(progress?.percent) || 0)));
    if (percent !== status.percent) set({ percent });
  });
  autoUpdater.on("update-downloaded", (info) => {
    set({ state: "ready", version: info.version, percent: null });
    void ask(info.version, {
      buttons: [t("update_restart"), t("update_later")],
      message: fill(t("update_ready_title"), info.version),
      detail: t("update_ready_body"),
    }, install);
  });
  autoUpdater.on("error", (error) => {
    log.warn?.(`Update failed: ${error?.message || error}`);
    // A failed download leaves nothing to install; a failed check says so.
    set({ state: "failed", percent: null, checkedAt: now() });
  });

  // Nothing to ask while one is going, or once a version waits to install.
  const busy = () => ["checking", "downloading", "ready"].includes(status.state);
  const check = async ({ page = false } = {}) => {
    if (busy()) return status;
    fromPage = page;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      log.warn?.(`Update check failed: ${error.message}`);
      if (status.state === "checking" || status.state === "idle") set({ state: "failed", percent: null, checkedAt: now() });
    }
    return status;
  };
  controller.check = () => check({ page: true });
  controller.install = install;

  if (!givenUpdater) {
    setTimeout(() => void check(), FIRST_CHECK_DELAY_MS).unref?.();
    setInterval(() => void check(), CHECK_INTERVAL_MS).unref?.();
  }
  return controller;
}


module.exports = { STATES, macInstallerUrl, readFeed, startUpdater };
