"use strict";

/* Run supplier tasks against the real sites, from a terminal.
 *
 *   node scripts/live-run.cjs digikey addToCart '{"part":"GRM155R71C104KA88D","quantity":"10"}'
 *   node scripts/live-run.cjs digikey openCart
 *   node scripts/live-run.cjs lcsc pageMap            # save a page map of where the window is
 *
 * Opens the supplier window on the real site and drives it through the app's
 * own runner, printing every step as it happens. The profile persists in
 * .liveprofile, so a sign-in done once by hand is still there next time.
 *
 * Signing in, any security check and the yes for "place order" are the
 * person's: when a run says `waiting`, do it in the window and the run goes
 * on. This script never confirms an order on anyone's behalf. */

const path = require("node:path");
const fs = require("node:fs");
const { _electron: electron } = require("playwright");

const APP_DIR = path.resolve(__dirname, "..");
const PROFILE = path.join(APP_DIR, ".liveprofile");
const DOWNLOADS = path.join(PROFILE, "downloads");

const [, , site, task = "pageMap", ...argRest] = process.argv;
const rest = argRest.filter((arg) => !arg.startsWith("--"));
if (!site) {
  console.error("usage: node scripts/live-run.cjs <digikey|mouser|lcsc> [task] [part=C1525 quantity=100]");
  process.exit(2);
}
// key=value pairs, so no shell has to survive quoting JSON.
const params = Object.fromEntries(rest.map((pair) => {
  const at = pair.indexOf("=");
  if (at < 0) throw new Error(`expected key=value, got "${pair}"`);
  return [pair.slice(0, at), pair.slice(at + 1)];
}));

const BOM_URL = process.env.BOM_DESKTOP_URL || "https://bom.o2tech.ai";

/* Runs in the page: every control inside the elements a CSS selector picks,
 * to write row-scoped targets from. */
const probeCssSource = (selector) => `(() => {
  const describe = (el) => {
    const classes = typeof el.className === "string"
      ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 4) : [];
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "")
      + (classes.length ? "." + classes.join(".") : "");
  };
  const blocks = [...document.querySelectorAll(${JSON.stringify(selector)})].slice(0, 2);
  return {
    url: location.href,
    matched: document.querySelectorAll(${JSON.stringify(selector)}).length,
    blocks: blocks.map((block) => ({
      el: describe(block),
      controls: [...block.querySelectorAll("input, button, a, select, textarea, [role=button], [role=checkbox]")]
        .slice(0, 40).map((el) => ({
          el: describe(el),
          type: el.getAttribute("type") || el.getAttribute("role") || "",
          name: (el.getAttribute("aria-label") || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 50),
          value: (el.value ?? "").toString().slice(0, 30),
          checked: el.checked ?? null,
          href: (el.getAttribute("href") || "").slice(0, 70),
        })),
    })),
  };
})()`;

/* Runs in the page: the ancestor chain of the text, and the children of the
 * nearest ancestor that repeats like a row. */
const probeSource = (needle) => `(() => {
  const needle = ${JSON.stringify(needle)};
  const describe = (el) => {
    if (!el || !el.tagName) return null;
    const classes = typeof el.className === "string"
      ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 4) : [];
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "")
      + (classes.length ? "." + classes.join(".") : "");
  };
  const holders = [...document.querySelectorAll("*")].filter((el) =>
    el.children.length === 0 && el.textContent && el.textContent.includes(needle));
  const report = { url: location.href, holders: [], row: null };
  for (const el of holders.slice(0, 3)) {
    const chain = [];
    for (let node = el; node && node !== document.body; node = node.parentElement) chain.push(describe(node));
    report.holders.push(chain.reverse());
  }
  const first = holders[0];
  if (first) {
    for (let node = first; node && node !== document.body; node = node.parentElement) {
      const parent = node.parentElement;
      if (!parent) break;
      const alike = [...parent.children].filter((sib) =>
        sib.tagName === node.tagName && String(sib.className) === String(node.className));
      if (node.textContent.replace(/\\s+/g, " ").trim().length > needle.length + 15) {
        report.row = {
          selector: describe(node),
          siblingsAlike: alike.length,
          parent: describe(parent),
          text: node.textContent.replace(/\\s+/g, " ").trim().slice(0, 300),
          children: [...node.querySelectorAll("a, input, button, span, div")].slice(0, 30).map((child) => ({
            el: describe(child),
            text: (child.value || child.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60),
          })),
        };
        break;
      }
    }
  }
  return report;
})()`;

