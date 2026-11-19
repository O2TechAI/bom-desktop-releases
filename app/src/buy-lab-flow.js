"use strict";

/* The purchasing flow behind Buy lab: a pasted list of parts runs through the
 * supplier's own pages in the background Chrome, one line at a time, and the
 * window shows the list and its states. The person is only sent to the real
 * page when the shop stops for them (a security check, a sign-in) or when an
 * order needs their yes.
 *
 * It uses the same Runner as the supplier windows, so every promise holds:
 * nothing is approved on the person's behalf, and a task that cannot go on
 * waits instead of guessing. */

const { Runner } = require("./automation/runner");

const MAX_LINES = 50;
const MAX_QTY = 1_000_000;
const REQUIRED_TASKS = ["addToCart", "openCart", "placeOrder", "orders", "track"];

/** Parse "MPN qty" lines: spaces, commas or semicolons between the two. */
function parseLines(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .slice(0, MAX_LINES);
  return lines.map((line) => {
    const match = line.match(/^(.+?)[\s,;]+([\d,]+)\s*$/);
    const mpn = (match ? match[1] : line).trim().replace(/^["']|["']$/g, "");
    const quantity = String(match ? match[2].replace(/,/g, "") : "1");
    return { mpn, quantity };
  }).filter((line) => line.mpn && line.mpn.length <= 120).map((line) => {
    const wanted = Number(line.quantity);
    const quantity = Number.isSafeInteger(wanted) && wanted > 0 && wanted <= MAX_QTY ? String(wanted) : "1";
    return { ...line, quantity };
  });
}


function paramsFor(profile, task, params) {
  const wanted = profile.taskParams?.[task] || [];
  return Object.fromEntries(wanted.map((key) => [key, String(params[key] ?? "")]));
}


class BuyLabFlow {
  constructor({ sites, getLive, onChange }) {
    this.sites = sites.filter((site) => REQUIRED_TASKS.every((task) => site.tasks[task]));
    this.getLive = getLive;
    this.onChange = onChange || (() => {});
    this.status = "idle";
    this.message = null;
    this.supplier = null;
    this.lines = [];
    this.confirm = null;
    this.cart = null;
    this.orderNumber = null;
    this.orders = [];
    this.tracking = [];
    this.runner = null;
    this.running = false;
  }

  state() {
    return {
      status: this.status,
      message: this.message,
      supplier: this.supplier,
      sites: this.sites.map((site) => ({ id: site.id, name: site.name })),
      lines: this.lines,
      confirm: this.confirm,
      cart: this.cart,
      orderNumber: this.orderNumber,
      orders: this.orders,
      tracking: this.tracking,
      running: this.running,
    };
  }

  emit(patch = {}) {
    Object.assign(this, patch);
    this.onChange(this.state());
  }

  async runTask(task, params = {}, attempt = 0) {
    const site = this.sites.find((entry) => entry.id === this.supplier);
    const live = this.getLive(this.supplier);
    if (!site || !live) throw new Error("The supplier page is not ready");
    const runner = new Runner({
      contents: live.browser.link,
      profile: site,
      task,
      params: paramsFor(site, task, params),
      themeCss: "",
      warmupMs: 0,
      navigationGapMs: 250,
      checkSettleMs: 0,
      onChange: (snapshot) => this.observe(snapshot),
    });
    this.runner = runner;
    try {
      const snapshot = await runner.run();
      const refused = snapshot.steps.some((step) => step.error?.code === "blocked");
      if (refused && attempt === 0) {
        this.emit({ message: "reloading-blocked" });
        await live.reload?.();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return this.runTask(task, params, 1);
      }
      if (refused) {
        const error = new Error("blocked");
        error.code = "blocked";
        throw error;
      }
      this.observe(snapshot);
      return snapshot;
    } catch (error) {
      // A shop's own refusal (DataDome's "Access Denied") sometimes clears on
      // one reload; after that it is a failure, not something to wait on.
      if (error?.code === "blocked" && attempt === 0) {
        this.emit({ message: "reloading-blocked" });
        await live.reload?.();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return this.runTask(task, params, 1);
      }
      throw error;
    } finally {
      this.runner = null;
    }
  }

  /** Publish the run's state; a hand-off or a confirmation asks the window to
   * show the person what to do. */
  observe(snapshot) {
    if (snapshot.status === "waiting") {
      this.status = "waiting";
      this.message = snapshot.confirming
        ? "waiting-confirm"
        : snapshot.message || "waiting-person";
      this.confirm = snapshot.confirming || null;
      this.emit();
      return;
    }
    if (snapshot.status === "running") {
      this.status = "running";
      this.confirm = null;
      this.emit();
      return;
    }
    // The task itself finished; the run goes on to the next line.
    this.status = snapshot.status === "stopped" ? "stopped" : "running";
    this.confirm = null;
    this.emit();
  }

  async start({ supplier, text }) {
    if (this.running) throw new Error("A purchase is already running");
    const lines = parseLines(text);
    if (!lines.length) throw new Error("Paste at least one line: part number and quantity");
    if (!this.sites.some((site) => site.id === supplier)) throw new Error(`Unknown supplier ${supplier}`);
    this.supplier = supplier;
    this.lines = lines.map((line, index) => ({ ...line, index, status: "pending", error: null, price: null }));
    this.cart = null;
    this.orderNumber = null;
    this.orders = [];
    this.tracking = [];
    this.confirm = null;
    this.message = null;
    this.status = "running";
    this.running = true;
    this.emit();
    try {
      for (const line of this.lines) {
        this.emit({ message: "adding" });
        line.status = "adding";
        this.emit();
        try {
          const snapshot = await this.runTask("addToCart", { part: line.mpn, quantity: line.quantity });
          const failed = snapshot.steps.find((step) => step.status === "failed");
          if (snapshot.status !== "done") {
            line.status = "failed";
            line.error = failed?.error?.message || snapshot.status;
          } else {
            line.status = "added";
          }
        } catch (error) {
          if (error?.code === "blocked") {
            line.status = "blocked";
            line.error = "";
            this.emit({ status: "failed", message: "blocked" });
            return;
          }
          line.status = "failed";
          line.error = error.message;
        }
        this.emit();
        if (this.status === "stopped") { this.emit({ status: "stopped", message: "stopped" }); return; }
      }

      this.emit({ message: "reading-cart" });
      const cart = await this.runTask("openCart");
      this.cart = Array.isArray(cart.results?.cart) ? cart.results.cart : [];

      this.emit({ message: "placing-order" });
      const placed = await this.runTask("placeOrder");
      this.orderNumber = placed.results?.orderNumber || null;

      this.emit({ message: "reading-orders" });
      const orders = await this.runTask("orders");
      this.orders = Array.isArray(orders.results?.orders) ? orders.results.orders : [];

      this.emit({ message: "tracking" });
      for (const order of this.orders.slice(0, 3)) {
        const number = String(order.number || "").replace(/\D/g, "");
        if (!number) continue;
        try {
          const tracked = await this.runTask("track", { order: number });
          this.tracking.push({
            order: order.number,
            status: tracked.results?.status ?? null,
            shipments: tracked.results?.shipments ?? [],
          });
        } catch (error) {
          this.tracking.push({ order: order.number, status: `failed: ${error.message}`, shipments: [] });
        }
        this.emit();
      }
      this.emit({ status: "done", message: null });
    } catch (error) {
      this.emit({ status: "failed", message: error?.code === "blocked" ? "blocked" : error.message });
    } finally {
      this.running = false;
      this.runner = null;
      this.confirm = null;
      this.emit();
    }
  }

  stop() {
    this.runner?.stop();
    this.emit({ status: "stopped", message: "stopped" });
  }

  approve() {
    const approved = Boolean(this.runner?.approve());
    if (approved) {
      this.confirm = null;
      this.emit({ status: "running", message: "approved" });
    }
    return approved;
  }
}


module.exports = { BuyLabFlow, parseLines, REQUIRED_TASKS };
