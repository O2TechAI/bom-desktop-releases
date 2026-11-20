# O2 BOM desktop

An Electron window around the hosted BOM site. The site, its API, the
database, the sourcing workers and every supplier and model key stay on the
server; this app owns only the window, where it may go, how it signs in and
what it shows when the site cannot be reached. A release of the site reaches
desktop users on their next page load, with no app update.

```
app/
  src/main.js            window, session, navigation guards, offline page
  src/policy.js          where the window may go, what the site may use (pure, tested)
  src/config.js          which site to open; packaged builds accept O2 sites only
  src/desktop-login.js   Google/Microsoft sign-in through the system browser
  src/preload.js         window.o2Desktop: platform, version, openSupplier, openBuyLab, updates
  src/updater.js         updates from the public releases repository
  src/automation/        supplier windows: browser actions on DigiKey, Mouser, LCSC
  static/                the app's own pages (offline, continue in browser, task panel)
  electron-builder.config.cjs   packaging, fuses, signing, update feed
```

## Run it

Node 22.12 or newer.

```bash
npm ci
npm start                                   # opens https://test2.yuxianglin.xyz
npm start -- --bom-url=http://127.0.0.1:5186   # a local site (unpacked runs only)
npm test                                    # unit tests
```

`BOM_DESKTOP_URL` does the same as `--bom-url`. A packaged app ignores both
unless the address is one of `KNOWN_ORIGINS` in `src/config.js`. An app that
loads any site it is told to would be a phishing tool with a trusted icon.

## Sign-in

Email and password sign-in happens in the window, as on the web.

Google and Microsoft refuse to sign in inside an embedded browser, so their
buttons open the system browser instead (RFC 8252):

1. The app makes a PKCE verifier and challenge and a random state, and starts
   a one-shot listener on `127.0.0.1` at a random port.
2. It opens `/desktop-login?provider=…&challenge=…&state=…&port=…` in the
   system browser and shows "Continue in your browser".
3. The site (`web/apps/bom/src/pages/DesktopLoginPage.jsx`) signs the browser
   in with that provider if it isn't already, then asks the person to confirm
   the account.
4. `POST /api/v1/auth/desktop/handoff` (signed-in, same origin) stores a
   one-time code bound to the challenge in Redis for two minutes and returns
   `http://127.0.0.1:<port>/callback?code=…&state=…`.
5. The listener checks the state and posts the code and verifier to
   `POST /api/v1/auth/desktop/exchange`. The first attempt spends the code,
   right or wrong. The server creates a separate session (login audit provider
   `desktop`), and the app stores it as an httpOnly cookie in its own profile.
6. The browser goes to `/desktop-login/done` and the app opens the workspace.

A code is useless without the verifier, which never leaves the app, so a
program that sees the redirect cannot sign in with it.

**Not in the app**: adding a Google or Microsoft sign-in method to an account
(Settings). That flow needs the window's own session in the provider's page;
the app explains this and offers to open BOM in the browser.

## Buy lab

Menu → **Buy lab** opens the purchasing flow: paste a list (one part number
and quantity per line), pick a supplier, and it runs through that supplier's
own pages in **the person's own Chrome** (rebrowser-playwright), kept
off-screen. The window shows the list and each line's state, then the cart,
the order and its tracking. It switches to the live page — a picture of the
same Chrome (`Page.startScreencast` into a canvas, with mouse, wheel and keys
sent back through the DevTools Input domain) — only when the shop stops for
the person: a security check, a sign-in, or the order confirmation. "Place
the order" waits for the person's click in the flow page; nothing else can
approve it.

Each supplier has its own persistent profile under the app's data folder
(`buy-lab/<id>/chrome`), separate from the automation windows, with the same
navigation rule: the site's own hosts stay, everything else opens in the
system browser. DigiKey and LCSC have the tasks this flow needs (add to cart, cart, place
order, orders, track). DigiKey takes the whole list through the cart's Bulk
Add box; LCSC uploads a BOM file. Mouser is not offered: its DataDome
refusals cannot be solved by a person, so it stays in the supplier windows.

```
src/buy-lab-flow.js   the list → add to cart → cart → order → orders/track run
src/buy-lab.js        Buy lab window: the flow page, the live page, the Chromes
src/live-browser.js   a real Chrome page as a picture: frames out, input back
src/live-window.js    one such page in a window (the standalone preview)
static/buy-lab.*      the list, its states, the cart/orders/tracking
static/live.*         the canvas, the input forwarding and the back button
```

