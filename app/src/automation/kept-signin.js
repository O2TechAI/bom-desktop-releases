"use strict";

/* Sign in to a seller once (2026-11-23: "我们希望的是所有情况下都是只要登录一次就行").
 *
 * What logged a person out, from the profiles' own cookies:
 * - DigiKey's sign-in lives in cookies without an expiry (PF, dk_loginid),
 *   which Chrome drops when it is closed the normal way and started again.
 *   The app keeps them: every couple of minutes and when the seller's Chrome
 *   closes, its session cookies are written next to the profile, sealed with
 *   the operating system's own encryption (Electron safeStorage: DPAPI on
 *   Windows, the Keychain on macOS), and the ones missing are put back when
 *   that Chrome starts. Without that encryption nothing is written.
 * - Mouser's sign-in ends on Mouser's side after a while with nothing done.
 *   While the seller's Chrome is open, a request in the page every quarter of
 *   an hour keeps it in use. It is a fetch from the page, not a navigation:
 *   what the person or the app is doing on the page is not touched.
 * - LCSC's sign-in simply runs out (its token lasts about 16 hours), and a
 *   Chrome closed for a night comes back signed out anywhere. So the login
 *   the person types on a seller's sign-in page is kept too, sealed the same
 *   way, one per seller, and the next time that seller asks for a sign-in the
 *   app fills it in and sends it before asking anyone (2026-11-23: the person
 *   said "Yes, build it" to keeping the password for this). A check, a code
 *   by mail or a wrong password still go to the person, whose next sign-in
 *   replaces what was kept. Nothing is kept without the system's encryption.
 */

const fs = require("node:fs");
const path = require("node:path");

let safeStorage = null;
try {
  ({ safeStorage } = require("electron"));
} catch {
  safeStorage = null; // outside Electron (tests): nothing is kept
}

const FILE = "kept-session.bin";
const LOGIN_FILE = "kept-login.bin";
const SAVE_EVERY_MS = 2 * 60 * 1000;
const PING_EVERY_MS = 15 * 60 * 1000;
const WATCH_EVERY_MS = 1500;

/* A page that counts as the person being there, per seller; else its home page. */
const KEEP_ALIVE = {
  mouser: "https://www.mouser.com/MyAccount/",
  digikey: "https://www.digikey.com/MyDigiKey",
};

function canSeal() {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable());
  } catch {
    return false;
  }
}

function seal(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, safeStorage.encryptString(JSON.stringify(value)));
  fs.renameSync(temp, file);
}

function unseal(file) {
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
  } catch {
    return null; // none yet, or sealed by another Windows user
  }
}

// ---- cookies ------------------------------------------------------------------

function keyOf(cookie) {
  return `${cookie.domain}|${cookie.path}|${cookie.name}`;
}

/** Put back the session cookies Chrome dropped since the last time. How many. */
async function restoreSessionCookies(context, profilePath) {
  if (!canSeal()) return 0;
  const saved = unseal(path.join(profilePath, FILE));
  if (!Array.isArray(saved)) return 0;
  const have = new Set((await context.cookies()).map(keyOf));
  let put = 0;
  for (const cookie of saved) {
    if (have.has(keyOf(cookie))) continue;
    try {
      await context.addCookies([{
        name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path || "/",
        expires: -1, httpOnly: Boolean(cookie.httpOnly), secure: Boolean(cookie.secure),
        ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
      }]);
      put += 1;
    } catch {
      // One the browser no longer takes (a SameSite rule): the others still go in.
    }
  }
  return put;
}

/** Keep this profile's cookies without an expiry, sealed. */
async function saveSessionCookies(context, profilePath) {
  if (!canSeal()) return;
  const session = (await context.cookies()).filter((cookie) => !(cookie.expires > 0));
  seal(path.join(profilePath, FILE), session);
}

/** A request to the seller from its own page, so its sign-in stays in use. */
async function ping(page, siteId) {
  if (!page || page.isClosed()) return;
  let origin = "";
  try {
    origin = new URL(page.url()).origin;
  } catch {
    return;
  }
  const target = KEEP_ALIVE[siteId] || `${origin}/`;
  // Only from the seller's own site (not a payment page or a sign-in elsewhere).
  const site = (host) => host.split(".").slice(-2).join(".");
  if (site(new URL(target).hostname) !== site(new URL(origin).hostname)) return;
  await page.evaluate((url) => fetch(url, { credentials: "include", mode: "no-cors", cache: "no-store" })
    .then(() => true, () => false), target).catch(() => {});
}

// ---- the login itself ---------------------------------------------------------

/* In the page: the visible sign-in fields, marked so the app can reach them.
 * Returns what they hold ({ user, pass }; null for a field that isn't there),
 * or null when the page shows no sign-in. A username alone is the first step
 * of a two-step sign-in. */
