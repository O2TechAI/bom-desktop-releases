"use strict";

/* A practice DigiKey on this computer, so every DigiKey operation can run end
 * to end without the real site (which turns the build server away).
 *
 * The product page, header and cart copy DigiKey's own markup, read from
 * archived copies of www.digikey.com (2026): `#quantity-input`,
 * `#add-to-cart-btn-price-procurement`, `.toggle--cart-total`,
 * `#my_digikey_logged_in`, the `#cartDetails` table with `detailRow_*`
 * cells and its "Remove from cart" popup, /OrderHistory/List. Checkout,
 * review, order history rows and tracking need an account, so no copy
 * exists; those pages here are plain guesses that only the words-based
 * targets can rely on, as on the real site.
 *
 * The payment step refuses to continue until a payment is chosen, so the
 * hand-off to the person is exercised too. State is in memory.
 *
 * With `state.challenge` on, product pages first show a stand-in for
 * Cloudflare's security check as it reaches a Chinese-language computer:
 * translated words, a title of "请稍候…", random ids, and the challenge-page
 * script that is the one sign it has in every language. A button plays the
 * person's part. `challengeLoads` counts how often it was loaded. */

const http = require("node:http");

const PRODUCTS = {
  "GRM155R71C104KA88D": { sku: "490-10698-1-ND", maker: "Murata Electronics", price: 0.1 },
  "RC0402FR-0710KL": { sku: "311-10.0KLRCT-ND", maker: "YAGEO", price: 0.1 },
};
const TRACKING = "1Z9999990312345678";