## Supplier windows (browser actions)

Suppliers → DigiKey / Mouser / LCSC opens that supplier's site in **your own
Google Chrome or Microsoft Edge**, with the app's task panel docked at its
right edge (the panel follows that window as it is moved, resized, minimized
or maximized). The panel lists
every operation: sign in, add to cart, view cart, remove from cart, check out
(stops at the review page), place order, orders, track shipment, save page
map. The person watches the app work the page: a pointer glides to each
target, a ring marks it, keys are typed one at a time, and the panel lists
every page reached and every click as it happens. They can pause or stop at
any step. Signing in, security checks and choosing how to pay are handed to
the person ("Sign in on the left"). **Place order waits for the person's yes
in the panel**, showing the total; nothing else can approve it, and the app
never types a password or card number.

Chrome is driven by the `rebrowser-playwright` fork of Playwright
(`package.json` installs it under the name `playwright`): it is the same
protocol, with Playwright's own detectable protocol leaks patched out, so the
shop meets a normal Chrome a person could have opened. Each supplier signs in
once in its own profile under the app's data folder
(`suppliers/<id>/chrome`); the BOM session never meets those cookies. A shop's
checkpoint provider (DataDome, Turnstile, hCaptcha) is allowed to load even
though it is not the shop's host, so the person can finish the check in the
window. Without Chrome or Edge installed there is no supplier window: the app
says so instead of falling back to Electron's Chromium, which shops turn away.
A browser somewhere else can be named with `BOM_DESKTOP_SUPPLIER_BROWSER` (a
channel such as `msedge`, or a path to a Chromium-based executable).

```
src/automation/
  page-runtime.js     runs in the page (isolated world): finds targets, draws pointer and ring
  driver.js           the actions: goto, waitFor, click, fill, type, press, select,
                      check, upload, read, peek, waitForChange, extract, outline, screenshot
  chrome-page.js      the supplier's Chrome: its page, CDP session, navigation guard,
                      downloads, request counts, window bounds
  browser.js          which Chrome/Edge to use, its profile folder, the two window rectangles
  targets.js          how a step names what it acts on (see below)
  machine.js          a site's pages as a state machine: states, transitions, path finding
  runner.js           runs a task's steps and walks; pause, stop, hand-off, confirm
  sites/              one profile per supplier: hosts, addresses, targets, state machine, tasks
  window.js           the panel window, docked to Chrome, and the panel commands
  supplier-session.js where a supplier may go; the outline tool's plain browser name
static/automation.*   the task panel (en / zh / es)
src/buy-lab.js        Buy lab: DigiKey and Mouser embedded, one tab each
static/buy-lab.*      its tab strip
```

**Different DOM trees.** Steps never carry selectors. A step names a target
(`product.quantity`, `product.addToCart`), and each site's profile says how to
find it there. A target lists strategies, the most specific first, and the
first that finds something wins:

```js
"product.quantity": {
  title: { en: "Quantity", zh: "数量", es: "Cantidad" },
  within: { any: [{ css: "tr[id^='productId']" }], hasText: "{{part}}" },
  any: [{ css: "#qty" }, { label: /^(qty|quantity)/i }, { role: "spinbutton" }],
}
```

Strategies: `css` (through open shadow roots), `role` + `name`, `label`
(`<label>`, `aria-label`, `aria-labelledby`), `text`, `placeholder`, `testId`,
`attr` + `value`. `sites/common.js` holds targets that read a page the way a
person does (by role and words) and the shared tasks; a site overrides only
what its markup needs. Adding a supplier is a file in `sites/`. To see what a
page offers:

```bash
npx electron scripts/outline.cjs "https://www.lcsc.com/search?q=LM358DR" --shot=page.png
```

**Pages are states, clicks are transitions.** Each supplier's profile has a
state machine (`machine.js`). A state is a kind of page, recognised by its
address and the targets on it; a transition is a click or an address that
moves between states:

```js
states: {
  signIn:  { match: { all: ["account.signInForm"] }, person: "sign_in" },
  cart:    { match: { url: /\/ordering\/shoppingcart/i } },
  payment: { match: { url: /checkout/i, all: ["checkout.paymentPage"] }, stuck: "checkout_details" },
  review:  { match: { all: ["review.submit"] }, enter: [{ do: "read", target: "review.total", as: "total" }] },
},
transitions: [
  { name: "goCart", from: "*", to: ["cart"], steps: [{ do: "goto", url: "{{cart}}" }] },
  { name: "checkout", from: ["cart"], to: ["signIn", "shipping", "payment", "review"], steps: [{ do: "click", target: "checkout.start" }] },
  { name: "submitOrder", from: ["review"], to: ["confirmation"], confirm: { message: "place_order", show: "total" }, steps: [...] },
]
```

An operation names where to go and what to do there:
`[{ do: "walk", to: "cart" }, { do: "walk", to: "review" }]`. A walk
recognises the page, takes the first transition on a shortest path to the
goal, and recognises the page again, so a checkout that skips the address,
asks to sign in halfway or adds a notice page still gets there. `person`
states are handed over; a `stuck` state hands over when a click leaves it
where it was (a payment the app may not choose); an unknown page mid-way, or
the same page more than three times, hands over too. A page's own
transitions come before ones open from anywhere. `{ do: "act", name }`
takes one named transition (add to cart, remove a line) that a walk never
takes by itself. Each site has its own machine (`sites/digikey.js`,
`mouser.js`, `lcsc.js`); a new page on a site is one more state and its
transitions. "Save page map" writes the page's operable parts to Downloads
for writing them.

**How actions land.** The app drives Chrome through a DevTools protocol
session: clicks and keys go through the Input domain, so the page gets trusted
events at the place a person would click. Before acting, the driver waits
until the element is visible, still, enabled and not covered (a cookie banner
over a button is reported, not clicked through). The page runtime lives in an
isolated world, and the app never enables the Runtime domain, which some sites
watch for. Every top-level request is checked against the supplier's hosts and
refused otherwise; links elsewhere open in the system browser, and a shop's
"open in new tab" stays in its window, one page at a time. Subresources are
left alone: shops load their own CDNs.

**What has been checked.** LCSC runs live: add to cart by maker part number
(results page) and by LCSC number (product page, past its first-visit tour),
and reading the cart. On a person's own computer, in the app's Chrome, both
DigiKey and Mouser load their guarded pages without a Cloudflare challenge
(a fresh profile gets `cf_clearance` silently, warm or cold), and Mouser has
run search → product → add to cart → read the cart → remove the line end to
end against the live site; its cart table targets come from that live page.
DigiKey and Mouser checkout, review, orders and tracking need an account, so
their profiles stay `verified: false` and the panel says "Not yet tested"
until a real signed-in run goes through. The end-to-end test runs every DigiKey
operation on a practice DigiKey that copies its markup
(`test/e2e/practice-digikey.cjs`), and one task on two practice shops built
differently (`test/e2e/practice-shops.cjs`); both run in the same Chrome
window the person would see. `scripts/live-run.cjs` opens a real shop the same
way, for building targets against the live page.

## Security model

- Every window: `contextIsolation`, `sandbox`, no Node integration, no
  `<webview>`, no navigation by dropping files, `webSecurity` on.
- Navigation (`src/policy.js`): pages of the BOM site stay in the window. The
  site's Google and Microsoft sign-in go to the system browser as above. Other
  `http(s)` links open in the system browser. Everything else (`file:`,
  `data:`, `javascript:`, other schemes, URLs with credentials) is dropped.
  Server redirects off the site are treated the same way.
- Permissions: the site may write to the clipboard and go fullscreen. Camera,
  microphone, location, notifications, USB/HID/serial and screen capture are
  refused.
- The preload exposes `window.o2Desktop = { platform, version }` and no
  functions. A capability added later needs an IPC handler that checks the
  sender's origin.
- Packaged builds flip Electron's fuses: no `ELECTRON_RUN_AS_NODE`, no
  `NODE_OPTIONS`, no `--inspect`, asar integrity checked, app code only from
  the asar, cookies encrypted at rest, no extra `file:` privileges.
- The app's own pages are served from `bom-desktop://app` with a strict CSP.
  The site cannot navigate to them.
- The user agent ends in `O2BOMDesktop/<version>`, so logs and the login
  audit can tell desktop sessions apart.

## Release

