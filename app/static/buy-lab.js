/* Buy lab's flow page: a pasted list, its states, the cart, the orders and
 * the tracking. It only asks the app for things through the preload bridge. */

const COPY = {
  en: {
    title: "Buy lab", supplier: "Supplier", paste: "Paste the list",
    placeholder: "One part per line: part number and quantity, e.g.\nGRM155R71C104KA88D 10\nRC0402FR-0710KL 100",
    start: "Start purchase", demo: "Demo", stop: "Stop",
    hint: "The list runs through the supplier's own pages in the background. You are asked to step in only for a check, a sign-in, or the order confirmation.",
    confirmTitle: "Confirm the order", confirmText: "The cart is on the review page. Place the order?",
    confirm: "Place the order", live: "Open supplier page", external: "Open in browser", backToBom: "\u2190 Back to BOM", backToList: "\u2190 Back to the list",
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
      "waiting-bom-approval": "The price changed: approve it on the order in BOM first, then say yes here",
      "bulk-adding": "Adding the whole list to the cart",
      challenge: "The security check is open in Chrome: finish it there and this continues by itself.",
      blocked: "The supplier refused this browser (Access Denied); try again later or use its API.",
      sign_in: "Sign in on the supplier page; this continues once you are in.",
      checkout_details: "Fill in the address and how to pay on the supplier page, then continue.",
      bulk_error: "The supplier didn't take some lines (packaging or quantity): choose an option on its page, or remove the line.",
      lost: "The supplier page isn't one this app knows: open it and get to the next step yourself.",
      "nothing-added": "No line went into the cart, so the purchase stopped there.",
      "cart-check": "Check the cart: is this what you want to buy?",
      "cart-confirmed": "Cart confirmed: going to checkout",
      "rehearsal-placed": "Rehearsal: stopped at the order's yes, nothing was ordered",
    },
    empty: "Nothing yet", orderNumber: "Order", none: "—",
    demoBoth: "Demo (DigiKey + LCSC + Mouser)", stopAll: "Stop all", openPage: "Open its page",
    cartCheckTitle: "Check the cart", cartCheckText: "Compare it with your list before anything is bought.",
    cartOk: "Correct, go to checkout", cartRecheck: "Re-check", cartList: "Your list", cartCart: "In the cart",
    cartUnit: "Unit price", cartLine: "Line total", cartTotal: "Cart total", cartAllGood: "Every line matches your list.",
    cartIssues: "{n} to look at", issues: { missing: "Not in the cart", quantity: "Other quantity", price: "Dearer than BOM", extra: "Not on your list" },
    resume: "Continue", resumeSaved: "Continue the interrupted purchase",
    rehearsal: "Rehearsal (no order)", rehearsalHint: "Runs to the order's yes, then stops: nothing is bought.",
    placedTitle: "Order placed", rehearsalTitle: "Rehearsal: not ordered", placedNumber: "Order number",
    serviceSignIn: "BOM's purchasing service: sign in to BOM in this app to receive purchases from Buying.",
    serviceMissing: "BOM's purchasing service isn't on this site (404): purchases from Buying can't reach the Buy lab.",
    serviceError: "BOM's purchasing service didn't answer:",
    address: "Ship to", addressNone: "Not filled in for me", addressManage: "Addresses",
    addressNew: "New address", addressSave: "Save", addressDelete: "Delete", addressClose: "Close",
    addressNote: "Kept on this computer only. DigiKey's address form is filled from it; payment stays yours.",
    addressSaved: "Saved", addressFields: { label: "Name for this address", customerType: "Customer type (DigiKey)", firstName: "First name", lastName: "Last name", company: "Company", email: "Email", phone: "Telephone", line1: "Address line 1", line2: "Address line 2", city: "City", state: "State (two letters)", zip: "Postal code" },
  },
  zh: {
    title: "采购实验室", supplier: "供应商", paste: "粘贴清单",
    placeholder: "每行一个料号：型号 + 数量，例如\nGRM155R71C104KA88D 10\nRC0402FR-0710KL 100",
    start: "开始采购", demo: "一键演示", stop: "停止",
    hint: "清单会在后台走供应商自己的页面。只有遇到安全验证、登录，或需要你确认下单时，才会请你出手。",
    confirmTitle: "确认下单", confirmText: "购物车已到确认页，现在下单吗？",
    confirm: "确认下单", live: "打开原始页面", external: "在浏览器中打开", backToBom: "\u2190 返回 BOM", backToList: "\u2190 返回清单",
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
      "waiting-bom-approval": "价格有变化：请先在 BOM 的订单里确认，再回到这里确认下单",
      "bulk-adding": "正在把整份清单加入购物车",
      challenge: "安全验证已切到 Chrome 窗口，请在那边完成，完成后会自动继续",
      blocked: "站点拒绝访问（Access Denied），请稍后再试或改用其 API",
      sign_in: "请在供应商页面登录，登录后会自动继续",
      checkout_details: "请在供应商页面填写收货地址和付款方式，然后继续",
      bulk_error: "有料号没加进购物车（包装或数量不符）：请在供应商页面选择包装，或删除该行",
      lost: "供应商页面不是本应用认识的页面：请打开它，手动走到下一步",
      "nothing-added": "没有任何一行加入购物车，采购已在此停止",
      "cart-check": "请核对购物车：这是你要买的吗？",
      "cart-confirmed": "购物车已确认，正在进入结账",
      "rehearsal-placed": "演练：停在确认下单这一步，没有下单",
    },
    empty: "还没有内容", orderNumber: "订单", none: "—",
    demoBoth: "一键演示（DigiKey + LCSC + Mouser）", stopAll: "全部停止", openPage: "打开它的页面",
    cartCheckTitle: "核对购物车", cartCheckText: "下单前，和你的清单对一下。",
    cartOk: "没问题，去结账", cartRecheck: "重新读取", cartList: "你的清单", cartCart: "购物车里",
    cartUnit: "单价", cartLine: "小计", cartTotal: "购物车合计", cartAllGood: "每一行都和清单对得上。",
    cartIssues: "有 {n} 处要看", issues: { missing: "购物车里没有", quantity: "数量不同", price: "比 BOM 贵", extra: "清单里没有" },
    resume: "继续", resumeSaved: "继续上次中断的采购",
    rehearsal: "演练（不下单）", rehearsalHint: "走到确认下单就停，不会买任何东西。",
    placedTitle: "已下单", rehearsalTitle: "演练：未下单", placedNumber: "订单号",
    serviceSignIn: "BOM 采购服务：请先在本 app 里登录 BOM，才能接收 Buying 发来的采购。",
    serviceMissing: "这个网站上没有 BOM 采购服务（404）：Buying 的采购到不了 Buy lab。",
    serviceError: "BOM 采购服务没有响应：",
    address: "收货地址", addressNone: "不自动填写", addressManage: "地址簿",
    addressNew: "新增地址", addressSave: "保存", addressDelete: "删除", addressClose: "关闭",
    addressNote: "只保存在这台电脑上。用于自动填写 DigiKey 的收货地址；付款仍由你自己填写。",
    addressSaved: "已保存", addressFields: { label: "这个地址的名称", customerType: "客户类型（DigiKey）", firstName: "名", lastName: "姓", company: "公司", email: "邮箱", phone: "电话", line1: "地址第 1 行", line2: "地址第 2 行", city: "城市", state: "州（两个字母）", zip: "邮编" },
  },
  es: {
    title: "Laboratorio de compras", supplier: "Proveedor", paste: "Pega la lista",
    placeholder: "Una pieza por línea: número de pieza y cantidad, p. ej.\nGRM155R71C104KA88D 10\nRC0402FR-0710KL 100",
    start: "Iniciar compra", demo: "Demostración", stop: "Detener",
    hint: "La lista recorre las páginas del proveedor en segundo plano. Solo se te pide intervenir por una comprobación, un inicio de sesión o la confirmación del pedido.",
    confirmTitle: "Confirmar el pedido", confirmText: "El carrito está en la página de revisión. ¿Realizar el pedido?",
    confirm: "Realizar el pedido", live: "Abrir la página del proveedor", external: "Abrir en el navegador", backToBom: "\u2190 Volver a BOM", backToList: "\u2190 Volver a la lista",
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
      "waiting-bom-approval": "El precio cambió: apruébalo primero en el pedido de BOM y luego confirma aquí",
      "bulk-adding": "Añadiendo la lista entera al carrito",
      challenge: "La comprobación está abierta en Chrome: complétala allí y esto seguirá solo.",
      blocked: "El proveedor rechazó este navegador (Access Denied); inténtalo más tarde o usa su API.",
      sign_in: "Inicia sesión en la página del proveedor; esto sigue en cuanto entres.",
      checkout_details: "Completa la dirección y la forma de pago en la página del proveedor y continúa.",
      bulk_error: "El proveedor no aceptó algunas líneas (empaque o cantidad): elige una opción en su página o quita la línea.",
      lost: "La página del proveedor no es una que esta app conozca: ábrela y avanza tú al siguiente paso.",
      "nothing-added": "Ninguna línea entró al carrito, así que la compra se detuvo ahí.",
      "cart-check": "Revisa el carrito: ¿es lo que quieres comprar?",
      "cart-confirmed": "Carrito confirmado: yendo al pago",
      "rehearsal-placed": "Ensayo: se detuvo en la confirmación del pedido, no se pidió nada",
    },
    empty: "Nada todavía", orderNumber: "Pedido", none: "—",
    demoBoth: "Demostración (DigiKey + LCSC + Mouser)", stopAll: "Detener todo", openPage: "Abrir su página",
    cartCheckTitle: "Revisa el carrito", cartCheckText: "Compáralo con tu lista antes de comprar nada.",
    cartOk: "Correcto, ir al pago", cartRecheck: "Volver a leer", cartList: "Tu lista", cartCart: "En el carrito",
    cartUnit: "Precio unitario", cartLine: "Total de la línea", cartTotal: "Total del carrito", cartAllGood: "Todas las líneas coinciden con tu lista.",
    cartIssues: "{n} por revisar", issues: { missing: "No está en el carrito", quantity: "Otra cantidad", price: "Más caro que en BOM", extra: "No está en tu lista" },
    resume: "Continuar", resumeSaved: "Continuar la compra interrumpida",
    rehearsal: "Ensayo (sin pedido)", rehearsalHint: "Llega a la confirmación del pedido y se detiene: no se compra nada.",
    placedTitle: "Pedido realizado", rehearsalTitle: "Ensayo: sin pedido", placedNumber: "Número de pedido",
    serviceSignIn: "Servicio de compras de BOM: inicia sesión en BOM en esta app para recibir compras desde Buying.",
    serviceMissing: "Este sitio no tiene el servicio de compras de BOM (404): las compras de Buying no llegan al Buy lab.",
    serviceError: "El servicio de compras de BOM no respondió:",
    address: "Enviar a", addressNone: "No rellenar por mí", addressManage: "Direcciones",
    addressNew: "Nueva dirección", addressSave: "Guardar", addressDelete: "Eliminar", addressClose: "Cerrar",
    addressNote: "Solo en este equipo. Rellena el formulario de dirección de DigiKey; el pago sigue siendo tuyo.",
    addressSaved: "Guardada", addressFields: { label: "Nombre de esta dirección", customerType: "Tipo de cliente (DigiKey)", firstName: "Nombre", lastName: "Apellido", company: "Empresa", email: "Correo", phone: "Teléfono", line1: "Dirección, línea 1", line2: "Dirección, línea 2", city: "Ciudad", state: "Estado (dos letras)", zip: "Código postal" },
  },
};

