"use strict";

/* Runs a task: a list of steps against one supplier's site.
 *
 * A step names an action and a target; the site's profile says how to find
 * that target on its DOM (sites/). The same task runs on DigiKey and Mouser.
 *
 *   { do: "fill", target: "search.input", value: "{{part}}" }
 *   { do: "click", target: "cookies.accept", optional: true }
 *   { do: "click", target: "results.exact", when: "results.exact" }
 *   { do: "handoff", message: "sign_in", until: "account.signedIn" }
 *   { do: "handoff", message: "bulk_error", untilGone: "cart.bulkError" }
 *   { do: "peek", target: "cart.count", as: "cartBefore" }
 *   { do: "waitForChange", target: "cart.count", from: "cartBefore", or: "cart.added" }
 *   { do: "confirm", message: "place_order", show: "total" }
 *   { do: "warmup" }              - the shop's home page, once, before the cart
 *
 * A run keeps three counts (snapshot.metrics): `checks`, how often the shop
 * handed the person a security check; `handoffs`, how often it stopped for
 * the person at all; `warmups`, how often the session was warmed up first.
 * They are what tells whether a change made the shop trust the run more.
 *
 * `confirm` is for a step that spends money or can't be undone: the task
 * waits until the person approves it in the panel (Continue does not), and
 * Stop ends it. Nothing in a task can approve on the person's behalf.
 *
 * Options on any step: `optional` (a missing target skips the step),
 * `navigates` (a click that opens another page: wait for it to load),
 * `when` / `unless` (run only if a target is / isn't on the page now),
 * `timeout` (ms), `as` (keep what the step returns under this name).
 *
 * The runner reports every change through `onChange(snapshot)` so the panel
 * can show each step as it starts, ends, waits or fails. Between steps it
 * honours pause; stop cancels the step in progress. */

const { randomUUID } = require("node:crypto");

const { AutomationError, Driver } = require("./driver");
const { UNKNOWN, matchTargets, nextTransition, recognise } = require("./machine");
const { fill } = require("./targets");

const ACTIONS = new Set([
  "goto", "waitForLoad", "waitForUrl", "waitFor", "waitForHidden", "click", "hover", "fill", "type", "press",
  "select", "check", "uncheck", "upload", "read", "peek", "waitForChange", "extract", "handoff", "confirm", "wait",
  "outline", "screenshot", "warmup", "walk", "act",
]);

/* A short pause between steps, so a person can follow along. */
const STEP_GAP = 250;
/* How often a hand-off checks whether the person is done. */
const HANDOFF_POLL = 1000;
/* How long a page may take to become a state the machine knows. A shop
 * behind Cloudflare holds its own address on a "wait" page for a few
 * seconds before the real page renders; the walk should wait that out
 * instead of handing the person a page it simply doesn't know yet. */
const RECOGNISE_TIMEOUT = 20000;
/* A walk that lands on the same page this often hands over instead. */
const MAX_VISITS = 3;
/* Transitions a walk may take before it gives up. */
const MAX_MOVES = 25;
/* A shop's home page, looked at before the cart or the orders: a browser
 * that goes straight to /OrderHistory/List on a fresh profile meets the
 * shop's security check more often. */
const WARMUP_MS = 1200;
const WARMUP_JITTER = 800;
/* Least time between two addresses in one run, and after a check. */
const NAVIGATION_GAP = 900;
const CHECK_SETTLE_MS = 2500;


function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}


