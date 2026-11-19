// End to end: supplier windows on two practice shops with different DOM
// trees (test/e2e/practice-shops.cjs). The shop's page is the person's own
// Chrome, so the tests reach it through the app's `site` hook rather than
// through an Electron page. Runs without a BOM site or network:
//
//   xvfb-run -a npm run test:e2e
//
// BOM_DESKTOP_E2E_SCREENSHOTS=<dir> keeps a picture of each screen.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..", "..");
const SHOTS = process.env.BOM_DESKTOP_E2E_SCREENSHOTS;
const { createShops } = require("./practice-shops.cjs");
const { createDigiKeyShop } = require("./practice-digikey.cjs");

let shops;
let digikey;
let ports;
let bom;
let app;
let workspace;
let browserLog;

before(async () => {
  workspace = mkdtempSync(path.join(os.tmpdir(), "bom-suppliers-e2e-"));
  browserLog = path.join(workspace, "browser.log");
  mkdirSync(path.join(workspace, "downloads"));
  writeFileSync(browserLog, "");
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  shops = createShops();
  ports = await shops.listen();
  digikey = createDigiKeyShop();
  ports.dk = await digikey.listen();
  // A stand-in for the BOM site, so the main window has somewhere to go.
  bom = http.createServer((_request, response) => response.end("<!doctype html><title>BOM</title><h1>Buying</h1>"));
  await new Promise((resolve) => bom.listen(0, "127.0.0.1", resolve));
  app = await electron.launch({
    executablePath: require("electron"),
    args: [APP_DIR, `--bom-url=http://127.0.0.1:${bom.address().port}`, "--lang=en-US"],
    env: {
      ...process.env,
      BOM_DESKTOP_USER_DATA: path.join(workspace, "profile"),
      BOM_DESKTOP_DOWNLOADS: path.join(workspace, "downloads"),
      BOM_DESKTOP_BROWSER_LOG: browserLog,
      BOM_DESKTOP_AUTOMATION_TEST: "1",
      BOM_DESKTOP_SUPPLIER_FIXTURES: path.join(HERE, "practice-sites.cjs"),
      BOM_PRACTICE_PORTS: JSON.stringify(ports),
    },
  });
  await app.firstWindow();
});

after(async () => {
  await app?.close();
  shops?.close();
  digikey?.close();
  bom?.close();
  rmSync(workspace, { recursive: true, force: true });
});


const automation = (fn, ...args) => app.evaluate((_electron, [name, rest]) => globalThis.__bomAutomation[name](...rest), [fn, args]);
/** The shop's page: url, title, evaluate, fill, click, check, screenshot. */
const site = (id, action, ...args) => automation("site", id, action, ...args);


async function windowAt(prefix, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = app.windows().find((page) => page.url().startsWith(prefix));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No page at ${prefix}; open: ${app.windows().map((page) => page.url()).join(", ")}`);
}


/** Wait until the supplier's Chrome window shows an address. */
async function siteAt(id, test, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let url = "";
  while (Date.now() < deadline) {
    url = await site(id, "url").catch(() => "");
    if (test(url)) return url;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No supplier page matching; ${id} is at ${url}`);
}


/** The task panel of the supplier window with this name. */
async function panelFor(name, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const page of app.windows().filter((entry) => entry.url().startsWith("bom-desktop://app/automation.html"))) {
      if ((await page.evaluate(() => document.querySelector("#supplier")?.textContent).catch(() => "")) === name) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No panel for ${name}`);
}


async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}


async function shotSite(id, name) {
  if (!SHOTS) return;
  const picture = await site(id, "screenshot");
  writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(picture, "base64"));
}


test("one task adds to the cart on two shops built differently", async () => {
  for (const [id, shop, part, quantity] of [["practice-a", "a", "GRM155R71C104KA88D", "250"], ["practice-b", "b", "LM358DR", "40"]]) {
    await automation("open", id);
    const result = await automation("run", id, "addToCart", { part, quantity });
    const failed = result.steps.find((step) => step.status === "failed");
    assert.equal(result.status, "done", `${id}: ${failed ? `${failed.do} ${failed.target}: ${failed.error.message}` : result.status}`);
    assert.deepEqual(shops.carts[shop].at(-1), { part, qty: quantity }, id);
    await siteAt(id, (url) => url.startsWith(`http://127.0.0.1:${ports[shop]}/`));
    // The person saw it happen: the pointer and highlight were drawn on the page.
    assert.equal(await site(id, "evaluate", "Boolean(document.querySelector('o2-automation-overlay'))"), true);
    await shotSite(id, `suppliers-${id}-done`);
  }
  // Shop A's consent banner was in the way and was accepted; Shop B had a results list.
  const a = await automation("view", "practice-a");
  assert.equal(a.run.steps.find((step) => step.target === "cookies.accept").status, "done");
  const b = await automation("view", "practice-b");
  assert.equal(b.run.steps.find((step) => step.target === "results.exact").status, "done");
});


