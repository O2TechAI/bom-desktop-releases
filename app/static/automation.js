/* The supplier tab's panel: every operation the app can do on this supplier,
 * the steps of the one running, and what it read back (cart lines, orders,
 * tracking numbers). Commands (run, pause, stop, continue, confirm) go
 * through window.o2Automation (src/automation-preload.js). Copy follows the
 * computer's language: English is the source; zh and es say the same. */

import { COPY } from "./automation-copy.mjs";

const LOCALES = { en: "en", zh: "zh-CN", es: "es" };
const TOAST_MS = 4000;
const FIELD_INPUT = {
  part: { autocomplete: "off", spellcheck: "false" },
  quantity: { inputmode: "numeric", autocomplete: "off" },
  order: { inputmode: "numeric", autocomplete: "off" },
};

const params = new URLSearchParams(window.location.search);
const language = Object.hasOwn(COPY, params.get("lang")) ? params.get("lang") : "en";
document.documentElement.lang = LOCALES[language];

function t(key, values = {}) {
  const text = COPY[language][key] ?? COPY.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));
}

for (const element of document.querySelectorAll("[data-copy]")) element.textContent = t(element.dataset.copy);
for (const element of document.querySelectorAll("[data-copy-label]")) element.setAttribute("aria-label", t(element.dataset.copyLabel));

const $ = (selector) => document.querySelector(selector);
const bridge = window.o2Automation;
const ui = {
  supplier: $("#supplier"),
  status: $("[data-status]"),
  unverified: $("[data-unverified]"),
  start: $("[data-start]"),
  ops: $("[data-ops]"),
  form: $("[data-form]"),
  taskTitle: $("[data-task-title]"),
  fields: $("[data-fields]"),
  formError: $("[data-form-error]"),
  submit: $("[data-submit]"),
  handoff: $("[data-handoff]"),
  handoffTitle: $("[data-handoff-title]"),
  handoffBody: $("[data-handoff-body]"),
  confirm: $("[data-confirm]"),
  confirmTitle: $("[data-confirm-title]"),
  confirmBody: $("[data-confirm-body]"),
  run: $("[data-run]"),
  runTitle: $("[data-run-title]"),
  metrics: $("[data-metrics]"),
  steps: $("[data-steps]"),
  controls: $("[data-controls]"),
  after: $("[data-after]"),
  pause: $("[data-command=pause]"),
  resume: $("[data-command=resume]"),
  results: $("[data-results]"),
  toast: $("[data-toast]"),
  toastText: $("[data-toast-text]"),
};

let view = null;
let selected = null;
let lastRequest = null;
let lastToastFor = null;
let shownResultsFor = null;
let toastTimer = null;
/** What the person typed per task, over the defaults, for this window. */
const typed = {};
const ICONS = {
  done: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  failed: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  skipped: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 8h7"/></svg>',
  stopped: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 8h7"/></svg>',
  pending: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.25"/></svg>',
  page: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h5.5L12 5v8.5H4z"/><path d="M9.5 2.5V5H12"/></svg>',
};


function local(value) {
  if (value && typeof value === "object") return value[language] ?? value.en ?? "";
  return value ?? "";
}

function quoted(text) {
  if (!text) return "";
  return language === "zh" ? `「${text}」` : `“${text}”`;
}

/** "$1,234.50" out of "Total: USD $1,234.50", or the text itself. */
function money(text) {
  const match = /(?:[$€£¥]|USD|EUR)\s?[\d,]+(?:\.\d+)?/i.exec(String(text || ""));
  return match ? match[0].replace(/\s+/g, " ") : String(text || "").trim();
}

function orderDigits(text) {
  return /\d{6,}/.exec(String(text || ""))?.[0] || "";
}

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null || value === false) continue;
    if (name === "className") node.className = value;
    else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}


/* ---- the operations ---- */

function taskInfo(id) {
  return view?.tasks.find((task) => task.id === id) || null;
}

function valuesFor(id) {
  const task = taskInfo(id);
  const values = { ...(task?.defaults || {}) };
  // A part just added is the one to remove; an order just listed is the one to track.
  if (id === "removeFromCart" && typed.addToCart?.part) values.part = typed.addToCart.part;
  if (id === "track" && !typed.track?.order && view?.lastOrders?.[0]) values.order = view.lastOrders[0];
  return { ...values, ...(typed[id] || {}) };
}

