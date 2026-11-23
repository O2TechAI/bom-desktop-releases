"use strict";

/* The desktop's side of the Buy lab service (BOM backend,
 * /api/v1/buy-lab-service): BOM's purchasing service for DigiKey and LCSC,
 * whose buying happens here, in the Buy lab, in the person's own accounts.
 *
 * Every TICK_MS it asks the service for this person's work with the BOM
 * site's own session (the person signed in to BOM in this app), which also
 * tells the service the desktop is online: that is the "connected account".
 * A job is one seller's lines of one BOM purchase request:
 *
 *   price     build a new cart from the lines and read it: its prices are
 *             the live quote BOM compares with what it showed
 *   wait      the cart was dearer: the buyer approves in BOM first; the Buy
 *             lab still gets the order ready, but the yes waits
 *   checkout  the person may say yes in the Buy lab
 *
 * The Buy lab reports the cart, then the order number once the person's yes
 * went through, or that it ended without an order. A job that is gone (the
 * buyer cancelled it in BOM) stops its run. Nothing here confirms an order:
 * the yes is always the person's, in the Buy lab.
 */

const fs = require("node:fs");
const path = require("node:path");

const TICK_MS = 15_000;
const BASE = "/api/v1/buy-lab-service/desk";

function money(text) {
  const match = String(text ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

function partKey(text) {
  return String(text || "").replace(/[‎‏\s]/g, "").toUpperCase();
}

/** The cart's rows, matched to the job's lines by part number. */
function cartReport(job, rows) {
  const byPart = new Map();
  for (const row of rows || []) {
    const key = partKey(row.part);
    if (key && !byPart.has(key)) byPart.set(key, row);
  }
  return job.lines.map((line) => {
    const row = byPart.get(partKey(line.sku)) || byPart.get(partKey(line.mpn));
    if (!row) return { line_id: line.line_id };
    const quantity = money(row.quantity) || line.quantity;
    let unit = money(row.unitPrice);
    if (!unit && money(row.extended) && Number(quantity) > 0) unit = String(Number(money(row.extended)) / Number(quantity));
    return { line_id: line.line_id, unit_price: unit, quantity, sku: line.sku };
  });
}

class ServiceLink {
  /**
   * @param {object} options
   * @param {(url: string, init: object) => Promise<Response>} options.fetch  the BOM site session's fetch
   * @param {string} options.origin  the BOM site
   * @param {(options?: { quiet?: boolean }) => Promise<object>} options.openBuyLab the Buy lab; `quiet` opens it out of sight
   * @param {string} options.version
   */
  constructor({ fetch, origin, openBuyLab, version, log = () => {}, onStatus = () => {}, stateFile = null }) {
    this.onStatus = onStatus;
    // How the last call to the service went, for the Buy lab to show:
    // { state: "ok" } or { state: "error", http, message }.
    this.status = { state: "unknown" };
    this.fetch = fetch;
    this.origin = origin;
    this.openBuyLab = openBuyLab;
    this.version = version;
    this.log = log;
    this.running = new Map(); // `${pr}:${seller}` -> { job, phase, cartSent, placed }
    // Runs that ended without an order (the person stopped it, the site
    // refused): not started again by themselves; the checkout link does.
    this.ended = new Set();
    // Why each ended run stopped, for BOM's Placing tab: key -> { job, message }.
    this.stops = new Map();
    // Both kept on disk (2026-11-23: "修一下重启后自动重新开始的问题"): a run
    // the person stopped stays stopped when the app starts again, and BOM
    // still shows it stopped, until the person presses Continue.
    this.stateFile = stateFile;
    this.loadState();
    this.jobs = [];
    // Placed orders BOM wants looked up on the seller's page (2026-11-23):
    // one at a time, out of sight, each at most every ten minutes from here.
    this.trackTried = new Map(); // supplier order id -> when
    this.trackBusy = false;
    this.timer = null;
    this.busy = false;
  }

  loadState() {
    if (!this.stateFile) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
      for (const key of saved.ended || []) this.ended.add(String(key));
      for (const [key, stop] of Object.entries(saved.stops || {})) {
        if (stop?.job?.purchase_request_id && stop.job.seller) this.stops.set(key, { job: stop.job, message: stop.message || "stopped" });
      }
    } catch {
      // none yet
    }
  }

  saveState() {
    if (!this.stateFile) return;
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      const stops = Object.fromEntries([...this.stops].map(([key, { job, message }]) => [key, {
        job: { purchase_request_id: job.purchase_request_id, seller: job.seller, supplier_order_id: job.supplier_order_id || null },
        message,
      }]));
      fs.writeFileSync(this.stateFile, JSON.stringify({ ended: [...this.ended], stops }, null, 2));
    } catch (error) {
      this.log(`buy service: could not keep the stopped runs: ${error.message}`);
    }
  }

  /** The person pressed Continue in the Buy lab on a run saved before the app
   * started again: it goes on as BOM's job (with its link), from where it
   * was. False when that run is not one of BOM's stopped ones. */
  async continueSaved(seller, resumeKey) {
    const key = String(resumeKey || "");
    if (!key.endsWith(`:${seller}`) || !(this.ended.has(key) || this.stops.has(key))) return false;
    this.ended.delete(key);
    this.stops.delete(key);
    this.saveState();
    await this.follow();
    // BOM's job either way: started now, or when this seller is free.
    return this.running.has(key) || this.jobs.some((job) => `${job.purchase_request_id}:${job.seller}` === key);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async post(path, body) {
    const response = await this.fetch(`${this.origin}${BASE}/${path}`, {
      method: "POST",
      credentials: "include", // the BOM session cookie: who this desktop works for
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = new Error(`${path}: HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  /** One round: say we're here, take the work, start what can start. */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const answer = await this.post("heartbeat", { app_version: this.version, activity: this.activity() });
      this.setStatus({ state: "ok" });
      this.jobs = Array.isArray(answer.jobs) ? answer.jobs : [];
      await this.follow();
      if (Array.isArray(answer.track) && answer.track.length) void this.track(answer.track);
    } catch (error) {
      // Nothing decides beforehand whether the service is there: the call is
      // made, and what it answered is shown (not signed in to BOM, a site
      // without the service, the service failing, no network).
      if (this.setStatus({ state: "error", http: error.status || null, message: String(error.message || error).slice(0, 200) })) {
        this.log(`buy service: ${error.message}`);
      }
    } finally {
      this.busy = false;
    }
  }

  async follow() {
    const live = new Set(this.jobs.map((job) => `${job.purchase_request_id}:${job.seller}`));
    // A run BOM no longer has (cancelled, done) is forgotten.
    let forgot = false;
    for (const key of [...this.stops.keys()]) if (!live.has(key)) { this.stops.delete(key); forgot = true; }
    for (const key of [...this.ended]) if (!live.has(key)) { this.ended.delete(key); forgot = true; }
    if (forgot) this.saveState();
    // Cancelled in BOM, or otherwise over: stop its run.
    for (const [key, run] of this.running) {
      if (!live.has(key) && !run.placed) {
        this.running.delete(key);
        run.stopped = true;
        try {
          // Finish the line in hand first, so the cart isn't left half changed.
          (await this.openBuyLab({ quiet: true })).stop(run.job.seller, { soft: true });
        } catch { /* the Buy lab is closed */ }
      }
    }
    for (const job of this.jobs) {
      const key = `${job.purchase_request_id}:${job.seller}`;
      if (this.ended.has(key)) continue;
      const run = this.running.get(key);
      if (run) {
        run.phase = job.phase;
        run.job = job;
        continue;
      }
      // One purchase per supplier at a time: the next waits for its turn.
      if ([...this.running.values()].some((other) => other.job.seller === job.seller)) continue;
      // Out of sight: BOM's Placing tab follows it (2026-11-21).
      const lab = await this.openBuyLab({ quiet: true });
      this.lab = lab;
      const fresh = { job, phase: job.phase, cartSent: job.phase !== "price", placed: false, stopped: false };
      if (lab.startFromService(job, this.linkFor(key, fresh))) {
        this.running.set(key, fresh);
        lab.showFor?.(job.seller, { quiet: true });
      }
    }
  }

  /** Look up placed orders on their sellers' pages, one after another, and
   * tell BOM what each page said. A seller busy with a purchase is skipped
   * this time; BOM asks again. */
  async track(due) {
    if (this.trackBusy) return;
    this.trackBusy = true;
    try {
      for (const item of due) {
        const tried = this.trackTried.get(item.supplier_order_id) || 0;
        if (Date.now() - tried < 10 * 60 * 1000) continue;
        // A purchase for this seller, running or waiting its turn, comes first.
        if ([...this.running.values()].some((run) => run.job.seller === item.seller)) continue;
        if (this.jobs.some((job) => job.seller === item.seller && !this.ended.has(`${job.purchase_request_id}:${job.seller}`))) continue;
        let lab;
        try {
          lab = await this.openBuyLab({ quiet: true });
        } catch {
          return;
        }
        if (!lab?.trackOrder) return;
        const read = await lab.trackOrder(item.seller, item.supplier_order_number);
        if (!read) continue; // busy: next time
        this.trackTried.set(item.supplier_order_id, Date.now());
        try {
          await this.post("tracking", {
            purchase_request_id: item.purchase_request_id, supplier_order_id: item.supplier_order_id, ...read,
          });
        } catch (error) {
          this.log(`buy service: tracking ${item.seller} ${item.supplier_order_number}: ${error.message}`);
        }
      }
    } finally {
      this.trackBusy = false;
    }
  }

  /** What each of BOM's runs is doing right now, for its Orders page: the step,
   * who has the supplier page (the app or the person), lines done of total.
   * BOM locks a seller the app is working on (2026-11-21). */
  activity() {
    const out = [];
    // Ended without an order and waiting for the person's Continue in the Buy
    // lab: BOM shows it as stopped, with why (2026-11-21: it waited for ever).
    for (const { job, message } of this.stops.values()) {
      out.push({ purchase_request_id: job.purchase_request_id, seller: job.seller, step: "stopped", driver: "none",
        message: String(message || "stopped").slice(0, 64) });
    }
    for (const run of this.running.values()) {
      const now = this.lab?.activity?.(run.job.seller);
      if (!now) continue;
      out.push({ purchase_request_id: run.job.purchase_request_id, seller: run.job.seller, ...now });
    }
    return out.slice(0, 20);
  }

  /** A run changed step or who drives: tell BOM soon, not at the next tick. */
  nudge() {
    if (this.nudgeTimer) return;
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null;
      void this.tick();
    }, 2000);
  }

  setStatus(status) {
    const changed = JSON.stringify(status) !== JSON.stringify(this.status);
    this.status = status;
    if (changed) this.onStatus(status);
    return changed;
  }

  /** What the flow tells the service, for one job. */
  linkFor(key, run) {
    return {
      cart: async (rows) => {
        if (run.cartSent) return;
        run.cartSent = true;
        await this.post("cart", { purchase_request_id: run.job.purchase_request_id, seller: run.job.seller, cart: cartReport(run.job, rows) });
        void this.tick();
      },
      mayConfirm: () => run.phase === "checkout",
      changed: () => this.nudge(),
      placed: async ({ orderNumber }) => {
        run.placed = true;
        await this.post("order", {
          purchase_request_id: run.job.purchase_request_id, seller: run.job.seller,
          supplier_order_number: orderNumber ? String(orderNumber).slice(0, 64) : null,
        });
      },
      // Ended without an order. Only a list that never went into the cart is
      // over (BOM learns its lines can't be had here); anything else was
      // interrupted (stopped, a page it didn't know, the app closing) and
      // waits for the person's Continue in the Buy lab, or for the buyer to
      // cancel it in BOM. It is not started again by itself.
      ended: async ({ status, message }) => {
        this.running.delete(key);
        if (run.placed || run.stopped) return;
        this.ended.add(key);
        this.saveState();
        // A failure before the cart was reported is BOM's to know: its lines
        // can't be had this time (the order shows "Did not go through"). A
        // stop (the person, a page the app didn't know) can go on: BOM shows
        // it as stopped until the person presses Continue in the Buy lab.
        // Waiting on the person, not a part the seller lacks (2026-11-23: a
        // security check nobody finished in 15 minutes marked the line as not
        // to be had): such an end is a stop, continued from the Buy lab.
        const forPerson = /in time|challenge|blocked|security|lost|stalled|sign.?in|stopped/i.test(String(message || ""));
        if (status === "failed" && !run.cartSent && !forPerson) {
          const why = String(message || "The Buy lab could not build the cart").slice(0, 500);
          await this.post("cart", { purchase_request_id: run.job.purchase_request_id, seller: run.job.seller, failed: why });
          return;
        }
        this.stops.set(key, { job: run.job, message: message || status || "stopped" });
        this.saveState();
        this.nudge?.();
      },
      // The person pressed Continue: the job is this run's again.
      resumed: () => {
        this.ended.delete(key);
        this.stops.delete(key);
        this.saveState();
        run.stopped = false;
        this.running.set(key, run);
      },
    };
  }

  /** The person opened a checkout link: show that order's supplier, and run
   * it again if its run had ended. The seller, or null if it isn't ours. */
  async openOrder(orderId) {
    const job = this.jobs.find((entry) => entry.supplier_order_id === orderId);
    if (!job) return null;
    this.ended.delete(`${job.purchase_request_id}:${job.seller}`);
    this.stops.delete(`${job.purchase_request_id}:${job.seller}`);
    this.saveState();
    await this.follow();
    (await this.openBuyLab()).showFor?.(job.seller);
    return job.seller;
  }
}

module.exports = { ServiceLink, cartReport, TICK_MS };
