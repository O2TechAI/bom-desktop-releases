"use strict";

/* What a Buy lab purchase does, task by task, pinned down so the flow can be
 * made faster without changing it: which tasks run in which order, with
 * which values and Runner options, what the window is told along the way,
 * and how a shop's refusal, a failed bulk add and a stop end. The Runner is
 * replaced by a scripted one; the real site profiles are used. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const runnerModule = require("../src/automation/runner");
const { defineSite } = require("../src/automation/sites");

const RealRunner = runnerModule.Runner;

/** A Runner that answers from a script instead of a browser. */
class ScriptedRunner {
  constructor(options) {
    this.options = options;
    ScriptedRunner.made.push(this);
  }

  async run() {
    const { task, params } = this.options;
    ScriptedRunner.calls.push({ task, params });
    const answer = ScriptedRunner.script(task, params, ScriptedRunner.calls);
    if (answer instanceof Error) throw answer;
    if (task === "bulkAddBom") ScriptedRunner.files.push({ file: params.file, content: fs.readFileSync(params.file, "utf8") });
    // A real run that was stopped ends as stopped.
    if (this.stopped) return { status: "stopped", steps: [], results: {} };
    return { status: "done", steps: [], results: {}, ...answer };
  }

  stop() { this.stopped = true; ScriptedRunner.stopped += 1; }

  approve() { return true; }
}

function resetScript(script) {
  ScriptedRunner.made = [];
  ScriptedRunner.calls = [];
  ScriptedRunner.files = [];
  ScriptedRunner.stopped = 0;
  ScriptedRunner.script = script;
}

// buy-lab-flow.js takes Runner from the module when it loads.
runnerModule.Runner = ScriptedRunner;
const { BuyLabFlow } = require("../src/buy-lab-flow");
const { SITES } = require("../src/automation/sites");

const LAB_SITES = SITES.filter((site) => ["digikey", "lcsc"].includes(site.id));
const DEMO_TEXT = "RC0402FR-0710KL 10\nGRM155R71C104KA88D 10";

const ORDERS = [
  { number: "88012345", status: "Shipped", total: "$1.20" },
  { number: "W-88012346", status: "Processing", total: "$2.00" },
  { number: "none", status: "Draft", total: "" },
  { number: "88012347", status: "Shipped", total: "$3.00" },
  { number: "88012348", status: "Shipped", total: "$4.00" },
];

/** The shop's cart holds what the last upload sent (its CSV, header first). */
function uploadedCart() {
  const last = ScriptedRunner.files.at(-1);
  if (!last) return [];
  return last.content.trim().split("\n").slice(1).map((row) => {
    const [part, quantity] = row.split(",");
    return { part, quantity };
  });
}

function happyShop(task, params) {
  if (task === "openCart") return { results: { cart: uploadedCart() } };
  if (task === "placeOrder") return { results: { orderNumber: "88012345" } };
  if (task === "orders") return { results: { orders: ORDERS } };
  if (task === "track") return { results: { status: `track ${params.order}`, shipments: [{ number: `S${params.order}` }] } };
  return {};
}

function makeFlow({ reloads = [], autoConfirm = true } = {}) {
  const states = [];
  const live = { browser: { link: { id: "link" } }, reload: async () => { reloads.push(Date.now()); } };
  // The person says the cart is right whenever the cart check asks.
  const flow = new BuyLabFlow({
    sites: LAB_SITES,
    getLive: () => live,
    onChange: (state) => {
      states.push(state);
      if (state.message === "cart-check" && autoConfirm) setImmediate(() => flow.confirmCart());
    },
  });
  return { flow, states, live };
}


