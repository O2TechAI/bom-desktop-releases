"use strict";

/* DigiKey (www.digikey.com): every operation the supplier window shows for it.
 *
 * Where the selectors come from (2026-11-16):
 * - Product page, header and cart page: DigiKey's own markup, read from
 *   archived copies of the live pages (the build server is turned away by
 *   DigiKey). Quantity is `#quantity-input`, Add to Cart is
 *   `#add-to-cart-btn-price-procurement`, the header cart count is
 *   `.toggle--cart-total`, the cart is the `#cartDetails` table with
 *   `detailRow_*` cells, and order history is /OrderHistory/List.
 * - Checkout, review, order history rows and shipments need a signed-in
 *   account, so no copy exists. Those targets read the page the way a person
 *   does (button words, column titles) and a step that can't find its way
 *   hands over to the person instead of guessing.
 *
 * Nothing here types a password or card number: signing in and choosing how
 * to pay are the person's, and "Place order" waits for their yes in the
 * panel. Use "Save page map" on a page whose targets miss and send the file
 * back to tighten them. `verified` stays false until a run on the real site
 * has gone end to end.
 *
 * The security check (Cloudflare) is the person's to finish, never the app's
 * to get around. What the app does instead is meet it less often: a run that
 * goes to the cart or the order history opens the shop's home page first
 * (`warmup`), leaves a gap between addresses, and settles after a check.
 * Each run counts the checks it met (runner.js metrics) and the window logs
 * them, so "does this help?" is measured, not guessed. */

const { T } = require("./common");

const CART_ROW = { any: [{ css: "#cartDetails tbody tr" }, { role: "row" }], hasText: "{{part}}" };