class Runner {
  /**
   * @param {object} options
   * @param {Electron.WebContents} options.contents the supplier page
   * @param {object} options.profile a site profile (sites/index.js)
   * @param {string} options.task a task name in the profile
   * @param {object} [options.params] values for {{...}} in the task
   * @param {(snapshot: object) => void} [options.onChange]
   * @param {string} [options.themeCss]
   * @param {number} [options.warmupMs] how long to look at the shop's home page
   * @param {number} [options.navigationGapMs] least time between two addresses
   * @param {number} [options.checkSettleMs] pause after the person's check
   * @param {object} [options.session] state shared by the runs of one larger
   *   job ({ warmedUp }): several tasks in a row warm the shop up once
   * @param {object} [options.driverOptions]
   */
  constructor({
    contents, profile, task, params = {}, onChange = () => {}, themeCss = "", driverOptions = {},
    warmupMs = WARMUP_MS, navigationGapMs = NAVIGATION_GAP, checkSettleMs = CHECK_SETTLE_MS,
    session = { warmedUp: false },
  }) {
    const steps = profile.tasks[task];
    if (!steps) throw new Error(`${profile.name} has no task "${task}"`);
    for (const step of steps) {
      if (!ACTIONS.has(step.do)) throw new Error(`Unknown action "${step.do}"`);
      if (step.do === "waitForUrl" && step.pattern == null) throw new Error(`${profile.name}: waitForUrl needs a pattern`);
      for (const name of [step.target, step.when, step.unless, step.until, step.untilGone, step.or].filter(Boolean)) {
        if (!profile.targets[name]) throw new Error(`${profile.name} has no target "${name}"`);
      }
      if (step.do === "walk") {
        if (!profile.machine) throw new Error(`${profile.name} has no state machine`);
        for (const goal of [].concat(step.to)) if (!profile.machine.states[goal]) throw new Error(`${profile.name} has no state "${goal}"`);
      }
      if (step.do === "act") {
        for (const name of [].concat(step.name)) {
          if (!profile.machine?.byName.get(name)) throw new Error(`${profile.name} has no transition "${name}"`);
        }
      }
    }
    this.id = randomUUID();
    this.profile = profile;
    this.task = task;
    this.values = { ...params };
    // The site's addresses may use the task's values ("search?q={{part|url}}").
    const urls = Object.fromEntries(Object.entries(profile.urls).map(([name, url]) => {
      try {
        return [name, fill(url, params)];
      } catch {
        return [name, null];
      }
    }));
    this.params = { ...params, ...urls };
    this.onChange = onChange;
    this.controller = new AbortController();
    this.driver = new Driver(contents, {
      themeCss,
      mayGo: profile.mayGo,
      signal: this.controller.signal,
      ...driverOptions,
    });
    this.nextKey = 0;
    this.steps = steps.map((step) => this.viewOf(step));
    this.state = null;
    this.definitions = steps;
    this.status = "ready";
    this.results = {};
    this.message = null;
    this.confirming = null;
    this.approved = false;
    this.paused = false;
    this.wake = null;
    /* What the run cost the person: how often the shop asked for a check,
     * how often it stopped for them at all, and how often the session was
     * warmed up first. Kept per run and logged when it ends. */
    this.metrics = { checks: 0, handoffs: 0, warmups: 0 };
    this.session = session;
    this.lastNavigationAt = 0;
    this.warmupMs = warmupMs;
    this.navigationGapMs = navigationGapMs;
    this.checkSettleMs = checkSettleMs;
  }

  /** What the panel shows for a step. Walks add rows as they go: the page
   * reached (a state) and the transition's own steps under it. */
  viewOf(step, extra = {}) {
    const machine = this.profile.machine;
    let target = step.target || null;
    let targetTitle = step.target ? this.profile.targets[step.target].title || null : null;
    if (step.do === "walk") targetTitle = machine.states[[].concat(step.to)[0]].title;
    if (step.do === "act") targetTitle = machine.byName.get([].concat(step.name)[0]).title;
    if (step.do === "state") targetTitle = step.state === UNKNOWN ? null : machine.states[step.state].title;
    return {
      key: this.nextKey++,
      do: step.do,
      target,
      targetTitle,
      title: step.title || null,
      value: this.shownValue(step),
      message: step.do === "handoff" || step.do === "confirm" ? step.message || "sign_in" : null,
      state: step.state || null,
      depth: 0,
      status: "pending",
      error: null,
      ...extra,
    };
  }

  /** Put a row under `parent`, after the rows already there. */
  addRow(parent, step, extra = {}) {
    const view = this.viewOf(step, { depth: 1, ...extra });
    let at = this.steps.indexOf(parent) + 1;
    while (at < this.steps.length && this.steps[at].depth > parent.depth) at += 1;
    this.steps.splice(at, 0, view);
    return view;
  }