const language = new URLSearchParams(window.location.search).get("lang") || "en";
const copy = COPY[language] || COPY.en;
document.documentElement.lang = language;

/* One click for a demo: a small list for each supplier, run at the same time.
 * DigiKey takes its own cut-tape numbers (Bulk Add and the file upload match
 * a bare MPN to its reel, which isn't sold by tens): RC0402FR-0710KL and
 * GRM155R71C104KA88D. LCSC takes its own C-numbers. Mouser takes its own
 * numbers in its Price & Availability list (both checked on mouser.com,
 * 2026-11-20): a 10 kΩ 0603 resistor and a single AND gate. */
const DEMO = {
  digikey: "311-10.0KLRCT-ND 10\n490-3261-1-ND 10",
  lcsc: "C1525 10\nC25804 10",
  mouser: "603-RC0603FR-0710KL 10\n595-SN74LVC1G08DBVR 10",
};
const ADDRESS_FIELDS = ["label", "customerType", "firstName", "lastName", "company", "email", "phone", "line1", "line2", "city", "state", "zip"];
/* DigiKey's "Customer type" codes, as its form names them. */
const CUSTOMER_TYPES = [
  ["13", "Design/Research/Development"], ["10", "Individual"], ["11", "School/University"], ["12", "Government"],
  ["14", "Repair"], ["15", "OEM - Original Equipment Manufacturer"], ["16", "Dealer/Retailer"], ["17", "Franchise Distributor"],
  ["18", "Independent Distributor"], ["19", "Broker"], ["20", "Kitting"], ["21", "Consultant"],
  ["22", "CM Contract Manufacturer"], ["23", "ODM - Original Design Manufacturer"], ["99", "Other"],
];

