"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MESSAGES, languageFor, translator } = require("../src/i18n");
const { buildMenuTemplate } = require("../src/menu");
const { DEFAULT_BOUNDS, loadWindowState, saveWindowState } = require("../src/window-state");

const SCREEN = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];


test("every language says every app string", () => {
  const keys = Object.keys(MESSAGES.en).sort();
  for (const language of ["zh", "es"]) assert.deepEqual(Object.keys(MESSAGES[language]).sort(), keys, language);
  assert.equal(languageFor("zh-TW"), "zh");
  assert.equal(languageFor("es-419"), "es");
  assert.equal(languageFor("fr-FR"), "en");
  assert.equal(translator("zh-CN")("ok"), "好");
});


test("developer tools are only in development runs", () => {
  const roles = (template) => JSON.stringify(template);
  const t = (key) => key;
  assert.ok(roles(buildMenuTemplate({ platform: "win32", packaged: false, t })).includes("toggleDevTools"));
  assert.equal(roles(buildMenuTemplate({ platform: "win32", packaged: true, t })).includes("toggleDevTools"), false);
  assert.equal(buildMenuTemplate({ platform: "darwin", packaged: true, t })[0].role, "appMenu");
});


test("the Suppliers menu opens each supplier's window, and Buy lab its own", () => {
  const opened = [];
  let buyLabs = 0;
  const template = buildMenuTemplate({
    platform: "linux",
    packaged: true,
    t: (key) => key,
    suppliers: [{ id: "digikey", name: "DigiKey" }, { id: "mouser", name: "Mouser" }],
    openSupplier: (id) => opened.push(id),
    openBuyLab: () => { buyLabs += 1; },
  });
  const menu = template.find((entry) => entry.label === "suppliers");
  assert.deepEqual(menu.submenu.map((item) => item.label), ["DigiKey", "Mouser"]);
  menu.submenu[1].click();
  assert.deepEqual(opened, ["mouser"]);
  const lab = template.find((entry) => entry.label === "buy_lab");
  assert.ok(lab, "the menu opens Buy lab");
  lab.click();
  assert.equal(buyLabs, 1);
  assert.equal(buildMenuTemplate({ platform: "linux", packaged: true, t: (key) => key }).some((entry) => entry.label === "suppliers"), false);
});


test("the window reopens where it was, unless that place is off every screen", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bom-desktop-"));
  const window = {
    getNormalBounds: () => ({ x: 100, y: 80, width: 1200, height: 800 }),
    isMaximized: () => true,
  };
  saveWindowState(directory, window);
  assert.deepEqual(loadWindowState(directory, SCREEN), {
    bounds: { x: 100, y: 80, width: 1200, height: 800 }, maximized: true,
  });
  assert.deepEqual(loadWindowState(directory, [{ workArea: { x: 3000, y: 0, width: 800, height: 600 } }]), {
    bounds: DEFAULT_BOUNDS, maximized: false,
  });
  fs.writeFileSync(path.join(directory, "window-state.json"), "{broken");
  assert.equal(loadWindowState(directory, SCREEN).maximized, false);
  fs.rmSync(directory, { recursive: true });
});