const TARGETS = {
  "search.input": {
    title: T("Search box", "搜索框", "Cuadro de búsqueda"),
    any: [
      { css: "input[name='keywords'].header__searchinput, input[name='keywords'][type='search']" },
      { placeholder: /keyword or part/i },
      { role: "searchbox" },
    ],
  },
  "results.exact": {
    title: T("The exact part", "完全匹配的型号", "La pieza exacta"),
    any: [
      { css: "a[href*='/products/detail/']" },
      { role: "link", name: "{{part}}" },
    ],
    hasText: "{{part}}",
  },
  "product.quantity": {
    title: T("Quantity", "数量", "Cantidad"),
    any: [
      { css: "#quantity-input, [data-testid='quantity-input'] input" },
      { label: /^(qty|quantity|enter quantity)/i },
      { placeholder: /^(qty|quantity)/i },
    ],
  },
  "product.addToCart": {
    title: T("Add to cart", "加入购物车", "Añadir al carrito"),
    any: [
      // The buy box renders a `add-to-cart-btn-loading` placeholder first; it
      // looks and reads like the button but does nothing. Wait for the real
      // one, which DigiKey names `add-to-cart-btn`.
      { css: "#add-to-cart-btn-price-procurement, button[data-testid='add-to-cart-btn']" },
    ],
  },
  "cart.count": {
    title: T("Cart count", "购物车数量", "Cantidad en el carrito"),
    any: [{ css: ".toggle--cart-total" }, { css: "a[href*='shoppingcart' i] [class*='count' i]" }],
  },
  "cart.rows": {
    title: T("Cart lines", "购物车明细", "Líneas del carrito"),
    any: [{ css: "#cartDetails tbody tr" }, { css: "table tbody tr" }],
    hasText: /\d/,
  },
  "cart.part": {
    title: T("Part number", "型号", "Número de pieza"),
    any: [{ css: "[class*='detailRow_productDetails'] a, [class*='productDetails' i] a" }, { css: "a" }],
  },
  "cart.quantity": {
    title: T("Quantity", "数量", "Cantidad"),
    any: [{ css: "[class*='detailRow_quantity'] input, input[name*='quantity' i]" }, { css: "input[inputmode='numeric']" }],
  },
  "cart.unitPrice": {
    title: T("Unit price", "单价", "Precio unitario"),
    any: [{ css: "[class*='detailRow_unitPrice']" }],
  },
  "cart.extended": {
    title: T("Extended price", "小计", "Precio total"),
    any: [{ css: "[class*='detailRow_extendedPrice']" }],
  },
  "cart.row": {
    title: T("The part's cart line", "该型号的购物车行", "La línea de la pieza"),
    ...CART_ROW,
  },
  "cart.remove": {
    title: T("Remove", "删除", "Eliminar"),
    within: CART_ROW,
    any: [
      { role: "button", name: /^(remove|delete)\b/i },
      { role: "link", name: /^(remove|delete)\b/i },
      { css: "button[class*='delete' i], a[class*='delete' i], [class*='trash' i], button[class*='remove' i], a[class*='remove' i]" },
    ],
  },
  "cart.removeConfirm": {
    title: T("Remove from cart", "从购物车删除", "Quitar del carrito"),
    any: [{ role: "button", name: /^(remove from cart|delete)$/i }],
  },
  /* The cart page's own ways in (2026-11-16, from the live page's map):
   * manual entry and the Bulk Add list. Neither goes through the search
   * page, the one address DigiKey guards with a security check. */
  "cart.bulkText": {
    title: T("Bulk Add list", "Bulk Add 列表", "Lista de Bulk Add"),
    any: [
      { css: "textarea#textImportTextArea" },
      { placeholder: /one product per line/i },
    ],
  },
  "cart.bulkAdd": {
    title: T("Add the list to the cart", "把列表加进购物车", "Añadir la lista al carrito"),
    any: [{ css: "input#btnImportParts, button#btnImportParts" }],
  },
  "cart.empty": {
    title: T("Empty cart", "空购物车", "Carrito vacío"),
    any: [{ role: "heading", name: /your (shopping )?cart is empty/i }],
  },
  /* From the live cart page (2026-11-16): Checkout is the visible
   * `span#primaryButtonRight` inside `#divPrimaryButton`; the
   * `a.cartcheckout` link is a hidden alternate layout. */
  "checkout.start": {
    title: T("Checkout", "结账", "Pagar"),
    any: [
      { css: "#primaryButtonRight, #divPrimaryButton .dk-btn__primary" },
      { css: "a.cartcheckout:not(.hidden)" },
      { role: "button", name: /^(proceed to )?check ?out$/i },
      { role: "link", name: /^(proceed to )?check ?out$/i },
    ],
  },
  "cart.bulkError": {
    title: T("Items not added", "没能加入的商品", "Artículos no añadidos"),
    any: [{ text: /were not added to your order|no se (añadieron|agregaron)/i }],
  },
  "account.signedIn": {
    title: T("Signed in", "已登录", "Sesión iniciada"),
    any: [
      { css: "#my_digikey_logged_in:not(.hidden)" },
      { role: "link", name: /^(sign out|log ?out)$/i },
    ],
  },
  "orders.rows": {
    title: T("Orders", "订单", "Pedidos"),
    any: [{ css: "tr.mud-table-row" }, { css: "table tbody tr" }, { role: "row" }],
    hasText: /\d{6,}/,
  },
  "product.ofPart": {
    title: T("The part's page", "该型号的页面", "La página de la pieza"),
    any: [{ css: "[data-testid='mfr-number'], [data-testid='product-overview'] h1" }, { css: "h1" }],
    hasText: "{{part}}",
  },
};

