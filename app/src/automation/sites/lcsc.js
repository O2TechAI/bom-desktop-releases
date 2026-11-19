"use strict";

/* LCSC (www.lcsc.com) as a state machine (machine.js).
 *
 * A search for an exact part number lands on a results table with one row
 * per product (tr#productId…). Each row has its own quantity field and an
 * "Add" button, so the cart targets are scoped to the row whose text holds
 * the part number.
 *
 * Where the selectors come from (2026-11-16):
 * - Search, add to cart, the cart page and its lines: run end to end on the
 *   live site. The cart's line is `div[id^="cartItemBox_"]` (also
 *   .v2CartListItemWrap.cartItemWrap), read from the real page; `openCart`
 *   returns [{ part: "C1525", quantity: "100" }].
 * - Delete and Secure Checkout: read from the live cart page's outline.
 *   LCSC has no per-line remove: a line is ticked, then the one "Delete"
 *   button (disabled until something is ticked) removes it.
 * - Everything past the cart - checkout, review, orders, tracking - needs an
 *   account, so no sample exists. Those targets read the page the way a
 *   person does (button words, column titles), and `ORDERS_URL` below is a
 *   guess. A step that can't find its way hands over to the person.
 *
 * `verified` is false until a signed-in run has gone end to end: search,
 * add and cart are proven, the rest is not. */

const { T } = require("./common");

const RESULT_ROW = {
  any: [{ css: "tr[id^='productId']" }, { role: "row" }, { css: "tr" }],
  hasText: "{{part}}",
};

/* One line in the cart, by the part it holds. */
const CART_ROW = {
  any: [{ css: "[id^='cartItemBox_']" }, { css: ".v2CartListItemWrap, .cartItemWrap" }],
  hasText: "{{part}}",
};

/* UNCONFIRMED: check this on the first signed-in run and fix it here. */
const ORDERS_URL = "https://www.lcsc.com/order";

