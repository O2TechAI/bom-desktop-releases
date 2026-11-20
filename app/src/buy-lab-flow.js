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

const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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


/** A CSV the supplier's BOM tool can read: part and quantity per line. */
function writeBomFile(siteId, lines) {
  const header = siteId === "lcsc" ? "LCSC Part Number,Quantity" : "Part Number,Quantity";
  const body = lines.map((line) => `${line.mpn},${line.quantity}`).join("\n");
  const file = path.join(os.tmpdir(), `o2-bom-${siteId}-${process.pid}-${Date.now()}.csv`);
  fs.writeFileSync(file, `${header}\n${body}\n`, "utf8");
  return file;
}

/** Which column an uploaded file's part numbers are, for a mapping dialog:
 * the supplier's own numbers (DigiKey's end in "-ND") or the makers'. */
function partColumnFor(lines) {
  return lines.length && lines.every((line) => /-ND$/i.test(line.mpn))
    ? "DigiKey Part Number"
    : "Manufacturer Part Number";
}

/* A saved shipping address: these fields, as text. `label` names it in the
 * address book; the rest go to the supplier's form. */
const ADDRESS_FIELDS = ["email", "phone", "customerType", "firstName", "lastName", "company", "line1", "line2", "city", "state", "zip"];
const ADDRESS_REQUIRED = ["email", "phone", "firstName", "lastName", "line1", "city", "state", "zip"];
/* The buyer kind a supplier's form asks for (DigiKey's "Customer type",
 * required): its codes. Without one, 13 Design/Research/Development. */
const CUSTOMER_TYPES = ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "99"];
const DEFAULT_CUSTOMER_TYPE = "13";
const INDIVIDUAL = "10";

/** An address as the flow keeps it: known fields only, trimmed and short; the
 * state a two-letter code. Throws when a required field is missing. */
function cleanAddress(address) {
  const out = { id: String(address.id || ""), label: String(address.label || "").trim().slice(0, 60) };
  for (const field of ADDRESS_FIELDS) out[field] = String(address[field] ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
  out.state = out.state.toUpperCase();
  if (!out.customerType) out.customerType = DEFAULT_CUSTOMER_TYPE;
  if (!CUSTOMER_TYPES.includes(out.customerType)) throw new Error("Unknown customer type");
  // A business buyer needs its company name on the form; an individual not.
  const required = out.customerType === INDIVIDUAL ? ADDRESS_REQUIRED : [...ADDRESS_REQUIRED, "company"];
  const missing = required.filter((field) => !out[field]);
  if (missing.length) throw new Error(`The address is missing ${missing.join(", ")}`);
  if (!/^[A-Z]{2}$/.test(out.state)) throw new Error("The state must be two letters, e.g. OH");
  return out;
}

/* US states (and DC, territories) by their two-letter code: a form that
 * searches by name (LCSC's State) gets the name. */
const US_STATES = {
  AL: "Alabama", AK: "Alaska", AS: "American Samoa", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", GU: "Guam", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", MP: "Northern Mariana Islands", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VI: "US Virgin Islands", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** The task values for a supplier's address form: the fields, and the
 * state's name beside its code. */
function addressParams(address) {
  return {
    ...Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, address[field]])),
    stateName: US_STATES[address.state] || address.state,
    // For a form that takes only digits and "+".
    phoneDigits: String(address.phone || "").replace(/[^\d+]/g, ""),
  };
}

const US_NAMES = /^(us|usa|united states|united states of america)$/i;

/** The BOM site's shipping address (Buying's ship-to: name, company, line1,
 * line2, city, region, postal_code, country, phone, email) as the address the
 * supplier forms take. Only a US address fills them (their forms are the US
 * ones); otherwise null and the person fills the form. Throws, like
 * cleanAddress, when a field the forms need is missing. */
function siteAddress(address) {
  if (!address || typeof address !== "object") return null;
  const country = String(address.country || "US").trim();
  if (!US_NAMES.test(country)) return null;
  const name = String(address.name || "").trim().replace(/\s+/g, " ");
  const cut = name.lastIndexOf(" ");
  const firstName = cut > 0 ? name.slice(0, cut) : name;
  const lastName = cut > 0 ? name.slice(cut + 1) : name;
  const region = String(address.region || "").trim();
  const state = /^[a-z]{2}$/i.test(region)
    ? region.toUpperCase()
    : Object.keys(US_STATES).find((code) => US_STATES[code].toLowerCase() === region.toLowerCase()) || region;
  const company = String(address.company || "").trim();
  return cleanAddress({
    id: String(address.id || ""),
    label: String(address.label || ""),
    email: address.email,
    phone: address.phone,
    customerType: company ? "13" : "10",
    firstName,
    lastName,
    company,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state,
    // DigiKey's form takes the five digits; ZIP+4 is optional.
    zip: String(address.postal_code || "").trim().slice(0, 5),
  });
}