const $ = (selector, root = document) => root.querySelector(selector);
const make = (tag, props = {}, ...children) => {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
};

const elements = {
  title: $("[data-title]"),
  addressLabel: $("[data-address-label]"),
  address: $("[data-address]"),
  addressManage: $("[data-address-manage]"),
  addressForm: $("[data-address-form]"),
  addressFields: $("[data-address-fields]"),
  addressNote: $("[data-address-note]"),
  addressSave: $("[data-address-save]"),
  addressDelete: $("[data-address-delete]"),
  addressNew: $("[data-address-new]"),
  addressClose: $("[data-address-close]"),
  addressMessage: $("[data-address-message]"),
  demo: $("[data-demo]"),
  rehearsal: $("[data-rehearsal]"),
  service: $("[data-service]"),
  rehearsalLabel: $("[data-rehearsal-label]"),
  rehearsalText: $("[data-rehearsal-text]"),
  stopAll: $("[data-stop-all]"),
  external: $("[data-external]"),
  backSite: $("[data-back-site]"),
  liveBack: $("[data-back]"),
  hint: $("[data-hint]"),
  suppliers: $("[data-suppliers]"),
};

elements.title.textContent = copy.title;
elements.addressLabel.textContent = copy.address;
elements.addressManage.textContent = copy.addressManage;
elements.addressNote.textContent = copy.addressNote;
elements.addressSave.textContent = copy.addressSave;
elements.addressDelete.textContent = copy.addressDelete;
elements.addressNew.textContent = copy.addressNew;
elements.addressClose.textContent = copy.addressClose;
elements.demo.textContent = copy.demoBoth;
elements.rehearsalText.textContent = copy.rehearsal;
elements.rehearsalLabel.title = copy.rehearsalHint;
elements.stopAll.textContent = copy.stopAll;
elements.external.textContent = copy.external;
elements.backSite.textContent = copy.backToBom;
elements.backSite.addEventListener("click", () => { void window.buyLab.back(); });
elements.hint.textContent = copy.hint;

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
  return make("div", { className: "list-row" },
    make("span", { textContent: left }),
    make("span", { textContent: right == null ? copy.none : String(right) }));
}

