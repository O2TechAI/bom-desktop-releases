"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const { UNKNOWN, defineMachine, nextTransition, recognise } = require("../src/automation/machine");
const { ACTIONS, Runner } = require("../src/automation/runner");
const { SITES, defineSite } = require("../src/automation/sites");
const { COMMON_TARGETS } = require("../src/automation/sites/common");
const { BuyLabFlow, bulkLines, paaLines, parseLines } = require("../src/buy-lab-flow");
const { FALLBACK, readGround, validGround, writeGround } = require("../src/ground");
const fs = require("node:fs");
const os = require("node:os");
const {
  browserChoices,
  launchBounds,
  panelBounds,
  profileDir,
} = require("../src/automation/browser");
const {
  browserUserAgent,
  challengeMayOpen,
  hostMatches,
  localFixture,
  supplierMayOpen,
} = require("../src/automation/supplier-session");
const { fill, normalizeTarget } = require("../src/automation/targets");
const { overlayThemeCss, rootBlock } = require("../src/automation/theme");
const { MAX_HOSTS, createTrafficWatch } = require("../src/automation/traffic");

const PARAMS = { part: "GRM155R71C104KA88D", quantity: "100", order: "88012345", state: "OH", stateName: "Ohio", customerType: "13" };


function fakeContents() {
  const contents = new EventEmitter();
  contents.debugger = { isAttached: () => false, attach() {}, detach() {}, sendCommand: async () => ({}) };
  contents.isDestroyed = () => false;
  return contents;
}


test("targets become plain JSON for the page, with the task's values filled in", () => {
  const spec = normalizeTarget({
    any: [{ css: "a[title='{{part}}']" }, { role: "link", name: /^{{part}}$/i }, { label: "Qty" }],
    within: { any: [{ css: "tr" }], hasText: "{{part}}" },
    nth: 1,
  }, { part: "A+B.1" });
  assert.deepEqual(spec, {
    any: [
      { css: "a[title='A+B.1']" },
      { role: "link", name: { regex: "^A\\+B\\.1$", flags: "i" } },
      { label: "Qty" },
    ],
    within: { any: [{ css: "tr" }], hasText: "A+B.1" },
    nth: 1,
  });
  assert.equal(fill("q={{part|url}}", { part: "A B/C" }), "q=A%20B%2FC");
  assert.throws(() => fill("{{missing}}", {}), /no value for \{\{missing\}\}/);
  assert.throws(() => normalizeTarget({ any: [{ css: "a", role: "link" }] }), /exactly one/);
  assert.throws(() => normalizeTarget({ any: [{ xpath: "//a" }] }), /exactly one/);
  assert.throws(() => normalizeTarget({ any: [] }), /non-empty/);
});


test("a supplier window uses the browser this computer has, Chrome first", () => {
  const env = {
    PROGRAMFILES: "C:\\Program Files",
    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
  };
  const exists = (file) => file.includes("Chrome") || file.includes("Edge");
  assert.deepEqual(browserChoices({ platform: "win32", env, exists }), [{ channel: "chrome" }, { channel: "msedge" }]);
  assert.deepEqual(
    browserChoices({ platform: "win32", env, exists: (file) => file.includes("Edge") }),
    [{ channel: "msedge" }],
    "Edge alone is enough",
  );
  assert.deepEqual(browserChoices({ platform: "win32", env, exists: () => false }), [], "no browser, no supplier window");
  // A computer with its browser somewhere else can say where.
  assert.deepEqual(
    browserChoices({ platform: "linux", env: { BOM_DESKTOP_SUPPLIER_BROWSER: "/opt/chrome/chrome" }, exists: (file) => file === "/opt/chrome/chrome" }),
    [{ executablePath: "/opt/chrome/chrome" }],
  );
  assert.deepEqual(
    browserChoices({ platform: "linux", env: { BOM_DESKTOP_SUPPLIER_BROWSER: "msedge" } }),
    [{ channel: "msedge" }],
  );
});


test("the panel sits at the site window's right edge, inside the screen", () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const site = launchBounds(area);
  assert.deepEqual(site, { left: 0, top: 0, width: 1512, height: 1040 });
  assert.deepEqual(panelBounds(site, area), { x: 1520, y: 0, width: 400, height: 1040 });
  // A maximized site window clamps the panel to the work area, not off-screen.
  assert.deepEqual(panelBounds({ left: 0, top: 0, width: 1920, height: 1040 }, area), { x: 1520, y: 0, width: 400, height: 1040 });
  // The panel follows the site window to another display's work area.
  const second = { x: 1920, y: 0, width: 1280, height: 1024 };
  const moved = panelBounds({ left: 1920, top: 100, width: 900, height: 700 }, second);
  assert.deepEqual(moved, { x: 2800, y: 100, width: 400, height: 700 });
});


