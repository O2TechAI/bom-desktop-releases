"use strict";

/* The desktop's link to the Buy lab service: it takes this person's jobs,
 * starts one Buy lab purchase per supplier, reports the cart and the order,
 * holds the person's yes while BOM's buyer must approve, and stops a run whose
 * job BOM cancelled. A new job takes its supplier from the job that has it
 * (2026-11-25): that one is kept as no longer valid, to be run again from its
 * button. The service and the Buy lab are played here. */

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
    started: [], stopped: [], stopOptions: [], shown: [], links: {},
    startFromService(job, link) { this.started.push(job); this.link = link; this.links[job.purchase_request_id] = link; return true; },
    stop(id, options = {}) { this.stopped.push(id); this.stopOptions.push(options); },
    showFor(id, options = {}) { this.shown.push(id); this.shownQuiet = [...(this.shownQuiet || []), Boolean(options.quiet)]; },
  };
  const fetch = async (url, init) => {
    const path = url.split("/desk/")[1];
    const body = JSON.parse(init.body);
    posts.push({ path, body });
    const jobs = path === "heartbeat" ? (jobsByTick[Math.min(tick++, jobsByTick.length - 1)] || []) : [];
    return { ok: true, status: 200, json: async () => ({ jobs, recorded: true }) };
  };
  const opens = [];
  const link = new ServiceLink({ fetch, origin: "https://bom.test", openBuyLab: async (options) => { opens.push(options || {}); return lab; }, version: "9.9.9" });
  // One round, without the round a change asks for two seconds later.
  const round = async () => {
    await link.tick();
    clearTimeout(link.nudgeTimer);
    link.nudgeTimer = null;
  };
  return { link, lab, posts, opens, round };
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


const OTHER = { ...JOB, purchase_request_id: "pr_2" };
const started = (lab) => lab.started.map((job) => job.purchase_request_id);

test("one supplier runs one job at a time: of two that have not begun, the newest", async () => {
  // BOM lists its jobs oldest first (2026-11-25: the older one used to begin
  // and the new order waited behind its cart).
  const { link, lab } = harness([[JOB, OTHER]]);
  await link.tick();
  assert.deepEqual(started(lab), ["pr_2"]);
  // The older one never ran: nothing to stop. It is kept as no longer valid,
  // and BOM is told so.
  assert.deepEqual(lab.stopped, []);
  assert.ok(link.ended.has("pr_1:digikey"));
  assert.equal(link.stops.get("pr_1:digikey").message, "superseded");
  assert.equal(link.stops.get("pr_1:digikey").by, "pr_2:digikey");
  assert.deepEqual(link.activity(), [{ purchase_request_id: "pr_1", seller: "digikey", step: "stopped", driver: "none", message: "superseded" }]);
  // Still one at a time on the next round.
  await link.tick();
  assert.deepEqual(started(lab), ["pr_2"]);
});


test("a new job takes its supplier from the job running there", async () => {
  const { link, lab, posts, round } = harness([[JOB], [JOB, OTHER], [JOB, OTHER]]);
  await round();
  assert.deepEqual(started(lab), ["pr_1"]);
  // The new order arrives: the running one stops at once, not after its line.
  await round();
  assert.deepEqual(lab.stopped, ["digikey"]);
  assert.deepEqual(lab.stopOptions, [{ soft: false }]);
  assert.deepEqual(started(lab), ["pr_1"], "the supplier's page is free the round after");
  assert.ok(link.ended.has("pr_1:digikey"));
  assert.equal(link.stops.get("pr_1:digikey").message, "superseded");
  assert.equal(link.stops.get("pr_1:digikey").by, "pr_2:digikey");
  // The stopped run winding down tells BOM nothing, and stays superseded.
  const before = posts.length;
  await lab.links.pr_1.ended({ status: "stopped", message: "stopped" });
  assert.equal(posts.length, before);
  assert.equal(link.stops.get("pr_1:digikey").message, "superseded");

  await round();
  assert.deepEqual(started(lab), ["pr_1", "pr_2"]);
  assert.deepEqual([...link.running.keys()], ["pr_2:digikey"]);
  const beat = posts.filter((post) => post.path === "heartbeat").at(-1);
  assert.deepEqual(beat.body.activity, [{ purchase_request_id: "pr_1", seller: "digikey", step: "stopped", driver: "none", message: "superseded" }]);
  assert.deepEqual(link.staleTasks().map((task) => [task.key, task.seller, task.lines]), [["pr_1:digikey", "digikey", 2]]);
  // It is not started again by itself.
  await round();
  assert.deepEqual(started(lab), ["pr_1", "pr_2"]);
});