function markLoginFields() {
  const shown = (el) => el && !el.disabled && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  for (const el of document.querySelectorAll("[data-o2-login]")) el.removeAttribute("data-o2-login");
  const pass = [...document.querySelectorAll("input[type='password']")].find(shown) || null;
  const scope = (pass && (pass.form || pass.closest("form"))) || document;
  const texts = [...scope.querySelectorAll("input:not([type]), input[type='text'], input[type='email'], input[type='tel']")].filter(shown);
  const named = (el) => /user|email|e-mail|login|account|phone|mobile|账号|邮箱|手机/i
    .test(`${el.name} ${el.id} ${el.autocomplete} ${el.placeholder} ${el.getAttribute("aria-label") || ""}`);
  const user = texts.find(named) || (pass ? texts[texts.length - 1] : null) || null;
  if (!pass && !(user && named(user) && document.querySelector("input[type='password']") === null
    && /sign ?in|log ?in|登录/i.test(document.title + " " + (document.querySelector("h1, h2")?.textContent || "")))) return null;
  if (user) user.setAttribute("data-o2-login", "user");
  if (pass) pass.setAttribute("data-o2-login", "pass");
  return { user: user ? user.value : null, pass: pass ? pass.value : null };
}

function unmarkLoginFields() {
  for (const el of document.querySelectorAll("[data-o2-login]")) el.removeAttribute("data-o2-login");
}

/* "mouser.com" for www.mouser.com and auth.mouser.com alike. */
function siteOf(url) {
  try {
    return new URL(url).hostname.split(".").slice(-2).join(".").toLowerCase();
  } catch {
    return "";
  }
}

/** The frame of the page that shows the seller's own sign-in fields, with
 * what they hold. Only on the seller's site: a payment page's sign-in
 * (PayPal in the same tab) is never read or filled. */
async function loginFrame(page, home) {
  if (!page || page.isClosed()) return null;
  const own = siteOf(home);
  if (!own || siteOf(page.url()) !== own) return null;
  for (const frame of page.frames()) {
    if (siteOf(frame.url()) !== own) continue;
    const fields = await frame.evaluate(markLoginFields).catch(() => null);
    if (fields) return { frame, fields };
  }
  return null;
}

function loadLogin(profilePath) {
  if (!canSeal()) return null;
  const login = unseal(path.join(profilePath, LOGIN_FILE));
  return login?.password ? login : null;
}

function saveLogin(profilePath, login) {
  if (!canSeal() || !login?.password) return;
  seal(path.join(profilePath, LOGIN_FILE), { ...login, savedAt: new Date().toISOString() });
}

/**
 * Watch one seller's Chrome for its sign-in page: what the person types is
 * kept once the password form goes away after it was filled (the sign-in
 * went through, or at least moved on: a wrong one gets typed again and
 * replaces it).
 */
function watchLogins(page, profilePath, home) {
  let typed = null; // { username, password } on the form now
  let username = ""; // from a first step that asks for the name alone
  let busy = false;
  return async () => {
    if (busy || !canSeal()) return;
    busy = true;
    try {
      const found = await loginFrame(page(), home);
      if (found) await found.frame.evaluate(unmarkLoginFields).catch(() => {});
      if (found?.fields.pass) {
        typed = { username: found.fields.user || username || typed?.username || "", password: found.fields.pass };
      } else if (found?.fields.user) {
        username = found.fields.user;
      } else if (!found && typed?.password) {
        saveLogin(profilePath, typed);
        typed = null;
      }
    } finally {
      busy = false;
    }
  };
}

/**
 * Sign in again with the kept login, on the sign-in page showing now: fill
 * the name and password (a name-only first step too) and send the form.
 * True when the sign-in form went away within 25 seconds.
 */
async function signInAgain(page, profilePath, home) {
  const login = loadLogin(profilePath);
  if (!login) return false;
  for (let round = 0; round < 2; round++) {
    const found = await loginFrame(page, home);
    if (!found) return round > 0;
    const { frame, fields } = found;
    try {
      if (fields.user !== null && login.username && fields.user !== login.username) {
        await frame.locator("[data-o2-login='user']").fill(login.username, { timeout: 5000 });
      }
      if (fields.pass !== null) {
        await frame.locator("[data-o2-login='pass']").fill(login.password, { timeout: 5000 });
        await frame.locator("[data-o2-login='pass']").press("Enter", { timeout: 5000 });
      } else {
        await frame.locator("[data-o2-login='user']").press("Enter", { timeout: 5000 });
      }
    } catch {
      return false;
    } finally {
      await frame.evaluate(unmarkLoginFields).catch(() => {});
    }
    // Wait for the page to leave this step.
    const deadline = Date.now() + 25_000;
    let next = false;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const now = await loginFrame(page, home).catch(() => null);
      if (now) await now.frame.evaluate(unmarkLoginFields).catch(() => {});
      if (!now) return true;
      if (fields.pass === null && now.fields.pass !== null) { next = true; break; } // on to the password step
    }
    if (!next) return false;
  }
  return false;
}

/** Start keeping one seller's Chrome signed in; returns stop(), which saves once more. */
function keepSignedIn({ context, profilePath, siteId, home, page }) {
  const save = () => saveSessionCookies(context, profilePath).catch(() => {});
  const saver = setInterval(save, SAVE_EVERY_MS);
  const pinger = setInterval(() => { void ping(page(), siteId).catch(() => {}); }, PING_EVERY_MS);
  const watch = watchLogins(page, profilePath, home);
  const watcher = setInterval(() => { void watch().catch(() => {}); }, WATCH_EVERY_MS);
  saver.unref?.();
  pinger.unref?.();
  watcher.unref?.();
  return async () => {
    clearInterval(saver);
    clearInterval(pinger);
    clearInterval(watcher);
    await save();
  };
}

module.exports = { keepSignedIn, restoreSessionCookies, saveSessionCookies, signInAgain };
