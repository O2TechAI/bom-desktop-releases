"use strict";

/* O2 BOM desktop: a locked-down window around the hosted BOM site.
 *
 * The site, its API and every sourcing job stay on the server. This process
 * owns the window, decides where it may navigate, signs in through the system
 * browser (desktop-login.js) and shows the app's own pages when the site
 * cannot be reached. See ../README.md for the security model. */

const fs = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, screen, session, shell } = require("electron");

const pkg = require("../package.json");
const { LOCAL_ORIGIN, LOCAL_SCHEME, PARTITION, resolveOrigin } = require("./config");
const { createDesktopLogin } = require("./desktop-login");
const { languageFor, translator } = require("./i18n");
const { buildMenuTemplate } = require("./menu");
const { classifyNavigation, mayNavigate, mayUsePermission } = require("./policy");
const { startUpdater } = require("./updater");
const { SITES, defineSite } = require("./automation/sites");
const { REQUIRED_TASKS } = require("./buy-lab-flow");

/* The suppliers the Buy lab can buy from: every site profile with the tasks a
 * purchase needs, not a list kept by hand (2026-11-20: a supplier missing from
 * a fixed list was greyed out on the site although the Buy lab could buy there). */
const BUY_LAB_SUPPLIERS = SITES.filter((site) => REQUIRED_TASKS.every((task) => site.tasks[task])).map((site) => site.id);
const { browserChoices, profileDir } = require("./automation/browser");
const { localFixture } = require("./automation/supplier-session");
const { SupplierWindow, registerAutomationIpc } = require("./automation/window");
const { BuyLabWindow, registerBuyLabIpc } = require("./buy-lab");
const { ServiceLink } = require("./buy-service-link");
const packageJson = require("../package.json");
const { MIN_SIZE, loadWindowState, saveWindowState } = require("./window-state");


const STATIC_DIR = path.join(__dirname, "..", "static");
/* The --page token (#ecf0f3), painted before the site's first frame. */
const PAGE_GROUND = "#ecf0f3";
const NET_ERROR_ABORTED = -3;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const LOCAL_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

protocol.registerSchemesAsPrivileged([
  { scheme: LOCAL_SCHEME, privileges: { standard: true, secure: true } },
]);
app.enableSandbox();

/* A development run can keep its profile apart from a real one. */
if (!app.isPackaged && process.env.BOM_DESKTOP_USER_DATA) {
  app.setPath("userData", process.env.BOM_DESKTOP_USER_DATA);
}
if (!app.isPackaged && process.env.BOM_DESKTOP_DOWNLOADS) {
  app.setPath("downloads", process.env.BOM_DESKTOP_DOWNLOADS);
}


const { origin, rejected } = resolveOrigin({
  builtIn: pkg.bomDesktop?.origin,
  argv: process.argv,
  env: process.env,
  packaged: app.isPackaged,
});
if (rejected) console.warn(`Ignoring BOM site ${JSON.stringify(rejected)}: not an O2 site.`);

let mainWindow = null;
/** The Buy lab window: DigiKey and Mouser embedded in the app. */
let buyLabWindow = null;
/** A Buy lab window still starting, so a double click waits for the one. */
let buyLabOpening = null;
let updater = null;
let t = translator("en");
let language = "en";
let desktopLogin = null;
/** Open supplier windows, by supplier id. */
const supplierWindows = new Map();

/* Development runs may add practice suppliers (end-to-end tests serve them
 * from this computer). A packaged app only knows the sites in sites/. */
const practiceSites = !app.isPackaged && process.env.BOM_DESKTOP_SUPPLIER_FIXTURES
  ? require(path.resolve(process.env.BOM_DESKTOP_SUPPLIER_FIXTURES)).map((site) => defineSite(site, { mayGo: localFixture }))
  : [];
const suppliers = [...SITES, ...practiceSites];


