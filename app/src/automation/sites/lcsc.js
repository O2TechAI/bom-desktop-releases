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

/* The open dialog (an address form inside it). */
const DIALOG = { any: [{ css: ".v-dialog--active" }] };

/* (2026-11-20, live, signed in) "My Orders" in the account menu; the old
 * /order sent the run back to the home page. */
const ORDERS_URL = "https://www.lcsc.com/personalCenter/order/list";

/* The Compliance statement on the checkout page, answered as the person
 * chose (not resold as is; Industrial) and kept as their default. Skipped
 * where LCSC no longer asks. */
const COMPLIANCE_STEPS = [
  { do: "click", target: "compliance.resellNo", when: "compliance.application", whenTimeout: 3000 },
  { do: "click", target: "compliance.application", when: "compliance.application" },
  { do: "click", target: "compliance.industrial", when: "compliance.application", timeout: 5000 },
  { do: "click", target: "compliance.setDefault", when: "compliance.application", optional: true, timeout: 2000 },
];

/* LCSC's Add Shipping Address dialog, filled with the saved address, kept as
 * the default and as the billing address too, then saved. */
const ADD_ADDRESS_STEPS = [
  { do: "click", target: "checkout.addShipping" },
  { do: "waitFor", target: "addr.dialog", timeout: 15000 },
  { do: "fill", target: "addr.firstName", value: "{{firstName}}" },
  { do: "fill", target: "addr.lastName", value: "{{lastName}}" },
  // LCSC takes only digits and "+" here.
  { do: "fill", target: "addr.phone", value: "{{phoneDigits}}" },
  { do: "click", target: "addr.country" },
  { do: "type", value: "United States" },
  { do: "click", target: "addr.countryUS" },
  { do: "click", target: "addr.state" },
  { do: "type", value: "{{stateName}}" },
  { do: "click", target: "addr.stateOption" },
  { do: "fill", target: "addr.city", value: "{{city}}" },
  { do: "fill", target: "addr.line1", value: "{{line1}}" },
  { do: "fill", target: "addr.line2", value: "{{line2}}" },
  { do: "fill", target: "addr.zip", value: "{{zip}}" },
  { do: "click", target: "addr.setDefault" },
  { do: "click", target: "addr.syncBilling" },
  { do: "click", target: "addr.save" },
  { do: "waitForHidden", target: "addr.dialog", timeout: 20000 },
];

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
    /* The BOM tool: upload a CSV, create the list, add the matches. */
  "bom.upload": {
    title: T("BOM file", "BOM 文件", "Archivo BOM"),
    hidden: true,
    any: [{ css: "input[type=file][accept*='csv']" }],
  },
  "bom.create": {
    title: T("Create BOM", "创建 BOM", "Crear BOM"),
    any: [{ role: "button", name: /^create bom$/i }],
  },
  "bom.addToCart": {
    title: T("Add the matched parts", "加入匹配的料号", "Añadir las piezas"),
    any: [{ role: "button", name: /^add to cart$/i }],
  },
  /* (2026-11-19, live) /bom/options renders its column table only once the
   * file is parsed; a Create BOM click before that does nothing. The table's
   * recognised column header is the sign it is ready. */
  "bom.columns": {
    title: T("The file's columns", "文件的列", "Las columnas del archivo"),
    any: [{ css: ".v-input__slot" }],
    hasText: /LCSC Part Number/i,
  },
  /* The project page is ready once its match filters show ("Exact Matches (2)"). */
  "bom.matches": {
    title: T("Matched parts", "匹配结果", "Piezas encontradas"),
    any: [{ role: "button", name: /^exact matches/i }],
  },
  /* (2026-11-19, live) Signed out, the project page lies under a white
   * overlay with one button, "Log in to view all results or register now":
   * Add to Cart is covered, so the person signs in first. */
  /* (2026-11-20, live, signed in) Add to Cart on the project page opens a
   * dialog: "Include" (the entire list, chosen) and a required "Add to"
   * (the person's existing carts, or "<New Cart>"), then "Add". */
  "bom.addDialog": {
    title: T("Add to Cart dialog", "加入购物车对话框", "Diálogo de añadir al carrito"),
    any: [{ css: ".v-dialog--active" }],
    hasText: /add to cart/i,
  },
  "bom.addToField": {
    title: T("Add to (which cart)", "加入到（哪个购物车）", "Añadir a (qué carrito)"),
    any: [{ css: ".v-dialog--active .v-input.mt-2 .v-input__slot" }],
  },
  "bom.existingCart": {
    title: T("An existing cart", "已有的购物车", "Un carrito existente"),
    any: [{ css: ".v-menu__content.menuable__content__active [role=option]" }],
    hasText: /^(?!\s*<new cart>)\S/i,
  },
  "bom.newCart": {
    title: T("New cart", "新建购物车", "Carrito nuevo"),
    any: [{ css: ".v-menu__content.menuable__content__active [role=option]" }],
    hasText: /<new cart>/i,
  },
  "bom.addConfirm": {
    title: T("Add", "加入", "Añadir"),
    within: { any: [{ css: ".v-dialog--active" }] },
    any: [{ role: "button", name: /^add$/i }],
  },
  /* (2026-11-20, live, signed in) The cart page shows one of the person's
   * carts: the name beside "Cart_..." opens .selectCartWrap: the other
   * carts newest first (names are Cart_<timestamp>), the shown one last and
   * ticked, so the first is the one just made. A cart added from the
   * BOM tool is not shown by itself; picking it is remembered by the account
   * (it stays after a reload). Each item also has a delete icon: only the
   * name is clicked. */
  "cart.switch": {
    title: T("Which cart", "选择购物车", "Qué carrito"),
    any: [{ css: ".guide_1_box span[role=button][aria-haspopup]" }],
  },
  "cart.newest": {
    title: T("The newest cart", "最新的购物车", "El carrito más reciente"),
    any: [{ css: ".menuable__content__active .selectCartItem .text-truncate" }],
  },
  /* (2026-11-20, live) My Orders is a table: Order No., Your PO No., Order
   * Date, Order Status, Order Value, then the row's actions. */
  "orders.number": { title: T("Order number", "订单号", "Número de pedido"), any: [{ css: "td:nth-child(1)" }] },
  "orders.date": { title: T("Date", "日期", "Fecha"), any: [{ css: "td:nth-child(3)" }] },
  "orders.status": { title: T("Status", "状态", "Estado"), any: [{ css: "td:nth-child(4)" }] },
  "orders.total": { title: T("Total", "总额", "Total"), any: [{ css: "td:nth-child(5)" }] },
  "checkout.noAddress": {
    title: T("No shipping address", "没有收货地址", "Sin dirección de envío"),
    any: [{ text: /no shipping address found/i }],
  },
  /* (2026-11-20, live, signed in) "Add" beside Shipping Address opens "Add
   * Shipping Address": Customer Type (Company / Individual, Individual
   * chosen), then text fields with generated ids and their labels beside
   * them, so they are known by their order in the dialog: first name, last
   * name, phone, country (searchable), state (searchable), city, street,
   * apt, postal code; then "Set As Default", "Sync My Shipping Address as the
   * Bill Address", Cancel / Save. */
  // The checkout already ships to the BOM's address (2026-11-23): its street
  // line is on the page. Otherwise the account's own default would be used.
  "checkout.shipsToSaved": {
    title: T("The BOM's ship-to address", "BOM 的收货地址", "La dirección de envío de la BOM"),
    any: [{ css: "body" }],
    hasText: "{{line1}}",
  },
  // Checkout's Compliance statement (2026-11-23, live; the person's answers:
  // "选no/industry"): not resold as is, used in Industrial, kept as default.
  "compliance.resellNo": {
    title: T("Not resold as is", "不原样转售", "No se revende tal cual"),
    // The radio input itself is hidden; its visible "No" is what takes the click.
    any: [{ text: /^no$/i }, { css: "label", hasText: /^\s*no\s*$/i }],
  },
  "compliance.application": {
    title: T("How the parts are used", "元器件用途", "Uso de los componentes"),
    any: [{ css: "input[placeholder='please choose' i]" }],
  },
  "compliance.industrial": {
    title: T("Industrial", "工业", "Industrial"),
    any: [{ role: "option", name: /^industrial$/i }, { text: /^industrial$/i }],
  },
  "compliance.setDefault": {
    title: T("Keep these answers", "设为默认", "Guardar como predeterminado"),
    any: [{ role: "checkbox", name: /set as default/i }, { text: /^set as default$/i }],
  },
  "checkout.addShipping": {
    title: T("Add a shipping address", "添加收货地址", "Añadir dirección"),
    any: [{ text: /^add$/i }],
  },
  "addr.dialog": {
    title: T("Add Shipping Address", "添加收货地址", "Añadir dirección de envío"),
    any: [{ css: ".v-dialog--active" }],
    hasText: /add shipping address/i,
  },
  "addr.firstName": { title: T("First name", "名", "Nombre"), within: DIALOG, any: [{ css: "input[type=text]" }], nth: 0 },
  "addr.lastName": { title: T("Last name", "姓", "Apellido"), within: DIALOG, any: [{ css: "input[type=text]" }], nth: 1 },
  "addr.phone": { title: T("Phone number", "电话", "Teléfono"), within: DIALOG, any: [{ css: "input[type=text]" }], nth: 2 },
  "addr.country": { title: T("Country/Region", "国家/地区", "País/Región"), within: DIALOG, any: [{ css: "input[type=text]" }], nth: 3 },
  "addr.state": { title: T("State", "州", "Estado"), within: DIALOG, any: [{ css: "input[type=text]" }], nth: 4 },
  "addr.city": { title: T("City", "城市", "Ciudad"), within: DIALOG, any: [{ css: "input[type=text]" }], nth: 5 },
  "addr.line1": { title: T("Street address", "街道地址", "Dirección"), within: DIALOG, any: [{ css: "input[type=text]" }], nth: 6 },
  "addr.line2": { title: T("Apt, Suite, Building", "门牌/楼层", "Apto., suite"), within: DIALOG, any: [{ css: "input[type=text]" }], nth: 7 },
  "addr.zip": { title: T("Postal code", "邮编", "Código postal"), within: DIALOG, any: [{ css: "input[type=text]" }], nth: 8 },
  "addr.countryUS": {
    title: T("United States", "美国", "Estados Unidos"),
    any: [{ css: ".v-menu__content.menuable__content__active [role=option]" }],
    hasText: /^\s*united states\s*$/i,
  },
  "addr.stateOption": {
    title: T("The state", "所选的州", "El estado"),
    any: [{ css: ".v-menu__content.menuable__content__active [role=option]" }],
    hasText: "{{stateName}}",
  },
  // The two checkboxes: their own box takes the click (their words do not).
  "addr.syncBilling": {
    title: T("Also the billing address", "同时作为账单地址", "También la de facturación"),
    within: { any: [{ css: ".v-dialog--active .v-input--checkbox" }], hasText: /sync my shipping address/i },
    any: [{ css: ".v-input--selection-controls__input" }],
  },
  "addr.setDefault": {
    title: T("Set as default", "设为默认", "Predeterminada"),
    within: { any: [{ css: ".v-dialog--active .v-input--checkbox" }], hasText: /^\s*set as default\s*$/i },
    any: [{ css: ".v-input--selection-controls__input" }],
  },
  "addr.save": { title: T("Save", "保存", "Guardar"), within: DIALOG, any: [{ role: "button", name: /^save$/i }] },
  "addr.cancel": { title: T("Cancel", "取消", "Cancelar"), within: DIALOG, any: [{ role: "button", name: /^cancel$/i }] },
  /* Signed out, the header's account entry says "Sign In" (signed in, the
   * person's name). */
  "account.signInLink": {
    title: T("Sign In", "登录", "Iniciar sesión"),
    any: [{ text: /^sign in$/i }],
  },
  "bom.loginWall": {
    title: T("Sign in to see the results", "登录后查看结果", "Inicia sesión para ver los resultados"),
    any: [{ css: "button.noLoginBtnWrap" }, { role: "button", name: /^log in to view all results/i }],
  },
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
      // (2026-11-20, live) The cart's first-visit tour ("Switch Cart 1/3",
      // Next Step / Skip) over the whole page: its Skip is plain text.
      any: [{ role: "button", name: /^skip$/i }, { text: /^skip$/i }],
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
    /* (2026-11-20, live) Each cart line shows "$0.0025" in .unitPriceWrap and
     * its total in .extPriceWrap: the live quote the Buy lab service compares. */
    "cart.unitPrice": {
      title: T("Unit price", "单价", "Precio unitario"),
      any: [{ css: ".unitPriceWrap" }],
    },
    "cart.extended": {
      title: T("Extended price", "小计", "Precio total"),
      any: [{ css: ".extPriceWrap" }],
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
      // (2026-11-20, live) /checkout is one page with Submit Order on it. An
      // account without a shipping address shows "No shipping address
      // found" and no shipping method: the person adds one there first, and
      // only then is it the review below (above it, so it wins).
      checkoutAddress: {
        title: T("Shipping address", "收货地址", "Dirección de envío"),
        match: { url: /\/checkout/i, all: ["checkout.noAddress"] },
        person: "checkout_details",
      },
      review: {
        title: T("Review order", "确认订单", "Revisar el pedido"),
        match: { all: ["review.submit"] },
        // (2026-11-20, live) Total first shows goods + handling ($3.42) and
        // takes the shipping fee a moment later ($11.41): the person approves
        // the amount they will pay, so it is read once it has settled.
        enter: [
          { do: "wait", ms: 5000 },
          { do: "read", target: "review.total", as: "total", optional: true, timeout: 3000 },
        ],
      },
      checkoutStep: {
        title: T("Checkout", "结账", "Pago"),
        match: [{ url: /\/(checkout|order\/confirm)/i, all: ["checkout.continue"] }],
        stuck: "checkout_details",
      },
      cart: { title: T("Cart", "购物车", "Carrito"), match: { url: /\/cart\/?(\?|$)/i } },
      orderDetail: { title: T("Order", "订单详情", "Pedido"), match: { url: /\/order\/(detail|[^/?]*\d{5,})/i } },
      orders: { title: T("Orders", "订单记录", "Pedidos"), match: [{ url: /\/order/i, all: ["orders.rows"] }] },
      // Pages a run starts or ends on, known by address only and last so they
      // never shadow a page above. Unknown, a walk from them waited out the
      // whole recognition time (20 s) before setting off.
      bomProject: { title: T("BOM project", "BOM 项目", "Proyecto BOM"), match: { url: /\/personalCenter\/myProject\/detail/i } },
      home: { title: T("Home page", "首页", "Página de inicio"), match: { url: /^https:\/\/www\.lcsc\.com\/?(\?[^#]*)?(#.*)?$/i } },
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
        to: ["signIn", "checkoutAddress", "checkoutStep", "review", "challenge"],
        steps: [
          { do: "click", target: "checkout.start", navigates: true },
          // (2026-11-20, live) The checkout says "No shipping address found"
          // for a second or two while it loads the saved addresses: judged
          // then, the page looked like the person's address step. An account
          // with no address still shows it after this wait.
          { do: "waitFor", target: "review.submit", optional: true, timeout: 15000 },
          { do: "waitForHidden", target: "checkout.noAddress", optional: true, timeout: 4000 },
        ],
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
      {
        /* The person's saved address (the same one every supplier gets) into
         * LCSC's Add Shipping Address, also as the billing address, then Save.
         * Only when an operation names it: without an address the dialog
         * stays the person's, as before. */
        name: "fillAddress",
        title: T("Add the saved address", "添加保存的地址", "Añadir la dirección guardada"),
        auto: false,
        from: ["checkoutAddress"],
        to: ["review", "checkoutAddress"],
        steps: [
          ...ADD_ADDRESS_STEPS,
          { do: "waitForHidden", target: "checkout.noAddress", timeout: 20000 },
        ],
      },
      {
        /* The account has an address, but not the BOM's (2026-11-23: an old
         * test address was about to be used): the BOM's is added, as default
         * and billing, before the order goes on to the person's yes. */
        name: "addAddress",
        title: T("Ship to the BOM's address", "改用 BOM 的收货地址", "Enviar a la dirección de la BOM"),
        auto: false,
        from: ["review"],
        to: ["review"],
        steps: [
          ...ADD_ADDRESS_STEPS,
          { do: "waitFor", target: "checkout.shipsToSaved", timeout: 20000 },
        ],
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
    /* The BOM tool path: one upload instead of one product page per part. */
    bulkAddBom: [
      // Signed in first: the cart, its dialog and the checkout need the
      // account. Signed out, the sign-in page opens and the run waits for the
      // person; it carries on by itself once they are in.
      { do: "click", target: "cookies.accept", optional: true, timeout: 2500 },
      { do: "goto", url: "{{signIn}}", when: "account.signInLink" },
      { do: "handoff", message: "sign_in", when: "account.signInForm", whenTimeout: 8000, untilGone: "account.signInForm", timeout: 600000 },
      { do: "goto", url: "https://www.lcsc.com/bom" },
      { do: "click", target: "cookies.accept", optional: true, timeout: 2500 },
      { do: "upload", target: "bom.upload", filesParam: "file" },
      { do: "waitForUrl", pattern: /\/bom\/options/ },
      { do: "waitFor", target: "bom.columns", timeout: 30000 },
      { do: "click", target: "bom.create" },
      { do: "waitForUrl", pattern: /personalCenter\/myProject\/detail/ },
      { do: "waitFor", target: "bom.matches", timeout: 30000 },
      // The overlay comes a moment after the matches: give it a few seconds.
      { do: "handoff", message: "sign_in", when: "bom.loginWall", whenTimeout: 4000, untilGone: "bom.loginWall", timeout: 600000 },
      // Signed in now: Add to Cart must work (skipping it reported a cart that
      // was never filled), and its dialog must be answered: the entire list,
      // into a new cart. An existing cart would add this list's quantities to
      // lines already there (2026-11-20, live: 100 + 100 became 200), and its
      // other lines would be ordered with it.
      { do: "click", target: "bom.addToCart" },
      { do: "waitFor", target: "bom.addDialog", timeout: 15000 },
      { do: "click", target: "bom.addToField" },
      { do: "click", target: "bom.newCart" },
      { do: "click", target: "bom.addConfirm" },
      { do: "waitForHidden", target: "bom.addDialog", timeout: 20000 },
      { do: "wait", ms: 2000 },
      // The new cart is the one checked out: shown on the cart page from now on.
      { do: "goto", url: "https://www.lcsc.com/cart" },
      { do: "click", target: "cart.switch", timeout: 20000 },
      { do: "wait", ms: 1500 },
      { do: "click", target: "cart.newest", timeout: 10000 },
      { do: "wait", ms: 3000 },
    ],
    addToCart: [{ do: "walk", to: ["product", "results"] }, { do: "act", name: ["addToCartHere", "addToCart"] }],
    openCart: [
      { do: "walk", to: "cart" },
      { do: "extract", target: "cart.rows", fields: { part: { target: "cart.part" }, quantity: { target: "cart.quantity", read: "value" }, unitPrice: { target: "cart.unitPrice" }, extended: { target: "cart.extended" } }, as: "cart", optional: true, timeout: 5000 },
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
      { do: "walk", to: ["review", "confirmation"] },
      ...COMPLIANCE_STEPS,
      { do: "walk", to: "confirmation" },
    ],
    // The same with the saved address: added on the checkout page when the
    // account has none, then on to the order (the person's yes).
    placeOrderWithAddress: [
      { do: "walk", to: "cart" },
      { do: "walk", to: ["checkoutAddress", "review", "confirmation"] },
      { do: "act", name: "fillAddress", when: "checkout.noAddress" },
      { do: "act", name: "addAddress", unless: "checkout.shipsToSaved", whenTimeout: 5000 },
      ...COMPLIANCE_STEPS,
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
    bulkAddBom: ["file"],
    removeFromCart: ["part"],
    checkout: [],
    placeOrder: [],
    placeOrderWithAddress: ["firstName", "lastName", "phoneDigits", "line1", "line2", "city", "stateName", "zip"],
    orders: [],
    track: ["order"],
  },
  taskDefaults: {
    addToCart: { part: "C1525", quantity: "100" },
    removeFromCart: { part: "C1525" },
  },
};
