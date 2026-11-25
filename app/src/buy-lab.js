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

const { BaseWindow, Notification, WebContentsView, ipcMain } = require("electron");
const path = require("node:path");

const { browserChoices } = require("./automation/browser");
const { SITES } = require("./automation/sites");
const { AddressBook, BuyLabFlow, RunStore, siteAddress, siteOrderText } = require("./buy-lab-flow");
const { LiveBrowser } = require("./live-browser");
const { Runner } = require("./automation/runner");

/* Behind the flow page (its own ground); the live overlay paints dark. */
const BACKGROUND = "#ecf0f3";
/* A supplier Chrome is closed when its work has been idle this long. */
const IDLE_CLOSE_MS = 10 * 60 * 1000;
const LAB_SITES = ["digikey", "mouser", "lcsc"];

/* Where each shop's cart starts on its cart page (the sites' own markup, see
 * automation/sites): BOM's "Seller's site" scrolls there. */
const CART_START = {
  digikey: "#cartDetails",
  mouser: "table#cart, #cart-form",
  lcsc: "[id^='cartItemBox_'], .v2CartListItemWrap, .cartItemWrap",
};

/** the page's contents -> BuyLabWindow */
const byContents = new WeakMap();


class BuyLabWindow {
  static async create(options) {
    const window = new BuyLabWindow(options);
    await window.start();
    return window;
  }