function renderOps() {
  const ids = view.tasks.map((task) => task.id);
  if (!ids.includes(selected)) selected = ids.includes("addToCart") ? "addToCart" : ids[0];
  if (ui.ops.dataset.ids !== ids.join(",")) {
    ui.ops.dataset.ids = ids.join(",");
    ui.ops.replaceChildren(...ids.map((id) => el("button", {
      type: "button",
      className: "op",
      "data-op": id,
      onclick: () => select(id),
    }, t(`task_${id}`))));
  }
  for (const button of ui.ops.children) {
    const current = button.dataset.op === selected;
    button.setAttribute("aria-current", current ? "true" : "false");
  }
}

function renderForm() {
  const task = taskInfo(selected);
  if (!task) return;
  ui.taskTitle.textContent = t(`task_${selected}`);
  ui.submit.textContent = t(`button_${selected}`);
  ui.formError.hidden = true;
  const values = valuesFor(selected);
  ui.fields.replaceChildren(...task.params.map((name) => {
    const id = `field-${name}`;
    const input = el("input", { id, name, value: values[name] ?? "", ...FIELD_INPUT[name] });
    input.addEventListener("input", () => {
      typed[selected] = { ...(typed[selected] || {}), [name]: input.value };
      fieldError(name, "");
    });
    return el("div", { className: "field" },
      el("label", { for: id }, t(`field_${name}`)),
      input,
      el("p", { className: "field-error", role: "alert", "data-error-for": name, hidden: true }));
  }));
  ui.fields.hidden = task.params.length === 0;
}

function select(id) {
  selected = id;
  renderOps();
  renderForm();
}

function fieldError(name, message) {
  const input = ui.form.elements[name];
  const error = ui.form.querySelector(`[data-error-for="${name}"]`);
  if (!input || !error) return Boolean(message);
  input.setAttribute("aria-invalid", message ? "true" : "false");
  error.hidden = !message;
  error.textContent = message || "";
  return Boolean(message);
}


/* ---- a run ---- */

function stepText(step, supplier) {
  const target = local(step.targetTitle);
  // A page or a transition reads as its name; a page element is quoted.
  const shown = step.do === "state" || step.do === "act" ? target : quoted(target);
  const values = { target: shown, value: step.value ?? "", action: step.do, supplier };
  if (step.title) return local(step.title);
  if (step.do === "handoff" || step.do === "confirm") return t(`step_${step.do}_${step.message || "sign_in"}`);
  const key = `step_${step.do}`;
  return Object.hasOwn(COPY.en, key) ? t(key, values) : t("step_other", values);
}

function errorText(step, supplier) {
  const values = { target: quoted(local(step.targetTitle)), supplier };
  const key = `error_${step.error?.code}`;
  return Object.hasOwn(COPY.en, key) ? t(key, values) : t("error_default", values);
}