  shownValue(step) {
    try {
      if (step.do === "fill" || step.do === "type") return fill(step.value ?? "", this.params);
      if (step.do === "select") return fill(String(step.option), this.params);
      if (step.do === "press") return step.key;
      if (step.do === "goto") return new URL(fill(step.url, this.params)).hostname;
    } catch {
      return null;
    }
    return null;
  }

  snapshot() {
    return clone({
      id: this.id,
      supplier: { id: this.profile.id, name: this.profile.name },
      task: this.task,
      params: this.values,
      status: this.status,
      message: this.message,
      confirming: this.confirming,
      state: this.state,
      steps: this.steps,
      results: this.results,
      metrics: { ...this.metrics },
    });
  }

  emit() {
    try {
      this.onChange(this.snapshot());
    } catch (error) {
      console.error(`Automation panel update failed: ${error.message}`);
    }
  }

  target(name) {
    return this.profile.targets[name];
  }

  pause() {
    if (this.status !== "running") return;
    this.paused = true;
    this.status = "paused";
    this.emit();
  }

  resume() {
    if (this.status === "paused") {
      this.paused = false;
      this.status = "running";
      this.emit();
    }
    // Also the "Continue" of a hand-off.
    this.wake?.();
  }

  stop() {
    this.controller.abort();
    this.wake?.();
  }

  /** The person's yes to the `confirm` step waiting now, and only to it. */
  approve() {
    if (!this.confirming) return false;
    this.approved = true;
    this.wake?.();
    return true;
  }

  async waitWhilePaused() {
    while (this.paused && !this.controller.signal.aborted) {
      await new Promise((resolve) => { this.wake = resolve; });
      this.wake = null;
    }
    if (this.controller.signal.aborted) throw new AutomationError("stopped", "Stopped");
  }

  /** Run every step. Resolves with the final snapshot; never rejects. */
  async run() {
    this.status = "running";
    this.lastNavigationAt = Date.now();
    this.emit();
    try {
      await this.driver.attach();
      const views = [...this.steps];
      for (const [index, step] of this.definitions.entries()) {
        await this.waitWhilePaused();
        await this.runStep(step, views[index]);
        await new Promise((resolve) => setTimeout(resolve, STEP_GAP));
      }
      this.status = "done";
    } catch (error) {
      const stoppedNow = error instanceof AutomationError && error.code === "stopped";
      this.status = stoppedNow ? "stopped" : "failed";
      const current = this.steps.find((step) => step.status === "running" || step.status === "waiting");
      if (current) {
        current.status = stoppedNow ? "stopped" : "failed";
        current.error = stoppedNow ? null : {
          code: error.code || "error",
          message: error.message,
          detail: error.detail || null,
        };
      }
      if (!stoppedNow) {
        console.error(`Automation step failed: ${error.stack || error.message}`);
        await this.logPage(`failed ${this.task}`);
      }
    } finally {
      this.message = null;
      this.confirming = null;
      await this.driver.clearMarks({ all: true });
      this.driver.detach();
      this.emit();
    }
    return this.snapshot();
  }

  async runStep(step, view) {
    const options = { timeout: step.timeout, params: this.params };
    if (step.when && !(await this.driver.exists(this.target(step.when), { params: this.params, timeout: step.whenTimeout ?? 0 }))) {
      view.status = "skipped";
      this.emit();
      return;
    }
    if (step.unless && (await this.driver.exists(this.target(step.unless), { params: this.params, timeout: step.whenTimeout ?? 0 }))) {
      view.status = "skipped";
      this.emit();
      return;
    }
    view.status = "running";
    this.emit();
    try {
      const result = await this.perform(step, view, options);
      if (step.as) this.results[step.as] = result ?? null;
      view.status = "done";
    } catch (error) {
      // An optional step is skipped when its target isn't there or can't be reached.
      // A wait for a change that did not come is skipped too (2026-11-24:
      // Mouser goes to the cart instead of changing its count).
      const missing = error instanceof AutomationError && ["not_found", "not_visible", "covered", "unchanged"].includes(error.code);
      if (!(step.optional && missing)) throw error;
      view.status = "skipped";
    }
    this.emit();
  }

