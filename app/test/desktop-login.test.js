"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const test = require("node:test");

const { createDesktopLogin, createPkce } = require("../src/desktop-login");

const ORIGIN = "https://bom.test";


function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path }, (response) => {
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode, location: response.headers.location }));
    }).on("error", reject);
  });
}


function harness({ exchange } = {}) {
  const opened = [];
  const stored = [];
  const events = [];
  const login = createDesktopLogin({
    origin: ORIGIN,
    openBrowser: async (url) => { opened.push(new URL(url)); },
    fetch: async (url, init) => {
      events.push({ url, init });
      return exchange ? exchange(url, init) : new Response(JSON.stringify({
        cookie_name: "__Host-bom_session", session_token: "token-1", max_age: 3600,
      }), { status: 200 });
    },
    storeSession: async (grant) => { stored.push(grant); },
    onSignedIn: () => events.push("signed-in"),
    onFailed: () => events.push("failed"),
  });
  return { login, opened, stored, events };
}


test("PKCE challenge is the S256 of a verifier the server never sees", () => {
  const { verifier, challenge, state } = createPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{64}$/);
  assert.match(state, /^[A-Za-z0-9_-]{32}$/);
  const expected = crypto.createHash("sha256").update(verifier).digest("base64url");
  assert.equal(challenge, expected);
});


test("the browser's code is redeemed once with the verifier, then the browser goes back to the site", async () => {
  const { login, opened, stored, events } = harness();
  const { port } = await login.start("google");
  const link = opened[0];
  assert.equal(`${link.origin}${link.pathname}`, `${ORIGIN}/desktop-login`);
  assert.equal(link.searchParams.get("provider"), "google");
  assert.equal(link.searchParams.get("port"), String(port));
  const state = link.searchParams.get("state");

  assert.equal((await get(port, "/elsewhere")).status, 404);
  assert.equal((await get(port, `/callback?code=abc&state=wrong-state`)).status, 400);
  assert.ok(login.pending, "a stray request does not end the attempt");

  const done = await get(port, `/callback?code=abc&state=${state}`);
  assert.equal(done.status, 303);
  assert.equal(done.location, `${ORIGIN}/desktop-login/done`);
  const [{ url, init }] = events;
  assert.equal(url, `${ORIGIN}/api/v1/auth/desktop/exchange`);
  assert.equal(init.credentials, "omit");
  const body = JSON.parse(init.body);
  assert.equal(body.code, "abc");
  assert.equal(crypto.createHash("sha256").update(body.verifier).digest("base64url"), link.searchParams.get("challenge"));
  assert.deepEqual(stored, [{ cookieName: "__Host-bom_session", token: "token-1", maxAge: 3600 }]);
  assert.equal(events.at(-1), "signed-in");
  assert.equal(login.pending, false);
  await assert.rejects(get(port, `/callback?code=abc&state=${state}`), "the listener is closed");
});


test("a refused exchange sends the browser to the failure page and stores nothing", async () => {
  const { login, opened, stored, events } = harness({ exchange: async () => new Response("{}", { status: 400 }) });
  const { port } = await login.start("microsoft");
  const state = opened[0].searchParams.get("state");
  const result = await get(port, `/callback?code=abc&state=${state}`);
  assert.equal(result.location, `${ORIGIN}/desktop-login/done?result=failed`);
  assert.deepEqual(stored, []);
  assert.equal(events.at(-1), "failed");
});


test("starting again retires the previous listener", async () => {
  const { login, opened } = harness();
  const first = await login.start("google");
  await login.start("google");
  await assert.rejects(get(first.port, `/callback?code=abc&state=${opened[0].searchParams.get("state")}`));
  login.stop();
});
