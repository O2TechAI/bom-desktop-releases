"use strict";

/* Which BOM site the app opens.
 *
 * A build carries one origin in package.json (`bomDesktop.origin`). For
 * testing, BOM_DESKTOP_URL or --bom-url= can point the app somewhere else,
 * but a packaged app only accepts the O2 sites below: an app that will load
 * any site it is told to is a phishing tool with a trusted icon. An unpacked
 * development run may also use a local server. */

const KNOWN_ORIGINS = Object.freeze([
  "https://bom.o2tech.ai",
  "https://test2.yuxianglin.xyz",
]);

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The scheme of the app's own pages (offline, continue in browser). */
const LOCAL_SCHEME = "bom-desktop";
const LOCAL_ORIGIN = `${LOCAL_SCHEME}://app`;

/* One persistent browser profile for the site, so the session survives restarts. */
const PARTITION = "persist:bom";


function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.username || url.password) return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}


function isAllowedOrigin(origin, { packaged }) {
  if (!origin) return false;
  if (KNOWN_ORIGINS.includes(origin)) return true;
  if (packaged) return false;
  const url = new URL(origin);
  return LOCAL_HOSTS.has(url.hostname);
}


function requestedOrigin({ argv = [], env = {} } = {}) {
  const flag = argv.find((arg) => arg.startsWith("--bom-url="));
  return flag ? flag.slice("--bom-url=".length) : env.BOM_DESKTOP_URL || "";
}


/**
 * The origin to open. An override that is not allowed is ignored (and
 * reported), never trusted.
 */
function resolveOrigin({ builtIn, argv, env, packaged }) {
  const fallback = normalizeOrigin(builtIn) || KNOWN_ORIGINS[0];
  const requested = requestedOrigin({ argv, env });
  if (!requested) return { origin: fallback, rejected: null };
  const origin = normalizeOrigin(requested);
  if (isAllowedOrigin(origin, { packaged })) return { origin, rejected: null };
  return { origin: fallback, rejected: requested };
}


module.exports = {
  KNOWN_ORIGINS,
  LOCAL_ORIGIN,
  LOCAL_SCHEME,
  PARTITION,
  isAllowedOrigin,
  normalizeOrigin,
  resolveOrigin,
};
