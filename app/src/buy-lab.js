"use strict";

/* Buy lab: a pasted list, a purchase, and the tracking that follows.
 *
 * One page holds both the flow (buy-lab.html) and, as an overlay, the live
 * picture of the supplier's Chrome (live.js draws it on a canvas). Each
 * supplier runs in its own Chrome (off-screen, rebrowser-playwright) behind
 * that overlay: frames come over Page.startScreencast, the person's input
 * goes back over the DevTools Input domain, and the purchase itself is driven
 * by the same Runner as the supplier windows (buy-lab-flow.js).
 *
 * The overlay is shown only when the shop stops for the person (a security
 * check, a sign-in) or when they ask for it. */

const { BaseWindow, WebContentsView, ipcMain } = require("electron");
const path = require("node:path");

const { browserChoices } = require("./automation/browser");
const { SITES } = require("./automation/sites");
const { BuyLabFlow } = require("./buy-lab-flow");
const { LiveBrowser } = require("./live-browser");

const BACKGROUND = "#0f1418";
const LAB_SITES = ["digikey", "mouser", "lcsc"];

/** the page's contents -> BuyLabWindow */
const byContents = new WeakMap();


class BuyLabWindow {
  static async create(options) {
    const window = new BuyLabWindow(options);
    await window.start();
    return window;
  }

  constructor({ language, pageUrl, pagePreload, partition, userDataDir, downloadsPath, openExternal, onClosed }) {
    this.language = language;
    this.openExternal = openExternal;
    this.downloadsPath = downloadsPath;
    this.userDataDir = userDataDir;
    this.onClosed = onClosed;
    this.closed = false;
    this.active = null;
    this.view = "flow";
    this.lives = new Map();
    this.opening = new Map();
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

    this.page = new WebContentsView({
      webPreferences: {
        partition,
        preload: pagePreload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        navigateOnDragDrop: false,
      },
    });
    byContents.set(this.page.webContents, this);
    this.window.contentView.addChildView(this.page);

    this.flowState = new BuyLabFlow({
      sites: this.sites,
      getLive: (id) => this.lives.get(id),
      onChange: (state) => this.publishFlow(state),
    });

    this.page.webContents.on("did-finish-load", () => {
      this.page.webContents.send("buy-lab:view", this.view);
      this.publishFlow(this.flowState.state());
    });
    void this.page.webContents.loadURL(pageUrl);

    this.layout();
    this.window.on("resize", () => this.layout());
    this.window.on("closed", () => { void this.close(); });
    this.window.show();
  }

  async start() {
    // Only the first supplier starts with the window; the others start when
    // the person picks them, so three Chromes never open at once (shops
    // notice that, and a blocked shop costs time).
    await this.ensureSite(this.sites[0]?.id);
    return this;
  }

  /** The supplier's Chrome, started now if it isn't running yet. */
  async ensureSite(id) {
    if (!id) return null;
    if (this.lives.has(id)) return this.lives.get(id);
    const site = this.sites.find((entry) => entry.id === id);
    if (!site) return null;
    const pending = this.opening.get(id);
    if (pending) return pending;
    const opening = this.openSite(site).finally(() => this.opening.delete(id));
    this.opening.set(id, opening);
    return opening;
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
    if (this.closed || this.view !== "live" || id !== this.active) return;
    if (this.page.webContents.isDestroyed()) return;
    this.page.webContents.send("live:frame", frame);
  }

  setLoading(id, loading) {
    this.loading.set(id, loading);
    if (this.closed || this.page.webContents.isDestroyed()) return;
    this.page.webContents.send("buy-lab:loading", { id, loading });
  }

  layout() {
    if (this.window.isDestroyed()) return;
    const { width, height } = this.window.getContentBounds();
    this.page.setBounds({ x: 0, y: 0, width, height });
  }

  showView(name) {
    if (this.closed) return;
    this.view = name === "live" ? "live" : "flow";
    if (!this.page.webContents.isDestroyed()) this.page.webContents.send("buy-lab:view", this.view);
    if (this.view === "live") {
      const id = this.flowState.supplier || this.active;
      if (id && this.lives.has(id)) {
        this.active = id;
        const frame = this.lastFrame.get(id);
        if (frame && !this.page.webContents.isDestroyed()) this.page.webContents.send("live:frame", frame);
        void this.lives.get(id).refresh();
      }
      this.page.webContents.focus();
    }
  }

  publishFlow(state) {
    if (this.closed) return;
    if (!this.page.webContents.isDestroyed()) this.page.webContents.send("buy-lab:flow", state);
    if (state.status === "waiting" && !state.confirm) this.showView("live");
  }

  select(id) {
    if (!this.sites.some((site) => site.id === id)) return false;
    this.active = id;
    // Picking a supplier starts its Chrome now, in the background.
    void this.ensureSite(id).catch(() => {});
    return true;
  }

  async startPurchase({ supplier, text }) {
    await this.ensureSite(supplier);
    if (!this.lives.has(supplier)) throw new Error("The supplier page did not start");
    this.active = supplier;
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
    if (!this.page.webContents.isDestroyed()) this.page.webContents.close();
    if (!this.window.isDestroyed()) this.window.destroy();
    this.onClosed?.(this);
  }
}


function registerBuyLabIpc() {
  const ownerOf = (event) => {
    const owner = byContents.get(event.sender);
    if (!owner || event.senderFrame?.parent) return null;
    return owner;
  };

  ipcMain.handle("buy-lab:state", (event) => {
    const owner = ownerOf(event);
    return owner ? owner.flowState.state() : null;
  });
  ipcMain.handle("buy-lab:start", (event, payload) => {
    const owner = ownerOf(event);
    if (!owner) return false;
    const { supplier, text } = payload && typeof payload === "object" ? payload : {};
    return owner.startPurchase({ supplier: String(supplier || ""), text: String(text || "") }).catch((error) => {
      owner.publishFlow({ ...owner.flowState.state(), status: "failed", message: error.message });
      return false;
    });
  });
  ipcMain.handle("buy-lab:stop", (event) => ownerOf(event)?.stop() ?? false);
  ipcMain.handle("buy-lab:confirm", (event) => ownerOf(event)?.confirm() ?? false);
  ipcMain.handle("buy-lab:select", (event, id) => ownerOf(event)?.select(String(id)) ?? false);
  ipcMain.handle("buy-lab:show-live", (event) => {
    const owner = ownerOf(event);
    if (!owner) return false;
    owner.showView("live");
    return true;
  });
  ipcMain.handle("buy-lab:show-flow", (event) => {
    const owner = ownerOf(event);
    if (!owner) return false;
    owner.showView("flow");
    return true;
  });
  ipcMain.handle("buy-lab:reload", (event) => ownerOf(event)?.reload() ?? false);
  ipcMain.handle("buy-lab:open-external", (event) => ownerOf(event)?.openActiveExternal() ?? false);
  ipcMain.handle("live:input", (event, payload) => {
    const owner = ownerOf(event);
    if (!owner) return false;
    return owner.input(payload && typeof payload === "object" ? payload : {});
  });
  ipcMain.handle("live:reload", (event) => ownerOf(event)?.reload() ?? false);
}


module.exports = { BuyLabWindow, registerBuyLabIpc };