test("a supplier page may only open https pages on its own hosts", () => {
  assert.equal(hostMatches("www.digikey.com", "*.digikey.com"), true);
  assert.equal(hostMatches("digikey.com", "*.digikey.com"), true);
  assert.equal(hostMatches("evil-digikey.com", "*.digikey.com"), false);
  assert.equal(hostMatches("digikey.com.evil.io", "*.digikey.com"), false);
  const hosts = ["*.mouser.com"];
  assert.equal(supplierMayOpen("https://www.mouser.com/Cart/", hosts), true);
  assert.equal(supplierMayOpen("http://www.mouser.com/Cart/", hosts), false);
  assert.equal(supplierMayOpen("https://user:pw@www.mouser.com/", hosts), false);
  assert.equal(supplierMayOpen("https://www.digikey.com/", hosts), false);
  assert.equal(supplierMayOpen("javascript:alert(1)", hosts), false);
  assert.equal(supplierMayOpen("not a url", hosts), false);
  assert.equal(localFixture("http://127.0.0.1:4000/x"), true);
  assert.equal(localFixture("http://10.0.0.1/"), false);
  // A shop's checkpoint provider is not the shop's host, but the person has to
  // be able to finish the check where the app can see it.
  assert.equal(challengeMayOpen(`https://geo.captcha-delivery.com/interstitial/?cid=${"x".repeat(20)}`), true);
  assert.equal(challengeMayOpen("https://challenges.cloudflare.com/turnstile/v0/api.js"), true);
  assert.equal(challengeMayOpen("https://www.mouser.com/"), false);
  assert.equal(challengeMayOpen("http://geo.captcha-delivery.com/interstitial/"), false);
  assert.match(profileDir("C:/data", "digikey"), /suppliers[\\/]digikey[\\/]chrome$/);
  assert.throws(() => profileDir("C:/data", "../bom"), /Bad supplier id/);
});


test("supplier pages see a plain Chrome", () => {
  const electronAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) bom-desktop/0.0.1 Chrome/140.0.7339.41 Electron/45.3.2 Safari/537.36";
  assert.equal(
    browserUserAgent(electronAgent),
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.41 Safari/537.36",
  );
});


test("every supplier is complete: addresses, targets for every step, and its own hosts", () => {
  assert.deepEqual(SITES.map((site) => site.id).sort(), ["digikey", "lcsc", "mcmaster", "mouser", "tti"]);
  for (const site of SITES) {
    for (const url of Object.values(site.urls)) {
      const filled = fill(url, PARAMS);
      assert.equal(site.mayGo(filled), true, `${site.id} may open its own ${filled}`);
    }
    assert.equal(site.mayGo("https://www.example.org/"), false);
    for (const [name, target] of Object.entries(site.targets)) {
      assert.doesNotThrow(() => normalizeTarget(target, PARAMS), `${site.id} ${name}`);
      assert.ok(target.title?.en && target.title?.zh && target.title?.es, `${site.id} ${name} has a title in every language`);
    }
    for (const [task, steps] of Object.entries(site.tasks)) {
      for (const step of steps) {
        for (const name of [step.target, step.when, step.unless, step.until, step.or].filter(Boolean)) {
          assert.ok(site.targets[name], `${site.id} ${task}: no target ${name}`);
        }
      }
      assert.doesNotThrow(() => new Runner({ contents: fakeContents(), profile: site, task, params: PARAMS }), `${site.id} ${task}`);
    }
  }
});


test("a site overrides only the targets its DOM needs", () => {
  const site = defineSite({
    id: "shop",
    name: "Shop",
    hosts: ["shop.test"],
    urls: { home: "https://shop.test/", search: "https://shop.test/s?q={{part|url}}", cart: "https://shop.test/cart", signIn: "https://shop.test/login" },
    targets: { "product.quantity": { title: { en: "Qty", zh: "数量", es: "Cant." }, any: [{ css: "#qty" }] } },
  });
  assert.deepEqual(site.targets["product.quantity"].any, [{ css: "#qty" }]);
  assert.equal(site.targets["product.addToCart"], COMMON_TARGETS["product.addToCart"]);
  assert.throws(() => defineSite({ id: "Bad Id", name: "x", hosts: [], urls: {} }), /Bad supplier id/);
  assert.throws(() => defineSite({ id: "x", name: "X", hosts: [], urls: { home: "https://x/" } }), /needs a search address/);
});


