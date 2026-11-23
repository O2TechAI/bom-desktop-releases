"use strict";

/* A real Chrome page shown as a picture: the page runs in the person's own
 * Chrome (rebrowser-playwright, headed, off-screen), Page.startScreencast
 * pushes JPEG frames to the app, and mouse/keyboard events are sent back
 * through the DevTools Input domain. It is the "embedded Chrome" the app
 * cannot get from an Electron view, without giving up Chrome's fingerprint.
 *
 * The supplier's navigation guard, profile and downloads are still the ones
 * in chrome-page.js (SupplierBrowser); this only adds the picture and input.
 *
 * Chrome may hold more than one tab (a sign-in elsewhere opens in its own
 * tab, see chrome-page.js). The picture and the input follow the tab being
 * viewed: the main tab (0), or another one the person picks or that just
 * opened. The automation itself only ever drives the main tab. */

const { SupplierBrowser } = require("./automation/chrome-page");
const { hideChromeFromTaskbar } = require("./taskbar");

/* Where the off-screen Chrome window lives; far from any real display so the
 * person only sees the app. */
const OFFSCREEN = ["--window-position=-32000,-32000"];
const CAST = { format: "jpeg", quality: 72, maxWidth: 1600, maxHeight: 1200, everyNthFrame: 1 };

class LiveBrowser {
  static async open({
    profile, profilePath, downloadsPath, bounds, mayGo, challengeMayGo, openExternal, onFrame, onTabs, choices,
  }) {
    const browser = await SupplierBrowser.open({
      profile,
      profilePath,
      downloadsPath,
      bounds: bounds || { left: -32000, top: 0, width: 1280, height: 900 },
      mayGo,
      challengeMayGo,
      openExternal,
      choices,
      args: OFFSCREEN,
    });
    hideChromeFromTaskbar(profilePath);
    const live = new LiveBrowser(browser, onFrame, onTabs);
    await live.start();
    return live;
  }

  constructor(browser, onFrame, onTabs) {
    this.browser = browser;
    this.page = browser.page;
    this.context = browser.context;
    this.onFrame = onFrame || (() => {});
    this.onTabs = onTabs || (() => {});
    this.session = null; // the main tab's: window moves and its picture
    this.viewing = 0; // the tab whose picture and input this is
    this.viewSession = null;
    this.sessions = new Map(); // tab id -> CDP session with the frame handler
    this.frame = null;
    this.closed = false;
  }

  /** A CDP session for a tab, whose frames reach the app while it is viewed. */
  async sessionFor(id) {
    if (this.sessions.has(id)) return this.sessions.get(id);
    const page = this.browser.pageOf(id);
    if (!page) return null;
    const session = await this.context.newCDPSession(page);
    session.on("Page.screencastFrame", (frame) => {
      void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
      if (this.closed || session !== this.viewSession) return;
      this.frame = { data: frame.data, width: frame.metadata?.deviceWidth, height: frame.metadata?.deviceHeight };
      try {
        this.onFrame(this.frame);
      } catch {
        /* the window went away */
      }
    });
    this.sessions.set(id, session);
    page.on("close", () => {
      this.sessions.delete(id);
      if (this.viewing === id) void this.view(0);
    });
    return session;
  }

  async start() {
    this.session = await this.sessionFor(0);
    this.viewSession = this.session;
    // Show the shop, not about:blank.
    await this.browser.link.loadURL(this.browser.profile.urls.home).catch(() => {});
    await this.session.send("Page.startScreencast", CAST);
    this.browser.on("closed", () => { this.closed = true; this.onClose?.(); });
    // Tabs: the list for the app, and a new one shown at once (it is where
    // the person has something to do, e.g. a sign-in elsewhere).
    this.browser.on("tabs", () => this.publishTabs());
    this.browser.on("tab-opened", (id) => { if (id) void this.view(id); });
    this.browser.on("tab-returned", () => { void this.view(0); });
    return this;
  }

  tabs() {
    return { viewing: this.viewing, tabs: this.browser.tabs() };
  }

  publishTabs() {
    if (this.closed) return;
    try {
      this.onTabs(this.tabs());
    } catch {
      /* the window went away */
    }
  }

  /** Show a tab: its picture, its input. 0 is the main tab. */
  async view(id = 0) {
    if (this.closed) return false;
    const page = this.browser.pageOf(id);
    if (!page) return false;
    const session = await this.sessionFor(id).catch(() => null);
    if (!session) return false;
    if (this.viewSession && this.viewSession !== session) {
      await this.viewSession.send("Page.stopScreencast").catch(() => {});
    }
    this.viewing = id;
    this.viewSession = session;
    await page.bringToFront().catch(() => {});
    await session.send("Page.startScreencast", CAST).catch(() => {});
    this.publishTabs();
    return true;
  }

