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
 * window on that supplier's hosts. Links elsewhere open in the system
 * browser, as they did in the Electron window. */

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
  }

  async start(bounds) {
    this.page = this.context.pages().find((page) => page.url() !== "about:blank") || this.context.pages()[0];
    if (!this.page) this.page = await this.context.newPage();
    this.link = new ChromePage(this);

    // The window the person sees: the requested rectangle, not whatever the
    // profile remembered from last time.
    if (bounds) await this.setWindowBounds(bounds).catch(() => {});

    this.guard = await this.context.newCDPSession(this.page);
    await this.guard.send("Fetch.enable", {
      patterns: [{ resourceType: "Document", requestStage: "Request" }],
    });
    this.guard.on("Fetch.requestPaused", (event) => { void this.onDocument(event); });

    this.watchPage(this.page);
    this.context.on("page", (opened) => {
      if (opened === this.page) return;
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
      }
    });
    page.on("download", (download) => { void this.save(download); });
  }

  async save(download) {
    if (!this.downloadsPath) return;
    try {
      await download.saveAs(path.join(this.downloadsPath, download.suggestedFilename()));
    } catch (error) {
      console.error(`Supplier download not saved: ${error.message}`);
    }
  }

  /** A new tab or popup: a shop's "open in new tab" stays in its window, one
   * page at a time; anything else opens in the system browser. */
  async adopt(opened) {
    this.watchPage(opened);
    try {
      await opened.waitForLoadState("domcontentloaded", { timeout: 8000 });
      const url = opened.url();
      // A checkpoint opens its own window: leave it where the person can
      // finish it, and the shop's page carries on when they do.
      if (this.challengeMayGo(url)) {
        await opened.bringToFront().catch(() => {});
        return;
      }
      if (this.mayGo(url)) await this.link.loadURL(url);
      else if (/^https?:/i.test(url)) this.openExternal(url);
    } catch {
      /* the popup closed or never loaded; nothing to move */
    }
    await opened.close().catch(() => {});
  }

  /** Every top-level request is checked against the supplier's hosts before
   * Chrome sends it. Subresources are left alone: shops load their own CDNs. */
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
      if (/^https?:/i.test(url)) this.openExternal(url);
      await this.guard.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" });
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
