"use strict";

/* One supplier page in the person's own Chrome, wearing the face the rest of
 * the app already knows: the same surface an Electron WebContents has
 * (loadURL, isLoading, getURL, getTitle, capturePage, and a `debugger` that
 * sends CDP commands). Driver and Runner stay browser-agnostic because of it.
 *
 * The page is driven through a DevTools protocol session: the Driver creates
 * an isolated world for its page runtime and sends Input events, so the page
 * gets trusted clicks and keys at the place a person would click. The browser
 * itself is started by the rebrowser-patched Playwright, which keeps
 * Playwright's own protocol use out of the page (no Runtime.enable leak, no
 * init-script name to find).
 *
 * Chrome is a normal Chrome window on the desktop: its own profile per
 * supplier, its own downloads folder, and a navigation guard that keeps the
 * main tab on that supplier's hosts. A page elsewhere opens in another tab of
 * the same Chrome, never in the system browser (a sign-in with Google keeps
 * its session that way); when that tab comes back to the supplier (the
 * sign-in's callback), the address moves to the main tab and the tab closes. */

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const { createTrafficWatch } = require("./traffic");

const NAVIGATION_TIMEOUT = 45000;
const ABORTED = /net::ERR_ABORTED|interrupted by another navigation|Navigation interrupted|frame was detached/i;


class ChromePage extends EventEmitter {
  constructor(browser) {
    super();
    this.browser = browser;
    this.context = browser.context;
    this.page = browser.page;
    this.url = browser.page.url();
    this.title = "";
    this.loading = false;
    this.destroyed = false;
    this.runSession = null;
    this.debugger = {
      isAttached: () => Boolean(this.runSession),
      attach: async () => { await this.attach(); },
      detach: () => { this.detach(); },
      sendCommand: (method, params) => this.send(method, params),
    };
  }

  async attach() {
    if (this.destroyed) throw new Error("The supplier window was closed");
    if (!this.runSession) this.runSession = await this.context.newCDPSession(this.page);
  }

  detach() {
    const session = this.runSession;
    this.runSession = null;
    if (session) void session.detach().catch(() => {});
  }

  send(method, params = {}) {
    if (this.destroyed) throw new Error("The supplier window was closed");
    if (!this.runSession) throw new Error("The supplier page is not attached");
    return this.runSession.send(method, params);
  }

  isDestroyed() {
    return this.destroyed;
  }

  /** Load the page again (the Runner lets go of a check this way). */
  reload() {
    if (this.destroyed) return;
    void this.page.reload().catch(() => {});
  }

  isLoading() {
    return this.loading;
  }

  getURL() {
    return this.url;
  }

  getTitle() {
    return this.title;
  }

  /** Open an address the way Electron's loadURL did. Resolves once Chrome has
   * committed the navigation; callers then wait for the page to be ready. */
  async loadURL(url) {
    if (this.destroyed) throw new Error("The supplier window was closed");
    this.loading = true;
    try {
      await this.page.goto(url, { waitUntil: "commit", timeout: NAVIGATION_TIMEOUT });
    } catch (error) {
      // A redirect aborts the first navigation; the page still opens.
      if (!ABORTED.test(`${error.message}`)) {
        const failure = new Error(error.message);
        failure.code = error.message.includes("Timeout") ? "ERR_TIMED_OUT" : "ERR_FAILED";
        throw failure;
      }
    }
    this.url = this.page.url();
  }

  /** A screenshot of the page, in the shape `contents.capturePage()` has. */
  async capturePage() {
    const image = await this.page.screenshot({ type: "png" });
    return { toPNG: () => image };
  }

  /** The page's text as JSON-able values, for a test or a probe (never used
   * by a task: the page runtime does that work). */
  evaluate(source) {
    return this.page.evaluate(source);
  }

  locatorHelpers() {
    return {
      fill: (label, value) => this.page.getByLabel(label).fill(String(value)),
      click: (role, name) => this.page.getByRole(role, { name }).click(),
      check: (label) => this.page.getByLabel(label).check(),
    };
  }
}


