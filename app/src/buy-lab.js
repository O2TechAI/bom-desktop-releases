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
const { AddressBook, BuyLabFlow, RunStore, siteAddress, siteOrderText } = require("./buy-lab-flow");
const { LiveBrowser } = require("./live-browser");

/* Behind the flow page (its own ground); the live overlay paints dark. */
const BACKGROUND = "#ecf0f3";
const LAB_SITES = ["digikey", "mouser", "lcsc"];

/** the page's contents -> BuyLabWindow */
const byContents = new WeakMap();


class BuyLabWindow {
  static async create(options) {
    const window = new BuyLabWindow(options);
    await window.start();
    return window;
  }

  constructor({ language, pageUrl, pagePreload, partition, userDataDir, downloadsPath, openExternal, onClosed, serviceStatus = null, quiet = false }) {
    this.serviceStatus = serviceStatus;
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
    this.addresses = new AddressBook(userDataDir);
    this.runs = new RunStore(userDataDir);
    /* The lists the BOM site handed over, by supplier, for the page's boxes. */
    this.listTexts = new Map();

    this.window = new BaseWindow({
      width: 1280,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      title: "O2 BOM - Buy lab",
      backgroundColor: BACKGROUND,
      // A purchase BOM hands over opens the lab out of sight: the person
      // follows it on BOM's Placing tab, and the lab comes forward only when
      // a seller needs them (surface()) or they open it.
      show: !quiet,
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

    // One purchase flow per supplier, each driving that supplier's own
    // Chrome: DigiKey and LCSC can run at the same time.
    this.flows = new Map(this.sites.map((site) => [site.id, new BuyLabFlow({
      sites: [site],
      getLive: (id) => this.lives.get(id),
      onChange: (state) => this.publishFlow(site.id, state),
      onChallenge: (open) => this.onChallenge(site.id, open),
      store: this.runs,
    })]));

    this.page.webContents.on("did-finish-load", () => {
      this.page.webContents.send("buy-lab:view", this.view);
      this.publish();
    });
    void this.page.webContents.loadURL(pageUrl);

    this.layout();
    this.window.on("resize", () => this.layout());
    this.window.on("closed", () => { void this.close(); });
    if (!quiet) this.window.show();
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
      onTabs: (tabs) => this.onTabs(site.id, tabs),
    });
    this.lives.set(site.id, live);
    // A page elsewhere (a sign-in with Google) opened in its own tab: that
    // is where the person has something to do, so show it (unless they are
    // busy on the other supplier's page).
    live.browser.on("tab-opened", () => this.showFor(site.id));
    live.page.on("request", (request) => {
      if (request.isNavigationRequest()) this.setLoading(site.id, true);
    });
    live.page.on("load", () => this.setLoading(site.id, false));
    if (!this.active) this.active = site.id;
    return live;
  }