function renderSteps(run) {
  const supplier = view.supplier.name;
  if (ui.steps.dataset.run !== run.id) {
    ui.steps.replaceChildren();
    ui.steps.dataset.run = run.id;
  }
  // Rows are keyed: a walk adds the pages it reaches and the clicks between them as it goes.
  const rows = new Map([...ui.steps.children].map((row) => [row.dataset.key, row]));
  run.steps.forEach((step, index) => {
    let row = rows.get(String(step.key));
    if (!row) {
      row = el("li", { className: "step", "data-key": step.key }, el("span", { className: "step-mark" }), el("span", { className: "step-text" }));
      row.style.setProperty("--i", String(Math.min(index, 8)));
    }
    if (ui.steps.children[index] !== row) ui.steps.insertBefore(row, ui.steps.children[index] || null);
    row.dataset.depth = String(step.depth || 0);
    row.dataset.kind = step.do;
    const active = step.status === "running" || step.status === "waiting";
    if (row.dataset.status !== step.status) {
      row.dataset.status = step.status;
      row.querySelector(".step-mark").innerHTML = active ? '<span class="step-dot"></span>'
        : step.do === "state" ? ICONS.page : ICONS[step.status] || ICONS.pending;
      if (active) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    const text = step.status === "skipped" ? `${stepText(step, supplier)} · ${t("skipped")}` : stepText(step, supplier);
    row.querySelector(".step-text").textContent = text;
    row.setAttribute("aria-current", active ? "step" : "false");
    let error = row.querySelector(".step-error");
    if (step.status === "failed") {
      if (!error) {
        error = el("p", { className: "step-error", role: "alert" });
        row.appendChild(error);
      }
      error.textContent = errorText(step, supplier);
    } else if (error) {
      error.remove();
    }
  });
  while (ui.steps.children.length > run.steps.length) ui.steps.lastChild.remove();
}


/* ---- what a run read back ---- */

function table(columns, rows) {
  return el("div", { className: "table-wrap" }, el("table", { className: "table" },
    el("thead", {}, el("tr", {}, columns.map((column) => el("th", { scope: "col", className: column.num ? "num" : null }, t(column.title))))),
    el("tbody", {}, rows.map((row) => el("tr", {}, columns.map((column) => {
      const value = column.value(row);
      return el("td", { className: column.num ? "num" : null, title: typeof value === "string" ? value : null }, value ?? "");
    }))))));
}

function fact(label, value) {
  return el("div", { className: "fact" }, el("span", { className: "fact-label" }, label), el("span", { className: "fact-value" }, value));
}

function resultsFor(run) {
  const results = run.results || {};
  switch (run.task) {
    case "openCart": {
      const lines = (results.cart || []).filter((line) => line.part);
      if (!lines.length) return run.status === "done" ? [el("p", { className: "body" }, t("cart_empty"))] : [];
      return [table([
        { title: "col_part", value: (line) => line.part },
        { title: "col_quantity", num: true, value: (line) => line.quantity },
        { title: "col_unit", num: true, value: (line) => money(line.unitPrice) },
        { title: "col_extended", num: true, value: (line) => money(line.extended) },
      ], lines)];
    }
    case "orders": {
      const orders = (results.orders || []).filter((order) => orderDigits(order.number));
      if (!orders.length) return run.status === "done" ? [el("p", { className: "body" }, t("orders_empty"))] : [];
      return [table([
        { title: "col_order", value: (order) => orderDigits(order.number) },
        { title: "col_date", value: (order) => order.date },
        { title: "col_status", value: (order) => order.status },
        { title: "col_total", num: true, value: (order) => money(order.total) },
        {
          title: "track_action",
          value: (order) => el("button", {
            type: "button",
            className: "button button-quiet button-row",
            onclick: () => {
              typed.track = { order: orderDigits(order.number) };
              select("track");
              ui.form.querySelector("input")?.focus();
            },
          }, t("track_action")),
        },
      ], orders)];
    }
    case "track": {
      const nodes = [];
      if (results.status) nodes.push(fact(t("order_status"), results.status));
      const shipments = (results.shipments || []).filter((shipment) => shipment.number);
      if (shipments.length) {
        nodes.push(table([{ title: "col_tracking", value: (shipment) => shipment.number }], shipments));
      } else if (run.status === "done") {
        nodes.push(el("p", { className: "body" }, t("shipments_empty")));
      }
      return nodes;
    }
    case "checkout":
      return results.total || run.status === "done"
        ? [results.total ? fact(t("order_total"), money(results.total)) : null, run.status === "done" ? el("p", { className: "body" }, t("review_ready")) : null]
        : [];
    case "placeOrder":
      return [
        results.orderNumber ? fact(t("order_number"), orderDigits(results.orderNumber) || results.orderNumber) : null,
        results.total ? fact(t("order_total"), money(results.total)) : null,
      ];
    case "pageMap":
      if (!results.savedTo) return [];
      return [
        el("p", { className: "body" }, t("saved_to", { file: results.savedTo })),
        el("div", { className: "actions" }, el("button", {
          type: "button",
          className: "button button-secondary",
          onclick: () => void bridge.command("reveal"),
        }, t("show_file"))),
      ];
    default:
      return [];
  }
}

function renderResults(run) {
  const key = `${run.id}:${run.status}`;
  if (shownResultsFor === key) return;
  shownResultsFor = key;
  const nodes = resultsFor(run).filter(Boolean);
  ui.results.replaceChildren(...nodes);
  ui.results.hidden = nodes.length === 0;
}


/* ---- the whole panel ---- */

function showToast(text) {
  ui.toastText.textContent = text;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, TOAST_MS);
}