function fillList(target, items, toRow) {
  if (Array.isArray(items) && items.length) {
    target.replaceChildren(...items.map(toRow));
  } else {
    target.replaceChildren(make("p", { className: "empty", textContent: copy.empty }));
  }
}

/* ---- one panel per supplier ---- */

const panels = new Map();

function buildPanel(site) {
  const panel = make("section", { className: "card panel" });
  panel.dataset.panel = site.id;
  const status = make("p", { className: "status" });
  status.setAttribute("role", "status");
  const openPage = make("button", { className: "quiet", type: "button", textContent: copy.openPage });
  const list = make("textarea", { rows: 4, spellcheck: false, placeholder: copy.placeholder });
  const start = make("button", { className: "primary", type: "button", textContent: copy.start });
  const stop = make("button", { className: "quiet", type: "button", textContent: copy.stop });
  const confirmText = make("p", { className: "card-body" });
  const confirm = make("button", { className: "primary", type: "button", textContent: copy.confirm });
  const confirmCard = make("div", { className: "confirm-box", hidden: true },
    make("div", {}, make("h3", { className: "card-title", textContent: copy.confirmTitle }), confirmText), confirm);
  const resume = make("button", { className: "primary", type: "button", textContent: copy.resume, hidden: true });
  const cartRows = make("tbody");
  const cartSummary = make("p", { className: "card-body" });
  const cartOk = make("button", { className: "primary", type: "button", textContent: copy.cartOk });
  const cartRecheck = make("button", { className: "quiet cart-extra", type: "button", textContent: copy.cartRecheck });
  const cartStop = make("button", { className: "quiet cart-extra", type: "button", textContent: copy.stop });
  const cartHead = make("tr", {}, make("th", { textContent: copy.part }), make("th", { textContent: copy.cartList }),
    make("th", { textContent: copy.cartCart }), make("th", { textContent: copy.cartUnit }), make("th", { textContent: copy.cartLine }),
    make("th", { textContent: copy.note }));
  const cartCheckCard = make("div", { className: "cart-check", hidden: true },
    make("h3", { className: "card-title cart-detail", textContent: copy.cartCheckTitle }),
    make("p", { className: "card-body cart-detail", textContent: copy.cartCheckText }),
    make("table", { className: "lines cart-detail" }, make("thead", {}, cartHead), cartRows),
    cartSummary,
    make("div", { className: "row" }, cartOk, cartRecheck, cartStop));
  const placedTitle = make("h3", { className: "card-title" });
  const placedBody = make("p", { className: "card-body" });
  const placedCard = make("div", { className: "placed-box", hidden: true }, placedTitle, placedBody);
  const lines = make("tbody");
  const head = make("tr", {}, make("th", { className: "n", textContent: "#" }), make("th", { textContent: copy.part }),
    make("th", { textContent: copy.qty }), make("th", { textContent: copy.state }), make("th", { textContent: copy.note }));
  const table = make("table", { className: "lines" }, make("thead", {}, head), lines);
  const cart = make("div", { className: "list" });
  const orders = make("div", { className: "list" });
  const tracking = make("div", { className: "list" });
  const block = (title, body) => make("div", { className: "mini" }, make("h3", { className: "card-title", textContent: title }), body);
  panel.append(
    make("div", { className: "panel-head" }, make("h2", { className: "card-title", textContent: site.name }), status, openPage),
    list,
    make("div", { className: "row run-row" }, start, stop, resume),
    cartCheckCard,
    confirmCard,
    placedCard,
    table,
    make("div", { className: "minis" }, block(copy.cart, cart), block(copy.orders, orders), block(copy.tracking, tracking)),
  );

  start.addEventListener("click", () => {
    if (!list.value.trim()) { list.focus(); return; }
    void startOne(site.id, list.value);
  });
  stop.addEventListener("click", () => { void window.buyLab.stop(site.id); });
  confirm.addEventListener("click", () => { void window.buyLab.confirm(site.id); });
  cartOk.addEventListener("click", () => { void window.buyLab.confirmCart(site.id); });
  cartRecheck.addEventListener("click", () => { void window.buyLab.recheckCart(site.id); });
  cartStop.addEventListener("click", () => { void window.buyLab.stop(site.id); });
  resume.addEventListener("click", () => { void window.buyLab.resume(site.id); });
  openPage.addEventListener("click", () => { void window.buyLab.showLive(site.id); });

  const parts = { panel, status, list, start, stop, resume, cartCheckCard, cartRows, cartSummary, placedCard, placedTitle, placedBody,
    confirmCard, confirmText, confirm, lines, cart, orders, tracking };
  panels.set(site.id, parts);
  elements.suppliers.append(panel);
  return parts;
}

