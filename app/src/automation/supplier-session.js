"use strict";

/* Where a supplier window may go, and the browser name the outline tool uses.
 *
 * Each supplier gets its own Chrome profile (automation/browser.js), so a
 * person signs in to DigiKey once and stays signed in, and the BOM session
 * never meets a supplier's cookies. A supplier page may only open https pages
 * on that supplier's hosts; other links go to the system browser. */


/* The same Chrome as the app, without "Electron/…" and the app's own token:
 * some shops turn away browsers they don't recognise. */
function browserUserAgent(userAgent) {
  return String(userAgent)
    .replace(/\s?Electron\/\S+/g, "")
    .replace(/\s?bom-desktop\/\S+/gi, "")
    .replace(/\s?O2 BOM\/\S+/g, "")
    .replace(/\s?O2BOMDesktop\/\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}


function hostMatches(hostname, pattern) {
  const host = hostname.toLowerCase();
  const rule = pattern.toLowerCase();
  if (rule.startsWith("*.")) {
    const base = rule.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === rule;
}


/** Whether a supplier window may show `value`: https on one of its hosts. */
function supplierMayOpen(value, hosts) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  return hosts.some((pattern) => hostMatches(url.hostname, pattern));
}

/* The anti-bot checkpoints a shop may send the person through. They live on
 * the provider's own hosts, not the shop's, so they would otherwise be
 * treated as an outside link. Letting them load is what lets the person
 * finish the check where the app can see it; the check is still theirs. */
const CHALLENGE_HOSTS = [
  "*.captcha-delivery.com", // DataDome (Mouser)
  "challenges.cloudflare.com", // Cloudflare Turnstile
  "*.hcaptcha.com",
  "*.recaptcha.net",
  "*.arkoselabs.com",
  "*.funcaptcha.com",
  "*.perimeterx.net",
  "*.px-cdn.net",
];


/** Whether `value` is one of the checkpoint pages a supplier may go through. */
function challengeMayOpen(value, hosts = CHALLENGE_HOSTS) {
  return supplierMayOpen(value, hosts);
}


/** Whether a development fixture may open: any http(s) page on this computer. */
function localFixture(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}


module.exports = {
  CHALLENGE_HOSTS,
  browserUserAgent,
  challengeMayOpen,
  hostMatches,
  localFixture,
  supplierMayOpen,
};