test("the demo's DigiKey purchase runs every task in order, with the same values and Runner options", async () => {
  resetScript(happyShop);
  const { flow, states, live } = makeFlow();
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });

  assert.deepEqual(ScriptedRunner.calls, [
    // DigiKey now takes the list as a file, through its cart's Upload a File.
    { task: "bulkAddBom", params: { file: ScriptedRunner.files[0].file, partColumn: "Manufacturer Part Number" } },
    { task: "openCart", params: {} },
    { task: "placeOrder", params: {} },
    { task: "orders", params: {} },
    // The first three orders, digits only; one without digits is skipped.
    { task: "track", params: { order: "88012345" } },
    { task: "track", params: { order: "88012346" } },
  ]);
  for (const runner of ScriptedRunner.made) {
    const { contents, profile, themeCss, warmupMs, navigationGapMs, checkSettleMs } = runner.options;
    assert.equal(contents, live.browser.link);
    assert.equal(profile.id, "digikey");
    assert.deepEqual({ themeCss, warmupMs, navigationGapMs, checkSettleMs }, { themeCss: "", warmupMs: 0, navigationGapMs: 250, checkSettleMs: 0 });
  }

  const end = flow.state();
  assert.equal(end.status, "done");
  assert.equal(end.message, null);
  assert.equal(end.running, false);
  assert.deepEqual(end.lines.map(({ mpn, quantity, status, index }) => ({ mpn, quantity, status, index })), [
    { mpn: "RC0402FR-0710KL", quantity: "10", status: "added", index: 0 },
    { mpn: "GRM155R71C104KA88D", quantity: "10", status: "added", index: 1 },
  ]);
  assert.deepEqual(end.cart, [{ part: "RC0402FR-0710KL", quantity: "10" }, { part: "GRM155R71C104KA88D", quantity: "10" }]);
  assert.equal(end.orderNumber, "88012345");
  assert.deepEqual(end.orders, ORDERS);
  assert.deepEqual(end.tracking, [
    { order: "88012345", status: "track 88012345", shipments: [{ number: "S88012345" }] },
    { order: "W-88012346", status: "track 88012346", shipments: [{ number: "S88012346" }] },
  ]);

  // What the window is told, in order (repeats collapsed).
  const messages = states.map((state) => state.message).filter((message, index, all) => message !== all[index - 1]);
  assert.deepEqual(messages, [null, "bulk-adding", "checking-cart", "reading-cart", "cart-check", "cart-confirmed", "placing-order", "reading-orders", "tracking", null]);
  assert.equal(states.at(-1).status, "done");
});


test("DigiKey maps its own numbers' column when every line is one, from one CSV", async () => {
  resetScript(happyShop);
  const { flow } = makeFlow();
  await flow.start({ supplier: "digikey", text: "311-10.0KLRCT-ND 10\n490-3261-1-ND 10" });
  assert.equal(ScriptedRunner.calls[0].task, "bulkAddBom");
  assert.equal(ScriptedRunner.calls[0].params.partColumn, "DigiKey Part Number");
  assert.equal(ScriptedRunner.files[0].content, "Part Number,Quantity\n311-10.0KLRCT-ND,10\n490-3261-1-ND,10\n");
  assert.equal(fs.existsSync(ScriptedRunner.files[0].file), false);
  assert.equal(flow.state().status, "done");
});


test("LCSC writes one CSV for its BOM tool, then removes it", async () => {
  resetScript(happyShop);
  const { flow } = makeFlow();
  await flow.start({ supplier: "lcsc", text: "C1525 10\nC25804, 1,000" });
  assert.deepEqual(ScriptedRunner.calls.map((call) => call.task), ["bulkAddBom", "openCart", "placeOrder", "orders", "track", "track"]);
  assert.equal(ScriptedRunner.files.length, 1);
  assert.equal(ScriptedRunner.files[0].content, "LCSC Part Number,Quantity\nC1525,10\nC25804,1000\n");
  assert.equal(fs.existsSync(ScriptedRunner.files[0].file), false);
  assert.equal(flow.state().status, "done");
});