test("the panel runs a task, lists every step and reports the outcome", async () => {
  await automation("open", "practice-a");
  const panel = await panelFor("Shop A");
  await panel.getByLabel("Part number").fill("RC0402FR-0710KL");
  await panel.getByLabel("Quantity").fill("1,000");
  await panel.locator("[data-submit]").click();
  await panel.getByText("Add RC0402FR-0710KL × 1000").waitFor();
  await shot(panel, "suppliers-panel-running");
  await panel.locator("[data-status]", { hasText: "Done" }).waitFor({ timeout: 30000 });
  await panel.getByRole("status").filter({ hasText: "Added to cart" }).waitFor();
  const steps = await panel.locator(".step-text").allTextContents();
  assert.ok(steps.includes("Type 1000 in “Quantity”"), steps.join(" | "));
  assert.ok(steps.includes("Click “Add to cart”"), steps.join(" | "));
  assert.deepEqual(shops.carts.a.at(-1), { part: "RC0402FR-0710KL", qty: "1000" });
  await shot(panel, "suppliers-panel-done");

  // Missing values are said under their fields; nothing runs.
  await panel.getByLabel("Part number").fill("");
  await panel.locator("[data-submit]").click();
  await panel.getByText("Required").waitFor();
});


test("sign-in is handed to the person and the task carries on when they're done", async () => {
  await automation("open", "practice-b");
  const running = automation("run", "practice-b", "signIn", {});
  let waiting = null;
  for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
    const view = await automation("view", "practice-b");
    if (view.run?.status === "waiting") waiting = view;
    else await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(waiting, "the task waits for the person");
  await siteAt("practice-b", (url) => url.endsWith("/login"));
  // The person signs in on the shop's page.
  await site("practice-b", "fill", "User name", "buyer");
  await site("practice-b", "fill", "Password", "secret");
  await site("practice-b", "click", "button", "Log in");
  const result = await running;
  assert.equal(result.status, "done");
  assert.equal(shops.signedIn.b, true);
});


test("stop ends a task, and a shop page cannot leave its shop", async () => {
  await automation("open", "practice-a");
  const running = automation("run", "practice-a", "signIn", {});
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await automation("view", "practice-a")).run?.status === "waiting") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await automation("command", "practice-a", "stop", {});
  const stoppedRun = await running;
  assert.equal(stoppedRun.status, "stopped", JSON.stringify(stoppedRun.steps));

  const home = `http://127.0.0.1:${ports.a}/`;
  await siteAt("practice-a", (url) => url.startsWith(home));
  await site("practice-a", "evaluate", "window.location.href = 'https://www.example.org/elsewhere'");
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.ok((await site("practice-a", "url")).startsWith(home), await site("practice-a", "url"));
  assert.match(readFileSync(browserLog, "utf8"), /^https:\/\/www\.example\.org\/elsewhere/m);
  await site("practice-a", "evaluate", "window.location.href = 'file:///etc/hosts'");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.ok((await site("practice-a", "url")).startsWith(home));
});


/* ---- DigiKey: every operation, on the practice DigiKey ---- */

const DK = "practice-dk";

function failure(result) {
  const failed = result.steps.find((step) => step.status === "failed");
  return failed ? `${failed.do} ${failed.target}: ${failed.error.code} ${failed.error.message}` : result.status;
}