test("a task with an unknown action or target is refused before it runs", () => {
  const site = SITES.find((entry) => entry.id === "lcsc");
  const broken = { ...site, tasks: { ...site.tasks, bad: [{ do: "click", target: "nowhere" }], worse: [{ do: "teleport" }] } };
  assert.throws(() => new Runner({ contents: fakeContents(), profile: broken, task: "bad" }), /no target "nowhere"/);
  assert.throws(() => new Runner({ contents: fakeContents(), profile: broken, task: "worse" }), /Unknown action/);
  assert.throws(() => new Runner({ contents: fakeContents(), profile: site, task: "teleport" }), /no task/);
});


test("the runner fills the site's addresses with the task's values and lists every step", () => {
  const site = SITES.find((entry) => entry.id === "lcsc");
  const runner = new Runner({ contents: fakeContents(), profile: site, task: "addToCart", params: { part: "C 1", quantity: "5" } });
  assert.equal(runner.params.search, "https://www.lcsc.com/search?q=C%201");
  const snapshot = runner.snapshot();
  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.steps.map((step) => [step.do, step.targetTitle?.en]), [["walk", "Product page"], ["act", "Add to cart"]]);
  assert.ok(snapshot.steps.every((step) => step.status === "pending"));
});


/* ---- the state machine (machine.js) ---- */

const T3 = (en) => ({ en, zh: en, es: en });
const SHOP_TARGETS = {
  "page.cart": { any: [{ css: "#cart" }] },
  "page.login": { any: [{ css: "#login" }] },
  "page.payment": { any: [{ css: "#payment" }] },
  "page.review": { any: [{ css: "#review" }] },
  "page.done": { any: [{ css: "#done" }] },
  "go.checkout": { any: [{ css: "#checkout" }] },
  "go.continue": { any: [{ css: "#continue" }] },
  "go.submit": { any: [{ css: "#submit" }] },
};
const SHOP_MACHINE = {
  states: {
    signIn: { title: T3("Sign in"), match: { all: ["page.login"] }, person: "sign_in" },
    done: { title: T3("Done"), match: { all: ["page.done"] } },
    review: { title: T3("Review"), match: { all: ["page.review"] } },
    payment: { title: T3("Payment"), match: { all: ["page.payment"] }, stuck: "checkout_details" },
    cart: { title: T3("Cart"), match: { url: /\/cart$/, all: ["page.cart"] } },
  },
  transitions: [
    { name: "goCart", title: T3("Open the cart"), from: "*", to: ["cart"], steps: [{ do: "goto", url: "{{cart}}" }] },
    { name: "checkout", title: T3("Check out"), from: ["cart"], to: ["signIn", "payment", "review"], steps: [{ do: "click", target: "go.checkout" }] },
    { name: "continue", title: T3("Continue"), from: ["payment"], to: ["payment", "review"], steps: [{ do: "click", target: "go.continue" }] },
    {
      name: "submit", title: T3("Submit"), from: ["review"], to: ["done"],
      confirm: { message: "place_order" }, steps: [{ do: "click", target: "go.submit" }],
    },
  ],
};


test("a machine that names a state, target or step that doesn't exist is refused", () => {
  const define = (machine) => defineMachine(machine, { targets: SHOP_TARGETS, actions: ACTIONS });
  assert.doesNotThrow(() => define(SHOP_MACHINE));
  const broken = (change) => ({ ...SHOP_MACHINE, ...change(SHOP_MACHINE) });
  assert.throws(() => define(broken((m) => ({ transitions: [...m.transitions, { name: "x", title: T3("x"), from: ["nowhere"], to: ["cart"], steps: [{ do: "goto", url: "/" }] }] }))), /no state "nowhere"/);
  assert.throws(() => define(broken((m) => ({ states: { ...m.states, cart: { title: T3("Cart"), match: { all: ["page.missing"] } } } }))), /no target "page.missing"/);
  assert.throws(() => define(broken((m) => ({ transitions: [...m.transitions, { name: "y", title: T3("y"), from: "*", to: ["cart"], steps: [{ do: "teleport" }] }] }))), /bad step/);
  assert.throws(() => define(broken((m) => ({ transitions: [...m.transitions, m.transitions[0]] }))), /unique/);
});