function localUrl(page, params = {}) {
  const url = new URL(`/${page}`, LOCAL_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}


async function serveLocal(request) {
  const { pathname } = new URL(request.url);
  const file = path.resolve(STATIC_DIR, `.${decodeURIComponent(pathname)}`);
  const type = MIME[path.extname(file)];
  if (!file.startsWith(`${STATIC_DIR}${path.sep}`) || !type) return new Response("Not found", { status: 404 });
  try {
    return new Response(await fs.readFile(file), {
      headers: { "Content-Type": type, "Content-Security-Policy": LOCAL_CSP, "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}


function webPreferences() {
  return {
    partition: PARTITION,
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    spellcheck: true,
    additionalArguments: [`--bom-desktop-version=${app.getVersion()}`, `--bom-desktop-suppliers=${BUY_LAB_SUPPLIERS.join(",")}`],
  };
}


function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === "darwin") app.focus({ steal: true });
}


async function openExternal(url) {
  const target = new URL(url);
  if (target.protocol !== "https:" && target.protocol !== "http:") return;
  // Development runs can record instead of opening a browser (end-to-end tests).
  if (!app.isPackaged && process.env.BOM_DESKTOP_BROWSER_LOG) {
    await fs.appendFile(process.env.BOM_DESKTOP_BROWSER_LOG, `${target.toString()}\n`);
    return;
  }
  await shell.openExternal(target.toString());
}


async function beginProviderLogin(provider, contents) {
  try {
    await desktopLogin.start(provider);
    await contents.loadURL(localUrl("signin.html", { provider, lang: language, home: `${origin}/` }));
  } catch (error) {
    console.error(`Desktop sign-in could not start: ${error.message}`);
    dialog.showErrorBox("O2 BOM", t("sign_in_failed"));
  }
}


function explainAccountLinking(contents) {
  const owner = BrowserWindow.fromWebContents(contents) || mainWindow;
  void dialog.showMessageBox(owner, {
    type: "info",
    message: t("link_title"),
    detail: t("link_body"),
    buttons: [t("open_in_browser"), t("ok")],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) void openExternal(new URL("/", origin).toString());
  });
}


/** Act on a navigation or window the policy did not let through. */
function divert(url, contents) {
  const verdict = classifyNavigation(url, origin);
  if (verdict.kind === "provider-login") void beginProviderLogin(verdict.provider, contents);
  else if (verdict.kind === "identity-provider") explainAccountLinking(contents);
  else if (verdict.kind === "external") void openExternal(url);
}


function guardNavigation(event, contents) {
  const target = event.url;
  if (mayNavigate(target, { from: contents.getURL(), appOrigin: origin })) {
    const local = new URL(target);
    // "Open the browser again" on the app's own sign-in page.
    if (classifyNavigation(target, origin).kind === "local" && local.searchParams.get("restart") === "1") {
      const provider = local.searchParams.get("provider");
      if (provider === "google" || provider === "microsoft") void desktopLogin.start(provider);
    }
    return;
  }
  event.preventDefault();
  divert(target, contents);
}


/* A supplier page stays on that supplier's hosts. Anything else on the web
 * opens in the system browser; other schemes go nowhere. The rule is enforced
 * inside the supplier's Chrome (automation/chrome-page.js), so only the app's
 * own windows reach the navigation guard below. */


function hardenContents(contents) {
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-navigate", (event) => {
    guardNavigation(event, contents);
  });
  contents.on("will-redirect", (event) => {
    if (!event.isMainFrame) return;
    if (classifyNavigation(event.url, origin).kind === "app") return;
    event.preventDefault();
    divert(event.url, contents);
  });
  contents.setWindowOpenHandler(({ url }) => {
    // BOM's "check out" to-do for an order the Buy lab service holds: the
    // order is in this app's Buy lab, not on a page.
    const order = checkoutOrder(url);
    if (order) {
      void (async () => {
        if (!(await serviceLink?.openOrder(order))) await openBuyLab();
      })().catch((error) => dialog.showErrorBox("O2 BOM", error.message));
      return { action: "deny" };
    }
    if (classifyNavigation(url, origin).kind === "app") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          backgroundColor: PAGE_GROUND,
          autoHideMenuBar: process.platform !== "darwin",
          webPreferences: webPreferences(),
        },
      };
    }
    divert(url, contents);
    return { action: "deny" };
  });
  contents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === NET_ERROR_ABORTED) return;
    if (classifyNavigation(url, origin).kind !== "app") return;
    void contents.loadURL(localUrl("offline.html", { lang: language, retry: url }));
  });
}


