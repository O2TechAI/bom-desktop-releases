"use strict";

/* Where the app's windows may go, and what the site may ask for.
 *
 * Pure functions, so the rules are tested without Electron. The window code
 * (security.js) only maps each verdict to an action. */

const { LOCAL_ORIGIN } = require("./config");

const PROVIDER_LOGIN = /^\/api\/v1\/auth\/(google|microsoft)\/login\/?$/;

/* Sign-in pages of the identity providers. The site sends the window there to
 * add a sign-in method to an account; Google refuses embedded browsers, and
 * the system browser does not hold the app's session, so that one flow stays
 * on the web. */
const IDENTITY_PROVIDER_HOSTS = new Set([
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
]);

/* What the site may use. Everything else (camera, microphone, location, MIDI,
 * USB, HID, serial, screen capture...) is refused. */
const GRANTED_PERMISSIONS = new Set([
  "clipboard-sanitized-write",
  "fullscreen",
]);


function parse(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}


/**
 * What to do with a top-level navigation or a new window.
 *
 * - `app`: a page of the BOM site; stay in the app.
 * - `provider-login`: the site's Google/Microsoft sign-in; do it in the system browser.
 * - `identity-provider`: a provider's own page; explain, do not open here.
 * - `local`: one of the app's own pages.
 * - `external`: another http(s) site; open it in the system browser.
 * - `blocked`: anything else (file:, data:, javascript:, other schemes).
 */
function classifyNavigation(value, appOrigin) {
  const url = parse(value);
  if (!url) return { kind: "blocked" };
  if (url.origin === appOrigin) {
    const match = PROVIDER_LOGIN.exec(url.pathname);
    return match ? { kind: "provider-login", provider: match[1] } : { kind: "app" };
  }
  if (`${url.protocol}//${url.host}` === LOCAL_ORIGIN) return { kind: "local" };
  if (url.protocol === "blob:") {
    // blob:https://bom.o2tech.ai/<uuid> belongs to the site that made it.
    return parse(url.pathname)?.origin === appOrigin ? { kind: "app" } : { kind: "blocked" };
  }
  if (url.protocol === "https:" || url.protocol === "http:") {
    if (url.username || url.password) return { kind: "blocked" };
    return IDENTITY_PROVIDER_HOSTS.has(url.hostname) ? { kind: "identity-provider" } : { kind: "external" };
  }
  return { kind: "blocked" };
}


/** Whether a page may navigate the window to `target`. */
function mayNavigate(target, { from, appOrigin }) {
  const verdict = classifyNavigation(target, appOrigin);
  if (verdict.kind === "app") return true;
  // Only the app's own pages may open other app pages; the site may not.
  if (verdict.kind === "local") return classifyNavigation(from, appOrigin).kind === "local";
  return false;
}


function mayUsePermission(permission, requestingUrl, appOrigin) {
  const url = parse(requestingUrl);
  return Boolean(url && url.origin === appOrigin && GRANTED_PERMISSIONS.has(permission));
}


module.exports = {
  GRANTED_PERMISSIONS,
  IDENTITY_PROVIDER_HOSTS,
  classifyNavigation,
  mayNavigate,
  mayUsePermission,
};