test("the walk takes a page's own transitions first and never plans through the person's pages", () => {
  const machine = defineMachine(SHOP_MACHINE, { targets: SHOP_TARGETS, actions: ACTIONS });
  assert.equal(nextTransition(machine, UNKNOWN, ["review"]).name, "goCart");
  assert.equal(nextTransition(machine, "cart", ["review"]).name, "checkout");
  assert.equal(nextTransition(machine, "payment", ["done"]).name, "continue");
  assert.equal(nextTransition(machine, "review", ["review"]), null);
  assert.equal(recognise(machine, "https://shop.test/cart", { "page.cart": true }), "cart");
  assert.equal(recognise(machine, "https://shop.test/other", { "page.cart": true }), UNKNOWN);
  // Earlier states win: a sign-in form on the cart page is the sign-in state.
  assert.equal(recognise(machine, "https://shop.test/cart", { "page.cart": true, "page.login": true }), "signIn");
  for (const site of SITES) {
    // Every goal an operation walks to can be reached from a page the machine doesn't know.
    for (const steps of Object.values(site.tasks)) {
      for (const step of steps.filter((entry) => entry.do === "walk")) {
        assert.ok(nextTransition(site.machine, UNKNOWN, [].concat(step.to)), `${site.id}: no way to ${step.to}`);
      }
    }
  }
});


/* A pretend browser for the walk: pages are ids, clicks move between them. */
function fakeShop() {
  const shop = { page: "home", clicks: [], person: [] };
  const pages = {
    home: { url: "https://shop.test/", has: [] },
    cart: { url: "https://shop.test/cart", has: ["page.cart"] },
    login: { url: "https://shop.test/login", has: ["page.login"] },
    payment: { url: "https://shop.test/pay", has: ["page.payment"] },
    review: { url: "https://shop.test/review", has: ["page.review"] },
    done: { url: "https://shop.test/done", has: ["page.done"] },
  };
  const moves = { "go.checkout": () => "login", "go.continue": () => (shop.paymentChosen ? "review" : "payment"), "go.submit": () => "done" };
  const css = (target) => target.any[0].css;
  const name = (target) => Object.keys(SHOP_TARGETS).find((key) => css(SHOP_TARGETS[key]) === css(target));
  shop.driver = {
    contents: { getURL: () => pages[shop.page].url, isLoading: () => false },
    attach: async () => {},
    detach: () => {},
    clearMarks: async () => {},
    checkStopped: () => {},
    settle: async () => {},
    present: async (named) => Object.fromEntries(Object.keys(named).map((key) => [key, pages[shop.page].has.includes(key)])),
    goto: async (url) => { shop.page = Object.keys(pages).find((id) => pages[id].url === url) || "home"; },
    click: async (target) => { const id = name(target); shop.clicks.push(id); shop.page = moves[id](); },
    exists: async () => false,
  };
  return shop;
}


test("a walk goes page by page, hands the person's pages over, and orders only after a yes", async () => {
  const profile = defineSite({
    id: "shop",
    name: "Shop",
    hosts: ["shop.test"],
    urls: { home: "https://shop.test/", search: "https://shop.test/s", cart: "https://shop.test/cart", signIn: "https://shop.test/login" },
    targets: Object.fromEntries(Object.entries(SHOP_TARGETS).map(([key, value]) => [key, { title: T3(key), ...value }])),
    machine: SHOP_MACHINE,
    tasks: { placeOrder: [{ do: "walk", to: "cart" }, { do: "walk", to: "done" }] },
  });
  const shop = fakeShop();
  const runner = new Runner({ contents: fakeContents(), profile, task: "placeOrder" });
  runner.driver = shop.driver;
  // The person: signs in, then chooses how to pay, then says yes.
  runner.onChange = (snapshot) => {
    if (snapshot.status !== "waiting") return;
    if (snapshot.message === "sign_in" && shop.page === "login") setTimeout(() => { shop.page = "payment"; }, 10);
    if (snapshot.message === "checkout_details" && !shop.paymentChosen) {
      setTimeout(() => { shop.paymentChosen = true; shop.page = "review"; }, 10);
    }
    if (snapshot.confirming) {
      shop.person.push(`asked with ${shop.clicks.length} clicks`);
      setTimeout(() => runner.approve(), 10);
    }
  };
  const result = await runner.run();
  assert.equal(result.status, "done", JSON.stringify(result.steps.filter((step) => step.error)));
  assert.equal(shop.page, "done");
  // Submit was clicked once, and only after the person was asked.
  // Continue left it on the payment page once: the person chose, not the app.
  assert.deepEqual(shop.clicks, ["go.checkout", "go.continue", "go.submit"]);
  assert.equal(shop.person[0], `asked with ${shop.clicks.length - 1} clicks`);
  const pagesSeen = result.steps.filter((step) => step.do === "state").map((step) => step.state);
  assert.deepEqual([...new Set(pagesSeen)], ["cart", "signIn", "payment", "review", "done"]);
  const handoffs = result.steps.filter((step) => step.do === "handoff").map((step) => step.message);
  assert.deepEqual(handoffs, ["sign_in", "checkout_details"]);
  // Two page changes waited for the person, and no security check was met.
  assert.deepEqual(result.metrics, { checks: 0, handoffs: 2, warmups: 0 });
});


