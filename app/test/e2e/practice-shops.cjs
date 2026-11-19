"use strict";

/* Two practice shops on this computer, built differently on purpose, so one
 * task is shown to run on two DOM trees:
 *
 * - Shop A, laid out like DigiKey: an exact search redirects to the product
 *   page; the quantity field has a <label>; a cookie banner covers the page
 *   until accepted; the add button is a plain <button>; "Added to cart"
 *   appears after a delay.
 * - Shop B, laid out like Mouser: search shows a results list; the product
 *   page's quantity is named only by aria-labelledby; "Add To Cart" is a
 *   role=button div inside a custom element's shadow root; the field only
 *   takes typed keys (it ignores values set from script); the cart count
 *   lives in a badge.
 *
 * Both have a sign-in page and a cart. State is per server, in memory. */

const http = require("node:http");

function page(title, body, script = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 0; }
  header { display: flex; gap: 16px; padding: 12px 20px; background: #eee; align-items: center; }
  main { padding: 20px; min-height: 1400px; }
  .banner { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: flex-end; }
  .banner > div { background: #fff; width: 100%; padding: 24px; }
  .toast { position: fixed; top: 10px; right: 10px; background: #dfd; padding: 10px; }
  .spacer { height: 700px; }
</style></head><body>${body}<script>${script}</script></body></html>`;
}

function createShops() {
  const carts = { a: [], b: [] };
  const signedIn = { a: false, b: false };
  const parts = ["GRM155R71C104KA88D", "RC0402FR-0710KL", "LM358DR"];

  function shopA(url, response) {
    const header = `<header><a href="/">Shop A</a><input type="search" placeholder="Search part number">
      <a href="/cart">Cart (<span class="cart-count">${carts.a.length}</span>)</a>
      ${signedIn.a ? '<a href="/logout">Log out</a>' : '<a href="/login">Sign in</a>'}</header>`;
    const banner = `<div class="banner" id="consent"><div>We use cookies.
      <button id="onetrust-accept-btn-handler" onclick="document.getElementById('consent').remove(); document.cookie='ok=1'">Accept All Cookies</button></div></div>`;
    const consent = () => (/(^|; )ok=1/.test(response.req.headers.cookie || "") ? "" : banner);
    if (url.pathname === "/search") {
      const keywords = url.searchParams.get("keywords") || "";
      if (parts.includes(keywords)) {
        response.writeHead(302, { Location: `/product/${encodeURIComponent(keywords)}` }).end();
        return;
      }
      response.end(page("Results", `${header}<main>No exact match</main>`));
      return;
    }
    if (url.pathname.startsWith("/product/")) {
      const part = decodeURIComponent(url.pathname.slice("/product/".length));
      response.end(page(part, `${header}<main><h1>${part}</h1><div class="spacer"></div>
        <form id="buy" onsubmit="return false"><label for="qty">Quantity</label> <input id="qty" value="1">
        <button type="submit" id="add">Add to Cart</button></form></main>${consent()}`, `
        document.getElementById("buy").addEventListener("submit", async () => {
          const qty = document.getElementById("qty").value;
          await fetch("/api/add", { method: "POST", body: JSON.stringify({ part: ${JSON.stringify(part)}, qty }) });
          setTimeout(() => {
            document.querySelector(".cart-count").textContent = String(Number(document.querySelector(".cart-count").textContent) + 1);
            const toast = document.createElement("div"); toast.className = "toast"; toast.textContent = "Added to cart";
            document.body.appendChild(toast);
          }, 400);
        });`));
      return;
    }
    if (url.pathname === "/cart") {
      const rows = carts.a.map((line) => `<tr><td><a href="/product/${line.part}">${line.part}</a></td><td><input value="${line.qty}"></td></tr>`).join("");
      response.end(page("Cart", `${header}<main><h1>Cart</h1><table><thead><tr><th>Part</th><th>Qty</th></tr></thead><tbody>${rows}</tbody></table></main>`));
      return;
    }
    if (url.pathname === "/login") {
      response.end(page("Sign in", `${header}<main><form method="post" action="/login"><label>Email <input name="email"></label>
        <label>Password <input name="password" type="password"></label><button>Sign in</button></form></main>`));
      return;
    }
    if (url.pathname === "/api/add") {
      let body = "";
      response.req.on("data", (chunk) => { body += chunk; });
      response.req.on("end", () => { carts.a.push(JSON.parse(body)); response.end("{}"); });
      return;
    }
    response.end(page("Shop A", `${header}<main>Welcome</main>`));
  }

  function shopB(url, response) {
    const header = `<header><span>Shop B</span><div role="combobox" aria-label="Search parts"><input id="as-input-1" aria-label="Search parts"></div>
      <a href="/Cart/" id="cart-link">My cart <span id="cart-badge"><span class="count">${carts.b.length}</span></span></a>
      ${signedIn.b ? '<button onclick="location.href=\'/logout\'">Log Out</button>' : '<a href="/login">Log in</a>'}</header>`;
    if (url.pathname === "/c/") {
      const q = url.searchParams.get("q") || "";
      const rows = parts.filter((part) => part.startsWith(q.slice(0, 3))).map((part) =>
        `<li><a href="/ProductDetail/${encodeURIComponent(part)}">${part}</a> <span>In stock</span></li>`).join("");
      response.end(page("Results", `${header}<main><h1>Results</h1><ul id="results">${rows}</ul></main>`));
      return;
    }
    if (url.pathname.startsWith("/ProductDetail/")) {
      const part = decodeURIComponent(url.pathname.slice("/ProductDetail/".length));
      response.end(page(part, `${header}<main><h1>${part}</h1>
        <div class="buy-box"><span id="qty-caption">Qty</span> <input id="q1" aria-labelledby="qty-caption" value="1">
        <buy-button></buy-button></div></main>`, `
        // The field keeps only what was typed; a value set from script is reset.
        const input = document.getElementById("q1");
        let typed = input.value;
        input.addEventListener("keydown", (event) => { if (event.key === "Backspace") typed = typed.slice(0, -1); });
        input.addEventListener("input", (event) => {
          if (!event.isTrusted) { input.value = typed; return; }
          typed = input.value;
        });
        customElements.define("buy-button", class extends HTMLElement {
          connectedCallback() {
            const root = this.attachShadow({ mode: "open" });
            root.innerHTML = '<div role="button" tabindex="0" style="display:inline-block;padding:8px;background:#ccf">Add To Cart</div>';
            root.querySelector("[role=button]").addEventListener("click", async (event) => {
              if (!event.isTrusted) return;
              await fetch("/api/add", { method: "POST", body: JSON.stringify({ part: ${JSON.stringify(part)}, qty: typed }) });
              document.querySelector("#cart-badge .count").textContent = String(Number(document.querySelector("#cart-badge .count").textContent) + 1);
            });
          }
        });`));
      return;
    }
    if (url.pathname === "/Cart/") {
      const rows = carts.b.map((line) => `<tr><td><a href="/ProductDetail/${line.part}">${line.part}</a></td><td><input value="${line.qty}"></td></tr>`).join("");
      response.end(page("Cart", `${header}<main><table><tbody>${rows}</tbody></table></main>`));
      return;
    }
    if (url.pathname === "/login") {
      response.end(page("Log in", `${header}<main><form method="post" action="/login"><input name="user" aria-label="User name">
        <input name="password" type="password" aria-label="Password"><button>Log in</button></form></main>`));
      return;
    }
    if (url.pathname === "/api/add") {
      let body = "";
      response.req.on("data", (chunk) => { body += chunk; });
      response.req.on("end", () => { carts.b.push(JSON.parse(body)); response.end("{}"); });
      return;
    }
    response.end(page("Shop B", `${header}<main>Welcome</main>`));
  }

  function handler(shop) {
    return (request, response) => {
      response.req = request;
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/login" && request.method === "POST") {
        signedIn[shop] = true;
        response.writeHead(303, { Location: "/" }).end();
        return;
      }
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      (shop === "a" ? shopA : shopB)(url, response);
    };
  }

  const servers = { a: http.createServer(handler("a")), b: http.createServer(handler("b")) };
  return {
    carts,
    signedIn,
    async listen() {
      const ports = {};
      for (const [name, server] of Object.entries(servers)) {
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        ports[name] = server.address().port;
      }
      return ports;
    },
    close() {
      for (const server of Object.values(servers)) server.close();
    },
  };
}


/* The practice shops as supplier profiles (sites/index.js defineSite input).
 * They lean on the common targets; only what their DOM needs is listed. */
function practiceSites({ a, b }) {
  const A = `http://127.0.0.1:${a}`;
  const B = `http://127.0.0.1:${b}`;
  return [
    {
      id: "practice-a",
      name: "Shop A",
      verified: true,
      hosts: ["127.0.0.1"],
      urls: { home: `${A}/`, search: `${A}/search?keywords={{part|url}}`, cart: `${A}/cart`, signIn: `${A}/login` },
      targets: {
        "results.exact": { any: [{ role: "link", name: "{{part}}" }] },
      },
    },
    {
      id: "practice-b",
      name: "Shop B",
      verified: true,
      hosts: ["127.0.0.1"],
      urls: { home: `${B}/`, search: `${B}/c/?q={{part|url}}`, cart: `${B}/Cart/`, signIn: `${B}/login` },
      targets: {
        "results.exact": { any: [{ role: "link", name: "{{part}}" }] },
        "cart.count": { any: [{ css: "#cart-badge .count" }] },
      },
      tasks: {
        addToCart: [
          { do: "goto", url: "{{search}}" },
          { do: "click", target: "results.exact" },
          { do: "peek", target: "cart.count", as: "cartBefore" },
          { do: "fill", target: "product.quantity", value: "{{quantity}}" },
          { do: "click", target: "product.addToCart" },
          { do: "waitForChange", target: "cart.count", from: "cartBefore", or: "cart.added" },
        ],
      },
    },
  ];
}


module.exports = { createShops, practiceSites };