```bash
npm run dist          # this platform's installers in release/
npm run pack          # an unpacked app, quicker, for checking
```

The `Desktop` workflow runs the tests on every pull request that touches this
folder, and builds macOS (dmg + zip, arm64 and x64) and Windows (NSIS, x64)
packages on pushes to `main` or by hand. Packages are unsigned until these
exist in the repository settings:

| What | Secret or variable |
|---|---|
| macOS Developer ID certificate (.p12, base64) and password | `BOM_DESKTOP_CSC_LINK`, `BOM_DESKTOP_CSC_KEY_PASSWORD` |
| macOS notarization (App Store Connect API key) | `BOM_DESKTOP_APPLE_API_KEY` (.p8 contents), `BOM_DESKTOP_APPLE_API_KEY_ID`, `BOM_DESKTOP_APPLE_API_ISSUER` |
| Windows signing (Azure Trusted Signing) | `BOM_DESKTOP_AZURE_TENANT_ID`, `_CLIENT_ID`, `_CLIENT_SECRET` secrets; `BOM_DESKTOP_AZURE_ENDPOINT`, `_ACCOUNT`, `_PROFILE` variables |
| Publishing releases to the public update repository | `BOM_DESKTOP_RELEASES_TOKEN` (fine-grained token, Contents read and write on `O2TechAI/bom-desktop-releases` only) |
| A different update feed (https, generic provider) | `BOM_DESKTOP_UPDATE_URL` variable |

### Releasing a version

1. Raise `version` in `package.json` (and `package-lock.json`) and merge to `main`.
2. Run the `Desktop` workflow by hand on `main` with **publish** ticked. It
   builds, then creates `desktop-v<version>` in this repository and
   `v<version>` in the public
   [O2TechAI/bom-desktop-releases](https://github.com/O2TechAI/bom-desktop-releases)
   with the installers, zips, blockmaps and `latest*.yml`.

### Updates

This repository is private, so installed apps read the public
`bom-desktop-releases` repository instead (`src/updater.js`, feed in
`resources/app-update.yml`). They check ten seconds after start, every six
hours, and when the BOM site's **Settings → Version** tab opens (or its
"Check for updates" button is pressed).

- **Windows** (and a signed, notarized Mac build): the update downloads in the
  background and installs when the app quits; a dialog offers to restart now.
- **Unsigned Mac build**: macOS refuses to install unsigned updates, so the app
  offers the new dmg for this Mac's processor and the person replaces the app.

**Settings → Version** shows only inside the app. It reads the version and
the update status through `window.o2Desktop.updates` (`src/preload.js`;
`desktop:update-*` IPC, answered only for the BOM site's top frame) and shows
checking, up to date, the download with its progress, Restart to update, the
Mac's Download button, or that the check failed. A check started there asks no
dialog, since the page shows it. Apps before 0.0.4 show their version only.

To see every state without publishing, run the unpackaged app with
`BOM_DESKTOP_FAKE_UPDATE=0.0.9` (finds 0.0.9 and downloads it), `none` or
`fail` (`src/dev-updater.js`).

Builds from 0.0.1 have no feed; install 0.0.2 by hand once.

## Tests

- `npm test`: navigation and permission policy, which sites a build opens,
  the loopback sign-in (PKCE, state, single use), window state, menus, copy.
- `npm test` also covers targets, supplier hosts, every supplier profile and
  the panel copy (`test/automation.test.js`).
- `test/e2e/suppliers.e2e.mjs` (part of `npm run test:e2e`, needs only a
  display and Google Chrome or Microsoft Edge): one task on two practice shops
  with different DOM trees, the panel, sign-in hand-off, stop, the supplier
  navigation policy, and every DigiKey operation. The shop's page is the
  person's Chrome, so the tests reach it through the app's `site` hook.
- `npm run test:e2e`: the real app driven by Playwright against a BOM site with
  the desktop endpoints, plus a second browser as the system browser. Needs a
  display (`xvfb-run -a` on Linux) and `BOM_DESKTOP_E2E_ORIGIN`,
  `BOM_DESKTOP_E2E_EMAIL`, `BOM_DESKTOP_E2E_PASSWORD` (a password account).
- Server side: `backend/tests/test_desktop_handoff.py`; the browser page:
  `web/apps/bom/src/features/auth/desktop-login.case.js`.
