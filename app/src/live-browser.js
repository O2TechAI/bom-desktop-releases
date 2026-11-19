"use strict";

/* A real Chrome page shown as a picture: the page runs in the person's own
 * Chrome (rebrowser-playwright, headed, off-screen), Page.startScreencast
 * pushes JPEG frames to the app, and mouse/keyboard events are sent back
 * through the DevTools Input domain. It is the "embedded Chrome" the app
 * cannot get from an Electron view, without giving up Chrome's fingerprint.
 *
 * The supplier's navigation guard, profile and downloads are still the ones
 * in chrome-page.js (SupplierBrowser); this only adds the picture and input. */

const { SupplierBrowser } = require("./automation/chrome-page");

/* Where the off-screen Chrome window lives; far from any real display so the
 * person only sees the app. */
const OFFSCREEN = ["--window-position=-32000,-32000"];

class LiveBrowser {
  static async open({
    profile, profilePath, downloadsPath, bounds, mayGo, challengeMayGo, openExternal, onFrame, choices,
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
    const live = new LiveBrowser(browser, onFrame);
    await live.start();
    return live;
  }

  constructor(browser, onFrame) {
    this.browser = browser;
    this.page = browser.page;
    this.context = browser.context;
    this.onFrame = onFrame || (() => {});
    this.session = null;
    this.frame = null;
    this.closed = false;
  }

  async start() {
    this.session = await this.context.newCDPSession(this.page);
    this.session.on("Page.screencastFrame", (frame) => {
      if (this.closed) return;
      this.frame = { data: frame.data, width: frame.metadata?.deviceWidth, height: frame.metadata?.deviceHeight };
      try {
        this.onFrame(this.frame);
      } catch {
        /* the window went away */
      }
      void this.session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    });
    // Show the shop, not about:blank.
    await this.browser.link.loadURL(this.browser.profile.urls.home).catch(() => {});
    await this.session.send("Page.startScreencast", {
      format: "jpeg",
      quality: 72,
      maxWidth: 1600,
      maxHeight: 1200,
      everyNthFrame: 1,
    });
    this.browser.on("closed", () => { this.closed = true; this.onClose?.(); });
    return this;
  }

  /** Ask Chrome for one fresh frame (after an action that may not repaint). */
  async refresh() {
    if (!this.session || this.closed) return;
    try {
      await this.session.send("Page.stopScreencast");
      await this.session.send("Page.startScreencast", {
        format: "jpeg", quality: 72, maxWidth: 1600, maxHeight: 1200, everyNthFrame: 1,
      });
    } catch {
      /* Chrome went away */
    }
  }

  /** Load the page again (a shop's refusal sometimes clears on a reload),
   * then ask for fresh frames. */
  async reload() {
    if (this.closed) return false;
    await this.page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await this.refresh();
    return true;
  }

  /** Page size in CSS pixels: the picture's own size. */
  size() {
    return this.frame && this.frame.width && this.frame.height
      ? { width: this.frame.width, height: this.frame.height }
      : { width: 1280, height: 900 };
  }

  async input(event = {}) {
    if (this.closed || !this.session) return false;
    const { width, height } = this.size();
    const at = (value, extent) => Math.max(0, Math.min(extent, Math.round(Number(value || 0) * extent)));
    const x = at(event.x, width);
    const y = at(event.y, height);
    try {
      switch (event.kind) {
        case "move":
          await this.session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
          return true;
        case "click":
          await this.session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
          await this.session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
          await this.session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
          return true;
        case "wheel":
          await this.session.send("Input.dispatchMouseEvent", {
            type: "mouseWheel", x, y, deltaX: Math.round(event.deltaX || 0), deltaY: Math.round(event.deltaY || 0),
          });
          return true;
        case "text":
          if (event.text) await this.session.send("Input.insertText", { text: String(event.text) });
          return true;
        case "key": {
          const key = String(event.key || "");
          const keyCode = KEY_CODES[key];
          if (!keyCode) {
            if (key.length === 1) await this.session.send("Input.insertText", { text: key });
            return true;
          }
          const base = { key, code: keyCode.code, windowsVirtualKeyCode: keyCode.keyCode, nativeVirtualKeyCode: keyCode.keyCode };
          await this.session.send("Input.dispatchKeyEvent", keyCode.text
            ? { ...base, type: "keyDown", text: keyCode.text, unmodifiedText: keyCode.text }
            : { ...base, type: "rawKeyDown" });
          await this.session.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
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
