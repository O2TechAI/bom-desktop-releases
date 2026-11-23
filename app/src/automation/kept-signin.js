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
 *
 * No password is read, kept or typed here.
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
const SAVE_EVERY_MS = 2 * 60 * 1000;
const PING_EVERY_MS = 15 * 60 * 1000;

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

function keyOf(cookie) {
  return `${cookie.domain}|${cookie.path}|${cookie.name}`;
}

/** Put back the session cookies Chrome dropped since the last time. How many. */
async function restoreSessionCookies(context, profilePath) {
  if (!canSeal()) return 0;
  let saved;
  try {
    saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(profilePath, FILE))));
  } catch {
    return 0; // none yet, or sealed by another Windows user
  }
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
  const file = path.join(profilePath, FILE);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, safeStorage.encryptString(JSON.stringify(session)));
  fs.renameSync(temp, file);
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

/** Start keeping one seller's Chrome signed in; returns stop(), which saves once more. */
function keepSignedIn({ context, profilePath, siteId, page }) {
  const save = () => saveSessionCookies(context, profilePath).catch(() => {});
  const saver = setInterval(save, SAVE_EVERY_MS);
  const pinger = setInterval(() => { void ping(page(), siteId).catch(() => {}); }, PING_EVERY_MS);
  saver.unref?.();
  pinger.unref?.();
  return async () => {
    clearInterval(saver);
    clearInterval(pinger);
    await save();
  };
}

module.exports = { keepSignedIn, restoreSessionCookies, saveSessionCookies };