function render(next) {
  const first = !view;
  view = next;
  const supplier = view.supplier.name;
  ui.supplier.textContent = supplier;
  document.title = `${supplier} · O2 BOM`;
  ui.unverified.hidden = view.supplier.verified;
  ui.unverified.textContent = t("unverified", { supplier });
  renderOps();
  if (first || !ui.fields.dataset.ready) {
    ui.fields.dataset.ready = "1";
    renderForm();
  }

  const run = view.run;
  const active = Boolean(run && ["ready", "running", "paused", "waiting"].includes(run.status));
  ui.start.hidden = active;
  ui.run.hidden = !run;
  ui.status.hidden = !run;
  if (!run) {
    ui.results.hidden = true;
    ui.metrics.hidden = true;
    return;
  }

  ui.status.dataset.tone = run.status;
  const statusText = t(`status_${run.status === "ready" ? "running" : run.status}`);
  if (ui.status.textContent !== statusText) {
    ui.status.textContent = statusText;
    ui.status.style.animation = "none";
    void ui.status.offsetWidth;
    ui.status.style.animation = "";
  }
  ui.runTitle.textContent = t(`run_${run.task}`, run.params || {});
  // How often the shop stopped this run for a security check: the number the
  // session changes are meant to bring down.
  const checks = run.metrics?.checks;
  ui.metrics.hidden = checks == null;
  if (checks != null) ui.metrics.textContent = t("metrics_checks", { count: checks });
  renderSteps(run);

  const confirming = run.status === "waiting" && run.confirming;
  const handingOff = run.status === "waiting" && !run.confirming;
  ui.handoff.hidden = !handingOff;
  if (handingOff) {
    ui.handoffTitle.textContent = t(`handoff_${run.message || "sign_in"}_title`, { supplier });
    ui.handoffBody.textContent = t(`handoff_${run.message || "sign_in"}_body`, { supplier });
  }
  ui.confirm.hidden = !confirming;
  if (confirming) {
    const message = run.confirming.message;
    const total = run.confirming.value ? money(run.confirming.value) : "";
    ui.confirmTitle.textContent = t(`confirm_${message}_title`, { supplier });
    ui.confirmBody.textContent = total
      ? t(`confirm_${message}_body`, { supplier, total })
      : t(`confirm_${message}_body_plain`, { supplier });
  }
  ui.controls.hidden = !active || confirming;
  ui.pause.hidden = run.status !== "running" && run.status !== "ready";
  ui.resume.hidden = run.status !== "paused";
  ui.after.hidden = active || run.status === "done";
  renderResults(run);

  const runKey = `${run.id}:${run.status}`;
  if (run.status === "done" && lastToastFor !== runKey) {
    lastToastFor = runKey;
    showToast(t(`toast_${run.task}`));
  }
}


async function start(task, values = {}) {
  lastRequest = { task, params: values };
  ui.formError.hidden = true;
  const result = await bridge.command("run", { task, params: values });
  if (!result.ok && result.message) {
    ui.formError.textContent = result.message;
    ui.formError.hidden = false;
  }
}

ui.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const task = taskInfo(selected);
  if (!task) return;
  const values = {};
  let first = null;
  for (const name of task.params) {
    let value = ui.form.elements[name].value.trim();
    if (name === "quantity") value = value.replace(/,/g, "");
    let message = value ? "" : t("required");
    if (!message && name === "quantity" && !/^[1-9]\d{0,8}$/.test(value)) message = t("whole_number");
    if (!message && name === "order" && !/^\d{4,20}$/.test(value)) message = t("order_digits");
    if (fieldError(name, message) && !first) first = name;
    values[name] = value;
  }
  if (first) {
    ui.form.elements[first].focus();
    return;
  }
  typed[selected] = { ...values };
  void start(selected, values);
});

for (const button of document.querySelectorAll("[data-command]")) {
  button.addEventListener("click", () => void bridge.command(button.dataset.command));
}

$("[data-action=again]").addEventListener("click", () => {
  if (lastRequest) void start(lastRequest.task, lastRequest.params);
});

bridge.onView(render);
bridge.command("view").then((result) => { if (result.ok) render(result.view); });
