"use strict";

/* Buy lab: a pasted list, a purchase, and the tracking that follows.
 *
 * The window has two pages. The flow page (buy-lab.html) is the list and its
 * states; the live page (live.html) is a real Chrome drawn as a picture and
 * is only shown when the shop stops for the person (a security check, a
 * sign-in) or when they ask for it.
 *
 * Each supplier runs in its own Chrome (off-screen, rebrowser-playwright)
 * behind the live page: frames come over Page.startScreencast, the person's
 * input goes back over the DevTools Input domain, and the purchase itself is
 * driven by the same Runner as the supplier windows (buy-lab-flow.js). */

const { BaseWindow, WebContentsView, ipcMain } = require("electron");
const path = require("node:path");

const { browserChoices } = require("./automation/browser");
const { SITES } = require("./automation/sites");
const { BuyLabFlow } = require("./buy-lab-flow");
const { LiveBrowser } = require("./live-browser");

const BACKGROUND = "#0f1418";
const LAB_SITES = ["digikey", "mouser", "lcsc"];

/** flow page or live page contents -> BuyLabWindow */
const byContents = new WeakMap();


class BuyLabWindow {
  static async create(options) {
    const window = new BuyLabWindow(options);
    await window.start();
    return window;
  }

  constructor({ language, flowUrl, flowPreload, pageUrl, pagePreload, partition, userDataDir, downloadsPath, openExternal, onClosed }) {
    this.language = language;
    this.openExternal = openExternal;
    this.downloadsPath = downloadsPath;
    this.userDataDir = userDataDir;
    this.onClosed = onClosed;
    this.closed = false;
    this.active = null;
    this.view = "flow";
    this.lives = new Map();
    this.lastFrame = new Map();
    this.loading = new Map();
    this.sites = SITES.filter((site) => LAB_SITES.includes(site.id));

    this.window = new BaseWindow({
      width: 1280,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      title: "O2 BOM - Buy lab",
      backgroundColor: BACKGROUND,
      autoHideMenuBar: process.platform !== "darwin",
    });

    this.flow = this.makeView(flowPreload, partition);
    this.canvas = this.makeView(pagePreload, partition);
    byContents.set(this.flow.webContents, this);
    byContents.set(this.canvas.webContents, this);
    this.window.contentView.addChildView(this.flow);
    this.window.contentView.addChildView(this.canvas);

    this.flowState = new BuyLabFlow({
      sites: this.sites,
      getLive: (id) => this.lives.get(id),
      onChange: (state) => this.publishFlow(state),
    });

    this.flow.webContents.on("did-finish-load", () => {
      this.publishFlow(this.flowState.state());
      this.showView("flow");
    });
    void this.flow.webContents.loadURL(flowUrl);
    void this.canvas.webContents.loadURL(pageUrl);

    this.layout();
    this.window.on("resize", () => this.layout());
    this.window.on("closed", () => { void this.close(); });
    this.window.show();
  }

  makeView(preload, partition) {
    return new WebContentsView({
      webPreferences: {
        partition,
        preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        navigateOnDragDrop: false,
      },
    });
  }

  async start() {
    await Promise.all(this.sites.map((site) => this.openSite(site)));
    return this;
  }

  async openSite(site) {
    const live = await LiveBrowser.open({
      profile: site,
      profilePath: path.join(this.userDataDir, "buy-lab", site.id, "chrome"),
      downloadsPath: this.downloadsPath,
      mayGo: site.mayGo,
      challengeMayGo: site.challengeMayGo,
      openExternal: this.openExternal,
      choices: browserChoices(),
      onFrame: (frame) => this.onFrame(site.id, frame),
    });
    this.lives.set(site.id, live);
    live.page.on("request", (request) => {
      if (request.isNavigationRequest()) this.setLoading(site.id, true);
    });
    live.page.on("load", () => this.setLoading(site.id, false));
    if (!this.active) this.active = site.id;
    return live;
  }

  onFrame(id, frame) {
    this.lastFrame.set(id, frame);
    if (this.closed || id !== this.active || this.view !== "live") return;
    if (this.canvas.webContents.isDestroyed()) return;
    this.canvas.webContents.send("live:frame", frame);
  }

  setLoading(id, loading) {
    this.loading.set(id, loading);
    if (this.closed || this.flow.webContents.isDestroyed()) return;
    this.flow.webContents.send("buy-lab:loading", { id, loading });
  }

  layout() {
    if (this.window.isDestroyed()) return;
    const { width, height } = this.window.getContentBounds();
    this.flow.setBounds({ x: 0, y: 0, width, height });
    this.canvas.setBounds({ x: 0, y: 0, width, height });
  }

