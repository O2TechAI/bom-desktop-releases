/* Buy lab's flow page: a pasted list, its states, the cart, the orders and
 * the tracking. It only asks the app for things through the preload bridge. */

const COPY = {
  en: {
    title: "Buy lab", supplier: "Supplier", paste: "Paste the list",
    placeholder: "One part per line: part number and quantity, e.g.\nGRM155R71C104KA88D 10\nRC0402FR-0710KL 100",
    start: "Start purchase", stop: "Stop",
    hint: "The list runs through the supplier's own pages in the background. You are asked to step in only for a check, a sign-in, or the order confirmation.",
    confirmTitle: "Confirm the order", confirmText: "The cart is on the review page. Place the order?",
    confirm: "Place the order", live: "Open supplier page", external: "Open in browser",
    lines: "Lines", part: "Part", qty: "Qty", state: "State", note: "Note",
    cart: "Cart", orders: "Orders", tracking: "Tracking",
    ready: "Ready", working: "Working", waiting: "Waiting for you", done: "Done", failed: "Failed", stopped: "Stopped", blocked: "Blocked",
    waitingPerson: "Sign in, or finish the security check, in the supplier page.",
    pending: "Pending", adding: "Adding", added: "Added",
    messages: {
      adding: "Adding the next line", "reading-cart": "Reading the cart", "placing-order": "Going to the review page",
      "reading-orders": "Reading the orders", tracking: "Reading the shipments", approved: "Approved",
      "waiting-confirm": "Waiting for your yes", "waiting-person": "Waiting for you in the supplier page",
      "reloading-blocked": "Reloading the page once",
      blocked: "The supplier refused this browser (Access Denied); try again later or use its API.",
    },
    empty: "Nothing yet", orderNumber: "Order", none: "—",
  },
  zh: {
    title: "采购实验室", supplier: "供应商", paste: "粘贴清单",
    placeholder: "每行一个料号：型号 + 数量，例如\nGRM155R71C104KA88D 10\nRC0402FR-0710KL 100",
    start: "开始采购", stop: "停止",
    hint: "清单会在后台走供应商自己的页面。只有遇到安全验证、登录，或需要你确认下单时，才会请你出手。",
    confirmTitle: "确认下单", confirmText: "购物车已到确认页，现在下单吗？",
    confirm: "确认下单", live: "打开原始页面", external: "在浏览器中打开",
    lines: "明细", part: "型号", qty: "数量", state: "状态", note: "说明",
    cart: "购物车", orders: "订单", tracking: "物流",
    ready: "准备就绪", working: "进行中", waiting: "等待你操作", done: "完成", failed: "失败", stopped: "已停止", blocked: "被拒绝",
    waitingPerson: "请在供应商页面里完成登录或安全验证。",
    pending: "待处理", adding: "加入中", added: "已加入",
    messages: {
      adding: "正在加入下一行", "reading-cart": "正在读取购物车", "placing-order": "正在进入确认页",
      "reading-orders": "正在读取订单", tracking: "正在读取物流", approved: "已确认",
      "waiting-confirm": "等待你确认下单", "waiting-person": "等待你在供应商页面操作",
      "reloading-blocked": "正在刷新页面一次",
      blocked: "站点拒绝访问（Access Denied），请稍后再试或改用其 API",
    },
    empty: "还没有内容", orderNumber: "订单", none: "—",
  },
  es: {
    title: "Laboratorio de compras", supplier: "Proveedor", paste: "Pega la lista",
    placeholder: "Una pieza por línea: número de pieza y cantidad, p. ej.\nGRM155R71C104KA88D 10\nRC0402FR-0710KL 100",
    start: "Iniciar compra", stop: "Detener",
    hint: "La lista recorre las páginas del proveedor en segundo plano. Solo se te pide intervenir por una comprobación, un inicio de sesión o la confirmación del pedido.",
    confirmTitle: "Confirmar el pedido", confirmText: "El carrito está en la página de revisión. ¿Realizar el pedido?",
    confirm: "Realizar el pedido", live: "Abrir la página del proveedor", external: "Abrir en el navegador",
    lines: "Líneas", part: "Pieza", qty: "Cant.", state: "Estado", note: "Nota",
    cart: "Carrito", orders: "Pedidos", tracking: "Seguimiento",
    ready: "Listo", working: "En curso", waiting: "Esperándote", done: "Hecho", failed: "Falló", stopped: "Detenido", blocked: "Bloqueado",
    waitingPerson: "Inicia sesión o completa la comprobación en la página del proveedor.",
    pending: "Pendiente", adding: "Añadiendo", added: "Añadida",
    messages: {
      adding: "Añadiendo la siguiente línea", "reading-cart": "Leyendo el carrito", "placing-order": "Yendo a la revisión",
      "reading-orders": "Leyendo los pedidos", tracking: "Leyendo los envíos", approved: "Aprobado",
      "waiting-confirm": "Esperando tu confirmación", "waiting-person": "Esperándote en la página del proveedor",
      "reloading-blocked": "Recargando la página una vez",
      blocked: "El proveedor rechazó este navegador (Access Denied); inténtalo más tarde o usa su API.",
    },
    empty: "Nada todavía", orderNumber: "Pedido", none: "—",
  },
};