  /** Give the person Chrome itself for a security check, then take it back. */
  onChallenge(id, open) {
    const live = this.lives.get(id);
    if (!live) return;
    if (open) void live.handToPerson?.();
    else void live.backFromPerson?.();
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

  /** The tabs of a supplier's Chrome, for the live view's tab bar. */
  onTabs(id, tabs) {
    if (this.closed || id !== this.active || this.page.webContents.isDestroyed()) return;
    this.page.webContents.send("live:tabs", tabs);
  }

  layout() {
    if (this.window.isDestroyed()) return;
    const { width, height } = this.window.getContentBounds();
    this.page.setBounds({ x: 0, y: 0, width, height });
  }

  /** The list, or the live page of one supplier (`id`, else the active one). */
  showView(name, id = this.active) {
    if (this.closed) return;
    this.view = name === "live" ? "live" : "flow";
    if (this.view === "live" && id && this.lives.has(id)) this.active = id;
    if (!this.page.webContents.isDestroyed()) {
      this.page.webContents.send("buy-lab:view", this.view);
      this.publish();
    }
    if (this.view === "live") {
      const id = this.active;
      if (id && this.lives.has(id)) {
        this.active = id;
        const frame = this.lastFrame.get(id);
        if (frame && !this.page.webContents.isDestroyed()) this.page.webContents.send("live:frame", frame);
        if (!this.page.webContents.isDestroyed()) this.page.webContents.send("live:tabs", this.lives.get(id).tabs());
        void this.lives.get(id).refresh();
      }
      if (this.window.isVisible()) this.page.webContents.focus();
    }
  }

  /** Every supplier's flow, for the page: { sites, flows: { id: state }, active, view }. */
  state() {
    return {
      sites: this.sites.map((site) => ({ id: site.id, name: site.name })),
      flows: Object.fromEntries([...this.flows].map(([id, flow]) => [id, flow.state()])),
      lists: Object.fromEntries(this.listTexts),
      active: this.active,
      view: this.view,
      // BOM's purchasing service, as its last call answered.
      service: this.serviceStatus?.() || null,
      // A purchase that was interrupted, saved on this computer: it can go on
      // even after the app was closed.
      saved: Object.fromEntries(this.sites.map((site) => {
        const record = this.runs.load(site.id);
        return [site.id, record ? { progress: record.progress, savedAt: record.savedAt, rehearsal: Boolean(record.rehearsal) } : null];
      })),
    };
  }

  publish() {
    if (this.closed || this.page.webContents.isDestroyed()) return;
    this.page.webContents.send("buy-lab:flow", this.state());
  }

  publishFlow(id, state) {
    if (this.closed) return;
    this.publish();
    // A check is handed to Chrome's own window (onChallenge); the canvas is
    // only for sign-ins and refusals that the person handles in the app,
    // shown for the supplier that is waiting.
    if (state.status === "waiting" && !state.confirm && state.message !== "challenge") this.showFor(id);
  }

  /** Show a supplier's live page because it needs the person, without taking
   * the screen from the other supplier's page while the person is on it: the
   * waiting supplier's tab is marked instead (the page has the states). */
  showFor(id, { quiet = false } = {}) {
    if (this.view === "live" && this.active && this.active !== id) {
      this.publish();
      if (!quiet) this.surface();
      return;
    }
    this.showView("live", id);
    if (!quiet) this.surface();
  }

  /** A lab out of sight that needs the person: shown without taking the
   * keyboard from what they are doing, and flashed in the taskbar / Dock. */
  surface() {
    if (this.closed || this.window.isVisible()) return;
    this.window.showInactive();
    this.window.flashFrame(true);
  }

  /** The seller's own page (the cart the lab filled), in front: BOM's
   * "Deal with it". False when this lab has no page for that seller. */
  openSellerPage(id) {
    if (this.closed || !this.lives.has(id)) return false;
    this.showView("live", id);
    this.focus();
    return true;
  }

  /** A purchase that could not start: shown on that supplier's panel. */
  failStart(id, message) {
    const flow = this.flows.get(id);
    if (flow && !flow.running) flow.emit({ status: "failed", message });
  }

  select(id) {
    if (!this.sites.some((site) => site.id === id)) return false;
    this.active = id;
    // Picking a supplier starts its Chrome now, in the background.
    void this.ensureSite(id).catch(() => {});
    return true;
  }

  /** The BOM site's Buying hands over its orders ({ orders: [{ supplier,
   * lines: [{ part, quantity }] }], address, reference }): each supplier this
   * lab has starts at once with its list and the site's ship-to address.
   * Answers when they have started, not when they end; the person follows
   * them here, and every stop that is theirs (a sign-in, payment, the order's
   * yes) stays theirs. */
  startFromSite(payload = {}) {
    const orders = Array.isArray(payload.orders) ? payload.orders : [];
    let address = null;
    let addressNote = null;
    try {
      address = siteAddress(payload.address);
    } catch (error) {
      addressNote = error.message; // the forms stay the person's
    }
    const started = [];
    const skipped = [];
    for (const order of orders) {
      const supplier = String(order?.supplier || "");
      const text = siteOrderText(order);
      const flow = this.flows.get(supplier);
      if (!flow || !text || flow.running) {
        skipped.push({ supplier, reason: !flow ? "unknown_supplier" : !text ? "no_lines" : "busy" });
        continue;
      }
      started.push(supplier);
      this.listTexts.set(supplier, text);
      void this.startPurchase({ supplier, text, address }).catch((error) => this.failStart(supplier, error.message));
    }
    this.publish();
    this.focus();
    return { ok: started.length > 0, started, skipped, addressUsed: Boolean(address), addressNote };
  }

  /** A purchase the Buy lab service handed this desktop (buy-service-link.js):
   * one supplier's lines of one BOM purchase request, shipped to its address.
   * Started only when that supplier's purchase is free; false otherwise. */
  startFromService(job, link) {
    const supplier = String(job?.seller || "");
    const flow = this.flows.get(supplier);
    const text = siteOrderText({ supplier, lines: (job?.lines || []).map((line) => ({ part: line.sku || line.mpn, quantity: line.quantity })) });
    if (!flow || flow.running || !text) return false;
    let address = null;
    try {
      address = siteAddress(job.ship_to);
    } catch {
      address = null; // the supplier's form stays the person's
    }
    this.listTexts.set(supplier, text);
    // The link keeps one job per supplier at a time (buy-service-link.js).
    const expected = Object.fromEntries((job.lines || []).filter((line) => line.unit_price != null)
      .map((line) => [line.sku || line.mpn, line.unit_price]));
    const resumeKey = `${job.purchase_request_id}:${supplier}`;
    void this.startPurchase({ supplier, text, address, link, resumeKey, expected }).catch((error) => {
      this.failStart(supplier, error.message);
      link?.ended?.({ status: "failed", message: error.message });
    });
    this.publish();
    return true;
  }

  async startPurchase({ supplier, text, addressId = "", address: given = null, link = null, rehearsal = false, resumeKey = null, expected = null }) {
    // A chosen address that is gone stops here, rather than run without it.
    const address = given || (addressId ? this.addresses.find(addressId) : null);
    if (addressId && !given && !address) throw new Error("That address is no longer in the address book");
    const flow = this.flows.get(supplier);
    if (!flow) throw new Error(`Unknown supplier ${supplier}`);
    await this.ensureSite(supplier);
    if (!this.lives.has(supplier)) throw new Error("The supplier page did not start");
    if (!this.active) this.active = supplier;
    await flow.start({ supplier, text, address, link, rehearsal, resumeKey, expected });
    return true;
  }

  /** The cart check: the person says the cart is right, or asks to read it again. */
  confirmCart(id) {
    return Boolean(this.flows.get(id)?.confirmCart());
  }

  recheckCart(id) {
    return Boolean(this.flows.get(id)?.recheckCart());
  }

  /** Go on with that supplier's interrupted purchase: the one in this window,
   * or the one saved on this computer before the app was closed. */
  async resume(id) {
    const flow = this.flows.get(id);
    if (!flow || flow.running) return false;
    await this.ensureSite(id);
    if (flow.state().canResume) {
      void flow.resume().catch((error) => this.failStart(id, error.message));
      return true;
    }
    const saved = this.runs.load(id);
    if (!saved?.text) return false;
    this.listTexts.set(id, saved.text);
    void this.startPurchase({ supplier: id, text: saved.text, address: saved.address, rehearsal: saved.rehearsal, resumeKey: saved.resumeKey })
      .catch((error) => this.failStart(id, error.message));
    this.publish();
    return true;
  }

  /** The person's yes to the order waiting on that supplier, and only it. */
  confirm(id) {
    return Boolean(this.flows.get(id)?.approve());
  }

  /** Stop one supplier's purchase, or every one without an id. */
  stop(id = "") {
    for (const [key, flow] of this.flows) {
      if (!id || key === id) flow.stop();
    }
    // Stopped: nothing waits on that supplier page any more; back to the list.
    if (!id || id === this.active) this.showView("flow");
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
    for (const flow of this.flows.values()) flow.stop();
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

  ipcMain.handle("buy-lab:state", (event) => ownerOf(event)?.state() ?? null);
  ipcMain.handle("buy-lab:start", (event, payload) => {
    const owner = ownerOf(event);
    if (!owner) return false;
    const { supplier, text, addressId, rehearsal } = payload && typeof payload === "object" ? payload : {};
    const id = String(supplier || "");
    return owner.startPurchase({ supplier: id, text: String(text || ""), addressId: String(addressId || ""), rehearsal: rehearsal === true }).catch((error) => {
      owner.failStart(id, error.message);
      return false;
    });
  });
  ipcMain.handle("buy-lab:addresses", (event) => ownerOf(event)?.addresses.list() ?? []);
  ipcMain.handle("buy-lab:save-address", (event, address) => {
    const owner = ownerOf(event);
    if (!owner) return { ok: false, message: "Not allowed" };
    try {
      return { ok: true, address: owner.addresses.save(address && typeof address === "object" ? address : {}) };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });
  ipcMain.handle("buy-lab:delete-address", (event, id) => ownerOf(event)?.addresses.remove(String(id || "")) ?? false);
  ipcMain.handle("buy-lab:stop", (event, id) => ownerOf(event)?.stop(String(id || "")) ?? false);
  ipcMain.handle("buy-lab:confirm", (event, id) => ownerOf(event)?.confirm(String(id || "")) ?? false);
  ipcMain.handle("buy-lab:confirm-cart", (event, id) => ownerOf(event)?.confirmCart(String(id || "")) ?? false);
  ipcMain.handle("buy-lab:recheck-cart", (event, id) => ownerOf(event)?.recheckCart(String(id || "")) ?? false);
  ipcMain.handle("buy-lab:resume", async (event, id) => (await ownerOf(event)?.resume(String(id || ""))) ?? false);
  ipcMain.handle("buy-lab:select", (event, id) => ownerOf(event)?.select(String(id)) ?? false);
  ipcMain.handle("buy-lab:show-live", async (event, id) => {
    const owner = ownerOf(event);
    if (!owner) return false;
    // A supplier whose Chrome hasn't started yet (LCSC before its first
    // run) starts now, so its own page shows and not another supplier's.
    if (id) await owner.ensureSite(String(id)).catch(() => null);
    owner.showView("live", id ? String(id) : undefined);
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
  // The live view's tab bar: show another tab of the active supplier's
  // Chrome, or close one (never the main tab, which the run drives).
  ipcMain.handle("live:select-tab", (event, id) => {
    const owner = ownerOf(event);
    const live = owner?.lives.get(owner.active);
    return live ? live.view(Number(id) || 0) : false;
  });
  ipcMain.handle("live:close-tab", (event, id) => {
    const owner = ownerOf(event);
    const live = owner?.lives.get(owner.active);
    return live && Number(id) ? live.closeTab(Number(id)) : false;
  });
}


module.exports = { BuyLabWindow, registerBuyLabIpc };