function configureSession() {
  const ses = session.fromPartition(PARTITION);
  ses.protocol.handle(LOCAL_SCHEME, serveLocal);
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(mayUsePermission(permission, details?.requestingUrl || contents?.getURL(), origin));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    mayUsePermission(permission, requestingOrigin, origin));
  ses.setDevicePermissionHandler(() => false);
  ses.setUserAgent(`${ses.getUserAgent()} O2BOMDesktop/${app.getVersion()}`);
  ses.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath("downloads"), item.getFilename()) });
  });
  return ses;
}


function createDesktopSignIn(ses) {
  return createDesktopLogin({
    origin,
    openBrowser: openExternal,
    fetch: (url, init) => ses.fetch(url, init),
    storeSession: async ({ cookieName, token, maxAge }) => {
      await ses.cookies.set({
        url: `${origin}/`,
        name: cookieName,
        value: token,
        path: "/",
        secure: origin.startsWith("https:"),
        httpOnly: true,
        sameSite: "lax",
        expirationDate: Math.floor(Date.now() / 1000) + Number(maxAge || 0),
      });
      await ses.cookies.flushStore();
    },
    onSignedIn: () => {
      if (!mainWindow) createMainWindow();
      void mainWindow.loadURL(`${origin}/`);
      focusMainWindow();
    },
    onFailed: (error) => console.error(`Desktop sign-in failed: ${error.message}`),
  });
}


function createMainWindow() {
  const state = loadWindowState(app.getPath("userData"), screen.getAllDisplays());
  mainWindow = new BrowserWindow({
    ...state.bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: "O2 BOM",
    backgroundColor: PAGE_GROUND,
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: webPreferences(),
  });
  mainWindow.once("ready-to-show", () => {
    if (state.maximized) mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on("close", () => saveWindowState(app.getPath("userData"), mainWindow));
  mainWindow.on("closed", () => { mainWindow = null; });
  void mainWindow.loadURL(`${origin}/`);
  return mainWindow;
}


/** Supplier windows still starting, by supplier id, so a double click waits
 * for the one Chrome instead of starting a second. */
const opening = new Map();

/* A supplier window is the person's own Chrome (or Edge) plus the app's task
 * panel. Without either browser there is no supplier window; say so instead of
 * quietly showing Electron's Chromium, which shops turn away. */
function openSupplier(id) {
  const existing = supplierWindows.get(id);
  if (existing) {
    existing.focus();
    return Promise.resolve(existing);
  }
  if (opening.has(id)) return opening.get(id);
  const profile = suppliers.find((site) => site.id === id);
  if (!profile) return Promise.reject(new Error(`Unknown supplier ${id}`));
  const choices = browserChoices();
  if (!choices.length) return Promise.reject(new Error(t("supplier_browser_missing")));

  const started = SupplierWindow.create(profile, {
    language,
    panelUrl: localUrl("automation.html", { lang: language }),
    panelPartition: PARTITION,
    preload: path.join(__dirname, "automation-preload.js"),
    downloadsPath: app.getPath("downloads"),
    profilePath: profileDir(app.getPath("userData"), id),
    browserChoices: choices,
    openExternal: (url) => void openExternal(url),
    logPath: path.join(app.getPath("userData"), "automation-runs.jsonl"),
    onClosed: () => { supplierWindows.delete(id); },
  }).then(
    (opened) => {
      supplierWindows.set(id, opened);
      opening.delete(id);
      return opened;
    },
    (error) => {
      opening.delete(id);
      throw error;
    },
  );
  opening.set(id, started);
  return started;
}


/* The Buy lab service's checkout page for one supplier order, on this BOM. */
function checkoutOrder(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/api\/v1\/buy-lab-service\/checkout\/(so_[A-Za-z0-9]+)$/);
    return parsed.origin === origin && match ? match[1] : null;
  } catch {
    return null;
  }
}


/** Buy lab: a pasted list, a purchase and its tracking, with a live picture
 * of the supplier's own Chrome when the shop stops for the person. */
let serviceLink = null;

/** `quiet`: a purchase BOM handed over opens the lab out of sight (and
 * leaves an open one where it is); the menu, a checkout link and BOM's
 * "Deal with it" bring it forward. */