/* A shop that asks for a security check when the cart is opened cold. */
function fakeCheckShop() {
  const T = (en) => ({ en, zh: en, es: en });
  const targets = {
    "page.cart": { title: T("Cart"), any: [{ css: "#cart" }] },
    "page.check": { title: T("Check"), any: [{ css: "#check" }] },
  };
  const site = defineSite({
    id: "shop",
    name: "Shop",
    hosts: ["shop.test"],
    urls: { home: "https://shop.test/", search: "https://shop.test/s?q={{part|url}}", cart: "https://shop.test/cart", signIn: "https://shop.test/login" },
    targets,
    machine: {
      states: {
        challenge: { title: T("Security check"), match: { all: ["page.check"] }, person: "challenge" },
        cart: { title: T("Cart"), match: { url: /\/cart$/, all: ["page.cart"] } },
      },
      transitions: [{
        name: "goCart",
        title: T("Open the cart"),
        from: "*",
        to: ["cart", "challenge"],
        steps: [{ do: "warmup" }, { do: "goto", url: "{{cart}}" }],
      }],
    },
    tasks: { openCart: [{ do: "walk", to: "cart" }] },
  });
  const pages = {
    home: { url: "https://shop.test/", has: [] },
    check: { url: "https://shop.test/cdn-cgi/challenge", has: ["page.check"] },
    cart: { url: "https://shop.test/cart", has: ["page.cart"] },
  };
  const state = { page: "home", gotos: [] };
  const driver = {
    contents: { getURL: () => pages[state.page].url, isLoading: () => false },
    attach: async () => {},
    detach: () => {},
    clearMarks: async () => {},
    checkStopped: () => {},
    settle: async () => {},
    present: async (named) => Object.fromEntries(Object.keys(named).map((key) => [key, pages[state.page].has.includes(key)])),
    exists: async () => false,
    goto: async (url) => {
      state.gotos.push(url);
      if (url.endsWith("/cart")) {
        // A cold browser is sent through the shop's check first.
        state.page = "check";
        setTimeout(() => { state.page = "cart"; }, 20); // the person finishes it
        return;
      }
      state.page = Object.keys(pages).find((id) => pages[id].url === url) || "home";
    },
  };
  return { site, state, driver };
}


test("a run goes through the shop's home page first and counts every check", async () => {
  const { site, state, driver } = fakeCheckShop();
  const runner = new Runner({
    contents: fakeContents(),
    profile: site,
    task: "openCart",
    warmupMs: 0,
    navigationGapMs: 0,
    checkSettleMs: 0,
  });
  runner.driver = driver;
  const result = await runner.run();
  assert.equal(result.status, "done", JSON.stringify(result.steps.filter((step) => step.error)));
  // The home page, then the cart: never the cart first on a cold session.
  assert.deepEqual(state.gotos, ["https://shop.test/", "https://shop.test/cart"]);
  assert.deepEqual(result.metrics, { checks: 1, handoffs: 1, warmups: 1 });
  const checks = result.steps.filter((step) => step.do === "handoff" && step.message === "challenge");
  assert.equal(checks.length, 1);
  // The panel says it in one line.
  const handoff = result.steps.find((step) => step.do === "handoff");
  assert.equal(handoff.status, "done");
});