const MAX_SITE_LINES = 200;

/** Buying's order for one supplier ({ supplier, lines: [{ part, quantity }] })
 * as the "part quantity" list Buy lab runs. */
function siteOrderText(order) {
  const lines = Array.isArray(order?.lines) ? order.lines.slice(0, MAX_SITE_LINES) : [];
  return lines.map((line) => {
    const part = String(line?.part || "").trim().replace(/\s+/g, "");
    const quantity = Math.ceil(Number(line?.quantity));
    return part && part.length <= 120 && Number.isFinite(quantity) && quantity > 0 ? `${part} ${quantity}` : "";
  }).filter(Boolean).join("\n");
}

const MAX_ADDRESSES = 20;


/* The address book: shipping addresses the person saved, on this computer
 * only (<userData>/buy-lab/addresses.json), for the supplier's address form.
 * Nothing here is a payment detail or a password. */
class AddressBook {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, "buy-lab", "addresses.json");
  }

  list() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return Array.isArray(saved) ? saved.filter((entry) => entry && typeof entry.id === "string") : [];
    } catch {
      return [];
    }
  }

  find(id) {
    return id ? this.list().find((entry) => entry.id === id) || null : null;
  }

  write(entries) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(entries, null, 2), "utf8");
    fs.renameSync(temp, this.file);
  }

  /** Add or replace one address; it is checked the way a purchase uses it. */
  save(address) {
    const clean = cleanAddress({ ...address, id: address?.id || randomUUID() });
    if (!clean.label) clean.label = `${clean.firstName} ${clean.lastName}, ${clean.city}`;
    const entries = this.list().filter((entry) => entry.id !== clean.id);
    if (entries.length >= MAX_ADDRESSES) throw new Error(`At most ${MAX_ADDRESSES} addresses`);
    this.write([...entries, clean]);
    return clean;
  }

  remove(id) {
    const entries = this.list();
    const kept = entries.filter((entry) => entry.id !== id);
    if (kept.length !== entries.length) this.write(kept);
    return kept.length !== entries.length;
  }
}

/** the page's contents -> BuyLabWindow */
const byContents = new WeakMap();


/** "part | quantity" lines for Mouser's Copy & Paste box. */
function paaLines(lines) {
  return lines.map((line) => `${line.mpn} | ${line.quantity}`).join("\n");
}

/** "quantity, part" lines for the cart's own Bulk Add box. */
function bulkLines(lines) {
  return lines.map((line) => `${line.quantity}, ${line.mpn}`).join("\n");
}

function paramsFor(profile, task, params) {
  const wanted = profile.taskParams?.[task] || [];
  return Object.fromEntries(wanted.map((key) => [key, String(params[key] ?? "")]));
}