function renderCartCheck(parts, check) {
  parts.cartCheckCard.hidden = !check;
  if (!check) return;
  parts.cartRows.replaceChildren(...check.lines.map((line) => {
    const note = line.issue ? make("span", { className: "pill", textContent: copy.issues[line.issue] || line.issue }) : "";
    if (note) note.dataset.state = "failed";
    const tr = make("tr", {},
      make("td", { textContent: line.part }),
      make("td", { textContent: line.quantity ?? copy.none }),
      make("td", { textContent: line.cartQuantity ?? copy.none }),
      make("td", { textContent: line.unitPrice || copy.none }),
      make("td", { textContent: line.extended || copy.none }),
      make("td", {}, note));
    if (line.issue) tr.dataset.issue = line.issue;
    return tr;
  }));
  const verdict = check.issues ? copy.cartIssues.replace("{n}", String(check.issues)) : copy.cartAllGood;
  parts.cartSummary.textContent = check.total ? `${verdict} · ${copy.cartTotal}: $${check.total}` : verdict;
  parts.cartSummary.dataset.tone = check.issues ? "waiting" : "";
}

function renderPlaced(parts, placed) {
  parts.placedCard.hidden = !placed;
  if (!placed) return;
  parts.placedCard.dataset.rehearsal = placed.rehearsal ? "true" : "false";
  parts.placedTitle.textContent = placed.rehearsal ? copy.rehearsalTitle : copy.placedTitle;
  const when = placed.at ? new Date(placed.at).toLocaleString(language) : "";
  parts.placedBody.textContent = [`${copy.placedNumber}: ${placed.orderNumber || copy.none}`, placed.total, when].filter(Boolean).join(" · ");
}