test("a failed bulk add goes on part by part, and ends only when nothing got into the cart", async () => {
  // 2026-11-21: the batch failing as a whole no longer ends the purchase at
  // once; the cart is read and each missing part is added on its own.
  resetScript((task, params) => {
    if (task === "bulkAddBom") return { status: "failed", steps: [{ status: "failed", error: { message: "It isn't on the page" } }] };
    if (task === "openCart") return { results: { cart: [] } };
    return happyShop(task, params);
  });
  const { flow } = makeFlow();
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  assert.deepEqual(ScriptedRunner.calls.map((call) => call.task), ["bulkAddBom", "openCart", "addToCart", "addToCart", "openCart"]);
  assert.ok(flow.state().lines.every((line) => line.status === "failed"));
  assert.equal(flow.state().status, "failed");
  assert.equal(flow.state().message, "nothing-added");
});


test("a stage that doesn't finish ends the purchase with its step's words", async () => {
  resetScript((task, params) => (task === "placeOrder"
    ? { status: "failed", steps: [{ status: "failed", error: { message: "No way from cart to confirmation" } }] }
    : happyShop(task, params)));
  const { flow } = makeFlow();
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  assert.deepEqual(ScriptedRunner.calls.map((call) => call.task), ["bulkAddBom", "openCart", "placeOrder"]);
  assert.equal(flow.state().status, "failed");
  assert.equal(flow.state().message, "No way from cart to confirmation");
  assert.equal(flow.state().running, false);
});


test("the page has words for every wait a supplier can ask for, in every language", () => {
  const page = fs.readFileSync(require.resolve("../static/buy-lab.js"), "utf8");
  const waits = new Set(["lost", "nothing-added"]);
  for (const site of LAB_SITES) {
    for (const state of Object.values(site.machine.states)) {
      if (state.person) waits.add(state.person);
      if (state.stuck) waits.add(state.stuck);
    }
    for (const steps of [...Object.values(site.tasks), ...site.machine.transitions.map((t) => t.steps)]) {
      for (const step of steps) if (step.do === "handoff") waits.add(step.message);
    }
  }
  for (const wait of waits) {
    const key = wait.includes("-") ? `"${wait}":` : `${wait}:`;
    const count = page.split(`      ${key} `).length - 1;
    assert.equal(count, 3, `${wait} in en, zh and es`);
  }
});


test("the demo fills every supplier: DigiKey's cut-tape numbers, LCSC's C-numbers, Mouser's own numbers", () => {
  const page = fs.readFileSync(require.resolve("../static/buy-lab.js"), "utf8");
  const demo = page.slice(page.indexOf("const DEMO"), page.indexOf("};", page.indexOf("const DEMO")));
  assert.match(demo, /digikey: "311-10\.0KLRCT-ND 10\\n490-3261-1-ND 10"/);
  assert.match(demo, /lcsc: "C1525 10\\nC25804 10"/);
  assert.match(demo, /mouser: "603-RC0603FR-0710KL 10\\n595-SN74LVC1G08DBVR 10"/);
  // The demo button starts every supplier in DEMO, not one.
  assert.match(page, /for \(const \[id, text\] of Object\.entries\(DEMO\)\)/);
});


test("a shop's refusal is reloaded once; a second refusal fails the purchase", async () => {
  const blocked = { status: "failed", steps: [{ status: "failed", error: { code: "blocked", message: "refused" } }] };
  resetScript((task, params, calls) => {
    if (task === "openCart") return calls.filter((call) => call.task === "openCart").length === 1 ? blocked : happyShop(task, params);
    if (task === "orders") return blocked;
    return happyShop(task, params);
  });
  const reloads = [];
  const { flow, states } = makeFlow({ reloads });
  const started = Date.now();
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  // openCart: refused, reloaded, worked. orders: refused twice.
  assert.deepEqual(ScriptedRunner.calls.map((call) => call.task), ["bulkAddBom", "openCart", "openCart", "placeOrder", "orders", "orders"]);
  assert.equal(reloads.length, 2);
  assert.ok(Date.now() - started >= 6000 - 50, "three seconds after each reload");
  assert.ok(states.some((state) => state.message === "reloading-blocked"));
  const end = flow.state();
  assert.equal(end.status, "failed");
  assert.equal(end.message, "blocked");
  // Lines already added stay added.
  assert.deepEqual(end.lines.map((line) => line.status), ["added", "added"]);
});