module.exports = {
  id: "lcsc",
  name: "LCSC",
  verified: false,
  hosts: ["*.lcsc.com"],
  urls: {
    home: "https://www.lcsc.com/",
    search: "https://www.lcsc.com/search?q={{part|url}}",
    cart: "https://www.lcsc.com/cart",
    signIn: "https://www.lcsc.com/login",
    orders: ORDERS_URL,
  },
  targets: {
    "cookies.accept": {
      title: T("Accept cookies", "接受 Cookie", "Aceptar cookies"),
      any: [{ role: "button", name: /^accept all cookies$/i }],
    },
    "search.input": {
      title: T("Search box", "搜索框", "Cuadro de búsqueda"),
      any: [{ label: /^search input$/i }, { role: "textbox", name: /search input/i }],
    },
    "results.row": {
      title: T("The part's row", "该型号所在行", "La fila de la pieza"),
      ...RESULT_ROW,
    },
    "product.quantity": {
      title: T("Quantity", "数量", "Cantidad"),
      within: RESULT_ROW,
      any: [{ role: "textbox" }],
    },
    "product.addToCart": {
      title: T("Add to cart", "加入购物车", "Añadir al carrito"),
      within: RESULT_ROW,
      any: [{ role: "button", name: /^add$/i }, { role: "button", name: /add to cart/i }],
    },
    "cart.count": {
      title: T("Cart count", "购物车数量", "Cantidad en el carrito"),
      any: [{ css: "#cart-badge .ant-badge-count" }, { css: "#cart-badge [role=status]" }, { css: "a[href*='/cart'] .v-badge__badge" }],
    },
    "tour.skip": {
      title: T("Skip the tour", "跳过引导", "Saltar la guía"),
      any: [{ role: "button", name: /^skip$/i }],
    },
    "detail.ofPart": {
      title: T("The part's page", "该型号的页面", "La página de la pieza"),
      any: [{ css: "h1" }, { role: "heading" }],
      hasText: "{{part}}",
    },
    "detail.quantity": {
      title: T("Quantity", "数量", "Cantidad"),
      any: [{ placeholder: /^enter qty$/i }, { label: /^(qty|quantity)/i }],
    },
    "detail.addToCart": {
      title: T("Add to Cart", "加入购物车", "Añadir al carrito"),
      any: [{ role: "button", name: /^add to cart$/i }],
    },
    "cart.rows": {
      title: T("Cart lines", "购物车明细", "Líneas del carrito"),
      any: [{ css: "[id^='cartItemBox_']" }, { css: "table tbody tr" }],
      hasText: /\d/,
    },
    "cart.part": {
      title: T("Part number", "型号", "Número de pieza"),
      any: [{ css: "a[href*='/product-detail/']" }, { css: "a" }],
      hasText: /C\d+/,
    },
    "cart.quantity": {
      title: T("Quantity", "数量", "Cantidad"),
      any: [{ css: "input[id^='qty-field-']" }, { css: "input" }],
    },
    "cart.row": {
      title: T("The part's cart line", "该型号的购物车行", "La línea de la pieza"),
      ...CART_ROW,
    },
    /* LCSC removes by ticking lines, not by a button on each line. */
    "cart.select": {
      title: T("Tick this line", "勾选这一行", "Marcar esta línea"),
      within: CART_ROW,
      any: [{ role: "checkbox" }, { css: "input[type=checkbox]" }, { css: ".v-input--checkbox" }],
    },
    "cart.delete": {
      title: T("Delete", "删除", "Eliminar"),
      any: [
        { role: "button", name: /^delete$/i },
        { css: "button.v2-button-outlined-primary" },
      ],
    },
    "cart.deleteConfirm": {
      title: T("Confirm the delete", "确认删除", "Confirmar"),
      any: [{ role: "button", name: /^(ok|confirm|delete|yes)$/i }],
    },
    "checkout.start": {
      title: T("Secure Checkout", "去结算", "Pagar"),
      any: [
        { role: "button", name: /^secure checkout/i },
        { css: "button.checkout-btn-mobile" },
        { role: "button", name: /checkout/i },
      ],
    },
    "account.signedIn": {
      title: T("Signed in", "已登录", "Sesión iniciada"),
      any: [{ role: "button", name: /^(sign out|log ?out)$/i }, { css: "a[href*='/account']" }],
    },
  },
  machine: {
    states: {
      challenge: { title: T("Security check", "安全验证", "Verificación de seguridad"), match: [{ all: ["challenge"] }, { all: ["challenge.page"] }], person: "challenge", quiet: true },
      signIn: { title: T("Sign in", "登录", "Inicio de sesión"), match: { all: ["account.signInForm"] }, person: "sign_in" },
      // An exact search lands on /search or, since 2026-11, /category/…?scene=FULL_MATCH:
      // the page is known by the part's row and its Add button, not the address.
      // LCSC's first-visit tour covers the page until skipped.
      tour: { title: T("Tour", "新手引导", "Guía"), match: { all: ["tour.skip"] } },
      // A search for an LCSC number (C1525) opens the part's own page.
      product: { title: T("Product page", "商品页", "Página del producto"), match: { url: /\/product-detail\//i, all: ["detail.addToCart", "detail.ofPart"] } },
      results: { title: T("Search results", "搜索结果", "Resultados"), match: { all: ["product.addToCart"] } },
      // Past the cart there is no signed-in sample, so these states are known
      // by the words on the page (common.js), not by LCSC's own markup.
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
      checkoutStep: {
        title: T("Checkout", "结账", "Pago"),
        match: [{ url: /\/(checkout|order\/confirm)/i, all: ["checkout.continue"] }],
        stuck: "checkout_details",
      },
      cart: { title: T("Cart", "购物车", "Carrito"), match: { url: /\/cart\/?(\?|$)/i } },
      orderDetail: { title: T("Order", "订单详情", "Pedido"), match: { url: /\/order\/(detail|[^/?]*\d{5,})/i } },
      orders: { title: T("Orders", "订单记录", "Pedidos"), match: [{ url: /\/order/i, all: ["orders.rows"] }] },
    },
    transitions: [
      {
        name: "search",
        title: T("Search for the part", "搜索型号", "Buscar la pieza"),
        from: "*",
        to: ["product", "results", "tour", "challenge"],
        steps: [{ do: "goto", url: "{{search}}" }, { do: "click", target: "cookies.accept", optional: true, timeout: 2500 }],
      },
      {
        name: "skipTour",
        title: T("Skip the tour", "跳过引导", "Saltar la guía"),
        from: ["tour"],
        to: ["product", "results", "cart"],
        steps: [{ do: "click", target: "tour.skip" }],
      },
      {
        name: "goCart",
        title: T("Open the cart", "打开购物车", "Abrir el carrito"),
        from: "*",
        to: ["cart", "tour", "challenge"],
        steps: [{ do: "goto", url: "{{cart}}" }, { do: "click", target: "cookies.accept", optional: true, timeout: 2500 }],
      },
      {
        name: "addToCart",
        title: T("Add to cart", "加入购物车", "Añadir al carrito"),
        auto: false,
        from: ["results"],
        to: ["results"],
        steps: [
          { do: "peek", target: "cart.count", as: "cartBefore" },
          { do: "fill", target: "product.quantity", value: "{{quantity}}" },
          { do: "click", target: "product.addToCart" },
          { do: "waitForChange", target: "cart.count", from: "cartBefore", or: "cart.added" },
        ],
      },
      {
        name: "addToCartHere",
        title: T("Add to cart", "加入购物车", "Añadir al carrito"),
        auto: false,
        from: ["product"],
        to: ["product"],
        steps: [
          { do: "peek", target: "cart.count", as: "cartBefore" },
          { do: "fill", target: "detail.quantity", value: "{{quantity}}" },
          { do: "click", target: "detail.addToCart" },
          { do: "waitForChange", target: "cart.count", from: "cartBefore", or: "cart.added" },
        ],
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
        title: T("Check out", "去结算", "Pagar"),
        from: ["cart"],
        to: ["signIn", "checkoutStep", "review", "challenge"],
        steps: [{ do: "click", target: "checkout.start", navigates: true }],
      },
      {
        name: "continue",
        title: T("Continue", "继续", "Continuar"),
        from: ["checkoutStep"],
        to: ["checkoutStep", "review", "signIn"],
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
        name: "removeLine",
        title: T("Remove the line", "删除这一行", "Quitar la línea"),
        auto: false,
        from: ["cart"],
        to: ["cart"],
        steps: [
          { do: "click", target: "cart.select" },
          { do: "click", target: "cart.delete" },
          { do: "click", target: "cart.deleteConfirm", optional: true, timeout: 3000 },
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
    ],
  },
  tasks: {
    addToCart: [{ do: "walk", to: ["product", "results"] }, { do: "act", name: ["addToCartHere", "addToCart"] }],
    openCart: [
      { do: "walk", to: "cart" },
      { do: "extract", target: "cart.rows", fields: { part: { target: "cart.part" }, quantity: { target: "cart.quantity", read: "value" } }, as: "cart", optional: true, timeout: 5000 },
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
    removeFromCart: ["part"],
    checkout: [],
    placeOrder: [],
    orders: [],
    track: ["order"],
  },
  taskDefaults: {
    addToCart: { part: "C1525", quantity: "100" },
    removeFromCart: { part: "C1525" },
  },
};