class SupplierBrowser extends EventEmitter {
  /**
   * Start Chrome for one supplier and open its page.
   *
   * @param {object} options
   * @param {object} options.profile the supplier profile (sites/)
   * @param {string} options.profilePath Chrome's own profile directory
   * @param {string} options.downloadsPath where the shop's downloads go
   * @param {object} options.bounds {left, top, width, height} for the window
   * @param {(url: string) => boolean} options.mayGo
   * @param {(url: string) => void} options.openExternal
   * @param {Array} [options.choices] from browser.js browserChoices()
   */
  static async open({ profile, profilePath, downloadsPath, bounds, mayGo, challengeMayGo, openExternal, choices = [], headless = false, args = [] }) {
    const { chromium } = require("playwright");
    if (!choices.length) {
      const error = new Error("No Chrome or Microsoft Edge was found");
      error.code = "NO_BROWSER";
      throw error;
    }
    fs.mkdirSync(profilePath, { recursive: true });
    if (downloadsPath) fs.mkdirSync(downloadsPath, { recursive: true });

    let lastError = null;
    for (const choice of choices) {
      try {
        const context = await chromium.launchPersistentContext(profilePath, {
          headless,
          viewport: null,
          // Chrome's own sandbox stays on: it is what a normal Chrome runs
          // with, and a launch without it puts a warning bar on the window.
          chromiumSandbox: true,
          acceptDownloads: true,
          ...(downloadsPath ? { downloadsPath } : {}),
          args: [
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-session-crashed-bubble",
            "--hide-crash-restore-bubble",
            ...(bounds ? [`--window-position=${Math.round(bounds.left)},${Math.round(bounds.top)}`] : []),
            ...(bounds ? [`--window-size=${Math.round(bounds.width)},${Math.round(bounds.height)}`] : []),
            ...args,
          ],
          ...(choice.channel ? { channel: choice.channel } : { executablePath: choice.executablePath }),
        });
        return await new SupplierBrowser({ profile, context, downloadsPath, mayGo, challengeMayGo, openExternal }).start(bounds);
      } catch (error) {
        lastError = error;
        // Another browser may still work; try the next one. A profile that is
        // already in use is not fixed by switching, so stop there.
        if (/ProcessSingleton|profile.*in use|already in use/i.test(`${error.message}`)) break;
      }
    }
    throw lastError || new Error("Chrome did not start");
  }

  constructor({ profile, context, downloadsPath, mayGo, challengeMayGo, openExternal }) {
    super();
    this.profile = profile;
    this.context = context;
    this.downloadsPath = downloadsPath;
    this.mayGo = mayGo || (() => false);
    this.challengeMayGo = challengeMayGo || (() => false);
    this.openExternal = openExternal || (() => {});
    this.traffic = createTrafficWatch();
    this.closed = false;
    this.pages = new Set();
    /* The other tabs: page -> { id, title }. The main tab is id 0. */
    this.tabsByPage = new Map();
    this.nextTabId = 1;
    /* Tabs this browser is opening itself (openTab), so adopt() leaves them. */
    this.ownTabsPending = 0;
  }

  async start(bounds) {
    this.page = this.context.pages().find((page) => page.url() !== "about:blank") || this.context.pages()[0];
    if (!this.page) this.page = await this.context.newPage();
    this.link = new ChromePage(this);

    // The window the person sees: the requested rectangle, not whatever the
    // profile remembered from last time.
    if (bounds) await this.setWindowBounds(bounds).catch(() => {});

    this.guard = await this.context.newCDPSession(this.page);
    // The page's own frame keeps this id across navigations; anything else
    // that loads a document here is an iframe inside the page.
    try {
      const { frameTree } = await this.guard.send("Page.getFrameTree");
      this.mainFrameId = frameTree.frame.id;
    } catch {
      this.mainFrameId = null;
    }
    await this.guard.send("Fetch.enable", {
      patterns: [{ resourceType: "Document", requestStage: "Request" }],
    });
    this.guard.on("Fetch.requestPaused", (event) => { void this.onDocument(event); });

    this.watchPage(this.page);
    this.context.on("page", (opened) => {
      if (opened === this.page) return;
      if (this.ownTabsPending > 0) {
        this.ownTabsPending -= 1;
        return; // openTab registers it
      }
      void this.adopt(opened);
    });
    this.context.on("request", (request) => this.traffic.request(request.url()));
    this.context.on("response", (response) => this.traffic.completed(response.status()));
    this.context.on("requestfailed", () => this.traffic.failed());
    this.context.on("close", () => this.finish());
    return this;
  }