function escape(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function createDigiKeyShop() {
  const state = { signedIn: false, cart: [], orders: [], payment: null, nextOrder: 88012345, challenge: false, challengeLoads: 0 };

  function challengePage() {
    const id = () => `_${Math.random().toString(16).slice(2, 14)}`;
    return `<!doctype html><html lang="zh-cn"><head><meta charset="utf-8"><title>请稍候…</title></head>
<body><div class="main-wrapper ${id()}"><h1>www.digikey.com</h1><h2 id="${id()}">正在进行安全验证</h2>
<p id="${id()}">本网站使用安全服务防护恶意自动程序。</p>
<div id="${id()}"><button type="button" id="${id()}">我是真人</button><input type="hidden" name="cf-turnstile-response"></div></div>
<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=practice"></script>
<script>document.querySelector("button").addEventListener("click", async () => {
  await fetch("/cdn-cgi/pass", { method: "POST" });
  location.reload();
});</script></body></html>`;
  }

  const cartCount = () => state.cart.length;
  const subtotal = () => state.cart.reduce((sum, line) => sum + PRODUCTS[line.part].price * Number(line.qty), 0);

  function page(title, body, script = "") {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 0; }
  header { display: flex; gap: 16px; padding: 12px 20px; background: #cc0000; color: #fff; align-items: center; }
  header a { color: #fff; }
  .hidden { display: none; }
  main { padding: 20px; min-height: 900px; }
  table { border-collapse: collapse; } td, th { padding: 6px 10px; border-bottom: 1px solid #ddd; }
  .dialog { position: fixed; inset: 30% 30% auto; background: #fff; padding: 20px; border: 1px solid #999; }
</style></head><body>
<header>
  <a href="/en" class="header__logo" aria-label="DigiKey">DigiKey</a>
  <input name="keywords" class="header__searchinput product-search-text" type="search" placeholder="Enter keyword or part #">
  <a class="${state.signedIn ? "hidden" : ""}" id="my_digikey_logged_out" href="/MyDigiKey/Login">Login or REGISTER</a>
  <a class="${state.signedIn ? "" : "hidden"}" id="my_digikey_logged_in" href="/MyDigiKey">Hello, Buyer</a>
  <a class="flymenu__section-title resource--cart" href="/ordering/shoppingcart?lang=en">
    <span class="cart-dropdown-title">Your item(s)</span> <span class="toggle--cart-total">${cartCount()}</span></a>
</header>
<main>${body}</main><script>${script}</script></body></html>`;
  }

  function login(returnUrl) {
    return page("Sign in", `<h1>Log In</h1><form method="post" action="/MyDigiKey/Login">
      <input type="hidden" name="returnurl" value="${escape(returnUrl)}">
      <label>Username or Email <input name="username" autocomplete="username"></label>
      <label>Password <input name="password" type="password"></label>
      <button type="submit">Log In</button></form>`);
  }

  function readBody(request) {
    return new Promise((resolve) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => resolve(body));
    });
  }

  async function handle(request, response) {
    const url = new URL(request.url, "http://127.0.0.1");
    const html = (text) => { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(text); };
    const redirect = (to) => response.writeHead(303, { Location: to }).end();
    const path = url.pathname;

    if (path === "/en/products/result") {
      const keywords = url.searchParams.get("keywords") || "";
      if (PRODUCTS[keywords]) return redirect(`/en/products/detail/${encodeURIComponent(keywords)}`);
      return html(page("Results", `<h1>No results for ${escape(keywords)}</h1>`));
    }
    if (path.startsWith("/cdn-cgi/challenge-platform/")) {
      response.setHeader("Content-Type", "text/javascript");
      return response.end("/* practice */");
    }
    if (path === "/cdn-cgi/pass" && request.method === "POST") {
      state.challenge = false;
      return response.end("ok");
    }
    if (state.challenge && path.startsWith("/en/products/")) {
      state.challengeLoads += 1;
      response.statusCode = 403;
      return html(challengePage());
    }
    if (path.startsWith("/en/products/detail/")) {
      const part = decodeURIComponent(path.slice("/en/products/detail/".length));
      const product = PRODUCTS[part];
      if (!product) return html(page("Not found", "<h1>Not found</h1>"));
      return html(page(part, `<h1 data-testid="mfr-number">${escape(part)}</h1><p>${escape(product.maker)} · ${product.sku}</p>
        <div style="height: 500px"></div>
        <div data-testid="order-form"><div>Quantity</div>
          <div data-testid="quantity-input"><input aria-invalid="false" autocomplete="off" id="quantity-input" type="text" inputmode="numeric" maxlength="9" value=""></div>
          <button type="button" data-testid="add-to-cart-btn" id="add-to-cart-btn-price-procurement">Add to Cart</button></div>`, `
        document.getElementById("add-to-cart-btn-price-procurement").addEventListener("click", async () => {
          const qty = document.getElementById("quantity-input").value;
          const answer = await fetch("/api/cart", { method: "POST", body: JSON.stringify({ part: ${JSON.stringify(part)}, qty }) });
          document.querySelector(".toggle--cart-total").textContent = (await answer.json()).count;
        });`));
    }
    if (path === "/api/cart" && request.method === "POST") {
      const line = JSON.parse(await readBody(request));
      if (!/^[1-9]\d*$/.test(line.qty)) return response.writeHead(400).end("{}");
      state.cart.push(line);
      response.setHeader("Content-Type", "application/json");
      return response.end(JSON.stringify({ count: cartCount() }));
    }
    if (path === "/api/cart/delete" && request.method === "POST") {
      const { part } = JSON.parse(await readBody(request));
      state.cart = state.cart.filter((line) => line.part !== part);
      return response.end("{}");
    }
    if (path.toLowerCase() === "/ordering/shoppingcart") {
      const rows = state.cart.map((line) => {
        const product = PRODUCTS[line.part];
        return `<tr class="detailRow">
          <td class="detailRow_index"><input type="checkbox" class="dk-checkbox"></td>
          <td class="detailRow_productDetails"><a href="/en/products/detail/${encodeURIComponent(line.part)}">${product.sku}</a><div>${escape(line.part)}</div></td>
          <td class="detailRow_quantity"><input class="dk-input" name="quantity" inputmode="numeric" value="${escape(line.qty)}"></td>
          <td class="detailRow_unitPrice">$${product.price.toFixed(5)}</td>
          <td class="detailRow_extendedPrice">$${(product.price * Number(line.qty)).toFixed(2)}</td>
          <td><button type="button" class="deletePart" data-part="${escape(line.part)}" aria-label="Delete ${escape(line.part)}">Delete</button></td></tr>`;
      }).join("");
      return html(page("DigiKey - Shopping Cart", `<form id="mainForm"><div id="order_shoppingCart">
        <table id="cartDetails"><thead><tr><th class="detailRow_index_th"></th><th class="detailRow_productDetails_th">Product Details</th>
        <th class="detailRow_quantity_th">Quantity</th><th class="detailRow_unitPrice_th">Unit Price</th><th class="detailRow_extendedPrice_th">Extended Price</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
        <div id="cart-summary-heading">Cart Summary</div>
        <div id="divSummaryBox"><p>Subtotal $${subtotal().toFixed(2)}</p>
        ${state.cart.length ? '<button type="button" id="btnCheckout" class="dk-btn__primary">Checkout</button>' : ""}</div></div></form>
        <div class="dialog" id="removeDialog" hidden><p>Remove this product?</p>
          <button type="button" id="removeYes">Remove from cart</button> <button type="button" id="removeNo">Leave in cart</button></div>`, `
        let pending = null;
        for (const button of document.querySelectorAll(".deletePart")) {
          button.addEventListener("click", () => { pending = button.dataset.part; document.getElementById("removeDialog").hidden = false; });
        }
        document.getElementById("removeNo").addEventListener("click", () => { document.getElementById("removeDialog").hidden = true; });
        document.getElementById("removeYes").addEventListener("click", async () => {
          await fetch("/api/cart/delete", { method: "POST", body: JSON.stringify({ part: pending }) });
          document.querySelector("button[data-part='" + pending + "']").closest("tr").remove();
          document.getElementById("removeDialog").hidden = true;
        });
        document.getElementById("btnCheckout")?.addEventListener("click", () => { location.href = "/ordering/checkout/shipping"; });`));
    }
    if (path === "/MyDigiKey/Login" && request.method === "POST") {
      const form = new URLSearchParams(await readBody(request));
      if (form.get("password")) state.signedIn = true;
      const back = form.get("returnurl") || "/en";
      return redirect(back.startsWith("/") ? back : "/en");
    }
    if (path === "/MyDigiKey/Login") return html(login(url.searchParams.get("returnurl") || "/en"));
    if (path === "/MyDigiKey") return html(page("myDigiKey", "<h1>myDigiKey</h1>"));

    if (path.startsWith("/ordering/checkout/")) {
      if (!state.signedIn) return redirect(`/MyDigiKey/Login?returnurl=${encodeURIComponent(path)}`);
      const step = path.slice("/ordering/checkout/".length);
      if (step === "shipping") {
        if (request.method === "POST") return redirect("/ordering/checkout/payment");
        return html(page("Checkout - Shipping", `<h1>Shipping</h1><p>Ship to: Buyer, 701 Brooks Ave S, Thief River Falls, MN 56701</p>
          <form method="post" action="/ordering/checkout/shipping"><button type="submit">Continue</button></form>`));
      }
      if (step === "payment") {
        if (request.method === "POST") {
          const form = new URLSearchParams(await readBody(request));
          if (form.get("payment")) {
            state.payment = form.get("payment");
            return redirect("/ordering/checkout/review");
          }
          return html(page("Checkout - Payment", paymentForm("Choose how to pay.")));
        }
        return html(page("Checkout - Payment", paymentForm("")));
      }
      if (step === "review") {
        if (!state.payment) return redirect("/ordering/checkout/payment");
        if (request.method === "POST") {
          const number = String(state.nextOrder++);
          state.orders.unshift({ number, date: "11/16/2026", status: "Shipped", total: subtotal() + 6.99, lines: state.cart });
          state.cart = [];
          state.payment = null;
          return redirect(`/ordering/confirmation/${number}`);
        }
        const lines = state.cart.map((line) => `<li>${escape(line.part)} × ${escape(line.qty)}</li>`).join("");
        return html(page("Checkout - Review", `<h1>Review Order</h1><ul>${lines}</ul><p>Payment: ${escape(state.payment)}</p>
          <div><span>Merchandise</span> <span>$${subtotal().toFixed(2)}</span></div>
          <div><span>Shipping</span> <span>$6.99</span></div>
          <div><span>Total</span> <span>$${(subtotal() + 6.99).toFixed(2)}</span></div>
          <form method="post" action="/ordering/checkout/review"><button type="submit">Submit Order</button></form>`));
      }
    }
    if (path.startsWith("/ordering/confirmation/")) {
      const number = path.split("/").pop();
      return html(page("Order Confirmation", `<h1>Thank you for your order!</h1><p>Web Order Number: ${escape(number)}</p>`));
    }
    if (path === "/OrderHistory/List") {
      if (!state.signedIn) return redirect(`/MyDigiKey/Login?returnurl=${encodeURIComponent(path)}`);
      const rows = state.orders.map((order) => `<tr class="mud-table-row">
        <td class="mud-table-cell" data-label="Web Order #"><a href="/OrderHistory/Detail/${order.number}">${order.number}</a></td>
        <td class="mud-table-cell" data-label="Date Submitted">${order.date}</td>
        <td class="mud-table-cell" data-label="Status">${order.status}</td>
        <td class="mud-table-cell" data-label="Total">$${order.total.toFixed(2)}</td></tr>`).join("");
      return html(page("Order History", `<h1>Order History</h1><table class="mud-table"><thead><tr><th>Web Order #</th><th>Date Submitted</th><th>Status</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody></table>`));
    }
    if (path.startsWith("/OrderHistory/Detail/")) {
      if (!state.signedIn) return redirect(`/MyDigiKey/Login?returnurl=${encodeURIComponent(path)}`);
      const order = state.orders.find((entry) => entry.number === path.split("/").pop());
      if (!order) return html(page("Not found", "<h1>Not found</h1>"));
      return html(page(`Order ${order.number}`, `<h1>Web Order ${order.number}</h1>
        <table><tr><th>Status</th><td data-label="Status">${order.status}</td></tr></table>
        <h2>Shipments</h2><p>UPS Ground: <a href="https://www.ups.com/track?tracknum=${TRACKING}">${TRACKING}</a></p>`));
    }
    return html(page("DigiKey", "<h1>Welcome</h1>"));
  }

  function paymentForm(error) {
    return `<h1>Payment</h1><form method="post" action="/ordering/checkout/payment">
      <label><input type="radio" name="payment" value="Visa ending 4242"> Visa ending 4242</label>
      <label><input type="radio" name="payment" value="Net 30"> Net 30 terms</label>
      ${error ? `<p role="alert">${escape(error)}</p>` : ""}
      <button type="submit">Continue</button></form>`;
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => { response.writeHead(500).end(String(error)); });
  });
  return {
    state,
    tracking: TRACKING,
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return server.address().port;
    },
    close() { server.close(); },
  };
}


/* The practice DigiKey as a supplier: DigiKey's own targets and tasks, at
 * this server's addresses. */
function practiceDigiKey(port) {
  const digikey = require("../../src/automation/sites/digikey");
  const base = `http://127.0.0.1:${port}`;
  return {
    ...digikey,
    id: "practice-dk",
    name: "DigiKey practice",
    verified: true,
    hosts: ["127.0.0.1"],
    urls: {
      home: `${base}/en`,
      search: `${base}/en/products/result?keywords={{part|url}}`,
      cart: `${base}/ordering/shoppingcart`,
      signIn: `${base}/MyDigiKey/Login`,
      orders: `${base}/OrderHistory/List`,
    },
  };
}


module.exports = { createDigiKeyShop, practiceDigiKey };
