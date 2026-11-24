"use strict";

/* Mouser (www.mouser.com) as a state machine (machine.js).
 *
 * Where the selectors come from: the search page, product page, cart table
 * and header were read from the live site through the app's own Chrome
 * (2026-11-16): search `#global-search`, quantity
 * `[data-testid=PricingTableBuyInput]`, Buy `#btnBuy`, the cart badge
 * `#miniCarthypLink .badge-cart`, the "View Cart" link in the added-to-cart
 * window `#lnkBtnCart`, the cart table `table#cart tr.grid-row` with its
 * ProductDetail link and `jsQuantityInput`, and the line's delete button
 * (`button.carttable-icon`). Checkout, review and order pages need an account:
 * those go by words (common.js), and the walk hands over to the person on a
 * page it doesn't know. `verified` stays false until a run on the real site
 * has gone end to end, including checkout. */

const { T } = require("./common");

/* The cart table (2026-11-16, from the live page): `table#cart` has one
 * `tr.grid-row` per line; the Mouser number is the ProductDetail link, the
 * quantity `input.jsQuantityInput`, and the prices `.col-unitprice` and
 * `.col-ext`. Header, paging and the "add by number" rows are not lines. */
const CART_ROW = {
  any: [
    { css: "table#cart tr.grid-row" },
    { css: "#cart-form tr" },
    { role: "row" },
  ],
  hasText: "{{part}}",
};