class BuyLabFlow {
  constructor({ sites, getLive, onChange, onChallenge }) {
    this.sites = sites.filter((site) => REQUIRED_TASKS.every((task) => site.tasks[task]));
    this.getLive = getLive;
    this.onChange = onChange || (() => {});
    this.onChallenge = onChallenge || (() => {});
    this.challengeOpen = false;
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
    this.stopRequested = false;
    /* Shared by every task of one purchase: the shop is warmed up once. */
    this.session = { warmedUp: false };
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
    if (this.stopRequested) throw stoppedError();
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
      session: this.session,
      onChange: (snapshot) => this.observe(snapshot),
    });
    this.runner = runner;
    try {
      const snapshot = await runner.run();
      if (!snapshot.steps.some((step) => step.error?.code === "blocked")) {
        this.observe(snapshot);
        return snapshot;
      }
    } catch (error) {
      if (error?.code !== "blocked") throw error;
    } finally {
      this.runner = null;
    }
    // A shop's own refusal (DataDome's "Access Denied") sometimes clears on
    // one reload; after that it is a failure, not something to wait on.
    if (attempt > 0) {
      const error = new Error("blocked");
      error.code = "blocked";
      throw error;
    }
    this.emit({ message: "reloading-blocked" });
    await live.reload?.();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    // Come back the way a fresh run would: through the shop's home page.
    this.session.warmedUp = false;
    return this.runTask(task, params, 1);
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
      // A security check is solved in Chrome itself, not on the canvas: hand
      // the real window over for as long as the check is waiting.
      if (!snapshot.confirming && snapshot.message === "challenge" && !this.challengeOpen) {
        this.challengeOpen = true;
        this.onChallenge(true);
      }
      this.emit();
      return;
    }
    if (snapshot.status === "running") {
      this.status = "running";
      this.confirm = null;
      if (this.challengeOpen) {
        this.challengeOpen = false;
        this.onChallenge(false);
      }
      this.emit();
      return;
    }
    if (this.challengeOpen) {
      this.challengeOpen = false;
      this.onChallenge(false);
    }
    // The task itself finished; the run goes on to the next line.
    this.status = snapshot.status === "stopped" ? "stopped" : "running";
    this.confirm = null;
    this.emit();
  }

  async start({ supplier, text, address = null }) {
    if (this.running) throw new Error("A purchase is already running");
    const lines = parseLines(text);
    if (!lines.length) throw new Error("Paste at least one line: part number and quantity");
    if (!this.sites.some((site) => site.id === supplier)) throw new Error(`Unknown supplier ${supplier}`);
    this.supplier = supplier;
    this.address = address ? cleanAddress(address) : null;
    this.stopRequested = false;
    this.session = { warmedUp: false };
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
      const site = this.sites.find((entry) => entry.id === this.supplier);
      if (site?.tasks.bulkAddBom || site?.tasks.bulkAddPaa || site?.tasks.bulkAddList) {
        // One page, one batch: a BOM file or the cart's own Bulk Add box.
        this.emit({ message: "bulk-adding" });
        for (const line of this.lines) line.status = "adding";
        this.emit();
        let snapshot;
        if (site.tasks.bulkAddBom) {
          const file = writeBomFile(this.supplier, this.lines);
          try {
            snapshot = await this.runTask("bulkAddBom", { file, partColumn: partColumnFor(this.lines) });
          } finally {
            try { fs.unlinkSync(file); } catch { /* already gone */ }
          }
        } else if (site.tasks.bulkAddPaa) {
          snapshot = await this.runTask("bulkAddPaa", { lines: paaLines(this.lines) });
        } else {
          snapshot = await this.runTask("bulkAddList", { lines: bulkLines(this.lines) });
        }
        const failed = snapshot.steps.find((step) => step.status === "failed");
        if (snapshot.status === "stopped") {
          // The person stopped it: not a failure of the lines.
          for (const line of this.lines) {
            line.status = "stopped";
            line.error = null;
          }
        } else if (snapshot.status !== "done") {
          for (const line of this.lines) {
            line.status = "failed";
            line.error = failed?.error?.message || snapshot.status;
          }
        } else {
          for (const line of this.lines) line.status = "added";
        }
        this.emit();
        if (this.stopRequested) { this.emit({ status: "stopped", message: "stopped" }); return; }
      } else {
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
        if (this.stopRequested) { this.emit({ status: "stopped", message: "stopped" }); return; }
        }
      }

      // Nothing in the cart from this list: going on would only check out
      // whatever else is there, or walk an empty cart to the checkout.
      if (!this.lines.some((line) => line.status === "added")) {
        this.emit({ status: "failed", message: "nothing-added" });
        return;
      }

      this.emit({ message: "reading-cart" });
      const cart = finished(await this.runTask("openCart"));
      this.cart = Array.isArray(cart.results?.cart) ? cart.results.cart : [];

      this.emit({ message: "placing-order" });
      // A saved address fills the supplier's shipping form, where the site
      // knows how; otherwise that form stays the person's.
      const withAddress = Boolean(this.address && site?.tasks.placeOrderWithAddress);
      const placed = finished(await (withAddress
        ? this.runTask("placeOrderWithAddress", addressParams(this.address))
        : this.runTask("placeOrder")));
      this.orderNumber = placed.results?.orderNumber || null;

      this.emit({ message: "reading-orders" });
      const orders = finished(await this.runTask("orders"));
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
          if (error?.code === "stopped") throw error;
          this.tracking.push({ order: order.number, status: `failed: ${error.message}`, shipments: [] });
        }
        this.emit();
      }
      this.emit({ status: "done", message: null });
    } catch (error) {
      if (error?.code === "stopped") {
        this.emit({ status: "stopped", message: "stopped" });
        return;
      }
      if (error?.code === "blocked") {
        for (const line of this.lines) if (line.status !== "added") line.status = "blocked";
      }
      this.emit({ status: "failed", message: error?.code === "blocked" ? "blocked" : error.message });
    } finally {
      this.running = false;
      this.runner = null;
      this.confirm = null;
      this.emit();
    }
  }

  stop() {
    // Stop ends the purchase, not only the task running now.
    if (this.running) this.stopRequested = true;
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


/** A stage of the purchase that didn't finish ends it: its step's own words,
 * or "stopped" when the person stopped it. */
function finished(snapshot) {
  if (snapshot.status === "done") return snapshot;
  if (snapshot.status === "stopped") throw stoppedError();
  const failed = snapshot.steps.find((step) => step.status === "failed");
  throw new Error(failed?.error?.message || `The ${snapshot.task || "step"} didn't finish`);
}


function stoppedError() {
  const error = new Error("Stopped");
  error.code = "stopped";
  return error;
}


module.exports = { AddressBook, BuyLabFlow, bulkLines, paaLines, parseLines, writeBomFile, cleanAddress, addressParams, siteAddress, siteOrderText, ADDRESS_FIELDS, CUSTOMER_TYPES, US_STATES, REQUIRED_TASKS };