test("a refusal thrown by the run is reloaded once too", async () => {
  resetScript((task, params, calls) => {
    if (task === "bulkAddBom" && calls.length === 1) return Object.assign(new Error("blocked"), { code: "blocked" });
    return happyShop(task, params);
  });
  const reloads = [];
  const { flow } = makeFlow({ reloads });
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  assert.deepEqual(ScriptedRunner.calls.map((call) => call.task).slice(0, 3), ["bulkAddBom", "bulkAddBom", "openCart"]);
  assert.equal(reloads.length, 1);
  assert.equal(flow.state().status, "done");
});


test("a refused bulk add marks the unadded lines blocked", async () => {
  const blocked = { status: "failed", steps: [{ status: "failed", error: { code: "blocked", message: "refused" } }] };
  resetScript((task, params) => (task === "bulkAddBom" ? blocked : happyShop(task, params)));
  const { flow } = makeFlow();
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  assert.deepEqual(ScriptedRunner.calls.map((call) => call.task), ["bulkAddBom", "bulkAddBom"]);
  assert.deepEqual(flow.state().lines.map((line) => line.status), ["blocked", "blocked"]);
  assert.equal(flow.state().status, "failed");
  assert.equal(flow.state().message, "blocked");
});


test("a tracking failure is noted on the order and the purchase finishes", async () => {
  resetScript((task, params) => {
    if (task === "track" && params.order === "88012346") return new Error("no such order");
    return happyShop(task, params);
  });
  const { flow } = makeFlow();
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  assert.deepEqual(flow.state().tracking.map((track) => track.status), ["track 88012345", "failed: no such order"]);
  assert.equal(flow.state().status, "done");
});


test("bad input is refused before any task runs", async () => {
  resetScript(happyShop);
  const { flow } = makeFlow();
  await assert.rejects(flow.start({ supplier: "digikey", text: " \n# note" }), /Paste at least one line/);
  await assert.rejects(flow.start({ supplier: "mouser", text: DEMO_TEXT }), /Unknown supplier mouser/);
  assert.equal(ScriptedRunner.calls.length, 0);
});


test("stop during the bulk add ends the purchase as stopped", async () => {
  let flow;
  resetScript((task, params) => {
    if (task === "bulkAddBom") flow.stop();
    return happyShop(task, params);
  });
  ({ flow } = makeFlow());
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  assert.deepEqual(ScriptedRunner.calls.map((call) => call.task), ["bulkAddBom"]);
  assert.equal(ScriptedRunner.stopped, 1);
  // Stopped by the person: the lines say stopped, not failed.
  assert.deepEqual(flow.state().lines.map((line) => [line.status, line.error]), [["stopped", null], ["stopped", null]]);
  assert.equal(flow.state().status, "stopped");
  assert.equal(flow.state().message, "stopped");
  assert.equal(flow.state().running, false);
});


test("stop after the bulk add ends the whole purchase (v0.0.13 went on to the order page)", async () => {
  let flow;
  resetScript((task, params) => {
    if (task === "openCart") flow.stop();
    return happyShop(task, params);
  });
  ({ flow } = makeFlow());
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  assert.deepEqual(ScriptedRunner.calls.map((call) => call.task), ["bulkAddBom", "openCart"]);
  assert.equal(flow.state().status, "stopped");
  assert.equal(flow.state().message, "stopped");
  assert.equal(flow.state().running, false);
  assert.deepEqual(flow.state().lines.map((line) => line.status), ["added", "added"]);
});