test("a run already placed at the supplier is not superseded: the new job waits", async () => {
  const { link, lab, round } = harness([[JOB], [JOB, OTHER]]);
  await round();
  await lab.link.placed({ orderNumber: "88001234" });
  await round();
  await round();
  assert.deepEqual(started(lab), ["pr_1"]);
  assert.deepEqual(lab.stopped, []);
  assert.deepEqual([...link.running.keys()], ["pr_1:digikey"]);
  assert.equal(link.ended.size, 0);
  assert.deepEqual(link.staleTasks(), []);
  // BOM shows the new one as waiting for the order that has the supplier.
  assert.deepEqual(link.activity(), [{ purchase_request_id: "pr_2", seller: "digikey", step: "queued", driver: "none", message: "pr_1" }]);
  // Nor does the person's Continue on the new one take the supplier.
  assert.deepEqual(await link.continueOrder("pr_2:digikey"), { ok: false, reason: "busy", holder: "pr_1" });
  assert.deepEqual(lab.stopped, []);
});


test("Continue on a superseded job takes the supplier back", async () => {
  const { link, lab, round } = harness([[JOB], [JOB, OTHER]]);
  await round();
  await round();
  await round();
  assert.deepEqual([...link.running.keys()], ["pr_2:digikey"]);

  assert.deepEqual(await link.continueOrder("pr_1:digikey"), { ok: true, where: "resume" });
  clearTimeout(link.nudgeTimer);
  // The one that had the supplier is stopped and kept in its turn.
  assert.deepEqual(lab.stopped, ["digikey", "digikey"]);
  assert.deepEqual(lab.stopOptions.at(-1), { soft: false });
  assert.deepEqual(started(lab), ["pr_1", "pr_2", "pr_1"]);
  assert.deepEqual([...link.running.keys()], ["pr_1:digikey"]);
  assert.equal(link.ended.has("pr_1:digikey"), false);
  assert.equal(link.stops.has("pr_1:digikey"), false);
  assert.equal(link.stops.get("pr_2:digikey").message, "superseded");
  assert.equal(link.stops.get("pr_2:digikey").by, "pr_1:digikey");
  assert.deepEqual(link.staleTasks().map((task) => task.key), ["pr_2:digikey"]);
  // An order BOM doesn't have is nobody's to continue.
  assert.deepEqual(await link.continueOrder("pr_9:digikey"), { ok: false, reason: "unknown" });
});


test("the jobs no longer valid are listed newest first, six at most", async (t) => {
  const jobs = Array.from({ length: 8 }, (_, index) => ({ ...JOB, purchase_request_id: `pr_${index + 1}` }));
  // Each new job comes while the one before it runs: one round to take the
  // supplier, the next to begin.
  const rounds = jobs.flatMap((_, index) => [jobs.slice(0, index + 1), jobs.slice(0, index + 1)]);
  const { link, lab, round } = harness(rounds);
  let now = Date.UTC(2026, 10, 25);
  t.mock.method(Date, "now", () => now);
  for (let index = 0; index < rounds.length; index += 1) {
    now += 60_000;
    await round();
  }
  assert.deepEqual(started(lab), jobs.map((job) => job.purchase_request_id));
  assert.deepEqual([...link.running.keys()], ["pr_8:digikey"]);
  assert.equal(link.stops.size, 7);
  const stale = link.staleTasks();
  assert.deepEqual(stale.map((task) => task.key), ["pr_7:digikey", "pr_6:digikey", "pr_5:digikey", "pr_4:digikey", "pr_3:digikey", "pr_2:digikey"]);
  assert.ok(stale.every((task, index) => index === 0 || task.at < stale[index - 1].at));
  assert.deepEqual(stale[0], { key: "pr_7:digikey", seller: "digikey", at: link.stops.get("pr_7:digikey").at, lines: 2 });
  // A run the person stopped is not one of them.
  await lab.link.ended({ status: "stopped", message: "stopped" });
  clearTimeout(link.nudgeTimer);
  assert.equal(link.stops.get("pr_8:digikey").message, "stopped");
  assert.ok(!link.staleTasks().some((task) => task.key === "pr_8:digikey"));
});