  async closeTab(id) {
    if (!id) return false;
    const closed = await this.browser.closeTab(id);
    if (closed && this.viewing === id) await this.view(0);
    return closed;
  }

  /** Ask Chrome for one fresh frame (after an action that may not repaint). */
  async refresh() {
    if (!this.viewSession || this.closed) return;
    try {
      await this.viewSession.send("Page.stopScreencast");
      await this.viewSession.send("Page.startScreencast", CAST);
    } catch {
      /* Chrome went away */
    }
  }

  /** Load the viewed page again (a shop's refusal sometimes clears on a
   * reload), then ask for fresh frames. */
  async reload() {
    if (this.closed) return false;
    const page = this.browser.pageOf(this.viewing) || this.page;
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await this.refresh();
    return true;
  }

  /** Move Chrome's own window where the person can use it, and stop the
   * stream while they do: a security check is solved in a normal browser, not
   * through a forwarded picture. */
  async handToPerson() {
    if (!this.session || this.closed) return;
    try {
      await this.viewSession.send("Page.stopScreencast");
    } catch {
      /* no stream */
    }
    try {
      const { windowId } = await this.session.send("Browser.getWindowForTarget");
      await this.session.send("Browser.setWindowBounds", {
        windowId,
        bounds: { left: 80, top: 60, width: 1280, height: 900, windowState: "normal" },
      });
      await this.session.send("Page.bringToFront");
    } catch {
      /* Chrome went away */
    }
  }

  /** Take the window back to its off-screen place and stream again. */
  async backFromPerson() {
    if (!this.session || this.closed) return;
    try {
      const { windowId } = await this.session.send("Browser.getWindowForTarget");
      await this.session.send("Browser.setWindowBounds", {
        windowId,
        bounds: { left: -32000, top: 0, width: 1280, height: 900 },
      });
    } catch {
      /* Chrome went away */
    }
    await this.refresh();
  }

  /** Lay the shop out at another size (the window stays off screen): the
   * Buy lab's side-by-side view gives it half the window. No size: back to
   * the usual 1280 × 900. */
  async setSize({ width = 1280, height = 900 } = {}) {
    if (!this.session || this.closed) return;
    try {
      const { windowId } = await this.session.send("Browser.getWindowForTarget");
      await this.session.send("Browser.setWindowBounds", { windowId, bounds: { left: -32000, top: 0, width, height } });
    } catch {
      /* Chrome went away */
    }
    await this.refresh();
  }

  /** Page size in CSS pixels: the picture's own size. */
  size() {
    return this.frame && this.frame.width && this.frame.height
      ? { width: this.frame.width, height: this.frame.height }
      : { width: 1280, height: 900 };
  }

  async input(event = {}) {
    const session = this.viewSession;
    if (this.closed || !session) return false;
    const { width, height } = this.size();
    const at = (value, extent) => Math.max(0, Math.min(extent, Math.round(Number(value || 0) * extent)));
    const x = at(event.x, width);
    const y = at(event.y, height);
    // A click or Enter may send a sign-in form: what it holds is read first,
    // whole (kept-signin.js keeps the person's login for next time).
    if (event.kind === "click" || (event.kind === "key" && /^(Enter|NumpadEnter)$/.test(String(event.key || "")))) {
      // Never in the person's way: at most 400 ms, then the input goes on
      // (2026-11-23: a slow frame on Mouser's sign-in held every click).
      if (this.browser.beforeSend) {
        await Promise.race([
          this.browser.beforeSend().catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 400)),
        ]);
      }
    }
    try {
      switch (event.kind) {
        case "move":
          await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
          return true;
        case "click":
          await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
          await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
          await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
          return true;
        case "wheel":
          await session.send("Input.dispatchMouseEvent", {
            type: "mouseWheel", x, y, deltaX: Math.round(event.deltaX || 0), deltaY: Math.round(event.deltaY || 0),
          });
          return true;
        case "text":
          if (event.text) await session.send("Input.insertText", { text: String(event.text) });
          return true;
        case "key": {
          const key = String(event.key || "");
          const keyCode = KEY_CODES[key];
          if (!keyCode) {
            if (key.length === 1) await session.send("Input.insertText", { text: key });
            return true;
          }
          const base = { key, code: keyCode.code, windowsVirtualKeyCode: keyCode.keyCode, nativeVirtualKeyCode: keyCode.keyCode };
          await session.send("Input.dispatchKeyEvent", keyCode.text
            ? { ...base, type: "keyDown", text: keyCode.text, unmodifiedText: keyCode.text }
            : { ...base, type: "rawKeyDown" });
          await session.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
          return true;
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  async close() {
    this.closed = true;
    await this.browser.close().catch(() => {});
  }
}


const KEY_CODES = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
};


module.exports = { LiveBrowser };