const language = new URLSearchParams(window.location.search).get("lang") || "en";
const copy = COPY[language] || COPY.en;
document.documentElement.lang = language;

const $ = (selector) => document.querySelector(selector);
const elements = {
  title: $("[data-title]"),
  supplierLabel: $("[data-supplier-label]"),
  supplier: $("[data-supplier]"),
  status: $("[data-status]"),
  external: $("[data-external]"),
  externalLabel: $("[data-external-label]"),
  live: $("[data-show-live]"),
  liveLabel: $("[data-live-label]"),
  pasteLabel: $("[data-paste-label]"),
  list: $("[data-list]"),
  start: $("[data-start]"),
  stop: $("[data-stop]"),
  hint: $("[data-hint]"),
  confirmCard: $("[data-confirm-card]"),
  confirmTitle: $("[data-confirm-title]"),
  confirmText: $("[data-confirm-text]"),
  confirm: $("[data-confirm]"),
  linesTitle: $("[data-lines-title]"),
  part: $("[data-col-part]"),
  qty: $("[data-col-qty]"),
  state: $("[data-col-state]"),
  note: $("[data-col-note]"),
  lines: $("[data-lines]"),
  cartTitle: $("[data-cart-title]"),
  cart: $("[data-cart]"),
  ordersTitle: $("[data-orders-title]"),
  orders: $("[data-orders]"),
  trackingTitle: $("[data-tracking-title]"),
  tracking: $("[data-tracking]"),
};

elements.title.textContent = copy.title;
elements.supplierLabel.textContent = copy.supplier;
elements.externalLabel.textContent = copy.external;
elements.liveLabel.textContent = copy.live;
elements.pasteLabel.textContent = copy.paste;
elements.list.placeholder = copy.placeholder;
elements.start.textContent = copy.start;
elements.stop.textContent = copy.stop;
elements.hint.textContent = copy.hint;
elements.confirmTitle.textContent = copy.confirmTitle;
elements.confirmText.textContent = copy.confirmText;
elements.confirm.textContent = copy.confirm;
elements.linesTitle.textContent = copy.lines;
elements.part.textContent = copy.part;
elements.qty.textContent = copy.qty;
elements.state.textContent = copy.state;
elements.note.textContent = copy.note;
elements.cartTitle.textContent = copy.cart;
elements.ordersTitle.textContent = copy.orders;
elements.trackingTitle.textContent = copy.tracking;

let current = null;

function statusText(state) {
  switch (state.status) {
    case "running": return copy.messages[state.message] || copy.working;
    case "waiting": return state.confirm ? copy.waiting : (copy.messages[state.message] || copy.waitingPerson);
    case "done": return copy.done;
    case "failed": return copy.messages[state.message] || state.message || copy.failed;
    case "stopped": return copy.stopped;
    default: return copy.ready;
  }
}

function tone(state) {
  if (state.status === "failed") return "failed";
  if (state.status === "waiting") return "waiting";
  if (state.status === "running") return "active";
  return "";
}