  async perform(step, view, options) {
    const driver = this.driver;
    const target = step.target ? this.target(step.target) : null;
    switch (step.do) {
      case "goto": return this.go(fill(step.url, this.params));
      case "warmup": return this.warmUp();
      case "waitForLoad": return driver.waitForLoad(options);
      case "waitForUrl": return driver.waitForUrl(step.pattern instanceof RegExp ? step.pattern : fill(step.pattern, this.params), options);
      case "waitFor": return driver.waitFor(target, options).then(() => true);
      case "waitForHidden": return driver.waitFor(target, { ...options, state: "hidden" }).then(() => true);
      case "click": {
        const before = driver.contents.getURL();
        if (step.js) await driver.clickJs(target, options);
        else await driver.click(target, options);
        if (step.navigates) await driver.settle(before);
        return true;
      }
      case "hover": return driver.hover(target, options).then(() => true);
      case "fill": {
        const value = fill(step.value ?? "", this.params);
        return step.js ? driver.fillJs(target, value, options) : driver.fill(target, value, options);
      }
      case "type": return driver.type(fill(step.value ?? "", this.params));
      case "press": return driver.press(step.key);
      case "select": return driver.select(target, step.option instanceof RegExp ? step.option : fill(step.option, this.params), options);
      case "check": return driver.check(target, true, options);
      case "uncheck": return driver.check(target, false, options);
      case "upload": return driver.upload(target, [].concat(step.files ?? this.params[step.filesParam]), options).then(() => true);
      case "read": return driver.read(target, { ...options, what: step.read || "text" });
      case "peek": return driver.peek(target, { params: this.params, what: step.read || "text" });
      case "waitForChange": return driver.waitForChange(target, this.results[step.from] ?? "", {
        ...options,
        or: step.or ? this.target(step.or) : null,
      });
      case "extract": {
        const fields = Object.fromEntries(Object.entries(step.fields).map(([name, field]) => [
          name,
          { target: this.target(field.target), read: field.read || "text" },
        ]));
        return driver.extract(target, fields, options);
      }
      case "handoff": return this.handoff(step, view);
      case "confirm": return this.confirm(step, view);
      case "walk": return this.walk(step, view);
      case "act": return this.act(step, view);
      case "wait": return new Promise((resolve) => setTimeout(resolve, Math.min(Number(step.ms) || 0, 10000)));
      case "outline": return driver.outline(step.limit);
      case "screenshot": return (await driver.screenshot()).toString("base64");
      default: throw new AutomationError("bad_step", `Unknown action ${step.do}`);
    }
  }

  /* How the shop is approached: its home page once, a gap between addresses,
   * and a moment to settle after a check. All three keep a run from looking
   * like a script that jumps from page to page as fast as it can. */

  /** Open an address, leaving the shop a breath between pages. */
  async go(url) {
    await this.navigationGap();
    await this.driver.goto(url);
    this.lastNavigationAt = Date.now();
  }

  async navigationGap() {
    const left = this.lastNavigationAt + this.navigationGapMs - Date.now();
    if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
  }