  showView(name) {
    if (this.closed) return;
    this.view = name === "live" ? "live" : "flow";
    this.flow.setVisible(this.view === "flow");
    this.canvas.setVisible(this.view === "live");
    if (this.view === "live") {
      const id = this.flowState.supplier || this.active;
      if (id && this.lives.has(id)) {
        this.active = id;
        const frame = this.lastFrame.get(id);
        if (frame) this.canvas.webContents.send("live:frame", frame);
        void this.lives.get(id).refresh();
      }
      this.canvas.webContents.focus();
    } else {
      this.flow.webContents.focus();
      this.flow.webContents.send("buy-lab:view", this.view);
    }
    this.flow.webContents.send("buy-lab:view", this.view);
  }

  publishFlow(state) {
    if (this.closed) return;
    if (!this.flow.webContents.isDestroyed()) this.flow.webContents.send("buy-lab:flow", state);
    if (state.status === "waiting" && !state.confirm) this.showView("live");
    else if (["done", "failed", "stopped"].includes(state.status)) this.showView("flow");
  }

  select(id) {
    if (!this.lives.has(id)) return false;
    this.active = id;
    return true;
  }

  async startPurchase({ supplier, text }) {
    await this.flowState.start({ supplier, text });
    return true;
  }

  confirm() {
    return this.flowState.approve();
  }

  stop() {
    this.flowState.stop();
    return true;
  }

  live(id = this.active) {
    const live = this.lives.get(id);
    return live ? { page: live.page, link: live.browser.link, browser: live.browser } : null;
  }

  async input(event) {
    const live = this.lives.get(this.active);
    if (!live) return false;
    return live.input(event);
  }

  openActiveExternal() {
    const live = this.lives.get(this.active);
    const url = live?.page?.url();
    if (!url || !/^https?:/i.test(url)) return false;
    this.openExternal(url);
    return true;
  }

  async reload() {
    const live = this.lives.get(this.active);
    if (!live) return false;
    await live.page.reload().catch(() => {});
    await live.refresh();
    return true;
  }

  focus() {
    if (this.closed) return;
    this.window.show();
    this.window.focus();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.flowState.stop();
    await Promise.all([...this.lives.values()].map((live) => live.close().catch(() => {})));
    this.lives.clear();
    if (!this.flow.webContents.isDestroyed()) this.flow.webContents.close();
    if (!this.canvas.webContents.isDestroyed()) this.canvas.webContents.close();
    if (!this.window.isDestroyed()) this.window.destroy();
    this.onClosed?.(this);
  }
}


function registerBuyLabIpc() {
  const ownerOf = (event, view) => {
    const owner = byContents.get(event.sender);
    if (!owner || event.senderFrame?.parent) return null;
    if (view === "flow" && owner.flow.webContents !== event.sender) return null;
    if (view === "live" && owner.canvas.webContents !== event.sender) return null;
    return owner;
  };

  ipcMain.handle("buy-lab:state", (event) => {
    const owner = ownerOf(event, "flow");
    return owner ? owner.flowState.state() : null;
  });
  ipcMain.handle("buy-lab:start", (event, payload) => {
    const owner = ownerOf(event, "flow");
    if (!owner) return false;
    const { supplier, text } = payload && typeof payload === "object" ? payload : {};
    return owner.startPurchase({ supplier: String(supplier || ""), text: String(text || "") }).catch((error) => {
      owner.publishFlow({ ...owner.flowState.state(), status: "failed", message: error.message });
      return false;
    });
  });
  ipcMain.handle("buy-lab:stop", (event) => {
    const owner = ownerOf(event, "flow");
    return owner ? owner.stop() : false;
  });
  ipcMain.handle("buy-lab:confirm", (event) => {
    const owner = ownerOf(event, "flow");
    return owner ? owner.confirm() : false;
  });
  ipcMain.handle("buy-lab:select", (event, id) => {
    const owner = ownerOf(event, "flow");
    return owner ? owner.select(String(id)) : false;
  });
  ipcMain.handle("buy-lab:show-live", (event) => {
    const owner = ownerOf(event, "flow");
    if (!owner) return false;
    owner.showView("live");
    return true;
  });
  ipcMain.handle("buy-lab:show-flow", (event) => {
    const owner = ownerOf(event, "live");
    if (!owner) return false;
    owner.showView("flow");
    return true;
  });
  ipcMain.handle("buy-lab:reload", (event) => {
    const owner = ownerOf(event, "live");
    return owner ? owner.reload() : false;
  });
  ipcMain.handle("buy-lab:open-external", (event) => {
    const owner = ownerOf(event, "flow") || ownerOf(event, "live");
    return owner ? owner.openActiveExternal() : false;
  });
  ipcMain.handle("live:input", (event, payload) => {
    const owner = ownerOf(event, "live");
    if (!owner) return false;
    return owner.input(payload && typeof payload === "object" ? payload : {});
  });
  ipcMain.handle("live:reload", (event) => {
    const owner = ownerOf(event, "live");
    return owner ? owner.reload() : false;
  });
}


module.exports = { BuyLabWindow, registerBuyLabIpc };
