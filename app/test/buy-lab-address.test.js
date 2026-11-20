"use strict";

/* The address book and how a purchase uses it: saved on this computer,
 * checked before it is used, and given to the supplier's address form only
 * where the site knows how (DigiKey's placeOrderWithAddress). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const runnerModule = require("../src/automation/runner");

const calls = [];
class ScriptedRunner {
  constructor(options) { this.options = options; }
  async run() {
    calls.push({ task: this.options.task, params: this.options.params });
    if (this.options.task === "openCart") return { status: "done", steps: [], results: { cart: [] } };
    return { status: "done", steps: [], results: {} };
  }
  stop() {}
  approve() { return true; }
}
runnerModule.Runner = ScriptedRunner;

const { AddressBook, BuyLabFlow, addressParams, cleanAddress } = require("../src/buy-lab-flow");
const { Runner: RealRunner } = { Runner: require("../src/automation/runner").Runner };
const { SITES } = require("../src/automation/sites");

const HOME = {
  label: "Office",
  firstName: "Ada",
  lastName: "Lovelace",
  company: "O2 Test",
  email: "ada@example.com",
  phone: "555-0100",
  line1: "1 Main St",
  line2: "",
  city: "Columbus",
  state: "oh",
  zip: "43004",
};

function flowFor(id) {
  const site = SITES.find((entry) => entry.id === id);
  const flow = new BuyLabFlow({ sites: [site], getLive: () => ({ browser: { link: {} } }), onChange: (state) => {
    if (state.message === "cart-check") setImmediate(() => flow.confirmCart());
  } });
  return flow;
}


test("the address book keeps addresses on this computer, checked and trimmed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o2-addr-"));
  const book = new AddressBook(dir);
  assert.deepEqual(book.list(), []);
  const saved = book.save({ ...HOME, city: "  Columbus  " });
  assert.ok(saved.id);
  assert.equal(saved.state, "OH");
  assert.equal(saved.city, "Columbus");
  assert.deepEqual(book.list().map((entry) => entry.label), ["Office"]);
  assert.ok(fs.existsSync(path.join(dir, "buy-lab", "addresses.json")));

  // Saving with the same id replaces it; unknown fields are not kept.
  const again = book.save({ ...saved, city: "Dublin", cardNumber: "4111" });
  assert.equal(again.id, saved.id);
  assert.equal(book.list().length, 1);
  assert.equal(book.find(saved.id).city, "Dublin");
  assert.equal("cardNumber" in book.find(saved.id), false);

  assert.equal(book.remove(saved.id), true);
  assert.deepEqual(book.list(), []);
});


test("an address missing what the form needs, or with a bad state, is refused", () => {
  assert.throws(() => cleanAddress({ ...HOME, line1: " " }), /missing line1/);
  assert.throws(() => cleanAddress({ ...HOME, state: "Ohio" }), /two letters/);
  assert.throws(() => new AddressBook(fs.mkdtempSync(path.join(os.tmpdir(), "o2-addr-"))).save({ firstName: "A" }), /missing/);
  // The customer type defaults to 13 (Design/Research/Development) and must
  // be one DigiKey knows; a business buyer needs a company, an individual not.
  assert.equal(cleanAddress(HOME).customerType, "13");
  assert.throws(() => cleanAddress({ ...HOME, customerType: "42" }), /Unknown customer type/);
  assert.throws(() => cleanAddress({ ...HOME, company: "" }), /missing company/);
  assert.equal(cleanAddress({ ...HOME, company: "", customerType: "10" }).company, "");
  assert.equal(cleanAddress({ ...HOME, line2: "" }).line2, "");
});


test("with an address, DigiKey places the order through its address form", async () => {
  calls.length = 0;
  const flow = flowFor("digikey");
  await flow.start({ supplier: "digikey", text: "311-10.0KLRCT-ND 10", address: HOME });
  const place = calls.find((call) => call.task.startsWith("placeOrder"));
  assert.equal(place.task, "placeOrderWithAddress");
  // DigiKey gets the fields its form takes (its taskParams), all from the one address.
  const site = SITES.find((entry) => entry.id === "digikey");
  const all = addressParams(cleanAddress(HOME));
  assert.deepEqual(place.params, Object.fromEntries(site.taskParams.placeOrderWithAddress.map((key) => [key, all[key]])));
  assert.equal(place.params.state, "OH");
});


test("LCSC gets the same address, with the state's name for its searchable State", async () => {
  calls.length = 0;
  await flowFor("lcsc").start({ supplier: "lcsc", text: "C1525 10", address: HOME });
  const place = calls.find((call) => call.task.startsWith("placeOrder"));
  assert.equal(place.task, "placeOrderWithAddress");
  assert.equal(place.params.stateName, "Ohio");
  assert.equal(place.params.line1, HOME.line1);
  assert.equal(place.params.zip, HOME.zip);
});


test("without an address nothing changes: the form stays the person's", async () => {
  calls.length = 0;
  await flowFor("digikey").start({ supplier: "digikey", text: "311-10.0KLRCT-ND 10" });
  assert.equal(calls.find((call) => call.task.startsWith("placeOrder")).task, "placeOrder");
  calls.length = 0;
  await flowFor("lcsc").start({ supplier: "lcsc", text: "C1525 10" });
  assert.equal(calls.find((call) => call.task.startsWith("placeOrder")).task, "placeOrder");
});


test("a bad address stops the purchase before anything runs", async () => {
  calls.length = 0;
  await assert.rejects(flowFor("digikey").start({ supplier: "digikey", text: "311-10.0KLRCT-ND 10", address: { ...HOME, zip: "" } }), /missing zip/);
  assert.equal(calls.length, 0);
});


test("DigiKey's address task names a target for every field and runs only on the form", () => {
  const site = SITES.find((entry) => entry.id === "digikey");
  assert.doesNotThrow(() => new RealRunner({ contents: { on() {}, removeListener() {} }, profile: site, task: "placeOrderWithAddress", params: addressParams(cleanAddress(HOME)) }));
  const fill = site.machine.byName.get("fillAddress");
  const filled = fill.steps.filter((step) => step.do === "fill").map((step) => step.value);
  for (const field of ["email", "phone", "firstName", "lastName", "company", "line1", "line2", "city", "zip"]) {
    assert.ok(filled.includes(`{{${field}}}`), field);
  }
  assert.ok(fill.steps.some((step) => step.target === "addr.stateOption"));
  const act = site.tasks.placeOrderWithAddress.find((step) => step.do === "act");
  assert.equal(act.when, "addr.form");
  // No step of it confirms an order: that stays the person's yes.
  assert.equal(fill.confirm, undefined);
});


test("DigiKey's checkout pages after the address are known, and none of them orders", () => {
  const { recognise } = require("../src/automation/machine");
  const site = SITES.find((entry) => entry.id === "digikey");
  const at = (url, present = {}) => recognise(site.machine, url, present);
  assert.equal(at("https://www.digikey.com/ordering/guest/Address"), "shipping");
  // The address check dialog over the same page wins while it is open.
  assert.equal(at("https://www.digikey.com/ordering/guest/Address", { "addr.verifyPopup": true }), "addressCheck");
  assert.equal(at("https://www.digikey.com/ordering/guest/Ship"), "shippingOptions");
  assert.equal(at("https://www.digikey.com/ordering/Ship"), "shippingOptions");
  assert.equal(at("https://www.digikey.com/ordering/guest/Payment"), "payment");
  assert.equal(at("https://www.digikey.com/ordering/shoppingcart"), "cart");
  // Payment stays the person's; the two steps between address and payment
  // only press Continue; only submitOrder asks for the person's yes.
  assert.equal(site.machine.states.payment.person, "checkout_details");
  for (const name of ["acceptAddress", "chooseShipping"]) {
    const transition = site.machine.byName.get(name);
    assert.equal(transition.confirm, undefined, name);
    assert.deepEqual(transition.steps.map((step) => step.do), ["click"], name);
  }
  assert.equal(site.machine.byName.get("submitOrder").confirm.message, "place_order");
});


test("Buying's ship-to address becomes the forms' address; a non-US one fills nothing", () => {
  const { siteAddress } = require("../src/buy-lab-flow");
  const site = {
    id: "a1", label: "Lab", name: "Ada King Lovelace", company: "O2 Test", line1: "1 Main St", line2: "Suite 2",
    city: "Columbus", region: "Ohio", postal_code: "43004-1234", country: "US", phone: "+1 614 555 0100", email: "ada@example.com",
  };
  const address = siteAddress(site);
  assert.deepEqual(
    { first: address.firstName, last: address.lastName, state: address.state, zip: address.zip, type: address.customerType },
    { first: "Ada King", last: "Lovelace", state: "OH", zip: "43004", type: "13" },
  );
  assert.equal(siteAddress({ ...site, region: "oh", company: "" }).customerType, "10");
  assert.equal(siteAddress({ ...site, country: "CN" }), null);
  assert.throws(() => siteAddress({ ...site, email: "" }), /missing email/);
});


test("Buying's order lines become the list a supplier runs", () => {
  const { siteOrderText } = require("../src/buy-lab-flow");
  assert.equal(siteOrderText({ supplier: "lcsc", lines: [{ part: "C1525", quantity: "100" }, { part: " C25804 ", quantity: 10.2 }, { part: "", quantity: 1 }, { part: "X", quantity: 0 }] }),
    "C1525 100\nC25804 11");
  assert.equal(siteOrderText({ supplier: "digikey" }), "");
});