test("nothing decides beforehand whether the service is there: its answer is reported, once per change", async () => {
  const answers = [404, 404, 401, 200];
  const statuses = [];
  const logs = [];
  const link = new ServiceLink({
    fetch: async () => {
      const status = answers.shift();
      return { ok: status === 200, status, json: async () => ({ jobs: [] }) };
    },
    origin: "https://bom.test", openBuyLab: async () => ({}), version: "9.9.9",
    log: (message) => logs.push(message), onStatus: (status) => statuses.push(status),
  });
  for (let i = 0; i < 4; i += 1) await link.tick();
  assert.deepEqual(statuses.map((status) => [status.state, status.http ?? null]), [["error", 404], ["error", 401], ["ok", null]]);
  assert.equal(logs.length, 2, "the same failure is logged once, not every round");
  assert.deepEqual(link.status, { state: "ok" });
});


test("the suppliers Buying may hand over are the Buy lab's own profiles, not a list kept by hand", () => {
  const fs = require("node:fs");
  const main = fs.readFileSync(require.resolve("../src/main.js"), "utf8");
  const preload = fs.readFileSync(require.resolve("../src/preload.js"), "utf8");
  assert.match(main, /BUY_LAB_SUPPLIERS = SITES\.filter\(\(site\) => REQUIRED_TASKS\.every/);
  assert.doesNotMatch(preload, /openBuyLab|buy-lab-start|buyLab/);
  const { SITES } = require("../src/automation/sites");
  const { REQUIRED_TASKS } = require("../src/buy-lab-flow");
  assert.deepEqual(SITES.filter((site) => REQUIRED_TASKS.every((task) => site.tasks[task])).map((site) => site.id).sort(), ["digikey", "lcsc", "mouser"]);
});


test("a job from BOM opens the Buy lab out of sight; a checkout link brings it forward", async () => {
  const { link, lab, opens } = harness([[{ ...JOB, supplier_order_id: "so_9" }]]);
  await link.tick();
  assert.equal(lab.started.length, 1);
  assert.ok(opens.length > 0 && opens.every((options) => options.quiet === true), "service work never focuses the lab");
  assert.deepEqual(lab.shownQuiet, [true]);
  opens.length = 0;
  assert.equal(await link.openOrder("so_9"), JOB.seller);
  assert.ok(opens.some((options) => !options.quiet), "the person's checkout link opens it in front");
});


test("a run that fails before its cart tells BOM; a stop is reported as stopped until Continue", async () => {
  const failing = harness([[JOB]]);
  await failing.link.tick();
  await failing.lab.link.ended({ status: "failed", message: "The supplier page is not ready" });
  const cart = failing.posts.find((post) => post.path === "cart");
  assert.equal(cart.body.failed, "The supplier page is not ready");
  assert.deepEqual(failing.link.activity(), []);

  const stopped = harness([[JOB], [JOB]]);
  await stopped.link.tick();
  await stopped.lab.link.ended({ status: "stopped", message: "stalled" });
  assert.equal(stopped.posts.filter((post) => post.path === "cart").length, 0, "a stop does not fail the order");
  assert.deepEqual(stopped.link.activity(), [{ purchase_request_id: "pr_1", seller: "digikey", step: "stopped", driver: "none", message: "stalled" }]);
  await stopped.link.tick();
  const beat = stopped.posts.filter((post) => post.path === "heartbeat").at(-1);
  assert.deepEqual(beat.body.activity.map((item) => item.step), ["stopped"]);
  stopped.lab.link.resumed();
  assert.deepEqual(stopped.link.activity().filter((item) => item.step === "stopped"), []);
});
