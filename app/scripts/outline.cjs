"use strict";

/* Print the operable parts of a page (role, name, element), for writing a
 * supplier's target map in src/automation/sites/.
 *
 *   npx electron scripts/outline.cjs https://www.mouser.com/ [--wait=8000] [--shot=page.png]
 *
 * It opens the page in a visible window with its own throwaway profile, the
 * same way the supplier window does, waits, and prints JSON lines. */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, session } = require("electron");

const { Driver } = require("../src/automation/driver");
const { browserUserAgent } = require("../src/automation/supplier-session");

const url = process.argv.find((arg) => /^https?:\/\//.test(arg));
const wait = Number((process.argv.find((arg) => arg.startsWith("--wait=")) || "--wait=6000").slice(7));
const shot = (process.argv.find((arg) => arg.startsWith("--shot=")) || "").slice(7);

app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "bom-outline-")));

app.whenReady().then(async () => {
  if (!url) {
    console.error("Usage: electron scripts/outline.cjs <url> [--wait=ms] [--shot=file.png]");
    app.exit(2);
    return;
  }
  const ses = session.fromPartition("outline");
  ses.setUserAgent(browserUserAgent(ses.getUserAgent()));
  const window = new BrowserWindow({ width: 1366, height: 900, webPreferences: { session: ses, sandbox: true } });
  const driver = new Driver(window.webContents);
  try {
    await driver.attach();
    await driver.goto(url);
    await new Promise((resolve) => setTimeout(resolve, wait));
    const state = await driver.page("readyState");
    console.log(JSON.stringify({ url: state.url, title: state.title }));
    for (const row of await driver.outline(600)) console.log(JSON.stringify(row));
    if (shot) fs.writeFileSync(shot, await driver.screenshot());
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    driver.detach();
    app.quit();
  }
});