const TARGETS = {
  /* A cart line's packaging (2026-11-24, live): its "Packaging: **Cut Tape"
   * link opens "Packaging Choice", radios with labels (Cut Tape, MouseReel™,
   * Full Reels: only for the reel's quantity), then Submit. */
  "cart.packLink": {
    title: T("Packaging", "包装", "Empaque"),
    within: CART_ROW,
    // A button, lnkMouseReel_<n>, reading "**Cut Tape" (2026-11-24, live).
    any: [{ css: "button[id^='lnkMouseReel']" }, { role: "button", name: /cut tape|mousereel|reel/i }, { role: "link", name: /cut tape|mousereel|reel/i }],
    hasText: /cut tape|mousereel|reel/i,
  },
  "cart.packChoice": {
    title: T("The packaging", "该包装", "El empaque"),
    any: [{ css: "label" }],
    hasText: "{{pack}}",
  },
  "cart.packSubmit": {
    title: T("Submit", "提交", "Enviar"),
    any: [{ role: "button", name: /^submit$/i }],
  },
  "search.input": {
    title: T("Search box", "搜索框", "Cuadro de búsqueda"),
    any: [
      { css: "#global-search, #headerSearchKeyword, input[name='keyword'].headerSearchBox" },
      { placeholder: /part # \/ keyword/i },
    ],
  },
  "results.exact": {
    title: T("The exact part", "完全匹配的型号", "La pieza exacta"),
    any: [
      { css: "#SearchResultsGrid_grid a[href*='/ProductDetail/']" },
      { role: "link", name: "{{part}}" },
    ],
    hasText: "{{part}}",
  },
  "product.ofPart": {
    title: T("The part's page", "该型号的页面", "La página de la pieza"),
    any: [{ css: "#spnManufacturerPartNumber, #spnMouserPartNumFormattedForProdInfo" }, { css: "h1" }],
    hasText: "{{part}}",
  },
  "product.quantity": {
    title: T("Quantity", "数量", "Cantidad"),
    any: [
      { css: "input[data-testid='PricingTableBuyInput'], input.buy-input" },
      { label: /^(qty|quantity)/i },
    ],
  },
  "product.addToCart": {
    title: T("Buy", "购买", "Comprar"),
    any: [
      { css: "#btnBuy, [data-testid='PricingTableBuyButtonTrigger']" },
      { role: "button", name: /^(add to cart|buy)$/i },
      // Other buy boxes of the product page (2026-11-24: GRM188R71H104KA93D's page was not recognised).
      { css: "button[id*='btnBuy' i], input[id*='btnBuy' i], button[id*='AddToCart' i], button[data-testid*='Buy' i]" },
      { role: "button", name: /add to cart/i },
    ],
  },
  "cart.count": {
    title: T("Cart count", "购物车数量", "Cantidad en el carrito"),
    any: [{ css: "#miniCarthypLink .badge-cart, .badge-cart" }],
  },
  "cart.added": {
    title: T("Added to cart", "已加入购物车", "Añadido al carrito"),
    any: [{ css: "#lnkBtnCart" }, { text: /(added|add) to (your )?cart|item(s)? added/i }],
  },
  "cart.rows": {
    title: T("Cart lines", "购物车明细", "Líneas del carrito"),
    any: [
      { css: "table#cart tr.grid-row" },
      { css: "#cart-form tr" },
    ],
    hasText: /\d/,
  },
  "cart.part": {
    title: T("Part number", "型号", "Número de pieza"),
    any: [
      { css: "a[href*='/ProductDetail/']" },
      { css: "table#cart td.grid-cell.col-1" },
      { css: "a" },
    ],
  },
  "cart.quantity": {
    title: T("Quantity", "数量", "Cantidad"),
    any: [
      { css: "input.jsQuantityInput" },
      { css: "input[name*='Quantity' i]" },
      { css: "input[aria-label*='quantity' i]" },
    ],
  },
  "cart.unitPrice": {
    title: T("Unit price", "单价", "Precio unitario"),
    any: [
      { css: ".grid-cell.col-unitprice" },
      { css: "[class*='unit-price' i]" },
    ],
  },
  "cart.extended": {
    title: T("Extended price", "小计", "Precio total"),
    any: [
      { css: ".grid-cell.col-ext" },
      { css: "[class*='ext-price' i]" },
    ],
  },
  "cart.row": { title: T("The part's cart line", "该型号的购物车行", "La línea de la pieza"), ...CART_ROW },
  "cart.remove": {
    title: T("Delete", "删除", "Eliminar"),
    within: CART_ROW,
    any: [
      { css: "button.carttable-icon" },
      { css: "[data-testid*='Delete' i], [id*='Delete' i]" },
      { role: "button", name: /^(delete|remove)\b/i },
      { role: "link", name: /^(delete|remove)\b/i },
    ],
  },
  "cart.removeConfirm": {
    title: T("Confirm", "确认", "Confirmar"),
    any: [{ css: "[data-testid='DeleteCartItemConfirmButton']" }, { role: "button", name: /^confirm$/i }],
  },
  /* (2026-11-20, live) "New Cart" above the cart table (`button#newCart`)
   * opens #CreateNewCartModal: "Create New Cart" starts an empty cart. Signed
   * out, Mouser says the current items are deleted (signed in it can save
   * them to the account first); that cart is the Buy lab's own Mouser
   * profile's. A purchase starts from a cart of its own, so lines left from
   * an earlier run are never ordered with it. */
  /* (2026-11-20, live) Mouser's pages carry a holiday notice, "Any order
   * received after the close of business on Wednesday…", which the common
   * words ("order received") took for an order confirmation: the cart was
   * recognised as a placed order. Only the buyer's own order counts here. */
  "order.confirmation": {
    title: T("Order confirmation", "订单确认", "Confirmación del pedido"),
    any: [{ text: /thank you for your order|your order (number )?(has been |was |is )?(placed|submitted|received)/i }],
  },
  /* (2026-11-20, live) OneTrust's banner ("Cookie Settings" / "Accept
   * Cookies"), with a dark backdrop over the whole page, can appear a while
   * after the cart has opened and covers Checkout. The settings panel offers
   * "Reject All": the fewest cookies, and the page is free. */
  "cookies.settings": {
    title: T("Cookie settings", "Cookie 设置", "Configuración de cookies"),
    any: [{ css: "#onetrust-pc-btn-handler" }],
  },
  "cookies.reject": {
    title: T("Reject cookies", "拒绝 Cookie", "Rechazar cookies"),
    any: [{ css: "#onetrust-pc-sdk button.ot-pc-refuse-all-handler" }, { css: "#onetrust-reject-all-handler" }],
  },
  "cookies.saveChoices": {
    title: T("Confirm my choices", "确认我的选择", "Confirmar mis opciones"),
    any: [{ css: "#onetrust-pc-sdk button.save-preference-btn-handler" }],
  },
  "cookies.backdrop": {
    title: T("Cookie banner backdrop", "Cookie 横幅遮罩", "Fondo del aviso de cookies"),
    any: [{ css: ".onetrust-pc-dark-filter" }],
  },
  "cart.newCart": {
    title: T("New Cart", "新建购物车", "Carrito nuevo"),
    any: [{ css: "button#newCart" }, { role: "button", name: /^new cart$/i }],
  },
  "cart.newCartDialog": {
    title: T("Create New Cart dialog", "新建购物车对话框", "Diálogo de carrito nuevo"),
    any: [{ css: "#CreateNewCartModal .modal-body" }],
  },
  "cart.newCartCreate": {
    title: T("Create New Cart", "新建购物车", "Crear carrito nuevo"),
    within: { any: [{ css: "#CreateNewCartModal" }] },
    any: [{ css: "button.m-btn-primary" }, { role: "button", name: /^create new cart$/i }],
  },
  // Not signed in, the cart offers "Guest Checkout" and this link instead of
  // Checkout (2026-11-23): the order goes on from the person's own account.
  // Tracking from the order history itself (2026-11-23): Mouser puts each
  // order's status and tracking numbers in its row; its order page has none.
  "track.orderRow": {
    title: T("The order's row", "该订单那一行", "La fila del pedido"),
    any: [{ css: "table tbody tr" }],
    hasText: "{{order}}",
  },
  "track.rowStatus": {
    title: T("Order status", "订单状态", "Estado del pedido"),
    any: [{ css: "td:nth-child(6)" }],
  },
  "track.rowTracking": {
    title: T("Tracking number", "物流单号", "Número de seguimiento"),
    any: [{ css: "td:nth-child(10) a" }],
  },
  "cart.signIn": {
    title: T("Log in to your account", "登录你的账户", "Inicia sesión en tu cuenta"),
    any: [{ role: "link", name: /^log ?in to your account$/i }, { css: "a[href*='MouserLogin' i]" }],
  },
  // Checkout's address form (2026-11-23, live: "Addresses", Billing
  // Information): the same fields every supplier gets, found by their labels.
  "addr.form": {
    title: T("Address form", "地址表单", "Formulario de dirección"),
    any: [{ role: "textbox", name: /^address line 1/i }],
  },
  "addr.firstName": {
    title: T("First name", "名", "Nombre"),
    any: [{ role: "textbox", name: /^first name/i }],
  },
  "addr.lastName": {
    title: T("Last name", "姓", "Apellido"),
    any: [{ role: "textbox", name: /^last name/i }],
  },
  "addr.phone": {
    title: T("Phone", "电话", "Teléfono"),
    any: [{ role: "textbox", name: /^phone/i }],
  },
  "addr.company": {
    title: T("Company name", "公司名称", "Empresa"),
    any: [{ role: "textbox", name: /^company name/i }],
  },
  "addr.line1": {
    title: T("Address line 1", "地址第 1 行", "Dirección, línea 1"),
    any: [{ role: "textbox", name: /^address line 1/i }],
  },
  "addr.line2": {
    title: T("Address line 2", "地址第 2 行", "Dirección, línea 2"),
    any: [{ role: "textbox", name: /^address line 2/i }],
  },
  "addr.city": {
    title: T("City", "城市", "Ciudad"),
    any: [{ role: "textbox", name: /^city/i }],
  },
  "addr.zip": {
    title: T("Postal code", "邮编", "Código postal"),
    any: [{ role: "textbox", name: /^(postal|zip) code/i }],
  },
  // "Copy these details to my shipping information? Yes / No" (required).
  "addr.copyToShipping": {
    title: T("Ship to this address too", "收货地址同上", "Enviar también a esta dirección"),
    any: [{ role: "radio", name: /^yes$/i }],
  },
  // Shipping Information's "Address Type" (required once copied): Business
  // for a ship-to with a company, Residential otherwise.
  "addr.addressType": {
    title: T("Address type", "地址类型", "Tipo de dirección"),
    any: [{ role: "combobox", name: /^address type/i }],
  },
  "addr.state": {
    title: T("State", "州", "Estado"),
    any: [{ role: "combobox", name: /^state/i }],
  },
  "cart.notice": {
    title: T("Continue Checkout", "继续结账", "Continuar con el pago"),
    any: [{ css: "#btnSaveNContinue" }],
  },
  "account.signedIn": {
    title: T("Signed in", "已登录", "Sesión iniciada"),
    any: [
      { role: "link", name: /^(log ?out|sign out)$/i },
      { css: "a[href*='logout' i]" },
    ],
  },
  /* The Price & Availability Assistant: paste a list, check availability,
   * select all and buy. Its buttons sit under a sticky header, so the steps
   * use the page's own click (js). */
  "paa.open": {
    title: T("Copy & paste a list", "粘贴清单", "Pegar una lista"),
    any: [{ role: "button", name: /copy ?& ?paste/i }],
  },
  "paa.text": {
    title: T("Parts and quantities", "型号和数量", "Piezas y cantidades"),
    any: [{ css: "#CopyPasteTextInput" }],
  },
  "paa.check": {
    title: T("Check availability", "检查库存", "Comprobar disponibilidad"),
    any: [{ css: "#ImportMyData" }],
  },
  "paa.selectAll": {
    title: T("Select all", "全选", "Seleccionar todo"),
    any: [{ role: "button", name: /^select all$/i }],
  },
  "paa.buy": {
    title: T("Buy the selected items", "购买所选", "Comprar los seleccionados"),
    any: [{ css: "#btnBuySelectedItemsTop" }],
  },
};

const STATES = {
  challenge: { title: T("Security check", "安全验证", "Verificación de seguridad"), match: [{ all: ["challenge"] }, { all: ["challenge.page"] }], person: "challenge", quiet: true },
  signIn: { title: T("Sign in", "登录", "Inicio de sesión"), match: { all: ["account.signInForm"] }, person: "sign_in" },
  // Never the cart: its holiday banner says "Any order received after…".
  confirmation: {
    title: T("Order placed", "下单成功", "Pedido hecho"),
    match: { url: /^(?!.*\/cart\/?(\?|#|$))/i, all: ["order.confirmation"] },
    enter: [{ do: "read", target: "order.number", as: "orderNumber", optional: true, timeout: 3000 }],
  },
  review: {
    title: T("Review order", "确认订单", "Revisar el pedido"),
    match: { all: ["review.submit"] },
    enter: [{ do: "read", target: "review.total", as: "total", optional: true, timeout: 3000 }],
  },
  // The address form comes first: its page is headed Billing Information too.
  addresses: { title: T("Addresses", "地址", "Direcciones"), match: { url: /checkout/i, all: ["addr.form"] }, stuck: "checkout_details" },
  payment: { title: T("Payment", "付款", "Pago"), match: { url: /checkout/i, all: ["checkout.paymentPage"] }, stuck: "checkout_details" },
  shipping: { title: T("Shipping", "收货地址", "Envío"), match: { url: /checkout/i, all: ["checkout.shippingPage"] }, stuck: "checkout_details" },
  checkoutStep: { title: T("Checkout", "结账", "Pago"), match: { url: /checkout/i, all: ["checkout.continue"] }, stuck: "checkout_details" },
  // The cart's "Continue Checkout" window (a notice about the order) before checkout goes on.
  cartNotice: { title: T("Cart notice", "购物车提示", "Aviso del carrito"), match: { url: /\/cart/i, all: ["cart.notice"] } },
  cart: { title: T("Cart", "购物车", "Carrito"), match: { url: /\/cart\/?(\?|$)/i } },
  orderDetail: { title: T("Order", "订单详情", "Pedido"), match: { url: /\/account\/orders\/[^?]*\d{5,}/i } },
  orders: { title: T("Orders", "订单记录", "Pedidos"), match: [{ url: /\/account\/orders\/?(\?|$)/i }, { url: /orderhistory/i }] },
  // Its buy box can load after the rest of the page (2026-11-24): the part's
  // own ProductDetail page counts, and the Buy click waits for the box.
  product: { title: T("Product page", "商品页", "Página del producto"), match: [
    { url: /\/ProductDetail\//i, all: ["product.addToCart", "product.ofPart"] },
    { url: /\/ProductDetail\//i, all: ["product.ofPart"] },
  ] },
  results: { title: T("Search results", "搜索结果", "Resultados"), match: { url: /\/c\//i, all: ["results.exact"] } },
};

const TRANSITIONS = [
  {
    name: "search",
    title: T("Search for the part", "搜索型号", "Buscar la pieza"),
    from: "*",
    to: ["product", "results", "challenge"],
    steps: [{ do: "goto", url: "{{search}}" }, { do: "click", target: "cookies.accept", optional: true, timeout: 2500 }],
  },
  {
    name: "openExact",
    title: T("Open the part", "打开该型号", "Abrir la pieza"),
    from: ["results"],
    to: ["product"],
    steps: [{ do: "click", target: "results.exact", navigates: true }],
  },
  {
    name: "goCart",
    title: T("Open the cart", "打开购物车", "Abrir el carrito"),
    from: "*",
    to: ["cart", "challenge"],
    steps: [{ do: "goto", url: "{{cart}}" }, { do: "click", target: "cookies.accept", optional: true, timeout: 2500 }],
  },
  {
    name: "goOrders",
    title: T("Open the orders", "打开订单记录", "Abrir los pedidos"),
    from: "*",
    to: ["orders", "signIn", "challenge"],
    steps: [{ do: "goto", url: "{{orders}}" }],
  },
  {
    name: "checkout",
    title: T("Check out", "结账", "Pagar"),
    from: ["cart"],
    to: ["cartNotice", "signIn", "addresses", "shipping", "payment", "checkoutStep", "review"],
    steps: [
      // The cookie banner can come up after the cart opened and cover
      // Checkout: its settings, then "Reject All" (or the default choices).
      { do: "click", target: "cookies.settings", when: "cookies.settings", whenTimeout: 1500 },
      { do: "click", target: "cookies.reject", optional: true, timeout: 3000 },
      { do: "click", target: "cookies.saveChoices", optional: true, timeout: 1500 },
      { do: "waitForHidden", target: "cookies.backdrop", optional: true, timeout: 5000 },
      // Signed out there is no Checkout, only Guest Checkout: sign in first (the
      // person's), and the walk comes back to Checkout from the account.
      { do: "click", target: "cart.signIn", when: "cart.signIn", whenTimeout: 2500, navigates: true },
      { do: "click", target: "checkout.start", when: "checkout.start", whenTimeout: 5000, navigates: true },
    ],
  },
  {
    name: "continueNotice",
    title: T("Continue Checkout", "继续结账", "Continuar con el pago"),
    from: ["cartNotice"],
    to: ["signIn", "addresses", "shipping", "payment", "checkoutStep", "review"],
    steps: [{ do: "click", target: "cart.notice", navigates: true }],
  },
  {
    name: "continue",
    title: T("Continue", "继续", "Continuar"),
    from: ["addresses", "shipping", "payment", "checkoutStep"],
    to: ["addresses", "shipping", "payment", "checkoutStep", "review", "signIn"],
    steps: [{ do: "click", target: "checkout.continue", navigates: true }],
  },
  {
    /* The BOM's ship-to into the address form (billing; Mouser ships there
     * unless told otherwise), then Continue. Only when an operation names it. */
    name: "fillAddress",
    title: T("Fill in the saved address", "填写保存的地址", "Rellenar la dirección guardada"),
    auto: false,
    from: ["addresses"],
    to: ["addresses", "shipping", "payment", "checkoutStep", "review"],
    steps: [
      { do: "fill", target: "addr.firstName", value: "{{firstName}}" },
      { do: "fill", target: "addr.lastName", value: "{{lastName}}" },
      { do: "fill", target: "addr.phone", value: "{{phoneDigits}}" },
      { do: "fill", target: "addr.company", value: "{{company}}", optional: true, timeout: 2000 },
      { do: "fill", target: "addr.line1", value: "{{line1}}" },
      { do: "fill", target: "addr.line2", value: "{{line2}}", optional: true, timeout: 2000 },
      { do: "fill", target: "addr.city", value: "{{city}}" },
      { do: "select", target: "addr.state", option: "{{stateName}}" },
      { do: "fill", target: "addr.zip", value: "{{zip}}" },
      { do: "click", target: "addr.copyToShipping", when: "addr.copyToShipping", whenTimeout: 2000 },
      // "Yes" rebuilds the Shipping Information section: wait for it to settle.
      { do: "wait", ms: 2500 },
      { do: "waitFor", target: "addr.addressType", optional: true, timeout: 10000 },
      { do: "select", target: "addr.addressType", option: /^(business|commercial)/i, when: "addr.addressType", whenTimeout: 3000 },
      { do: "click", target: "checkout.continue", navigates: true },
    ],
  },
  {
    name: "submitOrder",
    title: T("Submit the order", "提交订单", "Enviar el pedido"),
    from: ["review"],
    to: ["confirmation"],
    confirm: { message: "place_order", show: "total" },
    steps: [{ do: "click", target: "review.submit", navigates: true }],
  },
  {
    name: "addToCart",
    title: T("Add to cart", "加入购物车", "Añadir al carrito"),
    auto: false,
    from: ["product"],
    // Mouser goes to the cart after a Buy (2026-11-24): that is an add too.
    // The cart is read afterwards either way, so the count is not waited for.
    to: ["product", "cart"],
    steps: [
      { do: "peek", target: "cart.count", as: "cartBefore" },
      { do: "fill", target: "product.quantity", value: "{{quantity}}" },
      { do: "click", target: "product.addToCart", timeout: 20000 },
      { do: "waitForChange", target: "cart.count", from: "cartBefore", or: "cart.added", optional: true, timeout: 10000 },
    ],
  },
  {
    name: "removeLine",
    title: T("Remove the line", "删除这一行", "Quitar la línea"),
    auto: false,
    from: ["cart"],
    to: ["cart"],
    steps: [
      { do: "click", target: "cart.remove" },
      { do: "click", target: "cart.removeConfirm", optional: true, timeout: 3000 },
      { do: "waitForHidden", target: "cart.row" },
    ],
  },
  {
    name: "openOrder",
    title: T("Open the order", "打开该订单", "Abrir el pedido"),
    auto: false,
    from: ["orders"],
    to: ["orderDetail"],
    steps: [{ do: "click", target: "orders.open", timeout: 20000, navigates: true }],
  },
];

const CART_FIELDS = {
  part: { target: "cart.part" }, text: { target: "track.self" },
  quantity: { target: "cart.quantity", read: "value" },
  unitPrice: { target: "cart.unitPrice" },
  extended: { target: "cart.extended" },
};

module.exports = {
  id: "mouser",
  name: "Mouser",
  verified: false,
  hosts: ["*.mouser.com"],
  urls: {
    home: "https://www.mouser.com/",
    search: "https://www.mouser.com/c/?q={{part|url}}",
    cart: "https://www.mouser.com/Cart/",
    signIn: "https://www.mouser.com/MyAccount/MouserLogin",
    orders: "https://www.mouser.com/account/orders",
  },
  targets: TARGETS,
  machine: { states: STATES, transitions: TRANSITIONS },
  tasks: {
    signIn: [
      { do: "goto", url: "{{signIn}}" },
      { do: "handoff", message: "sign_in", until: "account.signedIn" },
    ],
    bulkAddPaa: [
      // A cart with lines in it is replaced by a new one first: only this
      // purchase's list is in the cart that is checked out.
      { do: "goto", url: "https://www.mouser.com/Cart/" },
      { do: "click", target: "cookies.accept", optional: true, timeout: 2500 },
      { do: "click", target: "cart.newCart", when: "cart.rows", whenTimeout: 5000 },
      { do: "click", target: "cart.newCartCreate", when: "cart.newCartDialog", whenTimeout: 5000 },
      { do: "waitForHidden", target: "cart.rows", optional: true, timeout: 20000 },
      { do: "goto", url: "https://www.mouser.com/price-availability/" },
      { do: "wait", ms: 4000 },
      { do: "fill", target: "paa.text", value: "{{lines}}", js: true },
      { do: "click", target: "paa.check", js: true },
      { do: "waitForUrl", pattern: /price-availability\/Edit/ },
      { do: "wait", ms: 2000 },
      { do: "click", target: "paa.selectAll", js: true },
      // Buy turns on a moment after the rows are ticked (2026-11-24: it was
      // still off when clicked).
      { do: "wait", ms: 3000 },
      { do: "click", target: "paa.buy", js: true, timeout: 15000 },
      { do: "waitForUrl", pattern: /\/cart/ },
    ],
    addToCart: [{ do: "walk", to: "product" }, { do: "act", name: "addToCart" }],
    openCart: [
      { do: "walk", to: "cart" },
      { do: "extract", target: "cart.rows", fields: CART_FIELDS, as: "cart", optional: true, timeout: 5000 },
    ],
    removeFromCart: [{ do: "walk", to: "cart" }, { do: "act", name: "removeLine" }],
    setPack: [
      { do: "walk", to: "cart" },
      { do: "click", target: "cart.packLink", timeout: 10000 },
      { do: "wait", ms: 1500 },
      { do: "click", target: "cart.packChoice", timeout: 5000 },
      { do: "click", target: "cart.packSubmit", timeout: 5000 },
      { do: "wait", ms: 6000 },
    ],
    checkout: [{ do: "walk", to: "cart" }, { do: "walk", to: "review" }],
    placeOrder: [{ do: "walk", to: "cart" }, { do: "walk", to: "confirmation" }],
    // The same with the BOM's ship-to: filled into the address form when it comes.
    placeOrderWithAddress: [
      { do: "walk", to: "cart" },
      { do: "walk", to: ["addresses", "review", "confirmation"] },
      { do: "act", name: "fillAddress", when: "addr.form" },
      { do: "walk", to: "confirmation" },
    ],
    orders: [
      { do: "walk", to: "orders" },
      {
        do: "extract",
        target: "orders.rows",
        fields: {
          number: { target: "orders.number" },
          date: { target: "orders.date" },
          status: { target: "orders.status" },
          total: { target: "orders.total" },
        },
        as: "orders",
        timeout: 20000,
      },
    ],
    track: [
      { do: "walk", to: "orders" },
      {
        do: "extract",
        target: "track.orderRow",
        fields: {
          status: { target: "track.rowStatus" },
          number: { target: "track.rowTracking" },
          link: { target: "track.rowTracking", read: "href" },
        },
        as: "rows",
        optional: true,
        timeout: 20000,
      },
    ],
  },
  taskParams: { bulkAddPaa: ["lines"], removeFromCart: ["part"], setPack: ["part", "pack"], checkout: [], placeOrder: [], placeOrderWithAddress: ["firstName", "lastName", "phoneDigits", "company", "line1", "line2", "city", "stateName", "zip"], orders: [], track: ["order"] },
  taskDefaults: {
    addToCart: { part: "GRM155R71C104KA88D", quantity: "10" },
    removeFromCart: { part: "GRM155R71C104KA88D" },
  },
};