async function main() {
  fs.mkdirSync(DOWNLOADS, { recursive: true });
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [APP_DIR, `--bom-url=${BOM_URL}`],
    env: {
      ...process.env,
      BOM_DESKTOP_USER_DATA: PROFILE,
      BOM_DESKTOP_DOWNLOADS: DOWNLOADS,
      BOM_DESKTOP_AUTOMATION_TEST: "1",
      BOM_DESKTOP_DISABLE_UPDATES: "1",
    },
  });
  await app.firstWindow();

  const call = (name, ...rest) =>
    app.evaluate((_electron, [fn, args]) => globalThis.__bomAutomation[fn](...args), [name, rest]);

  await call("open", site);
  // Several tasks run in one window: "openCart,pageMap" maps the cart page.
  const tasks = task.split(",").filter(Boolean);
  console.log(`\n${site}: ${tasks.join(" then ")} ${JSON.stringify(params)}\n`);

  const seen = new Map();
  let waitingSaid = false;
  const watch = setInterval(async () => {
    let view;
    try { view = await call("view", site); } catch { return; }
    const run = view?.run;
    if (!run) return;
    for (const step of run.steps || []) {
      const key = `${step.index ?? ""}:${step.text || step.target || step.do}`;
      if (seen.get(key) === step.status) continue;
      seen.set(key, step.status);
      if (step.status !== "pending") console.log(`  ${step.status.padEnd(7)} ${step.text || step.target || step.do}`);
    }
    if (run.status === "waiting" && !waitingSaid) {
      waitingSaid = true;
      console.log(`\n  >> the run is waiting for you in the window (sign in, a security check, or a confirmation).`);
      console.log(`  >> do it there; the run carries on by itself. Ctrl-C here to stop.\n`);
    }
    if (run.status !== "waiting") waitingSaid = false;
  }, 700);

  for (const one of tasks) {
    let result;
    try {
      result = await call("run", site, one, params);
    } catch (error) {
      clearInterval(watch);
      console.error(`\n${one} FAILED: ${error.message}\n`);
      await app.close();
      process.exit(1);
    }
    const failed = (result.steps || []).filter((step) => step.status === "failed");
    console.log(`\n${one} status: ${result.status}`);
    if (failed.length) {
      console.log("failed steps:");
      for (const step of failed) console.log(`  ${step.text || step.target || step.do}  -- ${step.error || ""}`);
    }
    // Everything a task read or extracted lands in result.results, keyed by its `as`.
    for (const [key, value] of Object.entries(result.results || {})) {
      console.log(`${key}: ${JSON.stringify(value).slice(0, 4000)}`);
    }
    seen.clear();
  }
  clearInterval(watch);

  /* --probe=<text>: how the page is built around that text, to write row
   * selectors from. The outline lists what is operable; this shows structure. */
  const probeArg = process.argv.find((arg) => arg.startsWith("--probe=") || arg.startsWith("--probe-css="));
  if (probeArg) {
    const source = probeArg.startsWith("--probe-css=")
      ? probeCssSource(probeArg.slice("--probe-css=".length))
      : probeSource(probeArg.slice("--probe=".length));
    // The page lives in the person's Chrome, so it is read through the app's
    // own site hook, not an Electron webContents.
    const report = await app.evaluate(async (_electron, [id, code]) => (
      globalThis.__bomAutomation.site(id, "evaluate", code)
    ), [site, source]);
    const out = path.join(APP_DIR, "dom-probe.json");
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\nprobe written to ${out}`);
  }
  console.log(`\nthe window stays open; Ctrl-C to close it.`);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