test("stop while tracking ends the purchase instead of noting a failed order", async () => {
  let flow;
  resetScript((task, params) => {
    if (task === "track") flow.stop();
    return happyShop(task, params);
  });
  ({ flow } = makeFlow());
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  assert.deepEqual(ScriptedRunner.calls.map((call) => call.task), ["bulkAddBom", "openCart", "placeOrder", "orders", "track"]);
  assert.equal(flow.state().status, "stopped");
});


test("a new purchase after a stop runs in full", async () => {
  let flow;
  let stopOnce = true;
  resetScript((task, params) => {
    if (task === "openCart" && stopOnce) { stopOnce = false; flow.stop(); }
    return happyShop(task, params);
  });
  ({ flow } = makeFlow());
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  ScriptedRunner.calls = [];
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  assert.equal(ScriptedRunner.calls.length, 6);
  assert.equal(flow.state().status, "done");
});


test("every task of one purchase shares one session; a new purchase starts cold", async () => {
  resetScript(happyShop);
  const { flow } = makeFlow();
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  const first = ScriptedRunner.made.map((runner) => runner.options.session);
  assert.ok(first[0] && first.every((session) => session === first[0]));
  first[0].warmedUp = true;
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  const second = ScriptedRunner.made.at(-1).options.session;
  assert.notEqual(second, first[0]);
  assert.equal(second.warmedUp, false);
});


test("a refusal sends the retry back through the shop's home page", async () => {
  const blocked = { status: "failed", steps: [{ status: "failed", error: { code: "blocked", message: "refused" } }] };
  const warmAtRun = [];
  resetScript((task, params, calls) => {
    warmAtRun.push(ScriptedRunner.made.at(-1).options.session.warmedUp);
    ScriptedRunner.made.at(-1).options.session.warmedUp = true; // the run warmed up
    if (task === "orders" && calls.filter((call) => call.task === "orders").length === 1) return blocked;
    return happyShop(task, params);
  });
  const { flow } = makeFlow();
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  const tasks = ScriptedRunner.calls.map((call) => call.task);
  assert.deepEqual(tasks, ["bulkAddBom", "openCart", "placeOrder", "orders", "orders", "track", "track"]);
  // Cold for the first task, cold again for the retry after the reload.
  assert.deepEqual(warmAtRun, [false, true, true, true, false, true, true]);
});


/* A shop with a home page, a cart and an order list; every goto is noted. */
function warmShop() {
  const T = (en) => ({ en, zh: en, es: en });
  const site = defineSite({
    id: "shop",
    name: "Shop",
    hosts: ["shop.test"],
    urls: { home: "https://shop.test/", search: "https://shop.test/s", cart: "https://shop.test/cart", signIn: "https://shop.test/login", orders: "https://shop.test/orders" },
    targets: { "page.cart": { title: T("Cart"), any: [{ css: "#cart" }] } },
    machine: {
      states: {
        home: { title: T("Home"), match: { url: /shop\.test\/$/ } },
        cart: { title: T("Cart"), match: { url: /\/cart$/ } },
        orders: { title: T("Orders"), match: { url: /\/orders$/ } },
      },
      transitions: [
        { name: "goCart", title: T("Cart"), from: "*", to: ["cart"], steps: [{ do: "warmup" }, { do: "goto", url: "{{cart}}" }] },
        { name: "goOrders", title: T("Orders"), from: "*", to: ["orders"], steps: [{ do: "warmup" }, { do: "goto", url: "{{orders}}" }] },
      ],
    },
    tasks: { openCart: [{ do: "walk", to: "cart" }], orders: [{ do: "walk", to: "orders" }] },
  });
  const page = { url: "https://shop.test/" };
  const gotos = [];
  const driver = {
    contents: { getURL: () => page.url, isLoading: () => false },
    attach: async () => {},
    detach: () => {},
    clearMarks: async () => {},
    checkStopped: () => {},
    present: async () => ({}),
    exists: async () => false,
    goto: async (url) => { gotos.push(url); page.url = url; },
  };
  return { site, driver, gotos };
}