function row(left, right) {
  const line = document.createElement("div");
  line.className = "list-row";
  const a = document.createElement("span");
  a.textContent = left;
  const b = document.createElement("span");
  b.textContent = right == null ? copy.none : String(right);
  line.append(a, b);
  return line;
}

function empty(target) {
  target.replaceChildren();
  const note = document.createElement("p");
  note.className = "empty";
  note.textContent = copy.empty;
  target.append(note);
}

function render(state) {
  current = state;
  if (!state) return;

  const wanted = state.sites.some((site) => site.id === elements.supplier.value)
    ? elements.supplier.value
    : state.sites[0]?.id || "";
  if (!elements.supplier.options.length) {
    for (const site of state.sites) {
      const option = document.createElement("option");
      option.value = site.id;
      option.textContent = site.name;
      elements.supplier.append(option);
    }
  }
  if (wanted) elements.supplier.value = wanted;

  elements.status.textContent = statusText(state);
  elements.status.dataset.tone = tone(state);
  elements.start.disabled = Boolean(state.running);
  elements.stop.disabled = !state.running;
  elements.supplier.disabled = Boolean(state.running);

  if (state.confirm) {
    elements.confirmCard.hidden = false;
    elements.confirmText.textContent = `${copy.confirmText} ${state.confirm.value || ""}`.trim();
    elements.confirm.disabled = false;
  } else {
    elements.confirmCard.hidden = true;
  }

  elements.lines.replaceChildren();
  for (const line of state.lines) {
    const tr = document.createElement("tr");
    const index = document.createElement("td");
    index.className = "n";
    index.textContent = String(line.index + 1);
    const part = document.createElement("td");
    part.textContent = line.mpn;
    const qty = document.createElement("td");
    qty.textContent = line.quantity;
    const status = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.dataset.state = line.status;
    pill.textContent = copy[line.status] || line.status;
    status.append(pill);
    const note = document.createElement("td");
    note.textContent = line.error || "";
    tr.append(index, part, qty, status, note);
    elements.lines.append(tr);
  }
  if (!state.lines.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "empty";
    td.textContent = copy.empty;
    tr.append(td);
    elements.lines.append(tr);
  }

  if (Array.isArray(state.cart) && state.cart.length) {
    elements.cart.replaceChildren(...state.cart.map((line) => row(line.part || line.mpn || copy.none, line.quantity || copy.none)));
  } else {
    empty(elements.cart);
  }

  if (Array.isArray(state.orders) && state.orders.length) {
    elements.orders.replaceChildren(...state.orders.map((order) => row(order.number || copy.none, `${order.status || ""} ${order.total || ""}`.trim())));
  } else {
    empty(elements.orders);
  }

  if (Array.isArray(state.tracking) && state.tracking.length) {
    elements.tracking.replaceChildren(...state.tracking.map((track) => row(track.order || copy.none, track.status || copy.none)));
  } else {
    empty(elements.tracking);
  }
}

elements.start.addEventListener("click", async () => {
  const text = elements.list.value;
  const supplier = elements.supplier.value;
  if (!text.trim()) {
    elements.list.focus();
    return;
  }
  await window.buyLab.select(supplier);
  await window.buyLab.start({ supplier, text });
});

elements.stop.addEventListener("click", () => { void window.buyLab.stop(); });
elements.confirm.addEventListener("click", () => { void window.buyLab.confirm(); });
elements.live.addEventListener("click", () => { void window.buyLab.showLive(); });
elements.external.addEventListener("click", () => { void window.buyLab.openExternal(); });

window.buyLab.onFlow((state) => render(state));
window.buyLab.state().then((state) => render(state)).catch(() => {});

/* The live overlay: the supplier's Chrome on top of the list, shown when the
 * shop stops for the person or when they open it. live.js draws the frames
 * and forwards the input; here only the overlay's visibility changes. */
const overlay = document.querySelector("[data-live]");

function setView(view) {
  const live = view === "live";
  overlay.hidden = !live;
  if (!live) return;
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
    document.querySelector("[data-screen]")?.focus();
  });
}

window.buyLab.onView((view) => setView(view));
