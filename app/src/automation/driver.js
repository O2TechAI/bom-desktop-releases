"use strict";

/* The browser actions: the small set every purchasing task is built from.
 *
 *   goto · waitForLoad · waitForUrl · waitFor · exists · peek ·
 *   waitForChange · click · hover · fill · type · press · select · check ·
 *   upload · read · extract · outline · screenshot
 *
 * A Driver works on one supplier page (an Electron WebContents). It reads the
 * page through page-runtime.js in an isolated world and acts through the
 * DevTools protocol's Input domain, so clicks and keys arrive as trusted
 * events at the place a person would click. Before acting it waits until the
 * element is there, visible, still, enabled and not covered, and it shows
 * the pointer moving there first so the person watching can follow.
 *
 * It does not enable the Runtime domain: some sites notice that. */

const { installSource } = require("./page-runtime");
const { normalizeTarget } = require("./targets");


class AutomationError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "AutomationError";
    this.code = code;
    this.detail = detail;
  }
}


const KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageDown: { code: "PageDown", keyCode: 34 },
  PageUp: { code: "PageUp", keyCode: 33 },
  Space: { code: "Space", keyCode: 32, key: " ", text: " " },
};

const DEFAULTS = {
  timeout: 15000,
  navigationTimeout: 45000,
  poll: 100,
  /* How long the pointer takes to reach a target: the --spring-glide settle. */
  pointerTravel: 458,
  /* Between keys, so typing reads as typing. */
  keyDelay: 35,
};

const STALE_CONTEXT = /Cannot find context|Execution context was destroyed|Inspected target navigated|context with specified id/i;


function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(stopped()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(stopped()); }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}


function stopped() {
  return new AutomationError("stopped", "Stopped");
}


function center(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}


function samePlace(a, b) {
  return a && b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}


class Driver {
  /**
   * @param {Electron.WebContents} contents the supplier page
   * @param {object} options
   * @param {string} options.themeCss CSS custom properties for the pointer and highlight
   * @param {(url: string) => boolean} options.mayGo whether goto() may open an address
   * @param {AbortSignal} [options.signal] stops every wait and action
   */
  constructor(contents, { themeCss = "", mayGo = () => true, signal, ...options } = {}) {
    this.contents = contents;
    this.theme = { variables: themeCss };
    this.mayGo = mayGo;
    this.signal = signal;
    this.options = { ...DEFAULTS, ...options };
    this.contextId = null;
    this.pointer = null;
    this.navigations = 0;
    this.onNavigate = () => { this.contextId = null; this.navigations += 1; };
    contents.on("did-navigate", this.onNavigate);
  }

  // ---- plumbing -----------------------------------------------------------

  async attach() {
    if (!this.contents.debugger.isAttached()) await this.contents.debugger.attach("1.3");
  }

  /** Let go of the page without closing up: no protocol connection and no
   * script of ours runs in it until attach() again. For a security check the
   * person does: the page then sees an ordinary browser. */
  release() {
    this.contextId = null;
    if (!this.contents.isDestroyed() && this.contents.debugger.isAttached()) this.contents.debugger.detach();
  }

  /** The page's title as the window knows it (no protocol needed). */
  title() {
    return this.contents.isDestroyed() ? "" : this.contents.getTitle();
  }

  /** Load the page again, without the protocol (after release()). */
  reload() {
    if (!this.contents.isDestroyed()) this.contents.reload();
  }

  /** Whether the page is still loading (no protocol needed). */
  loading() {
    return !this.contents.isDestroyed() && this.contents.isLoading();
  }

  detach() {
    this.contents.removeListener("did-navigate", this.onNavigate);
    if (!this.contents.isDestroyed() && this.contents.debugger.isAttached()) this.contents.debugger.detach();
  }

  checkStopped() {
    if (this.signal?.aborted) throw stopped();
    if (this.contents.isDestroyed()) throw new AutomationError("closed", "The supplier window was closed");
  }