async function waitForRun(test, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const view = await automation("view", DK);
    if (view?.run && test(view.run)) return view.run;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out; last run: ${JSON.stringify((await automation("view", DK))?.run?.steps?.filter((s) => s.status !== "pending"))}`);
}


test("a supplier link opens the DigiKey tab, and only for a supplier the app knows", async () => {
  const page = await windowAt(`http://127.0.0.1:${bom.address().port}/`);
  assert.deepEqual(await page.evaluate(() => window.o2Desktop.openSupplier("nowhere")), { ok: false, message: "Unknown supplier" });
  assert.deepEqual(await page.evaluate(() => window.o2Desktop.openSupplier("practice-dk")), { ok: true });
  const view = await automation("view", DK);
  assert.equal(view.supplier.name, "DigiKey practice");
  assert.deepEqual(view.tasks.map((task) => task.id),
    ["signIn", "addToCart", "bulkAdd", "openCart", "removeFromCart", "checkout", "placeOrder", "orders", "track", "pageMap"]);
  assert.deepEqual(view.tasks.find((task) => task.id === "addToCart").defaults, { part: "GRM155R71C104KA88D", quantity: "10" });
  const panel = await panelFor("DigiKey practice");
  await shot(panel, "digikey-panel-start");
});


test("DigiKey: add to cart, read the cart, remove a line", async () => {
  for (const [part, quantity] of [["GRM155R71C104KA88D", "10"], ["RC0402FR-0710KL", "20"]]) {
    const result = await automation("run", DK, "addToCart", { part, quantity });
    assert.equal(result.status, "done", failure(result));
  }
  assert.deepEqual(digikey.state.cart, [{ part: "GRM155R71C104KA88D", qty: "10" }, { part: "RC0402FR-0710KL", qty: "20" }]);

  const cart = await automation("run", DK, "openCart", {});
  assert.equal(cart.status, "done", failure(cart));
  const lines = cart.results.cart.filter((line) => line.part);
  assert.deepEqual(lines.map((line) => [line.part, line.quantity, line.extended]),
    [["490-10698-1-ND", "10", "$1.00"], ["311-10.0KLRCT-ND", "20", "$2.00"]]);

  const removed = await automation("run", DK, "removeFromCart", { part: "RC0402FR-0710KL" });
  assert.equal(removed.status, "done", failure(removed));
  assert.deepEqual(digikey.state.cart, [{ part: "GRM155R71C104KA88D", qty: "10" }]);
});


