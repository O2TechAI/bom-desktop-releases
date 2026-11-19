"use strict";

/* The supplier window: the supplier's site in the person's own Chrome, on the
 * left, where they watch every action land (pointer, highlight, typing); and
 * the app's task panel on the right (static/automation.html), which lists each
 * step as it runs and lets the person pause, stop, or take over to sign in.
 *
 * Chrome is a separate, ordinary window; the panel is an Electron window
 * docked at its right edge and follows it as it is moved, resized, minimized
 * or maximized. One supplier per window. Chrome gets its own persistent
 * profile for that supplier, and a navigation guard that keeps it on that
 * supplier's hosts; links elsewhere open in the system browser. */

const fs = require("node:fs");
const path = require("node:path");
const { BaseWindow, WebContentsView, ipcMain, screen, shell } = require("electron");

const { PANEL_WIDTH, launchBounds, panelBounds } = require("./browser");
const { SupplierBrowser } = require("./chrome-page");
const { Runner } = require("./runner");
const { overlayThemeCss } = require("./theme");

/* How often the panel checks where Chrome is. A person dragging the window
 * sees the panel follow within a frame or two. */
const FOLLOW_MS = 600;
/* The panel's ground colour, painted before its first frame (--page). */
const PAGE_GROUND = "#ecf0f3";

/** panel contents -> SupplierWindow, so a command can only steer its own window. */
const panels = new WeakMap();


class SupplierWindow {
  /**
   * @param {object} profile a site profile (sites/index.js)
   * @param {object} options
   * @param {string} options.language en/zh/es
   * @param {string} options.panelUrl the task panel page
   * @param {string} options.panelPartition the BOM session partition
   * @param {string} options.preload the panel's preload
   * @param {string} options.downloadsPath where the shop's downloads go
   * @param {string} options.profilePath Chrome's own profile for this supplier
   * @param {Array} options.browserChoices from browser.js (chrome, then Edge)
   * @param {(url: string) => void} options.openExternal
   * @param {string} [options.logPath] one JSON line per run
   * @param {(window: SupplierWindow) => void} [options.onClosed]
   */
  constructor(profile, {
    language, panelUrl, panelPartition, preload, downloadsPath, profilePath, browserChoices,
    openExternal, logPath = null, onClosed,
  }) {
    this.profile = profile;
    this.language = language;
    this.downloadsPath = downloadsPath;
    this.profilePath = profilePath;
    this.browserChoices = browserChoices;
    this.openExternal = openExternal;
    this.logPath = logPath;
    this.onClosed = onClosed;
    this.browser = null;
    this.runner = null;
    this.lastRun = null;
    this.lastOrders = [];
    this.savedFile = null;
    this.closed = false;
    this.panelHidden = false;
    this.lastPanelBounds = null;
    this.follow = null;
    /* What this window's runs cost in total: how often the shop asked for a
     * security check, and how often it stopped for the person at all. */
    this.metrics = { runs: 0, checks: 0, handoffs: 0, warmups: 0 };

    const area = screen.getPrimaryDisplay().workArea;
    const start = panelBounds(launchBounds(area), area);
    this.window = new BaseWindow({
      x: start.x,
      y: start.y,
      width: Math.max(PANEL_WIDTH, start.width),
      height: start.height,
      minWidth: PANEL_WIDTH,
      minHeight: 480,
      title: `O2 BOM - ${profile.name}`,
      backgroundColor: PAGE_GROUND,
      autoHideMenuBar: process.platform !== "darwin",
      show: false,
    });

    this.panel = new WebContentsView({
      webPreferences: {
        partition: panelPartition,
        preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        navigateOnDragDrop: false,
      },
    });
    this.panel.setBackgroundColor(PAGE_GROUND);
    panels.set(this.panel.webContents, this);
    this.window.contentView.addChildView(this.panel);
    this.layout();
    this.window.on("resize", () => this.layout());
    this.window.on("closed", () => { void this.close(); });

    this.panel.webContents.on("did-finish-load", () => this.publish());
    void this.panel.webContents.loadURL(panelUrl);
  }

  /** Create the window and start its Chrome. Throws when no Chrome or Edge is
   * installed, before anything is shown. */
  static async create(profile, options) {
    const window = new SupplierWindow(profile, options);
    try {
      await window.start();
      return window;
    } catch (error) {
      await window.close();
      throw error;
    }
  }

