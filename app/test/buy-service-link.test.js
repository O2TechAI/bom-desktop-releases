"use strict";

/* The desktop's link to the Buy lab service: it takes this person's jobs,
 * starts one Buy lab purchase per supplier, reports the cart and the order,
 * holds the person's yes while BOM's buyer must approve, and stops a run whose
 * job BOM cancelled. The service and the Buy lab are played here. */

const assert = require("node:assert/strict");
const test = require("node:test");

const { ServiceLink, cartReport } = require("../src/buy-service-link");

const JOB = {
  purchase_request_id: "pr_1", seller: "digikey", phase: "price", supplier_order_id: null,
  ship_to: { name: "Ada Lovelace", line1: "1 Main St", city: "Columbus", region: "OH", postal_code: "43004", country: "US" },
  lines: [
    { line_id: "prl_a", sku: "311-10.0KLRCT-ND", mpn: "RC0402FR-0710KL", quantity: "10" },
    { line_id: "prl_b", sku: "490-3261-1-ND", mpn: "GRM155R71C104KA88D", quantity: "10" },
  ],
};

function harness(jobsByTick) {
  const posts = [];
  let tick = 0;
  const lab = {
    started: [], stopped: [], shown: [],
    startFromService(job, link) { this.started.push(job); this.link = link; return true; },
    stop(id) { this.stopped.push(id); },
    showFor(id) { this.shown.push(id); },
  };
  const fetch = async (url, init) => {
    const path = url.split("/desk/")[1];
    const body = JSON.parse(init.body);
    posts.push({ path, body });
    const jobs = path === "heartbeat" ? (jobsByTick[Math.min(tick++, jobsByTick.length - 1)] || []) : [];
    return { ok: true, status: 200, json: async () => ({ jobs, recorded: true }) };
  };
  const link = new ServiceLink({ fetch, origin: "https://bom.test", openBuyLab: async () => lab, version: "9.9.9" });
  return { link, lab, posts };
}


test("cart rows become the job lines' quote, matched by part number", () => {
  const rows = [
    { part: "‎490-3261-1-ND‎", quantity: "10", unitPrice: "0.02500", extended: "$0.25" },
    { part: "311-10.0KLRCT-ND", quantity: "10", unitPrice: "", extended: "$0.23" },
  ];
  assert.deepEqual(cartReport(JOB, rows), [
    { line_id: "prl_a", unit_price: "0.023", quantity: "10", sku: "311-10.0KLRCT-ND" },
    { line_id: "prl_b", unit_price: "0.02500", quantity: "10", sku: "490-3261-1-ND" },
  ]);
  // A part the cart doesn't have goes back without a price: the service marks it.
  assert.deepEqual(cartReport(JOB, [rows[0]])[0], { line_id: "prl_a" });
});


test("a job starts one purchase, reports its cart and holds the yes until checkout", async () => {
  const { link, lab, posts } = harness([[JOB], [JOB], [{ ...JOB, phase: "wait" }], [{ ...JOB, phase: "checkout", supplier_order_id: "so_1" }]]);
  await link.tick();
  assert.equal(lab.started.length, 1);
  assert.equal(posts[0].body.app_version, "9.9.9");
  // Still the same job on the next round: not started twice.
  await link.tick();
  assert.equal(lab.started.length, 1);

  await lab.link.cart([{ part: "311-10.0KLRCT-ND", quantity: "10", unitPrice: "0.023" }]);
  const cart = posts.find((post) => post.path === "cart");
  assert.equal(cart.body.purchase_request_id, "pr_1");
  assert.equal(cart.body.cart[0].unit_price, "0.023");
  assert.deepEqual(cart.body.cart[1], { line_id: "prl_b" });

  // The report asks for the next round at once: the cart was dearer than BOM
  // showed, so BOM's buyer approves before the person's yes counts.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lab.link.mayConfirm(), false);
  await link.tick();
  assert.equal(lab.link.mayConfirm(), true);

  await lab.link.placed({ orderNumber: "88001234" });
  const order = posts.find((post) => post.path === "order");
  assert.deepEqual(order.body, { purchase_request_id: "pr_1", seller: "digikey", supplier_order_number: "88001234" });
});


test("an interrupted run tells BOM nothing, waits for Continue, and is not restarted by itself", async () => {
  const { link, lab, posts } = harness([[JOB]]);
  await link.tick();
  const before = posts.length;
  await lab.link.ended({ status: "stopped", message: "stopped" });
  // Interrupted, not over: BOM keeps the job, nothing is reported.
  assert.equal(posts.length, before);
  await link.tick();
  assert.equal(lab.started.length, 1);
  // Continue makes the job this run's again; it still reports its cart.
  lab.link.resumed();
  const resumedAt = posts.length;
  await lab.link.cart([{ part: "311-10.0KLRCT-ND", quantity: "10", unitPrice: "0.023" }]);
  assert.ok(posts.slice(resumedAt).some((post) => post.path === "cart"));
});


test("a list that never went into the cart is reported, once", async () => {
  const { link, lab, posts } = harness([[JOB]]);
  await link.tick();
  await lab.link.ended({ status: "failed", message: "nothing-added" });
  assert.deepEqual(posts.at(-1), { path: "cart", body: { purchase_request_id: "pr_1", seller: "digikey", failed: "nothing-added" } });
});


test("a job BOM cancelled stops its run", async () => {
  const { link, lab } = harness([[JOB], []]);
  await link.tick();
  await link.tick();
  assert.deepEqual(lab.stopped, ["digikey"]);
});


test("one supplier runs one job at a time", async () => {
  const other = { ...JOB, purchase_request_id: "pr_2" };
  const { link, lab } = harness([[JOB, other]]);
  await link.tick();
  assert.deepEqual(lab.started.map((job) => job.purchase_request_id), ["pr_1"]);
});
