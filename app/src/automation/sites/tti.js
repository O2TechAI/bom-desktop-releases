"use strict";

/* TTI (www.tti.com) as a state machine (machine.js).
 *
 * Read from the live site through the app's own Chrome (2026-11-17): the
 * header search box ("Search by Keyword or Part #") takes an exact part
 * number and redirects straight to the part page; the part page shows
 * "Quantity (Minimum: 10,000 / Multiples: 10,000)" with an "Add To Cart"
 * button and the cart badge in the header; the cart is
 * /content/ttiinc/en/apps/shoppingcart.html; Checkout leads to
 * /content/ttiinc/en/apps/checkout-login.html, which offers Sign In and
 * "Continue without signing in".
 *
 * Quantities are reels: the default task quantity is 10,000 because TTI
 * rejects single-piece quantities, and a task's own quantity still wins.
 * Checkout, shipping, payment and orders need an account (or the guest
 * checkout); `verified` stays false until a signed-in run has gone end to
 * end. */

const { T } = require("./common");

const TARGETS = {
  "search.input": {
    title: T("Search box", "搜索框", "Cuadro de búsqueda"),
    any: [
      { css: "input[placeholder*='Search by Keyword or Part' i], input[aria-label*='Search' i]" },
      { placeholder: /search by keyword or part/i },
      { role: "searchbox" },
    ],
  },
  "results.exact": {
    title: T("The exact part", "完全匹配的型号", "La pieza exacta"),
    any: [
      { css: "a[href*='part-detail'][href*='{{part}}']" },
      { role: "link", name: "{{part}}" },
    ],
    hasText: "{{part}}",
  },
  "cart.rows": {
    title: T("Cart lines", "购物车明细", "Líneas del carrito"),
    any: [{ css: "table tbody tr" }, { css: "[class*='cart' i] tr" }],
    hasText: /\d/,
  },
  "cart.part": {
    title: T("Part number", "型号", "Número de pieza"),
    any: [{ css: "a[href*='part-detail' i]" }, { css: "a" }],
  },
  "cart.quantity": {
    title: T("Quantity", "数量", "Cantidad"),
    any: [{ css: "input[name*='qty' i], input[id*='qty' i]" }, { css: "input[inputmode='numeric']" }],
  },
  "cart.remove": {
    title: T("Remove from cart", "从购物车删除", "Quitar del carrito"),
    any: [
      { role: "button", name: /^(remove|delete|trash)\b/i },
      { css: "button[class*='remove' i], a[class*='remove' i], button[class*='delete' i]" },
    ],
  },
};

/* TTI's pages as states. */
const STATES = {
  challenge: { title: T("Security check", "安全验证", "Verificación de seguridad"), match: [{ all: ["challenge"] }, { all: ["challenge.page"] }], person: "challenge", quiet: true },
  signIn: { title: T("Sign in", "登录", "Inicio de sesión"), match: { all: ["account.signInForm"] }, person: "sign_in" },
  confirmation: { title: T("Order placed", "下单成功", "Pedido hecho"), match: { all: ["order.confirmation"] } },
  review: { title: T("Review order", "确认订单", "Revisar el pedido"), match: { all: ["review.submit"] } },
  shipping: { title: T("Shipping", "收货地址", "Envío"), match: { all: ["checkout.shippingPage"] }, person: "checkout_details" },
  payment: { title: T("Payment", "付款", "Pago"), match: { all: ["checkout.paymentPage"] }, person: "checkout_details" },
  cart: { title: T("Cart", "购物车", "Carrito"), match: { url: /shoppingcart/i } },
  product: { title: T("Product page", "商品页", "Página del producto"), match: { all: ["product.addToCart", "product.quantity"] } },
  results: { title: T("Search results", "搜索结果", "Resultados"), match: { url: /search|part-search/i, all: ["results.exact"] } },
};

