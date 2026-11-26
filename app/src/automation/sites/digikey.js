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
      // Any other buy box (a part sold in several packagings, 2026-11-23).
      { role: "button", name: /^add to (cart|bag)$/i },
    ],
  },
  /* A part sold in several packagings (cut tape, tape & reel, Digi-Reel):
   * the options on its page (2026-11-23: "根据描述来进行选择"). */
  /* The "added to your cart" window after Add to Cart (2026-11-23): it
   * covers the page until closed. */
  "product.continueShopping": {
    title: T("Continue Shopping", "继续购物", "Seguir comprando"),
    any: [{ css: "#continue-shopping-btn, [data-testid='continue-shopping-btn']" }, { role: "button", name: /^continue shopping$/i }],
  },
  "product.packaging": {
    title: T("Packaging options", "包装选项", "Opciones de empaque"),
    any: [
      { role: "radio", name: /cut tape|tape & reel|digi-?reel/i },
      { role: "tab", name: /cut tape|tape & reel|digi-?reel/i },
      { role: "option", name: /cut tape|tape & reel|digi-?reel/i },
      { css: "[id^='pack-type-radio']" },
    ],
  },
  /* Cut tape: what a small quantity is sold as. Tape & reel is a whole reel,
   * and Digi-Reel adds a reeling fee, so neither is chosen by the app. */
  "product.packCutTape": {
    title: T("Cut Tape", "剪切带", "Cinta cortada"),
    any: [
      { role: "radio", name: /cut tape/i },
      { role: "tab", name: /cut tape/i },
      { role: "option", name: /cut tape/i },
      { role: "button", name: /cut tape/i },
      { css: "[id^='pack-type-radio']", hasText: "Cut Tape" },
    ],
  },
  /* The packaging the order asked for, by its name on the page's options
   * ("Cut Tape", "Digi-Reel® US$7.00", "Tape & Reel"; 2026-11-24). */
  "product.packChosen": {
    title: T("The order's packaging", "订单要求的包装", "El empaque del pedido"),
    any: [{ css: "[id^='pack-type-radio']" }, { role: "radio" }, { role: "tab" }, { role: "button" }],
    hasText: "{{pack}}",
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
  /* The cart's "Upload a File" box (2026-11-19, from the live page): a
   * Dropzone whose hidden input takes the file, then a column-mapping dialog
   * (`aside#dialog-mapper`) asks which column holds the part number and the
   * quantity, and which row the parts start on. "Upload a List"
   * (`#myListFileInput`) is DigiKey's list feature, not the cart. */
  "cart.uploadFile": {
    title: T("Upload a File", "上传文件", "Subir un archivo"),
    hidden: true,
    any: [{ css: "input.dz-hidden-input" }],
  },
  "cart.mapper": {
    title: T("File mapping", "文件列映射", "Mapeo del archivo"),
    any: [{ css: "aside#dialog-mapper.visible" }],
  },
  "cart.mapPartColumn": {
    title: T("Part number column", "型号列", "Columna de la pieza"),
    any: [{ css: "#dialog-mapper select[name=column0]" }],
  },
  "cart.mapQtyColumn": {
    title: T("Quantity column", "数量列", "Columna de cantidad"),
    any: [{ css: "#dialog-mapper select[name=column1]" }],
  },
  /* The file is DigiKey number, maker's number, quantity (2026-11-25). */
  "cart.mapColumn2": {
    title: T("Quantity column", "数量列", "Columna de cantidad"),
    any: [{ css: "#dialog-mapper select[name=column2]" }],
  },
  "cart.mapStartRow": {
    title: T("First part row", "首行料号所在行", "Primera fila de piezas"),
    any: [{ css: "#dialog-mapper input#StartRow" }],
  },
  /* A line the BOM file left at "View Options" (2026-11-24, live): its
   * button, the options dialog (#dialog-suggestions), one radio per option
   * (#suggestion0...), and Add / Cancel. */
  /* The cart's loading cover while it refreshes after a change (2026-11-25:
   * it covered View Options and the rest of the lines went by search). */
  "cart.busy": {
    title: T("Loading", "加载中", "Cargando"),
    any: [{ css: "#loadingDiv.ui-widget-overlay, #loadingDiv" }],
  },
  /* The Value Calculator after Add to Cart: "A lower extended price is
   * available at a higher quantity", the asked quantity chosen, and Add
   * (2026-11-25: without it the part never went in, and nothing said so). */
  "product.valueCalcAdd": {
    title: T("Add", "加入", "Añadir"),
    within: { any: [{ css: ".dk-modal.visible" }, { role: "dialog" }], hasText: /value calculator|lower extended price/i },
    any: [{ css: "#primary-add" }, { role: "button", name: /^add$/i }],
  },
  /* "Add to Cart" again in DigiKey's own question after the first click
   * (2026-11-25: Yageo RC0402 parts two sellers list; without it nothing went in). */
  "product.addAnyway": {
    title: T("Add to Cart", "加入购物车", "Añadir al carrito"),
    any: [{ css: "[data-testid='add-to-cart-modal-error-ok-btn'], #add-to-cart-modal-error-ok-btn" }],
  },
  "cart.viewOptions": {
    title: T("View Options", "查看选项", "Ver opciones"),
    any: [{ role: "button", name: /^view options$/i }],
  },
  "cart.optionsDialog": {
    title: T("Packaging options", "包装选项", "Opciones de empaque"),
    any: [{ css: "#dialog-suggestions.visible .dk-modal__content" }],
  },
  /* The same once its options have loaded: they come a moment after the
   * dialog shows, and a read before then found none (2026-11-24). */
  "cart.optionsLoaded": {
    title: T("Packaging options", "包装选项", "Opciones de empaque"),
    any: [{ css: "#dialog-suggestions.visible .dk-modal__content" }],
    // Also DigiKey's Value Calculator ("A lower extended price is available
    // at a higher quantity", 2026-11-25): the list's own quantity is kept.
    hasText: /(valid options are|lower extended price)[\s\S]*-ND/i,
  },
  "cart.optionChoice": {
    title: T("The packaging", "该包装", "El empaque"),
    any: [{ css: "#dialog-suggestions.visible #suggestion{{option}}" }],
  },
  "cart.optionsAdd": {
    title: T("Add", "加入", "Añadir"),
    any: [{ css: "#dialog-suggestions.visible #primary-add" }],
  },
  "cart.optionsCancel": {
    title: T("Cancel", "取消", "Cancelar"),
    any: [{ css: "#dialog-suggestions.visible #secondary-cancel" }],
  },
  /* A cart line's packaging (2026-11-24, live): a select named
   * Details[n].PartNumber whose options are that part's packagings ("Cut
   * Tape (CT)", "Digi-Reel®", "Tape & Reel") by their DigiKey numbers.
   * Choosing one keeps the quantity, unless the packaging needs more (a reel:
   * 10 became 3,000). */
  "cart.packSelect": {
    title: T("Packaging", "包装", "Empaque"),
    within: { any: [{ css: "tr.detailRow" }, { css: "tbody tr" }], hasText: "{{part}}" },
    any: [{ css: "select[name$='PartNumber']" }],
  },
  "cart.mapAdd": {
    title: T("Add to Current Cart", "加入当前购物车", "Añadir al carrito actual"),
    any: [{ css: "#dialog-mapper span[data-button='addToCurrent']:not(.disabled)" }],
  },
  /* The shipping address form (2026-11-19, live: /ordering/guest/Address).
   * Plain inputs by id; the state is DigiKey's own dropdown over a hidden
   * <select>: its button opens a list of li[data-value=<two-letter code>]. */
  "addr.form": {
    title: T("Shipping address form", "收货地址表单", "Formulario de dirección"),
    any: [{ css: "input#ShippingAddress_AddressLine1" }],
  },
  /* Signed in, the address page lists the account's saved addresses, one
   * radio each, and "+ Add a New Shipping Address" (2026-11-24, live). The
   * order's ship-to is the saved one with its postal code, else a new one. */
  "addr.savedAny": {
    title: T("Saved addresses", "已保存的地址", "Direcciones guardadas"),
    any: [{ css: "tr:has(input[type=radio])" }],
    hasText: /\d{5}/,
  },
  "addr.savedRow": {
    title: T("The order's address", "订单的收货地址", "La dirección del pedido"),
    any: [{ css: "tr:has(input[type=radio])" }],
    hasText: "{{zip}}",
  },
  "addr.savedPick": {
    title: T("The order's address", "订单的收货地址", "La dirección del pedido"),
    within: { any: [{ css: "tr:has(input[type=radio])" }], hasText: "{{zip}}" },
    any: [{ css: "input[type=radio]" }],
  },
  "addr.addNew": {
    title: T("Add a New Shipping Address", "新增收货地址", "Añadir una dirección"),
    any: [{ role: "link", name: /add a new shipping address/i }, { role: "button", name: /add a new shipping address/i }, { text: /add a new shipping address/i }],
  },
  "addr.email": { title: T("Email", "邮箱", "Correo"), any: [{ css: "input#ShippingContactInfo_ShippingEmail" }] },
  "addr.phone": { title: T("Telephone", "电话", "Teléfono"), any: [{ css: "input#ShippingContactInfo_ShippingPhone" }] },
  "addr.firstName": { title: T("First name", "名", "Nombre"), any: [{ css: "input#ShippingAddress_FirstName" }] },
  "addr.lastName": { title: T("Last name", "姓", "Apellido"), any: [{ css: "input#ShippingAddress_LastName" }] },
  "addr.company": { title: T("Company", "公司", "Empresa"), any: [{ css: "input#ShippingAddress_CompanyName" }] },
  "addr.line1": { title: T("Address line 1", "地址第 1 行", "Dirección, línea 1"), any: [{ css: "input#ShippingAddress_AddressLine1" }] },
  "addr.line2": { title: T("Address line 2", "地址第 2 行", "Dirección, línea 2"), any: [{ css: "input#ShippingAddress_AddressLine2" }] },
  "addr.city": { title: T("City", "城市", "Ciudad"), any: [{ css: "input#ShippingAddress_City" }] },
  /* Required, and above the name: "Customer type" (select#CustomerType,
   * values 10 Individual ... 13 Design/Research/Development ... 99 Other),
   * the same kind of dropdown as the state. */
  "addr.customerTypeOpen": { title: T("Customer type", "客户类型", "Tipo de cliente"), any: [{ css: "#divCompanyType .dk-dropdown__selected" }] },
  "addr.customerTypeOption": {
    title: T("The customer type", "所选客户类型", "El tipo de cliente"),
    any: [{ css: ".dk-dropdown__options[data-dropdown-open='true'] li.single-option[data-value='{{customerType}}']" }],
  },
  "addr.stateOpen": { title: T("State", "州", "Estado"), any: [{ css: "#trState .dk-dropdown__selected" }] },
  "addr.stateOption": {
    title: T("The state", "所选的州", "El estado"),
    // Only in the list that is open: the page has three of these dropdowns,
    // and the closed ones count as visible too (country holds "MN", Mongolia).
    any: [{ css: ".dk-dropdown__options[data-dropdown-open='true'] li.single-option[data-value='{{state}}']" }],
  },
  "addr.zip": { title: T("Postal code", "邮编", "Código postal"), any: [{ css: "input#ShippingAddress_ZipCodeNumeric5" }] },
  "addr.continue": {
    title: T("Continue to Shipping", "继续到配送", "Continuar al envío"),
    any: [{ css: "#continueButton #primaryButton" }],
  },
  /* (2026-11-19, live) After Continue, DigiKey checks the address: a
   * "Verify Shipping Address" dialog with its standard form of it (upper
   * case, ZIP+4) chosen, the original as the other choice, and its own
   * Continue to Shipping. */
  "addr.verifyPopup": {
    title: T("Verify Shipping Address", "核对收货地址", "Verificar la dirección"),
    any: [{ css: "aside#AddressValidationPopup.visible" }],
  },
  "addr.verifyContinue": {
    title: T("Continue to Shipping", "继续到配送", "Continuar al envío"),
    any: [{ css: "#AddressValidationPopup__continueButton" }],
  },
  /* (2026-11-19, live: /ordering/guest/Ship) "Select Shipping Options":
   * release option and ship method come chosen (Multiple Shipments, FedEx
   * Ground); its button says Continue to Payment. */
  "ship.continue": {
    title: T("Continue to Payment", "继续到付款", "Continuar al pago"),
    any: [{ css: "#continueButton #primaryButton" }],
  },
  "cart.uploaded": {
    title: T("The uploaded lines", "上传后的行", "Las líneas subidas"),
    any: [{ css: "#cartDetails tbody tr" }, { css: "[id^='PartErrorRemove']" }, { role: "button", name: /^view options$/i }],
  },
  "cart.empty": {
    title: T("Empty cart", "空购物车", "Carrito vacío"),
    any: [{ role: "heading", name: /your (shopping )?cart is empty/i }],
  },
  /* (2026-11-20, live) "New Cart" above the cart opens #dialog-new-cart:
   * "Create New Cart" saves the current cart (Resume Cart brings it back)
   * and starts an empty one; "Empty Current Cart" would throw it away. A
   * purchase starts from a cart of its own, so lines left from an earlier
   * run, or the person's own, are never ordered with it, and nothing of
   * theirs is deleted. */
  "cart.newCart": {
    title: T("New Cart", "新建购物车", "Carrito nuevo"),
    any: [{ css: "a.newCartLink" }, { role: "link", name: /^new cart$/i }],
  },
  "cart.newCartDialog": {
    title: T("Create New Cart dialog", "新建购物车对话框", "Diálogo de carrito nuevo"),
    any: [{ css: "#dialog-new-cart.visible" }],
  },
  "cart.newCartCreate": {
    title: T("Create New Cart (keeps the old one)", "新建购物车（保留旧的）", "Crear carrito nuevo (guarda el anterior)"),
    any: [{ css: "#dialog-new-cart_create" }],
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
  /* A part DigiKey no longer sells: "Unavailable. This product is no longer
   * carried by DigiKey" where the buy box would be (2026-11-24,
   * GRM188R61A106KE69D). */
  /* A search with no result for the part: "Sorry, "X" did not return any
   * results" (2026-11-25, CL10B683KB8NNNC). */
  "results.none": {
    title: T("No result", "没有结果", "Sin resultados"),
    any: [{ css: "h1, h2, h3, p, div, span" }],
    hasText: /did not return any results/i,
  },
  "product.unavailable": {
    title: T("No longer sold", "已不再销售", "Ya no se vende"),
    any: [{ css: "h2, h3, h4, p, span, div" }],
    hasText: /no longer carried by digikey|out of stock and backorders are currently unavailable/i,
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
  // The address check dialog, over the address page (same address): above
  // `shipping` so the dialog wins while it is open.
  addressCheck: { title: T("Address check", "核对地址", "Verificación de dirección"), match: { all: ["addr.verifyPopup"] } },
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
  // The ship method page between the address and payment (guest:
  // /ordering/guest/Ship). Not the person's: DigiKey's chosen method stays.
  shippingOptions: { title: T("Shipping options", "配送方式", "Opciones de envío"), match: { url: /\/ordering\/(guest\/)?ship(\/|\?|#|$)/i } },
  payment: {
    title: T("Payment", "付款", "Pago"),
    // A guest checkout's payment page is /ordering/guest/Payment.
    match: [{ url: /\/ordering\/(guest\/)?payment/i }, { url: /checkout/i, all: ["checkout.paymentPage"] }],
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
  // Known on its own, so the walk ends there at once: a line that can't be
  // had, not a page for the person (it waited as "lost").
  // Searched, and nothing has the part's number: the line can't be had here.
  noMatch: { title: T("Not found", "没找到", "No encontrado"), match: { url: /\/products\/result/i, all: ["results.none"] } },
  notSold: {
    title: T("No longer sold", "已不再销售", "Ya no se vende"),
    match: { url: /\/products\/detail\//i, all: ["product.unavailable", "product.ofPart"] },
  },
  product: {
    title: T("Product page", "商品页", "Página del producto"),
    // Its buy box, or its packaging options before one is chosen (2026-11-23:
    // the page of a part in several packagings was not recognised).
    match: [{ all: ["product.addToCart", "product.ofPart"] }, { all: ["product.packaging", "product.ofPart"] }],
  },
  // A search can also land on a category page with an Exact Match card
  // (2026-11-23: 1N4148W-7-F opened /products/category/diodes/rectifiers).
  // Any part's own page, its buy box not (yet, or any more) known: after an
  // Add to Cart it was "unknown", and each walk on from it waited out the 20 s
  // of recognising a page (2026-11-25).
  // This part's own page only: any part's page taken as the goal added the
  // last part again under the next one's quantity (2026-11-25).
  productPage: { title: T("Product page", "商品页", "Página del producto"), match: { url: /\/products\/detail\//i, all: ["product.ofPart"] } },
  // Another part's page: known (no 20 s of recognising), but no goal.
  otherProduct: { title: T("Product page", "商品页", "Página del producto"), match: { url: /\/products\/detail\//i } },
  results: { title: T("Search results", "搜索结果", "Resultados"), match: { url: /\/products\/(result|category)/i, all: ["results.exact"] } },
  // The home page Buy lab's Chrome opens on. Known by its address only, and
  // last, so it never shadows a page above. Unknown, a walk from here waited
  // out the whole recognition time (20 s) before setting off.
  home: { title: T("Home page", "首页", "Página de inicio"), match: { url: /^https:\/\/www\.digikey\.com\/(en\/?)?(\?[^#]*)?(#.*)?$/i } },
};

/* Every click or address that moves between them. */
const TRANSITIONS = [
  {
    name: "search",
    title: T("Search for the part", "搜索型号", "Buscar la pieza"),
    from: "*",
    to: ["product", "results", "challenge", "noMatch"],
    // Search the way a person does: the shop's own page, the box, the term and
    // the search button. A cold goto of the result URL is exactly what
    // Cloudflare asks to verify first.
    steps: [
      { do: "goto", url: "{{home}}" },
      { do: "wait", ms: 1500 },
      { do: "click", target: "search.input" },
      { do: "fill", target: "search.input", value: "{{part}}" },
      { do: "wait", ms: 400 },
      { do: "click", target: "search.submit", navigates: true },
      // A search with one match goes straight to its page, /products/detail/
      // (2026-11-23: RC0603FR-07100KL); a security check keeps the address,
      // so the page itself is told apart after this wait.
      { do: "waitForUrl", pattern: /products\/(result|detail|category)|product-detail/i, optional: true, timeout: 20000 },
      { do: "wait", ms: 800 },
      { do: "click", target: "cookies.accept", optional: true, timeout: 2500 },
    ],
  },
  {
    name: "openExact",
    title: T("Open the part", "打开该型号", "Abrir la pieza"),
    from: ["results"],
    to: ["product"],
    steps: [{ do: "click", target: "results.exact", navigates: true }],
  },
  {
    // After an order DigiKey sends its cart address to that order's
    // confirmation (/ordering/submit) until a new cart is started (2026-11-23:
    // the walk to the cart went round on the confirmation and was lost).
    name: "newCartAfterOrder",
    title: T("Start a new cart", "新建购物车", "Empezar un carrito nuevo"),
    from: ["confirmation"],
    to: ["cart", "challenge"],
    steps: [
      { do: "click", target: "cart.newCart", timeout: 15000 },
      { do: "click", target: "cart.newCartCreate", when: "cart.newCartDialog", whenTimeout: 5000 },
      { do: "wait", ms: 2500 },
      { do: "goto", url: "{{cart}}" },
    ],
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
    from: ["product", "productPage"],
    to: ["product", "productPage"],
    steps: [
      { do: "peek", target: "cart.count", as: "cartBefore" },
      // Several packagings: cut tape, as a small quantity is sold.
      // No Cut Tape button (the word only in its specifications): the page's own choice stays (2026-11-24).
      // The quantity first: on a narrow page the packaging options only show
      // once it is typed, and they push Add to Cart down; a click aimed
      // before they showed hit nothing (2026-11-24, MMBT2222ALT1G).
      { do: "fill", target: "product.quantity", value: "{{quantity}}" },
      { do: "wait", ms: 1500 },
      { do: "click", target: "product.packChosen", when: "product.packaging", whenTimeout: 2000, optional: true, timeout: 3000 },
      { do: "wait", ms: 1000 },
      { do: "click", target: "product.addToCart", timeout: 15000 },
      { do: "click", target: "product.valueCalcAdd", optional: true, timeout: 2500 },
      { do: "click", target: "product.addAnyway", optional: true, timeout: 2000 },
      // Required: an add that did nothing fails here, and its page is kept
      // (2026-11-25: parts that "went in" were not in the cart).
      { do: "waitForChange", target: "cart.count", from: "cartBefore", or: "cart.added", timeout: 10000 },
      { do: "click", target: "product.continueShopping", optional: true, timeout: 5000 },
      { do: "wait", ms: 500 },
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
      // A part DigiKey didn't take ("were not added to your order", e.g. one
      // sold in several packagings) is not waited on here: its notice stays on
      // the page even once handled, so a hand-off never ended (2026-11-21, the
      // run stuck at the cart). The flow's settleCart reads the cart next, adds
      // what is missing one by one, and names what still isn't there.
      { do: "waitForHidden", target: "cart.empty", timeout: 20000 },
      { do: "waitFor", target: "cart.rows", timeout: 20000 },
    ],
  },
  {
    /* The whole pasted list at once: one fill, one click, still on the cart
     * page. */
    name: "bulkAddToList",
    title: T("Add the pasted list", "按粘贴列表加购", "Añadir la lista pegada"),
    auto: false,
    from: ["cart"],
    to: ["cart"],
    steps: [
      { do: "fill", target: "cart.bulkText", value: "{{lines}}" },
      { do: "click", target: "cart.bulkAdd" },
      { do: "wait", ms: 2500 },
      { do: "waitForHidden", target: "cart.empty", timeout: 20000 },
      { do: "waitFor", target: "cart.rows", timeout: 20000 },
    ],
  },
  {
    /* DigiKey's address check: keep the choice it made (its standard form
     * of the same address) and continue. */
    name: "acceptAddress",
    title: T("Continue with the checked address", "确认地址并继续", "Continuar con la dirección verificada"),
    from: ["addressCheck"],
    to: ["shippingOptions", "shipping", "payment", "review", "checkoutStep", "signIn"],
    steps: [{ do: "click", target: "addr.verifyContinue", navigates: true }],
  },
  {
    /* Select Shipping Options: keep the release option and method DigiKey
     * chose and go on to payment. The order total is shown and approved on
     * the review page, as before. */
    name: "chooseShipping",
    title: T("Continue to Payment", "继续到付款", "Continuar al pago"),
    from: ["shippingOptions"],
    to: ["payment", "review", "checkoutStep", "signIn", "shippingOptions"],
    steps: [{ do: "click", target: "ship.continue", navigates: true }],
  },
  {
    /* The person's saved address (Buy lab's address book) into the
     * shipping form, then Continue. Only when an operation names it: without
     * an address the form stays the person's, as before. */
    name: "fillAddress",
    title: T("Fill in the saved address", "填写保存的收货地址", "Rellenar la dirección guardada"),
    auto: false,
    from: ["shipping"],
    to: ["addressCheck", "shippingOptions", "shipping", "payment", "review", "checkoutStep", "signIn"],
    steps: [
      { do: "fill", target: "addr.email", value: "{{email}}" },
      { do: "fill", target: "addr.phone", value: "{{phone}}" },
      // Before the name and company: choosing it can change the fields below.
      { do: "click", target: "addr.customerTypeOpen" },
      { do: "click", target: "addr.customerTypeOption" },
      { do: "fill", target: "addr.firstName", value: "{{firstName}}" },
      { do: "fill", target: "addr.lastName", value: "{{lastName}}" },
      { do: "fill", target: "addr.company", value: "{{company}}" },
      { do: "fill", target: "addr.line1", value: "{{line1}}" },
      { do: "fill", target: "addr.line2", value: "{{line2}}" },
      { do: "fill", target: "addr.city", value: "{{city}}" },
      { do: "click", target: "addr.stateOpen" },
      { do: "click", target: "addr.stateOption" },
      { do: "fill", target: "addr.zip", value: "{{zip}}" },
      { do: "click", target: "addr.continue", navigates: true },
    ],
  },
  {
    /* The whole list as one file: "Upload a File", map its two columns,
     * Add to Current Cart. Nothing is typed, so a long list costs no more
     * than a short one. Still on the cart page. */
    name: "uploadToCart",
    title: T("Upload the list file", "上传清单文件", "Subir el archivo de la lista"),
    auto: false,
    from: ["cart"],
    to: ["cart"],
    steps: [
      // Right after a new cart the page is still settling, and a file given
      // then was not taken (2026-11-25): a moment first, and once more if
      // the mapping dialog doesn't come.
      { do: "wait", ms: 1500 },
      { do: "upload", target: "cart.uploadFile", filesParam: "file" },
      { do: "waitFor", target: "cart.mapper", optional: true, timeout: 10000 },
      { do: "upload", target: "cart.uploadFile", filesParam: "file", unless: "cart.mapper" },
      { do: "waitFor", target: "cart.mapper", timeout: 20000 },
      { do: "select", target: "cart.mapPartColumn", option: "DigiKey Part Number" },
      { do: "select", target: "cart.mapQtyColumn", option: "Manufacturer Part Number" },
      { do: "select", target: "cart.mapColumn2", option: "Quantity" },
      // The file's first row is its header; the parts start on row 2.
      { do: "fill", target: "cart.mapStartRow", value: "2" },
      { do: "click", target: "cart.mapAdd" },
      { do: "waitForHidden", target: "cart.mapper", timeout: 20000 },
      // Done once the cart shows what it took: lines, or lines left at View
      // Options (the empty-cart heading stays then, and waiting for it to go
      // cost 20 s each upload, 2026-11-24).
      { do: "waitFor", target: "cart.uploaded", timeout: 20000 },
      { do: "wait", ms: 800 },
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
  // No Fetch domain here: Cloudflare scores that CDP footprint, and the flow
  // keeps to the shop's own pages anyway.
  guard: false,
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
      // A part no longer sold ends the walk too, and the add fails at once.
      { do: "walk", to: ["product", "notSold", "productPage", "noMatch"] },
      { do: "act", name: "addToCart" },
    ],
    // The same, without the search page: everything happens in the cart.
    bulkAdd: [
      { do: "walk", to: "cart" },
      { do: "act", name: "bulkAddToCart" },
    ],
    bulkAddList: [
      { do: "walk", to: "cart" },
      { do: "act", name: "bulkAddToList" },
    ],
    // The list as a file (Buy lab's choice when a site has one).
    bulkAddBom: [
      { do: "walk", to: "cart" },
      // A cart with lines in it is saved and a new one started: only this
      // purchase's list is in the cart that is checked out.
      { do: "click", target: "cart.newCart", when: "cart.rows", whenTimeout: 5000 },
      { do: "click", target: "cart.newCartCreate", when: "cart.newCartDialog", whenTimeout: 5000 },
      { do: "waitFor", target: "cart.empty", optional: true, timeout: 20000 },
      { do: "act", name: "uploadToCart" },
    ],
    setPack: [
      { do: "walk", to: "cart" },
      { do: "select", target: "cart.packSelect", option: "{{pack}}", contains: true, timeout: 10000 },
      { do: "wait", ms: 6000 },
    ],
    openOption: [
      { do: "waitForHidden", target: "cart.busy", optional: true, timeout: 20000 },
      { do: "click", target: "cart.viewOptions", timeout: 1500 },
      { do: "waitFor", target: "cart.optionsLoaded", timeout: 15000 },
      { do: "read", target: "cart.optionsLoaded", as: "options" },
    ],
    pickOption: [
      { do: "click", target: "cart.optionChoice", js: true },
      { do: "click", target: "cart.optionsAdd" },
      { do: "waitForHidden", target: "cart.optionsDialog", timeout: 15000 },
      { do: "wait", ms: 800 },
      { do: "waitForHidden", target: "cart.busy", optional: true, timeout: 20000 },
    ],
    closeOption: [{ do: "click", target: "cart.optionsCancel" }, { do: "waitForHidden", target: "cart.optionsDialog", timeout: 10000 }],
    openCart: [
      { do: "walk", to: "cart" },
      {
        do: "extract",
        target: "cart.rows",
        fields: {
          part: { target: "cart.part" }, text: { target: "track.self" },
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
    // The same with a saved address: the run stops at the address form (a
    // signed-in account may skip it), fills it in, and carries on.
    placeOrderWithAddress: [
      { do: "walk", to: "cart" },
      { do: "walk", to: ["shipping", "payment", "review", "confirmation"] },
      // Signed in: the saved address with the order's postal code, then on.
      { do: "click", target: "addr.savedPick", js: true, when: "addr.savedRow", whenTimeout: 4000, optional: true },
      { do: "click", target: "addr.continue", when: "addr.savedRow", navigates: true, optional: true, timeout: 8000 },
      // None saved for it: a new address, filled in below.
      { do: "click", target: "addr.addNew", when: "addr.savedAny", unless: "addr.savedRow", optional: true, timeout: 5000 },
      { do: "act", name: "fillAddress", when: "addr.form", whenTimeout: 5000 },
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
    bulkAddList: ["lines"],
    bulkAddBom: ["file", "partColumn"],
    setPack: ["part", "pack"],
    openOption: [],
    pickOption: ["option"],
    closeOption: [],
    removeFromCart: ["part"],
    checkout: [],
    placeOrder: [],
    placeOrderWithAddress: ["email", "phone", "customerType", "firstName", "lastName", "company", "line1", "line2", "city", "state", "zip"],
    orders: [],
    track: ["order"],
  },
  /* What the panel fills in first: a 0.1 µF 0402 capacitor, cents each. */
  taskDefaults: {
    addToCart: { part: "GRM155R71C104KA88D", quantity: "10" },
    bulkAdd: { part: "GRM155R71C104KA88D", quantity: "10" },
    bulkAddList: { lines: "10, GRM155R71C104KA88D" },
    removeFromCart: { part: "GRM155R71C104KA88D" },
  },
};