  constructor({ language, pageUrl, pagePreload, partition, userDataDir, downloadsPath, openExternal, onClosed, onBackToSite = null, serviceStatus = null, onResumeSaved = null, quiet = false }) {
    this.serviceStatus = serviceStatus;
    // Continue on a run saved before the app started again, when it is one of
    // BOM's: BOM's link takes it on, so its cart and order still reach BOM.
    this.onResumeSaved = onResumeSaved;
    /* Opened by BOM's "Deal with it": Back goes back to BOM, not to the list
     * (2026-11-21: "点击back 跳到这个页面而不是原来的页面"). */
    this.onBackToSite = onBackToSite;
    this.returnTo = null;
    // Sellers whose payment prompt was shown for the current wait (promptPayment).
    this.payPrompted = new Set();
    this.surfaced = false;
    this.hideOnBack = false;
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
    this.liveOnly = false;
    this.idleTimers = new Map();

    this.window = new BaseWindow({
      width: 1280,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      title: "O2 BOM - Supplier pages",
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
    // A page elsewhere (a sign-in with Google) opened in its own tab: shown
    // in front only when the purchase is waiting for the person; a tab the
    // shop opens while the app works stays out of sight (2026-11-21: the lab
    // jumped up mid-run).
    live.browser.on("tab-opened", () => this.showFor(site.id, { quiet: !this.needsPerson(site.id) }));
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
    if (this.closed || this.view === "flow" || id !== this.active) return;
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

  /** The list, the live page of one supplier (`id`, else the active one), or
   * "split": that supplier's cart check beside its live page. */
  showView(name, id = this.active, { plain = false } = {}) {
    if (this.closed) return;
    // Opened from Orders: the supplier page is the only page this window
    // shows; there is no list to go back to (2026-11-23). Its cart check is
    // still the two halves (2026-11-24: "购物车检查要分为左右两半").
    if (this.liveOnly && name === "flow") name = "live";
    // A supplier waiting at its cart check (or for the order's yes) is shown
    // as its check on the left and its page on the right, however it was
    // opened: a tab, Open website, or the app coming forward.
    const target = id && this.lives.has(id) ? id : this.active;
    const waitingState = target ? this.flows.get(target)?.state() : null;
    // Not for a placed order's own page, opened from its card (2026-11-24):
    // that page alone, though another order waits at this seller's cart.
    this.plainView = plain && name === "live" ? target : null;
    if (name === "live" && !plain && (waitingState?.cartCheck || waitingState?.confirm)) name = "split";
    const was = this.view;
    this.view = name === "live" || name === "split" ? name : "flow";
    // Back at a cart check after the page went to an order's page: the cart.
    if (this.view === "split" && target && this.awayFromCart?.has(target)) {
      this.awayFromCart.delete(target);
      const site = this.sites.find((entry) => entry.id === target);
      const live = this.lives.get(target);
      if (site?.urls?.cart && live) void live.page.goto(site.urls.cart).then(() => this.revealCart(target)).catch(() => {});
    }
    if (this.view !== "flow" && id && this.lives.has(id)) this.active = id;
    // Leaving the side-by-side view: the shop goes back to its usual size.
    if (was === "split" && this.view !== "split") void this.lives.get(this.active)?.setSize();
    if (!this.page.webContents.isDestroyed()) {
      this.page.webContents.send("buy-lab:view", this.view);
      if (this.view === "split") this.page.webContents.send("buy-lab:reveal", { id: this.active, part: "cart" });
      this.publish();
    }
    if (this.view !== "flow") {
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
      // "site": the person came from BOM's Deal with it; Back returns there.
      returnTo: this.returnTo,
      liveOnly: this.liveOnly,
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
    if (state.running || !["done", "failed", "stopped"].includes(state.status)) {
      const timer = this.idleTimers.get(id);
      if (timer) { clearTimeout(timer); this.idleTimers.delete(id); }
    } else {
      this.scheduleIdleClose(id);
    }
    this.publish();
    this.notifyIfWaiting(id, state);
    // The check is over (confirmed, or the run went on): its page alone again.
    if (this.view === "split" && this.active === id && !state.cartCheck && !state.confirm) this.showView("live", id);
    // The check began while its page was open: the two halves.
    else if (this.view === "live" && this.active === id && this.plainView !== id && (state.cartCheck || state.confirm)) this.showView("split", id);
    // A check is handed to Chrome's own window (onChallenge); the canvas is
    // only for sign-ins and refusals that the person handles in the app,
    // shown for the supplier that is waiting.
    // The cart check is announced on BOM's Placing tab ("Check the cart", Deal
    // with it opens it here): the lab does not come forward for it by itself.
    if (state.status === "waiting" && !state.confirm && state.message !== "challenge") {
      this.showFor(id, { quiet: state.message === "cart-check" });
    }
    // The order's yes, where the person pays (2026-11-21: "付款的时候再提示"):
    // the lab comes forward with this seller's lines and the yes beside its
    // checkout page, once per wait.
    if (state.status === "waiting" && state.confirm) {
      if (this.payPrompted.has(id)) return;
      this.payPrompted.add(id);
      this.promptPayment(id);
    } else {
      this.payPrompted.delete(id);
    }
  }

  /**
   * A system notification each time a seller starts waiting for the person
   * (2026-11-23: "这种情况你要和用户说": a security check waited 15 minutes
   * unseen). Once per wait; clicking it shows that seller's page.
   */
  notifyIfWaiting(id, state) {
    this.notified = this.notified || new Map();
    const waiting = state.status === "waiting";
    const kind = !waiting ? "" : state.confirm ? "confirm" : state.cartCheck ? "cart-check" : String(state.message || "person");
    if (!kind) { this.notified.delete(id); return; }
    if (this.notified.get(id) === kind) return;
    this.notified.set(id, kind);
    if (!Notification.isSupported?.()) return;
    const site = this.sites.find((entry) => entry.id === id);
    const seller = site?.name || id;
    const zh = String(this.language || "").startsWith("zh");
    const text = {
      challenge: zh ? `${seller} 弹出了安全验证，请在打开的 Chrome 窗口里完成` : `${seller} is showing a security check: finish it in the Chrome window that opened`,
      "cart-check": zh ? `请核对 ${seller} 的购物车` : `Check the ${seller} cart`,
      confirm: zh ? `${seller} 的订单等你确认` : `The ${seller} order is waiting for your yes`,
      sign_in: zh ? `请登录 ${seller}` : `Sign in to ${seller}`,
      lost: zh ? `app 停在一个不认识的 ${seller} 页面，请接手` : `The app is on a ${seller} page it doesn't know: take it from there`,
    }[kind] || (zh ? `${seller} 在等你操作` : `${seller} is waiting for you`);
    try {
      const note = new Notification({ title: zh ? `O2 BOM · ${seller} 需要你` : `O2 BOM · ${seller} needs you`, body: text });
      note.on("click", () => {
        if (kind === "challenge") return; // the check is in Chrome's own window, already in front
        this.showFor(id);
        this.focus();
      });
      note.show();
    } catch {
      // no notifications on this system: the lab and BOM's Placing still say it
    }
  }

  /** Whether this seller's purchase waits for the person in the lab itself:
   * a sign-in or a refusal, not the cart check (BOM asks for that) or a
   * security check (Chrome's own window). */
  needsPerson(id) {
    const state = this.flows.get(id)?.state?.();
    return Boolean(state && state.status === "waiting" && !state.confirm
      && !["cart-check", "challenge"].includes(state.message));
  }

  /** The payment: two cards (the lines with Place the order, and the
   * seller's checkout page), Back returning to BOM; shown without taking the
   * keyboard when the lab was out of sight. */
  promptPayment(id) {
    if (this.closed || !this.lives.has(id)) return;
    if (this.view !== "flow" && this.active && this.active !== id) {
      this.publish();
      this.surface();
      return;
    }
    if (!this.returnTo) this.hideOnBack = !this.window.isVisible();
    this.returnTo = "site";
    this.showView("split", id);
    this.surface();
  }

  /** Show a supplier's live page because it needs the person, without taking
   * the screen from the other supplier's page while the person is on it: the
   * waiting supplier's tab is marked instead (the page has the states). */
  showFor(id, { quiet = false } = {}) {
    if (this.view !== "flow" && this.active && this.active !== id) {
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
    this.surfaced = true;
    this.window.showInactive();
    this.window.flashFrame(true);
  }

  /** BOM's "Deal with it", in front. At the cart check, two cards side by
   * side (2026-11-21: "左右两个卡片"): this lab's check of the cart against
   * the list of parts to buy, and the seller's own page scrolled to its
   * cart. Otherwise the seller's page alone, at its cart. False when this
   * lab has no page for that seller. */
  openSellerPage(id) {
    if (this.closed || !this.lives.has(id)) return false;
    if (!this.returnTo) this.hideOnBack = !this.window.isVisible();
    this.returnTo = "site";
    const atCartCheck = Boolean(this.flows.get(id)?.state()?.cartCheck);
    this.showView(atCartCheck ? "split" : "live", id);
    if (!atCartCheck) void this.revealCart(id);
    this.focus();
    return true;
  }

  /** BOM's link to a step of an order (2026-11-23: "点进去可以看到每个状态对应
   * 的页面"): that seller's page in front, at its cart, or at one placed
   * order's own page (walked to the way tracking does, when no purchase is
   * using the page; else the page as it is). */
  async openSellerAt(id, { view, order = "" } = {}) {
    const site = this.sites.find((entry) => entry.id === id);
    if (this.closed || !site) return false;
    await this.ensureSite(id);
    const live = this.lives.get(id);
    if (!live) return false;
    if (!this.returnTo) this.hideOnBack = !this.window.isVisible();
    this.returnTo = "site";
    this.liveOnly = true;
    this.showView("live", id, { plain: view === "order" && Boolean(order) });
    if (!this.window.isDestroyed()) this.window.show();
    this.focus();
    const flow = this.flows.get(id);
    const free = this.pageFree(flow);
    if (free && view === "order" && order) void this.trackOrder(id, order);
    else if (free && view === "cart" && site.urls?.cart) {
      void live.page.goto(site.urls.cart).then(() => this.revealCart(id)).catch(() => {});
    }
    return true;
  }

  /** The side-by-side view measured its right card: the shop is laid out at
   * that size (never narrower than 800, so it keeps its desktop layout). */
  async fitStage({ width, height } = {}) {
    if (this.closed || this.view !== "split") return false;
    const live = this.lives.get(this.active);
    if (!live) return false;
    const w = Math.round(Math.min(1280, Math.max(800, Number(width) || 1280)));
    const h = Math.round(Math.min(1400, Math.max(600, (Number(height) || 900) + 90)));
    await live.setSize({ width: w, height: h });
    await this.revealCart(this.active);
    return true;
  }

  /** Scroll the seller's page to its cart, when it is on the cart page. */
  async revealCart(id) {
    const selector = CART_START[id];
    const page = this.lives.get(id)?.page;
    if (!selector || !page) return false;
    try {
      return await page.evaluate((css) => {
        const cart = document.querySelector(css);
        if (!cart) return false;
        cart.scrollIntoView({ block: "start" });
        return true;
      }, selector);
    } catch {
      return false;
    }
  }

  /** Back: to BOM when Deal with it brought the person here, else to the list. */
  back() {
    if (this.closed) return false;
    // A supplier page opened from O2 BOM has nothing else to go back to:
    // the window goes and O2 BOM comes forward, every time (2026-11-23: the
    // first Back only raised BOM behind it, the next did nothing).
    if (this.liveOnly) {
      if (!this.window.isDestroyed()) this.window.hide();
      this.surfaced = false;
      this.hideOnBack = false;
      this.onBackToSite?.();
      return true;
    }
    const toSite = this.returnTo === "site";
    this.returnTo = null;
    this.showView("flow");
    if (toSite) {
      if (this.hideOnBack) { this.window.hide(); this.surfaced = false; }
      this.hideOnBack = false;
      this.onBackToSite?.();
    }
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
    let addressNote = null;
    try {
      address = siteAddress(job.ship_to);
    } catch (error) {
      address = null; // the supplier's form stays the person's
      // Said in the panel, so the person knows why the form is empty (2026-11-23).
      addressNote = String(error?.message || error).slice(0, 160);
    }
    flow.addressNote = addressNote;
    this.listTexts.set(supplier, text);
    // The link keeps one job per supplier at a time (buy-service-link.js).
    const expected = Object.fromEntries((job.lines || []).filter((line) => line.unit_price != null)
      .map((line) => [line.sku || line.mpn, line.unit_price]));
    // How each line is to be packed, when the order said (2026-11-24).
    const packaging = Object.fromEntries((job.lines || []).filter((line) => line.packaging)
      .map((line) => [line.sku || line.mpn, String(line.packaging)]));
    const resumeKey = `${job.purchase_request_id}:${supplier}`;
    void this.startPurchase({ supplier, text, address, link, resumeKey, expected, packaging }).catch((error) => {
      this.failStart(supplier, error.message);
      link?.ended?.({ status: "failed", message: error.message });
    });
    this.publish();
    return true;
  }

  async startPurchase({ supplier, text, addressId = "", address: given = null, link = null, rehearsal = false, resumeKey = null, expected = null, packaging = null }) {
    // A chosen address that is gone stops here, rather than run without it.
    const address = given || (addressId ? this.addresses.find(addressId) : null);
    if (addressId && !given && !address) throw new Error("That address is no longer in the address book");
    const flow = this.flows.get(supplier);
    if (!flow) throw new Error(`Unknown supplier ${supplier}`);
    await this.ensureSite(supplier);
    if (!this.lives.has(supplier)) throw new Error("The supplier page did not start");
    if (!this.active) this.active = supplier;
    await flow.start({ supplier, text, address, link, rehearsal, resumeKey, expected, packaging });
    return true;
  }

  /** The cart check: the person says the cart is right, or asks to read it again. */
  /** The cart is right: the purchase goes on to checkout out of sight and
   * the person goes back to BOM (2026-11-21: "checkout 以后要退回原来的页面");
   * the lab comes forward again at the payment (promptPayment). */
  confirmCart(id) {
    if (!this.flows.get(id)?.confirmCart()) return false;
    if (this.returnTo === "site") {
      this.back();
    } else if (this.surfaced) {
      this.surfaced = false;
      this.showView("flow");
      this.window.hide();
      this.onBackToSite?.();
    }
    return true;
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
    if (saved.resumeKey && this.onResumeSaved) {
      try {
        if (await this.onResumeSaved(id, saved.resumeKey)) {
          this.publish();
          return true;
        }
      } catch (error) {
        this.failStart(id, error.message);
        return false;
      }
    }
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

  /** Show the page of the Chrome that runs this supplier's purchase in the
   * app's own window (the live view), the way Buy lab always showed it. */
  showSupplierPage(id) {
    if (!this.lives.has(id)) return false;
    this.liveOnly = true;
    this.returnTo = "site";
    this.showView("live", id);
    if (!this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
    }
    const site = this.sites.find((entry) => entry.id === id);
    if (site && !this.window.isDestroyed()) this.window.setTitle(`O2 BOM - ${site.name}`);
    return !this.window.isDestroyed() && this.window.isVisible();
  }

  /** The person's Continue on a paused purchase: confirm the order, accept
   * the cart, or go on from where a stopped run ended. `code` is the order's
   * `<purchase_request_id>:<seller>`. */
  continuePurchase(code) {
    const seller = String(code || "").split(":").pop();
    const flow = this.flows.get(seller);
    if (!flow) return { ok: false, message: "Unknown supplier" };
    // Only the order it was asked for (2026-11-24): another order in hand is
    // not continued in its place.
    if (code.includes(":") && flow.resumeKey && flow.resumeKey !== code) {
      return { ok: false, reason: "busy", holder: String(flow.resumeKey).split(":")[0] };
    }
    const state = flow.state();
    if (state.confirm) return { ok: Boolean(flow.approve()), where: "order" };
    if (state.cartCheck) return { ok: Boolean(flow.confirmCart()), where: "cart" };
    if (state.canResume) {
      void flow.resume().catch((error) => this.failStart(seller, error.message));
      return { ok: true, where: "resume" };
    }
    if (state.running) return { ok: false, message: "It is still working" };
    return { ok: false, message: "Nothing to continue" };
  }

  /** Stop one supplier's purchase, or every one without an id. `soft`: while
   * the app works, finish the line it is on first (a second Stop is at once). */
  stop(id = "", { soft = false } = {}) {
    let finishing = false;
    for (const [key, flow] of this.flows) {
      if (!id || key === id) {
        flow.stop({ soft });
        if (flow.running && flow.softStop) finishing = true;
      }
    }
    // Stopped: nothing waits on that supplier page any more; back to the list.
    if (!finishing && (!id || id === this.active)) this.showView("flow");
    return true;
  }

  live(id = this.active) {
    const live = this.lives.get(id);
    return live ? { page: live.page, link: live.browser.link, browser: live.browser } : null;
  }

  async input(event) {
    const live = this.lives.get(this.active);
    if (!live) return false;
    // The app's turn on this page (adding, reading the cart, filling the
    // checkout): the person's clicks and keys are held back, so nothing they
    // do lands between the app's own steps (2026-11-21).
    if (this.flows.get(this.active)?.driving()) return false;
    return live.input(event);
  }

  /**
   * Read one placed order's page on that seller's site, out of sight
   * (2026-11-23: "做一下物流追踪"): the order's status in the seller's words
   * and its tracking numbers. Only while no purchase uses that seller's page;
   * null when it is busy. A page that wants the person (signed out) is left
   * alone and reported as such: tracking never asks anything of anyone.
   */
  /** Whether the seller's page may be taken to another page: no purchase
   * there, or one only waiting at its cart check (the app isn't using the
   * page then; 2026-11-24: an order's page did not open while another order
   * sat at the cart). Never while it waits for the order's yes at checkout. */
  pageFree(flow) {
    if (!flow) return true;
    if (!flow.running && flow.status !== "waiting") return true;
    const state = flow.state();
    return state.status === "waiting" && Boolean(state.cartCheck) && !state.confirm && !flow.driving?.();
  }

  async trackOrder(seller, number) {
    const flow = this.flows.get(seller);
    const site = this.sites.find((entry) => entry.id === seller);
    if (!flow || !site?.tasks?.track || !number) return null;
    this.tracking = this.tracking || new Set();
    if (!this.pageFree(flow) || this.tracking.has(seller)) return null;
    this.tracking.add(seller);
    let runner = null;
    let timer = null;
    try {
      const live = await this.ensureSite(seller);
      if (!live || !this.pageFree(flow)) return null;
      // A cart check waits on this page: it goes back to the cart when shown.
      if (flow.running) (this.awayFromCart ||= new Set()).add(seller);
      let needsPerson = false;
      let why = "";
      runner = new Runner({
        contents: live.browser.link,
        profile: site,
        task: "track",
        params: { order: String(number) },
        themeCss: "",
        warmupMs: 0,
        navigationGapMs: 250,
        checkSettleMs: 0,
        session: { warmedUp: false },
        onChange: (snapshot) => {
          if (snapshot.status === "waiting" && !needsPerson) {
            needsPerson = true;
            why = `${snapshot.message || "person"} at ${snapshot.state || "?"} (signed in ${snapshot.metrics?.signIns || 0}x) ${String(live.page.url()).slice(0, 90)}`;
            runner.stop();
          }
        },
      });
      timer = setTimeout(() => runner.stop(), 120_000);
      const snapshot = await runner.run();
      // Which page wanted the person, so BOM says why (2026-11-23).
      if (needsPerson) return { failed: `Needs the person: ${why}`.slice(0, 200) };
      if (snapshot.status !== "done") {
        const step = snapshot.steps.find((item) => item.error);
        return { failed: String(step?.error?.message || snapshot.status || "failed").slice(0, 200) };
      }
      // A site that reads the order's row in its history (Mouser) gives rows of
      // { status, number, link }; the others the order page's status and links.
      const rows = Array.isArray(snapshot.results?.rows) ? snapshot.results.rows : [];
      const shipments = (Array.isArray(snapshot.results?.shipments) ? snapshot.results.shipments : rows)
        .map((item) => ({ number: String(item?.number || "").trim().slice(0, 120), link: item?.link ? String(item.link).slice(0, 1000) : null }))
        .filter((item) => item.number);
      const status = snapshot.results?.status || rows.find((row) => row?.status)?.status;
      return { status: status ? String(status).trim().slice(0, 200) : null, shipments };
    } catch (error) {
      return { failed: String(error?.message || error).slice(0, 200) };
    } finally {
      clearTimeout(timer);
      this.tracking.delete(seller);
    }
  }

  /** What each supplier's run is doing, for BOM: step, who has the page, lines done. */
  activity(seller) {
    const flow = this.flows.get(seller);
    if (!flow) return null;
    const state = flow.state();
    if (!state.running) return null;
    return {
      step: state.status === "waiting" ? (state.confirm ? "confirm" : state.cartCheck ? "cart-check" : state.message || "person")
        : state.phase || "working",
      driver: state.driving ? "app" : state.status === "waiting" ? "person" : "none",
      done: state.phase === "cart" ? state.done : null,
      total: state.phase === "cart" ? state.total : null,
      since: state.phaseSince,
      message: state.softStop ? "stopping" : state.message,
    };
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
    this.surfaced = false;
    this.window.show();
    this.window.focus();
  }

  /** Close a supplier's Chrome after the work has been idle for a while. */
  scheduleIdleClose(id) {
    if (this.idleTimers.has(id)) return;
    this.idleTimers.set(id, setTimeout(() => void this.closeSite(id), IDLE_CLOSE_MS));
  }

  async closeSite(id) {
    const flow = this.flows.get(id);
    if (flow?.running) { this.scheduleIdleClose(id); return; }
    const live = this.lives.get(id);
    if (!live) return;
    this.lives.delete(id);
    this.idleTimers.delete(id);
    await live.close().catch(() => {});
    this.publish();
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
  ipcMain.handle("buy-lab:stop", (event, id, options) => ownerOf(event)?.stop(String(id || ""), { soft: Boolean(options?.soft) }) ?? false);
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
  ipcMain.handle("buy-lab:back", (event) => ownerOf(event)?.back() ?? false);
  ipcMain.handle("buy-lab:stage-size", async (event, size) => (await ownerOf(event)?.fitStage(size && typeof size === "object" ? size : {})) ?? false);
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