const TRANSITIONS = [
  {
    name: "search",
    title: T("Search for the part", "搜索型号", "Buscar la pieza"),
    from: "*",
    to: ["product", "results", "challenge"],
    steps: [
      { do: "goto", url: "{{home}}" },
      { do: "click", target: "cookies.accept", optional: true, timeout: 2500 },
      { do: "fill", target: "search.input", value: "{{part}}" },
      { do: "press", key: "Enter" },
      { do: "wait", ms: 1500 },
      { do: "waitForLoad" },
      { do: "click", target: "cookies.accept", optional: true, timeout: 2500 },
    ],
  },
  {
    name: "openExact",
    title: T("Open the part", "打开该型号", "Abrir la pieza"),
    from: ["results"],
    to: ["product", "challenge"],
    steps: [{ do: "click", target: "results.exact", navigates: true }],
  },
  {
    name: "goCart",
    title: T("Open the cart", "打开购物车", "Abrir el carrito"),
    from: "*",
    to: ["cart", "challenge"],
    steps: [
      { do: "goto", url: "{{cart}}" },
      { do: "click", target: "cookies.accept", optional: true, timeout: 2500 },
    ],
  },
  {
    name: "checkout",
    title: T("Check out", "结账", "Pagar"),
    from: ["cart"],
    to: ["signIn", "shipping", "payment", "review", "challenge"],
    steps: [{ do: "click", target: "checkout.start", navigates: true }, { do: "wait", ms: 1500 }],
  },
  {
    name: "continue",
    title: T("Continue", "继续", "Continuar"),
    from: ["shipping", "payment"],
    to: ["shipping", "payment", "review", "signIn"],
    steps: [{ do: "click", target: "checkout.continue", navigates: true }, { do: "wait", ms: 1200 }],
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
    to: ["product"],
    steps: [
      { do: "peek", target: "cart.count", as: "cartBefore" },
      { do: "fill", target: "product.quantity", value: "{{quantity}}" },
      { do: "click", target: "product.addToCart" },
      { do: "waitForChange", target: "cart.count", from: "cartBefore", or: "cart.added", timeout: 20000 },
    ],
  },
  {
    name: "removeLine",
    title: T("Remove the line", "删除这一行", "Quitar la línea"),
    auto: false,
    from: ["cart"],
    to: ["cart"],
    steps: [{ do: "click", target: "cart.remove" }, { do: "waitForHidden", target: "cart.rows", timeout: 10000 }],
  },
];

module.exports = {
  id: "tti",
  name: "TTI",
  verified: false,
  hosts: ["*.tti.com"],
  urls: {
    home: "https://www.tti.com/",
    search: "https://www.tti.com/",
    cart: "https://www.tti.com/content/ttiinc/en/apps/shoppingcart.html",
    signIn: "https://www.tti.com/content/ttiinc/en/apps/checkout-login.html",
  },
  targets: TARGETS,
  machine: { states: STATES, transitions: TRANSITIONS },
  tasks: {
    addToCart: [{ do: "walk", to: "product" }, { do: "act", name: "addToCart" }],
    openCart: [
      { do: "walk", to: "cart" },
      {
        do: "extract",
        target: "cart.rows",
        fields: { part: { target: "cart.part" }, quantity: { target: "cart.quantity", read: "value" } },
        as: "cart",
        optional: true,
        timeout: 5000,
      },
    ],
    removeFromCart: [{ do: "walk", to: "cart" }, { do: "act", name: "removeLine" }],
    checkout: [{ do: "walk", to: "cart" }, { do: "walk", to: "review" }],
    placeOrder: [{ do: "walk", to: "cart" }, { do: "walk", to: "confirmation" }],
  },
  taskParams: { addToCart: ["part", "quantity"], removeFromCart: ["part"], checkout: [], placeOrder: [] },
  taskDefaults: {
    // TTI sells reels: its page requires a multiple of 10,000.
    addToCart: { part: "RC0402FR-0710KL", quantity: "10000" },
    removeFromCart: { part: "RC0402FR-0710KL" },
  },
};
