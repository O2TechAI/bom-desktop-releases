"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { MESSAGES } = require("../src/i18n");
const { macInstallerUrl, readFeed } = require("../src/updater");
const config = require("../electron-builder.config.cjs");


test("builds check the public releases repository for updates", () => {
  assert.deepEqual(config.publish, [
    { provider: "github", owner: "O2TechAI", repo: "bom-desktop-releases", releaseType: "release" },
  ]);
  assert.doesNotMatch(config.mac.artifactName, /\s/);
  assert.equal(config.extraMetadata.bomSignedMac, false);
});


test("an unsigned Mac is offered the installer for its own processor", () => {
  const feed = readFeed("owner: O2TechAI\nrepo: bom-desktop-releases\nprovider: github\nreleaseType: release\nupdaterCacheDirName: bom-desktop-updater\n");
  assert.deepEqual(feed, { owner: "O2TechAI", repo: "bom-desktop-releases", provider: "github" });
  assert.equal(
    macInstallerUrl(feed, "0.0.3", "arm64"),
    "https://github.com/O2TechAI/bom-desktop-releases/releases/download/v0.0.3/O2-BOM-0.0.3-arm64.dmg",
  );
  assert.match(macInstallerUrl(feed, "0.0.3", "x64"), /O2-BOM-0\.0\.3-x64\.dmg$/);
  assert.equal(macInstallerUrl(feed, "../../x", "arm64"), null);
  assert.equal(macInstallerUrl({ provider: "github", owner: "a/b", repo: "c" }, "0.0.3", "arm64"), null);
  assert.equal(
    macInstallerUrl(readFeed("provider: generic\nurl: https://example.test/feed\n"), "1.2.0", "x64"),
    "https://example.test/feed/O2-BOM-1.2.0-x64.dmg",
  );
  assert.equal(macInstallerUrl({ provider: "generic", url: "http://example.test/" }, "1.2.0", "x64"), null);
});


test("the update dialogs say everything in every language", () => {
  const keys = Object.keys(MESSAGES.en).filter((key) => key.startsWith("update_"));
  assert.equal(keys.length, 7);
  for (const language of ["zh", "es"]) {
    for (const key of keys) assert.ok(MESSAGES[language][key], `${language} ${key}`);
  }
});


const { EventEmitter } = require("node:events");
const { startUpdater } = require("../src/updater");

const FEED = { provider: "github", owner: "O2TechAI", repo: "bom-desktop-releases" };

function harness({ platform = "win32", result = "download" } = {}) {
  const autoUpdater = new EventEmitter();
  const calls = { dialogs: 0, installs: 0, opened: [] };
  autoUpdater.quitAndInstall = () => { calls.installs += 1; };
  autoUpdater.checkForUpdates = async () => {
    autoUpdater.emit("checking-for-update");
    if (result === "fail") throw new Error("offline");
    if (result === "none") { autoUpdater.emit("update-not-available", {}); return null; }
    autoUpdater.emit("update-available", { version: "0.0.9" });
    return { updateInfo: { version: "0.0.9" } };
  };
  const updater = startUpdater({
    app: { getVersion: () => "0.0.4", isPackaged: true },
    dialog: { showMessageBox: async () => { calls.dialogs += 1; return { response: 1 }; } },
    shell: { openExternal: async (url) => { calls.opened.push(url); } },
    t: (key) => key,
    platform,
    arch: "arm64",
    feed: FEED,
    autoUpdater,
    now: () => 1000,
    log: {},
  });
  const seen = [];
  updater.onChange((status) => seen.push(status.state));
  return { autoUpdater, calls, seen, updater };
}


test("Settings sees a Windows update check, download and install", async () => {
  const { autoUpdater, calls, seen, updater } = harness();
  assert.deepEqual(updater.status(), { state: "idle", current: "0.0.4", version: "", percent: null, checkedAt: null });
  await updater.check();
  assert.equal(updater.status().state, "downloading");
  assert.equal(updater.status().version, "0.0.9");
  autoUpdater.emit("download-progress", { percent: 42.7 });
  assert.equal(updater.status().percent, 42);
  assert.equal(await updater.install(), false, "nothing to install while it downloads");
  autoUpdater.emit("update-downloaded", { version: "0.0.9" });
  assert.equal(updater.status().state, "ready");
  await updater.check();
  assert.equal(updater.status().state, "ready", "a waiting update is not checked over");
  assert.equal(await updater.install(), true);
  assert.equal(calls.installs, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.dialogs, 0, "a check from Settings asks no dialog");
  assert.deepEqual(seen, ["checking", "downloading", "downloading", "ready"]);
});


test("an unsigned Mac is offered its installer from Settings", async () => {
  const { calls, updater } = harness({ platform: "darwin" });
  await updater.check();
  assert.equal(updater.status().state, "available");
  assert.equal(await updater.install(), true);
  assert.deepEqual(calls.opened, ["https://github.com/O2TechAI/bom-desktop-releases/releases/download/v0.0.9/O2-BOM-0.0.9-arm64.dmg"]);
});


test("Settings says when the app is current, or when the check failed", async () => {
  const current = harness({ result: "none" });
  await current.updater.check();
  assert.equal(current.updater.status().state, "current");
  assert.equal(current.updater.status().checkedAt, 1000);
  const failed = harness({ result: "fail" });
  await failed.updater.check();
  assert.equal(failed.updater.status().state, "failed");
  assert.equal(await failed.updater.install(), false);
});


test("a build without a feed says updates are off", async () => {
  const updater = startUpdater({ app: { getVersion: () => "0.0.4", isPackaged: false }, dialog: {}, shell: {}, t: (key) => key });
  assert.equal(updater.status().state, "off");
  assert.equal((await updater.check()).state, "off");
  assert.equal(await updater.install(), false);
});