function renderPanel(parts, state, saved) {
  parts.status.textContent = statusText(state);
  parts.status.dataset.tone = tone(state);
  parts.start.disabled = Boolean(state.running);
  // Continue: this window's interrupted purchase, or one saved before the app closed.
  const savedRun = !state.running && !state.lines.length && saved;
  parts.resume.hidden = !(state.canResume || savedRun);
  parts.resume.textContent = state.canResume ? copy.resume : copy.resumeSaved;
  renderCartCheck(parts, state.cartCheck);
  renderPlaced(parts, state.placed);
  parts.stop.disabled = !state.running;
  parts.list.disabled = Boolean(state.running);

  if (state.confirm) {
    parts.confirmCard.hidden = false;
    parts.confirmText.textContent = `${copy.confirmText} ${state.confirm.value || ""}`.trim();
  } else {
    parts.confirmCard.hidden = true;
  }

  parts.lines.replaceChildren();
  for (const line of state.lines) {
    const pill = make("span", { className: "pill", textContent: copy[line.status] || line.status });
    pill.dataset.state = line.status;
    parts.lines.append(make("tr", {},
      make("td", { className: "n", textContent: String(line.index + 1) }),
      make("td", { textContent: line.mpn }),
      make("td", { textContent: line.quantity }),
      make("td", {}, pill),
      make("td", { textContent: line.error || "" })));
  }
  if (!state.lines.length) {
    parts.lines.append(make("tr", {}, make("td", { colSpan: 5, className: "empty", textContent: copy.empty })));
  }
  // A supplier's cart table can have spacer rows; only lines with a part show.
  const cartLines = Array.isArray(state.cart) ? state.cart.filter((line) => String(line.part || line.mpn || "").trim()) : state.cart;
  fillList(parts.cart, cartLines, (line) => row(line.part || line.mpn, line.quantity || copy.none));
  fillList(parts.orders, state.orders, (order) => row(order.number || copy.none, `${order.status || ""} ${order.total || ""}`.trim()));
  fillList(parts.tracking, state.tracking, (track) => row(track.order || copy.none, track.status || copy.none));
}