async function openBuyLab({ quiet = false } = {}) {
  if (buyLabWindow) {
    if (!quiet) buyLabWindow.focus();
    return buyLabWindow;
  }
  if (buyLabOpening) {
    return buyLabOpening.then((lab) => {
      if (!quiet) lab.focus();
      return lab;
    });
  }
  buyLabOpening = useAccountLanguage().then(() => BuyLabWindow.create({
    quiet,
    language,
    pageUrl: localUrl("buy-lab.html", { lang: language }),
    pagePreload: path.join(__dirname, "buy-lab-preload.js"),
    partition: PARTITION,
    serviceStatus: () => serviceLink?.status || null,
    onResumeSaved: (id, resumeKey) => (serviceLink ? serviceLink.continueSaved(id, resumeKey) : false),
    userDataDir: app.getPath("userData"),
    openExternal: (url) => void openExternal(url),
    downloadsPath: app.getPath("downloads"),
    onClosed: () => { buyLabWindow = null; },
    onBackToSite: () => focusMainWindow(),
  })).then(
    (opened) => {
      buyLabWindow = opened;
      buyLabOpening = null;
      return opened;
    },
    (error) => {
      buyLabOpening = null;
      throw error;
    },
  );
  return buyLabOpening;
}


/* The Buy lab speaks the language the person chose in BOM (their account's
 * `language`), not the computer's (2026-11-20: a Chinese Windows showed a
 * Chinese Buy lab to someone using BOM in English). No choice, or BOM not
 * reachable: the computer's language, as before. */
async function useAccountLanguage() {
  try {
    const response = await session.fromPartition(PARTITION).fetch(`${origin}/api/v1/auth/me`, { credentials: "include" });
    if (!response.ok) return;
    const chosen = (await response.json())?.user?.language;
    if (!chosen) return;
    language = languageFor(chosen);
    t = translator(chosen);
  } catch {
    // keep the computer's language
  }
}


/* Whether an IPC call comes from the BOM site itself, in its top frame. */
function fromSite(event) {
  const frame = event.senderFrame;
  if (!frame || frame.parent) return false;
  try {
    return new URL(frame.url || "").origin === origin;
  } catch {
    return false;
  }
}


/* The BOM site asks for two things: supplier links open that supplier's
 * window (only a supplier the app knows), and Settings → Version reads,
 * checks and installs updates. Only the site itself, in its top frame, may
 * ask. */