/* DigiKey's pages as states, most telling first. */
const STATES = {
  challenge: { title: T("Security check", "安全验证", "Verificación de seguridad"), match: [{ all: ["challenge"] }, { all: ["challenge.page"] }], person: "challenge", quiet: true },
  signIn: { title: T("Sign in", "登录", "Inicio de sesión"), match: { all: ["account.signInForm"] }, person: "sign_in" },
  confirmation: {
    title: T("Order placed", "下单成功", "Pedido hecho"),
    match: { all: ["order.confirmation"] },
    enter: [{ do: "read", target: "order.number", as: "orderNumber", optional: true, timeout: 3000 }],
  },
  review: {
    title: T("Review order", "确认订单", "Revisar el pedido"),
    match: { all: ["review.submit"] },
    enter: [{ do: "read", target: "review.total", as: "total", optional: true, timeout: 3000 }],
  },
  shipping: {
    title: T("Shipping", "收货地址", "Envío"),
    // The real page is /ordering/Address (no "checkout" in the address), and a
    // guest checkout uses /ordering/guest/Address. The address and how to pay
    // are the person's: the run waits here instead of guessing at a form.
    match: [
      { url: /\/ordering\/(guest\/)?address/i },
      { url: /checkout/i, all: ["checkout.shippingPage"] },
    ],
    person: "checkout_details",
  },
  payment: {
    title: T("Payment", "付款", "Pago"),
    match: [{ url: /\/ordering\/payment/i }, { url: /checkout/i, all: ["checkout.paymentPage"] }],
    person: "checkout_details",
  },
  checkoutStep: {
    title: T("Checkout", "结账", "Pago"),
    match: [{ url: /checkout/i, all: ["checkout.continue"] }],
    stuck: "checkout_details",
  },
  cart: { title: T("Cart", "购物车", "Carrito"), match: { url: /\/ordering\/shoppingcart/i } },
  orderDetail: { title: T("Order", "订单详情", "Pedido"), match: { url: /\/orderhistory\/(?!list)[^?]*\d{5,}/i } },
  orders: { title: T("Orders", "订单记录", "Pedidos"), match: [{ url: /\/orderhistory\/list/i }, { url: /orderhistory/i, all: ["orders.rows"] }] },
  product: { title: T("Product page", "商品页", "Página del producto"), match: { all: ["product.addToCart", "product.ofPart"] } },
  results: { title: T("Search results", "搜索结果", "Resultados"), match: { url: /\/products\/result/i, all: ["results.exact"] } },
};