/* What BOM's purchasing service last answered: nothing is shown while it
 * works; anything else is said, never hidden. */
function renderService(service) {
  if (!elements.service) return;
  const failed = service && service.state === "error";
  elements.service.hidden = !failed;
  if (!failed) return;
  elements.service.textContent = service.http === 401 ? copy.serviceSignIn
    : service.http === 404 ? copy.serviceMissing
    : `${copy.serviceError} ${service.message || ""}`.trim();
}

let current = null;

function render(state) {
  if (!state || !state.flows) return;
  current = state;
  for (const site of state.sites) {
    const parts = panels.get(site.id) || buildPanel(site);
    // A list the BOM site handed over shows in the supplier's box.
    const handed = state.lists?.[site.id];
    if (handed && handed !== parts.handed) {
      parts.handed = handed;
      parts.list.value = handed;
    }
    renderPanel(parts, state.flows[site.id], state.saved?.[site.id]);
  }
  renderService(state.service);
  // Opened by BOM's Deal with it: Back (here and on the seller's page) goes to BOM.
  elements.backSite.hidden = state.returnTo !== "site";
  if (elements.liveBack) elements.liveBack.textContent = state.returnTo === "site" ? copy.backToBom : copy.backToList;
  const anyRunning = Object.values(state.flows).some((flow) => flow.running);
  elements.stopAll.disabled = !anyRunning;
  elements.demo.disabled = Object.values(state.flows).some((flow) => flow.running);
}

/* ---- starting purchases ---- */

function addressId() {
  return elements.address.value || "";
}

async function startOne(id, text) {
  await window.buyLab.start({ supplier: id, text, addressId: addressId(), rehearsal: Boolean(elements.rehearsal?.checked) });
}

elements.demo.addEventListener("click", async () => {
  // Both suppliers at once, each in its own Chrome.
  const runs = [];
  for (const [id, text] of Object.entries(DEMO)) {
    const parts = panels.get(id);
    if (!parts) continue;
    parts.list.value = text;
    runs.push(startOne(id, text));
  }
  await Promise.all(runs);
});
elements.stopAll.addEventListener("click", () => { void window.buyLab.stop(); });
elements.external.addEventListener("click", () => { void window.buyLab.openExternal(); });

/* ---- the address book ---- */

let addresses = [];
let editing = "";

for (const field of ADDRESS_FIELDS) {
  let input;
  if (field === "customerType") {
    input = make("select", { name: field }, ...CUSTOMER_TYPES.map(([value, label]) => make("option", { value, textContent: label })));
  } else {
    input = make("input", { type: field === "email" ? "email" : field === "phone" ? "tel" : "text", name: field, autocomplete: "off" });
    if (field === "state") { input.maxLength = 2; input.style.textTransform = "uppercase"; }
  }
  elements.addressFields.append(make("label", { className: `field field-${field}` }, make("span", { textContent: copy.addressFields[field] }), input));
}
const fieldInput = (field) => elements.addressFields.querySelector(`[name="${field}"]`);