  /** Visit the shop's home page once before going deeper into it: the cart
   * and the order history are where a cold session is asked to prove it is a
   * person. Once per run (or per job, when the runs share a session); doing
   * it again would only add loading. */
  async warmUp() {
    if (this.session.warmedUp) return false;
    this.session.warmedUp = true;
    const home = this.profile.urls.home;
    if (!home) return false;
    this.metrics.warmups += 1;
    await this.go(fill(home, this.params));
    const jitter = this.warmupMs > 0 ? Math.floor(Math.random() * WARMUP_JITTER) : 0;
    if (this.warmupMs + jitter > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.warmupMs + jitter));
    }
    return true;
  }

  /* The person does this part (sign in, solve a check); the task carries on
   * when `until` shows up on the page or they press Continue. With
   * `untilGone`, it carries on once that target is no longer there (a list
   * of items the shop would not take, put right). */
  async handoff(step, view) {
    const until = step.until ? this.target(step.until) : null;
    const gone = step.untilGone ? this.target(step.untilGone) : null;
    if (until && (await this.driver.exists(until, { params: this.params }))) return true;
    if (gone && !(await this.driver.exists(gone, { params: this.params }))) return true;
    const isDone = until
      ? () => this.driver.exists(until, { params: this.params })
      : gone
        ? async () => !(await this.driver.exists(gone, { params: this.params }))
        : null;
    await this.waitForPerson(step.message, view, isDone, step.timeout);
    return true;
  }

  /** Wait until `isDone()` says so or the person presses Continue. */
  async waitForPerson(message, view, isDone, timeout = 15 * 60 * 1000) {
    // A sign-in: the login kept from the person's last one goes in first,
    // once per run, and the person is asked only if it did not get through
    // (2026-11-23: sign in once). A check or a code still comes to them.
    // A seller that passes through its sign-in address once more on the way
    // back (Mouser) gets a moment to settle, and a second try.
    if (message === "sign_in" && (this.signInTries || 0) < 2 && this.driver.contents.signInAgain) {
      this.signInTries = (this.signInTries || 0) + 1;
      this.message = "signing-in";
      this.emit();
      const settled = async () => {
        if (!isDone) return true;
        try {
          return await isDone();
        } catch {
          return false;
        }
      };
      let done = false;
      if (this.signedInOnce) {
        for (let i = 0; i < 10 && !done; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          done = await settled();
        }
      }
      if (!done && (await this.driver.contents.signInAgain().catch(() => false))) {
        this.signedInOnce = true;
        done = await settled();
      }
      if (this.controller.signal.aborted) throw new AutomationError("stopped", "Stopped");
      this.message = null;
      if (done) {
        this.metrics.signIns = (this.metrics.signIns || 0) + 1;
        return;
      }
    }
    this.metrics.handoffs += 1;
    if (message === "challenge") this.metrics.checks += 1;
    await this.driver.clearMarks();
    view.status = "waiting";
    this.status = "waiting";
    this.message = message;
    this.emit();
    let continued = false;
    const deadline = Date.now() + timeout;
    while (!continued) {
      if (this.controller.signal.aborted) throw new AutomationError("stopped", "Stopped");
      if (Date.now() > deadline) throw new AutomationError("timeout", "Nobody finished this part in time");
      const woken = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), HANDOFF_POLL);
        this.wake = () => { clearTimeout(timer); resolve(true); };
      });
      this.wake = null;
      if (this.controller.signal.aborted) throw new AutomationError("stopped", "Stopped");
      if (woken) continued = true;
      else if (isDone) {
        try {
          continued = await isDone();
        } catch (error) {
          if (error?.code === "stopped") throw error;
          continued = false; // mid-navigation; look again
        }
      }
    }
    this.status = "running";
    this.message = null;
    view.status = "running";
    this.emit();
  }

  /* ---- the state machine (machine.js) ---- */

  /** The state the page is in. With `not`, wait for a state other than that
   * one (the page a transition is leaving). UNKNOWN when nothing matches by
   * the deadline. */
  async identify({ timeout = RECOGNISE_TIMEOUT, not = null } = {}) {
    const machine = this.profile.machine;
    if (!this.matchNamed) {
      this.matchNamed = Object.fromEntries(matchTargets(machine).map((name) => [name, this.target(name)]));
    }
    const deadline = Date.now() + timeout;
    let state = UNKNOWN;
    for (;;) {
      this.driver.checkStopped();
      try {
        if (!this.driver.contents.isLoading()) {
          // A shop's own refusal (DataDome and friends) is not a page to wait
          // on: no field, no button, no way for the person to get past it.
          if (this.profile.targets.blocked) {
            const refusal = await this.driver.present({ blocked: this.profile.targets.blocked }, { params: this.params });
            if (refusal.blocked) {
              throw new AutomationError("blocked", "The supplier refused this browser (Access Denied).");
            }
          }
          const present = await this.driver.present(this.matchNamed, { params: this.params });
          state = recognise(machine, this.driver.contents.getURL(), present);
          if (state !== UNKNOWN && state !== not) return state;
        }
      } catch (error) {
        if (["stopped", "closed", "blocked"].includes(error?.code)) throw error;
        // mid-navigation; look again
      }
      if (Date.now() >= deadline) return state;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /** Note the page reached: a row in the panel, and its `enter` steps. */
  async arrive(state, parent) {
    if (this.state === state && this.stateRowParent === parent) return;
    this.state = state;
    this.stateRowParent = parent;
    this.addRow(parent, { do: "state", state }, { status: "done" });
    this.emit();
    for (const step of this.profile.machine.states[state]?.enter || []) {
      await this.runStep(step, this.addRow(parent, step));
    }
  }

  /** The person gets past this page (signs in, chooses how to pay, or takes
   * over on a page the app doesn't know). Done when the page changes: its
   * address moves on, or the same address becomes a state the app knows. */
  async personAt(state, message, parent) {
    const row = this.addRow(parent, { do: "handoff", message });
    if (this.profile.machine.states[state]?.quiet) {
      await this.quietlyAt(state, message, row);
    } else {
      const urlBefore = this.driver.contents.getURL();
      await this.waitForPerson(message, row, async () => {
        // A page still loading is not a different page: on a slow shop the
        // check would end the moment it began, and the walk would go round.
        if (this.driver.contents.isLoading()) return false;
        if (this.driver.contents.getURL() !== urlBefore) return true;
        const now = await this.identify({ timeout: 0 });
        return now !== UNKNOWN && now !== state;
      });
    }
    row.status = "done";
    this.emit();
    // A check just solved: the next page is still settling. Going on at once
    // is what gets a session asked again.
    if (message === "challenge" && this.checkSettleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.checkSettleMs));
    }
  }

  /** A quiet state (a security check): while the person is on it, the app
   * lets go of the page entirely and loads it again, so the check runs in an
   * ordinary browser with nothing of the app's attached. Meanwhile it watches
   * only what the window itself knows (an address loaded, the page's title):
   * when another page has loaded under a new title, it looks properly, and
   * lets go again if the check is still there. */
  async quietlyAt(state, message, row) {
    const letGo = async () => {
      await this.driver.clearMarks({ all: true });
      this.driver.release();
      return { mark: this.driver.navigations + 1, title: this.driver.title() };
    };
    let seen = await letGo();
    this.driver.reload();
    try {
      await this.waitForPerson(message, row, async () => {
        if (this.driver.navigations < seen.mark || this.driver.loading()) return false;
        if (this.driver.title() === seen.title) return false;
        await this.driver.attach();
        if ((await this.identify({ timeout: 0 })) !== state) return true;
        seen = await letGo();
        return false;
      });
    } finally {
      await this.driver.attach();
    }
  }

  /** Take one transition: its confirm, then its steps. Returns the state it led to. */
  async take(transition, parent, from) {
    if (transition.confirm) {
      const row = this.addRow(parent, { do: "confirm", message: transition.confirm.message });
      await this.runStep({ do: "confirm", ...transition.confirm }, row);
    }
    for (const step of transition.steps) {
      await this.waitWhilePaused();
      await this.runStep(step, this.addRow(parent, step));
    }
    return this.identify({ not: transition.to.includes(from) ? null : from });
  }

  /** The page's address and visible buttons, for the app's log (2026-11-23). */
  async logPage(label) {
    try {
      const contextId = await this.driver.world();
      const { result } = await this.driver.send("Runtime.evaluate", {
        contextId, returnByValue: true,
        expression: `JSON.stringify({ url: location.href, title: document.title, h1: (document.querySelector("h1")?.innerText || "").slice(0, 80), buttons: [...document.querySelectorAll("button, input[type=submit], a[role=button]")].filter((b) => b.offsetParent !== null).map((b) => [b.id, b.getAttribute("data-testid"), (b.innerText || b.value || "").trim().slice(0, 30)].filter(Boolean).join("|")).filter(Boolean).slice(0, 30) })`,
      });
      console.warn(`[${label} ${this.profile.id}] ${String(result?.value || "").slice(0, 1800)}`);
    } catch { /* only for the log */ }
  }

  /** Go from whatever page this is to a goal state, one transition at a time. */
  async walk(step, view) {
    const machine = this.profile.machine;
    const goals = [].concat(step.to);
    const visits = {};
    let moves = 0;
    let state = await this.identify();
    this.state = null;
    for (;;) {
      await this.waitWhilePaused();
      if (state !== UNKNOWN) await this.arrive(state, view);
      if (goals.includes(state)) return state;
      const info = machine.states[state];
      if (info?.person) {
        await this.personAt(state, info.person, view);
        state = await this.identify();
        continue;
      }
      visits[state] = (visits[state] || 0) + 1;
      // An unknown page, for the app's log: its address and the buttons on it,
      // so a page the site changed can be told apart (2026-11-23: DigiKey's
      // product page after a security check was not recognised).
      if (state === UNKNOWN) {
        try {
          const contextId = await this.driver.world();
          const { result } = await this.driver.send("Runtime.evaluate", {
            contextId, returnByValue: true,
            expression: `JSON.stringify({ url: location.href, h1: (document.querySelector("h1")?.innerText || "").slice(0, 80), buttons: [...document.querySelectorAll("button, input[type=submit], a[role=button]")].filter((b) => b.offsetParent !== null).map((b) => [b.id, b.getAttribute("data-testid"), (b.innerText || b.value || "").trim().slice(0, 30)].filter(Boolean).join("|")).filter(Boolean).slice(0, 25) })`,
          });
          console.warn(`[unknown ${this.profile.id}] ${String(result?.value || "").slice(0, 1500)}`);
        } catch { /* only for the log */ }
      }
      // Lost mid-way, or going round in circles: the person takes over.
      if ((state === UNKNOWN && moves > 0) || visits[state] > MAX_VISITS) {
        await this.personAt(state, info?.stuck || "lost", view);
        visits[state] = 0;
        state = await this.identify();
        continue;
      }
      moves += 1;
      if (moves > MAX_MOVES) throw new AutomationError("no_path", "Too many pages on the way");
      const transition = nextTransition(machine, state, goals);
      if (!transition) throw new AutomationError("no_path", `No way from ${state} to ${goals.join(" or ")}`);
      const before = this.driver.contents.getURL?.() || "";
      const next = await this.take(transition, view, state);
      // One line per move, for the app's log (2026-11-23: a walk that went round unseen).
      console.warn(`[walk ${this.profile.id}] ${state} --${transition.name}--> ${next} | ${String(before).slice(0, 90)} -> ${String(this.driver.contents.getURL?.() || "").slice(0, 90)}`);
      if (next === state && info?.stuck) {
        // The page didn't let the app on (a payment to choose): the person's turn.
        await this.personAt(state, info.stuck, view);
        visits[state] = 0;
        state = await this.identify();
        continue;
      }
      state = next;
    }
  }

  /** Take one named transition from the page the browser is on now. With
   * several names, the one that leaves this page (add to cart from a results
   * row or from a product page). */
  async act(step, view) {
    const state = await this.identify();
    if (state !== UNKNOWN) await this.arrive(state, view);
    const transition = [].concat(step.name).map((name) => this.profile.machine.byName.get(name))
      .find((candidate) => candidate.from === "*" || candidate.from.includes(state));
    if (!transition) throw new AutomationError("wrong_page", `"${step.name}" can't start from ${state}`);
    const next = await this.take(transition, view, state);
    if (!transition.to.includes(next)) throw new AutomationError("unchanged", `"${transition.name}" led to ${next}`);
    this.state = next;
    return true;
  }

  /* Wait for the person to approve what comes next (placing an order). The
   * panel shows `show`, a value an earlier step kept (the order total). */
  async confirm(step, view) {
    await this.driver.clearMarks();
    view.status = "waiting";
    this.status = "waiting";
    this.message = step.message;
    this.approved = false;
    this.confirming = { message: step.message, value: step.show ? this.results[step.show] ?? null : null };
    this.emit();
    const deadline = Date.now() + (step.timeout ?? 15 * 60 * 1000);
    try {
      while (!this.approved) {
        if (this.controller.signal.aborted) throw new AutomationError("stopped", "Stopped");
        if (Date.now() > deadline) throw new AutomationError("timeout", "Nobody approved this in time");
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, HANDOFF_POLL);
          this.wake = () => { clearTimeout(timer); resolve(); };
        });
        this.wake = null;
      }
      if (this.controller.signal.aborted) throw new AutomationError("stopped", "Stopped");
    } finally {
      this.confirming = null;
    }
    this.status = "running";
    this.message = null;
    view.status = "running";
    this.emit();
    return true;
  }
}


module.exports = { ACTIONS, Runner };
