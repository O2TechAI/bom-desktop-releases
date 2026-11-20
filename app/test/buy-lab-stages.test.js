"use strict";

/* A purchase in stages (2026-11-20): the person checks the cart before any
 * checkout, an interrupted purchase goes on from the stage it got to (also
 * after the app was closed), and a rehearsal runs to the order's yes without
 * ever pressing Submit. The shop is played by `runTask`. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { BuyLabFlow, RunStore, STAGE, compareCart, sameCart } = require("../src/buy-lab-flow");

const SITE = {
  id: "digikey", name: "DigiKey",
  tasks: { addToCart: [], openCart: [], placeOrder: [], orders: [], track: [], bulkAddList: [] },
  taskParams: { bulkAddList: ["lines"] },
  machine: { states: {}, transitions: [] },
};
const LIST = "311-10.0KLRCT-ND 10\n490-3261-1-ND 10";
const CART = [
  { part: "311-10.0KLRCT-ND", quantity: "10", unitPrice: "$0.023", extended: "$0.23" },
  { part: "490-3261-1-ND", quantity: "10", unitPrice: "$0.025", extended: "$0.25" },
];

/** A flow whose shop answers from `shop(task, calls)`, with the person's
 * answers to the cart check taken from `answers` in turn. */
function setup({ shop = () => ({}), answers = ["confirm"], store = null } = {}) {
  const calls = [];
  const states = [];
  const queue = [...answers];
  const flow = new BuyLabFlow({
    sites: [SITE], getLive: () => ({}), store,
    onChange: (state) => {
      states.push(state);
      if (state.message === "cart-check" && state.status === "waiting") {
        const answer = queue.shift();
        if (answer === "confirm") setImmediate(() => flow.confirmCart());
        if (answer === "recheck") setImmediate(() => flow.recheckCart());
        if (answer === "stop") setImmediate(() => flow.stop());
      }
    },
  });
  flow.runTask = async (task, params) => {
    calls.push({ task, params });
    const answer = shop(task, calls, flow) || {};
    if (answer.throw) throw answer.throw;
    return { status: answer.status || "done", steps: [], results: answer.results || (task === "openCart" ? { cart: CART } : {}) };
  };
  return { flow, calls, states };
}

const tasks = (calls) => calls.map((call) => call.task);


test("the cart is compared with the list: missing, other quantity, dearer than BOM, extra", () => {
  const lines = [{ mpn: "A-ND", quantity: "10" }, { mpn: "B-ND", quantity: "5" }, { mpn: "C-ND", quantity: "1" }, { mpn: "D-ND", quantity: "2" }];
  const rows = [
    { part: "‎A-ND‎", quantity: "10", unitPrice: "$0.10", extended: "$1.00" },
    { part: "B-ND", quantity: "7", unitPrice: "$1.00", extended: "$7.00" },
    { part: "D-ND", quantity: "2", unitPrice: "$0.60", extended: "$1.20" },
    { part: "X-ND", quantity: "3", unitPrice: "$2.00", extended: "$6.00" },
    { part: "", quantity: "", unitPrice: "", extended: "" },
  ];
  const check = compareCart(lines, rows, { "D-ND": 0.5 });
  assert.deepEqual(check.lines.map((line) => [line.part, line.issue]),
    [["A-ND", null], ["B-ND", "quantity"], ["C-ND", "missing"], ["D-ND", "price"], ["X-ND", "extra"]]);
  assert.equal(check.issues, 4);
  assert.equal(check.total, "15.20");
  assert.equal(sameCart(rows, [...rows].reverse()), true);
  assert.equal(sameCart(rows, rows.slice(1)), false);
});


test("checkout waits for the person's yes to the cart, and re-check reads it again", async () => {
  const { flow, calls, states } = setup({ answers: ["recheck", "confirm"] });
  await flow.start({ supplier: "digikey", text: LIST });
  assert.deepEqual(tasks(calls), ["bulkAddList", "openCart", "openCart", "placeOrder", "orders"]);
  const asked = states.filter((state) => state.message === "cart-check" && state.status === "waiting");
  assert.ok(asked.length >= 2);
  assert.equal(asked[0].cartCheck.issues, 0);
  assert.equal(flow.status, "done");
});