function registerSiteIpc() {
  ipcMain.handle("desktop:open-supplier", async (event, id) => {
    if (!fromSite(event)) return { ok: false, message: "Not allowed" };
    if (!suppliers.some((site) => site.id === id)) return { ok: false, message: "Unknown supplier" };
    try {
      await openSupplier(id);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });
  // BOM's "Deal with it" on a seller being bought: that seller's own page
  // BOM's "Deal with it" on a seller being bought: that seller's own window.
  // (The Buy lab window is gone; the service keeps using it out of sight.)
  ipcMain.handle("desktop:open-seller-page", async (event, id) => {
    if (!fromSite(event)) return { ok: false, message: "Not allowed" };
    const seller = String(id || "");
    if (!suppliers.some((site) => site.id === seller)) return { ok: false, message: "Unknown supplier" };
    try {
      await openSupplier(seller);
      return { ok: true, where: "supplier" };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });
  ipcMain.handle("desktop:update-status", (event) => (fromSite(event) ? updater?.status() ?? null : null));
  ipcMain.handle("desktop:update-check", async (event) => (fromSite(event) && updater ? updater.check() : null));
  ipcMain.handle("desktop:update-install", async (event) => (fromSite(event) && updater ? updater.install() : false));
}


/* Every change of the update status reaches the site, if it is showing. */
function sendUpdateStatus(status) {
  const contents = mainWindow?.webContents;
  if (!contents || contents.isDestroyed()) return;
  try {
    if (new URL(contents.getURL()).origin !== origin) return;
  } catch {
    return;
  }
  contents.send("desktop:update-status", status);
}


/* End-to-end tests drive supplier windows from the main process. The site
 * lives in Chrome, outside Electron's pages, so the tests reach it through
 * these hooks: an address, a value, a click, a picture. */
if (!app.isPackaged && process.env.BOM_DESKTOP_AUTOMATION_TEST === "1") {
  globalThis.__bomAutomation = {
    open: async (id) => { await openSupplier(id); return true; },
    run: async (id, task, params) => (await openSupplier(id)).run(task, params),
    command: async (id, name, payload) => (await openSupplier(id)).command(name, payload),
    view: (id) => supplierWindows.get(id)?.view() ?? null,
    site: async (id, action, ...args) => {
      const opened = await openSupplier(id);
      const link = opened.site;
      switch (action) {
        case "url": return link.getURL();
        case "title": return link.getTitle();
        case "bounds": return opened.browser.windowBounds();
        case "evaluate": return link.evaluate(String(args[0] ?? ""));
        case "fill": return link.locatorHelpers().fill(args[0], args[1]);
        case "click": return link.locatorHelpers().click(args[0], args[1]);
        case "check": return link.locatorHelpers().check(args[0]);
        case "screenshot": return (await link.capturePage()).toPNG().toString("base64");
        default: throw new Error(`Unknown site action ${action}`);
      }
    },
  };
  /* Buy lab's suppliers are real Chrome pages behind a canvas; tests reach
   * them through the same hooks: a page address, a value, a picture. */
  globalThis.__bomBuyLab = {
    open: async () => { await openBuyLab(); return true; },
    select: (id) => buyLabWindow?.select(String(id)) ?? false,
    url: (id) => buyLabWindow?.live(id)?.page.url() ?? null,
    title: async (id) => (buyLabWindow?.live(id)?.page.title() ?? null),
    evaluate: (id, source) => buyLabWindow?.live(id)?.page.evaluate(String(source)) ?? null,
    input: (event) => buyLabWindow?.input(event) ?? false,
    screenshot: async (id) => {
      const live = buyLabWindow?.live(id);
      if (!live) return null;
      const image = await live.page.screenshot({ type: "jpeg", quality: 70 });
      return image.toString("base64");
    },
  };
}


if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", focusMainWindow);
  app.on("web-contents-created", (_event, contents) => hardenContents(contents));
  app.on("window-all-closed", () => {
    desktopLogin?.stop();
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (!mainWindow) createMainWindow();
  });
  // Chrome windows belong to the app: close them with it, so a supplier's
  // profile is not left locked by a browser nobody can see.
  let closingSuppliers = false;
  app.on("before-quit", (event) => {
    // The Buy lab's Chromes too: each keeps its sign-in as it closes
    // (automation/kept-signin.js), which needs the app still running.
    if (closingSuppliers || (supplierWindows.size === 0 && !buyLabWindow)) return;
    event.preventDefault();
    closingSuppliers = true;
    Promise.allSettled([...supplierWindows.values(), ...(buyLabWindow ? [buyLabWindow] : [])].map((opened) => opened.close()))
      .finally(() => { supplierWindows.clear(); app.quit(); });
  });

  app.whenReady().then(() => {
    language = languageFor(app.getLocale());
    t = translator(app.getLocale());
    const ses = configureSession();
    desktopLogin = createDesktopSignIn(ses);
    registerAutomationIpc();
    registerBuyLabIpc();
    registerSiteIpc();
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({
      platform: process.platform,
      packaged: app.isPackaged,
      t,
      openInBrowser: () => void openExternal(`${origin}/`),
      suppliers: suppliers.map((site) => ({ id: site.id, name: site.name })),
      openSupplier: (id) => {
        setImmediate(() => {
          void openSupplier(id).catch((error) => dialog.showErrorBox("O2 BOM", error.message));
        });
      },
    })));
    const fake = !app.isPackaged && process.env.BOM_DESKTOP_FAKE_UPDATE;
    updater = startUpdater({
      app, dialog, shell, t, signedMac: Boolean(packageJson.bomSignedMac),
      ...(fake ? { feed: { provider: "github", owner: "O2TechAI", repo: "bom-desktop-releases" }, autoUpdater: require("./dev-updater").fakeUpdater(fake) } : {}),
    });
    updater.onChange(sendUpdateStatus);
    createMainWindow();
    // BOM's purchasing service for DigiKey and LCSC buys here: ask it for
    // this person's work with the site's own session (buy-service-link.js).
    serviceLink = new ServiceLink({
      fetch: (url, init) => ses.fetch(url, init),
      origin,
      openBuyLab,
      version: app.getVersion(),
      log: (message) => console.warn(message),
      onStatus: () => buyLabWindow?.publish?.(),
      stateFile: path.join(app.getPath("userData"), "buy-lab", "service-stops.json"),
    });
    serviceLink.start();
  });
}
