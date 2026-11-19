"use strict";

/* McMaster-Carr (www.mcmaster.com): the hardware line, where a part number
 * is an address.
 *
 * Where the selectors come from (2026-11-17, read from the live site with
 * scripts/probe-pages.cjs, signed out):
 * - A part number is its own page: /products/91251a542/. There is no results
 *   page to walk through, so "search" goes straight there.
 * - The quantity box and the button are CSS modules, so their class names
 *   carry a build hash (`_quantityInput_cc5wg_19`). A target matches on the
 *   stable part (`[class*="_quantityInput_"]`) and falls back to the words.
 * - The cart is called ORDER and the button says ADD TO ORDER, not "add to
 *   cart". Both live on stable ids: `#ShellLayout_CurrOrd_Btn` and
 *   `#ShellLayout_OrdHist_Btn`.
 *
 * Not here: checkout and placing an order. McMaster prices and sells against
 * an account, and signed out there is no sample of those pages; writing them
 * from guesses is how a profile ends up claiming more than it can do. The
 * addresses marked UNCONFIRMED below are the other thing to check on the
 * first signed-in run. */

const { T } = require("./common");

/* UNCONFIRMED: the ORDER and ORDER HISTORY buttons' own addresses, to read
 * off their href on the first signed-in run. */
const ORDER_URL = "https://www.mcmaster.com/order/";
const ORDERS_URL = "https://www.mcmaster.com/orderhistory/";

module.exports = {
  id: "mcmaster",
  name: "McMaster-Carr",
  verified: false,
  hosts: ["*.mcmaster.com"],
  urls: {
    home: "https://www.mcmaster.com/",
    // A part number is the address; there is no results page in between.
    search: "https://www.mcmaster.com/products/{{part|url}}/",
    cart: ORDER_URL,
    signIn: "https://www.mcmaster.com/login/",
    orders: ORDERS_URL,
  },
  targets: {
    "product.ofPart": {
      title: T("The part's page", "该型号的页面", "La página de la pieza"),
      any: [{ css: "a[class*='_selectedPartNumberLinkOrderBox_']" }, { css: "h1" }],
      hasText: "{{part}}",
    },
    "product.quantity": {
      title: T("Quantity", "数量", "Cantidad"),
      any: [
        { css: "input[class*='_quantityInput_']" },
        { label: /^(qty|quantity)/i },
        { css: "input[inputmode='numeric']" },
      ],
    },
    "product.addToCart": {
      title: T("Add to order", "加入订单", "Añadir al pedido"),
      any: [
        { css: "button[class*='_addToOrderButton_']" },
        { role: "button", name: /^add to order$/i },
        { role: "button", name: /add to (order|cart)/i },
      ],
    },
    "cart.open": {
      title: T("Order", "当前订单", "Pedido"),
      any: [{ css: "#ShellLayout_CurrOrd_Btn" }, { role: "link", name: /^order$/i }],
    },
    "orders.open": {
      title: T("Order history", "订单记录", "Historial de pedidos"),
      any: [{ css: "#ShellLayout_OrdHist_Btn" }, { role: "link", name: /^order history$/i }],
    },
    "account.signedIn": {
      title: T("Signed in", "已登录", "Sesión iniciada"),
      any: [{ role: "link", name: /^(log ?out|sign out)$/i }, { role: "button", name: /^(log ?out|sign out)$/i }],
    },
  },
  machine: {
    states: {
      challenge: { title: T("Security check", "安全验证", "Verificación de seguridad"), match: [{ all: ["challenge"] }, { all: ["challenge.page"] }], person: "challenge", quiet: true },
      signIn: { title: T("Sign in", "登录", "Inicio de sesión"), match: { all: ["account.signInForm"] }, person: "sign_in" },
      product: {
        title: T("Product page", "商品页", "Página del producto"),
        match: { url: /\/products\//i, all: ["product.addToCart"] },
      },
      cart: { title: T("Order", "当前订单", "Pedido"), match: { url: /\/order\/?(\?|$)/i } },
      orders: { title: T("Orders", "订单记录", "Pedidos"), match: [{ url: /orderhistory/i }] },
    },
    transitions: [
      {
        name: "search",
        title: T("Open the part", "打开该型号", "Abrir la pieza"),
        from: "*",
        to: ["product", "challenge"],
        steps: [{ do: "goto", url: "{{search}}" }, { do: "click", target: "cookies.accept", optional: true, timeout: 2500 }],
      },
      {
        name: "goCart",
        title: T("Open the order", "打开当前订单", "Abrir el pedido"),
        from: "*",
        to: ["cart", "signIn", "challenge"],
        steps: [{ do: "goto", url: "{{cart}}" }],
      },
      {
        name: "goOrders",
        title: T("Open the orders", "打开订单记录", "Abrir los pedidos"),
        from: "*",
        to: ["orders", "signIn", "challenge"],
        steps: [{ do: "goto", url: "{{orders}}" }],
      },
      {
        name: "addToCart",
        title: T("Add to order", "加入订单", "Añadir al pedido"),
        auto: false,
        from: ["product"],
        to: ["product"],
        steps: [
          { do: "fill", target: "product.quantity", value: "{{quantity}}" },
          { do: "click", target: "product.addToCart" },
          { do: "waitFor", target: "cart.open" },
        ],
      },
    ],
  },
  tasks: {
    addToCart: [
      { do: "walk", to: "product" },
      { do: "act", name: "addToCart" },
    ],
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
  },
  taskDefaults: {
    // A hex-drive socket cap screw, pennies each.
    addToCart: { part: "91251A542", quantity: "5" },
  },
};
