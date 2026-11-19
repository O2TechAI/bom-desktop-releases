"use strict";

/* Sign in with Google or Microsoft through the system browser (RFC 8252).
 *
 * Google and Microsoft refuse to sign in inside an embedded browser, so the
 * app opens /desktop-login on the BOM site in the person's own browser with:
 *
 *   - a PKCE challenge (SHA-256 of a verifier that never leaves this process),
 *   - a random state,
 *   - the port of a one-shot listener on 127.0.0.1.
 *
 * Once the person confirms the account there, the site sends the browser to
 * http://127.0.0.1:<port>/callback?code=…&state=…. The listener checks the
 * state, redeems the code with the verifier at /api/v1/auth/desktop/exchange,
 * stores the session cookie in the app's own profile, and sends the browser
 * back to /desktop-login/done. A code is useless without the verifier, so a
 * program that sees the redirect cannot sign in with it. */

const crypto = require("node:crypto");
const http = require("node:http");

const LISTEN_TIMEOUT_MS = 10 * 60 * 1000;


function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}


function createPkce(random = crypto.randomBytes) {
  const verifier = base64url(random(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge, state: base64url(random(24)) };
}


function browserLoginUrl(origin, { provider, challenge, state, port }) {
  const url = new URL("/desktop-login", origin);
  url.search = new URLSearchParams({ provider, challenge, state, port: String(port) }).toString();
  return url.toString();
}


function sameState(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}


/**
 * One sign-in at a time. Starting again replaces the listener, so a stale
 * browser tab can never finish an older attempt.
 *
 * @param {object} options
 * @param {string} options.origin           The BOM site.
 * @param {(url: string) => Promise<void>} options.openBrowser
 * @param {(url: string, init: object) => Promise<Response>} options.fetch  The app profile's fetch.
 * @param {(grant: {cookieName: string, token: string, maxAge: number}) => Promise<void>} options.storeSession
 * @param {() => void} options.onSignedIn
 * @param {(error: Error) => void} [options.onFailed]
 */
function createDesktopLogin(options) {
  const { origin, openBrowser, fetch, storeSession, onSignedIn, onFailed = () => {} } = options;
  let active = null;

  function stop() {
    if (!active) return;
    clearTimeout(active.timer);
    active.server.close();
    active.server.closeAllConnections?.();
    active = null;
  }

  function finish(response, result) {
    const target = new URL("/desktop-login/done", origin);
    if (result === "failed") target.searchParams.set("result", "failed");
    response.writeHead(303, { Location: target.toString(), "Cache-Control": "no-store" });
    response.end();
  }

  async function redeem(attempt, code) {
    const response = await fetch(new URL("/api/v1/auth/desktop/exchange", origin).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, verifier: attempt.verifier }),
      credentials: "omit",
    });
    if (!response.ok) throw new Error(`Desktop sign-in exchange failed with ${response.status}`);
    const grant = await response.json();
    if (!grant?.cookie_name || !grant?.session_token) throw new Error("Desktop sign-in exchange was incomplete");
    await storeSession({ cookieName: grant.cookie_name, token: grant.session_token, maxAge: grant.max_age });
  }

  function handle(attempt, request, response) {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== "/callback") {
      response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    const code = url.searchParams.get("code") || "";
    if (!sameState(url.searchParams.get("state") || "", attempt.state) || !code) {
      // Someone else's request: say nothing about this attempt, and keep listening.
      response.writeHead(400, { "Content-Type": "text/plain" }).end("Bad request");
      return;
    }
    if (attempt.used) {
      finish(response, "failed");
      return;
    }
    attempt.used = true;
    redeem(attempt, code).then(() => {
      finish(response, "done");
      if (active === attempt) stop();
      onSignedIn();
    }, (error) => {
      finish(response, "failed");
      if (active === attempt) stop();
      onFailed(error);
    });
  }

  async function start(provider) {
    stop();
    const attempt = { ...createPkce(), used: false };
    attempt.server = http.createServer((request, response) => handle(attempt, request, response));
    await new Promise((resolve, reject) => {
      attempt.server.once("error", reject);
      attempt.server.listen(0, "127.0.0.1", resolve);
    });
    attempt.timer = setTimeout(() => { if (active === attempt) stop(); }, LISTEN_TIMEOUT_MS);
    attempt.timer.unref?.();
    active = attempt;
    const { port } = attempt.server.address();
    await openBrowser(browserLoginUrl(origin, { provider, challenge: attempt.challenge, state: attempt.state, port }));
    return { port };
  }

  return { start, stop, get pending() { return Boolean(active); } };
}


module.exports = { browserLoginUrl, createDesktopLogin, createPkce };
