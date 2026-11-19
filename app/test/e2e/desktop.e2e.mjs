// End to end: the real app against a BOM site that has the desktop sign-in
// endpoints, with a second browser playing the person's system browser.
//
//   BOM_DESKTOP_E2E_ORIGIN=http://127.0.0.1:15186 \
//   BOM_DESKTOP_E2E_EMAIL=… BOM_DESKTOP_E2E_PASSWORD=… \
//   xvfb-run -a npm run test:e2e
//
// The account must be a password account. BOM_DESKTOP_E2E_SCREENSHOTS=<dir>
// keeps a picture of each screen for review.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { _electron as electron, chromium } from "playwright";

const require = createRequire(import.meta.url);
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = process.env.BOM_DESKTOP_E2E_ORIGIN;
const EMAIL = process.env.BOM_DESKTOP_E2E_EMAIL;
const PASSWORD = process.env.BOM_DESKTOP_E2E_PASSWORD;
const SHOTS = process.env.BOM_DESKTOP_E2E_SCREENSHOTS;
const skip = !(ORIGIN && EMAIL && PASSWORD) && "set BOM_DESKTOP_E2E_ORIGIN, _EMAIL and _PASSWORD";

let workspace;
let browserLog;
let profile;

before(() => {
  workspace = mkdtempSync(path.join(os.tmpdir(), "bom-desktop-e2e-"));
  browserLog = path.join(workspace, "browser.log");
  profile = path.join(workspace, "profile");
  writeFileSync(browserLog, "");
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

after(() => rmSync(workspace, { recursive: true, force: true }));


function launch(origin = ORIGIN) {
  return electron.launch({
    executablePath: require("electron"),
    args: [APP_DIR, `--bom-url=${origin}`, "--lang=en-US"],
    env: { ...process.env, BOM_DESKTOP_USER_DATA: profile, BOM_DESKTOP_BROWSER_LOG: browserLog },
  });
}


/** The nth address (1-based) matching `pattern` that the app sent to the system browser. */
async function opened(pattern, timeout = 15000, nth = 1) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const lines = readFileSync(browserLog, "utf8").split("\n").filter((entry) => pattern.test(entry));
    if (lines.length >= nth) return lines[nth - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The app never opened ${pattern} in the system browser`);
}


async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}


async function signedInEmail(window) {
  return window.evaluate(async () => {
    const me = await (await fetch("/api/v1/auth/me")).json();
    return me.authenticated ? me.user.email : null;
  });
}


test("the window is locked down and hands other sites to the system browser", { skip }, async () => {
  const app = await launch();
  try {
    const window = await app.firstWindow();
    await window.waitForURL((url) => url.href.startsWith(ORIGIN));
    assert.equal(await window.evaluate(() => typeof require), "undefined");
    assert.equal(await window.evaluate(() => typeof process), "undefined");
    assert.deepEqual(Object.keys(await window.evaluate(() => window.o2Desktop)).sort(), ["platform", "version"]);
    assert.match(await window.evaluate(() => navigator.userAgent), /O2BOMDesktop\/\d/);

    await window.evaluate(() => { window.location.href = "https://www.digikey.com/en/products"; });
    await opened(/^https:\/\/www\.digikey\.com\/en\/products/);
    assert.ok(window.url().startsWith(ORIGIN), "the window did not leave the site");

    assert.equal(await window.evaluate(() => window.open("https://www.mouser.com/", "_blank")), null);
    await opened(/^https:\/\/www\.mouser\.com\//);
    await window.evaluate(() => { window.location.href = "file:///etc/hosts"; });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(window.url().startsWith(ORIGIN));
    assert.equal(readFileSync(browserLog, "utf8").includes("file:"), false);
    assert.equal(app.windows().length, 1);

    const camera = await window.evaluate(() =>
      navigator.mediaDevices?.getUserMedia({ video: true }).then(() => "granted", (error) => error.name) ?? "absent");
    assert.notEqual(camera, "granted");
  } finally {
    await app.close();
  }
});


test("Google sign-in runs in the system browser and lands in the app", { skip }, async () => {
  const app = await launch();
  const browser = await chromium.launch();
  try {
    const window = await app.firstWindow();
    await window.waitForURL((url) => url.href.startsWith(ORIGIN));
    await window.getByRole("button", { name: /sign in/i }).first().click();
    await shot(window, "1-app-sign-in");
    await window.getByText("Sign in with Google").click();

    const first = new URL(await opened(/\/desktop-login\?/));
    await window.waitForURL(/^bom-desktop:\/\/app\/signin\.html/);
    await window.getByRole("heading", { name: "Continue in your browser" }).waitFor();
    await shot(window, "2-app-continue-in-browser");

    // "Open the browser again" starts a fresh attempt; the first link stops working.
    await window.getByRole("link", { name: "Open the browser again" }).click();
    const link = new URL(await opened(/\/desktop-login\?/, 15000, 2));
    assert.notEqual(link.searchParams.get("state"), first.searchParams.get("state"));
    assert.equal(link.origin, ORIGIN);
    assert.equal(link.searchParams.get("provider"), "google");

    // The person's own browser, already signed in to BOM.
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const login = await page.request.post(`${ORIGIN}/api/v1/auth/password/login`, { data: { email: EMAIL, password: PASSWORD } });
    assert.equal(login.status(), 200, await login.text());
    await page.goto(link.toString());
    await page.getByRole("heading", { name: "Open BOM on this computer" }).waitFor();
    assert.ok(await page.getByText(EMAIL).isVisible());
    await shot(page, "3-browser-confirm");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(`${ORIGIN}/desktop-login/done`);
    await page.getByRole("heading", { name: "You're signed in" }).waitFor();
    await shot(page, "4-browser-done");

    await window.waitForURL((url) => url.href.startsWith(ORIGIN));
    await window.waitForFunction(async () => (await (await fetch("/api/v1/auth/me")).json()).authenticated);
    assert.equal(await signedInEmail(window), EMAIL);
    assert.equal((await window.evaluate(() => document.cookie)).includes("bom_session"), false, "the session cookie is httpOnly");
    await shot(window, "5-app-signed-in");

    // Opening the same link again does nothing: the listener has closed.
    await page.goto(link.toString());
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForEvent("requestfailed", { predicate: (request) => request.url().startsWith("http://127.0.0.1:") });
  } finally {
    await browser.close();
    await app.close();
  }

  const reopened = await launch();
  try {
    const window = await reopened.firstWindow();
    await window.waitForURL((url) => url.href.startsWith(ORIGIN));
    assert.equal(await signedInEmail(window), EMAIL, "the session survives a restart");
  } finally {
    await reopened.close();
  }
});


test("an unreachable site shows the app's own offline page", { skip }, async () => {
  const app = await launch("http://127.0.0.1:9");
  try {
    const window = await app.firstWindow();
    await window.waitForURL(/^bom-desktop:\/\/app\/offline\.html/);
    await window.getByRole("heading", { name: "Can't reach BOM" }).waitFor();
    await window.getByRole("button", { name: "Try again" }).waitFor();
    await shot(window, "6-app-offline");
  } finally {
    await app.close();
  }
});