  async start() {
    this.browser = await SupplierBrowser.open({
      profile: this.profile,
      profilePath: this.profilePath,
      downloadsPath: this.downloadsPath,
      bounds: launchBounds(screen.getPrimaryDisplay().workArea),
      mayGo: this.profile.mayGo,
      challengeMayGo: this.profile.challengeMayGo,
      openExternal: this.openExternal,
      choices: this.browserChoices,
    });
    this.link = this.browser.link;
    this.browser.on("closed", () => { void this.close(); });

    const bounds = await this.browser.windowBounds();
    if (bounds) this.syncPanel(bounds);
    this.window.show();
    this.window.moveTop();
    await this.browser.focus();
    this.follow = setInterval(() => { void this.followChrome(); }, FOLLOW_MS);
    try {
      await this.link.loadURL(this.profile.urls.home);
    } catch (error) {
      console.error(`${this.profile.name} did not open its home page: ${error.message}`);
    }
  }

  layout() {
    if (this.window.isDestroyed()) return;
    const { width, height } = this.window.getContentBounds();
    this.panel.setBounds({ x: 0, y: 0, width, height });
  }

  /** Keep the panel at the site window's right edge. */
  async followChrome() {
    if (this.closed || !this.browser) return;
    const bounds = await this.browser.windowBounds();
    if (bounds) this.syncPanel(bounds);
  }

  syncPanel(chrome) {
    if (this.closed) return;
    const area = screen.getDisplayMatching({
      x: chrome.left, y: chrome.top, width: chrome.width, height: chrome.height,
    }).workArea;
    const minimized = chrome.state === "minimized";
    if (minimized) {
      if (!this.panelHidden) {
        this.panelHidden = true;
        this.window.hide();
      }
      return;
    }
    const next = panelBounds(chrome, area);
    const moved = !this.lastPanelBounds || ["x", "y", "width", "height"].some((key) => (
      Math.abs((this.lastPanelBounds[key] ?? 0) - next[key]) > 1
    ));
    if (moved) {
      this.lastPanelBounds = next;
      this.window.setBounds(next);
      this.layout();
    }
    if (this.panelHidden || !this.window.isVisible()) {
      this.panelHidden = false;
      this.window.show();
    }
  }

  /** What the panel shows: the supplier, its tasks, and the last or current run. */
  view() {
    return {
      supplier: { id: this.profile.id, name: this.profile.name, verified: this.profile.verified },
      language: this.language,
      tasks: Object.keys(this.profile.tasks).map((id) => ({
        id,
        params: this.profile.taskParams[id] || [],
        defaults: this.profile.taskDefaults?.[id] || {},
      })),
      lastOrders: this.lastOrders,
      metrics: this.metrics,
      traffic: this.browser?.stats() ?? null,
      run: this.runner ? this.runner.snapshot() : this.lastRun,
    };
  }

  publish() {
    if (this.closed || this.panel.webContents.isDestroyed()) return;
    this.panel.webContents.send("automation:view", this.view());
  }

  focus() {
    if (this.closed) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.moveTop();
    void this.browser?.focus();
  }

  /** Start a task. Resolves with the run's final snapshot. */
  async run(task, params = {}) {
    if (this.closed) throw new Error("The supplier window was closed");
    if (this.runner) throw new Error("A task is already running in this window");
    const wanted = this.profile.taskParams[task] || [];
    const clean = {};
    for (const name of wanted) {
      const value = String(params[name] ?? "").trim();
      if (!value) throw new Error(`Missing ${name}`);
      if (value.length > 200) throw new Error(`${name} is too long`);
      clean[name] = value;
    }
    if ("quantity" in clean && !/^[1-9]\d{0,8}$/.test(clean.quantity.replace(/,/g, ""))) {
      throw new Error("Quantity must be a whole number");
    }
    if ("quantity" in clean) clean.quantity = clean.quantity.replace(/,/g, "");
    if ("order" in clean && !/^\d{4,20}$/.test(clean.order)) throw new Error("Order number must be digits");
    this.runner = new Runner({
      contents: this.link,
      profile: this.profile,
      task,
      params: clean,
      themeCss: overlayThemeCss(),
      onChange: () => this.publish(),
    });
    try {
      this.lastRun = await this.runner.run();
      await this.keep(this.lastRun);
      await this.record(this.lastRun);
    } finally {
      this.runner = null;
      this.publish();
    }
    return this.lastRun;
  }