  watchPage(page) {
    if (this.pages.has(page)) return;
    this.pages.add(page);
    const link = page === this.page ? this.link : null;
    page.on("request", (request) => {
      if (link && request.isNavigationRequest() && request.frame() === page.mainFrame()) link.loading = true;
    });
    page.on("load", () => {
      if (!link) return;
      link.loading = false;
      void page.title().then((title) => { link.title = title; }).catch(() => {});
    });
    page.on("framenavigated", (frame) => {
      if (!link || frame !== page.mainFrame()) return;
      link.url = frame.url();
      link.title = "";
      // A same-document navigation (a hash, a history push) fires this too and
      // has no load event after it: loading is only set by the request events.
      link.emit("did-navigate", { url: link.url });
    });
    page.on("close", () => {
      if (link) {
        link.destroyed = true;
        this.finish();
        return;
      }
      if (this.tabsByPage.delete(page)) this.emit("tabs", this.tabs());
    });
    page.on("download", (download) => { void this.save(download); });
    if (!link) {
      // Another tab: keep its title for the tab bar.
      const retitle = () => {
        const tab = this.tabsByPage.get(page);
        if (!tab) return;
        void page.title().then((title) => {
          tab.title = title;
          this.emit("tabs", this.tabs());
        }).catch(() => {});
      };
      page.on("load", retitle);
      page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) retitle(); });
    }
  }

  /** Every tab, the main one first: [{ id, url, title, main }]. */
  tabs() {
    const list = [{ id: 0, url: this.page?.url() || "", title: this.link?.title || "", main: true }];
    for (const [page, tab] of this.tabsByPage) list.push({ id: tab.id, url: page.url(), title: tab.title || "", main: false });
    return list;
  }

  /** The page of a tab id (0 is the main tab). */
  pageOf(id) {
    if (!id) return this.page;
    for (const [page, tab] of this.tabsByPage) if (tab.id === id) return page;
    return null;
  }

  registerTab(page) {
    if (this.tabsByPage.has(page)) return this.tabsByPage.get(page);
    const tab = { id: this.nextTabId++, title: "" };
    this.tabsByPage.set(page, tab);
    this.watchPage(page);
    this.emit("tabs", this.tabs());
    return tab;
  }

  /** Open an address outside the supplier in another tab of this Chrome. The
   * tab's own guard sends it back to the main tab when it reaches the
   * supplier again. */
  async openTab(url) {
    if (this.closed) return null;
    this.ownTabsPending += 1;
    let page;
    try {
      page = await this.context.newPage();
    } catch {
      this.ownTabsPending = Math.max(0, this.ownTabsPending - 1);
      return null;
    }
    const tab = this.registerTab(page);
    await this.guardTab(page).catch(() => {});
    this.emit("tab-opened", tab.id);
    await page.goto(url, { waitUntil: "commit", timeout: NAVIGATION_TIMEOUT }).catch(() => {});
    return tab.id;
  }

  /** A tab of ours: its page may go anywhere, but the moment it would load a
   * supplier page again, that address goes to the main tab instead (sent once,
   * from there) and the tab closes. */
  async guardTab(page) {
    const session = await this.context.newCDPSession(page);
    let mainFrameId = null;
    try {
      mainFrameId = (await session.send("Page.getFrameTree")).frameTree.frame.id;
    } catch {
      /* no frame yet; every document then counts as the tab's own */
    }
    await session.send("Fetch.enable", { patterns: [{ resourceType: "Document", requestStage: "Request" }] });
    session.on("Fetch.requestPaused", (event) => {
      const url = event.request?.url || "";
      const topLevel = !event.frameId || !mainFrameId || event.frameId === mainFrameId;
      let back = false;
      try {
        back = topLevel && this.mayGo(url);
      } catch {
        back = false;
      }
      if (!back) {
        void session.send("Fetch.continueRequest", { requestId: event.requestId }).catch(() => {});
        return;
      }
      void session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" }).catch(() => {});
      void this.returnToMain(url, page);
    });
  }

  async returnToMain(url, page) {
    if (this.closed) return;
    this.emit("tab-returned", url);
    await this.link.loadURL(url).catch(() => {});
    await page.close().catch(() => {});
    await this.page.bringToFront().catch(() => {});
  }

  async closeTab(id) {
    const page = id ? this.pageOf(id) : null;
    if (!page) return false;
    await page.close().catch(() => {});
    return true;
  }

  async save(download) {
    if (!this.downloadsPath) return;
    try {
      await download.saveAs(path.join(this.downloadsPath, download.suggestedFilename()));
    } catch (error) {
      console.error(`Supplier download not saved: ${error.message}`);
    }
  }

  /** A new tab or popup the page opened: a shop's "open in new tab" stays in
   * its main tab, one page at a time; anything else (a checkpoint, a sign-in
   * window, another site) stays open as a tab of this Chrome. A popup is not
   * guarded: a sign-in popup finishes and closes itself. */
  async adopt(opened) {
    this.watchPage(opened);
    try {
      await opened.waitForLoadState("domcontentloaded", { timeout: 8000 });
      const url = opened.url();
      if (this.mayGo(url) && !this.challengeMayGo(url)) {
        await this.link.loadURL(url);
        await opened.close().catch(() => {});
        return;
      }
      this.registerTab(opened);
      await opened.bringToFront().catch(() => {});
      this.emit("tab-opened", this.tabsByPage.get(opened)?.id);
    } catch {
      /* the popup closed or never loaded */
    }
  }

  /** Every document request of the main tab is checked against the
   * supplier's hosts before Chrome sends it. Subresources are left alone:
   * shops load their own CDNs. A refused page opens in another tab of this
   * Chrome (openTab); a refused iframe is only blocked. */
  async onDocument(event) {
    const url = event.request?.url || "";
    let allow = false;
    try {
      allow = this.mayGo(url) || this.challengeMayGo(url) || /^about:/i.test(url);
    } catch {
      allow = false;
    }
    try {
      if (allow) {
        await this.guard.send("Fetch.continueRequest", { requestId: event.requestId });
        return;
      }
      // Only the page itself going elsewhere is the person's to follow, in
      // another tab here. An iframe (a shop's chat widget, an ad) stays
      // blocked as before and opens nowhere: nobody asked for it.
      const topLevel = !event.frameId || !this.mainFrameId || event.frameId === this.mainFrameId;
      await this.guard.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" });
      if (topLevel && /^https?:/i.test(url)) void this.openTab(url);
    } catch {
      /* the page went away mid-decision */
    }
  }

  async windowBounds() {
    if (this.closed) return null;
    try {
      const { bounds } = await this.guard.send("Browser.getWindowForTarget", {});
      return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, state: bounds.windowState };
    } catch {
      return null;
    }
  }

  async setWindowBounds({ left, top, width, height }) {
    const { windowId } = await this.guard.send("Browser.getWindowForTarget", {});
    await this.guard.send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(width),
        height: Math.round(height),
        windowState: "normal",
      },
    });
  }

  async focus() {
    if (this.closed) return;
    await this.page.bringToFront().catch(() => {});
  }

  stats() {
    return this.traffic.stats();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    if (this.link) this.link.destroyed = true;
    this.emit("closed");
  }

  async close() {
    this.finish();
    await this.context.close().catch(() => {});
  }
}


module.exports = { ChromePage, SupplierBrowser };