/* Every click or address that moves between them. */
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
    // The cart is where a cold session is asked to prove itself: the shop's
    // home page first gives it the cookies (and the consent banner) a person
    // would have before going to the cart.
    steps: [
      { do: "warmup" },
      { do: "goto", url: "{{cart}}" },
      { do: "click", target: "cookies.accept", optional: true, timeout: 2500 },
    ],
  },
  {
    name: "goOrders",
    title: T("Open the orders", "打开订单记录", "Abrir los pedidos"),
    from: "*",
    to: ["orders", "signIn", "challenge"],
    steps: [{ do: "warmup" }, { do: "goto", url: "{{orders}}" }],
  },
  {
    name: "checkout",
    title: T("Check out", "结账", "Pagar"),
    from: ["cart"],
    to: ["signIn", "shipping", "payment", "checkoutStep", "review"],
    steps: [{ do: "click", target: "checkout.start", navigates: true }],
  },
  {
    name: "continue",
    title: T("Continue", "继续", "Continuar"),
    from: ["shipping", "payment", "checkoutStep"],
    to: ["shipping", "payment", "checkoutStep", "review", "signIn"],
    steps: [{ do: "click", target: "checkout.continue", navigates: true }],
  },
  {
    name: "submitOrder",
    title: T("Submit the order", "提交订单", "Enviar el pedido"),
    from: ["review"],
    to: ["confirmation"],
    confirm: { message: "place_order", show: "total" },
    steps: [{ do: "click", target: "review.submit", navigates: true }],
  },
  // Only when an operation names them: they change the cart or open one order.
  {
    name: "addToCart",
    title: T("Add to cart", "加入购物车", "Añadir al carrito"),
    auto: false,
    from: ["product"],
    to: ["product"],
    steps: [
      { do: "peek", target: "cart.count", as: "cartBefore" },
      { do: "fill", target: "product.quantity", value: "{{quantity}}" },
      { do: "click", target: "product.addToCart" },
      { do: "waitForChange", target: "cart.count", from: "cartBefore", or: "cart.added" },
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
    /* One line per part, quantity first: the page's own example is
     * "(5, P4525-ND, ABC123)". Stays on the cart page, so the search page
     * and its security check are never opened. */
    name: "bulkAddToCart",
    title: T("Add from the bulk list", "按 Bulk 列表加购", "Añadir desde la lista"),
    auto: false,
    from: ["cart"],
    to: ["cart"],
    steps: [
      { do: "fill", target: "cart.bulkText", value: "{{quantity}}, {{part}}" },
      { do: "click", target: "cart.bulkAdd" },
      { do: "wait", ms: 2500 },
      // A part sold in several packagings (cut tape, reel) comes back as an
      // item that wasn't added, with "View Options": which packaging is a
      // buying decision, so the person makes it and the run carries on.
      { do: "handoff", message: "bulk_error", when: "cart.bulkError", untilGone: "cart.bulkError" },
      { do: "waitForHidden", target: "cart.empty", timeout: 20000 },
      { do: "waitFor", target: "cart.rows", timeout: 20000 },
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

module.exports = {
  id: "digikey",
  name: "DigiKey",
  verified: false,
  hosts: ["*.digikey.com"],
  urls: {
    home: "https://www.digikey.com/",
    search: "https://www.digikey.com/en/products/result?keywords={{part|url}}",
    cart: "https://www.digikey.com/ordering/shoppingcart",
    signIn: "https://www.digikey.com/MyDigiKey/Login",
    orders: "https://www.digikey.com/OrderHistory/List",
  },
  targets: TARGETS,
  machine: { states: STATES, transitions: TRANSITIONS },
  /* Each operation is a walk to a page, plus what to do or read there. */
  tasks: {
    signIn: [
      { do: "warmup" },
      { do: "goto", url: "{{signIn}}" },
      { do: "handoff", message: "sign_in", until: "account.signedIn" },
    ],
    addToCart: [
      { do: "walk", to: "product" },
      { do: "act", name: "addToCart" },
    ],
    // The same, without the search page: everything happens in the cart.
    bulkAdd: [
      { do: "walk", to: "cart" },
      { do: "act", name: "bulkAddToCart" },
    ],
    openCart: [
      { do: "walk", to: "cart" },
      {
        do: "extract",
        target: "cart.rows",
        fields: {
          part: { target: "cart.part" },
          quantity: { target: "cart.quantity", read: "value" },
          unitPrice: { target: "cart.unitPrice" },
          extended: { target: "cart.extended" },
        },
        as: "cart",
        optional: true,
        timeout: 5000,
      },
    ],
    removeFromCart: [
      { do: "walk", to: "cart" },
      { do: "act", name: "removeLine" },
    ],
    checkout: [
      { do: "walk", to: "cart" },
      { do: "walk", to: "review" },
    ],
    // From the cart, so an order placed earlier is never taken for this one.
    placeOrder: [
      { do: "walk", to: "cart" },
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
        // An account with no orders says "No results found": no rows is
        // an answer, not a failure.
        optional: true,
        timeout: 20000,
      },
    ],
    track: [
      { do: "walk", to: "orders" },
      { do: "act", name: "openOrder" },
      { do: "read", target: "track.status", as: "status", optional: true, timeout: 8000 },
      {
        do: "extract",
        target: "track.shipments",
        fields: { number: { target: "track.self" }, link: { target: "track.self", read: "href" } },
        as: "shipments",
        optional: true,
        timeout: 8000,
      },
    ],
  },
  taskParams: {
    bulkAdd: ["part", "quantity"],
    removeFromCart: ["part"],
    checkout: [],
    placeOrder: [],
    orders: [],
    track: ["order"],
  },
  /* What the panel fills in first: a 0.1 µF 0402 capacitor, cents each. */
  taskDefaults: {
    addToCart: { part: "GRM155R71C104KA88D", quantity: "10" },
    bulkAdd: { part: "GRM155R71C104KA88D", quantity: "10" },
    removeFromCart: { part: "GRM155R71C104KA88D" },
  },
};
