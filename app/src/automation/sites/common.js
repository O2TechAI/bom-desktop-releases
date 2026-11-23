"use strict";

/* What every supplier site shares: targets that read the page the way a
 * person does (by role, label and words), and the tasks built from them.
 *
 * A site profile only overrides the targets its DOM needs (a quantity field
 * with no label, an "Add" button inside a results row) and, where its
 * addresses help, the tasks. Strategies are tried in order, so a site's own
 * selector goes first and these words-based ones stay as a fallback when
 * the site changes its markup. */

const T = (en, zh, es) => ({ en, zh, es });

const COMMON_TARGETS = {
  "cookies.accept": {
    title: T("Accept cookies", "接受 Cookie", "Aceptar cookies"),
    any: [
      { css: "#onetrust-accept-btn-handler" },
      { role: "button", name: /^(accept( all)?( cookies)?|allow all( cookies)?|i accept|agree|got it)$/i },
    ],
  },
  "challenge": {
    title: T("Security check", "安全验证", "Verificación de seguridad"),
    any: [
      { css: "#challenge-form, #challenge-stage, #cf-challenge-running, iframe[src*='challenges.cloudflare.com'], iframe[src*='cdn-cgi/challenge']" },
      { css: "#px-captcha, iframe[src*='captcha'], iframe[title*='captcha' i]" },
      { role: "heading", name: /^(performing security verification|verify you are human|just a moment|请稍候|正在验证|安全验证|正在进行安全验证|请验证您是真人|請驗證您是真人|正在進行安全驗證|verificación de seguridad|verifica que eres un ser humano)/i },
    ],
  },
  /* Cloudflare's challenge page in any language: its headings are translated
   * and its ids and classes change on every load, but it always loads the
   * challenge-page script. (Ordinary pages may load Cloudflare's other
   * scripts, never this one.) */
  "challenge.page": {
    title: T("Security check", "安全验证", "Verificación de seguridad"),
    hidden: true,
    any: [
      { css: "script[src*='/cdn-cgi/challenge-platform/'][src*='/orchestrate/chl_page/']" },
    ],
  },
  /* A shop's own refusal (DataDome and friends): a static "Access Denied"
   * page with no field to fill and nothing to click. It is not a challenge;
   * waiting for the person cannot get past it, so a run fails instead. */
  "blocked": {
    title: T("Access denied", "被站点拒绝", "Acceso denegado"),
    hidden: true,
    any: [
      { role: "heading", name: /access to this page has been denied|access denied|请求被拒绝|访问被拒绝/i },
      { text: /access to this page has been denied|because we believe you are using automation tools|请求被拒绝|访问被拒绝/i },
    ],
  },
  "search.input": {
    title: T("Search box", "搜索框", "Cuadro de búsqueda"),
    any: [
      { role: "searchbox" },
      { role: "combobox", name: /search/i },
      { label: /search/i },
      { placeholder: /search|part number|keyword/i },
      { css: "input[type=search]" },
    ],
  },
  "search.submit": {
    title: T("Search button", "搜索按钮", "Botón de búsqueda"),
    any: [{ role: "button", name: /^search( button)?$/i }],
  },
  "product.quantity": {
    title: T("Quantity", "数量", "Cantidad"),
    any: [
      { label: /^(qty|quantity|enter quantity)/i },
      { placeholder: /^(qty|quantity)/i },
      { css: "input[name*=qty i], input[name*=quantity i], input[id*=qty i]" },
    ],
  },
  "product.addToCart": {
    title: T("Add to cart", "加入购物车", "Añadir al carrito"),
    any: [
      { role: "button", name: /^add to (cart|basket)$/i },
      { role: "button", name: /add to (cart|basket)/i },
    ],
  },
  "cart.added": {
    title: T("Added to cart", "已加入购物车", "Añadido al carrito"),
    any: [
      { text: /^(item(s)? )?added to (your )?(cart|basket)|successfully added|added successfully/i },
      { role: "dialog", name: /cart|basket/i },
    ],
  },
  "cart.count": {
    title: T("Cart count", "购物车数量", "Cantidad en el carrito"),
    any: [
      { css: "a[href*='cart' i] [class*='badge' i], a[href*='cart' i] [class*='count' i]" },
      { css: "[class*='cart' i] [class*='badge' i], [class*='cart' i] [class*='count' i]" },
    ],
  },
  "cart.rows": {
    title: T("Cart lines", "购物车明细", "Líneas del carrito"),
    any: [{ css: "table tbody tr" }],
  },
  "cart.part": {
    title: T("Part number", "型号", "Número de pieza"),
    any: [{ css: "a" }],
  },
  "cart.quantity": {
    title: T("Quantity", "数量", "Cantidad"),
    any: [{ css: "input" }],
  },
  // Checkout, orders and tracking: read by words, for every site whose
  // markup for these pages isn't known (they need an account to see).
  "checkout.start": {
    title: T("Checkout", "结账", "Pagar"),
    any: [
      { role: "button", name: /^(proceed to )?check ?out$/i },
      { css: "input[type='submit'][value*='checkout' i], input[type='button'][value*='checkout' i]" },
      { css: "a[href*='checkout' i]:not(.cartcheckout)" },
    ],
  },
  "checkout.continue": {
    title: T("Continue", "继续", "Continuar"),
    any: [
      { role: "button", name: /^(continue|next|save (and|&) continue|continue to (shipping|payment|review)|review (your )?order)$/i },
      { css: "input[type='submit'][value*='continue' i]" },
    ],
  },
  "account.signInForm": {
    title: T("Sign-in form", "登录表单", "Formulario de inicio de sesión"),
    any: [{ css: "input[type='password']" }],
  },
  "review.submit": {
    title: T("Submit order", "提交订单", "Enviar pedido"),
    any: [
      { role: "button", name: /^(submit|place) (your )?order$/i },
      { css: "input[type='submit'][value*='submit order' i], input[type='submit'][value*='place order' i]" },
    ],
  },
  "review.total": {
    title: T("Order total", "订单总额", "Total del pedido"),
    any: [
      { css: "[data-testid*='order-total' i], [id*='orderTotal' i]:not(input), [class*='order-total' i], [class*='grand-total' i]" },
      { text: /^(order |grand )?total:?\s*(usd\s*)?\$\s?[\d,]+\.\d{2}/i },
    ],
  },
  "order.confirmation": {
    title: T("Order confirmation", "订单确认", "Confirmación del pedido"),
    any: [{ text: /thank you for your order|order (has been )?(placed|submitted|received)|order confirmation/i }],
  },
  "order.number": {
    title: T("Order number", "订单号", "Número de pedido"),
    // DigiKey's confirmation names it "SALESORDER ID" (2026-11-23, live).
    any: [{ text: /(web |sales )?order (number|#|no\.?)\s*:?\s*\d{6,}/i }, { text: /sales ?order id\s*:?\s*\d{6,}/i }],
  },
  "orders.number": {
    title: T("Order number", "订单号", "Número de pedido"),
    any: [{ css: "td[data-label*='order' i] a, td[data-label*='order' i]" }, { css: "a" }],
  },
  "orders.date": {
    title: T("Date", "日期", "Fecha"),
    any: [{ css: "td[data-label*='date' i]" }, { css: "td:nth-child(2)" }],
  },
  "orders.status": {
    title: T("Status", "状态", "Estado"),
    any: [{ css: "td[data-label*='status' i]" }, { css: "td:nth-child(3)" }],
  },
  "orders.total": {
    title: T("Total", "总额", "Total"),
    any: [{ css: "td[data-label*='total' i], td[data-label*='amount' i]" }, { css: "td:last-child" }],
  },
  "orders.open": {
    title: T("The order", "该订单", "El pedido"),
    any: [{ role: "link", name: /{{order}}/ }, { text: /{{order}}/ }],
  },
  "track.shipments": {
    title: T("Tracking numbers", "物流单号", "Números de seguimiento"),
    any: [{
      css: "a[href*='ups.com' i], a[href*='fedex.com' i], a[href*='usps.com' i], a[href*='dhl.com' i], a[href*='tracking' i]",
    }],
  },
  "track.self": {
    title: T("Tracking number", "物流单号", "Número de seguimiento"),
    any: [{ css: ":scope" }],
  },
  "track.status": {
    title: T("Order status", "订单状态", "Estado del pedido"),
    any: [
      { css: "[data-label*='status' i], [class*='order-status' i]" },
      { text: /^(shipped|delivered|in transit|partially shipped|processing|open|on hold|cancell?ed)$/i },
    ],
  },
  "checkout.shippingPage": {
    title: T("Shipping", "收货地址", "Envío"),
    any: [{ role: "heading", name: /^(shipping|ship to|shipping (address|information|method)|delivery)\b/i }],
  },
  "checkout.paymentPage": {
    title: T("Payment", "付款", "Pago"),
    any: [{ role: "heading", name: /^(payment|billing|payment (method|information))\b/i }],
  },
  "orders.rows": {
    title: T("Orders", "订单", "Pedidos"),
    any: [{ css: "table tbody tr" }, { role: "row" }],
    hasText: /\d{6,}/,
  },
  "account.signedIn": {
    title: T("Signed in", "已登录", "Sesión iniciada"),
    any: [
      { role: "link", name: /^(sign out|log ?out)$/i },
      { role: "button", name: /^(sign out|log ?out)$/i },
    ],
  },
};


/* Tasks every supplier can run. `{{home}}`, `{{search}}`, `{{cart}}` and
 * `{{signIn}}` are the site's addresses; `{{part}}` and `{{quantity}}` come
 * from the person. */
const COMMON_TASKS = {
  addToCart: [
    { do: "goto", url: "{{search}}" },
    { do: "handoff", message: "challenge", when: "challenge", until: "search.input" },
    { do: "click", target: "cookies.accept", optional: true, timeout: 2500 },
    { do: "peek", target: "cart.count", as: "cartBefore" },
    { do: "fill", target: "product.quantity", value: "{{quantity}}" },
    { do: "click", target: "product.addToCart" },
    { do: "waitForChange", target: "cart.count", from: "cartBefore", or: "cart.added" },
  ],
  openCart: [
    { do: "goto", url: "{{cart}}" },
    { do: "handoff", message: "challenge", when: "challenge", until: "cart.rows" },
    { do: "click", target: "cookies.accept", optional: true, timeout: 2500 },
    { do: "extract", target: "cart.rows", fields: { part: { target: "cart.part" }, quantity: { target: "cart.quantity", read: "value" } }, as: "cart", optional: true },
  ],
  signIn: [
    { do: "goto", url: "{{signIn}}" },
    { do: "handoff", message: "sign_in", until: "account.signedIn" },
  ],
  /* Everything operable on the page the person is looking at, saved to a
   * file, to write or fix a site's targets from. */
  pageMap: [
    { do: "outline", limit: 600, as: "outline" },
  ],
};

/* The order the panel lists a site's tasks in. */
const TASK_ORDER = ["signIn", "addToCart", "bulkAdd", "openCart", "removeFromCart", "checkout", "placeOrder", "orders", "track", "pageMap"];

const TASK_PARAMS = {
  addToCart: ["part", "quantity"],
  openCart: [],
  signIn: [],
  pageMap: [],
};


module.exports = { COMMON_TARGETS, COMMON_TASKS, T, TASK_ORDER, TASK_PARAMS };