test("DigiKey: a security check in Chinese is the person's, and the app lets go of the page meanwhile", async () => {
  digikey.state.challenge = true;
  digikey.state.challengeLoads = 0;
  const running = automation("run", DK, "addToCart", { part: "GRM155R71C104KA88D", quantity: "5" });
  let waiting = null;
  for (let attempt = 0; attempt < 150 && !waiting; attempt += 1) {
    const view = await automation("view", DK);
    if (view.run?.status === "waiting") waiting = view;
    else await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(waiting, "the task waits for the person");
  assert.equal(waiting.run.message, "challenge", "the check is recognised, not an unknown page");
  const site = await pageAt(`http://127.0.0.1:${ports.dk}/en/products/`);
  await site.getByRole("button", { name: "我是真人" }).waitFor();
  // The page was loaded again with nothing of the app's attached.
  for (let attempt = 0; attempt < 50 && digikey.state.challengeLoads < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(digikey.state.challengeLoads, 2);
  const ids = await automation("contents", DK);
  const attached = () => app.evaluate(({ webContents }, id) => webContents.fromId(id).debugger.isAttached(), ids.site);
  assert.equal(await attached(), false, "no protocol connection while the person does the check");
  assert.equal(await site.evaluate(() => Boolean(document.querySelector("o2-automation-overlay"))), false);
  await shot(await panelFor("DigiKey practice"), "digikey-challenge-panel");
  // The person passes the check; the task carries on by itself.
  await site.getByRole("button", { name: "我是真人" }).click();
  const result = await running;
  assert.equal(result.status, "done", failure(result));
  const added = digikey.state.cart.pop();
  assert.deepEqual(added, { part: "GRM155R71C104KA88D", qty: "5" });
});


test("DigiKey: the order is placed only after the person says yes in the panel", async () => {
  const panel = await panelFor("DigiKey practice");
  await panel.getByRole("button", { name: "Place order", exact: true }).click();
  await panel.getByRole("button", { name: "Go to review and order" }).click();

  // DigiKey asks to sign in at checkout: the person does that part.
  await waitForRun((run) => run.status === "waiting" && run.message === "sign_in");
  await siteAt(DK, (url) => url.includes("/MyDigiKey/Login"));
  await panel.getByText("Sign in on the left").waitFor();
  await site(DK, "fill", "Username or Email", "buyer");
  await site(DK, "fill", "Password", "practice");
  await site(DK, "click", "button", "Log In");

  // The address page is the person's too: continue, then choose how to pay.
  await waitForRun((run) => run.steps.some((step) => step.state === "shipping"), 90000);
  await siteAt(DK, (url) => url.includes("/ordering/checkout/shipping"));
  await panel.getByText("Finish checkout on the left").waitFor();
  await site(DK, "click", "button", "Continue");
  await waitForRun((run) => run.steps.some((step) => step.state === "payment"), 90000);
  await siteAt(DK, (url) => url.includes("/ordering/checkout/payment"));
  await site(DK, "check", "Net 30 terms");
  await site(DK, "click", "button", "Continue");

  // At the review page it stops and asks, showing the total.
  const confirming = await waitForRun((run) => run.status === "waiting" && run.confirming);
  assert.match(confirming.confirming.value, /\$7\.99/);
  await panel.getByText("Place this order?").waitFor();
  await panel.getByText("DigiKey practice charges $7.99 to the payment chosen at checkout.").waitFor();
  await shot(panel, "digikey-panel-confirm");
  // Continue (for hand-offs) is not a yes.
  await automation("command", DK, "continue", {});
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(digikey.state.orders.length, 0);
  assert.equal((await automation("view", DK)).run.status, "waiting");

  await panel.locator("[data-confirm]").getByRole("button", { name: "Place order" }).click();
  const done = await waitForRun((run) => ["done", "failed", "stopped"].includes(run.status), 60000);
  assert.equal(done.status, "done", failure(done));
  assert.equal(digikey.state.orders.length, 1);
  assert.match(done.results.orderNumber, /88012345/);
  await panel.locator("[data-results]").getByText("88012345").waitFor();
  await shot(panel, "digikey-panel-ordered");
});


test("DigiKey: Keep reviewing stops before anything is ordered", async () => {
  await automation("run", DK, "addToCart", { part: "GRM155R71C104KA88D", quantity: "5" });
  const running = automation("run", DK, "placeOrder", {});
  await waitForRun((run) => run.steps.some((step) => step.state === "shipping"), 90000);
  await siteAt(DK, (url) => url.includes("/ordering/checkout/shipping"));
  await site(DK, "click", "button", "Continue");
  await waitForRun((run) => run.steps.some((step) => step.state === "payment"), 90000);
  await siteAt(DK, (url) => url.includes("/ordering/checkout/payment"));
  await site(DK, "check", "Visa ending 4242");
  await site(DK, "click", "button", "Continue");
  await waitForRun((run) => run.status === "waiting" && run.confirming);
  const panel = await panelFor("DigiKey practice");
  await panel.getByRole("button", { name: "Keep reviewing" }).click();
  const result = await running;
  assert.equal(result.status, "stopped");
  assert.equal(digikey.state.orders.length, 1);
  assert.equal(digikey.state.cart.length, 1, "the cart is left as it was");
});


test("DigiKey: read the orders, then track one", async () => {
  const orders = await automation("run", DK, "orders", {});
  assert.equal(orders.status, "done", failure(orders));
  assert.deepEqual(orders.results.orders.map((order) => [order.number, order.status, order.total]), [["88012345", "Shipped", "$7.99"]]);
  // The panel offers the order it just read for tracking.
  assert.deepEqual((await automation("view", DK)).lastOrders, ["88012345"]);

  const track = await automation("run", DK, "track", { order: "88012345" });
  assert.equal(track.status, "done", failure(track));
  assert.equal(track.results.status, "Shipped");
  assert.deepEqual(track.results.shipments, [{ number: digikey.tracking, link: `https://www.ups.com/track?tracknum=${digikey.tracking}` }]);
  const panel = await panelFor("DigiKey practice");
  await panel.locator("[data-results]").getByText(digikey.tracking).waitFor();
  await shot(panel, "digikey-panel-tracking");
});


test("DigiKey: save the page map to Downloads", async () => {
  const result = await automation("run", DK, "pageMap", {});
  assert.equal(result.status, "done", failure(result));
  const files = readdirSync(path.join(workspace, "downloads"));
  assert.equal(files.length, 1);
  assert.match(files[0], /^practice-dk-page-.*\.json$/);
  const map = JSON.parse(readFileSync(path.join(workspace, "downloads", files[0]), "utf8"));
  assert.match(map.url, /\/OrderHistory\/Detail\/88012345$/);
  assert.ok(map.outline.length > 3);
  assert.equal(result.results.savedTo, files[0]);
});
