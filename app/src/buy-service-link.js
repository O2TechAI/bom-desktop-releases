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
   * @param {() => Promise<object>} options.openBuyLab
   * @param {string} options.version
   */
  constructor({ fetch, origin, openBuyLab, version, log = () => {} }) {
    this.fetch = fetch;
    this.origin = origin;
    this.openBuyLab = openBuyLab;
    this.version = version;
    this.log = log;
    this.running = new Map(); // `${pr}:${seller}` -> { job, phase, cartSent, placed }
    // Runs that ended without an order (the person stopped it, the site
    // refused): not started again by themselves; the checkout link does.
    this.ended = new Set();
    this.jobs = [];
    this.timer = null;
    this.busy = false;
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
      const answer = await this.post("heartbeat", { app_version: this.version });
      this.jobs = Array.isArray(answer.jobs) ? answer.jobs : [];
      await this.follow();
    } catch (error) {
      // Not signed in to BOM (401), or a BOM without the service (404): idle.
      if (error.status !== 401 && error.status !== 404) this.log(`buy service: ${error.message}`);
    } finally {
      this.busy = false;
    }
  }

  async follow() {
    const live = new Set(this.jobs.map((job) => `${job.purchase_request_id}:${job.seller}`));
    // Cancelled in BOM, or otherwise over: stop its run.
    for (const [key, run] of this.running) {
      if (!live.has(key) && !run.placed) {
        this.running.delete(key);
        run.stopped = true;
        try {
          (await this.openBuyLab()).stop(run.job.seller);
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
      const lab = await this.openBuyLab();
      const fresh = { job, phase: job.phase, cartSent: job.phase !== "price", placed: false, stopped: false };
      if (lab.startFromService(job, this.linkFor(key, fresh))) {
        this.running.set(key, fresh);
        lab.showFor?.(job.seller);
      }
    }
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
      placed: async ({ orderNumber }) => {
        run.placed = true;
        await this.post("order", {
          purchase_request_id: run.job.purchase_request_id, seller: run.job.seller,
          supplier_order_number: orderNumber ? String(orderNumber).slice(0, 64) : null,
        });
      },
      ended: async ({ status, message }) => {
        this.running.delete(key);
        if (run.placed || run.stopped) return;
        this.ended.add(key);
        const why = String(message || status || "The Buy lab stopped").slice(0, 500);
        if (!run.cartSent) {
          await this.post("cart", { purchase_request_id: run.job.purchase_request_id, seller: run.job.seller, failed: why });
        } else {
          await this.post("order", { purchase_request_id: run.job.purchase_request_id, seller: run.job.seller, failed: why });
        }
      },
    };
  }

  /** The person opened a checkout link: show that order's supplier, and run
   * it again if its run had ended. The seller, or null if it isn't ours. */
  async openOrder(orderId) {
    const job = this.jobs.find((entry) => entry.supplier_order_id === orderId);
    if (!job) return null;
    this.ended.delete(`${job.purchase_request_id}:${job.seller}`);
    await this.follow();
    (await this.openBuyLab()).showFor?.(job.seller);
    return job.seller;
  }
}

module.exports = { ServiceLink, cartReport, TICK_MS };