test("a hand-off does not end just because the page is still loading", async () => {
  const site = defineSite({
    id: "shop",
    name: "Shop",
    hosts: ["shop.test"],
    urls: { home: "https://shop.test/", search: "https://shop.test/s", cart: "https://shop.test/cart", signIn: "https://shop.test/login" },
    targets: { "page.cart": { title: T3("Cart"), any: [{ css: "#cart" }] } },
    machine: {
      states: {
        shipping: { title: T3("Shipping"), match: { url: /\/address$/ }, person: "checkout_details" },
        cart: { title: T3("Cart"), match: { url: /\/cart$/ } },
      },
      transitions: [],
    },
    tasks: { go: [{ do: "walk", to: "cart" }] },
  });
  let loading = true;
  const page = { url: "https://shop.test/address" };
  const runner = new Runner({ contents: fakeContents(), profile: site, task: "go", checkSettleMs: 0 });
  runner.driver = {
    contents: { getURL: () => page.url, isLoading: () => loading },
    attach: async () => {},
    detach: async () => {},
    clearMarks: async () => {},
    checkStopped: () => {},
    present: async () => ({}),
  };
  // The address page finishes loading, then the person fills it and the shop
  // moves on; while the page is loading, the hand-off must not call itself done.
  setTimeout(() => { loading = false; }, 1200);
  setTimeout(() => { page.url = "https://shop.test/cart"; }, 2400);
  const result = await runner.run();
  assert.equal(result.status, "done", JSON.stringify(result.steps.filter((step) => step.error)));
  assert.equal(result.metrics.handoffs, 1);
  assert.deepEqual(result.steps.filter((step) => step.do === "handoff").map((step) => step.message), ["checkout_details"]);
});


test("a pasted purchase list becomes parts with quantities", () => {
  assert.deepEqual(
    parseLines("GRM155R71C104KA88D 10\nRC0402FR-0710KL, 100\n# a note\n\n LM358DR ; 5 "),
    [
      { mpn: "GRM155R71C104KA88D", quantity: "10" },
      { mpn: "RC0402FR-0710KL", quantity: "100" },
      { mpn: "LM358DR", quantity: "5" },
    ],
  );
  // No quantity means one piece; a quantity that isn't a positive whole
  // number falls back to one; a line without a number is all part number.
  assert.deepEqual(parseLines("LM358DR"), [{ mpn: "LM358DR", quantity: "1" }]);
  assert.deepEqual(parseLines("LM358DR 0"), [{ mpn: "LM358DR", quantity: "1" }]);
  assert.deepEqual(parseLines("LM358DR abc"), [{ mpn: "LM358DR abc", quantity: "1" }]);
  assert.deepEqual(parseLines(" \n # only notes \n"), []);
});


test("a security check hands Chrome to the person, then takes it back", () => {
  const seen = [];
  const flow = new BuyLabFlow({
    sites: [],
    getLive: () => null,
    onChange: () => {},
    onChallenge: (open) => seen.push(open),
  });
  flow.observe({ status: "waiting", message: "challenge", confirming: null });
  flow.observe({ status: "waiting", message: "challenge", confirming: null });
  flow.observe({ status: "running" });
  assert.deepEqual(seen, [true, false]);

  // A run that ends while the check is open also gives the window back.
  flow.observe({ status: "waiting", message: "challenge", confirming: null });
  flow.observe({ status: "failed" });
  assert.deepEqual(seen, [true, false, true, false]);
});


test("a supplier with a bulk list adds the whole list in one call", async () => {
  assert.equal(bulkLines([{ mpn: "A", quantity: "2" }, { mpn: "B", quantity: "3" }]), "2, A\n3, B");
  const site = {
    id: "digikey",
    name: "DigiKey",
    tasks: { addToCart: [], openCart: [], placeOrder: [], orders: [], track: [], bulkAddList: [] },
    taskParams: { bulkAddList: ["lines"] },
    machine: { states: {}, transitions: [] },
  };
  const calls = [];
  const flow = new BuyLabFlow({ sites: [site], getLive: () => ({}), onChange: () => {} });
  flow.runTask = async (task, params) => {
    calls.push({ task, params });
    return { status: "done", steps: [], results: {} };
  };
  await flow.start({ supplier: "digikey", text: "A 2\nB 3" });
  const bulk = calls.filter((call) => call.task === "bulkAddList");
  assert.equal(bulk.length, 1);
  assert.deepEqual(bulk[0].params, { lines: "2, A\n3, B" });
  assert.deepEqual(flow.lines.map((line) => line.status), ["added", "added"]);
});