async function runTasks(tasks, extra = {}) {
  const { site, driver, gotos } = warmShop();
  const metrics = [];
  for (const task of tasks) {
    const runner = new RealRunner({ contents: { on() {}, removeListener() {} }, profile: site, task, warmupMs: 0, navigationGapMs: 0, ...extra });
    runner.driver = driver;
    const result = await runner.run();
    assert.equal(result.status, "done", JSON.stringify(result.steps.filter((step) => step.error)));
    metrics.push(result.metrics.warmups);
  }
  return { gotos, metrics };
}

test("each Runner on its own warms the shop up once, as in v0.0.13", async () => {
  const { gotos, metrics } = await runTasks(["openCart", "orders"]);
  assert.deepEqual(gotos, ["https://shop.test/", "https://shop.test/cart", "https://shop.test/", "https://shop.test/orders"]);
  assert.deepEqual(metrics, [1, 1]);
});


test("Runners that share a session warm the shop up once between them", async () => {
  const session = { warmedUp: false };
  const { gotos, metrics } = await runTasks(["openCart", "orders"], { session });
  assert.deepEqual(gotos, ["https://shop.test/", "https://shop.test/cart", "https://shop.test/orders"]);
  assert.deepEqual(metrics, [1, 0]);
});


test("a waitForUrl step without a pattern is refused before it runs", () => {
  const { site } = warmShop();
  const broken = { ...site, tasks: { bad: [{ do: "waitForUrl", url: /x/ }] } };
  assert.throws(() => new RealRunner({ contents: { on() {}, removeListener() {} }, profile: broken, task: "bad" }), /waitForUrl needs a pattern/);
  const lcsc = SITES.find((entry) => entry.id === "lcsc");
  const upload = lcsc.tasks.bulkAddBom.filter((step) => step.do === "waitForUrl");
  assert.equal(upload.length, 2);
  assert.ok(upload.every((step) => step.pattern instanceof RegExp));
});


/* 2026-11-21: DigiKey's upload said it finished, the order's parts were not in
 * the cart, and the cart still held an earlier run's lines. */
test("a part the upload left out is added on its own, and a line from before is removed", async () => {
  resetScript((task, params, calls) => {
    if (task === "openCart") {
      const fixed = calls.some((call) => call.task === "addToCart");
      return { results: { cart: fixed
        ? [{ part: "RC0402FR-0710KL", quantity: "10" }, { part: "GRM155R71C104KA88D", quantity: "10" }]
        : [{ part: "RC0402FR-0710KL", quantity: "10" }, { part: "535-13731-1-ND", quantity: "10" }] } };
    }
    return happyShop(task, params);
  });
  const { flow } = makeFlow();
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  assert.deepEqual(ScriptedRunner.calls.map((call) => call.task).slice(0, 5),
    ["bulkAddBom", "openCart", "removeFromCart", "addToCart", "openCart"]);
  assert.deepEqual(ScriptedRunner.calls[2].params, { part: "535-13731-1-ND" });
  assert.deepEqual(ScriptedRunner.calls[3].params, { part: "GRM155R71C104KA88D", quantity: "10" });
  assert.equal(flow.state().status, "done");
  assert.deepEqual(flow.lines.map((line) => line.status), ["added", "added"]);
});

test("a part that still won't go in fails with its name; with nothing of the list in the cart the purchase ends", async () => {
  resetScript((task, params) => (task === "openCart" ? { results: { cart: [{ part: "535-13731-1-ND", quantity: "10" }] } }
    : task === "addToCart" ? { status: "failed", steps: [{ status: "failed", error: { message: "No such part" } }] } : happyShop(task, params)));
  const { flow } = makeFlow();
  await flow.start({ supplier: "digikey", text: DEMO_TEXT });
  const end = flow.state();
  assert.equal(end.status, "failed");
  assert.equal(end.message, "nothing-added");
  assert.ok(flow.lines.every((line) => line.status === "failed"));
  assert.ok(!ScriptedRunner.calls.some((call) => call.task === "placeOrder"), "nothing is checked out");
});