function renderAddresses(selected = elements.address.value) {
  const options = [make("option", { value: "", textContent: copy.addressNone })];
  for (const entry of addresses) options.push(make("option", { value: entry.id, textContent: entry.label || `${entry.firstName} ${entry.lastName}` }));
  elements.address.replaceChildren(...options);
  elements.address.value = addresses.some((entry) => entry.id === selected) ? selected : (addresses[0]?.id || "");
}

async function loadAddresses(selected) {
  addresses = await window.buyLab.addresses().catch(() => []);
  renderAddresses(selected);
}

function editAddress(id) {
  const entry = addresses.find((item) => item.id === id) || null;
  editing = entry ? entry.id : "";
  for (const field of ADDRESS_FIELDS) fieldInput(field).value = entry ? entry[field] || "" : "";
  if (!fieldInput("customerType").value) fieldInput("customerType").value = CUSTOMER_TYPES[0][0];
  elements.addressDelete.disabled = !entry;
  elements.addressMessage.textContent = "";
}

elements.addressManage.addEventListener("click", () => {
  elements.addressForm.hidden = !elements.addressForm.hidden;
  if (!elements.addressForm.hidden) editAddress(elements.address.value);
});
elements.addressClose.addEventListener("click", () => { elements.addressForm.hidden = true; });
elements.addressNew.addEventListener("click", () => editAddress(""));
elements.address.addEventListener("change", () => {
  if (!elements.addressForm.hidden) editAddress(elements.address.value);
});
elements.addressSave.addEventListener("click", async () => {
  const address = { id: editing };
  for (const field of ADDRESS_FIELDS) address[field] = fieldInput(field).value;
  const result = await window.buyLab.saveAddress(address);
  if (!result?.ok) {
    elements.addressMessage.textContent = result?.message || copy.failed;
    elements.addressMessage.dataset.tone = "failed";
    return;
  }
  await loadAddresses(result.address.id);
  editAddress(result.address.id);
  elements.addressMessage.textContent = copy.addressSaved;
  elements.addressMessage.dataset.tone = "";
});
elements.addressDelete.addEventListener("click", async () => {
  if (!editing) return;
  await window.buyLab.deleteAddress(editing);
  await loadAddresses("");
  editAddress(elements.address.value);
});

void loadAddresses();

window.buyLab.onFlow((state) => render(state));
window.buyLab.state().then((state) => render(state)).catch(() => {});

/* The live overlay: a supplier's Chrome on top of the lists, shown when that
 * shop stops for the person or when they open it. live.js draws the frames
 * and forwards the input; here only the overlay's visibility changes. */
const overlay = document.querySelector("[data-live]");

/* "split" (BOM's Deal with it at the cart check): the seller's cart check on
 * the left, its live page on the right, as two cards. */
function setView(view) {
  const live = view !== "flow";
  overlay.hidden = !live;
  document.body.classList.toggle("is-split", view === "split");
  if (view !== "split") for (const parts of panels.values()) parts.panel.classList.remove("is-focus");
  if (!live) return;
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
    document.querySelector("[data-screen]")?.focus();
    if (view === "split") {
      const box = document.querySelector("[data-stage]").getBoundingClientRect();
      void window.buyLab.stageSize({ width: Math.round(box.width), height: Math.round(box.height) });
    }
  });
}

window.buyLab.onView((view) => setView(view));

/* BOM's Deal with it → "Cart": this seller's cart check, scrolled into view. */
window.buyLab.onReveal(({ id }) => {
  const parts = panels.get(String(id || ""));
  if (!parts) return;
  for (const [key, other] of panels) other.panel.classList.toggle("is-focus", key === String(id));
  const target = parts.cartCheckCard && !parts.cartCheckCard.hidden ? parts.cartCheckCard : parts.panel;
  requestAnimationFrame(() => target.scrollIntoView({ block: "start", behavior: "smooth" }));
});
