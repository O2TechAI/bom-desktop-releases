"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { isAllowedOrigin, resolveOrigin } = require("../src/config");
const { classifyNavigation, mayNavigate, mayUsePermission } = require("../src/policy");

const APP = "https://bom.o2tech.ai";


test("the window stays on the BOM site and sends everything else elsewhere", () => {
  const cases = {
    "https://bom.o2tech.ai/chat": "app",
    "https://bom.o2tech.ai/api/v1/exports/x.xlsx": "app",
    "blob:https://bom.o2tech.ai/7d6c": "app",
    "https://bom.o2tech.ai/api/v1/auth/google/login?next=/chat": "provider-login",
    "https://bom.o2tech.ai/api/v1/auth/microsoft/login": "provider-login",
    "https://accounts.google.com/o/oauth2/v2/auth?x=1": "identity-provider",
    "https://login.microsoftonline.com/common/oauth2": "identity-provider",
    "https://www.digikey.com/en/products": "external",
    "http://bom.o2tech.ai/chat": "external",
    "https://bom.o2tech.ai.evil.example/": "external",
    "bom-desktop://app/offline.html": "local",
    "blob:https://evil.example/7d6c": "blocked",
    "https://user:pass@evil.example/": "blocked",
    "file:///etc/passwd": "blocked",
    "javascript:alert(1)": "blocked",
    "data:text/html,hi": "blocked",
    "ms-settings:": "blocked",
    "not a url": "blocked",
  };
  for (const [url, kind] of Object.entries(cases)) {
    assert.equal(classifyNavigation(url, APP).kind, kind, url);
  }
  assert.equal(classifyNavigation(`${APP}/api/v1/auth/google/login`, APP).provider, "google");
});


test("only the app's own pages may open the app's own pages", () => {
  const local = "bom-desktop://app/offline.html";
  assert.ok(mayNavigate(`${APP}/chat`, { from: local, appOrigin: APP }));
  assert.ok(mayNavigate(local, { from: "bom-desktop://app/signin.html", appOrigin: APP }));
  assert.equal(mayNavigate(local, { from: `${APP}/chat`, appOrigin: APP }), false);
  assert.equal(mayNavigate(`${APP}/api/v1/auth/google/login`, { from: `${APP}/`, appOrigin: APP }), false);
  assert.equal(mayNavigate("https://www.digikey.com/", { from: `${APP}/`, appOrigin: APP }), false);
});


test("the site gets the clipboard and fullscreen, and nothing else", () => {
  assert.ok(mayUsePermission("clipboard-sanitized-write", `${APP}/chat`, APP));
  assert.ok(mayUsePermission("fullscreen", APP, APP));
  for (const permission of ["media", "geolocation", "notifications", "openExternal", "hid", "serial", "usb", "display-capture"]) {
    assert.equal(mayUsePermission(permission, `${APP}/chat`, APP), false, permission);
  }
  assert.equal(mayUsePermission("clipboard-sanitized-write", "https://evil.example/", APP), false);
  assert.equal(mayUsePermission("fullscreen", undefined, APP), false);
});


test("a packaged app opens only O2 sites, whatever it is told", () => {
  const builtIn = APP;
  assert.deepEqual(resolveOrigin({ builtIn, argv: [], env: {}, packaged: true }), { origin: APP, rejected: null });
  assert.deepEqual(
    resolveOrigin({ builtIn, argv: ["--bom-url=https://test2.yuxianglin.xyz/chat"], env: {}, packaged: true }),
    { origin: "https://test2.yuxianglin.xyz", rejected: null },
  );
  assert.deepEqual(
    resolveOrigin({ builtIn, argv: [], env: { BOM_DESKTOP_URL: "https://evil.example" }, packaged: true }),
    { origin: APP, rejected: "https://evil.example" },
  );
  assert.equal(
    resolveOrigin({ builtIn, argv: ["--bom-url=http://127.0.0.1:5173"], env: {}, packaged: true }).origin, APP,
  );
  assert.equal(
    resolveOrigin({ builtIn, argv: ["--bom-url=http://127.0.0.1:5173"], env: {}, packaged: false }).origin,
    "http://127.0.0.1:5173",
  );
  assert.equal(isAllowedOrigin("https://bom.o2tech.ai.evil.example", { packaged: false }), false);
});