test("stop at the cart check ends the purchase before checkout, and it can go on from there", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o2-runs-"));
  const store = new RunStore(dir);
  const { flow, calls } = setup({ answers: ["stop", "confirm"], store });
  await flow.start({ supplier: "digikey", text: LIST });
  assert.equal(flow.status, "stopped");
  assert.equal(flow.state().canResume, true);
  assert.equal(flow.progress, STAGE.ADDED);
  assert.ok(!tasks(calls).includes("placeOrder"));
  assert.equal(store.load("digikey").progress, STAGE.ADDED);

  // Continue: the list is not added again; the cart is checked, then checkout.
  calls.length = 0;
  await flow.resume();
  assert.deepEqual(tasks(calls), ["openCart", "placeOrder", "orders"]);
  assert.equal(flow.status, "done");
  assert.equal(store.load("digikey"), null, "a finished purchase leaves nothing to continue");
});


test("after the app was closed, the same purchase goes on from its stage; a confirmed, unchanged cart is not asked again", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o2-runs-"));
  const store = new RunStore(dir);
  // The first run gets to checkout and fails there (a page it didn't know).
  const first = setup({ store, shop: (task) => (task === "placeOrder" ? { throw: new Error("lost") } : {}) });
  await first.flow.start({ supplier: "digikey", text: LIST, resumeKey: "pr_1:digikey" });
  assert.equal(first.flow.status, "failed");
  assert.equal(store.load("digikey").progress, STAGE.CART_CONFIRMED);

  // A new window (the app restarted), the same purchase: straight to checkout.
  const second = setup({ store, answers: [] });
  await second.flow.start({ supplier: "digikey", text: LIST, resumeKey: "pr_1:digikey" });
  assert.deepEqual(tasks(second.calls), ["openCart", "placeOrder", "orders"]);
  assert.equal(second.flow.status, "done");

  // Another purchase never takes over a saved one's stages.
  store.save("digikey", { resumeKey: "pr_9:digikey", progress: STAGE.CART_CONFIRMED, text: LIST });
  const third = setup({ store });
  await third.flow.start({ supplier: "digikey", text: LIST, resumeKey: "pr_2:digikey" });
  assert.equal(tasks(third.calls)[0], "bulkAddList");
});


test("a cart changed since it was confirmed is checked again", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o2-runs-"));
  const store = new RunStore(dir);
  store.save("digikey", { resumeKey: "k", progress: STAGE.ADDED, confirmedCart: CART.slice(0, 1), text: LIST });
  const { flow, states } = setup({ store });
  await flow.start({ supplier: "digikey", text: LIST, resumeKey: "k" });
  assert.ok(states.some((state) => state.message === "cart-check" && state.status === "waiting"));
});


test("a rehearsal stops at the order's yes: Submit is never pressed, and it is marked as one", async () => {
  let approved = 0;
  const { flow, calls } = setup({
    shop: (task, _calls, self) => {
      if (task !== "placeOrder") return {};
      // The review page asks for the yes; the person gives it.
      self.runner = { approve: () => { approved += 1; return true; }, stop: () => {} };
      self.confirm = { message: "place_order", value: "Total $12.07" };
      assert.equal(self.approve(), true);
      return { status: "stopped" };
    },
  });
  await flow.start({ supplier: "digikey", text: LIST, rehearsal: true });
  assert.equal(approved, 0, "the runner's yes (Submit) was never given");
  assert.equal(flow.placed.rehearsal, true);
  assert.equal(flow.placed.total, "Total $12.07");
  assert.match(flow.orderNumber, /^REHEARSAL-/);
  assert.deepEqual(tasks(calls), ["bulkAddList", "openCart", "placeOrder", "orders"]);
  assert.equal(flow.status, "done");
});


test("a purchase BOM handed over is never a rehearsal", async () => {
  const placed = [];
  const { flow } = setup();
  await flow.start({ supplier: "digikey", text: LIST, rehearsal: true, link: { placed: async (info) => placed.push(info) } });
  assert.equal(flow.state().rehearsal, false);
  assert.equal(placed.length, 1);
});
