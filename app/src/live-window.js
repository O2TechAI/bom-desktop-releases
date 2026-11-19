"use strict";

/* A window that shows a real Chrome page as a picture.
 *
 * The page is a separate Chrome (live-browser.js), so the shop sees Chrome,
 * not Electron. This window is only the screen and the input surface: frames
 * arrive as JPEG, the person's mouse and keys are sent back through the
 * DevTools Input domain. */

const { BaseWindow, WebContentsView, ipcMain } = require("electron");

const { browserChoices, profileDir } = require("./automation/browser");
const { LiveBrowser } = require("./live-browser");

const BACKGROUND = "#0f1418";

/** canvas contents -> LiveWindow */
const byContents = new WeakMap();


class LiveWindow {
  /**
   * @param {object} options
   * @param {object} options.profile supplier profile (sites/)
   * @param {string} options.pageUrl the local page with the canvas
   * @param {string} options.preload its preload
   * @param {string} [options.partition] partition that can serve the local page
   * @param {string} options.userDataDir the app's userData for Chrome profiles
   * @param {string} options.downloadsPath
   * @param {(url: string) => void} options.openExternal
   */
  constructor({ profile, pageUrl, preload, partition, userDataDir, downloadsPath, openExternal, onClosed }) {
    this.profile = profile;
    this.userDataDir = userDataDir;
    this.downloadsPath = downloadsPath;
    this.openExternal = openExternal;
    this.onClosed = onClosed;
    this.live = null;
    this.closed = false;
    this.frames = 0;
    this.lastFrame = null;

    this.window = new BaseWindow({
      width: 1280,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      title: `O2 BOM - ${profile.name}`,
      backgroundColor: BACKGROUND,
      autoHideMenuBar: process.platform !== "darwin",
    });

    this.canvas = new WebContentsView({
      webPreferences: {
        ...(partition ? { partition } : {}),
        preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        navigateOnDragDrop: false,
      },
    });
    this.window.contentView.addChildView(this.canvas);
    byContents.set(this.canvas.webContents, this);
    this.layout();
    this.window.on("resize", () => this.layout());
    this.window.on("closed", () => { void this.close(); });
    void this.canvas.webContents.loadURL(pageUrl);
  }

  async start() {
    this.live = await LiveBrowser.open({
      profile: this.profile,
      profilePath: profileDir(this.userDataDir, this.profile.id),
      downloadsPath: this.downloadsPath,
      mayGo: this.profile.mayGo,
      challengeMayGo: this.profile.challengeMayGo,
      openExternal: this.openExternal,
      choices: browserChoices(),
      onFrame: (frame) => {
        this.frames += 1;
        this.lastFrame = frame;
        if (this.closed || this.canvas.webContents.isDestroyed()) return;
        this.canvas.webContents.send("live:frame", frame);
      },
    });
    this.live.onClose = () => { void this.close(); };
    this.window.show();
    return this;
  }

  layout() {
    if (this.window.isDestroyed()) return;
    const { width, height } = this.window.getContentBounds();
    this.canvas.setBounds({ x: 0, y: 0, width, height });
  }

  focus() {
    if (this.closed) return;
    this.window.show();
    this.window.focus();
  }

  async input(event) {
    if (this.live) await this.live.input(event);
    return true;
  }

  async reload() {
    if (!this.live) return false;
    await this.live.page.reload().catch(() => {});
    await this.live.refresh();
    return true;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.live) await this.live.close();
    if (!this.canvas.webContents.isDestroyed()) this.canvas.webContents.close();
    if (!this.window.isDestroyed()) this.window.destroy();
    this.onClosed?.(this);
  }
}


function registerLiveIpc() {
  ipcMain.handle("live:input", (event, payload) => {
    const owner = byContents.get(event.sender);
    if (!owner || event.senderFrame?.parent) return false;
    return owner.input(payload && typeof payload === "object" ? payload : {});
  });
  ipcMain.handle("live:reload", (event) => {
    const owner = byContents.get(event.sender);
    if (!owner) return false;
    return owner.reload();
  });
}


module.exports = { LiveWindow, registerLiveIpc };
