/* Buy lab's flow page: a pasted list, its states, the cart, the orders and
 * the tracking. It only asks the app for things through the preload bridge. */

const COPY = {
  en: {
    title: "Supplier pages", supplier: "Supplier", paste: "Paste the list",
    placeholder: "One part per line: part number and quantity, e.g.\nGRM155R71C104KA88D 10\nRC0402FR-0710KL 100",
    start: "Start purchase", demo: "Demo", stop: "Stop",
    hint: "The app works through the suppliers' own websites in the background. It asks you only to finish a security check, sign in, or confirm an order.",
    confirmTitle: "Confirm the order", confirmText: "The order is on the supplier's review page. Place it now?",
    confirm: "Place the order", live: "Open supplier page", external: "Open in browser", backToBom: "\u2190 Back to O2 BOM", backToList: "\u2190 Back to the list",
    lines: "Lines", part: "Part", qty: "Qty", state: "State", note: "Note",
    cart: "Cart", orders: "Orders", tracking: "Reading shipping updates…",
    ready: "Ready", working: "Working", waiting: "Waiting for you", done: "Done", failed: "Failed", stopped: "Stopped", blocked: "The website blocked the app (Access Denied). Try again later.",
    waitingPerson: "Sign in or finish the security check on the supplier's page; the app then carries on.",
    pending: "Pending", adding: "Adding the next part…", added: "Added",
    messages: {
      adding: "Adding the next line", "reading-cart": "Reading the cart…", "signing-in": "Signing in with your saved login…", "placing-order": "Going to the order review page…",
      "reading-orders": "Reading your orders…", tracking: "Reading the shipments", approved: "Approved",
      "waiting-confirm": "Waiting for you to confirm the order", "waiting-person": "Waiting for you on the supplier's page",
      "reloading-blocked": "The website blocked the page; reloading once…",
      "waiting-bom-approval": "Prices changed: approve them on the order in O2 BOM first, then confirm here",
      "bulk-adding": "Adding the whole list to the cart…",
      "checking-cart": "Checking the cart against your list…",
      "removing-extra": "Removing a part that isn't on your list…",
      "fixing-quantity": "Setting a part to your list's quantity…",
      "choosing-packaging": "Choosing each part's packaging in the DigiKey cart…",
      challenge: "Finish the security check in the Chrome window that opened; the app continues by itself.",
      blocked: "The supplier refused this browser (Access Denied); try again later or use its API.",
      sign_in: "Sign in on the supplier's page; the app continues once you're in.",
      checkout_details: "Fill in the address and payment on the supplier's page, then click Continue.",
      bulk_error: "Some parts weren't added (packaging or quantity). Pick an option on the supplier's page, or remove the part.",
      lost: "The app doesn't recognise this page. Get to the next step on the page yourself, then click Continue.",
      "nothing-added": "No part could be added to the cart, so the purchase stopped. Check the part numbers and try again.",
      "cart-check": "Check the cart: is this what you want to buy? If so, click Correct, go to checkout.",
      "cart-confirmed": "Cart confirmed. Going to checkout…",
      "rehearsal-placed": "Rehearsal: stopped at the order's yes, nothing was ordered",
      stalled: "Paused: the page didn't change for 3 minutes. Click Continue, or finish on the page yourself.",
    },
    empty: "Nothing yet", orderNumber: "Order", none: "—",
    holdCart: "The app is adding your lines to the cart: {done} of {total}",
    holdReading: "The app is reading the cart",
    holdCheckout: "The app is filling in the checkout",
    holdAfter: "The app is reading the order",
    holdNote: "Please don't click this page now; it will be yours as soon as the app needs you.",
    addressNote: "(The order's ship-to can't be filled in for you: {why}.)",
    holdStop: "Stop after this line",
    holdStopNow: "Stop now",
    holdStopping: "Stopping after this line…",
    totalLower: "The order's total ({review}) is lower than the cart you confirmed ({cart}): the cart may have changed. Check it before you place the order.",
    demoBoth: "Demo (DigiKey + LCSC + Mouser)", stopAll: "Stop all", openPage: "Open supplier page",
    cartCheckTitle: "Check the cart", cartCheckText: "Compare it with your list before anything is bought.",
    cartOk: "Correct, go to checkout", cartRecheck: "Re-check", cartList: "Your list", cartCart: "In the cart",
    cartUnit: "Unit price", cartLine: "Line total", cartTotal: "Cart total", cartAllGood: "Every line matches your list.",
    cartIssues: "{n} to look at", issues: { missing: "Not in the cart", quantity: "Other quantity", price: "Dearer than BOM", extra: "Not on your list", packaging: "Other packaging than the order" },
    resume: "Continue", resumeSaved: "Continue the interrupted purchase",
    rehearsal: "Rehearsal (no order)", rehearsalHint: "Runs to the order's yes, then stops: nothing is bought.",
    placedTitle: "Order placed", rehearsalTitle: "Rehearsal: not ordered", placedNumber: "Order number",
    serviceSignIn: "Sign in to O2 BOM in this app to receive orders from O2 BOM.",
    serviceMissing: "This O2 BOM site can't send orders to this app (404).",
    serviceError: "O2 BOM didn't answer:",
    address: "Ship to", addressNone: "Not filled in for me", addressManage: "Addresses",
    addressNew: "New address", addressSave: "Save", addressDelete: "Delete", addressClose: "Close",
    addressNote: "Kept on this computer only. DigiKey's address form is filled from it; payment stays yours.",
    addressSaved: "Saved", addressFields: { label: "Name for this address", customerType: "Customer type (DigiKey)", firstName: "First name", lastName: "Last name", company: "Company", email: "Email", phone: "Telephone", line1: "Address line 1", line2: "Address line 2", city: "City", state: "State (two letters)", zip: "Postal code" },
  },
  zh: {
    title: "供应商页面", supplier: "供应商", paste: "粘贴清单",
    placeholder: "每行一个料号：型号 + 数量，例如\nGRM155R71C104KA88D 10\nRC0402FR-0710KL 100",
    start: "开始采购", demo: "一键演示", stop: "停止",
    hint: "app 在后台操作供应商自己的网站。只有需要你完成安全验证、登录或确认下单时才会叫你。",
    confirmTitle: "确认下单", confirmText: "订单已到供应商的确认页，现在下单吗？",
    confirm: "确认下单", live: "打开供应商页面", external: "在浏览器中打开", backToBom: "\u2190 返回 O2 BOM", backToList: "\u2190 返回清单",
    lines: "明细", part: "型号", qty: "数量", state: "状态", note: "说明",
    cart: "购物车", orders: "订单", tracking: "正在读取物流信息…",
    ready: "准备就绪", working: "进行中", waiting: "等待你操作", done: "完成", failed: "失败", stopped: "已停止", blocked: "网站拦住了 app（Access Denied），请稍后再试。",
    waitingPerson: "请在供应商页面登录或完成安全验证，之后 app 会自动接着做。",
    pending: "待处理", adding: "正在加入下一个零件…", added: "已加入",
    messages: {
      adding: "正在加入下一行", "reading-cart": "正在读取购物车…", "signing-in": "正在用保存的账号登录…", "placing-order": "正在进入下单确认页…",
      "reading-orders": "正在读取订单…", tracking: "正在读取物流", approved: "已确认",
      "waiting-confirm": "等你确认下单", "waiting-person": "等你在供应商页面操作",
      "reloading-blocked": "网站拦住了页面，正在刷新一次…",
      "waiting-bom-approval": "价格变了：先在 O2 BOM 的订单里确认价格，再回来确认下单",
      "bulk-adding": "正在把整份清单加入购物车…",
      "checking-cart": "正在核对购物车和清单…",
      "removing-extra": "正在删除不在清单上的零件…",
      "fixing-quantity": "正在把零件数量改成清单上的数量…",
      "choosing-packaging": "正在 DigiKey 购物车里为每个零件选包装…",
      challenge: "请在弹出的 Chrome 窗口里完成安全验证，完成后 app 会自动继续。",
      blocked: "站点拒绝访问（Access Denied），请稍后再试或改用其 API",
      sign_in: "请在供应商页面登录，登录后 app 会自动继续。",
      checkout_details: "请在供应商页面填写收货地址和付款方式，然后点「继续」。",
      bulk_error: "有零件没加进购物车（包装或数量不对）。请在供应商页面选一个选项，或删掉这个零件。",
      lost: "app 认不出这个页面。请在页面上手动走到下一步，再点「继续」。",
      "nothing-added": "没有零件加进购物车，采购已停止。请检查料号后再试。",
      "cart-check": "请核对购物车：这是你要买的吗？没问题就点「没问题，去结账」。",
      "cart-confirmed": "购物车已确认，正在进入结账…",
      "rehearsal-placed": "演练：停在确认下单这一步，没有下单",
      stalled: "已暂停：页面 3 分钟没变化。点「继续」，或在页面上自己完成。",
    },
    empty: "还没有内容", orderNumber: "订单", none: "—",
    holdCart: "正在把物料加入购物车：{done}/{total}",
    holdReading: "正在读取购物车",
    holdCheckout: "正在填写结账信息",
    holdAfter: "正在读取订单",
    holdNote: "现在请不要点击这个页面，需要你操作时会马上交给你。",
    addressNote: "（订单的收货地址无法自动填写：{why}。）",
    holdStop: "做完这一行再停止",
    holdStopNow: "立即停止",
    holdStopping: "做完这一行就停止…",
    totalLower: "订单总价（{review}）比你确认的购物车（{cart}）还低，购物车可能被改过。下单前请再核对一下。",
    demoBoth: "一键演示（DigiKey + LCSC + Mouser）", stopAll: "全部停止", openPage: "打开供应商页面",
    cartCheckTitle: "核对购物车", cartCheckText: "下单前，和你的清单对一下。",
    cartOk: "没问题，去结账", cartRecheck: "重新读取", cartList: "你的清单", cartCart: "购物车里",
    cartUnit: "单价", cartLine: "小计", cartTotal: "购物车合计", cartAllGood: "每一行都和清单对得上。",
    cartIssues: "有 {n} 处要看", issues: { missing: "购物车里没有", quantity: "数量不同", price: "比 BOM 贵", extra: "清单里没有", packaging: "包装和订单不一样" },
    resume: "继续", resumeSaved: "继续上次中断的采购",
    rehearsal: "演练（不下单）", rehearsalHint: "走到确认下单就停，不会买任何东西。",
    placedTitle: "已下单", rehearsalTitle: "演练：未下单", placedNumber: "订单号",
    serviceSignIn: "请先在本 app 里登录 O2 BOM，才能接收 O2 BOM 的订单。",
    serviceMissing: "这个 O2 BOM 站点不能把订单发到本 app（404）。",
    serviceError: "O2 BOM 没有响应：",
    address: "收货地址", addressNone: "不自动填写", addressManage: "地址簿",
    addressNew: "新增地址", addressSave: "保存", addressDelete: "删除", addressClose: "关闭",
    addressNote: "只保存在这台电脑上。用于自动填写 DigiKey 的收货地址；付款仍由你自己填写。",
    addressSaved: "已保存", addressFields: { label: "这个地址的名称", customerType: "客户类型（DigiKey）", firstName: "名", lastName: "姓", company: "公司", email: "邮箱", phone: "电话", line1: "地址第 1 行", line2: "地址第 2 行", city: "城市", state: "州（两个字母）", zip: "邮编" },
  },
  es: {
    title: "Páginas de proveedores", supplier: "Proveedor", paste: "Pega la lista",
    placeholder: "Una pieza por línea: número de pieza y cantidad, p. ej.\nGRM155R71C104KA88D 10\nRC0402FR-0710KL 100",
    start: "Iniciar compra", demo: "Demostración", stop: "Detener",
    hint: "La app trabaja en las webs de los proveedores en segundo plano. Solo te pide terminar una verificación de seguridad, iniciar sesión o confirmar un pedido.",
    confirmTitle: "Confirmar el pedido", confirmText: "El pedido está en la página de revisión del proveedor. ¿Lo haces ahora?",
    confirm: "Realizar el pedido", live: "Abrir página del proveedor", external: "Abrir en el navegador", backToBom: "\u2190 Volver a O2 BOM", backToList: "\u2190 Volver a la lista",
    lines: "Líneas", part: "Pieza", qty: "Cant.", state: "Estado", note: "Nota",
    cart: "Carrito", orders: "Pedidos", tracking: "Leyendo el seguimiento…",
    ready: "Listo", working: "En curso", waiting: "Esperándote", done: "Hecho", failed: "Falló", stopped: "Detenido", blocked: "La web bloqueó la app (Access Denied). Inténtalo más tarde.",
    waitingPerson: "Inicia sesión o termina la verificación en la página del proveedor; la app sigue después.",
    pending: "Pendiente", adding: "Añadiendo la siguiente pieza…", added: "Añadida",
    messages: {
      adding: "Añadiendo la siguiente línea", "reading-cart": "Leyendo el carrito…", "signing-in": "Iniciando sesión con tu acceso guardado…", "placing-order": "Yendo a la revisión del pedido…",
      "reading-orders": "Leyendo tus pedidos…", tracking: "Leyendo los envíos", approved: "Aprobado",
      "waiting-confirm": "Esperando a que confirmes el pedido", "waiting-person": "Esperándote en la página del proveedor",
      "reloading-blocked": "La web bloqueó la página; recargando una vez…",
      "waiting-bom-approval": "Los precios cambiaron: apruébalos primero en el pedido de O2 BOM y luego confirma aquí",
      "bulk-adding": "Añadiendo toda la lista al carrito…",
      "checking-cart": "Comprobando el carrito con tu lista…",
      "removing-extra": "Quitando una pieza que no está en tu lista…",
      "fixing-quantity": "Ajustando una pieza a la cantidad de tu lista…",
      "choosing-packaging": "Eligiendo el empaque de cada pieza en el carrito de DigiKey…",
      challenge: "Termina la verificación de seguridad en la ventana de Chrome que se abrió; la app sigue sola.",
      blocked: "El proveedor rechazó este navegador (Access Denied); inténtalo más tarde o usa su API.",
      sign_in: "Inicia sesión en la página del proveedor; la app sigue en cuanto entres.",
      checkout_details: "Rellena la dirección y el pago en la página del proveedor y pulsa Continuar.",
      bulk_error: "Algunas piezas no se añadieron (empaque o cantidad). Elige una opción en la página del proveedor o quita la pieza.",
      lost: "La app no reconoce esta página. Llega tú al siguiente paso y pulsa Continuar.",
      "nothing-added": "No se pudo añadir ninguna pieza al carrito y la compra se detuvo. Revisa los números de pieza e inténtalo de nuevo.",
      "cart-check": "Revisa el carrito: ¿es lo que quieres comprar? Si es así, pulsa Correcto, ir al pago.",
      "cart-confirmed": "Carrito confirmado. Yendo al pago…",
      "rehearsal-placed": "Ensayo: se detuvo en la confirmación del pedido, no se pidió nada",
      stalled: "En pausa: la página no cambió en 3 minutos. Pulsa Continuar o termínalo tú en la página.",
    },
    empty: "Nada todavía", orderNumber: "Pedido", none: "—",
    holdCart: "La app está añadiendo tus líneas al carrito: {done} de {total}",
    holdReading: "La app está leyendo el carrito",
    holdCheckout: "La app está completando el pago",
    holdAfter: "La app está leyendo el pedido",
    holdNote: "No hagas clic en esta página ahora; será tuya en cuanto la app te necesite.",
    addressNote: "(La dirección de envío del pedido no se puede rellenar: {why}.)",
    holdStop: "Detener tras esta línea",
    holdStopNow: "Detener ya",
    holdStopping: "Se detendrá tras esta línea…",
    totalLower: "El total del pedido ({review}) es menor que el carrito que confirmaste ({cart}): el carrito pudo cambiar. Revísalo antes de pedir.",
    demoBoth: "Demostración (DigiKey + LCSC + Mouser)", stopAll: "Detener todo", openPage: "Abrir página del proveedor",
    cartCheckTitle: "Revisa el carrito", cartCheckText: "Compáralo con tu lista antes de comprar nada.",
    cartOk: "Correcto, ir al pago", cartRecheck: "Volver a leer", cartList: "Tu lista", cartCart: "En el carrito",
    cartUnit: "Precio unitario", cartLine: "Total de la línea", cartTotal: "Total del carrito", cartAllGood: "Todas las líneas coinciden con tu lista.",
    cartIssues: "{n} por revisar", issues: { missing: "No está en el carrito", quantity: "Otra cantidad", price: "Más caro que en BOM", extra: "No está en tu lista", packaging: "Otro empaque que el del pedido" },
    resume: "Continuar", resumeSaved: "Continuar la compra interrumpida",
    rehearsal: "Ensayo (sin pedido)", rehearsalHint: "Llega a la confirmación del pedido y se detiene: no se compra nada.",
    placedTitle: "Pedido realizado", rehearsalTitle: "Ensayo: sin pedido", placedNumber: "Número de pedido",
    serviceSignIn: "Inicia sesión en O2 BOM en esta app para recibir sus pedidos.",
    serviceMissing: "Este sitio de O2 BOM no puede enviar pedidos a esta app (404).",
    serviceError: "O2 BOM no respondió:",
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

if (elements.title) elements.title.textContent = copy.title;
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
    case "stopped": return state.message === "stalled" ? copy.messages.stalled : copy.stopped;
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
  stop.addEventListener("click", () => { void window.buyLab.stop(site.id, { soft: true }); });
  confirm.addEventListener("click", () => { void window.buyLab.confirm(site.id); });
  cartOk.addEventListener("click", () => { void window.buyLab.confirmCart(site.id); });
  cartRecheck.addEventListener("click", () => { void window.buyLab.recheckCart(site.id); });
  cartStop.addEventListener("click", () => { void window.buyLab.stop(site.id, { soft: true }); });
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
  // A cart that matches says nothing more (2026-11-21: the "Every line matches · Cart total"
  // line removed); only lines that differ are named.
  parts.cartSummary.hidden = !check.issues;
  parts.cartSummary.textContent = check.issues ? copy.cartIssues.replace("{n}", String(check.issues)) : "";
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
  parts.status.textContent = state.addressNote && state.running
    ? `${statusText(state)} ${copy.addressNote.replace("{why}", state.addressNote)}`
    : statusText(state);
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
    // The review page's total under the cart the person confirmed: the cart changed since.
    const check = state.totalCheck;
    if (check?.lower) {
      parts.confirmText.textContent += ` ${copy.totalLower.replace("{review}", `$${check.review}`).replace("{cart}", `$${check.cart}`)}`;
      parts.confirmText.dataset.tone = "waiting";
    } else {
      parts.confirmText.removeAttribute("data-tone");
    }
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
  if (elements.liveBack) elements.liveBack.textContent = state.returnTo === "site" || state.liveOnly ? copy.backToBom : copy.backToList;
  renderHold(state);
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

/* While the app has the shown supplier's page (adding to the cart, reading it,
 * filling the checkout), a cover over the picture says so and holds the
 * person's clicks (the app holds their keys too); its Stop finishes the line
 * first (2026-11-21: 机器操作的环节不能让人干预). */
const hold = {
  box: document.querySelector("[data-hold]"),
  text: document.querySelector("[data-hold-text]"),
  note: document.querySelector("[data-hold-note]"),
  bar: document.querySelector("[data-hold-bar]"),
  stop: document.querySelector("[data-hold-stop]"),
};
if (hold.note) hold.note.textContent = copy.holdNote;
hold.stop?.addEventListener("click", () => {
  if (current?.active) void window.buyLab.stop(current.active, { soft: true });
});

function renderHold(state) {
  if (!hold.box) return;
  const flow = state?.flows?.[state.active];
  const driving = Boolean(flow?.driving);
  hold.box.hidden = !driving;
  if (!driving) return;
  const counted = flow.phase === "cart" && flow.total > 0;
  const words = { cart: copy.holdCart, reading: copy.holdReading, checkout: copy.holdCheckout, after: copy.holdAfter }[flow.phase] || copy.working;
  hold.text.textContent = words.replace("{done}", String(flow.done)).replace("{total}", String(flow.total));
  hold.bar.parentElement.classList.toggle("is-indeterminate", !counted);
  hold.bar.style.width = counted ? `${Math.max(4, Math.round((100 * flow.done) / flow.total))}%` : "";
  hold.stop.textContent = flow.softStop ? copy.holdStopNow : copy.holdStop;
  hold.stop.title = flow.softStop ? copy.holdStopping : "";
}

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