  /** Add this run's counts to the window's, and put one line in the log so
   * the checks a site asks for can be compared over days, not guessed. */
  async record(snapshot) {
    const counts = snapshot.metrics || {};
    this.metrics.runs += 1;
    this.metrics.checks += counts.checks || 0;
    this.metrics.handoffs += counts.handoffs || 0;
    this.metrics.warmups += counts.warmups || 0;
    if (!this.logPath) return;
    const line = JSON.stringify({
      at: new Date().toISOString(),
      supplier: this.profile.id,
      task: snapshot.task,
      status: snapshot.status,
      checks: counts.checks ?? 0,
      handoffs: counts.handoffs ?? 0,
      warmups: counts.warmups ?? 0,
      steps: Array.isArray(snapshot.steps) ? snapshot.steps.length : 0,
    });
    try {
      await fs.promises.appendFile(this.logPath, `${line}\n`, { mode: 0o600 });
    } catch (error) {
      console.error(`Automation log not written: ${error.message}`);
    }
  }

  /** Keep what a finished run read that later operations use: the orders
   * (to track one), and a page map, written to Downloads. */
  async keep(snapshot) {
    const results = snapshot.results || {};
    if (snapshot.task === "orders" && Array.isArray(results.orders)) {
      this.lastOrders = results.orders.map((order) => /\d{6,}/.exec(order.number || "")?.[0]).filter(Boolean).slice(0, 50);
    }
    if (snapshot.task === "pageMap" && Array.isArray(results.outline) && this.downloadsPath) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const file = path.join(this.downloadsPath, `${this.profile.id}-page-${stamp}.json`);
      const body = {
        supplier: this.profile.id,
        url: this.link.getURL(),
        title: this.link.getTitle(),
        at: new Date().toISOString(),
        outline: results.outline,
      };
      await fs.promises.writeFile(file, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
      this.savedFile = file;
      results.savedTo = path.basename(file);
      delete results.outline; // the panel shows where it went, not the map
    }
  }

  command(name, payload = {}) {
    switch (name) {
      case "run":
        // Errors in the request come back to the panel; a running task reports through the view.
        return this.run(String(payload.task || ""), payload.params || {}).then(
          (snapshot) => ({ ok: true, status: snapshot.status }),
          (error) => ({ ok: false, message: error.message }),
        );
      case "pause": this.runner?.pause(); return { ok: true };
      case "resume": this.runner?.resume(); return { ok: true };
      case "continue": this.runner?.resume(); return { ok: true };
      case "stop": this.runner?.stop(); return { ok: true };
      case "confirm": return { ok: Boolean(this.runner?.approve()) };
      case "focus": this.focus(); return { ok: true };
      case "reveal":
        if (this.savedFile) shell.showItemInFolder(this.savedFile);
        return { ok: Boolean(this.savedFile) };
      case "view": return { ok: true, view: this.view() };
      default: return { ok: false, message: "Unknown command" };
    }
  }

  /** Close the panel and the supplier's Chrome. Safe to call twice. */
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.runner?.stop();
    if (this.follow) clearInterval(this.follow);
    this.follow = null;
    if (this.browser) await this.browser.close();
    if (!this.panel.webContents.isDestroyed()) this.panel.webContents.close();
    if (!this.window.isDestroyed()) this.window.destroy();
    this.onClosed?.(this);
  }

  /** Where the supplier's page is (Chrome's own window, X11 style), for the
   * panel-free checks and the live-run script. */
  get site() {
    return this.link;
  }
}


/** Wire the panel bridge once. Only a supplier panel may send commands. */
function registerAutomationIpc() {
  ipcMain.handle("automation:command", (event, name, payload) => {
    const owner = panels.get(event.sender);
    if (!owner || event.senderFrame?.parent) return { ok: false, message: "Not allowed" };
    return owner.command(String(name), payload && typeof payload === "object" ? payload : {});
  });
}


module.exports = { PANEL_WIDTH, SupplierWindow, registerAutomationIpc };
