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


/* How far one purchase got. A stage that is done is not done again when the
 * purchase continues after an interruption. */
const STAGE = { NEW: 0, ADDED: 1, CART_CONFIRMED: 2, PLACED: 3 };

/* The app works on its own without the person between these: no change at all
 * for this long while it is the app's turn means it is stuck; it lets go and
 * the person takes over (2026-11-21: 机器操作的环节不能让人干预, with a timeout). */
const STALL_MS = 3 * 60 * 1000;

/* Up to this many lines, a list is added part by part rather than in one batch. */
const SHORT_LIST = 5;

/** The order number in what a confirmation page said around it (2026-11-23:
 * Mouser's whole sentence reached BOM as the number). DigiKey's sales order
 * id is the one its order history and tracking use, before its web id. */
function orderNumberOf(text) {
  const said = String(text || "").replace(/\s+/g, " ").trim();
  if (!said) return null;
  const named = said.match(/sales ?order id\s*:?\s*([A-Z0-9-]{5,})/i)
    || said.match(/order (?:number|#|no\.?)\s*:?\s*([A-Z0-9-]{5,})/i);
  if (named) return named[1];
  const digits = said.match(/\d{6,}/);
  return digits ? digits[0] : said.slice(0, 64);
}

/** Which part of the purchase a run message belongs to, for BOM's Placing tab. */
function phaseOf(message) {
  if (["adding", "bulk-adding", "reloading-blocked"].includes(message)) return "cart";
  if (message === "reading-cart") return "reading";
  if (["placing-order", "cart-confirmed"].includes(message)) return "checkout";
  if (["reading-orders", "tracking"].includes(message)) return "after";
  return message || "";
}

function partKey(text) {
  return String(text || "").replace(/[‎‏\s]/g, "").toUpperCase();
}

function amount(text) {
  const match = String(text ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/** The cart against the list: each line found, missing, at another quantity
 * or dearer than expected; every cart line the list doesn't have is extra.
 * `expected` maps a part to the unit price BOM showed, where it is known. */
function compareCart(lines, rows, expected = {}) {
  const cartRows = (rows || []).filter((row) => partKey(row.part));
  const used = new Set();
  const checked = lines.map((line) => {
    // By the row's part number, else by the MPN in its text: a line bought by
    // its MPN shows the seller's own number in the cart (2026-11-23: DigiKey's
    // 490-3261-1-ND for GRM155R71C104KA88D).
    const key = partKey(line.mpn);
    let index = cartRows.findIndex((row, at) => !used.has(at) && partKey(row.part) === key);
    if (index < 0 && key.length >= 6) index = cartRows.findIndex((row, at) => !used.has(at) && partKey(row.text).includes(key));
    const row = index >= 0 ? cartRows[index] : null;
    if (index >= 0) used.add(index);
    const unitPrice = row ? amount(row.unitPrice) : null;
    const expectedPrice = expected[partKey(line.mpn)] != null ? Number(expected[partKey(line.mpn)]) : null;
    let issue = null;
    if (!row) issue = "missing";
    else if (amount(row.quantity) !== Number(line.quantity)) issue = "quantity";
    else if (unitPrice != null && expectedPrice != null && unitPrice > expectedPrice + 1e-9) issue = "price";
    return {
      part: line.mpn, quantity: String(line.quantity), cartQuantity: row ? String(amount(row.quantity) ?? "") : null,
      unitPrice: row?.unitPrice || null, extended: row?.extended || null, expectedPrice, issue,
    };
  });
  const extra = cartRows.filter((_, at) => !used.has(at)).map((row) => ({
    part: row.part, quantity: null, cartQuantity: String(amount(row.quantity) ?? ""), unitPrice: row.unitPrice || null,
    extended: row.extended || null, expectedPrice: null, issue: "extra",
  }));
  const all = [...checked, ...extra];
  const total = all.reduce((sum, line) => sum + (amount(line.extended) ?? 0), 0);
  return { lines: all, total: total ? total.toFixed(2) : null, issues: all.filter((line) => line.issue).length };
}

/** The same cart as the one the person confirmed: same parts, same quantities. */
function sameCart(a, b) {
  const shape = (rows) => (rows || []).filter((row) => partKey(row.part))
    .map((row) => `${partKey(row.part)}x${amount(row.quantity)}`).sort().join("|");
  return shape(a) === shape(b);
}

/** Each supplier's purchase in progress, on this computer, so it can go on
 * after the app was closed: `<userData>/buy-lab/runs/<supplier>.json`. */
class RunStore {
  constructor(userDataDir) {
    this.dir = userDataDir ? path.join(userDataDir, "buy-lab", "runs") : null;
  }

  /* One file per supplier for its latest run (the Continue of a run saved
   * before the app closed), and one per order (`key`, its resumeKey), so each
   * order of a supplier goes on from its own place (2026-11-24). */
  file(supplier, key = "") {
    if (!this.dir) return null;
    const name = String(supplier).replace(/[^a-z0-9-]/gi, "");
    const own = key ? `--${String(key).replace(/[^a-z0-9_-]/gi, "_").slice(0, 120)}` : "";
    return path.join(this.dir, `${name}${own}.json`);
  }

  load(supplier, key = "") {
    try {
      return JSON.parse(fs.readFileSync(this.file(supplier, key), "utf8"));
    } catch {
      return null;
    }
  }

  save(supplier, record) {
    if (!this.dir) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const text = JSON.stringify({ ...record, savedAt: new Date().toISOString() }, null, 2);
    fs.writeFileSync(this.file(supplier), text);
    if (record?.resumeKey) fs.writeFileSync(this.file(supplier, record.resumeKey), text);
  }

  clear(supplier, key = "") {
    if (key) {
      try { fs.unlinkSync(this.file(supplier, key)); } catch { /* none */ }
      if (this.load(supplier)?.resumeKey !== key) return;
    }
    try { fs.unlinkSync(this.file(supplier)); } catch { /* none */ }
  }
}


class BuyLabFlow {
  constructor({ sites, getLive, onChange, onChallenge, store = null }) {
    this.sites = sites.filter((site) => REQUIRED_TASKS.every((task) => site.tasks[task]));
    this.store = store;
    this.progress = STAGE.NEW;
    this.resumeKey = null;
    this.text = "";
    this.expected = {};
    this.rehearsal = false;
    this.rehearsalYes = false;
    this.cartCheck = null;
    this.confirmedCart = null;
    this.placed = null;
    this.decide = null;
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
    this.link = null;
    this.orderNumber = null;
    this.orders = [];
    this.tracking = [];
    this.runner = null;
    this.running = false;
    this.stopRequested = false;
    // Stop asked once while the app works: it finishes the line (the step) it
    // is on and then stops; asked again, it stops at once.
    this.softStop = false;
    this.stalled = false;
    this.lastChangeAt = 0;
    this.phase = "";
    this.phaseSince = null;
    /* Shared by every task of one purchase: the shop is warmed up once. */
    this.session = { warmedUp: false };
  }

  state() {
    return {
      status: this.status,
      message: this.message,
      // Why the order's ship-to was not filled in on the supplier's form.
      addressNote: this.addressNote || null,
      supplier: this.supplier,
      sites: this.sites.map((site) => ({ id: site.id, name: site.name })),
      lines: this.lines,
      confirm: this.confirm,
      cart: this.cart,
      orderNumber: this.orderNumber,
      orders: this.orders,
      tracking: this.tracking,
      running: this.running,
      progress: this.progress,
      cartCheck: this.cartCheck,
      placed: this.placed,
      rehearsal: this.rehearsal,
      // The app has the supplier page now (adding, reading the cart, filling the
      // checkout): the person's clicks and keys are held back until it is theirs.
      driving: this.driving(),
      phase: this.phase,
      phaseSince: this.phaseSince,
      done: this.lines.filter((line) => ["added", "failed", "blocked"].includes(line.status)).length,
      total: this.lines.length,
      softStop: this.softStop,
      totalCheck: this.totalCheck(),
      // Ended before its order went through, with something done: it can go on.
      canResume: !this.running && this.progress > STAGE.NEW && this.progress < STAGE.PLACED
        && ["failed", "stopped"].includes(this.status),
    };
  }

  /** The app has the page: running, not waiting on the person. */
  driving() {
    return Boolean(this.running && this.status === "running" && !this.decide && !this.confirm);
  }

  /** At the order's yes: the review page's total against the cart the person
   * confirmed, so a cart changed since (in another browser, say) shows. */
  totalCheck() {
    if (!this.confirm || !this.confirmedCart) return null;
    const cart = this.confirmedCart.reduce((sum, row) => sum + (amount(row.extended) ?? 0), 0);
    const review = amount(this.confirm.value);
    if (!cart || review == null) return null;
    // The review page adds shipping and tax: only a goods total above it is wrong.
    return { cart: cart.toFixed(2), review: review.toFixed(2), lower: review + 0.005 < cart };
  }

  emit(patch = {}) {
    Object.assign(this, patch);
    this.lastChangeAt = Date.now();
    const phase = phaseOf(this.message);
    if (this.running && phase && phase !== this.phase) {
      this.phase = phase;
      this.phaseSince = new Date().toISOString();
    }
    const said = `${this.phase}|${this.status}|${this.driving()}|${this.softStop}|${this.lines.filter((line) => line.status === "added").length}`;
    if (said !== this.lastSaid) {
      this.lastSaid = said;
      if (this.link?.changed) this.link.changed();
    }
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
    this.lastChangeAt = Date.now();
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

  /* `link`: a purchase the Buy lab service (BOM's purchasing service) handed
   * over, told what happens: `cart(rows)` once the cart is read (its live
   * quote), `mayConfirm()` whether the buyer has approved what BOM must
   * approve first, `placed({ orderNumber })` after the person's yes went
   * through, `ended(state)` when the run ends however it ends, `resumed()`
   * when the person continues it. Without it a purchase runs as it always has.
   *
   * `rehearsal`: everything up to the order's yes on the real site; the yes
   * then stops there, Submit is never pressed, and the purchase is marked
   * placed as a rehearsal so the after-purchase steps can be run. Not for a
   * purchase BOM handed over: BOM would record an order that doesn't exist.
   *
   * `resumeKey`: the purchase this is. When this supplier's saved progress has
   * the same key, the stages already done are not done again. `expected`:
   * part -> the unit price BOM showed, for the cart check. */
  async start({ supplier, text, address = null, link = null, rehearsal = false, resumeKey = null, expected = null }) {
    if (this.running) throw new Error("A purchase is already running");
    const lines = parseLines(text);
    if (!lines.length) throw new Error("Paste at least one line: part number and quantity");
    if (!this.sites.some((site) => site.id === supplier)) throw new Error(`Unknown supplier ${supplier}`);
    this.supplier = supplier;
    this.text = text;
    this.address = address ? cleanAddress(address) : null;
    this.link = link;
    this.rehearsal = Boolean(rehearsal) && !link;
    this.expected = Object.fromEntries(Object.entries(expected || {}).map(([part, price]) => [partKey(part), Number(price)]));
    this.lines = lines.map((line, index) => ({ ...line, index, status: "pending", error: null, price: null }));
    this.cart = null;
    this.orderNumber = null;
    this.orders = [];
    this.tracking = [];
    this.placed = null;
    this.cartCheck = null;
    this.freshCart = null;
    const saved = resumeKey ? this.store?.load(supplier, resumeKey) : null;
    if (saved && saved.resumeKey === resumeKey && saved.progress > STAGE.NEW && saved.progress < STAGE.PLACED) {
      // The same purchase, interrupted earlier: go on from where it got to.
      this.progress = saved.progress;
      this.confirmedCart = saved.confirmedCart || null;
      for (const line of this.lines) line.status = "added";
    } else {
      this.progress = STAGE.NEW;
      this.confirmedCart = null;
    }
    this.resumeKey = resumeKey || randomUUID();
    await this.run();
  }

  /** Go on with the purchase that ended before its order: from the stage it got to. */
  async resume() {
    if (this.running) throw new Error("A purchase is already running");
    if (!(this.progress > STAGE.NEW && this.progress < STAGE.PLACED)) throw new Error("There is nothing to continue");
    this.link?.resumed?.();
    await this.run();
  }

  save() {
    this.store?.save(this.supplier, {
      resumeKey: this.resumeKey, supplier: this.supplier, text: this.text, address: this.address,
      rehearsal: this.rehearsal, progress: this.progress, confirmedCart: this.confirmedCart,
    });
  }

  async run() {
    this.stopRequested = false;
    this.softStop = false;
    this.stalled = false;
    this.phase = "";
    this.phaseSince = null;
    this.lastChangeAt = Date.now();
    const watchdog = setInterval(() => {
      if (!this.driving() || Date.now() - this.lastChangeAt < STALL_MS) return;
      // Stuck on the app's own turn: let go, so the page is the person's.
      this.stalled = true;
      this.stopRequested = true;
      this.runner?.stop();
    }, 15_000);
    this.session = { warmedUp: false };
    this.confirm = null;
    this.message = null;
    this.status = "running";
    this.running = true;
    this.emit();
    try {
      const site = this.sites.find((entry) => entry.id === this.supplier);
      // Continued past the cart (2026-11-23): another order may have taken this
      // seller's cart since, or it was emptied. Lines no longer in it are added
      // again (a fresh cart where the shop keeps the other one), not asked about.
      if (this.progress >= STAGE.ADDED && this.progress < STAGE.PLACED) {
        this.emit({ status: "running", message: "reading-cart" });
        const cart = finished(await this.runTask("openCart"));
        const rows = Array.isArray(cart.results?.cart) ? cart.results.cart : [];
        if (compareCart(this.lines, rows).lines.some((line) => line.issue === "missing")) {
          this.progress = STAGE.NEW;
          this.confirmedCart = null;
          this.save();
        } else {
          this.freshCart = rows;
        }
      }
      if (this.progress < STAGE.ADDED) {
        if (!(await this.addLines(site))) return;
        if (!(await this.settleCart(site))) return;
        this.progress = STAGE.ADDED;
        this.save();
      }
      if (this.progress < STAGE.PLACED) {
        // Every way to the checkout passes the cart check. A cart the person
        // already confirmed, still the same, is not asked again; one that
        // changed since (by hand in the supplier's page) is.
        await this.checkCart();
        this.progress = STAGE.CART_CONFIRMED;
        this.save();
        await this.placeOrder(site);
        this.progress = STAGE.PLACED;
        this.store?.clear(this.supplier, this.resumeKey);
      }

      // Bought for BOM (2026-11-23: "这个不应该跳提示"): the confirmation stays on
      // screen with nothing over it; BOM has the order number and follows it.
      if (this.link) {
        this.emit({ status: "done", message: null });
        return;
      }
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
        this.emit({ status: "stopped", message: this.stalled ? "stalled" : "stopped" });
        return;
      }
      if (error?.code === "blocked") {
        for (const line of this.lines) if (line.status !== "added") line.status = "blocked";
      }
      this.emit({ status: "failed", message: error?.code === "blocked" ? "blocked" : error.message });
    } finally {
      clearInterval(watchdog);
      this.running = false;
      this.runner = null;
      this.confirm = null;
      this.decide = null;
      this.softStop = false;
      this.phase = "";
      this.phaseSince = null;
      this.emit();
      if (this.link?.ended) {
        void Promise.resolve(this.link.ended({ status: this.status, message: this.message, progress: this.progress })).catch(() => {});
      }
    }
  }

  /** Stage 1: the list into the cart. False when the purchase ends here. */
  async addLines(site) {
    // A short list goes in part by part, from each part's own page: the
    // batch tools (DigiKey's Bulk Add box, Mouser's and LCSC's BOM upload)
    // each led to a page the app doesn't know, and DigiKey's box doesn't take
    // a maker's part number (2026-11-23, an uploaded order of three lines).
    const batch = this.lines.length > SHORT_LIST
      && (site?.tasks.bulkAddBom || site?.tasks.bulkAddPaa || site?.tasks.bulkAddList);
    if (batch) {
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
        // The batch didn't go through (the shop took none of it, or answered
        // in a way the task didn't expect): not the end of the purchase. The
        // cart is read next and settleCart adds each missing part one by one,
        // failing only with the parts that still aren't there (2026-11-21).
        for (const line of this.lines) {
          line.status = "failed";
          line.error = failed?.error?.message || snapshot.status;
        }
        this.bulkFailed = true;
      } else {
        for (const line of this.lines) line.status = "added";
      }
      this.emit();
      if (this.stopRequested) { this.emit({ status: "stopped", message: "stopped" }); return false; }
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
            return false;
          }
          line.status = "failed";
          line.error = error.message;
        }
        this.emit();
        if (this.stopRequested) { this.emit({ status: "stopped", message: "stopped" }); return false; }
      }
    }
    // A batch that failed as a whole goes to settleCart, which adds part by part.
    if (this.bulkFailed) {
      this.bulkFailed = false;
      return true;
    }
    // Nothing in the cart from this list: going on would only check out
    // whatever else is there, or walk an empty cart to the checkout.
    if (!this.lines.some((line) => line.status === "added")) {
      this.emit({ status: "failed", message: "nothing-added" });
      return false;
    }
    return true;
  }

  /** Stage 1b (2026-11-21): the cart holds this list and nothing else. A
   * shop's batch upload can say it finished and leave parts out (DigiKey did,
   * on a cart that still held an earlier run's lines), and a checkout buys
   * the whole cart. So the cart is read: a part that isn't in it is added on
   * its own; a line that isn't this list's is removed; a part that still won't
   * go in fails with its name. False when nothing of the list is in the cart. */
  async settleCart(site) {
    const read = async () => {
      const cart = finished(await this.runTask("openCart"));
      return (Array.isArray(cart.results?.cart) ? cart.results.cart : []).filter((row) => partKey(row.part));
    };
    // Each line's row: by its part number, else by the MPN in the row's text
    // (2026-11-23: a line bought by its MPN shows the seller's own number, and
    // was taken for a stranger and removed from the cart).
    const match = (rows) => {
      const used = new Set();
      const found = new Set();
      for (const line of this.lines) {
        const key = partKey(line.mpn);
        let index = rows.findIndex((row, at) => !used.has(at) && partKey(row.part) === key);
        if (index < 0 && key.length >= 6) index = rows.findIndex((row, at) => !used.has(at) && partKey(row.text).includes(key));
        if (index >= 0) { used.add(index); found.add(line); }
      }
      return { used, found };
    };
    this.emit({ status: "running", message: "checking-cart" });
    let rows = await read();
    const first = match(rows);
    const extras = rows.filter((_, at) => !first.used.has(at));
    const missing = this.lines.filter((line) => !first.found.has(line));
    if (!extras.length && !missing.length) {
      this.freshCart = rows; // the cart check takes this read instead of reading again
      return true;
    }
    const attempt = async (task, params) => {
      try {
        const snapshot = await this.runTask(task, params);
        const failed = snapshot.steps?.find((step) => step.status === "failed");
        return snapshot.status === "done" ? null : (failed?.error?.message || snapshot.status);
      } catch (error) {
        if (error?.code === "stopped" || error?.code === "blocked") throw error;
        return error.message;
      }
    };
    if (site?.tasks.removeFromCart) {
      for (const row of extras) {
        this.emit({ message: "removing-extra" });
        await attempt("removeFromCart", { part: row.part });
        if (this.stopRequested) throw stoppedError();
      }
    }
    if (site?.tasks.addToCart) {
      for (const line of missing) {
        this.emit({ message: "adding" });
        line.status = "adding";
        this.emit();
        line.error = await attempt("addToCart", { part: line.mpn, quantity: line.quantity });
        if (this.stopRequested) throw stoppedError();
      }
    }
    rows = await read();
    const after = match(rows);
    for (const line of this.lines) {
      if (after.found.has(line)) {
        line.status = "added";
        line.error = null;
      } else {
        line.status = "failed";
        line.error = line.error || "Not in the cart";
      }
    }
    this.emit();
    if (!this.lines.some((line) => line.status === "added")) {
      this.emit({ status: "failed", message: "nothing-added" });
      return false;
    }
    // A line bought by the MPN may show the seller's own number in the cart.
    const wanted = new Set(this.lines.map((line) => partKey(line.mpn)));
    const known = (row) => wanted.has(partKey(row.part))
      || [...wanted].some((key) => key.length >= 6 && partKey(row.text).includes(key));
    // Lines the app could not remove stay for the person: the cart check
    // shows them as not on the list, rather than the whole supplier failing
    // (2026-11-24: an earlier test's C1525 left in the LCSC cart failed all
    // three lines of a new order).
    this.leftInCart = rows.filter((row) => !known(row)).map((row) => row.part || row.text);
    this.freshCart = rows;
    return true;
  }

  /** Stage 2: the person checks the cart against the list before anything is
   * bought (2026-11-20: "在购买前展示购物车，让用户确认这个是他们想要买的产品").
   * It always waits for their "correct"; "re-check" reads the cart again
   * after they changed it in the supplier's page. Continuing a purchase whose
   * cart was confirmed and has not changed since does not ask again. */
  async checkCart() {
    for (;;) {
      this.emit({ status: "running", message: "reading-cart" });
      if (this.freshCart) {
        this.cart = this.freshCart;
        this.freshCart = null;
      } else {
        const cart = finished(await this.runTask("openCart"));
        this.cart = Array.isArray(cart.results?.cart) ? cart.results.cart : [];
      }
      if (this.link?.cart) await this.link.cart(this.cart).catch(() => {});
      if (this.confirmedCart && sameCart(this.confirmedCart, this.cart)) {
        this.cartCheck = null;
        return;
      }
      this.cartCheck = compareCart(this.lines, this.cart, this.expected);
      this.emit({ status: "waiting", message: "cart-check" });
      const decision = await new Promise((resolve) => { this.decide = resolve; });
      this.decide = null;
      if (decision === "stop") throw stoppedError();
      if (decision === "confirm") {
        this.confirmedCart = this.cart;
        this.cartCheck = null;
        this.emit({ status: "running", message: "cart-confirmed" });
        return;
      }
      // "recheck": read it again.
    }
  }

  confirmCart() {
    if (!this.decide) return false;
    this.decide("confirm");
    return true;
  }

  recheckCart() {
    if (!this.decide) return false;
    this.decide("recheck");
    return true;
  }

  /** Stage 3: checkout up to the order's yes, which is the person's. */
  async placeOrder(site) {
    this.emit({ status: "running", message: "placing-order" });
    this.rehearsalYes = false;
    this.rehearsalTotal = null;
    // A saved address fills the supplier's shipping form, where the site
    // knows how; otherwise that form stays the person's.
    const withAddress = Boolean(this.address && site?.tasks.placeOrderWithAddress);
    let placed = null;
    try {
      placed = finished(await (withAddress
        ? this.runTask("placeOrderWithAddress", addressParams(this.address))
        : this.runTask("placeOrder")));
    } catch (error) {
      // A rehearsal's yes stops the run at the review page on purpose.
      if (!(this.rehearsalYes && error?.code === "stopped")) throw error;
    }
    if (this.rehearsalYes) {
      this.orderNumber = `REHEARSAL-${Date.now().toString(36).toUpperCase()}`;
      this.placed = { orderNumber: this.orderNumber, total: this.rehearsalTotal, rehearsal: true, at: new Date().toISOString() };
      this.emit({ status: "running", message: "rehearsal-placed" });
      return;
    }
    this.orderNumber = orderNumberOf(placed?.results?.orderNumber);
    this.placed = { orderNumber: this.orderNumber, total: this.lastTotal || null, rehearsal: false, at: new Date().toISOString() };
    this.emit();
    if (this.link?.placed) await this.link.placed({ orderNumber: this.orderNumber }).catch(() => {});
  }

  /** Stop the purchase. While the app works, the first Stop (`soft`) lets it
   * finish the line or step it is on, so nothing is left half done in the
   * cart; a second Stop, or a hard one, stops at once. Waiting on the
   * person, it stops at once. */
  stop({ soft = false } = {}) {
    if (soft && this.driving() && !this.softStop) {
      this.softStop = true;
      this.stopRequested = true;
      this.emit({ message: this.message });
      return;
    }
    // Stop ends the purchase, not only the task running now.
    if (this.running) this.stopRequested = true;
    this.decide?.("stop");
    this.runner?.stop();
    this.emit({ status: "stopped", message: "stopped" });
  }

  approve() {
    // A price BOM's buyer has not approved yet: the yes waits for theirs.
    if (this.link?.mayConfirm && !this.link.mayConfirm()) {
      this.emit({ message: "waiting-bom-approval" });
      return false;
    }
    this.lastTotal = this.confirm?.value || null;
    if (this.rehearsal && this.confirm) {
      // The rehearsal ends at the yes: Submit is never pressed.
      this.rehearsalYes = true;
      this.rehearsalTotal = this.lastTotal;
      this.confirm = null;
      this.runner?.stop();
      return true;
    }
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
  const failedSteps = snapshot.steps.filter((step) => step.status === "failed");
  // A walk names where it was going ("Order placed"); the step under it that
  // failed names what was missing ("Checkout"), which is what to say (2026-11-23).
  const failed = failedSteps.find((step) => step.do !== "walk" && step.do !== "act") || failedSteps[0];
  // Which thing on the page it was: "It isn't on the page (Secure Checkout)".
  const what = failed?.targetTitle?.en || failed?.target || "";
  const message = failed?.error?.message || `The ${snapshot.task || "step"} didn't finish`;
  throw new Error(what && !message.includes(what) ? `${message} (${what})` : message);
}


function stoppedError() {
  const error = new Error("Stopped");
  error.code = "stopped";
  return error;
}


module.exports = { AddressBook, BuyLabFlow, RunStore, compareCart, sameCart, STAGE, bulkLines, paaLines, parseLines, writeBomFile, cleanAddress, addressParams, siteAddress, siteOrderText, ADDRESS_FIELDS, CUSTOMER_TYPES, US_STATES, REQUIRED_TASKS };