test("a supplier with a BOM tool uploads one CSV file", async () => {
  const site = {
    id: "lcsc",
    name: "LCSC",
    tasks: { addToCart: [], openCart: [], placeOrder: [], orders: [], track: [], bulkAddBom: [] },
    taskParams: { bulkAddBom: ["file"] },
    machine: { states: {}, transitions: [] },
  };
  const calls = [];
  let content = null;
  const flow = new BuyLabFlow({ sites: [site], getLive: () => ({}), onChange: () => {} });
  flow.runTask = async (task, params) => {
    calls.push({ task, params });
    if (task === "bulkAddBom") content = fs.readFileSync(params.file, "utf8");
    return { status: "done", steps: [], results: {} };
  };
  await flow.start({ supplier: "lcsc", text: "C1525 10\nC25804 50" });
  assert.equal(calls.filter((call) => call.task === "bulkAddBom").length, 1);
  assert.match(content, /^LCSC Part Number,Quantity/);
  assert.match(content, /C1525,10/);
  assert.match(content, /C25804,50/);
  assert.deepEqual(flow.lines.map((line) => line.status), ["added", "added"]);
});


test("the window ground follows the site's theme and is remembered", () => {
  assert.equal(validGround("#AABBCC"), "#aabbcc");
  assert.equal(validGround(" rgb(1, 2, 3) "), null);
  assert.equal(validGround(""), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bom-ground-"));
  assert.equal(readGround(dir), FALLBACK);
  assert.equal(writeGround(dir, "#16191b"), true);
  assert.equal(readGround(dir), "#16191b");
  assert.equal(writeGround(dir, "not a colour"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});


test("a supplier with a pasted-list tool adds the whole list there", async () => {
  assert.equal(paaLines([{ mpn: "A", quantity: "2" }, { mpn: "B", quantity: "3" }]), "A | 2\nB | 3");
  const site = {
    id: "mouser",
    name: "Mouser",
    tasks: { addToCart: [], openCart: [], placeOrder: [], orders: [], track: [], bulkAddPaa: [] },
    taskParams: { bulkAddPaa: ["lines"] },
    machine: { states: {}, transitions: [] },
  };
  const calls = [];
  const flow = new BuyLabFlow({ sites: [site], getLive: () => ({}), onChange: () => {} });
  flow.runTask = async (task, params) => {
    calls.push({ task, params });
    return { status: "done", steps: [], results: {} };
  };
  await flow.start({ supplier: "mouser", text: "A 2\nB 3" });
  const bulk = calls.filter((call) => call.task === "bulkAddPaa");
  assert.equal(bulk.length, 1);
  assert.deepEqual(bulk[0].params, { lines: "A | 2\nB | 3" });
  assert.deepEqual(flow.lines.map((line) => line.status), ["added", "added"]);
});


test("the traffic watch counts what a page fetches and changes nothing", () => {
  const watch = createTrafficWatch({ now: () => 1000 });
  for (const url of ["https://www.digikey.com/", "https://www.digikey.com/en/products", "https://cdn.digikey.com/x.js"]) {
    watch.request(url);
  }
  watch.completed(200);
  watch.completed(404);
  watch.failed();
  const stats = watch.stats();
  assert.equal(stats.startedAt, 1000);
  assert.equal(stats.requests, 3);
  assert.equal(stats.failed, 2);
  assert.deepEqual(stats.hosts, { "www.digikey.com": 2, "cdn.digikey.com": 1 });
  // The panel reads a copy: showing the counts cannot change them.
  stats.hosts["www.digikey.com"] = 99;
  assert.equal(watch.stats().hosts["www.digikey.com"], 2);
  // Only MAX_HOSTS hosts are kept; everything past that is one "(other)" row.
  for (let index = 0; index < MAX_HOSTS + 5; index += 1) watch.request(`https://h${index}.example/`);
  const many = watch.stats().hosts;
  assert.equal(Object.keys(many).length, MAX_HOSTS + 1);
  assert.ok(many["(other)"] >= 5);
});


test("DigiKey opens the shop's home page before the cart, the orders and the sign-in", () => {
  const digikey = SITES.find((site) => site.id === "digikey");
  assert.equal(digikey.machine.byName.get("goCart").steps[0].do, "warmup");
  assert.equal(digikey.machine.byName.get("goOrders").steps[0].do, "warmup");
  assert.equal(digikey.tasks.signIn[0].do, "warmup");
  // A search is not a cold jump: it stays the first step of the search.
  assert.equal(digikey.machine.byName.get("search").steps[0].do, "goto");
  // The cart's own Bulk Add is how parts go in without the search page.
  assert.deepEqual(digikey.tasks.bulkAdd.map((step) => step.do), ["walk", "act"]);
  assert.ok(digikey.targets["cart.bulkText"].any.some((part) => part.css?.includes("textImportTextArea")));
});


test("a handoff with untilGone waits until the shop stops listing the bad items", async () => {
  const site = defineSite({
    id: "shop",
    name: "Shop",
    hosts: ["shop.test"],
    urls: { home: "https://shop.test/", search: "https://shop.test/s", cart: "https://shop.test/cart", signIn: "https://shop.test/login" },
    targets: { "cart.bulkError": { title: T3("Items not added"), any: [{ text: /were not added/i }] } },
    tasks: { fix: [{ do: "handoff", message: "bulk_error", untilGone: "cart.bulkError" }] },
  });
  let errorOnPage = true;
  const runner = new Runner({ contents: fakeContents(), profile: site, task: "fix", checkSettleMs: 0 });
  runner.driver = {
    contents: { getURL: () => "https://shop.test/cart", isLoading: () => false },
    attach: async () => {},
    detach: () => {},
    clearMarks: async () => {},
    checkStopped: () => {},
    exists: async () => errorOnPage,
  };
  setTimeout(() => { errorOnPage = false; }, 1100);
  const result = await runner.run();
  assert.equal(result.status, "done", JSON.stringify(result.steps.filter((step) => step.error)));
  assert.equal(result.metrics.handoffs, 1);
  const handoff = result.steps.find((step) => step.do === "handoff");
  assert.equal(handoff.message, "bulk_error");
  assert.equal(handoff.status, "done");
});


test("the pointer is drawn with the BOM tokens", () => {
  assert.equal(rootBlock(":root { --a: 1; }\n@media (x) { :root { --a: 2; } }").trim(), "--a: 1;");
  const css = overlayThemeCss(path.join(__dirname, "..", "static"));
  assert.match(css, /--spring-glide-duration:\s*458ms/);
  if (css.includes("--primary:")) assert.match(css, /--focus-ring:/);
});


test("the task panel says everything in every language", async () => {
  const { COPY } = await import(pathToFileURL(path.join(__dirname, "..", "static", "automation-copy.mjs")).href);
  const keys = Object.keys(COPY.en).sort();
  for (const language of ["zh", "es"]) assert.deepEqual(Object.keys(COPY[language]).sort(), keys, language);
  // Every step a task can show has words.
  for (const site of SITES) {
    for (const steps of Object.values(site.tasks)) {
      for (const step of steps) {
        const key = ["handoff", "confirm"].includes(step.do) ? `step_${step.do}_${step.message}` : `step_${step.do}`;
        assert.ok(Object.hasOwn(COPY.en, key), `${site.id}: ${key}`);
        if (step.do === "handoff") {
          assert.ok(Object.hasOwn(COPY.en, `handoff_${step.message}_title`), `${site.id}: handoff ${step.message}`);
        }
        if (step.do === "confirm") {
          assert.ok(Object.hasOwn(COPY.en, `confirm_${step.message}_title`), `${site.id}: confirm ${step.message}`);
        }
      }
    }
    // Every task has a name, a button and a toast.
    for (const task of Object.keys(site.tasks)) {
      for (const prefix of ["task_", "button_", "toast_", "run_"]) {
        assert.ok(Object.hasOwn(COPY.en, `${prefix}${task}`), `${site.id}: ${prefix}${task}`);
      }
      for (const param of site.taskParams[task] || []) assert.ok(Object.hasOwn(COPY.en, `field_${param}`), `field_${param}`);
    }
  }
});


test("Cloudflare's check is a security check in every language, on every supplier", () => {
  const { recognise } = require("../src/automation/machine");
  const { SITES } = require("../src/automation/sites");
  for (const site of SITES) {
    // Only the challenge-page script is there: headings translated, ids random.
    assert.equal(recognise(site.machine, `https://${site.hosts[0].replace("*.", "www.")}/en/products/detail/x`, { "challenge.page": true }), "challenge", site.id);
    assert.equal(site.machine.states.challenge.quiet, true, site.id);
  }
});