  send(method, params = {}) {
    this.checkStopped();
    return this.contents.debugger.sendCommand(method, params);
  }

  async world() {
    if (this.contextId) return this.contextId;
    const { frameTree } = await this.send("Page.getFrameTree");
    const { executionContextId } = await this.send("Page.createIsolatedWorld", {
      frameId: frameTree.frame.id,
      worldName: "o2-automation",
    });
    const installed = await this.send("Runtime.evaluate", {
      expression: `(${installSource})(${JSON.stringify(this.theme)})`,
      contextId: executionContextId,
      returnByValue: true,
    });
    if (installed.exceptionDetails) throw new Error(`Page runtime failed: ${installed.exceptionDetails.text}`);
    this.contextId = executionContextId;
    return executionContextId;
  }

  /** Call a page-runtime function: page("find", spec, "visible"). */
  async page(fn, ...args) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const contextId = await this.world();
        const result = await this.send("Runtime.evaluate", {
          expression: `globalThis.__o2a.${fn}(...${JSON.stringify(args)})`,
          contextId,
          returnByValue: true,
          awaitPromise: true,
        });
        if (result.exceptionDetails) {
          const message = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
          if (/detached/.test(message)) throw new AutomationError("detached", "The element left the page", { fn });
          throw new Error(message);
        }
        return result.result.value;
      } catch (error) {
        if (error instanceof AutomationError) throw error;
        if (!STALE_CONTEXT.test(error.message) || attempt === 2) throw error;
        this.contextId = null;
        await delay(this.options.poll, this.signal);
      }
    }
    return undefined;
  }

  /** A page-runtime element as a protocol object (for file inputs). */
  async remote(handle) {
    const contextId = await this.world();
    const { result } = await this.send("Runtime.evaluate", {
      expression: `globalThis.__o2a.element(${JSON.stringify(handle)})`,
      contextId,
    });
    return result.objectId;
  }

  async poll(check, { timeout = this.options.timeout, describe }) {
    const deadline = Date.now() + timeout;
    let last;
    for (;;) {
      this.checkStopped();
      try {
        last = await check();
        if (last?.done) return last.value;
      } catch (error) {
        if (!(error instanceof AutomationError) || error.code !== "detached") throw error;
      }
      if (Date.now() >= deadline) throw describe(last);
      await delay(this.options.poll, this.signal);
    }
  }

  // ---- finding ------------------------------------------------------------

  /** Wait for a target to be visible (or "attached", or "hidden"). */
  async waitFor(target, { state = "visible", timeout, params } = {}) {
    const spec = normalizeTarget(target, params);
    return this.poll(async () => {
      const found = await this.page("find", spec, state === "hidden" ? "hidden" : state);
      if (state === "hidden") return { done: found.status === "hidden", value: null, found };
      return { done: found.status === "found", value: found, found };
    }, {
      timeout,
      describe: (last) => (state === "hidden"
        ? new AutomationError("still_visible", "It is still on the page")
        : last?.found?.status === "hidden"
          ? new AutomationError("not_visible", "It is on the page but hidden")
          : new AutomationError("not_found", "It isn't on the page")),
    });
  }

  /** Whether a target is on the page now (or within `timeout`). */
  async exists(target, { timeout = 0, params } = {}) {
    try {
      await this.waitFor(target, { timeout, params });
      return true;
    } catch (error) {
      if (error instanceof AutomationError && ["not_found", "not_visible"].includes(error.code)) return false;
      throw error;
    }
  }

  /** A target's text right now, or "" when it isn't on the page. No waiting. */
  async peek(target, { params, what = "text" } = {}) {
    const found = await this.page("find", normalizeTarget(target, params), "attached");
    if (found.status !== "found") return "";
    try {
      return String((await this.page("read", found.handle, what)) ?? "");
    } catch {
      return "";
    }
  }

  /** Wait until a target's text is no longer `from` (a cart count going up),
   * or until `or` shows up. Returns the new text. */
  async waitForChange(target, from, { or = null, timeout, params } = {}) {
    const alternative = or ? normalizeTarget(or, params) : null;
    return this.poll(async () => {
      const now = await this.peek(target, { params });
      if (now !== from) return { done: true, value: now };
      if (alternative && (await this.page("find", alternative, "visible")).status === "found") return { done: true, value: now };
      return { done: false };
    }, { timeout, describe: () => new AutomationError("unchanged", "Nothing changed on the page") });
  }

  /** Wait until the element can take a click: visible, still, enabled, uncovered. */
  async actionable(target, { timeout, params, enabled = true, ignoreCover = false } = {}) {
    const spec = normalizeTarget(target, params);
    let previous = null;
    return this.poll(async () => {
      const found = await this.page("find", spec, "visible");
      if (found.status !== "found") return { done: false, reason: found.status };
      if (enabled && found.disabled) return { done: false, reason: "disabled" };
      const rect = await this.page("reveal", found.handle);
      if (!samePlace(rect, previous)) { previous = rect; return { done: false, reason: "moving" }; }
      const point = center(rect);
      const hit = ignoreCover ? { ok: true } : await this.page("hit", found.handle, point.x, point.y);
      if (!hit.ok) {
        // Often a sticky header over something near the window's edge: bring
        // it to the middle and look again before calling it covered.
        await this.page("reveal", found.handle, true);
        previous = null;
        return { done: false, reason: "covered", cover: hit.cover };
      }
      return { done: true, value: { ...found, rect, point } };
    }, {
      timeout,
      describe: (last) => {
        if (last?.reason === "disabled") return new AutomationError("disabled", "It can't be used right now");
        if (last?.reason === "covered") return new AutomationError("covered", `Something covers it (${last.cover})`, { cover: last.cover });
        if (last?.reason === "hidden") return new AutomationError("not_visible", "It is on the page but hidden");
        return new AutomationError("not_found", "It isn't on the page");
      },
    });
  }

  // ---- the pointer ----------------------------------------------------------

  /** Glide the visible pointer and the real mouse to (x, y) together. */
  async moveTo(point) {
    const travel = this.options.pointerTravel;
    const from = await this.page("pointTo", point.x, point.y, travel);
    const steps = 12;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      // The spring is mostly done early; ease the real mouse the same way.
      const eased = 1 - (1 - t) ** 3;
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: from.x + (point.x - from.x) * eased,
        y: from.y + (point.y - from.y) * eased,
      });
      await delay(travel / steps, this.signal);
    }
    this.pointer = point;
  }

  async mouseClick(point, clickCount = 1) {
    const base = { x: point.x, y: point.y, button: "left", clickCount };
    await this.page("press", true);
    await this.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed", buttons: 1 });
    await delay(60, this.signal);
    await this.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased", buttons: 0 });
    await this.page("press", false);
  }

  /** Take the highlight away; with `all`, the pointer too (the task is over). */
  async clearMarks({ all = false } = {}) {
    try {
      await this.page(all ? "hide" : "highlight", null);
    } catch {
      /* the page went away; nothing to clear */
    }
  }

  // ---- actions --------------------------------------------------------------

  async goto(url) {
    if (!this.mayGo(url)) throw new AutomationError("blocked", "That address isn't one of this supplier's sites", { url });
    this.checkStopped();
    this.contextId = null;
    try {
      await this.contents.loadURL(url);
    } catch (error) {
      // A redirect aborts the first load (ERR_ABORTED, -3); the page still opens.
      if (error.errno !== -3 && error.code !== "ERR_ABORTED") {
        throw new AutomationError("load_failed", "The page didn't open", { url, reason: error.code || error.message });
      }
    }
    await this.waitForLoad();
  }

  /** Wait until the page has stopped loading and its document is ready. */
  async waitForLoad({ timeout = this.options.navigationTimeout } = {}) {
    // A page that never stops loading (DigiKey's Order History keeps
    // requesting, 2026-11-24) counts as loaded once its document is complete,
    // or ready for 8 s: what is on it is waited for by the steps after.
    const started = Date.now();
    await this.poll(async () => {
      const loading = this.contents.isLoading();
      const state = await this.page("readyState").catch(() => ({ readyState: "loading" }));
      if (state.readyState === "loading") return { done: false };
      const settled = !loading || state.readyState === "complete" || Date.now() - started > 8000;
      return { done: settled, value: state };
    }, { timeout, describe: () => new AutomationError("timeout", "The page took too long to load") });
  }

  /** After a click that may open another page: wait briefly for it to start,
   * then for it to load. A click that stays on the page costs `start` ms. */
  async settle(beforeUrl, { start = 3000 } = {}) {
    const deadline = Date.now() + start;
    while (Date.now() < deadline) {
      this.checkStopped();
      if (this.contents.isLoading() || this.contents.getURL() !== beforeUrl) break;
      await delay(this.options.poll, this.signal);
    }
    await this.waitForLoad();
  }

  async waitForUrl(pattern, { timeout = this.options.navigationTimeout } = {}) {
    const test = pattern instanceof RegExp ? (url) => pattern.test(url) : (url) => url.includes(pattern);
    await this.poll(async () => ({ done: test(this.contents.getURL()) }), {
      timeout,
      describe: () => new AutomationError("timeout", "The page didn't change as expected", { url: this.contents.getURL() }),
    });
  }

  async click(target, { timeout, params, clickCount = 1 } = {}) {
    const found = await this.actionable(target, { timeout, params });
    await this.page("highlight", found.handle);
    await this.moveTo(found.point);
    // A sticky buy box or lazy row can move under the pointer while it glides;
    // look at the same element again and follow it before pressing.
    const again = await this.page("find", normalizeTarget(target, params), "visible");
    if (again.status === "found") {
      const rect = await this.page("reveal", again.handle);
      if (!samePlace(rect, found.rect)) {
        found.rect = rect;
        found.point = center(rect);
        await this.moveTo(found.point);
      }
    }
    await this.mouseClick(found.point, clickCount);
    return found;
  }

  /** Click through the page's own DOM (`js: true` on a click step): for a
   * button a sticky header covers, where a coordinate click would hit the
   * header instead. */
  async clickJs(target, { timeout, params } = {}) {
    const found = await this.actionable(target, { timeout, params, ignoreCover: true });
    await this.page("highlight", found.handle);
    const pressed = await this.page("activate", found.handle);
    if (!pressed) throw new AutomationError("not_found", "The element could not be clicked");
    return found;
  }

  async hover(target, { timeout, params } = {}) {
    const found = await this.actionable(target, { timeout, params, enabled: false });
    await this.page("highlight", found.handle);
    await this.moveTo(found.point);
    return found;
  }

  async press(key, { modifiers = 0 } = {}) {
    const known = KEYS[key];
    if (!known) throw new AutomationError("bad_step", `Unknown key ${key}`);
    const base = {
      key: known.key ?? key,
      code: known.code,
      windowsVirtualKeyCode: known.keyCode,
      nativeVirtualKeyCode: known.keyCode,
      modifiers,
    };
    await this.send("Input.dispatchKeyEvent", known.text
      ? { ...base, type: "keyDown", text: known.text, unmodifiedText: known.text }
      : { ...base, type: "rawKeyDown" });
    await this.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
  }

  /** Type into whatever has focus, a key at a time. */
  async type(text) {
    for (const character of String(text)) {
      if (/^[\x20-\x7e]$/.test(character)) {
        const base = { key: character, text: character, unmodifiedText: character };
        await this.send("Input.dispatchKeyEvent", { ...base, type: "keyDown" });
        await this.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
      } else {
        // Anything a single key can't make (Chinese, symbols) goes in as text.
        await this.send("Input.insertText", { text: character });
      }
      await delay(this.options.keyDelay, this.signal);
    }
  }

  /** Replace a field's value: click it, select what is there, type. */
  /** Set a field's value through the page runtime, even when a cookie
   * dialog covers it (`js: true` on a fill step). */
  async fillJs(target, value, { timeout, params } = {}) {
    const found = await this.actionable(target, { timeout, params, ignoreCover: true });
    await this.page("highlight", found.handle);
    await this.page("setValue", found.handle, String(value ?? ""));
    return this.page("valueOf", found.handle);
  }

  async fill(target, value, { timeout, params } = {}) {
    const found = await this.click(target, { timeout, params });
    const text = String(value ?? "");
    await this.page("focusAndSelect", found.handle);
    if (text) await this.type(text);
    else await this.press("Backspace");
    const now = await this.page("valueOf", found.handle);
    const loose = (input) => String(input).replace(/[\s,]/g, "").toLowerCase();
    if (loose(now) !== loose(text)) {
      // A field that rewrites keystrokes (masks, some frameworks): set it directly.
      await this.page("setValue", found.handle, text);
    }
    return this.page("valueOf", found.handle);
  }

  async select(target, option, { timeout, params } = {}) {
    const found = await this.actionable(target, { timeout, params });
    await this.page("highlight", found.handle);
    await this.moveTo(found.point);
    const picked = await this.page("selectOption", found.handle, option instanceof RegExp
      ? { regex: option.source, flags: option.flags }
      : option);
    if (!picked.ok) {
      throw new AutomationError("no_option", `"${option}" isn't one of the choices`, { options: picked.options });
    }
    return picked.label;
  }

  async check(target, checked = true, { timeout, params } = {}) {
    const found = await this.actionable(target, { timeout, params });
    const state = await this.page("info", found.handle);
    if (state.checked === checked) {
      await this.page("highlight", found.handle);
      return false;
    }
    await this.click(target, { timeout, params });
    return true;
  }

  /** Put files on an <input type=file>. Paths are on this computer. */
  async upload(target, files, { timeout, params } = {}) {
    const found = await this.waitFor(target, { state: "attached", timeout, params });
    const state = await this.page("info", found.handle);
    if (state.tag !== "input" || state.type !== "file") {
      throw new AutomationError("bad_step", "That isn't a file field");
    }
    if (state.visible) {
      await this.page("highlight", found.handle);
      const rect = await this.page("reveal", found.handle);
      await this.moveTo(center(rect));
    }
    await this.send("DOM.setFileInputFiles", { files: [].concat(files), objectId: await this.remote(found.handle) });
    return found;
  }

  async read(target, { what = "text", timeout, params } = {}) {
    const found = await this.waitFor(target, { timeout, params });
    await this.page("highlight", found.handle);
    return this.page("read", found.handle, what);
  }

  /** Rows of a list: [{ field: value }], fields are targets inside each row. */
  async extract(rows, fields, { timeout, params } = {}) {
    const rowSpec = normalizeTarget(rows, params);
    const fieldSpecs = Object.fromEntries(Object.entries(fields).map(([name, field]) => [
      name,
      { target: normalizeTarget(field.target ?? field, params), read: field.read || "text" },
    ]));
    await this.waitFor(rows, { timeout, params });
    return this.page("extract", rowSpec, fieldSpecs);
  }

  /** { name: true|false } for each named target: on the page and visible.
   * A target whose {{value}} the task doesn't have counts as absent. */
  async present(named, { params } = {}) {
    const names = Object.keys(named);
    const specs = names.map((name) => {
      try {
        return normalizeTarget(named[name], params);
      } catch {
        return null;
      }
    });
    const answers = await this.page("present", specs);
    return Object.fromEntries(names.map((name, index) => [name, Boolean(answers[index])]));
  }

  /** The operable parts of the page, for writing a site's target map. */
  async outline(limit) {
    return this.page("outline", limit);
  }

  async screenshot() {
    return (await this.contents.capturePage()).toPNG();
  }
}


module.exports = { AutomationError, DEFAULTS, Driver, KEYS };
